/**
 * El precio de un servicio, partida por partida.
 *
 * En un servicio los guardias no cuestan lo mismo: un jefe de servicio no vale
 * lo que un guardia raso, ni las 24 horas lo que un 12X12. Con un solo precio
 * por servicio había que promediar, y un promedio no sirve para cotizar ni
 * para explicarle al cliente su factura.
 *
 * Se prueba que la suma sea la que manda, que el desglose y el aumento anual
 * no se separen nunca, y las dos cosas que el desglose NO puede hacer: mover el
 * estado de fuerza por su cuenta, y aceptar puestos o turnos inventados.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let ventas;
let finanzas;
let operaciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
const partidas = async (id) => (await admin.pedir(`/api/servicios/${id}/partidas`)).json;

async function servicio(nombre, turnos = { '24 HRS': 4 }) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

const guardar = (cliente, id, lista) =>
  cliente.pedir(`/api/servicios/${id}/partidas`, { method: 'PUT', body: JSON.stringify({ partidas: lista }) });

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
});

after(async () => {
  await app?.cerrar();
});

describe('el precio se captura por puesto', () => {
  test('cada renglón lleva su puesto, su turno y su precio', async () => {
    const id = await servicio('PARTIDAS BASICAS', { '24 HRS': 3, '12X12 L-D': 2 });
    const r = await guardar(admin, id, [
      { puesto: 'JEFE DE SERVICIO', turno: '24 HRS', cantidad: 1, precio_unitario: 32000 },
      { puesto: 'GUARDIA', turno: '24 HRS', cantidad: 2, precio_unitario: 21000 },
      { puesto: 'GUARDIA', turno: '12X12 L-D', cantidad: 2, precio_unitario: 14500 },
    ]);
    assert.equal(r.status, 200, r.texto);

    const p = await partidas(id);
    assert.equal(p.partidas.length, 3);
    assert.equal(p.guardias, 5);
    // 32,000 + 2×21,000 + 2×14,500 = 103,000
    assert.equal(p.sinIva, 103000);
    assert.equal(p.conIva, 119480);
    assert.equal(p.cuadra, true, 'los 5 del desglose son los 5 de la plantilla');

    // El mismo puesto en dos turnos cuesta distinto, que es el punto de todo.
    const guardias = p.partidas.filter((x) => x.puesto === 'GUARDIA');
    assert.notEqual(guardias[0].precio_unitario, guardias[1].precio_unitario);
  });

  test('el importe del servicio pasa a salir de la suma', async () => {
    const id = await servicio('PARTIDAS MANDAN', { '24 HRS': 2 });
    await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 99999 }),
    });

    await guardar(admin, id, [{ puesto: 'GUARDIA', turno: '24 HRS', cantidad: 2, precio_unitario: 20000 }]);

    const s = await ficha(id);
    assert.equal(s.importe_sin_iva, 40000);
    assert.equal(s.importe_factura, 46400, 'el de factura lleva IVA, que es como se cobra');
  });

  test('el turno es opcional: hay clientes que cobran igual sin importar el horario', async () => {
    const id = await servicio('PARTIDAS SIN TURNO', { '24 HRS': 2 });
    const r = await guardar(admin, id, [{ puesto: 'GUARDIA', cantidad: 2, precio_unitario: 18000 }]);
    assert.equal(r.status, 200, r.texto);
    const p = await partidas(id);
    assert.equal(p.partidas[0].turno, null);
    assert.equal(p.sinIva, 36000);
  });

  test('quitar el desglose deja el servicio como estaba, sin partidas', async () => {
    const id = await servicio('PARTIDAS SE QUITAN', { '24 HRS': 2 });
    await guardar(admin, id, [{ puesto: 'GUARDIA', cantidad: 2, precio_unitario: 10000 }]);
    assert.equal((await partidas(id)).partidas.length, 1);

    const r = await guardar(admin, id, []);
    assert.equal(r.status, 200, r.texto);
    const p = await partidas(id);
    assert.equal(p.partidas.length, 0);
    assert.equal(p.hay, false);
    // El importe que ya se había calculado no se borra: seguía siendo el precio
    // del cliente hasta que alguien capture otro.
    assert.equal((await ficha(id)).importe_sin_iva, 20000);
  });

  test('los renglones vacíos que quedan al agregar no estorban', async () => {
    const id = await servicio('PARTIDAS CON VACIOS', { '24 HRS': 1 });
    const r = await guardar(admin, id, [
      { puesto: 'GUARDIA', cantidad: 1, precio_unitario: 15000 },
      { puesto: '', turno: '', cantidad: '', precio_unitario: '' },
    ]);
    assert.equal(r.status, 200, r.texto);
    assert.equal((await partidas(id)).partidas.length, 1);
  });
});

describe('lo que el desglose no puede hacer', () => {
  test('no mueve el estado de fuerza: avisa del descuadre y no lo corrige', async () => {
    const id = await servicio('PARTIDAS DESCUADRE', { '24 HRS': 4 });
    const r = await guardar(admin, id, [{ puesto: 'GUARDIA', turno: '24 HRS', cantidad: 7, precio_unitario: 10000 }]);
    assert.equal(r.status, 200, r.texto);

    const p = await partidas(id);
    assert.equal(p.cuadra, false);
    assert.equal(p.guardias, 7);
    assert.equal(p.plantilla, 4);
    assert.equal((await ficha(id)).total_guardias, 4, 'la plantilla no se movió');

    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /El desglose suma/);
  });

  test('un puesto que no está en el catálogo se rechaza', async () => {
    const id = await servicio('PARTIDAS PUESTO INVENTADO', { '24 HRS': 1 });
    const r = await guardar(admin, id, [{ puesto: 'ASTRONAUTA', cantidad: 1, precio_unitario: 10000 }]);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /catálogo/i);
  });

  test('un turno que no está en el catálogo tampoco', async () => {
    const id = await servicio('PARTIDAS TURNO INVENTADO', { '24 HRS': 1 });
    const r = await guardar(admin, id, [
      { puesto: 'GUARDIA', turno: '99 HRS', cantidad: 1, precio_unitario: 10000 },
    ]);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /catálogo/i);
  });

  test('el mismo puesto y turno dos veces se rechaza: es un solo concepto', async () => {
    const id = await servicio('PARTIDAS REPETIDAS', { '24 HRS': 4 });
    const r = await guardar(admin, id, [
      { puesto: 'GUARDIA', turno: '24 HRS', cantidad: 2, precio_unitario: 10000 },
      { puesto: 'GUARDIA', turno: '24 HRS', cantidad: 2, precio_unitario: 12000 },
    ]);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /dos veces/i);
  });

  test('un renglón sin cantidad o sin precio se rechaza diciendo cuál', async () => {
    const id = await servicio('PARTIDAS INCOMPLETAS', { '24 HRS': 2 });
    const sinCantidad = await guardar(admin, id, [{ puesto: 'GUARDIA', precio_unitario: 10000 }]);
    assert.equal(sinCantidad.status, 400);
    assert.match(sinCantidad.json.error, /renglón 1/);

    const sinPrecio = await guardar(admin, id, [{ puesto: 'GUARDIA', cantidad: 2 }]);
    assert.equal(sinPrecio.status, 400);
    assert.match(sinPrecio.json.error, /precio/i);
  });
});

describe('el aumento anual mueve también el desglose', () => {
  test('cada renglón sube en la misma proporción que el total', async () => {
    const id = await servicio('PARTIDAS CON AUMENTO', { '24 HRS': 3 });
    await guardar(admin, id, [
      { puesto: 'JEFE DE SERVICIO', turno: '24 HRS', cantidad: 1, precio_unitario: 30000 },
      { puesto: 'GUARDIA', turno: '24 HRS', cantidad: 2, precio_unitario: 20000 },
    ]);
    assert.equal((await partidas(id)).sinIva, 70000);

    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({
        ids: [id],
        ajuste: { tipo: 'PORCENTAJE', valor: 10 },
        vigencia: '2026-09',
        motivo: 'Revisión anual de precio',
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const p = await partidas(id);
    assert.equal(p.partidas.find((x) => x.puesto === 'JEFE DE SERVICIO').precio_unitario, 33000);
    assert.equal(p.partidas.find((x) => x.puesto === 'GUARDIA').precio_unitario, 22000);
    assert.equal(p.sinIva, 77000, 'el detalle y el total siguen diciendo lo mismo');

    const s = await ficha(id);
    assert.equal(s.importe_sin_iva, 77000);
  });
});

describe('quién captura el precio', () => {
  test('ventas puede: es quien cotiza', async () => {
    const id = await servicio('PARTIDAS DE VENTAS', { '24 HRS': 1 });
    const r = await guardar(ventas, id, [{ puesto: 'GUARDIA', cantidad: 1, precio_unitario: 17000 }]);
    assert.equal(r.status, 200, r.texto);
  });

  test('finanzas también', async () => {
    const id = await servicio('PARTIDAS DE FINANZAS', { '24 HRS': 1 });
    assert.equal((await guardar(finanzas, id, [{ puesto: 'GUARDIA', cantidad: 1, precio_unitario: 1 }])).status, 200);
  });

  test('operaciones no: mueve guardias, no precios', async () => {
    const id = await servicio('PARTIDAS NO DE OPERACIONES', { '24 HRS': 1 });
    const r = await guardar(operaciones, id, [{ puesto: 'GUARDIA', cantidad: 1, precio_unitario: 1 }]);
    assert.equal(r.status, 403);
    assert.equal((await partidas(id)).partidas.length, 0);
  });

  test('verlo sí es de todos', async () => {
    const id = await servicio('PARTIDAS LAS VE OPERACIONES', { '24 HRS': 1 });
    await guardar(admin, id, [{ puesto: 'GUARDIA', cantidad: 1, precio_unitario: 12345 }]);
    const r = await operaciones.pedir(`/api/servicios/${id}/partidas`);
    assert.equal(r.status, 200);
    assert.equal(r.json.sinIva, 12345);
  });
});

describe('el catálogo de puestos', () => {
  test('viene con los de uso corriente y el administrador agrega los suyos', async () => {
    const html = comoSeLee((await admin.pedir('/catalogos')).texto);
    assert.match(html, /Puestos/);
    assert.match(html, /JEFE DE SERVICIO/);

    const r = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'puesto', valor: 'ESCOLTA' }),
    });
    assert.equal(r.status, 201, r.texto);

    const id = await servicio('PARTIDAS CON PUESTO NUEVO', { '24 HRS': 1 });
    assert.equal((await guardar(admin, id, [{ puesto: 'ESCOLTA', cantidad: 1, precio_unitario: 45000 }])).status, 200);
  });
});

describe('la pantalla', () => {
  test('la ficha enseña el desglose con sus totales', async () => {
    const id = await servicio('PARTIDAS EN PANTALLA', { '24 HRS': 2 });
    await guardar(admin, id, [
      { puesto: 'JEFE DE SERVICIO', turno: '24 HRS', cantidad: 1, precio_unitario: 30000 },
      { puesto: 'GUARDIA', turno: '24 HRS', cantidad: 1, precio_unitario: 20000 },
    ]);

    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /Precio por puesto/);
    assert.match(html, /JEFE DE SERVICIO/);
    assert.match(html, /\$50,000/);
    assert.match(html, /con IVA/);
  });

  test('un servicio sin desglose lo dice y ofrece capturarlo', async () => {
    const id = await servicio('PARTIDAS SIN CAPTURAR', { '24 HRS': 1 });
    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /un solo precio para todos/);
    assert.match(html, /Capturar el desglose/);
  });

  test('a operaciones no se le ofrece capturarlo', async () => {
    const id = await servicio('PARTIDAS OPERACIONES NO EDITA', { '24 HRS': 1 });
    const html = comoSeLee((await operaciones.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /Precio por puesto/);
    assert.doesNotMatch(html, /Capturar el desglose/);
  });
});
