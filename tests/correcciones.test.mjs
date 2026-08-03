/**
 * Correcciones de captura.
 *
 * Es la única operación que cambia el estado de fuerza sin ser un movimiento, y
 * por eso es la que más vigilancia merece: que solo el admin la pueda hacer,
 * que exija motivo, que no sirva de puerta trasera para dar de baja un servicio
 * y que no invente aperturas ni cancelaciones en el histórico del mes.
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
    body: JSON.stringify({ servicio: nombre, fecha: '2026-07-08', ...cuerpo }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.servicioId;
}

const traer = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

function corregir(sesion, id, cuerpo) {
  return sesion.pedir(`/api/servicios/${id}/correccion`, { method: 'POST', body: JSON.stringify(cuerpo) });
}

describe('el admin corrige lo que la edición normal tiene bloqueado', () => {
  let id;

  before(async () => {
    id = await abrir('SERVICO MAL ESCRITO', { guardias: 12 });
  });

  test('arregla el nombre mal tecleado', async () => {
    const r = await corregir(admin, id, {
      servicio: 'SERVICIO BIEN ESCRITO',
      motivo: 'El nombre se capturó con una falta de ortografía en el alta.',
    });
    assert.equal(r.status, 201);
    assert.equal((await traer(id)).servicio, 'SERVICIO BIEN ESCRITO');
  });

  test('arregla el total de guardias mal capturado', async () => {
    const r = await corregir(admin, id, {
      total_guardias: 21,
      motivo: 'Se capturaron 12 guardias en vez de 21 al dar de alta el servicio.',
    });
    assert.equal(r.status, 201);
    assert.equal((await traer(id)).total_guardias, 21);
  });

  test('la corrección NO inventa movimientos en el histórico', async () => {
    // Es la razón de existir de esta operación: si los nueve guardias faltantes
    // entraran como ampliación, el mes reportaría un alta que nunca ocurrió.
    const s = await traer(id);
    const aperturas = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.total_guardias, 21);
    assert.equal(
      aperturas.aperturas.filter((a) => a.tipo === 'INCREMENTO').length,
      0,
      'corregir no deja incrementos falsos'
    );
    assert.equal(aperturas.cancelaciones.length, 0, 'ni cancelaciones falsas');
  });

  test('queda registrada con motivo, autor y el antes y después', async () => {
    const r = await admin.pedir(`/api/servicios/${id}/correccion`);
    assert.equal(r.status, 200);
    assert.equal(r.json.correcciones.length, 2);
    const ultima = r.json.correcciones[0];
    assert.match(ultima.motivo, /12 guardias en vez de 21/);
    assert.ok(ultima.usuario, 'guarda quién la hizo');
    assert.equal(ultima.cambios.total_guardias.antes, 12);
    assert.equal(ultima.cambios.total_guardias.despues, 21);
  });

  test('corregir el desglose recalcula el total', async () => {
    const conTurnos = await abrir('DESGLOSE MAL CAPTURADO', { turnos: { '24X24': 4, '12X12 L-D': 2 } });
    const r = await corregir(admin, conTurnos, {
      turnos: { '24X24': 6, '12X12 L-D': 2 },
      motivo: 'El turno 24X24 traía 4 guardias y son 6 desde el alta.',
    });
    assert.equal(r.status, 201);
    const s = await traer(conTurnos);
    assert.equal(s.total_guardias, 8);
    assert.deepEqual(s.turnos, { '24X24': 6, '12X12 L-D': 2 });
  });

  test('un total que contradice al desglose se rechaza', async () => {
    const otro = await abrir('TOTAL CONTRADICTORIO', { turnos: { '24X24': 4 } });
    const r = await corregir(admin, otro, {
      turnos: { '24X24': 4 },
      total_guardias: 9,
      motivo: 'Prueba de coherencia entre el total y el desglose.',
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /coincidir/i);
  });

  test('sin cambios reales lo dice y no registra nada', async () => {
    const antes = (await admin.pedir(`/api/servicios/${id}/correccion`)).json.correcciones.length;
    const r = await corregir(admin, id, {
      total_guardias: 21,
      motivo: 'Reviso que el total esté bien y sí lo está.',
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.sinCambios, true);
    const despues = (await admin.pedir(`/api/servicios/${id}/correccion`)).json.correcciones.length;
    assert.equal(despues, antes, 'no ensucia el registro con correcciones vacías');
  });
});

describe('los límites de una corrección', () => {
  let id;

  before(async () => {
    id = await abrir('LIMITES DE CORRECCION', { guardias: 7 });
  });

  test('sin motivo no procede', async () => {
    const r = await corregir(admin, id, { total_guardias: 9 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /motivo/i);
    assert.equal((await traer(id)).total_guardias, 7);
  });

  test('un motivo de dos letras tampoco', async () => {
    const r = await corregir(admin, id, { total_guardias: 9, motivo: 'ok' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /motivo/i);
  });

  test('no se puede dar de baja un servicio corrigiendo', async () => {
    const r = await corregir(admin, id, {
      estatus: 'BAJA',
      motivo: 'Intento de sacar el servicio sin registrar la cancelación.',
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /cancelaci/i);
    assert.equal((await traer(id)).estatus, 'ACTIVO');
  });

  test('un servicio activo no puede quedar en cero guardias', async () => {
    const r = await corregir(admin, id, { total_guardias: 0, motivo: 'Intento de vaciarlo por la puerta de atrás.' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /cancelaci/i);
  });

  test('un servicio que no existe no se corrige', async () => {
    const r = await corregir(admin, 999999, { total_guardias: 3, motivo: 'Servicio inexistente a propósito.' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no existe/i);
  });
});

describe('reactivar un servicio cancelado por error', () => {
  let id;

  before(async () => {
    id = await abrir('CANCELADO POR ERROR', { guardias: 6 });
    const c = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'FIN DE CONTRATO' }),
    });
    assert.equal(c.status, 201);
  });

  test('la corrección lo devuelve a ACTIVO con sus guardias', async () => {
    assert.equal((await traer(id)).estatus, 'BAJA');
    const r = await corregir(admin, id, {
      estatus: 'ACTIVO',
      total_guardias: 6,
      motivo: 'Se canceló el servicio equivocado; este sigue operando.',
    });
    assert.equal(r.status, 201);
    const s = await traer(id);
    assert.equal(s.estatus, 'ACTIVO');
    assert.equal(s.total_guardias, 6);
    assert.equal(s.fecha_baja, null, 'la fecha de baja deja de aplicar');
  });

  test('reactivado, vuelve a admitir movimientos normales', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: id, guardias: 2 }),
    });
    assert.equal(r.status, 201);
    assert.equal((await traer(id)).total_guardias, 8);
  });
});

describe('solo el admin corrige', () => {
  let id;

  before(async () => {
    id = await abrir('INTOCABLE PARA EL RESTO', { guardias: 4 });
  });

  for (const rol of ['juridico', 'finanzas', 'operaciones', 'ventas']) {
    test(`${rol} recibe 403`, async () => {
      const sesion = await srv.entrarYAsentar(ROLES[rol]);
      const r = await corregir(sesion, id, {
        total_guardias: 40,
        motivo: 'Intento de corrección desde un rol sin permiso.',
      });
      assert.equal(r.status, 403);
      assert.equal((await traer(id)).total_guardias, 4);
    });
  }

  test('sin sesión tampoco', async () => {
    const r = await fetch(`${srv.base}/api/servicios/${id}/correccion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_guardias: 40, motivo: 'Intento sin sesión.' }),
    });
    assert.equal(r.status, 401);
  });
});
