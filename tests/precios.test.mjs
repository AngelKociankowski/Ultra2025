/**
 * El aumento anual de precio.
 *
 * Cada cliente tiene pactado un mes en el que se le revisa el precio, y no es
 * el mismo para todos. La pregunta que la plataforma tiene que contestar bien
 * el primer día de cada mes es «a quién le toca y no se le ha subido», porque
 * un aumento que se olvida no falla ni avisa: la factura sale igual que
 * siempre y el cliente paga el precio del año pasado hasta que alguien lo nota.
 *
 * Se prueba eso, y las tres cosas que un cambio de precio no puede hacer:
 * tocar facturas ya emitidas, inventar precios donde no había, y pasar sin
 * dejar rastro de quién lo hizo y por qué.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;
let ventas;
let operaciones;

const hoyEnMexico = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

/** Un servicio nuevo con precio, listo para moverle el importe. */
async function servicioCon({ nombre, importe, sinIva = null, precio = null, mes = null, anio = null }) {
  const alta = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': 2 } }),
  });
  assert.equal(alta.status, 201, alta.texto);
  const id = alta.json.servicioId;

  if (importe !== null) {
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: importe, ...(sinIva !== null ? { importe_sin_iva: sinIva } : {}) }),
    });
    assert.equal(r.status, 200, r.texto);
  }
  if (precio !== null || mes !== null || anio !== null) {
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(precio !== null ? { precio_guardia: precio } : {}),
        ...(mes !== null ? { mes_incremento: mes } : {}),
        ...(anio !== null ? { anio_ultimo_incremento: anio } : {}),
      }),
    });
    assert.equal(r.status, 200, r.texto);
  }
  return id;
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
});

after(async () => {
  await app?.cerrar();
});

describe('a quién le toca el aumento', () => {
  test('el que no ha subido este año y su mes ya pasó sale como pendiente', async () => {
    const hoy = hoyEnMexico();
    const anioPasado = String(Number(hoy.slice(0, 4)) - 1);
    const mesHoy = Number(hoy.slice(5, 7));
    if (mesHoy === 1) return; // en enero no hay mes anterior en el mismo año

    const id = await servicioCon({
      nombre: 'PRECIO SE LE PASO',
      importe: 10000,
      mes: MESES[mesHoy - 1],
      anio: anioPasado,
    });
    const { servicios } = (await admin.pedir('/api/precios?estado=vencido')).json;
    const mio = servicios.find((s) => s.id === id);
    assert.ok(mio, 'debería estar entre los que se les pasó');
    assert.equal(mio.estado, 'vencido');
  });

  test('el que ya subió este año queda al corriente', async () => {
    const hoy = hoyEnMexico();
    const id = await servicioCon({
      nombre: 'PRECIO YA SUBIO',
      importe: 10000,
      mes: 'enero',
      anio: hoy.slice(0, 4),
    });
    const { servicios } = (await admin.pedir('/api/precios')).json;
    assert.equal(servicios.find((s) => s.id === id).estado, 'al_corriente');
  });

  test('el que nunca tuvo mes anotado se distingue de los demás', async () => {
    const id = await servicioCon({ nombre: 'PRECIO SIN MES', importe: 10000 });
    const { servicios } = (await admin.pedir('/api/precios?estado=sin_fecha')).json;
    assert.ok(servicios.some((s) => s.id === id));
  });

  test('el mes se reconoce con mayúscula o sin ella: en el archivo viene de las dos formas', async () => {
    const hoy = hoyEnMexico();
    const mesHoy = Number(hoy.slice(5, 7));
    const anioPasado = String(Number(hoy.slice(0, 4)) - 1);
    const id = await servicioCon({
      nombre: 'PRECIO MES CON MAYUSCULA',
      importe: 5000,
      mes: MESES[mesHoy].toUpperCase(),
      anio: anioPasado,
    });
    const { servicios } = (await admin.pedir('/api/precios?estado=este_mes')).json;
    assert.ok(servicios.some((s) => s.id === id), 'AGOSTO y agosto son el mismo mes');
  });

  test('el resumen cuenta cuánto se está facturando al precio viejo', async () => {
    const { resumen } = (await admin.pedir('/api/precios')).json;
    assert.ok(resumen.facturacionMensual > 0);
    assert.ok(resumen.importePendiente >= 0);
    assert.equal(typeof resumen.vencido, 'number');
  });
});

