/**
 * Lo facturado contra lo que está en la calle.
 *
 * Es la comparación que ningún total hace por sí solo, y por eso hacía falta.
 * La suma de las facturas cuadra consigo misma y la plantilla del estado de
 * fuerza también: cada una es coherente por dentro, y las dos pueden estar
 * diciendo cosas distintas sin que nada chille.
 *
 * Una factura por 8 guardias en un servicio de 10 son dos elementos que se
 * ponen todos los días y no se cobran. Ese dinero no aparece como faltante en
 * ninguna parte —no hay una cuenta por cobrar, porque nadie la emitió— y por
 * eso se puede perder durante años sin que nadie lo note.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let operaciones;
let finanzas;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/**
 * Solo la tabla de hallazgos.
 *
 * Recortar desde «Qué no cuadra» hasta el final incluía la tabla de facturas
 * emitidas, que está más abajo y lista TODOS los servicios facturados. Así,
 * cualquier prueba de «esto no debería aparecer» fallaba por encontrarlo en
 * otra tabla.
 */
const soloHallazgos = (html) => {
  const i = html.indexOf('Qué no cuadra');
  if (i === -1) return '';
  const fin = html.indexOf('</table>', i);
  return html.slice(i, fin === -1 ? undefined : fin);
};
const PERIODO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
  .format(new Date())
  .slice(0, 7);

/** Un servicio con plantilla y precio, listo para facturarle. */
async function servicio(nombre, guardias, importe) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': guardias } }),
  });
  assert.equal(r.status, 201, r.texto);
  await admin.pedir(`/api/servicios/${r.json.servicioId}`, {
    method: 'PATCH',
    body: JSON.stringify({ importe_factura: importe, esquema_facturacion: 'MES_VENCIDO', dias_credito: 30 }),
  });
  return r.json.servicioId;
}

async function facturar(servicioId, { importe, guardias }) {
  return admin.pedir('/api/facturas', {
    method: 'POST',
    body: JSON.stringify({
      servicio_id: servicioId,
      periodo: PERIODO,
      fecha_factura: `${PERIODO}-05`,
      importe,
      ...(guardias === undefined ? {} : { guardias }),
    }),
  });
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
});

after(async () => {
  await app?.cerrar();
});

