/**
 * El alta en dos tramos: lo que hace falta para abrir y lo que puede esperar.
 *
 * Existe por lo que se encontró al revisar la pantalla de alta. El formulario
 * pedía unos setenta controles de una sola caída y solo dos eran obligatorios,
 * así que quien cerraba un servicio en la calle capturaba con una lista en la
 * mano y, en cuanto le faltaba un dato que ni siquiera hacía falta —el estado,
 * el uniforme, los días de crédito—, dejaba el alta a medias y volvía al día
 * siguiente. El servicio operaba y en la plataforma no existía.
 *
 * Lo que se prueba aquí es la mitad de lectura: que la plataforma sepa decir
 * qué le falta a un servicio, sin equivocarse en los dos casos que hacen
 * inservible una lista de faltantes —marcar como hueco un cero capturado, o
 * marcar como hueco algo que ya está escrito—. Llenar los huecos se prueba en
 * `completar-alta.test.mjs`.
 *
 * Va contra el servidor, como todas: la regla de qué falta la consultan la
 * ficha, el renglón del estado de fuerza y el filtro de la lista, y solo
 * probando el conjunto se comprueba que las tres digan lo mismo.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let opciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** El bloque «Falta por capturar» de una ficha, o null si no está. */
function panel(html) {
  const i = html.indexOf('Falta por capturar');
  return i === -1 ? null : html.slice(i, i + 2500);
}

async function abrir(cuerpo) {
  const r = await admin.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  opciones = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

describe('qué le falta a un servicio', () => {
  test('un alta con lo mínimo queda señalada como incompleta en su ficha', async () => {
    const id = await abrir({
      tipo: 'APERTURA',
      servicio: 'ALTA MINIMA UNO',
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
    });

    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    const bloque = panel(html);
    assert.ok(bloque, 'la ficha de un servicio incompleto tiene que traer el panel');
    assert.match(html, /id="completar"/, 'y con su ancla, que es a donde apuntan los enlaces de la lista');
    // Las dos listas, agrupadas por para qué hace falta cada cosa.
    assert.match(bloque, /Para operarlo:/);
    assert.match(bloque, /Para cobrarlo:/);
    assert.match(bloque, /¿El cliente pide REPSE\?/);
    assert.match(bloque, /Precio por guardia/);
  });

  test('el precio capturado deja de pedirse; el REPSE vacío se sigue pidiendo', async () => {
    // Es el caso de los servicios de la carga inicial una vez que se les pone
    // precio: la lista de faltantes tiene que encogerse con lo que se captura,
    // o nadie la vuelve a mirar.
    const id = await abrir({
      tipo: 'APERTURA',
      servicio: 'ALTA MINIMA CON PRECIO',
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      precio_guardia: 9000,
      turnos: { '24 HRS': 1 },
    });

    const bloque = panel(comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto));
    assert.ok(bloque);
    assert.match(bloque, /¿El cliente pide REPSE\?/, 'el REPSE sigue vacío, así que se pide');
    assert.doesNotMatch(bloque, /Precio por guardia/, 'el precio ya está capturado: no es un hueco');
  });

  test('un cero capturado no es un hueco', async () => {
    /**
     * Es la distinción que hace útil a todo lo demás. Hay servicios de cortesía
     * con precio cero y clientes de contado con cero días de crédito: contarlos
     * como faltantes mandaría a alguien a «completar» una pregunta que ya está
     * contestada, y a la tercera vez la lista de faltantes deja de significar
     * algo.
     */
    const id = await abrir({
      tipo: 'APERTURA',
      servicio: 'ALTA MINIMA EN CEROS',
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      precio_guardia: 0,
      dias_credito: 0,
      turnos: { '24 HRS': 1 },
    });

    const s = await ficha(id);
    assert.equal(s.precio_guardia, 0, 'el cero se guardó como cero y no como nulo');
    assert.equal(s.dias_credito, 0);

    const bloque = panel(comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto));
    assert.ok(bloque);
    assert.doesNotMatch(bloque, /Precio por guardia/);
    assert.doesNotMatch(bloque, /Días de crédito/);
  });

  test('un servicio con todo capturado no trae el panel', async () => {
    const id = await abrir({
      tipo: 'APERTURA',
      servicio: 'ALTA COMPLETA',
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      gerente: opciones.gerentes[0],
      supervisor: opciones.supervisores[0],
      estado_geo: opciones.estados[0],
      uniforme: opciones.uniformes[0],
      tipo_repse: opciones.tiposRepse[0],
      forma_pago: opciones.formasPago[0],
      razon_social: 'ALTA COMPLETA SA DE CV',
      direccion: 'Avenida Siempre Viva 742',
      precio_guardia: 12000,
      esquema_facturacion: 'MES_VENCIDO',
      dias_credito: 30,
      turnos: { '24 HRS': 3 },
    });

    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    assert.equal(panel(html), null, 'no le falta nada: el panel no se monta');
    assert.doesNotMatch(html, /id="completar"/);
  });

  test('el contrato, la factura y la nómina no cuentan como captura del alta', async () => {
    // Son estado que cambia solo con el tiempo —se firma un contrato, se emite
    // una factura, se cierra una nómina—. Pedirlos aquí marcaría como
    // incompleto a un servicio que nació ayer y no ha tenido su primer mes.
    const id = await abrir({
      tipo: 'APERTURA',
      servicio: 'ALTA SIN CONTRATO NI NOMINA',
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 1 },
    });
    const bloque = panel(comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto));
    assert.ok(bloque);
    for (const etiqueta of ['¿Cuenta con contrato?', 'Nómina total del servicio', '% utilidad', 'Importe de factura']) {
      assert.doesNotMatch(bloque, new RegExp(etiqueta.replace(/[?%]/g, '.')), `${etiqueta} no es captura del alta`);
    }
  });
});

