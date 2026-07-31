/**
 * La regla que sostiene la plataforma:
 * un servicio solo entra con una APERTURA y solo sale con una CANCELACIÓN.
 *
 * Si alguna de estas pruebas falla, alguien abrió una puerta trasera al estado
 * de fuerza y las cifras dejan de cuadrar con las hojas de la operación.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let srv;
let admin;

before(async () => {
  srv = await arrancar();
  admin = await srv.entrar(ROLES.admin);
});
after(async () => srv?.cerrar());

describe('no hay alta ni baja directa de servicios', () => {
  test('POST /api/servicios responde 405 y dice por dónde', async () => {
    const r = await admin.pedir('/api/servicios', {
      method: 'POST',
      body: JSON.stringify({ servicio: 'PUERTA TRASERA', total_guardias: 5 }),
    });
    assert.equal(r.status, 405);
    assert.match(r.json.error, /apertura/i);
  });

  test('DELETE /api/servicios/:id responde 405 y dice por dónde', async () => {
    const r = await admin.pedir('/api/servicios/1', { method: 'DELETE' });
    assert.equal(r.status, 405);
    assert.match(r.json.error, /cancelaci/i);
  });

  test('ni el admin puede mover estatus, nombre o total de guardias por PATCH', async () => {
    const r = await admin.pedir('/api/servicios/1', {
      method: 'PATCH',
      body: JSON.stringify({ estatus: 'BAJA', servicio: 'OTRO', total_guardias: 999 }),
    });
    assert.equal(r.status, 403, 'sin un solo campo aplicable la petición no procede');
    assert.match(r.json.error, /estatus/);
    assert.match(r.json.error, /total_guardias/);

    const s = await admin.pedir('/api/servicios/1');
    assert.equal(s.json.servicio.estatus, 'ACTIVO', 'el servicio no debió cambiar');
  });
});

describe('ciclo de vida completo de un servicio', () => {
  let id;

  test('una apertura crea el servicio', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio: 'PRUEBA CICLO DE VIDA',
        tipo: 'APERTURA',
        fecha: '2026-07-15',
        turnos: { '24X24': 6, '12X12 L-D': 4 },
      }),
    });
    assert.equal(r.status, 201);
    id = r.json.servicioId;
    assert.ok(id, 'la apertura devuelve el id del servicio creado');

    const s = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(s.json.servicio.estatus, 'ACTIVO');
    assert.equal(s.json.servicio.total_guardias, 10, 'la suma de turnos manda');
  });

  test('un incremento suma guardias al mismo servicio', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, turnos: { '24X24': 3 } }),
    });
    assert.equal(r.status, 201);
    const s = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(s.json.servicio.total_guardias, 13);
  });

  test('una reducción resta guardias y el servicio sigue activo', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, turnos: { '24X24': 4 }, motivo: 'AJUSTE OPERATIVO' }),
    });
    assert.equal(r.status, 201);
    const s = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(s.json.servicio.estatus, 'ACTIVO');
    assert.equal(s.json.servicio.total_guardias, 9);
  });

  test('una reducción que se lleva todo se rechaza pidiendo cancelación', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'REDUCCION',
        servicio_id: id,
        turnos: { '24X24': 5, '12X12 L-D': 4 },
        motivo: 'AJUSTE OPERATIVO',
      }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /cancelaci/i);
  });

  test('un movimiento parcial sin desglose se rechaza si el servicio lo tiene', async () => {
    // Si pasara, el total bajaría y el desglose se quedaría igual: los dos
    // dirían cosas distintas y la siguiente disminución trabajaría con basura.
    const reducir = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, guardias: 2, motivo: 'AJUSTE OPERATIVO' }),
    });
    assert.equal(reducir.status, 400);
    assert.match(reducir.json.error, /desglose/i);

    const ampliar = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, guardias: 2 }),
    });
    assert.equal(ampliar.status, 400);
    assert.match(ampliar.json.error, /desglose/i);

    const s = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(s.json.servicio.total_guardias, 9, 'nada se movió');
  });

  test('la cancelación saca el servicio del estado de fuerza', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'FIN DE CONTRATO' }),
    });
    assert.equal(r.status, 201);
    const s = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(s.json.servicio.estatus, 'BAJA');
    assert.equal(s.json.servicio.total_guardias, 0);
  });

  test('no se cancela dos veces ni se incrementa una baja', async () => {
    const recancelar = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'FIN DE CONTRATO' }),
    });
    assert.equal(recancelar.status, 400);
    assert.match(recancelar.json.error, /ya está dado de baja/i);

    const incrementar = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, guardias: 2 }),
    });
    assert.equal(incrementar.status, 400);
  });
});

describe('validaciones de captura', () => {
  test('una apertura sin nombre no procede', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', guardias: 3 }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /nombre/i);
  });

  test('una apertura sin guardias no procede', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'SIN GENTE' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /guardia/i);
  });

  test('no se cancela un servicio que no existe', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: 999999, motivo: 'FIN DE CONTRATO' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no existe/i);
  });
});
