/**
 * Cerrar el descuadre desde donde se ve.
 *
 * Cobranza lo describió con precisión: «yo capturé los importes correctos
 * porque hubo un incremento en el servicio, debería de quedar con 96,976 (…)
 * ya me fui a septiembre y sigue con los 88,160». Corrigió las facturas y el
 * error no se fue, porque el descuadre no estaba ahí: la factura decía la
 * verdad y el que había quedado viejo era el importe acordado de la ficha, que
 * nadie actualizó cuando al cliente se le subió el precio.
 *
 * Lo que hace interesante este caso es que el permiso YA EXISTÍA. Finanzas
 * podía editar el importe acordado desde la ficha del servicio, y aun así el
 * problema seguía sin resolverse durante semanas. No faltaba un permiso:
 * faltaba un camino. El descuadre se ve en Cobranza y el arreglo estaba en otra
 * pantalla, en un campo que hay que saber que existe.
 *
 * Estas pruebas fijan las dos mitades: que el permiso funciona —para que nadie
 * lo «arregle» otra vez agregando uno nuevo— y que ajustar el acuerdo hace
 * desaparecer el hallazgo, que es lo que ella esperaba y no pasaba.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;
let servicio;

const PERIODO = '2026-08';
const ACUERDO_VIEJO = 88160;
const FACTURADO = 96976;

/**
 * La conciliación no tiene API propia: se calcula en la pantalla de Cobranza,
 * que es un componente de servidor, así que la tabla viene dentro del HTML. Se
 * lee de ahí en lugar de inventarle un endpoint solo para poder probarla.
 */
const pantalla = async (sesion) => (await sesion.pedir(`/cobranza?periodo=${PERIODO}`)).texto;

/** El texto del descuadre de importe es único de la conciliación. */
const DESCUADRE = /8,816 de más/;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);

  const alta = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ servicio: 'CLIENTE CON INCREMENTO', fecha: '2026-01-05', guardias: 2 }),
  });
  assert.equal(alta.status, 201, alta.texto);
  servicio = alta.json.servicioId;

  // La ficha con el precio de antes del incremento…
  await finanzas.pedir(`/api/servicios/${servicio}`, {
    method: 'PATCH',
    body: JSON.stringify({ importe_factura: ACUERDO_VIEJO, guardias_en_factura: 2 }),
  });
  // …y la factura con el precio nuevo, que es el correcto.
  const f = await finanzas.pedir('/api/facturas', {
    method: 'POST',
    body: JSON.stringify({
      servicio_id: servicio,
      periodo: PERIODO,
      concepto: 'Mes completo',
      fecha_factura: '2026-08-31',
      importe: FACTURADO,
      guardias: 2,
    }),
  });
  assert.equal(f.status, 201, f.texto);
});

after(async () => {
  await app?.cerrar();
});

describe('el descuadre que ella veía', () => {
  test('la conciliación lo reporta, y dice de qué lado está cada número', async () => {
    const html = await pantalla(finanzas);
    assert.match(html, /CLIENTE CON INCREMENTO/);
    assert.match(html, DESCUADRE, 'tiene que señalar la diferencia de importe');
    // Los dos números, para que quien lo lea sepa cuál mover.
    assert.match(html, /96,976/);
    assert.match(html, /88,160/);
  });

  test('corregir la FACTURA no lo arregla: la factura no era la equivocada', async () => {
    // Esto es lo que ella hizo, y por eso el error no se iba. Se comprueba
    // aquí para que quede claro que no era un fallo suyo de captura.
    const { facturas } = (await finanzas.pedir(`/api/facturas?servicio_id=${servicio}`)).json;
    const factura = facturas.find((f) => f.periodo === PERIODO);

    const r = await finanzas.pedir('/api/facturas', {
      method: 'PATCH',
      body: JSON.stringify({
        id: factura.id,
        correccion: { motivo: 'Reviso el importe y es el que dice el CFDI.', importe: FACTURADO },
      }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.match(await pantalla(finanzas), DESCUADRE, 'el descuadre sigue: el número viejo está en la ficha');
  });
});

describe('ajustar el acuerdo de la ficha', () => {
  test('finanzas puede: el permiso ya existía', async () => {
    // Se fija a propósito. El problema se reportó como «no me deja», y la
    // reacción natural es agregar un permiso; la comprobación de que ya está
    // evita ese arreglo que no arregla nada.
    const r = await finanzas.pedir(`/api/servicios/${servicio}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: FACTURADO }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.cambios.importe_factura, { antes: ACUERDO_VIEJO, despues: FACTURADO });
  });

  test('y con eso el hallazgo desaparece', async () => {
    const html = await pantalla(finanzas);
    assert.doesNotMatch(html, DESCUADRE, 'ya no debería haber nada que reportar');
  });

  test('el atajo para ajustarlo está en el renglón, que es donde se ve el error', async () => {
    // El permiso ya existía y el problema seguía sin resolverse: lo que faltaba
    // era el camino desde donde se ve el descuadre hasta donde se arregla.
    const otro = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ servicio: 'OTRO CON ACUERDO VIEJO', fecha: '2026-01-05', guardias: 2 }),
    });
    await finanzas.pedir(`/api/servicios/${otro.json.servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 50000 }),
    });
    await finanzas.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: otro.json.servicioId,
        periodo: PERIODO,
        concepto: 'Mes completo',
        fecha_factura: '2026-08-31',
        importe: 60000,
        guardias: 2,
      }),
    });

    assert.match(await pantalla(finanzas), /Actualizar el acuerdo de la ficha/);
  });

  test('a quien no puede editar finanzas no se le ofrece', async () => {
    const ventas = await app.entrarYAsentar(ROLES.ventas);
    const html = (await ventas.pedir(`/cobranza?periodo=${PERIODO}`)).texto;
    assert.doesNotMatch(html, /Actualizar el acuerdo de la ficha/);
  });

  test('queda en la bitácora: es un cambio de precio, no un ajuste invisible', async () => {
    const html = (await admin.pedir('/bitacora')).texto;
    assert.match(html, /CLIENTE CON INCREMENTO/);
  });
});

describe('quién puede ajustarlo', () => {
  test('ventas y operaciones no tocan el importe acordado', async () => {
    for (const rol of ['ventas', 'operaciones']) {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await sesion.pedir(`/api/servicios/${servicio}`, {
        method: 'PATCH',
        body: JSON.stringify({ importe_factura: 1 }),
      });
      // O lo rechaza, o lo ignora sin aplicarlo; lo que no puede es cambiarlo.
      const despues = (await admin.pedir(`/api/servicios/${servicio}`)).json.servicio;
      assert.equal(despues.importe_factura, FACTURADO, `${rol} movió el importe acordado (${r.status})`);
    }
  });
});
