/**
 * Suspender un servicio: sigue existiendo, deja de contar.
 *
 * Faltaba una respuesta. El cliente para el servicio —una obra detenida, una
 * temporada baja, un contrato en renegociación— y va a volver. Cancelar sería
 * mentir: diría que se fue, y saldría en las gráficas de bajas del mes, en el
 * neto contra las aperturas y en el reporte de motivos. Dejarlo activo también
 * miente, porque sumaría guardias que hoy no están en la calle.
 *
 * Lo que se prueba aquí es sobre todo que la pausa sea de verdad: que el
 * servicio desaparezca de TODAS las cuentas a la vez —estado de fuerza,
 * facturación, revisión de precios— y no de unas sí y otras no, que sería peor
 * que no tener la función.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let operaciones;
let juridico;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
const activos = async () => (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
const kpis = async () => {
  const html = comoSeLee((await admin.pedir('/')).texto);
  const m = html.match(/Servicios activos<\/p><p[^>]*>([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

async function servicio(nombre, guardias = 4) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': guardias } }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

const suspender = (cliente, id, motivo = 'El cliente paró la obra dos meses') =>
  cliente.pedir(`/api/servicios/${id}/suspension`, { method: 'POST', body: JSON.stringify({ motivo }) });

const reactivar = (cliente, id) =>
  cliente.pedir(`/api/servicios/${id}/suspension`, { method: 'DELETE', body: JSON.stringify({}) });

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  juridico = await app.entrarYAsentar(ROLES.juridico);
});

after(async () => {
  await app?.cerrar();
});

describe('la pausa saca al servicio de las cuentas', () => {
  test('deja de contar en el estado de fuerza sin darse de baja', async () => {
    const id = await servicio('SUSPENDER BASICO', 6);
    const antes = await activos();
    const antesKpi = await kpis();

    const r = await suspender(admin, id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.guardias, 6);

    const s = await ficha(id);
    assert.equal(s.estatus, 'SUSPENDIDO');
    assert.equal(s.suspendido_desde, HOY);
    assert.match(s.suspendido_motivo, /paró la obra/);
    // La plantilla se conserva: es lo que vuelve cuando el cliente regresa.
    assert.equal(s.total_guardias, 6);
    assert.deepEqual(s.turnos, { '24 HRS': 6 });

    const despues = await activos();
    assert.equal(despues.length, antes.length - 1);
    assert.equal(despues.some((x) => x.id === id), false);
    assert.equal(await kpis(), antesKpi - 1, 'el tablero también deja de contarlo');
  });

  test('no aparece como baja del mes: eso es lo que lo distingue de cancelar', async () => {
    const id = await servicio('SUSPENDER SIN BAJA');
    const antes = (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length;

    await suspender(admin, id);

    const despues = (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length;
    assert.equal(despues, antes, 'no se registró ninguna cancelación');
    assert.notEqual((await ficha(id)).estatus, 'BAJA');
  });

  test('deja de proponerse para facturar', async () => {
    const id = await servicio('SUSPENDER Y COBRANZA');
    await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 30000, esquema_facturacion: 'MES_VENCIDO', dias_credito: 30 }),
    });

    const antes = comoSeLee((await admin.pedir('/cobranza')).texto);
    assert.match(antes, /SUSPENDER Y COBRANZA/, 'estando activo sí se le propone facturar');

    await suspender(admin, id);

    const despues = comoSeLee((await admin.pedir('/cobranza')).texto);
    assert.doesNotMatch(despues, /SUSPENDER Y COBRANZA/, 'suspendido ya no');
  });

  test('deja de entrar a la revisión anual de precios', async () => {
    const id = await servicio('SUSPENDER Y PRECIOS');
    await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 25000 }),
    });
    assert.ok(
      (await admin.pedir('/api/precios')).json.servicios.some((x) => x.id === id),
      'estando activo sí le toca revisión'
    );

    await suspender(admin, id);
    assert.equal(
      (await admin.pedir('/api/precios')).json.servicios.some((x) => x.id === id),
      false,
      'suspendido no'
    );
  });

  test('sigue existiendo y se puede consultar entero', async () => {
    const id = await servicio('SUSPENDER PERO EXISTE');
    await suspender(admin, id);

    const r = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.servicio.servicio, 'SUSPENDER PERO EXISTE');

    const lista = (await admin.pedir('/api/servicios?estatus=SUSPENDIDO')).json.servicios;
    assert.ok(lista.some((x) => x.id === id), 'tiene su propia lista');
  });
});

describe('volver a la operación', () => {
  test('reactivar lo devuelve con la plantilla que tenía', async () => {
    const id = await servicio('SUSPENDER Y VOLVER', 7);
    await suspender(admin, id);
    const antes = (await activos()).length;

    const r = await reactivar(admin, id);
    assert.equal(r.status, 200, r.texto);

    const s = await ficha(id);
    assert.equal(s.estatus, 'ACTIVO');
    assert.equal(s.total_guardias, 7);
    assert.equal(s.suspendido_desde, null);
    assert.equal(s.suspendido_motivo, null);
    assert.equal((await activos()).length, antes + 1);
  });

  test('reactivar sin apertura no rompe la regla: el servicio nunca se fue', async () => {
    // La regla dice que un servicio entra al estado de fuerza solo por una
    // apertura. Un suspendido nunca salió: siguió existiendo todo el tiempo.
    const id = await servicio('SUSPENDER NO ES SALIR');
    const aperturasAntes = (await admin.pedir('/api/aperturas')).json.aperturas.length;
    await suspender(admin, id);
    await reactivar(admin, id);
    assert.equal((await admin.pedir('/api/aperturas')).json.aperturas.length, aperturasAntes);
  });

  test('un servicio dado de baja no se reactiva por aquí', async () => {
    const id = await servicio('SUSPENDER TRAS BAJA');
    await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'El cliente terminó el contrato' }),
    });
    const r = await reactivar(admin, id);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /apertura/i, 'para volver a operarlo se registra una apertura');
  });
});

describe('lo que no se puede hacer con un suspendido', () => {
  test('suspenderlo dos veces', async () => {
    const id = await servicio('SUSPENDER DOS VECES');
    assert.equal((await suspender(admin, id)).status, 200);
    const r = await suspender(admin, id);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /ya está suspendido/i);
  });

  test('suspender uno que ya está de baja', async () => {
    const id = await servicio('SUSPENDER UNA BAJA');
    await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'Se terminó el servicio' }),
    });
    const r = await suspender(admin, id);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /baja/i);
  });

  test('ampliarlo mientras está en pausa', async () => {
    const id = await servicio('SUSPENDER Y AMPLIAR');
    await suspender(admin, id);
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, turnos: { '24 HRS': 2 } }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /suspendido/i);
    assert.match(r.json.error, /Reactívalo/);
  });

  test('aplicarle encima una apertura con su mismo nombre', async () => {
    // Si se pudiera, quedarían dos servicios con el mismo nombre y el día que
    // se reactivara el primero la plantilla estaría contada dos veces.
    const nombre = 'SUSPENDER Y DUPLICAR';
    const id = await servicio(nombre);
    await suspender(admin, id);

    // Una apertura anotada con ese mismo nombre, sin aplicar todavía.
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': 1 } }),
    });
    assert.equal(alta.status, 201);
    // La apertura normal creó su propio servicio; se deshace para dejarla
    // pendiente y poder probar el camino de «aplicar».
    const deshecha = await admin.pedir(`/api/aperturas/${alta.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Para probar el choque de nombres' }),
    });
    assert.equal(deshecha.status, 200, deshecha.texto);

    const r = await admin.pedir(`/api/aperturas/${alta.json.aperturaId}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /suspendido/i);
    assert.match(r.json.error, /Reactívalo/);

    // Y sigue habiendo uno solo con ese nombre.
    const todos = (await admin.pedir('/api/servicios')).json.servicios.filter((x) => x.servicio === nombre);
    assert.equal(todos.length, 1);
  });

  test('sin motivo no se suspende', async () => {
    const id = await servicio('SUSPENDER SIN MOTIVO');
    const r = await suspender(admin, id, '');
    assert.equal(r.status, 400);
    assert.match(r.json.error, /por qué/i);
    assert.equal((await ficha(id)).estatus, 'ACTIVO');
  });
});

describe('cancelar sigue siendo la salida cuando el cliente ya no vuelve', () => {
  test('un suspendido se puede cancelar de verdad', async () => {
    const id = await servicio('SUSPENDER Y LUEGO CANCELAR', 3);
    await suspender(admin, id);

    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'Al final el cliente no regresó' }),
    });
    assert.equal(r.status, 201, r.texto);

    const s = await ficha(id);
    assert.equal(s.estatus, 'BAJA');
    assert.equal(s.total_guardias, 0);
  });
});

describe('quién puede pausar', () => {
  test('operaciones puede: es quien sabe si el cliente paró', async () => {
    const id = await servicio('SUSPENDER LO HACE OPERACIONES');
    assert.equal((await suspender(operaciones, id)).status, 200);
    assert.equal((await reactivar(operaciones, id)).status, 200);
  });

  test('jurídico no mueve el estado de fuerza', async () => {
    const id = await servicio('SUSPENDER NO LO HACE JURIDICO');
    const r = await suspender(juridico, id);
    assert.equal(r.status, 403);
    assert.equal((await ficha(id)).estatus, 'ACTIVO');
  });

  test('sin sesión, nada', async () => {
    const r = await app.anonimo().pedir('/api/servicios/1/suspension', { method: 'POST' });
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });
});

describe('la pantalla', () => {
  test('la ficha ofrece pausar y explica en qué se diferencia de cancelar', async () => {
    const id = await servicio('SUSPENDER EN PANTALLA');
    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /Pausar el servicio/);
    assert.match(html, /sin registrar una baja/);
  });

  test('un suspendido lo dice en su ficha, con desde cuándo y por qué', async () => {
    const id = await servicio('SUSPENDER SE VE');
    await suspender(admin, id, 'Obra detenida por lluvias');
    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /Servicio suspendido/);
    assert.match(html, /Obra detenida por lluvias/);
    assert.match(html, /Reactivar el servicio/);
  });

  test('la lista los tiene en su propio filtro', async () => {
    const id = await servicio('SUSPENDER EN LA LISTA');
    await suspender(admin, id);
    const html = comoSeLee((await admin.pedir('/estado-fuerza?estatus=SUSPENDIDO')).texto);
    assert.match(html, /SUSPENDER EN LA LISTA/);
    assert.match(html, /SUSPENDIDO/);

    const activos = comoSeLee((await admin.pedir('/estado-fuerza?estatus=ACTIVO')).texto);
    assert.doesNotMatch(activos, /SUSPENDER EN LA LISTA/);
  });

  test('a jurídico no se le ofrece el botón', async () => {
    const id = await servicio('SUSPENDER JURIDICO NO VE BOTON');
    const html = comoSeLee((await juridico.pedir(`/estado-fuerza/${id}`)).texto);
    assert.doesNotMatch(html, /⏸ Suspender/);
  });
});
