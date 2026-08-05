/**
 * Deshacer y descartar aperturas, sin fabricar cancelaciones.
 *
 * La regla del negocio dice que un servicio sale del estado de fuerza solo por
 * una cancelación, y sigue siendo cierta. Lo que se agrega aquí es distinto:
 * una cancelación afirma que el cliente se fue —sale en las gráficas del mes,
 * en el neto y en el reporte de motivos—, y cuando una apertura se aplicó por
 * error, en la calle no se fue nadie. Registrar una baja sería meter en el
 * histórico un hecho que nunca ocurrió.
 *
 * Por eso deshacer solo alcanza a lo que todavía no ha trabajado. En cuanto el
 * servicio tiene una factura, un comentario o un cambio de precio, ya existió
 * para el resto de la operación y la única salida honesta es la cancelación.
 * Eso es lo que se prueba aquí, en las dos direcciones.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let ventas;
let juridico;

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const activos = async () => (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
const aperturas = async () => (await admin.pedir('/api/aperturas')).json.aperturas;
/** Todas las que la pantalla cuenta como pendientes, incrementos incluidos. */
const pendientesTodas = async () => (await aperturas()).filter((a) => !a.servicio_id && !a.descartada);
/** Las que se pueden aplicar de una: un incremento necesita servicio destino. */
const pendientes = async () => (await pendientesTodas()).filter((a) => a.tipo !== 'INCREMENTO');

async function abrir(nombre, extra = {}) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': 2 }, ...extra }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json;
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
});

after(async () => {
  await app?.cerrar();
});

describe('deshacer una apertura aplicada', () => {
  test('el servicio sale del estado de fuerza y la apertura vuelve a pendiente', async () => {
    const { aperturaId, servicioId } = await abrir('DESHACER LIMPIO');
    const antes = (await activos()).length;

    const r = await admin.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Se capturó con el cliente equivocado' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.servicioBorrado, true);

    assert.equal((await activos()).length, antes - 1);
    assert.equal((await admin.pedir(`/api/servicios/${servicioId}`)).status, 404);

    const ap = (await aperturas()).find((a) => a.id === aperturaId);
    assert.equal(ap.servicio_id, null, 'la apertura sigue anotada, ahora sin servicio');
    assert.equal(ap.folio, r.json.folio);
  });

  test('NO deja una cancelación inventada en el histórico', async () => {
    // Es la razón de existir de todo esto: una baja falsa contaminaría el mes.
    const { aperturaId } = await abrir('DESHACER SIN CANCELACION');
    const antes = (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length;

    await admin.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Aplicada por error' }),
    });

    const despues = (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length;
    assert.equal(despues, antes, 'no se registró ninguna cancelación');
  });

  test('deshacer una ampliación devuelve solo los guardias que sumó', async () => {
    const alta = await abrir('DESHACER AMPLIACION');
    const inc = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: alta.servicioId, turnos: { '24 HRS': 3 } }),
    });
    assert.equal(inc.status, 201, inc.texto);
    assert.equal((await admin.pedir(`/api/servicios/${alta.servicioId}`)).json.servicio.total_guardias, 5);

    const r = await admin.pedir(`/api/aperturas/${inc.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'La ampliación no se autorizó' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.servicioBorrado, false, 'el servicio original se queda');

    const s = (await admin.pedir(`/api/servicios/${alta.servicioId}`)).json.servicio;
    assert.equal(s.total_guardias, 2);
    assert.deepEqual(s.turnos, { '24 HRS': 2 });
    assert.equal(s.estatus, 'ACTIVO');
  });

  test('sin motivo no se deshace', async () => {
    const { aperturaId, servicioId } = await abrir('DESHACER SIN MOTIVO');
    const r = await admin.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: '' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /por qué/i);
    assert.equal((await admin.pedir(`/api/servicios/${servicioId}`)).status, 200);
  });

  test('una apertura que no está aplicada no tiene nada que deshacer', async () => {
    const ap = (await pendientes())[0];
    const r = await admin.pedir(`/api/aperturas/${ap.id}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'lo que sea' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no está aplicada/i);
  });
});

describe('lo que ya trabajó se cancela, no se deshace', () => {
  test('un servicio con factura no se puede deshacer', async () => {
    const { aperturaId, servicioId } = await abrir('DESHACER CON FACTURA');
    const f = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: servicioId,
        periodo: HOY.slice(0, 7),
        fecha_factura: HOY,
        importe: 10000,
      }),
    });
    assert.equal(f.status, 201, f.texto);

    const r = await admin.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'quiero borrarlo' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /facturas/i);
    assert.match(r.json.error, /cancelación/i, 'el error dice cuál es la salida correcta');
    assert.equal((await admin.pedir(`/api/servicios/${servicioId}`)).json.servicio.estatus, 'ACTIVO');
  });

  test('un servicio con comentarios tampoco', async () => {
    const { aperturaId, servicioId } = await abrir('DESHACER CON COMENTARIO');
    const c = await admin.pedir(`/api/servicios/${servicioId}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto: 'El cliente pidió cambio de horario' }),
    });
    assert.equal(c.status, 201, c.texto);

    const r = await admin.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'quiero borrarlo' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /comentarios/i);
  });

  test('un servicio al que ya se le movió el precio tampoco', async () => {
    const { aperturaId, servicioId } = await abrir('DESHACER CON PRECIO');
    await admin.pedir(`/api/servicios/${servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 20000 }),
    });
    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({
        ids: [servicioId],
        ajuste: { tipo: 'PORCENTAJE', valor: 5 },
        vigencia: '2026-09',
        motivo: 'Revisión anual',
      }),
    });

    const r = await admin.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'quiero borrarlo' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /precio/i);
  });

  test('la cancelación de verdad sigue funcionando igual', async () => {
    const { servicioId } = await abrir('SE VA DE VERDAD');
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: servicioId, motivo: 'El cliente terminó el contrato' }),
    });
    assert.equal(r.status, 201, r.texto);
    const s = (await admin.pedir(`/api/servicios/${servicioId}`)).json.servicio;
    assert.equal(s.estatus, 'BAJA');
    assert.equal(s.total_guardias, 0);
  });
});