describe('la pantalla del alta pide lo mínimo y ofrece el resto', () => {
  test('los dos tramos están rotulados', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas/nueva')).texto);
    assert.match(html, /Lo que hace falta para abrirlo/);
    assert.match(html, /Completar cuando lo tengas/);
    assert.match(
      html,
      /Nada de esto detiene el alta/,
      'y el pie que dice que lo de abajo no frena el alta'
    );
  });

  test('zona y asesor pasaron a ser obligatorios en el formulario', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas/nueva')).texto);
    assert.match(html, /Zona \*/);
    assert.match(html, /Asesor \*/);
  });

  test('el segundo tramo viene plegado y no esconde nada', async () => {
    // Plegado para que setenta controles no sean una sola caída, pero presente
    // en el HTML: esconder un dato capturado es lo que hizo que alguien
    // reportara como faltantes cosas que sí estaban ahí.
    const html = (await admin.pedir('/aperturas/nueva')).texto;
    assert.match(html, /<details/);
    assert.match(comoSeLee(html), /Cómo se cobra/);
    assert.match(comoSeLee(html), /Autorizaciones/);
  });
});

describe('el contrato de la API no cambió', () => {
  test('una apertura con los cinco datos mínimos sigue dando 201 y crea el servicio', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'CONTRATO API MINIMO',
        fecha: '2026-02-10',
        zona: opciones.zonas[0],
        asesor: opciones.asesores[0],
        turnos: { '24 HRS': 2 },
      }),
    });
    assert.equal(r.status, 201, r.texto);
    const s = await ficha(r.json.servicioId);
    assert.equal(s.servicio, 'CONTRATO API MINIMO');
    assert.equal(s.total_guardias, 2);
    assert.equal(s.estatus, 'ACTIVO');
  });

  test('y una sin zona ni asesor también: el cuerpo de antes sigue siendo válido', async () => {
    /**
     * Esto es deliberado y es el punto más fácil de romper sin darse cuenta. El
     * formulario ahora exige zona y asesor, pero el contrato de
     * `POST /api/aperturas` no cambió palabra por palabra: las 625 pruebas que
     * ya existían mandan cuerpos sin ellos. Si el servidor empezara a exigirlos,
     * media suite se caería y, lo que importa más, se rompería cualquier
     * integración que ya estuviera mandando lo de antes.
     */
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'CONTRATO API SIN ZONA', turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r.status, 201, r.texto);
    const s = await ficha(r.json.servicioId);
    assert.ok(!s.zona, 'se guardó sin zona, como antes');
  });
});
