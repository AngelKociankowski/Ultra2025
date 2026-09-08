/**
 * Corregir una factura, y varias facturas del mismo mes.
 *
 * Las dos cosas vienen del mismo reporte de cobranza, y las dos eran reales:
 *
 *   «tengo estos clientes con más de una factura que no he podido subir porque
 *    sólo tienen espacio para una factura»
 *   «el importe no es el correcto, pero no me deja mover»
 *
 * La primera ya se había arreglado a medias: se quitó la restricción de la base
 * y se dejó una comprobación para frenar el doble clic. Pero esa comprobación
 * corría SIEMPRE, incluso cuando venía folio fiscal, y el mensaje de error
 * decía «captúrale su folio fiscal». O sea que se le pedía a cobranza hacer
 * exactamente lo que no servía. El caso que bloqueaba es el más común de todos:
 * un cliente al que se le factura por sede recibe dos facturas del mismo mes,
 * mismo concepto, misma fecha y MISMO importe, con dos folios distintos.
 *
 * La segunda no existía en absoluto. Y lo que parecía funcionar era peor que
 * nada: mandar el importe corregido caía en el registro de pagos, así que la
 * plataforma entendía «me pagaron esto» cuando le decían «esto está mal
 * escrito».
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;
let servicioId;

const facturar = (sesion, cuerpo) =>
  sesion.pedir('/api/facturas', { method: 'POST', body: JSON.stringify({ servicio_id: servicioId, ...cuerpo }) });

const corregir = (sesion, id, correccion) =>
  sesion.pedir('/api/facturas', { method: 'PATCH', body: JSON.stringify({ id, correccion }) });

const estadoDeCuenta = async (sesion) =>
  (await sesion.pedir(`/api/facturas?servicio_id=${servicioId}`)).json;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);

  const alta = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ servicio: 'CLIENTE CON DOS SEDES', fecha: '2026-01-05', guardias: 4 }),
  });
  assert.equal(alta.status, 201, alta.texto);
  servicioId = alta.json.servicioId;
});

after(async () => {
  await app?.cerrar();
});

describe('varias facturas del mismo mes', () => {
  test('dos sedes, mismo importe, folios distintos: entran las dos', async () => {
    // El caso exacto que cobranza no podía capturar. Dos facturas con folios
    // fiscales distintos son dos facturas: eso no es una interpretación
    // nuestra, es lo que significa un folio fiscal.
    const base = { periodo: '2026-08', concepto: 'Mes completo', fecha_factura: '2026-08-31', importe: 42094 };
    const a = await facturar(finanzas, { ...base, folio: 'A-100' });
    const b = await facturar(finanzas, { ...base, folio: 'A-101' });

    assert.equal(a.status, 201, a.texto);
    assert.equal(b.status, 201, b.texto);
    assert.notEqual(a.json.id, b.json.id);

    const { resumen } = await estadoDeCuenta(finanzas);
    assert.equal(resumen.emitido, 42094 * 2, 'el mes tiene que quedar cobrado completo, en dos papeles');
  });

  test('y una tercera del mismo mes, si trae su folio', async () => {
    const r = await facturar(finanzas, {
      periodo: '2026-08',
      concepto: 'Mes completo',
      fecha_factura: '2026-08-31',
      importe: 42094,
      folio: 'A-102',
    });
    assert.equal(r.status, 201, r.texto);
  });

  test('sin folio, dos idénticas siguen frenándose: eso es el doble clic', async () => {
    // La protección que sí tenía sentido no se pierde. Sin folio no hay
    // identificador, y dos facturas iguales en todo son la misma capturada dos
    // veces.
    const base = { periodo: '2026-09', concepto: 'Mes completo', fecha_factura: '2026-09-30', importe: 5000 };
    assert.equal((await facturar(finanzas, base)).status, 201);

    const dos = await facturar(finanzas, base);
    assert.equal(dos.status, 400);
    assert.match(dos.json.error, /idéntica/i);
  });

  test('el estado de cuenta las devuelve todas, distinguibles por folio', async () => {
    // Es lo que necesita la pantalla para poder decir «este mes ya lleva tres
    // facturas por $X» arriba del formulario. Cobranza leyó el formulario de un
    // solo juego de campos como «solo tengo un espacio», y tenía razón en lo
    // que veía: nada le decía cuántas llevaba el mes ni que podía seguir.
    //
    // Que el formulario se quede abierto después de guardar se comprobó en un
    // navegador de verdad; aquí se fija que los datos con los que se dibuja
    // lleguen completos, que es lo que esta suite puede sostener.
    const { facturas } = await estadoDeCuenta(finanzas);
    const agosto = facturas.filter((f) => f.periodo === '2026-08' && !f.cancelada);
    assert.equal(agosto.length, 3, 'las tres facturas de agosto tienen que venir en el estado de cuenta');
    assert.deepEqual(
      agosto.map((f) => f.folio).sort(),
      ['A-100', 'A-101', 'A-102'],
      'cada una con su folio: es lo que las distingue en pantalla'
    );
  });

  test('el mismo folio dos veces sí se frena: es la misma factura', async () => {
    const r = await facturar(finanzas, {
      periodo: '2026-08',
      concepto: 'Mes completo',
      fecha_factura: '2026-08-31',
      importe: 99,
      folio: 'A-100',
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /A-100/);
  });
});

describe('corregir una factura', () => {
  let id;

  before(async () => {
    const r = await facturar(finanzas, {
      periodo: '2026-10',
      concepto: 'Mes completo',
      fecha_factura: '2026-10-31',
      importe: 42094,
      folio: 'B-200',
    });
    assert.equal(r.status, 201, r.texto);
    id = r.json.id;
  });

  test('finanzas corrige el importe: es quien tiene la factura en la mano', async () => {
    // Sin esto había que pedirle a un administrador que arreglara un número, y
    // así es como se llega a que nadie lo arregle.
    const r = await corregir(finanzas, id, {
      motivo: 'El importe venía del acuerdo viejo, antes del incremento.',
      importe: 84188,
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.cambios.importe, { antes: 42094, despues: 84188 });
  });

  test('el saldo del servicio se recalcula solo', async () => {
    const { facturas } = await estadoDeCuenta(finanzas);
    const f = facturas.find((x) => x.id === id);
    assert.equal(f.importe, 84188);
    assert.equal(f.saldo, 84188, 'el saldo tiene que seguir al importe, no quedarse en el viejo');
  });

  test('sin motivo no procede', async () => {
    const r = await corregir(finanzas, id, { importe: 1 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /motivo/i);
  });

  test('queda en la bitácora, con el antes y el después', async () => {
    const html = (await admin.pedir('/bitacora')).texto;
    assert.match(html, /factura_corregida/);
  });

  test('sin cambios reales lo dice y no registra nada', async () => {
    const r = await corregir(finanzas, id, { motivo: 'Reviso y está bien.', importe: 84188 });
    assert.equal(r.status, 200);
    assert.equal(r.json.sinCambios, true);
  });

  test('cambiar la fecha recalcula el vencimiento con el crédito que ya tenía', async () => {
    // No con el que el servicio tenga hoy: esa era la condición pactada cuando
    // se emitió, y renegociar el plazo no reescribe lo ya facturado.
    const r = await corregir(finanzas, id, {
      motivo: 'La factura se emitió el día 15, no a fin de mes.',
      fecha_factura: '2026-10-15',
    });
    assert.equal(r.status, 200, r.texto);
    const f = (await estadoDeCuenta(finanzas)).facturas.find((x) => x.id === id);
    assert.equal(f.fecha_factura, '2026-10-15');
    assert.equal(f.fecha_vencimiento, '2026-10-15', 'sin días de crédito, vence el mismo día');
  });
});

describe('lo que la corrección no puede hacer', () => {
  let id;

  before(async () => {
    const r = await facturar(finanzas, {
      periodo: '2026-11',
      concepto: 'Mes completo',
      fecha_factura: '2026-11-30',
      importe: 50000,
      folio: 'C-300',
    });
    id = r.json.id;
    const pago = await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id, pago: { fecha: '2026-12-01', importe: 40000, referencia: 'SPEI' } }),
    });
    assert.equal(pago.status, 200, pago.texto);
  });

  test('dejarla por debajo de lo ya cobrado', async () => {
    // El saldo se volvería negativo y el cliente aparecería con dinero a favor
    // que nadie le debe.
    const r = await corregir(finanzas, id, { motivo: 'Bajarla por debajo del pago.', importe: 30000 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /cobrados/);

    const f = (await estadoDeCuenta(finanzas)).facturas.find((x) => x.id === id);
    assert.equal(f.importe, 50000, 'la factura quedó como estaba');
  });

  test('pero sí subirla por encima', async () => {
    const r = await corregir(finanzas, id, { motivo: 'El CFDI dice 55,000.', importe: 55000 });
    assert.equal(r.status, 200, r.texto);
    const f = (await estadoDeCuenta(finanzas)).facturas.find((x) => x.id === id);
    assert.equal(f.saldo, 15000);
  });

  test('un importe en cero o negativo', async () => {
    for (const importe of [0, -100]) {
      const r = await corregir(finanzas, id, { motivo: 'Importe imposible.', importe });
      assert.equal(r.status, 400, `${importe} no debería pasar`);
    }
  });

  test('repetir el folio de otra factura del mismo mes', async () => {
    const otra = await facturar(finanzas, {
      periodo: '2026-11',
      concepto: 'Extraordinaria',
      fecha_factura: '2026-11-30',
      importe: 1000,
      folio: 'C-301',
    });
    assert.equal(otra.status, 201, otra.texto);

    const r = await corregir(finanzas, otra.json.id, { motivo: 'Prueba de folio repetido.', folio: 'C-300' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /C-300/);
  });

  test('corregir una factura cancelada', async () => {
    const nueva = await facturar(finanzas, {
      periodo: '2026-12',
      concepto: 'Mes completo',
      fecha_factura: '2026-12-31',
      importe: 7000,
      folio: 'D-400',
    });
    const cancelada = await admin.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: nueva.json.id, cancelar: 'Se emitió al cliente equivocado.' }),
    });
    assert.equal(cancelada.status, 200, cancelada.texto);

    const r = await corregir(finanzas, nueva.json.id, { motivo: 'Intento sobre una cancelada.', importe: 8000 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /cancelada/i);
  });
});

describe('quién puede corregir una factura', () => {
  test('ventas y operaciones no', async () => {
    const { facturas } = await estadoDeCuenta(finanzas);
    const id = facturas[0].id;
    for (const rol of ['ventas', 'operaciones']) {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await corregir(sesion, id, { motivo: 'Intento desde un rol sin cobranza.', importe: 1 });
      assert.equal(r.status, 403, `${rol} no debería poder`);
    }
  });

  test('sin sesión tampoco', async () => {
    const r = await app.anonimo().pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: 1, correccion: { motivo: 'Intento sin sesión.', importe: 1 } }),
    });
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });
});
