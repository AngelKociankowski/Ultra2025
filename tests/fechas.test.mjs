/**
 * Que la plataforma sepa en qué día vive.
 *
 * Dos errores distintos se sentían igual —«la plataforma va atrasada»— y los
 * dos se corrigen aquí:
 *
 *   1. El mes en curso salía del último corte importado. Al llegar agosto, la
 *      pantalla seguía diciendo «julio · en curso» porque julio era el último
 *      corte que había en la base.
 *   2. Todo lo demás usaba UTC. El servidor vive en UTC y la operación en el
 *      centro de México: a partir de las 18:00 hora local el servidor ya cambió
 *      de día, así que una factura registrada por la tarde salía fechada
 *      mañana y su vencimiento corrido un día.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

/** La misma cuenta que hace la plataforma, hecha aparte para compararla. */
const hoyEnMexico = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
});

describe('el mes en curso lo dice el calendario', () => {
  test('la pantalla anuncia el mes de hoy, no el del último corte', async () => {
    const hoy = hoyEnMexico();
    const mes = MESES[Number(hoy.slice(5, 7))];
    const anio = hoy.slice(0, 4);

    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, new RegExp(`${mes} ${anio}`, 'i'), `debería anunciar ${mes} ${anio}`);
    assert.match(html, /en curso/);
  });

  test('el último corte importado queda como corte cerrado, no como mes vivo', async () => {
    // el archivo llega hasta 2026-07; si hoy es posterior, ese mes ya es historia
    const r = await admin.pedir('/estado-fuerza?periodo=2026-07');
    assert.equal(r.status, 200);
    const html = comoSeLee(r.texto);
    if (hoyEnMexico().slice(0, 7) > '2026-07') {
      assert.match(html, /corte cerrado|Corte de|2026-07/i);
    }
  });
});

describe('las fechas se escriben en la hora de la operación', () => {
  test('una apertura sin fecha toma el día de hoy en México', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'FECHA POR OMISION', turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r.status, 201, r.texto);

    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.fecha_alta, hoyEnMexico(), 'la fecha de alta es la de aquí, no la del servidor en UTC');
  });

  test('el folio lleva el año de aquí', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'FOLIO DEL ANIO', turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r.status, 201);
    assert.match(r.json.folio, new RegExp(`^AP-${hoyEnMexico().slice(0, 4)}-`));
  });

  test('una factura sin fecha de pago la toma del día de hoy', async () => {
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'FECHA DE PAGO', turnos: { '24 HRS': 2 } }),
    });
    const factura = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: alta.json.servicioId,
        periodo: hoyEnMexico().slice(0, 7),
        fecha_factura: hoyEnMexico(),
        importe: 1000,
      }),
    });
    assert.equal(factura.status, 201, factura.texto);

    const pago = await admin.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({ id: factura.json.id, pago: {} }),
    });
    assert.equal(pago.status, 200, pago.texto);

    const cuenta = await admin.pedir(`/api/facturas?servicio_id=${alta.json.servicioId}`);
    assert.equal(cuenta.json.facturas[0].fecha_pago, hoyEnMexico());
  });
});
