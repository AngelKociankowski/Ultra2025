/**
 * Un servicio contratado para el 28 no está en la calle el 20.
 *
 * Ventas registra la apertura en cuanto cierra —que es lo correcto: así queda
 * el folio y todos lo ven venir— y el montaje es días después. La plataforma
 * creaba el servicio al momento y sus guardias empezaban a sumar de inmediato,
 * dos semanas antes de que hubiera nadie parado en esa puerta.
 *
 * El daño no era solo un número inflado en el tablero. Con esos guardias se
 * proponía factura del mes, se comparaba contra la nómina y se calculaba la
 * utilidad. Todo el mes se veía distinto por gente que todavía no existía.
 *
 * Lo que NO se hace es esconder el servicio hasta su fecha. Quien captura la
 * apertura tiene que poder encontrarla; si desaparece, va a creer que no se
 * guardó y la va a capturar otra vez.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Una fecha a N días de hoy, en la zona en que opera la empresa. */
function enDias(n) {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const EN_DOS_SEMANAS = enDias(14);

let idFuturo;
let guardiasAntes;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);

  // Con `estatus=ACTIVO`, que es lo que pide la pantalla del estado de fuerza.
  // Sin filtro la API devuelve todo —bajas y suspendidos incluidos— y eso es
  // otra pregunta.
  guardiasAntes = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios.reduce(
    (a, s) => a + (s.total_guardias || 0),
    0
  );

  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: 'ARRANCA MAS ADELANTE',
      zona: 'SUR',
      fecha: EN_DOS_SEMANAS,
      turnos: { '12X36': 7 },
    }),
  });
  assert.equal(r.status, 201, r.texto);
  idFuturo = r.json.servicioId;
});

after(async () => {
  await app?.cerrar();
});

describe('no cuenta hasta que arranca', () => {
  test('el servicio se creó y guarda su fecha', async () => {
    // La apertura no se rechaza ni se pospone: el servicio existe desde que se
    // cierra el trato, con su folio y su fecha.
    const s = (await admin.pedir(`/api/servicios/${idFuturo}`)).json.servicio;
    assert.equal(s.estatus, 'ACTIVO');
    assert.equal(s.fecha_alta, EN_DOS_SEMANAS);
    assert.equal(s.total_guardias, 7);
  });

  test('sus guardias no entran en el estado de fuerza de hoy', async () => {
    const ahora = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    assert.ok(
      !ahora.some((s) => s.servicio === 'ARRANCA MAS ADELANTE'),
      'no debería salir entre los activos de hoy'
    );
    const guardias = ahora.reduce((a, s) => a + (s.total_guardias || 0), 0);
    assert.equal(guardias, guardiasAntes, 'el total no debe moverse hasta que arranque');
  });

  test('ni en el total del tablero', async () => {
    const html = comoSeLee((await admin.pedir('/')).texto);
    // El tablero enseña el mismo total que la lista. Si uno de los dos contara
    // al que no ha arrancado, los dos números dejarían de coincidir y nadie
    // sabría cuál creer.
    assert.match(html, new RegExp(String(guardiasAntes).replace(/(\d)(?=(\d{3})+$)/g, '$1,?')));
  });

  test('ni se le propone factura del mes', async () => {
    // Es donde el error costaba dinero: proponer cobrar un servicio que no se
    // dio se cuela solo con que alguien acepte la propuesta sin mirarla.
    const r = await finanzas.pedir('/api/facturas?pendientes=1');
    assert.equal(r.status, 200, r.texto);
    assert.ok(
      !r.json.porFacturar.some((f) => f.servicio === 'ARRANCA MAS ADELANTE'),
      'no debería proponerse facturar lo que no ha arrancado'
    );
  });
});

describe('pero se ve, no se esconde', () => {
  test('la pantalla avisa de cuántos vienen y cuándo', async () => {
    // Sin el aviso, quien capturó la apertura no encuentra su servicio en la
    // lista, cree que no se guardó y lo captura otra vez.
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, /arrancan? más adelante/);
    assert.match(html, /todavía no hay nadie en esa puerta/);
  });

  test('se pueden pedir con su propio filtro', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?estatus=POR_ARRANCAR')).texto);
    assert.match(html, /ARRANCA MAS ADELANTE/);
  });

  test('y el renglón dice desde cuándo cuenta', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?estatus=POR_ARRANCAR')).texto);
    assert.match(html, new RegExp(`arranca ${EN_DOS_SEMANAS}`));
  });

  test('el expediente de la apertura sabe que todavía no arranca', async () => {
    // Era lo que se veía en pantalla: «ACTIVO · 7 guardias» de un servicio que
    // arrancaba dos semanas después.
    //
    // El panel del expediente solo se dibuja al desplegar el renglón, así que
    // su texto no está en el HTML del servidor y comprobarlo ahí no diría nada.
    // Lo que sí viaja con la página es la marca, que es de donde el panel saca
    // qué enseñar: sin ella, el panel no tendría cómo saberlo.
    const periodo = EN_DOS_SEMANAS.slice(0, 7);
    const html = (await admin.pedir(`/aperturas?periodo=${periodo}`)).texto;
    assert.match(html, /ARRANCA MAS ADELANTE/, 'la apertura tiene que estar en la lista');
    assert.match(html, /por_arrancar/, 'y traer la marca de que no ha arrancado');
  });
});

describe('cuando llega su día, cuenta solo', () => {
  test('la vista por día lo incluye a partir de su fecha', async () => {
    // No hace falta que nadie lo «active»: la fecha de alta es la que manda, y
    // es la misma regla que usa la reconstrucción por día. Un servicio que
    // dependiera de que alguien se acuerde de encenderlo se quedaría apagado.
    const nombres = async (d) =>
      (await admin.pedir(`/api/estado-fuerza/dia?dia=${d}`)).json.servicios.map((x) => x.servicio);

    assert.ok(!(await nombres(enDias(13))).includes('ARRANCA MAS ADELANTE'), 'la víspera todavía no');
    assert.ok((await nombres(EN_DOS_SEMANAS)).includes('ARRANCA MAS ADELANTE'), 'su día sí');
  });
});

describe('un servicio con fecha de hoy sí cuenta desde hoy', () => {
  test('no se le pide esperar al día siguiente', async () => {
    // El otro lado del error: pasarse de estricto y no contar al que se montó
    // esta mañana. La fecha de alta cuenta.
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'ARRANCA HOY MISMO',
        zona: 'SUR',
        fecha: enDias(0),
        turnos: { '24 HRS': 2 },
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const ahora = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    assert.ok(
      ahora.some((s) => s.servicio === 'ARRANCA HOY MISMO'),
      'el que arranca hoy tiene que contar hoy'
    );
  });
});