describe('aplicar el aumento', () => {
  test('un porcentaje sube importe, importe sin IVA y precio por guardia a la par', async () => {
    const id = await servicioCon({
      nombre: 'PRECIO SUBE TODO',
      importe: 116000,
      sinIva: 100000,
      precio: 20000,
      mes: 'marzo',
      anio: '2020',
    });

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

    const s = await ficha(id);
    assert.equal(s.importe_factura, 127600);
    assert.equal(s.importe_sin_iva, 110000);
    assert.equal(s.precio_guardia, 22000);
    assert.equal(s.anio_ultimo_incremento, '2026', 'queda anotado el año del aumento');
    assert.equal(s.mes_incremento, 'marzo', 'el mes pactado no se mueve solo');
  });

  test('a lo que no estaba capturado no se le inventa un valor', async () => {
    const id = await servicioCon({ nombre: 'PRECIO SIN PRECIO UNITARIO', importe: 50000 });
    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 8 }, vigencia: '2026-09', motivo: 'anual' }),
    });
    const s = await ficha(id);
    assert.equal(s.importe_factura, 54000);
    assert.equal(s.precio_guardia, null, 'nunca tuvo precio por guardia y sigue sin tenerlo');
    assert.equal(s.importe_sin_iva, null);
  });

  test('un monto fijo se le suma al importe', async () => {
    const id = await servicioCon({ nombre: 'PRECIO MONTO FIJO', importe: 20000 });
    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'MONTO', valor: 1500 }, vigencia: '2026-09', motivo: 'anual' }),
    });
    assert.equal((await ficha(id)).importe_factura, 21500);
  });

  test('un importe exacto deja el precio ahí, y solo se le pone a un servicio', async () => {
    const uno = await servicioCon({ nombre: 'PRECIO IMPORTE EXACTO', importe: 33333 });
    const otro = await servicioCon({ nombre: 'PRECIO IMPORTE EXACTO 2', importe: 44444 });

    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [uno], ajuste: { tipo: 'IMPORTE', valor: 50000 }, vigencia: '2026-09', motivo: 'renegociación' }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(uno)).importe_factura, 50000);

    const dos = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [uno, otro], ajuste: { tipo: 'IMPORTE', valor: 60000 }, vigencia: '2026-09', motivo: 'renegociación' }),
    });
    assert.equal(dos.status, 400, 'el mismo importe para varios clientes casi nunca es lo que se quiso');
    assert.match(dos.json.error, /uno a la vez|un servicio a la vez/i);
  });

  test('se aplica a muchos de una vez y las cuentas cuadran', async () => {
    const ids = [];
    for (const [n, importe] of [['LOTE A', 10000], ['LOTE B', 20000], ['LOTE C', 30000]]) {
      ids.push(await servicioCon({ nombre: `PRECIO ${n}`, importe }));
    }
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids, ajuste: { tipo: 'PORCENTAJE', valor: 5 }, vigencia: '2026-09', motivo: 'Revisión anual' }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.aplicables, 3);
    assert.equal(r.json.totalAntes, 60000);
    assert.equal(r.json.totalDespues, 63000);
    assert.equal(r.json.diferencia, 3000);
    assert.ok(r.json.lote, 'los tres quedan agrupados bajo un mismo lote');

    for (const [i, esperado] of [[0, 10500], [1, 21000], [2, 31500]]) {
      assert.equal((await ficha(ids[i])).importe_factura, esperado);
    }
  });

  test('simular enseña las cuentas y no mueve nada', async () => {
    const id = await servicioCon({ nombre: 'PRECIO SOLO SIMULACION', importe: 10000 });
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 20 }, vigencia: '2026-09', simular: true }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.simulacion, true);
    assert.equal(r.json.totalDespues, 12000);
    assert.equal((await ficha(id)).importe_factura, 10000, 'la ficha sigue igual');
  });

  test('el que no tiene precio capturado se salta, y se dice por qué', async () => {
    const conPrecio = await servicioCon({ nombre: 'PRECIO CON', importe: 10000 });
    const sinPrecio = await servicioCon({ nombre: 'PRECIO SIN', importe: null });
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({
        ids: [conPrecio, sinPrecio],
        ajuste: { tipo: 'PORCENTAJE', valor: 10 },
        vigencia: '2026-09',
        motivo: 'anual',
      }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.aplicables, 1);
    assert.equal(r.json.saltados.length, 1);
    assert.match(r.json.saltados[0].razon, /precio/i);
  });

  test('con la casilla marcada, el mes de revisión pasa a ser el de la vigencia', async () => {
    const id = await servicioCon({ nombre: 'PRECIO FIJAR MES', importe: 10000, mes: 'enero', anio: '2020' });
    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({
        ids: [id],
        ajuste: { tipo: 'PORCENTAJE', valor: 3 },
        vigencia: '2026-11',
        motivo: 'se recorrió la revisión',
        fijarMes: true,
      }),
    });
    const s = await ficha(id);
    assert.equal(s.mes_incremento, 'noviembre');
    assert.equal(s.anio_ultimo_incremento, '2026');
  });

  test('al que no tenía mes anotado se le pone el de la vigencia sin pedirlo', async () => {
    const id = await servicioCon({ nombre: 'PRECIO ESTRENA MES', importe: 10000 });
    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 3 }, vigencia: '2026-04', motivo: 'primera revisión' }),
    });
    assert.equal((await ficha(id)).mes_incremento, 'abril');
  });
});