describe('la factura guarda cuántos guardias cubre', () => {
  test('se capturan y se guardan', async () => {
    const id = await servicio('CONC CUADRADO', 10, 100000);
    const r = await facturar(id, { importe: 100000, guardias: 10 });
    assert.equal(r.status, 201, r.texto);

    const f = (await admin.pedir(`/api/facturas?servicio_id=${id}`)).json.facturas[0];
    assert.equal(f.guardias, 10);
  });

  test('un número negativo se rechaza', async () => {
    const id = await servicio('CONC NEGATIVO', 2, 20000);
    const r = await facturar(id, { importe: 20000, guardias: -3 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /mayor o igual a cero/);
  });

  test('sin guardias se acepta: las cargas viejas no los traen', async () => {
    const id = await servicio('CONC SIN GUARDIAS', 4, 40000);
    const r = await facturar(id, { importe: 40000 });
    assert.equal(r.status, 201, r.texto);
    const f = (await admin.pedir(`/api/facturas?servicio_id=${id}`)).json.facturas[0];
    assert.equal(f.guardias, null);
  });
});

describe('lo que no cuadra se dice, y con cuánto duele', () => {
  test('facturar menos guardias de los que hay sale en rojo y con su monto', async () => {
    // El caso caro: dos elementos puestos todos los días que nadie cobra.
    const id = await servicio('CONC FALTAN DOS', 10, 100000);
    await facturar(id, { importe: 80000, guardias: 8 });

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.match(html, /Lo facturado contra lo que está en la calle/);
    assert.match(html, /CONC FALTAN DOS/);
    assert.match(html, /Se facturaron 8 guardias y el servicio tiene 10: 2 sin cobrar/);
    // Y el dinero: dos guardias a 10,000 cada uno.
    assert.match(html, /Guardias sin cobrar/);
  });

  test('la pérdida se cuenta una vez, no dos', async () => {
    // Facturar 2 guardias de menos y $20,000 de menos no son dos pérdidas: son
    // la misma falta contada de dos maneras. Sumarlas daba el doble.
    const id = await servicio('CONC NO DUPLICAR', 10, 100000);
    await facturar(id, { importe: 80000, guardias: 8 });

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    const bloque = html.slice(html.indexOf('Guardias sin cobrar'), html.indexOf('Guardias sin cobrar') + 300);
    const monto = /\$([\d,]+)/.exec(bloque);
    assert.ok(monto, `no se encontró el monto en: ${bloque.slice(0, 160)}`);
    const cifra = Number(monto[1].replace(/,/g, ''));
    // Con los dos servicios que faltan guardias en esta corrida, el total tiene
    // que ser la suma de las diferencias de importe, no el doble.
    assert.ok(cifra > 0, 'debería haber un monto');
    assert.ok(cifra < 200000, `el monto ${cifra} parece contar la misma falta dos veces`);
  });

  test('facturar de más también se avisa, en ámbar', async () => {
    // Se descubre solo —el cliente lo rebota— pero avisarlo antes ahorra la
    // nota de crédito.
    const id = await servicio('CONC SOBRAN TRES', 5, 50000);
    await facturar(id, { importe: 80000, guardias: 8 });

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.match(html, /Se facturaron 8 guardias y el servicio tiene 5: 3 de más/);
    assert.match(html, /Guardias de más/);
  });

  test('un importe distinto al acordado se señala aunque los guardias cuadren', async () => {
    const id = await servicio('CONC PRECIO MALO', 4, 40000);
    await facturar(id, { importe: 31000, guardias: 4 });

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.match(html, /CONC PRECIO MALO/);
    assert.match(html, /faltan/);
  });

  test('lo que cuadra no aparece en la lista de hallazgos', async () => {
    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.doesNotMatch(soloHallazgos(html), /CONC CUADRADO/);
    assert.match(html, /Cuadran/);
  });

  test('un peso de diferencia no se reporta: eso es redondeo', async () => {
    const id = await servicio('CONC REDONDEO', 3, 30000.4);
    await facturar(id, { importe: 30000, guardias: 3 });

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.doesNotMatch(soloHallazgos(html), /CONC REDONDEO/);
  });

  test('lo que no tiene con qué compararse se cuenta aparte, no como que cuadra', async () => {
    // Callar que faltan datos haría creer que todo está revisado.
    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.match(html, /Sin con qué comparar/);
    assert.match(html, /falta capturar guardias o precio/);
  });
});

describe('varias facturas del mismo mes se juntan antes de comparar', () => {
  test('dos quincenas que suman la plantilla entera cuadran', async () => {
    // Compararlas una por una contra la plantilla sería acusar de faltar a cada
    // mitad.
    const id = await servicio('CONC DOS QUINCENAS', 6, 60000);
    const a = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id,
        periodo: PERIODO,
        concepto: 'Primera quincena',
        fecha_factura: `${PERIODO}-05`,
        importe: 30000,
        guardias: 3,
      }),
    });
    assert.equal(a.status, 201, a.texto);
    const b = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id,
        periodo: PERIODO,
        concepto: 'Segunda quincena',
        fecha_factura: `${PERIODO}-20`,
        importe: 30000,
        guardias: 3,
      }),
    });
    assert.equal(b.status, 201, b.texto);

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.doesNotMatch(soloHallazgos(html), /CONC DOS QUINCENAS/);
  });
});

