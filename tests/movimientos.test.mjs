/**
 * Los tres movimientos que cambian el número de guardias de un servicio:
 * ampliación, disminución y cancelación total.
 *
 * La ampliación y la disminución existían por separado —una vivía en aperturas
 * y otra en cancelaciones—, y aquí se comprueba que ambas mueven la cifra del
 * servicio de verdad, que respetan el desglose por turno y que los roles que
 * operan pueden usarlas.
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

async function abrir(nombre, cuerpo = {}) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ servicio: nombre, tipo: 'APERTURA', fecha: '2026-07-10', ...cuerpo }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.servicioId;
}

const guardiasDe = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio.total_guardias;
const turnosDe = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio.turnos;

describe('servicio con desglose por turno', () => {
  let id;

  before(async () => {
    id = await abrir('MOVIMIENTOS CON TURNOS', { turnos: { '24X24': 6, '12X12 L-D': 4 } });
  });

  test('la ampliación sube los guardias y el turno que toca', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, turnos: { '24X24': 3 } }),
    });
    assert.equal(r.status, 201);
    assert.equal(await guardiasDe(id), 13);
    assert.deepEqual(await turnosDe(id), { '24X24': 9, '12X12 L-D': 4 });
  });

  test('la ampliación puede estrenar un turno que el servicio no tenía', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, turnos: { '8X16 L-S': 2 } }),
    });
    assert.equal(r.status, 201);
    assert.equal(await guardiasDe(id), 15);
    assert.equal((await turnosDe(id))['8X16 L-S'], 2);
  });

  test('la disminución baja los guardias y deja el servicio activo', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'REDUCCION',
        servicio_id: id,
        turnos: { '24X24': 4 },
        motivo: 'REDUCCIÓN DE PLANTILLA',
      }),
    });
    assert.equal(r.status, 201);
    const s = await admin.pedir(`/api/servicios/${id}`);
    assert.equal(s.json.servicio.estatus, 'ACTIVO');
    assert.equal(s.json.servicio.total_guardias, 11);
    assert.equal(s.json.servicio.turnos['24X24'], 5);
  });

  test('la disminución que vacía un turno lo quita del desglose', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'REDUCCION',
        servicio_id: id,
        turnos: { '8X16 L-S': 2 },
        motivo: 'FIN DE SERVICIO',
      }),
    });
    assert.equal(r.status, 201);
    const turnos = await turnosDe(id);
    assert.ok(!('8X16 L-S' in turnos), 'un turno en cero no se queda colgando');
    assert.equal(await guardiasDe(id), 9);
  });

  test('el total y la suma del desglose nunca se separan', async () => {
    const s = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    const suma = Object.values(s.turnos).reduce((a, b) => a + b, 0);
    assert.equal(suma, s.total_guardias);
  });

  test('la disminución exige motivo', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, turnos: { '24X24': 1 } }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /motivo/i);
  });
});

describe('servicio sin desglose por turno', () => {
  let id;

  before(async () => {
    id = await abrir('MOVIMIENTOS SIN TURNOS', { guardias: 10 });
  });

  test('nace con el total capturado y sin desglose', async () => {
    assert.equal(await guardiasDe(id), 10);
    assert.deepEqual(await turnosDe(id), {});
  });

  test('se amplía con la cantidad a secas', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, guardias: 5 }),
    });
    assert.equal(r.status, 201);
    assert.equal(await guardiasDe(id), 15);
  });

  test('se disminuye con la cantidad a secas', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, guardias: 6, motivo: 'REDUCCIÓN DE PLANTILLA' }),
    });
    assert.equal(r.status, 201);
    assert.equal(await guardiasDe(id), 9);
  });

  test('la disminución no puede dejarlo en cero', async () => {
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, guardias: 9, motivo: 'CIERRE DE SERVICIO' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /cancelaci/i);
    assert.equal(await guardiasDe(id), 9, 'el servicio quedó como estaba');
  });
});

describe('quién puede mover guardias', () => {
  for (const rol of ['operaciones', 'ventas']) {
    test(`${rol} amplía y disminuye`, async () => {
      const sesion = await srv.entrarYAsentar(ROLES[rol]);
      const abre = await sesion.pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({ servicio: `MOVIMIENTO DE ${rol}`, guardias: 8, fecha: '2026-07-12' }),
      });
      assert.equal(abre.status, 201);
      const id = abre.json.servicioId;

      const amplia = await sesion.pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, guardias: 4 }),
      });
      assert.equal(amplia.status, 201);

      const baja = await sesion.pedir('/api/cancelaciones', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, guardias: 3, motivo: 'FALTA DE COBERTURA' }),
      });
      assert.equal(baja.status, 201);
      assert.equal(await guardiasDe(id), 9);
    });
  }

  for (const rol of ['juridico', 'finanzas']) {
    test(`${rol} no mueve el número de guardias`, async () => {
      const sesion = await srv.entrarYAsentar(ROLES[rol]);
      const id = await abrir(`INTOCABLE PARA ${rol}`, { guardias: 5 });

      const amplia = await sesion.pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, guardias: 2 }),
      });
      assert.equal(amplia.status, 403);

      const baja = await sesion.pedir('/api/cancelaciones', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'REDUCCION', servicio_id: id, guardias: 2, motivo: 'FIN DE CONTRATO' }),
      });
      assert.equal(baja.status, 403);
      assert.equal(await guardiasDe(id), 5);
    });
  }
});
