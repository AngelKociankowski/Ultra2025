/**
 * Cobranza: facturación, pagos y la frontera entre cuenta corriente y adeudo.
 *
 * La regla que se prueba aquí es la que pidió el negocio y la que más fácil se
 * rompe al programarla:
 *
 *     una factura sin pagar NO es un adeudo mientras le corra el crédito.
 *
 * Es tentador sumar todo lo no cobrado y llamarle deuda. Con eso, un cliente al
 * que se le factura el día 1 a 30 días aparecería debiendo el día 2, y la
 * cartera vencida diría cosas que no son. Por eso casi todas las pruebas de
 * abajo miran la misma distinción desde ángulos distintos.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;
let ventas;
let juridico;

/** Fechas relativas a hoy, para no depender del día en que corran las pruebas. */
const HOY = new Date().toISOString().slice(0, 10);
function haceDias(n) {
  const d = new Date(`${HOY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
});

after(async () => {
  await app?.cerrar();
});

/** Abre un servicio con condiciones de cobro y devuelve su id. */
async function abrir(nombre, condiciones = {}) {
  const r = await ventas.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombre,
      fecha: '2026-07-01',
      turnos: { '24 HRS': 4 },
      guardias: 4,
      ...condiciones,
    }),
  });
  assert.equal(r.status, 201, `no se pudo abrir ${nombre}: ${r.texto}`);
  return r.json.servicioId;
}

async function cobranza(id, cliente = finanzas) {
  const r = await cliente.pedir(`/api/facturas?servicio_id=${id}`);
  assert.equal(r.status, 200);
  return r.json;
}

async function facturar(id, datos) {
  return finanzas.pedir('/api/facturas', {
    method: 'POST',
    body: JSON.stringify({ servicio_id: id, ...datos }),
  });
}

describe('las condiciones de cobro se capturan al abrir el servicio', () => {
  test('forma de pago, esquema y días de crédito quedan en la ficha', async () => {
    const id = await abrir('COBRANZA CONDICIONES', {
      forma_pago: 'TRANSFERENCIA',
      esquema_facturacion: 'MES_VENCIDO',
      dias_credito: 30,
      credito_maximo: 500000,
    });
    const s = (await ventas.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.forma_pago, 'TRANSFERENCIA');
    assert.equal(s.esquema_facturacion, 'MES_VENCIDO');
    assert.equal(s.dias_credito, 30);
    assert.equal(s.credito_maximo, 500000);
  });

  test('la forma de pago también sale del catálogo', async () => {
    const r = await ventas.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'COBRANZA FORMA INVENTADA',
        fecha: '2026-07-01',
        turnos: { '24 HRS': 1 },
        forma_pago: 'COSTALES DE MONEDAS',
      }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no está en el catálogo/);
  });

  test('un esquema de facturación inventado se rechaza', async () => {
    const r = await ventas.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'COBRANZA ESQUEMA INVENTADO',
        fecha: '2026-07-01',
        turnos: { '24 HRS': 1 },
        esquema_facturacion: 'CUANDO_SE_PUEDA',
      }),
    });
    assert.equal(r.status, 400);
  });
});

describe('el adeudo empieza cuando termina el crédito', () => {
  test('una factura de hoy a 30 días es cuenta corriente, no adeudo', async () => {
    const id = await abrir('COBRANZA CREDITO VIGENTE', {
      esquema_facturacion: 'MES_VENCIDO',
      dias_credito: 30,
    });
    const r = await facturar(id, { periodo: '2026-07', fecha_factura: HOY, importe: 100000 });
    assert.equal(r.status, 201, r.texto);

    const { facturas, resumen } = await cobranza(id);
    assert.equal(facturas[0].estado, 'POR VENCER');
    assert.equal(resumen.porVencer, 100000);
    assert.equal(resumen.vencido, 0, 'todavía no debe nada: le corre el plazo');
    assert.equal(resumen.pendiente, 100000);
  });

  test('la misma factura, pasado el plazo, sí es adeudo', async () => {
    const id = await abrir('COBRANZA CREDITO AGOTADO', {
      esquema_facturacion: 'MES_VENCIDO',
      dias_credito: 30,
    });
    // emitida hace 40 días con 30 de crédito: venció hace 10
    await facturar(id, { periodo: '2026-05', fecha_factura: haceDias(40), importe: 80000 });

    const { facturas, resumen } = await cobranza(id);
    assert.equal(facturas[0].estado, 'VENCIDA');
    assert.equal(resumen.vencido, 80000);
    assert.equal(resumen.porVencer, 0);
    assert.equal(Math.abs(facturas[0].dias), 10, 'lleva 10 días de atraso');
  });

  test('sin crédito pactado, la factura vence el mismo día que se emite', async () => {
    const id = await abrir('COBRANZA SIN CREDITO', { esquema_facturacion: 'INICIO_MES' });
    const r = await facturar(id, { periodo: '2026-07', fecha_factura: haceDias(1), importe: 50000 });
    assert.equal(r.status, 201);
    assert.equal(r.json.fecha_vencimiento, haceDias(1), 'vence el día de la emisión');
    assert.equal(r.json.dias_credito, 0);

    const { resumen } = await cobranza(id);
    assert.equal(resumen.vencido, 50000);
  });

  test('el vencimiento se calcula con los días de crédito, no con lo que mande el cliente', async () => {
    const id = await abrir('COBRANZA VENCIMIENTO CALCULADO', { dias_credito: 15 });
    const r = await facturar(id, {
      periodo: '2026-07',
      fecha_factura: '2026-07-01',
      importe: 10000,
      fecha_vencimiento: '2099-01-01', // intento de estirar el plazo
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.fecha_vencimiento, '2026-07-16');
  });
});

describe('el saldo crece con las facturas y baja con los pagos', () => {
  let id;

  test('tres meses sin pagar suman', async () => {
    id = await abrir('COBRANZA SALDO CRECIENTE', {
      esquema_facturacion: 'MES_VENCIDO',
      dias_credito: 30,
    });
    for (const [periodo, dias] of [['2026-04', 100], ['2026-05', 70], ['2026-06', 40]]) {
      const r = await facturar(id, { periodo, fecha_factura: haceDias(dias), importe: 30000 });
      assert.equal(r.status, 201, r.texto);
    }
    const { resumen } = await cobranza(id);
    assert.equal(resumen.emitido, 90000);
    assert.equal(resumen.pendiente, 90000);
    assert.equal(resumen.vencido, 90000, 'las tres pasaron su plazo');
    assert.equal(resumen.vencidas, 3);
  });

  test('un pago parcial baja el saldo y deja la factura abierta', async () => {
    const { facturas } = await cobranza(id);
    const vieja = facturas[facturas.length - 1];
    const r = await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: vieja.id, pago: { fecha: HOY, importe: 10000 } }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.saldada, false);
    assert.equal(r.json.saldo, 20000);

    const despues = await cobranza(id);
    assert.equal(despues.resumen.cobrado, 10000);
    assert.equal(despues.resumen.pendiente, 80000);
    const misma = despues.facturas.find((f) => f.id === vieja.id);
    assert.equal(misma.estado, 'VENCIDA');
    assert.equal(misma.parcial, true);
  });

  test('el pago que liquida cierra la factura', async () => {
    const { facturas } = await cobranza(id);
    const abierta = facturas.find((f) => f.saldo === 20000);
    // sin importe se entiende que liquida el saldo
    const r = await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: abierta.id, pago: { fecha: HOY } }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.saldada, true);

    const despues = await cobranza(id);
    assert.equal(despues.facturas.find((f) => f.id === abierta.id).estado, 'PAGADA');
    assert.equal(despues.resumen.pendiente, 60000);
  });

  test('no se puede cobrar más que el saldo de la factura', async () => {
    const { facturas } = await cobranza(id);
    const abierta = facturas.find((f) => f.saldo > 0);
    const r = await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: abierta.id, pago: { fecha: HOY, importe: abierta.saldo + 1 } }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /mayor que el saldo/);
  });

  test('el saldo del servicio queda copiado en su ficha', async () => {
    const s = (await ventas.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.importe_pendiente, 60000);
    assert.equal(s.saldo_vencido, 60000);
    assert.equal(s.facturado, 1, 'tener facturas emitidas lo marca como facturado');
  });
});

describe('el saldo se calcula, no se captura', () => {
  test('finanzas no puede teclear el pendiente ni el vencido', async () => {
    const id = await abrir('COBRANZA SALDO A MANO');
    const r = await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_pendiente: 999999, saldo_vencido: 999999 }),
    });
    // ningún campo aplicable: la petición se rechaza entera
    assert.equal(r.status, 403);

    const s = (await ventas.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.notEqual(s.importe_pendiente, 999999);
  });

  test('sí puede capturar las condiciones que lo generan', async () => {
    const id = await abrir('COBRANZA CONDICIONES EDITABLES');
    const r = await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ esquema_facturacion: 'QUINCENAL', dias_credito: 45, importe_factura: 120000 }),
    });
    assert.equal(r.status, 200, r.texto);
    const s = (await ventas.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.esquema_facturacion, 'QUINCENAL');
    assert.equal(s.dias_credito, 45);
  });
});

describe('quién mueve la cobranza', () => {
  test('ventas, operaciones y jurídico no facturan ni cobran', async () => {
    const id = await abrir('COBRANZA PERMISOS');
    for (const [rol, cliente] of [['ventas', ventas], ['jurídico', juridico]]) {
      const r = await cliente.pedir('/api/facturas', {
        method: 'POST',
        body: JSON.stringify({ servicio_id: id, periodo: '2026-07', fecha_factura: HOY, importe: 1000 }),
      });
      assert.equal(r.status, 403, `${rol} no debería poder facturar`);
    }
  });

  test('pero cualquiera puede consultar el estado de cuenta', async () => {
    const id = await abrir('COBRANZA CONSULTA');
    const r = await ventas.pedir(`/api/facturas?servicio_id=${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.resumen.pendiente, 0);
  });
});