describe('lo que un cambio de precio no puede hacer', () => {
  test('no toca las facturas ya emitidas ni el saldo que el cliente debe', async () => {
    const id = await servicioCon({ nombre: 'PRECIO NO TOCA FACTURAS', importe: 10000 });

    const factura = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({ servicio_id: id, periodo: '2026-07', fecha_factura: '2026-07-31', importe: 10000 }),
    });
    assert.equal(factura.status, 201, factura.texto);

    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 50 }, vigencia: '2026-09', motivo: 'anual' }),
    });

    const emitidas = (await admin.pedir(`/api/facturas?servicio_id=${id}`)).json.facturas;
    assert.equal(emitidas[0].importe, 10000, 'lo ya facturado se quedó como se facturó');
    assert.equal((await ficha(id)).importe_factura, 15000, 'de aquí en adelante se cobra el nuevo');
  });

  test('sin motivo no se aplica', async () => {
    const id = await servicioCon({ nombre: 'PRECIO SIN MOTIVO', importe: 10000 });
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 5 }, vigencia: '2026-09', motivo: '' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /motivo/i);
    assert.equal((await ficha(id)).importe_factura, 10000);
  });

  test('un descuento del 100 % o más se rechaza', async () => {
    const id = await servicioCon({ nombre: 'PRECIO A CERO', importe: 10000 });
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: -100 }, vigencia: '2026-09', motivo: 'regalado' }),
    });
    assert.equal(r.status, 400);
    assert.equal((await ficha(id)).importe_factura, 10000);
  });

  test('una vigencia mal escrita se rechaza', async () => {
    const id = await servicioCon({ nombre: 'PRECIO VIGENCIA MALA', importe: 10000 });
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 5 }, vigencia: 'septiembre', motivo: 'anual' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /AAAA-MM/);
  });

  test('sin escoger a nadie no hace nada', async () => {
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [], ajuste: { tipo: 'PORCENTAJE', valor: 5 }, vigencia: '2026-09', motivo: 'anual' }),
    });
    assert.equal(r.status, 400);
  });
});