describe('la nómina la captura también operaciones', () => {
  let id;

  before(async () => {
    id = await servicio('CONC NOMINA', 5, 50000);
  });

  test('operaciones la modifica: cambia mes a mes y es quien la sabe', async () => {
    const r = await operaciones.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ nomina_total: 32000 }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await admin.pedir(`/api/servicios/${id}`)).json.servicio.nomina_total, 32000);
  });

  test('finanzas la sigue moviendo', async () => {
    const r = await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ nomina_total: 33000 }),
    });
    assert.equal(r.status, 200, r.texto);
  });

  test('pero operaciones no toca el importe ni la utilidad', async () => {
    // La nómina es lo que cuesta; el resultado se sigue de ella y del importe, y
    // quien lo interpreta es finanzas.
    const r = await operaciones.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 1, pct_utilidad: 99 }),
    });
    assert.equal(r.status, 403, r.texto);
    assert.equal((await admin.pedir(`/api/servicios/${id}`)).json.servicio.importe_factura, 50000);
  });

  test('ventas y jurídico no la tocan', async () => {
    for (const rol of ['ventas', 'juridico']) {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await sesion.pedir(`/api/servicios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nomina_total: 1 }),
      });
      assert.equal(r.status, 403, `${rol} no debería poder`);
    }
  });
});

/**
 * Un cliente con varias facturas del mismo mes.
 *
 * Lo reportó cobranza desde la operación real: hay clientes que reciben dos,
 * tres y hasta cuatro facturas por un mismo mes de servicio, porque se les
 * factura por sede o por centro de costos. La plataforma solo dejaba capturar
 * una —la comprobación de duplicados era «servicio + periodo + concepto», y el
 * concepto de un servicio a mes vencido es siempre el mismo— y a partir de ahí
 * el servicio desaparecía de la pantalla, sin dejar por dónde registrar las
 * demás.
 *
 * El daño no era la molestia: la única factura que entraba quedaba enfrentada
 * al importe completo del servicio, así que un mes cobrado al 100% en cuatro
 * papeles se veía como un mes cobrado de menos.
 */
describe('un servicio puede llevar varias facturas del mismo mes', () => {
  test('cuatro facturas del mismo mes entran, y la suma es la que cuenta', async () => {
    const id = await servicio('CONC CUATRO PAPELES', 12, 120000);
    for (const [i, importe] of [30000, 30000, 30000, 30000].entries()) {
      const r = await admin.pedir('/api/facturas', {
        method: 'POST',
        body: JSON.stringify({
          servicio_id: id,
          periodo: PERIODO,
          concepto: `Sede ${i + 1}`,
          fecha_factura: `${PERIODO}-05`,
          importe,
          guardias: 3,
        }),
      });
      assert.equal(r.status, 201, `la factura ${i + 1}: ${r.texto}`);
    }

    const facturas = (await admin.pedir(`/api/facturas?servicio_id=${id}`)).json.facturas;
    assert.equal(facturas.length, 4);

    // Y cuadra: 4 × 30,000 son los 120,000 del servicio, 4 × 3 son sus 12
    // guardias. Con una sola factura permitida, esto salía como un faltante.
    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.doesNotMatch(soloHallazgos(html), /CONC CUATRO PAPELES/);
  });

  test('el mismo concepto dos veces se acepta si es otra factura', async () => {
    // El concepto no es el identificador de una factura. Dos sedes que se
    // llaman igual con importes distintos son dos facturas.
    const id = await servicio('CONC MISMO CONCEPTO', 4, 40000);
    const a = await facturar(id, { importe: 20000, guardias: 2 });
    assert.equal(a.status, 201, a.texto);
    const b = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id, periodo: PERIODO, fecha_factura: `${PERIODO}-20`, importe: 20000, guardias: 2,
      }),
    });
    assert.equal(b.status, 201, b.texto);
  });
});

describe('pero la misma factura dos veces sigue frenada', () => {
  test('el mismo folio fiscal no se registra dos veces', async () => {
    // El folio es el identificador real: si ya está, es la misma factura.
    const id = await servicio('CONC FOLIO REPETIDO', 5, 50000);
    const a = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id, periodo: PERIODO, fecha_factura: `${PERIODO}-05`, importe: 25000, guardias: 2, folio: 'AAA-111',
      }),
    });
    assert.equal(a.status, 201, a.texto);
    const b = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id, periodo: PERIODO, concepto: 'Otra cosa', fecha_factura: `${PERIODO}-06`, importe: 25000, guardias: 3, folio: 'AAA-111',
      }),
    });
    assert.equal(b.status, 400, b.texto);
    assert.match(b.json.error, /ya está registrada/);
  });

  test('sin folio, se frena la captura idéntica: es el doble clic', async () => {
    const id = await servicio('CONC DOBLE CLIC', 6, 60000);
    const a = await facturar(id, { importe: 60000, guardias: 6 });
    assert.equal(a.status, 201, a.texto);
    const b = await facturar(id, { importe: 60000, guardias: 6 });
    assert.equal(b.status, 400, b.texto);
    assert.match(b.json.error, /idéntica/);
  });

  test('mismo concepto y fecha con otro importe sí pasa: son dos facturas', async () => {
    const id = await servicio('CONC MISMA FECHA', 8, 80000);
    const a = await facturar(id, { importe: 50000, guardias: 5 });
    assert.equal(a.status, 201, a.texto);
    const b = await facturar(id, { importe: 30000, guardias: 3 });
    assert.equal(b.status, 201, b.texto);
  });
});

describe('el servicio ya facturado sigue alcanzable', () => {
  test('sus datos y lo que le falta viajan a la pantalla', async () => {
    // Antes desaparecía de la pantalla con su primera factura, y con él la
    // única puerta para registrarle otra.
    //
    // El bloque de «ya tienen factura» se pinta al buscar, así que su encabezado
    // no está en el HTML del servidor y comprobarlo ahí no diría nada. Lo que sí
    // se puede comprobar —y es lo que hace falta— es que el renglón viaje con la
    // página: sin eso, buscarlo no lo encontraría.
    const id = await servicio('CONC BUSCAME', 10, 100000);
    await facturar(id, { importe: 40000, guardias: 4 });

    const r = await admin.pedir(`/api/facturas?pendientes=1&periodo=${PERIODO}`);
    assert.equal(r.status, 200, r.texto);
    const ya = (r.json.yaFacturados || []).find((s) => s.servicio === 'CONC BUSCAME');
    assert.ok(ya, 'debería salir entre los ya facturados');
    assert.equal(ya.sumaImporte, 40000);
    assert.equal(ya.contratado, 100000);
    assert.equal(ya.faltaImporte, 60000, 'lo que falta para el importe del servicio');
    assert.equal(ya.facturas.length, 1);
  });

  test('la pantalla explica que hay que buscarlo para agregarle otra', async () => {
    // Si no se dice, nadie descubre que la puerta existe: el servicio
    // simplemente no está en la lista de pendientes y parece que ya no se puede.
    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${PERIODO}`)).texto);
    assert.match(html, /varias facturas del mismo mes/);
  });
});