describe('la lista de lo que falta facturar', () => {
  const pendientes = async (periodo) => {
    const r = await finanzas.pedir(`/api/facturas?pendientes=1&periodo=${periodo}`);
    assert.equal(r.status, 200);
    return r.json;
  };

  test('propone fecha e importe a cada servicio, pero no emite nada', async () => {
    const id = await abrir('COBRANZA PENDIENTE', {
      esquema_facturacion: 'MES_VENCIDO',
      dias_credito: 30,
    });
    await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 200000 }),
    });

    const lista = await pendientes('2026-08');
    const fila = lista.porFacturar.find((f) => f.servicio_id === id);
    assert.ok(fila, 'el servicio con condiciones aparece en la lista');
    assert.equal(fila.importe, 200000);
    // mes vencido: se facturaría el día 1 del mes siguiente al trabajado
    assert.equal(fila.fecha, '2026-09-01');
    assert.equal(fila.fecha_vencimiento, '2026-10-01');

    // consultar la lista no crea nada: el servicio sigue sin facturas
    assert.equal((await cobranza(id)).facturas.length, 0);
  });

  test('al facturarlo, sale de la lista', async () => {
    const antes = await pendientes('2026-08');
    const fila = antes.porFacturar.find((f) => f.servicio === 'COBRANZA PENDIENTE');

    const r = await facturar(fila.servicio_id, {
      periodo: '2026-08',
      concepto: fila.concepto,
      fecha_factura: fila.fecha,
      importe: fila.importe,
    });
    assert.equal(r.status, 201, r.texto);

    const despues = await pendientes('2026-08');
    assert.ok(
      !despues.porFacturar.some((f) => f.servicio_id === fila.servicio_id),
      'ya no debería aparecer como pendiente'
    );
    assert.equal(despues.facturados, antes.facturados + 1);
  });

  test('las quincenas aparecen como dos renglones de la mitad', async () => {
    const id = await abrir('COBRANZA QUINCENAL', {
      esquema_facturacion: 'QUINCENAL',
      dias_credito: 15,
    });
    await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 100000 }),
    });

    const lista = await pendientes('2026-09');
    const suyas = lista.porFacturar.filter((f) => f.servicio_id === id);
    assert.equal(suyas.length, 2);
    assert.deepEqual(suyas.map((f) => f.fecha).sort(), ['2026-09-01', '2026-09-16']);
    assert.equal(suyas.reduce((a, f) => a + f.importe, 0), 100000);
  });

  test('un servicio sin condiciones también se puede facturar: entra sin fecha propuesta', async () => {
    const lista = await pendientes('2026-08');
    assert.ok(lista.sinCondiciones.length > 0, 'los de la carga inicial no traen esquema');

    const suelto = lista.porFacturar.find((f) => f.sinCondiciones);
    assert.ok(suelto, 'tiene que aparecer en la lista, no apartado de ella');
    assert.equal(suelto.fecha, null, 'sin esquema no hay fecha que proponer');
    assert.equal(suelto.concepto, 'Mes completo');

    // y facturarlo funciona capturando la fecha a mano
    const r = await facturar(suelto.servicio_id, {
      periodo: '2026-08',
      concepto: suelto.concepto,
      fecha_factura: '2026-08-31',
      importe: 12345,
    });
    assert.equal(r.status, 201, r.texto);

    const despues = await pendientes('2026-08');
    assert.ok(
      !despues.porFacturar.some((f) => f.servicio_id === suelto.servicio_id),
      'ya facturado, sale de la lista'
    );
  });

  test('no existe una vía para facturarlo todo de golpe', async () => {
    const r = await finanzas.pedir('/api/facturas/generar', {
      method: 'POST',
      body: JSON.stringify({ periodo: '2026-08' }),
    });
    assert.ok([404, 405].includes(r.status), `debería no existir; contestó ${r.status}`);
  });

  test('no se factura dos veces el mismo tramo del mismo mes', async () => {
    const id = await abrir('COBRANZA DUPLICADA', { dias_credito: 10 });
    await facturar(id, { periodo: '2026-07', fecha_factura: '2026-07-01', importe: 5000 });
    const r = await facturar(id, { periodo: '2026-07', fecha_factura: '2026-07-02', importe: 5000 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Ya hay una factura/);
  });
});

