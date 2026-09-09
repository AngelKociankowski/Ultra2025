/**
 * División de puestos y de salarios.
 *
 * Al revisar una apertura recién capturada, la operación pasó lista: división
 * de jornadas ✅, división de turnos ✅, división de puestos ❌, división de
 * salarios ❌. Las dos que faltaban resultaron ser cosas distintas.
 *
 * PUESTOS. Ya existía —la plataforma guarda el precio del servicio partida por
 * partida: tantos guardias, de tal puesto, en tal jornada, a tal precio— pero
 * solo se podía capturar entrando después a la ficha del servicio. Quien da de
 * alta tiene el dato en la mano en ese momento, y para cuando alguien vuelve a
 * entrar, ya se perdió. Es el mismo patrón que con el importe acordado: no
 * faltaba la función, faltaba el camino.
 *
 * SALARIOS. Esto sí faltaba de verdad. El servicio tenía UN sueldo base para
 * todos, que no es cierto en ninguna parte: un jefe de servicio no gana lo que
 * un guardia raso, igual que no cuesta lo mismo. Ahora el sueldo va en el mismo
 * renglón que el precio, y con los dos juntos cada puesto dice lo que deja.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

/** La API devuelve el resumen plano: partidas y totales en el mismo objeto. */
const partidasDe = async (id) => {
  const r = await admin.pedir(`/api/servicios/${id}/partidas`);
  assert.equal(r.status, 200, r.texto);
  return r.json;
};

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
});

describe('capturar los puestos al abrir el servicio', () => {
  let id;

  test('la apertura guarda el desglose por puesto', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio: 'BARRIENTOS',
        fecha: '2026-09-01',
        turnos: { '24 HRS': 4, '12X12 L-S': 3 },
        partidas: [
          { puesto: 'GUARDIA BÁSICO', turno: '24 HRS', cantidad: 4, precio_unitario: 12000, sueldo: 7500 },
          { puesto: 'JEFE DE TURNO', turno: '12X12 L-S', cantidad: 3, precio_unitario: 15000, sueldo: 9000 },
        ],
      }),
    });
    assert.equal(r.status, 201, r.texto);
    id = r.json.servicioId;

    const { partidas } = await partidasDe(id);
    assert.equal(partidas.length, 2, 'las dos partidas tienen que haberse guardado con el alta');
    assert.deepEqual(
      partidas.map((p) => [p.puesto, p.turno, p.cantidad, p.precio_unitario, p.sueldo]),
      [
        ['GUARDIA BÁSICO', '24 HRS', 4, 12000, 7500],
        ['JEFE DE TURNO', '12X12 L-S', 3, 15000, 9000],
      ]
    );
  });

  test('el importe del servicio sale de la suma, no de un número suelto', async () => {
    // 4 × 12,000 + 3 × 15,000 = 93,000 sin IVA.
    const s = await ficha(id);
    assert.equal(s.importe_sin_iva, 93000);
    assert.equal(Math.round(s.importe_factura), Math.round(93000 * 1.16));
  });

  test('y con el sueldo se puede decir lo que deja cada puesto', async () => {
    // Es lo que no se podía antes: el servicio tenía un solo sueldo base.
    const resumen = await partidasDe(id);
    const { partidas } = resumen;
    const basico = partidas.find((p) => p.puesto === 'GUARDIA BÁSICO');
    assert.equal(basico.costo, 4 * 7500);
    assert.equal(basico.margen, 4 * (12000 - 7500));

    assert.equal(resumen.nomina, 4 * 7500 + 3 * 9000);
    assert.equal(resumen.margen, 93000 - (4 * 7500 + 3 * 9000));
    assert.equal(resumen.sinSueldo, 0);
  });
});

describe('el sueldo es opcional, y lo que falta se dice', () => {
  let id;

  before(async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio: 'COTIZADO SIN SUELDOS',
        fecha: '2026-09-01',
        turnos: { '24 HRS': 2 },
        partidas: [
          { puesto: 'GUARDIA BÁSICO', turno: '24 HRS', cantidad: 1, precio_unitario: 12000, sueldo: 7000 },
          { puesto: 'MONITORISTA', turno: '24 HRS', cantidad: 1, precio_unitario: 10000 },
        ],
      }),
    });
    assert.equal(r.status, 201, r.texto);
    id = r.json.servicioId;
  });

  test('un renglón sin sueldo entra igual: al cotizar no siempre se sabe', async () => {
    const { partidas } = await partidasDe(id);
    const mon = partidas.find((p) => p.puesto === 'MONITORISTA');
    assert.equal(mon.sueldo, null);
    assert.equal(mon.costo, null, 'sin sueldo no hay costo; cero diría que no cuesta nada');
    assert.equal(mon.margen, null);
  });

  test('la nómina no cuenta como cero lo que no se ha capturado', async () => {
    // Contarlo como cero daría un margen inventado, y un margen inventado se ve
    // igual de bien que uno real.
    const resumen = await partidasDe(id);
    assert.equal(resumen.nomina, 7000, 'solo el renglón que sí trae sueldo');
    assert.equal(resumen.margen, 12000 - 7000, 'el margen se mide contra el precio de ese mismo renglón');
    assert.equal(resumen.sinSueldo, 1, 'y se dice cuántos faltan');
  });
});

describe('lo que no cambia', () => {
  test('un servicio sin partidas se abre exactamente como siempre', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ servicio: 'SIN DESGLOSE DE PUESTOS', fecha: '2026-09-01', guardias: 3 }),
    });
    assert.equal(r.status, 201, r.texto);
    const resumen = await partidasDe(r.json.servicioId);
    assert.equal(resumen.partidas.length, 0);
    assert.equal(resumen.hay, false);
  });

  test('un sueldo negativo se rechaza', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio: 'SUELDO IMPOSIBLE',
        fecha: '2026-09-01',
        turnos: { '24 HRS': 1 },
        partidas: [{ puesto: 'GUARDIA BÁSICO', turno: '24 HRS', cantidad: 1, precio_unitario: 1, sueldo: -5 }],
      }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /sueldo/i);

    // Y no queda un servicio a medias. El desglose se revisa ANTES de crear
    // nada: si se creara primero y el desglose fallara después, la pantalla
    // diría «error» con el servicio ya en el estado de fuerza, y quien captura
    // lo volvería a intentar creyendo que no pasó.
    const s = (await admin.pedir('/api/servicios?estatus=ACTIVO&q=SUELDO IMPOSIBLE')).json.servicios;
    assert.equal(s.length, 0, 'el alta no puede quedar hecha si el desglose se rechazó');
  });

  test('el sueldo se puede capturar después, desde la ficha', async () => {
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ servicio: 'SUELDO MAS TARDE', fecha: '2026-09-01', turnos: { '24 HRS': 2 } }),
    });
    const id = alta.json.servicioId;

    const r = await admin.pedir(`/api/servicios/${id}/partidas`, {
      method: 'PUT',
      body: JSON.stringify({
        partidas: [{ puesto: 'GUARDIA BÁSICO', turno: '24 HRS', cantidad: 2, precio_unitario: 11000, sueldo: 6800 }],
      }),
    });
    assert.equal(r.status, 200, r.texto);

    const { partidas } = await partidasDe(id);
    assert.equal(partidas[0].sueldo, 6800);
    assert.equal(partidas[0].margen, 2 * (11000 - 6800));
  });
});
