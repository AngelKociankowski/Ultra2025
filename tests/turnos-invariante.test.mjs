/**
 * El desglose por turno no puede contradecir a su jornada. Nunca.
 *
 * Esto salió de una auditoría y era un agujero de los silenciosos. Al capturar,
 * la plataforma EXIGE que el desglose por turno cuadre con su jornada —ocho en
 * 12X36 tienen que ser ocho entre matutino, nocturno y mixto—. Pero después
 * nadie lo mantenía, así que la propia plataforma rompía por cinco caminos el
 * invariante que acababa de exigir. El reporte de guardias por turno del
 * tablero suma ese desglose, o sea que contaba gente que no existe. Nada
 * fallaba y nada se veía raro: el número simplemente estaba mal, que es la peor
 * clase de error que puede tener una plataforma de la que se toman decisiones.
 *
 * Cada prueba de aquí es uno de los cinco caminos, más el de deshacer. La regla
 * que las une: si el desglose de una jornada deja de cuadrar —o la jornada
 * desaparece— ese desglose se retira, no se ajusta a ojo. Repartir la
 * diferencia a prorrata sería inventar: si a un servicio de cuatro matutinos le
 * suben dos guardias y nadie dijo de qué turno, la plataforma no sabe si son de
 * mañana o de noche. Un hueco se ve y se llena; un dato viejo con aspecto de
 * bueno se cuela en un reporte.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
});

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const abrir = async (servicio, cuerpo) => {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ servicio, fecha: '2026-01-05', ...cuerpo }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json;
};

/** El invariante, escrito una vez: ninguna jornada del desglose puede mentir. */
function exigirCoherencia(s, contexto) {
  for (const [jornada, reparto] of Object.entries(s.turnosDetalle || {})) {
    const meta = s.turnos?.[jornada];
    assert.notEqual(
      meta,
      undefined,
      `${contexto}: el desglose habla de «${jornada}» y el servicio ya no tiene esa jornada`
    );
    const suma = Object.values(reparto).reduce((a, b) => a + (Number(b) || 0), 0);
    assert.equal(suma, meta, `${contexto}: «${jornada}» suma ${suma} y la jornada dice ${meta}`);
  }
}