describe('puesta al día: condiciones en bloque y carga de lo ya facturado', () => {
  test('ventas no puede tocar ninguna de las dos', async () => {
    const a = await ventas.pedir('/api/facturas/condiciones', {
      method: 'POST',
      body: JSON.stringify({ esquema_facturacion: 'MES_VENCIDO', dias_credito: 30 }),
    });
    assert.equal(a.status, 403);

    const b = await ventas.pedir('/api/facturas/carga', {
      method: 'POST',
      body: JSON.stringify({ csv: 'id;servicio\n1;X', simular: true }),
    });
    assert.equal(b.status, 403);
  });

  test('las condiciones se aplican a los servicios que no tenían, sin emitir nada', async () => {
    const antes = await finanzas.pedir('/api/facturas?pendientes=1&periodo=2026-10');
    assert.ok(antes.json.sinCondiciones.length > 100, 'la carga inicial viene sin condiciones');
    const facturasAntes = (await finanzas.pedir('/api/facturas')).json.vencidas.length;

    const r = await finanzas.pedir('/api/facturas/condiciones', {
      method: 'POST',
      body: JSON.stringify({
        esquema_facturacion: 'MES_VENCIDO',
        dias_credito: 30,
        forma_pago: 'TRANSFERENCIA',
        alcance: 'sin_condiciones',
      }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.aplicados > 100);

    const despues = await finanzas.pedir('/api/facturas?pendientes=1&periodo=2026-10');
    assert.equal(despues.json.sinCondiciones.length, 0, 'ya nadie se queda sin fecha');
    assert.ok(despues.json.porFacturar.length > 100, 'ahora sí se les puede proponer factura');

    // configurar no emite: la cartera no se movió
    assert.equal((await finanzas.pedir('/api/facturas')).json.vencidas.length, facturasAntes);
  });

  test('un esquema inventado se rechaza', async () => {
    const r = await finanzas.pedir('/api/facturas/condiciones', {
      method: 'POST',
      body: JSON.stringify({ esquema_facturacion: 'CUANDO_CAIGA', dias_credito: 10 }),
    });
    assert.equal(r.status, 400);
  });

  test('la plantilla sale en CSV con un renglón por servicio', async () => {
    const r = await finanzas.pedir('/api/facturas/carga?periodo=2026-10');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    const lineas = r.texto.trim().split('\r\n');
    assert.match(lineas[0], /Servicio/);
    assert.ok(lineas.length > 100, 'trae los servicios activos');
  });

  test('la revisión en seco encuentra los errores y no guarda nada', async () => {
    const id = await abrir('CARGA INICIAL DEMO', { esquema_facturacion: 'MES_VENCIDO', dias_credito: 30 });
    const csv = [
      'id;Servicio;Periodo;Concepto;Fecha de factura;Días de crédito;Importe;Folio fiscal;¿Pagada?;Fecha de pago',
      `${id};CARGA INICIAL DEMO;2026-03;Mes completo;01/04/2026;30;$ 120,000.00;A-1;;`,
      `${id};CARGA INICIAL DEMO;2026-04;Mes completo;01/05/2026;30;120000;A-2;SI;15/05/2026`,
      `;SERVICIO QUE NO EXISTE;2026-03;Mes completo;01/04/2026;30;5000;;;`,
      `${id};CARGA INICIAL DEMO;2026-05;Mes completo;;30;5000;;;`,
    ].join('\n');

    const r = await finanzas.pedir('/api/facturas/carga', {
      method: 'POST',
      body: JSON.stringify({ csv, simular: true }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.listas, 2, 'dos renglones buenos');
    assert.equal(r.json.errores.length, 2, 'uno sin servicio y otro sin fecha');
    assert.equal(r.json.importe, 240000, 'lee "$ 120,000.00" y "120000" igual');
    assert.equal(r.json.pagadas, 1);
    assert.equal(r.json.porCobrar, 120000);
    assert.match(r.json.errores[0].motivo, /No se encontró/);
    assert.match(r.json.errores[1].motivo, /fecha/);

    // en seco no guarda
    assert.equal((await cobranza(id)).facturas.length, 0);
  });

  test('la carga de verdad crea las facturas y mueve el saldo', async () => {
    const lista = (await finanzas.pedir('/api/facturas?pendientes=1&periodo=2026-03')).json;
    const fila = lista.porFacturar.find((f) => f.servicio === 'CARGA INICIAL DEMO');
    assert.ok(fila, 'estaba pendiente antes de cargarla');

    const csv = [
      'id;Servicio;Periodo;Concepto;Fecha de factura;Días de crédito;Importe;Folio fiscal;¿Pagada?;Fecha de pago',
      `${fila.servicio_id};CARGA INICIAL DEMO;2026-03;Mes completo;01/04/2026;30;$ 120,000.00;A-1;;`,
      `${fila.servicio_id};CARGA INICIAL DEMO;2026-04;Mes completo;01/05/2026;30;120000;A-2;SI;15/05/2026`,
    ].join('\n');

    const r = await finanzas.pedir('/api/facturas/carga', {
      method: 'POST',
      body: JSON.stringify({ csv, simular: false }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.cargadas, 2);

    const { facturas, resumen } = await cobranza(fila.servicio_id);
    assert.equal(facturas.length, 2);
    assert.equal(resumen.emitido, 240000);
    assert.equal(resumen.cobrado, 120000, 'la marcada como pagada entra cobrada');
    // ambas son de meses pasados: la que quedó sin pagar es adeudo
    assert.equal(resumen.vencido, 120000);
    assert.equal(facturas.find((f) => f.periodo === '2026-04').estado, 'PAGADA');
    assert.equal(facturas.find((f) => f.periodo === '2026-03').estado, 'VENCIDA');
  });

  test('subir dos veces el mismo archivo no duplica nada', async () => {
    const lista = (await finanzas.pedir('/api/facturas?pendientes=1&periodo=2026-05')).json;
    const servicioId = lista.porFacturar.find((f) => f.servicio === 'CARGA INICIAL DEMO')?.servicio_id;
    const csv = [
      'id;Servicio;Periodo;Concepto;Fecha de factura;Días de crédito;Importe',
      `${servicioId};CARGA INICIAL DEMO;2026-03;Mes completo;01/04/2026;30;120000`,
    ].join('\n');

    const r = await finanzas.pedir('/api/facturas/carga', {
      method: 'POST',
      body: JSON.stringify({ csv, simular: true }),
    });
    assert.equal(r.json.listas, 0);
    assert.match(r.json.errores[0].motivo, /Ya hay una factura/);
  });
});

describe('cancelar una factura mal registrada', () => {
  test('solo el administrador, y sale del saldo', async () => {
    const id = await abrir('COBRANZA CANCELAR', { dias_credito: 30 });
    const alta = await facturar(id, { periodo: '2026-07', fecha_factura: HOY, importe: 70000 });
    const facturaId = alta.json.id;
    assert.equal((await cobranza(id)).resumen.pendiente, 70000);

    const noPuede = await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: facturaId, cancelar: 'se emitió al cliente equivocado' }),
    });
    assert.equal(noPuede.status, 403);

    const si = await admin.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: facturaId, cancelar: 'se emitió al cliente equivocado' }),
    });
    assert.equal(si.status, 200);

    const despues = await cobranza(id);
    assert.equal(despues.resumen.pendiente, 0, 'la cancelada ya no cuenta');
    assert.equal(despues.facturas[0].estado, 'CANCELADA');
    assert.match(despues.facturas[0].motivo_cancelacion, /cliente equivocado/);
  });

  test('una factura con pagos no se cancela', async () => {
    const id = await abrir('COBRANZA CANCELAR CON PAGO', { dias_credito: 30 });
    const alta = await facturar(id, { periodo: '2026-07', fecha_factura: HOY, importe: 40000 });
    await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: alta.json.id, pago: { fecha: HOY, importe: 1000 } }),
    });

    const r = await admin.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: alta.json.id, cancelar: 'me equivoqué' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /pagos registrados/);
  });
});

