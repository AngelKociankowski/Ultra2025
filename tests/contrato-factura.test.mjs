/**
 * El número de factura y el contrato, en la lista del estado de fuerza.
 *
 * Antes las dos columnas eran una palomita. «Sí está facturado» y «sí tiene
 * contrato» contestan media pregunta: la que sigue —«¿con qué número?»,
 * «¿me lo enseñas?»— obligaba a ir a buscar el dato a otro lado, y en el caso
 * del contrato, a un cajón.
 *
 * Se prueba que la leyenda diga lo que hay, que el botón lleve al papel cuando
 * el papel existe, y las reglas de siempre: ver el contrato es de todos,
 * subirlo es de jurídico, y un archivo que no es PDF no entra.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let juridico;
let finanzas;
let operaciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Un PDF mínimo pero de verdad: encabezado y cierre como manda el formato. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function servicioNuevo(nombre) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': 2 } }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

async function subirContrato(cliente, id, { datos = PDF, nombre = 'contrato.pdf', tipo = 'application/pdf' } = {}) {
  const cuerpo = new FormData();
  cuerpo.append('archivo', new Blob([datos], { type: tipo }), nombre);
  return fetch(`${app.base}/api/servicios/${id}/contrato`, {
    method: 'POST',
    headers: { cookie: cliente.cookie },
    body: cuerpo,
  });
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
});

after(async () => {
  await app?.cerrar();
});

describe('el contrato deja de ser una palomita', () => {
  test('sin contrato, la lista lo dice con todas sus letras', async () => {
    await servicioNuevo('CONTRATO NO TIENE');
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=CONTRATO NO TIENE')).texto);
    assert.match(html, /No cuenta con contrato/);
  });

  test('con contrato pero sin PDF, avisa que falta subirlo', async () => {
    const id = await servicioNuevo('CONTRATO SIN PDF');
    const r = await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: true }),
    });
    assert.equal(r.status, 200, r.texto);

    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=CONTRATO SIN PDF')).texto);
    assert.match(html, /Cuenta con contrato/);
    assert.match(html, /falta subir el PDF/);
  });

  test('subir el contrato lo deja descargable y marca el servicio', async () => {
    const id = await servicioNuevo('CONTRATO CON PDF');
    const subida = await subirContrato(juridico, id, { nombre: 'contrato-firmado.pdf' });
    assert.equal(subida.status, 201, await subida.text());

    // Subir el papel implica que sí hay contrato: nadie sube el de un cliente
    // que no lo tiene.
    const ficha = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(ficha.tiene_contrato, 1);
    assert.ok(ficha.contrato_archivo);
    assert.equal(ficha.contrato_archivo_nombre, 'contrato-firmado.pdf');

    const bajada = await fetch(`${app.base}/api/servicios/${id}/contrato`, { headers: { cookie: admin.cookie } });
    assert.equal(bajada.status, 200);
    assert.equal(bajada.headers.get('content-type'), 'application/pdf');
    assert.match(bajada.headers.get('content-disposition'), /attachment; filename="contrato-firmado\.pdf"/);
    assert.ok(Buffer.from(await bajada.arrayBuffer()).equals(PDF), 'el archivo que baja es el que se subió');

    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=CONTRATO CON PDF')).texto);
    assert.match(html, new RegExp(`/api/servicios/${id}/contrato`));
    assert.doesNotMatch(html, /falta subir el PDF/);
  });

  test('quitar el PDF no cancela el contrato: quita el papel, no el hecho', async () => {
    const id = await servicioNuevo('CONTRATO SE QUITA EL PDF');
    assert.equal((await subirContrato(juridico, id)).status, 201);

    const r = await juridico.pedir(`/api/servicios/${id}/contrato`, { method: 'DELETE' });
    assert.equal(r.status, 200, r.texto);

    const ficha = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(ficha.contrato_archivo, null);
    assert.equal(ficha.tiene_contrato, 1, 'sigue teniendo contrato, solo que sin el papel adjunto');

    const bajada = await admin.pedir(`/api/servicios/${id}/contrato`);
    assert.equal(bajada.status, 404);
  });

  test('reemplazarlo deja uno solo', async () => {
    const id = await servicioNuevo('CONTRATO REEMPLAZADO');
    assert.equal((await subirContrato(juridico, id, { nombre: 'viejo.pdf' })).status, 201);
    const primero = (await admin.pedir(`/api/servicios/${id}`)).json.servicio.contrato_archivo;

    assert.equal((await subirContrato(juridico, id, { nombre: 'nuevo.pdf' })).status, 201);
    const ficha = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(ficha.contrato_archivo_nombre, 'nuevo.pdf');
    assert.notEqual(ficha.contrato_archivo, primero);
  });
});

describe('quién toca el contrato', () => {
  test('verlo es de todos: operaciones también abre el papel', async () => {
    const id = await servicioNuevo('CONTRATO LO VE OPERACIONES');
    assert.equal((await subirContrato(juridico, id)).status, 201);
    const r = await fetch(`${app.base}/api/servicios/${id}/contrato`, { headers: { cookie: operaciones.cookie } });
    assert.equal(r.status, 200);
  });

  test('subirlo no: eso es de jurídico y del administrador', async () => {
    const id = await servicioNuevo('CONTRATO NO LO SUBE OPERACIONES');
    const r = await subirContrato(operaciones, id);
    assert.equal(r.status, 403);
    assert.equal((await admin.pedir(`/api/servicios/${id}`)).json.servicio.contrato_archivo, null);
  });

  test('finanzas tampoco', async () => {
    const id = await servicioNuevo('CONTRATO NO LO SUBE FINANZAS');
    assert.equal((await subirContrato(finanzas, id)).status, 403);
  });

  test('un archivo que no es PDF no entra', async () => {
    const id = await servicioNuevo('CONTRATO NO PDF');
    const r = await subirContrato(juridico, id, {
      datos: Buffer.from('<html>esto no es un contrato</html>'),
      nombre: 'trampa.html',
      tipo: 'text/html',
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /PDF/i);
  });

  test('sin sesión no se baja el contrato de nadie', async () => {
    const id = await servicioNuevo('CONTRATO PRIVADO');
    assert.equal((await subirContrato(juridico, id)).status, 201);
    const r = await app.anonimo().pedir(`/api/servicios/${id}/contrato`);
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });
});

describe('la factura deja de ser una palomita', () => {
  test('sin factura del mes, lo dice y ofrece el camino', async () => {
    await servicioNuevo('FACTURA NINGUNA');
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=FACTURA NINGUNA')).texto);
    assert.match(html, /Sin factura/);
  });

  test('emitida en la plataforma, sale su folio fiscal', async () => {
    const id = await servicioNuevo('FACTURA CON FOLIO');
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const factura = await finanzas.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id,
        periodo: hoy.slice(0, 7),
        fecha_factura: hoy,
        importe: 12345,
        folio: 'CG99001',
      }),
    });
    assert.equal(factura.status, 201, factura.texto);

    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=FACTURA CON FOLIO')).texto);
    assert.match(html, /CG99001/);
    assert.match(html, /falta el PDF/, 'todavía no se le ha subido el archivo');
  });

  test('con el PDF subido, el folio es el botón que lo abre', async () => {
    const id = await servicioNuevo('FACTURA CON PDF');
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const factura = await finanzas.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id,
        periodo: hoy.slice(0, 7),
        fecha_factura: hoy,
        importe: 5000,
        folio: 'CG99002',
      }),
    });
    assert.equal(factura.status, 201, factura.texto);

    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([PDF], { type: 'application/pdf' }), 'cfdi.pdf');
    const subida = await fetch(`${app.base}/api/facturas/${factura.json.id}/archivo`, {
      method: 'POST',
      headers: { cookie: finanzas.cookie },
      body: cuerpo,
    });
    assert.ok(subida.ok, await subida.text());

    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=FACTURA CON PDF')).texto);
    assert.match(html, /CG99002/);
    assert.match(html, new RegExp(`/api/facturas/${factura.json.id}/archivo`));
  });

  test('el número anotado en los cortes viejos también se enseña', async () => {
    // 6,148 renglones del archivo traen su número de factura. No tienen PDF,
    // pero saber con qué número se cobró vale más que un hueco.
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, /del corte 20\d\d-\d\d/, 'debería salir al menos un número del histórico');
  });

  test('en un corte cerrado sale el número que ese mes tenía', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?periodo=2026-07')).texto);
    assert.match(html, /CG\d+/, 'los números del corte de julio');
    assert.match(html, /del corte 2026-07/);
  });
});