describe('descartar una apertura que no se va a aplicar', () => {
  test('sale de la cuenta de pendientes sin borrarse del histórico', async () => {
    const ap = (await pendientes())[0];
    const antes = (await pendientes()).length;

    const r = await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'El servicio dejó de operar hace dos años' }),
    });
    assert.equal(r.status, 200, r.texto);

    assert.equal((await pendientes()).length, antes - 1);
    const guardada = (await aperturas()).find((a) => a.id === ap.id);
    assert.ok(guardada, 'la apertura sigue en el histórico');
    assert.equal(guardada.descartada, 1);
    assert.match(guardada.descartada_motivo, /dejó de operar/);
  });

  test('se puede devolver a la cola', async () => {
    const ap = (await pendientes())[0];
    await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Por revisar más adelante' }),
    });
    const r = await admin.pedir(`/api/aperturas/${ap.id}/descartar`, { method: 'DELETE' });
    assert.equal(r.status, 200, r.texto);

    const vuelta = (await aperturas()).find((a) => a.id === ap.id);
    assert.equal(vuelta.descartada, 0);
    assert.equal(vuelta.descartada_motivo, null);
  });

  test('una descartada no se aplica por accidente', async () => {
    const ap = (await pendientes())[0];
    await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'No se va a aplicar nunca' }),
    });
    const r = await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /descartada/i);
  });

  test('sin motivo no se descarta', async () => {
    const ap = (await pendientes())[0];
    const r = await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: '' }),
    });
    assert.equal(r.status, 400);
  });

  test('una apertura aplicada no se descarta: primero se deshace', async () => {
    const { aperturaId } = await abrir('DESCARTAR APLICADA');
    const r = await admin.pedir(`/api/aperturas/${aperturaId}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'ya no la quiero' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Deshazla primero/i);
  });
});

describe('quién puede', () => {
  test('ventas puede deshacer lo que ventas puede aplicar', async () => {
    const alta = await ventas.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'VENTAS DESHACE', turnos: { '24 HRS': 1 } }),
    });
    assert.equal(alta.status, 201, alta.texto);
    const r = await ventas.pedir(`/api/aperturas/${alta.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Me equivoqué de cliente' }),
    });
    assert.equal(r.status, 200, r.texto);
  });

  test('jurídico no mueve el estado de fuerza por esta puerta tampoco', async () => {
    const { aperturaId, servicioId } = await abrir('JURIDICO NO DESHACE');
    const r = await juridico.pedir(`/api/aperturas/${aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'lo que sea' }),
    });
    assert.equal(r.status, 403);
    assert.equal((await admin.pedir(`/api/servicios/${servicioId}`)).status, 200);
  });

  test('sin sesión, nada', async () => {
    const r = await app.anonimo().pedir('/api/aperturas/1/deshacer', { method: 'POST' });
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });
});

describe('la pantalla', () => {
  test('ofrece los tres botones según en qué estado esté la apertura', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas?pendientes=1')).texto);
    assert.match(html, /Aplicar/);
    assert.match(html, /Descartar/);

    const delMes = comoSeLee((await admin.pedir('/aperturas')).texto);
    assert.match(delMes, /Deshacer/, 'las aplicadas del mes traen el botón de deshacer');
  });

  test('las descartadas tienen su propia vista y se pueden devolver', async () => {
    const r = await admin.pedir('/aperturas?descartadas=1');
    assert.equal(r.status, 200);
    assert.match(comoSeLee(r.texto), /Devolver a pendientes/);
  });

  test('el aviso de pendientes baja al descartar una', async () => {
    // Se lee del propio aviso: la API de aperturas viene con tope, así que
    // contar desde ahí daría una cifra distinta por una razón que no es esta.
    const cuenta = async () => {
      const html = comoSeLee((await admin.pedir('/aperturas')).texto);
      const m = html.match(/([\d,]+) aperturas? sin aplicar/);
      assert.ok(m, 'el aviso debería estar en la pantalla');
      return Number(m[1].replace(/,/g, ''));
    };

    const antes = await cuenta();
    const ap = (await pendientes())[0];
    const r = await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Servicio que ya no existe' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(await cuenta(), antes - 1);
  });

  test('a jurídico se le enseña el estado, no los botones', async () => {
    const html = comoSeLee((await juridico.pedir('/aperturas?pendientes=1')).texto);
    assert.match(html, /Sin aplicar/);
    assert.doesNotMatch(html, /↩ Deshacer/);
  });
});