describe('el archivo de la factura', () => {
  /** Un PDF mínimo pero válido: empieza con la firma que trae cualquier PDF. */
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');

  async function subir(cliente, facturaId, { nombre = 'factura.pdf', tipo = 'application/pdf', datos = PDF } = {}) {
    const form = new FormData();
    form.append('archivo', new Blob([datos], { type: tipo }), nombre);
    // sin Content-Type propio: lo pone fetch con su frontera
    const r = await fetch(`${app.base}/api/facturas/${facturaId}/archivo`, {
      method: 'POST',
      headers: { cookie: cliente.cookie },
      body: form,
      redirect: 'manual',
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* html */ }
    return { status: r.status, json, texto };
  }

  let facturaId;

  test('se adjunta el PDF a una factura ya registrada', async () => {
    const id = await abrir('COBRANZA CON PDF', { dias_credito: 30 });
    const alta = await facturar(id, { periodo: '2026-07', fecha_factura: HOY, importe: 90000 });
    assert.equal(alta.status, 201);
    facturaId = alta.json.id;

    const r = await subir(finanzas, facturaId, { nombre: 'A-1234.pdf' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.archivo_nombre, 'A-1234.pdf');

    const { facturas } = await cobranza(id);
    assert.ok(facturas[0].archivo, 'la factura queda con su archivo');
    assert.equal(facturas[0].archivo_tipo, 'application/pdf');
  });

  test('se descarga con el nombre con el que se subió', async () => {
    const r = await fetch(`${app.base}/api/facturas/${facturaId}/archivo`, {
      headers: { cookie: ventas.cookie },
    });
    assert.equal(r.status, 200, 'consultar el respaldo es de cualquier rol');
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="A-1234\.pdf"/);
    const cuerpo = Buffer.from(await r.arrayBuffer());
    assert.ok(cuerpo.subarray(0, 5).toString() === '%PDF-', 'llega el archivo tal cual');
  });

  test('solo entran PDF y XML', async () => {
    const r = await subir(finanzas, facturaId, {
      nombre: 'virus.exe',
      tipo: 'application/x-msdownload',
      datos: Buffer.from('MZ...'),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /PDF o XML/);
  });

  test('ventas no sube archivos', async () => {
    const r = await subir(ventas, facturaId);
    assert.equal(r.status, 403);
  });

  test('una factura sin archivo lo dice, no truena', async () => {
    const id = await abrir('COBRANZA SIN PDF', { dias_credito: 15 });
    const alta = await facturar(id, { periodo: '2026-07', fecha_factura: HOY, importe: 1000 });
    const r = await ventas.pedir(`/api/facturas/${alta.json.id}/archivo`);
    assert.equal(r.status, 404);
    assert.match(r.json.error, /no tiene archivo/);
  });
});

describe('el calendario del año', () => {
  /**
   * React separa los trozos de texto con comentarios vacíos, así que
   * «Ya facturado — 2026-03» llega al HTML partido en tres. Se quitan antes de
   * buscar: lo que se está probando es lo que ve la persona, no cómo lo arma
   * el framework.
   */
  const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

  test('cada mes dice cuántas se emitieron y cuántas faltan', async () => {
    const r = await finanzas.pedir('/cobranza?periodo=2026-03');
    assert.equal(r.status, 200);
    // los doce meses del año elegido, y el que se está viendo marcado
    for (const mes of ['Ene', 'Feb', 'Mar', 'Dic']) {
      assert.match(r.texto, new RegExp(mes), `falta ${mes} en el calendario`);
    }
    assert.match(r.texto, /Calendario de facturación/);
    assert.match(r.texto, /emitidas \/ esperadas/);
  });

  test('la pantalla muestra también lo ya facturado de ese mes', async () => {
    const r = await finanzas.pedir('/cobranza?periodo=2026-03');
    const html = comoSeLee(r.texto);
    assert.match(html, /Ya facturado — 2026-03/);
    // en 2026-03 quedó la factura de la carga inicial, sin pagar
    assert.match(html, /CARGA INICIAL DEMO/);
    assert.match(html, /VENCIDA/);
  });

  test('un mes sin nada lo dice sin inventar pendientes', async () => {
    const r = await finanzas.pedir('/cobranza?periodo=2026-12');
    assert.equal(r.status, 200);
    assert.match(comoSeLee(r.texto), /Todavía no se ha emitido ninguna factura de 2026-12/);
  });
});

describe('la cartera vencida y la bitácora', () => {
  test('la cartera vencida solo trae lo que pasó su plazo', async () => {
    const r = await finanzas.pedir('/api/facturas');
    assert.equal(r.status, 200);
    assert.ok(r.json.vencidas.length > 0);
    for (const f of r.json.vencidas) {
      assert.ok(f.fecha_vencimiento < HOY, `${f.servicio} no debería estar en la cartera vencida`);
      assert.ok(f.saldo > 0);
    }
  });

  test('facturas, pagos y cancelaciones quedan registrados', async () => {
    const r = await admin.pedir('/bitacora');
    for (const accion of ['factura', 'pago', 'factura_cancelada']) {
      assert.match(r.texto, new RegExp(accion), `falta ${accion} en la bitácora`);
    }
  });
});
