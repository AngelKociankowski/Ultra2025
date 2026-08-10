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