describe('los movimientos mantienen el desglose por turno', () => {
  test('un incremento CON turnos los suma', async () => {
    const { servicioId } = await abrir('INV INCREMENTO CON', {
      turnos: { '12X36': 4 },
      turnos_detalle: { '12X36': { MATUTINO: 2, NOCTURNO: 2 } },
    });
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'INCREMENTO',
        servicio_id: servicioId,
        fecha: '2026-02-05',
        turnos: { '12X36': 2 },
        turnos_detalle: { '12X36': { NOCTURNO: 2 } },
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const s = await ficha(servicioId);
    exigirCoherencia(s, 'incremento con turnos');
    assert.deepEqual(s.turnosDetalle['12X36'], { MATUTINO: 2, NOCTURNO: 4 });
  });

  test('un incremento SIN turnos retira el desglose en vez de dejarlo corto', async () => {
    // Antes la jornada subía a 6 y el desglose se quedaba diciendo 4.
    const { servicioId } = await abrir('INV INCREMENTO SIN', {
      turnos: { '12X36': 4 },
      turnos_detalle: { '12X36': { MATUTINO: 4 } },
    });
    await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'INCREMENTO', servicio_id: servicioId, fecha: '2026-02-05', turnos: { '12X36': 2 } }),
    });

    const s = await ficha(servicioId);
    exigirCoherencia(s, 'incremento sin turnos');
    assert.deepEqual(s.turnosDetalle, {}, 'sin saber de qué turno son los nuevos, el desglose se retira');
    assert.equal(s.total_guardias, 6, 'y la plantilla sí sube: el movimiento no se pierde');
  });

  test('una reducción resta los turnos que se retiran', async () => {
    const { servicioId } = await abrir('INV REDUCCION', {
      turnos: { '24 HRS': 6 },
      turnos_detalle: { '24 HRS': { MIXTO: 6 } },
    });
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'REDUCCION',
        servicio_id: servicioId,
        turnos: { '24 HRS': 2 },
        turnos_detalle: { '24 HRS': { MIXTO: 2 } },
        motivo: 'REDUCCIÓN DE PLANTILLA',
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const s = await ficha(servicioId);
    exigirCoherencia(s, 'reducción');
    assert.deepEqual(s.turnosDetalle['24 HRS'], { MIXTO: 4 });
  });

  test('una cancelación total no deja turnos de un servicio que ya no opera', async () => {
    // Quedaba un servicio en BAJA, con cero guardias, afirmando tres mixtos.
    const { servicioId } = await abrir('INV CANCELA', {
      turnos: { '24 HRS': 3 },
      turnos_detalle: { '24 HRS': { MIXTO: 3 } },
    });
    await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: servicioId, motivo: 'FIN DE CONTRATO' }),
    });

    const s = await ficha(servicioId);
    assert.equal(s.total_guardias, 0);
    assert.deepEqual(s.turnosDetalle, {});
  });

  test('una corrección de la plantilla arrastra el desglose', async () => {
    const { servicioId } = await abrir('INV CORRIGE', {
      turnos: { '12X36': 4 },
      turnos_detalle: { '12X36': { MATUTINO: 4 } },
    });
    const r = await admin.pedir(`/api/servicios/${servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ turnos: { '12X36': 2 }, motivo: 'Se capturaron 4 guardias y son 2.' }),
    });
    assert.equal(r.status, 201, r.texto);
    exigirCoherencia(await ficha(servicioId), 'corrección');
  });

  test('una corrección que quita la jornada no deja el desglose huérfano', async () => {
    // Este era el peor: el desglose apuntaba a una jornada que el servicio ya
    // no tenía, así que el reporte contaba guardias de un turno inexistente.
    const { servicioId } = await abrir('INV HUERFANO', {
      turnos: { '12X36': 4, '24 HRS': 2 },
      turnos_detalle: { '12X36': { MATUTINO: 4 } },
    });
    await admin.pedir(`/api/servicios/${servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ turnos: { '24 HRS': 2 }, motivo: 'La jornada 12X36 nunca existió aquí.' }),
    });

    const s = await ficha(servicioId);
    exigirCoherencia(s, 'corrección que quita la jornada');
    assert.equal(s.turnosDetalle['12X36'], undefined);
  });

  test('deshacer un incremento devuelve el desglose a como estaba', async () => {
    const { servicioId } = await abrir('INV DESHACER', {
      turnos: { '12X36': 4 },
      turnos_detalle: { '12X36': { MATUTINO: 4 } },
    });
    const inc = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'INCREMENTO',
        servicio_id: servicioId,
        fecha: '2026-02-05',
        turnos: { '12X36': 2 },
        turnos_detalle: { '12X36': { NOCTURNO: 2 } },
      }),
    });
    const r = await admin.pedir(`/api/aperturas/${inc.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Aplicada por error' }),
    });
    assert.equal(r.status, 200, r.texto);

    const s = await ficha(servicioId);
    exigirCoherencia(s, 'deshacer');
    assert.deepEqual(s.turnosDetalle['12X36'], { MATUTINO: 4 }, 'vuelve a ser el de antes del incremento');
  });
});

describe('el reporte del tablero cuenta lo que existe', () => {
  test('ningún servicio de la base queda con un desglose que mienta', async () => {
    // El guardián de todo lo anterior, sobre los 217 servicios reales más los
    // que estas pruebas acaban de mover.
    const { servicios } = (await admin.pedir('/api/servicios')).json;
    for (const s of servicios) exigirCoherencia(s, s.servicio);
  });
});