describe('queda registrado', () => {
  test('el historial del servicio dice de cuánto a cuánto, desde cuándo y quién', async () => {
    const id = await servicioCon({ nombre: 'PRECIO CON HISTORIA', importe: 20000 });
    await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 7 }, vigencia: '2026-10', motivo: 'Revisión anual 2026' }),
    });

    const html = (await admin.pedir(`/estado-fuerza/${id}`)).texto;
    assert.match(html, /Precio y su historia/);
    assert.match(html, /Revisión anual 2026/);
    assert.match(html, /2026-10/);

    const { historial } = (await admin.pedir('/api/precios?historial=20')).json;
    const mio = historial.find((h) => h.servicio_id === id);
    assert.ok(mio);
    assert.equal(mio.importe_anterior, 20000);
    assert.equal(mio.importe_nuevo, 21400);
    assert.equal(mio.porcentaje, 7);
    assert.equal(mio.vigente_desde, '2026-10');
    assert.ok(mio.usuario, 'queda quién lo hizo');
  });

  test('editar el importe a mano en la ficha también entra al historial', async () => {
    const id = await servicioCon({ nombre: 'PRECIO EDITADO A MANO', importe: 15000 });
    const r = await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 18000 }),
    });
    assert.equal(r.status, 200, r.texto);

    const { historial } = (await admin.pedir('/api/precios?historial=40')).json;
    const mio = historial.find((h) => h.servicio_id === id);
    assert.ok(mio, 'un cambio de precio por otra puerta sigue siendo un cambio de precio');
    assert.equal(mio.tipo, 'MANUAL');
    assert.equal(mio.importe_anterior, 15000);
    assert.equal(mio.importe_nuevo, 18000);
    assert.equal(mio.porcentaje, 20);
  });

  test('editar otra cosa de la ficha no ensucia el historial de precios', async () => {
    const id = await servicioCon({ nombre: 'PRECIO NO ENSUCIA', importe: 15000 });
    const antes = (await admin.pedir('/api/precios?historial=60')).json.historial.length;
    await finanzas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status_cobranza: 'Al corriente' }),
    });
    const despues = (await admin.pedir('/api/precios?historial=60')).json.historial.length;
    assert.equal(despues, antes);
  });
});

describe('quién puede mover precios', () => {
  test('ventas puede: es quien negocia con el cliente', async () => {
    const id = await servicioCon({ nombre: 'PRECIO DE VENTAS', importe: 10000 });
    const r = await ventas.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 6 }, vigencia: '2026-09', motivo: 'Renegociación con el cliente' }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(id)).importe_factura, 10600);
  });

  test('finanzas puede', async () => {
    const id = await servicioCon({ nombre: 'PRECIO DE FINANZAS', importe: 10000 });
    const r = await finanzas.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 4 }, vigencia: '2026-09', motivo: 'Revisión anual' }),
    });
    assert.equal(r.status, 201, r.texto);
  });

  test('operaciones no: mueve guardias, no precios', async () => {
    const id = await servicioCon({ nombre: 'PRECIO NO DE OPERACIONES', importe: 10000 });
    assert.equal((await operaciones.pedir('/api/precios')).status, 403);
    const r = await operaciones.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], ajuste: { tipo: 'PORCENTAJE', valor: 90 }, vigencia: '2026-09', motivo: 'porque sí' }),
    });
    assert.equal(r.status, 403);
    assert.equal((await ficha(id)).importe_factura, 10000);
  });

  test('sin sesión, nada', async () => {
    const r = await app.anonimo().pedir('/api/precios');
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });

  test('ventas sigue sin poder editar el bloque de finanzas por la puerta de atrás', async () => {
    const id = await servicioCon({ nombre: 'PRECIO PUERTA DE ATRAS', importe: 10000 });
    const r = await ventas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 1, nomina_total: 999 }),
    });
    assert.equal(r.status, 403, 'el permiso de precios no abre la ficha entera');
    assert.equal((await ficha(id)).importe_factura, 10000);
  });
});

describe('la pantalla', () => {
  test('ventas la ve', async () => {
    const html = (await ventas.pedir('/precios')).texto;
    assert.match(html, /Precios/);
    assert.match(html, /Aplicar a/);
  });

  test('operaciones no la alcanza', async () => {
    const html = (await operaciones.pedir('/precios')).texto;
    assert.match(html, /Sin permiso/);
    assert.doesNotMatch(html, /Aplicar a/);
  });

  test('se puede filtrar por quién tiene el aumento pendiente', async () => {
    const r = await admin.pedir('/precios?estado=vencido');
    assert.equal(r.status, 200);
    assert.match(r.texto, /Se les pas/i);
  });

  test('el menú se la ofrece a ventas', async () => {
    assert.match((await ventas.pedir('/')).texto, /Precios/);
    assert.doesNotMatch((await operaciones.pedir('/')).texto, />Precios</);
  });
});
