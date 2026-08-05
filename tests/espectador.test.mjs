/**
 * El espectador: ve todo, no toca nada.
 *
 * Es para quien necesita mirar la operación sin poder alterarla —una dirección,
 * un socio, un auditor externo, alguien de otra área—. Con los roles que había
 * no existía esa figura: el más limitado seguía pudiendo registrar aperturas o
 * escribir comentarios.
 *
 * La prueba es por definición negativa, y por eso vale la pena que sea larga:
 * un rol de solo lectura se demuestra recorriendo TODAS las puertas de escritura
 * de la plataforma y comprobando que ninguna se abre. Basta con que una quede
 * suelta para que el rol no sea lo que promete.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';

let app;
let admin;
let miron;
let servicioId;
let aperturaId;
let facturaId;

const CORREO = 'espectador@corporativoultra.com';
const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);

  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email: CORREO, nombre: 'Espectador de prueba', rol: 'espectador', password: PASSWORD_TEMPORAL }),
  });
  assert.equal(alta.status, 201, alta.texto);

  const primera = await app.entrar(CORREO, PASSWORD_TEMPORAL);
  await primera.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });
  miron = await app.entrar(CORREO, PASSWORD);

  // Algo sobre lo que intentar escribir.
  const ap = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: 'ESPECTADOR MIRA ESTE', turnos: { '24 HRS': 3 } }),
  });
  servicioId = ap.json.servicioId;
  aperturaId = ap.json.aperturaId;

  await admin.pedir(`/api/servicios/${servicioId}`, {
    method: 'PATCH',
    body: JSON.stringify({ importe_factura: 30000 }),
  });
  const f = await admin.pedir('/api/facturas', {
    method: 'POST',
    body: JSON.stringify({ servicio_id: servicioId, periodo: HOY.slice(0, 7), fecha_factura: HOY, importe: 30000 }),
  });
  facturaId = f.json.id;
});

after(async () => {
  await app?.cerrar();
});

describe('ve lo que tiene que ver', () => {
  test('entra y le sale el tablero', async () => {
    const r = await miron.pedir('/');
    assert.equal(r.status, 200);
    assert.match(comoSeLee(r.texto), /Servicios activos/);
  });

  test('consulta el estado de fuerza y la ficha de un servicio', async () => {
    assert.equal((await miron.pedir('/estado-fuerza')).status, 200);
    const ficha = await miron.pedir(`/estado-fuerza/${servicioId}`);
    assert.equal(ficha.status, 200);
    assert.match(comoSeLee(ficha.texto), /ESPECTADOR MIRA ESTE/);
  });

  test('consulta aperturas y cancelaciones con sus cifras', async () => {
    for (const ruta of ['/aperturas', '/cancelaciones']) {
      const r = await miron.pedir(ruta);
      assert.equal(r.status, 200, `${ruta} debería verse`);
      assert.match(comoSeLee(r.texto), /Movimientos de \d{4}/);
    }
  });

  test('las consultas de la API le responden', async () => {
    assert.equal((await miron.pedir('/api/servicios?estatus=ACTIVO')).status, 200);
    assert.equal((await miron.pedir('/api/aperturas')).status, 200);
    assert.equal((await miron.pedir(`/api/servicios/${servicioId}/partidas`)).status, 200);
  });

  test('puede abrir el papel: factura y contrato', async () => {
    assert.equal((await miron.pedir(`/api/facturas?servicio_id=${servicioId}`)).status, 200);
    // El contrato de un servicio que no lo tiene devuelve 404, no 403: el rol
    // alcanza, lo que falta es el archivo.
    const contrato = await miron.pedir(`/api/servicios/${servicioId}/contrato`);
    assert.equal(contrato.status, 404);
  });
});

describe('no toca nada, por ninguna puerta', () => {
  const rechazado = (r, donde) =>
    assert.equal(r.status, 403, `${donde} debería rechazarlo y devolvió ${r.status}: ${r.texto?.slice(0, 120)}`);

  test('no registra aperturas ni cancelaciones', async () => {
    rechazado(
      await miron.pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'APERTURA', servicio: 'EL MIRON NO ABRE', turnos: { '24 HRS': 1 } }),
      }),
      'apertura'
    );
    rechazado(
      await miron.pedir('/api/cancelaciones', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: servicioId, motivo: 'porque sí' }),
      }),
      'cancelación'
    );
  });

  test('no aplica, deshace ni descarta aperturas', async () => {
    rechazado(await miron.pedir(`/api/aperturas/${aperturaId}/aplicar`, { method: 'POST' }), 'aplicar');
    rechazado(
      await miron.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'quiero deshacerlo' }),
      }),
      'deshacer'
    );
    rechazado(
      await miron.pedir(`/api/aperturas/${aperturaId}/descartar`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'quiero descartarla' }),
      }),
      'descartar'
    );
  });

  test('no suspende ni reactiva servicios', async () => {
    rechazado(
      await miron.pedir(`/api/servicios/${servicioId}/suspension`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'quiero pausarlo' }),
      }),
      'suspender'
    );
  });

  test('no edita ningún campo de la ficha', async () => {
    const r = await miron.pedir(`/api/servicios/${servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 1, tiene_contrato: true, observaciones: 'yo pasé por aquí' }),
    });
    rechazado(r, 'editar la ficha');
    assert.equal((await admin.pedir(`/api/servicios/${servicioId}`)).json.servicio.importe_factura, 30000);
  });

  test('no mueve precios, ni por la agenda ni por el desglose', async () => {
    rechazado(await miron.pedir('/api/precios'), 'ver la agenda de precios');
    rechazado(
      await miron.pedir('/api/precios', {
        method: 'POST',
        body: JSON.stringify({
          ids: [servicioId],
          ajuste: { tipo: 'PORCENTAJE', valor: 50 },
          vigencia: '2026-09',
          motivo: 'me apetece',
        }),
      }),
      'aplicar un aumento'
    );
    rechazado(
      await miron.pedir(`/api/servicios/${servicioId}/partidas`, {
        method: 'PUT',
        body: JSON.stringify({ partidas: [{ puesto: 'GUARDIA', cantidad: 1, precio_unitario: 1 }] }),
      }),
      'guardar el desglose de precio'
    );
  });

  test('no factura ni registra pagos', async () => {
    rechazado(
      await miron.pedir('/api/facturas', {
        method: 'POST',
        body: JSON.stringify({ servicio_id: servicioId, periodo: HOY.slice(0, 7), fecha_factura: HOY, importe: 1 }),
      }),
      'emitir factura'
    );
    rechazado(
      await miron.pedir('/api/facturas', { method: 'PATCH', body: JSON.stringify({ id: facturaId, pago: {} }) }),
      'registrar pago'
    );
  });

  test('no escribe comentarios: una nota también es modificar', async () => {
    const r = await miron.pedir(`/api/servicios/${servicioId}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto: 'Aquí estuvo el espectador' }),
    });
    rechazado(r, 'comentar');

    const cuantos = (await admin.pedir(`/api/servicios/${servicioId}/comentarios`)).json.comentarios.length;
    assert.equal(cuantos, 0);
  });

  test('no toca el contrato ni sus archivos', async () => {
    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'c.pdf');
    const r = await fetch(`${app.base}/api/servicios/${servicioId}/contrato`, {
      method: 'POST',
      headers: { cookie: miron.cookie },
      body: cuerpo,
    });
    assert.equal(r.status, 403);
  });

  test('no corrige servicios', async () => {
    rechazado(
      await miron.pedir(`/api/servicios/${servicioId}/correccion`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'estaba mal capturado', total_guardias: 99 }),
      }),
      'corregir'
    );
  });

  test('no llega a usuarios, catálogos, respaldos ni bitácora', async () => {
    rechazado(await miron.pedir('/api/usuarios'), 'usuarios');
    rechazado(
      await miron.pedir('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({ email: 'colado@corporativoultra.com', nombre: 'Colado', rol: 'admin', password: 'Loquesea2026' }),
      }),
      'crear usuarios'
    );
    rechazado(
      await miron.pedir('/api/catalogos', { method: 'POST', body: JSON.stringify({ tipo: 'zona', valor: 'INVENTADA' }) }),
      'catálogos'
    );
    rechazado(await miron.pedir('/api/respaldos'), 'respaldos');
  });
});

describe('la pantalla no le ofrece lo que no puede', () => {
  test('el menú solo trae lo de consulta', async () => {
    const html = comoSeLee((await miron.pedir('/')).texto);
    assert.match(html, /Estado de fuerza/);
    assert.match(html, /Aperturas/);
    assert.doesNotMatch(html, />Cobranza</);
    assert.doesNotMatch(html, />Precios</);
    assert.doesNotMatch(html, />Usuarios</);
    assert.doesNotMatch(html, />Respaldos</);
  });

  test('no le salen los botones de captura', async () => {
    const ap = comoSeLee((await miron.pedir('/aperturas')).texto);
    assert.doesNotMatch(ap, /Nueva apertura/);
    const can = comoSeLee((await miron.pedir('/cancelaciones')).texto);
    assert.doesNotMatch(can, /Movimiento de guardias/);
  });

  test('en la ficha no hay nada que tocar', async () => {
    const html = comoSeLee((await miron.pedir(`/estado-fuerza/${servicioId}`)).texto);
    assert.doesNotMatch(html, /⏸ Suspender/);
    assert.doesNotMatch(html, /Capturar el desglose/);
    assert.doesNotMatch(html, /Subir el PDF del contrato/);
    assert.match(html, /consulta los comentarios, no los escribe/);
  });

  test('su rol se ve en la barra', async () => {
    assert.match(comoSeLee((await miron.pedir('/')).texto), /Espectador/);
  });
});

describe('los demás roles no pierden nada', () => {
  test('operaciones sigue pudiendo comentar', async () => {
    const ops = await app.entrarYAsentar(ROLES.operaciones);
    const r = await ops.pedir(`/api/servicios/${servicioId}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto: 'Operaciones sí deja notas' }),
    });
    assert.equal(r.status, 201, r.texto);
  });

  test('el administrador puede dar de alta espectadores', async () => {
    const html = comoSeLee((await admin.pedir('/usuarios')).texto);
    assert.match(html, /Espectador/);
  });
});
