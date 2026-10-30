/**
 * El camino completo: ¿puede una persona LLEGAR a lo que se construyó?
 *
 * Por qué existe este archivo, dicho sin adornos. Van tres vueltas seguidas en
 * las que lo más grave no estaba dentro de ninguna pieza: estaba en la costura
 * entre dos. La última fue así. El plan decía que sin llave la pantalla del
 * asistente sigue siendo útil porque enseña la guía del rol. Se construyó la
 * guía, y la pestaña se dibujaba solo si había llave —con el razonamiento escrito
 * al lado: no ofrecer una pantalla que no puede contestar—. Se probaron las dos
 * mitades por separado, «ningún rol ve la pestaña» y «la pantalla enseña la
 * guía», y las dos pasaron en verde. Nadie probó la pregunta que las une. Y ese
 * enlace del RBAC es la ÚNICA puerta a `/asistente` que existe en toda la
 * aplicación, así que en producción —sin llave— la mitad que ya funcionaba no la
 * alcanzaba nadie.
 *
 * Así que esto no prueba una pieza. Prueba un camino, como lo recorre una de las
 * personas que usan esto: entra, mira la barra, ve la palabra, hace clic en el
 * enlace QUE LA BARRA LE DA —no en una dirección escrita en esta prueba— y mira
 * si lo que encuentra le sirve. Dos veces: sin llave, que es el estado de
 * producción hoy, y con llave.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. Levanta la aplicación compilada,
 * así que un cambio en `lib/` sin recompilar mide el código anterior.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
import { GUIAS } from '../scripts/guias/contenido.mjs';

/** Los cinco que trabajan en la plataforma. El espectador va aparte. */
const QUE_TRABAJAN = ['admin', 'juridico', 'finanzas', 'operaciones', 'ventas'];
const CORREO_ESPECTADOR = 'espectador@corporativoultra.com';

let sinLlave;
let conLlave;
let doble;
const sin = {};
const con = {};

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/**
 * El enlace a la pantalla del asistente, sacado de la barra que esa persona
 * tiene delante.
 *
 * Se lee del HTML a propósito: si la prueba pidiera `/asistente` a mano, seguiría
 * en verde el día que la pestaña desapareciera otra vez, que es exactamente lo
 * que pasó. Lo que se afirma aquí es que hay por dónde entrar.
 */
function puertaDelAsistente(html) {
  const limpio = comoSeLee(html);
  const donde = limpio.indexOf('href="/asistente"');
  if (donde === -1) return null;
  // Y que la persona lea la palabra, no solo que el atributo esté ahí.
  const alrededor = limpio.slice(donde, donde + 400);
  return /Asistente/.test(alrededor) ? '/asistente' : null;
}

/** Los títulos de todas las secciones de la guía de ese rol, derivados. */
const seccionesDe = (rol) => (GUIAS.find((g) => g.rol === rol)?.secciones || []).map((s) => s.titulo);

/** Las marcas de una pantalla de verdad rota. Un «500» suelto es un color. */
function noEstaRota(html, quien) {
  assert.ok(!/Error interno del servidor/.test(html), `${quien}: la pantalla contesta un error interno`);
  assert.ok(!/Application error/.test(html), `${quien}: la pantalla reventó en el navegador`);
  assert.ok(!/digest&quot;:/.test(html), `${quien}: la pantalla trae el rastro de una excepción`);
}

async function altaDelEspectador(app) {
  const admin = await app.entrar(ROLES.admin);
  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({
      email: CORREO_ESPECTADOR,
      nombre: 'Espectador de prueba',
      rol: 'espectador',
      password: PASSWORD_TEMPORAL,
    }),
  });
  assert.equal(alta.status, 201, alta.texto);
  const primera = await app.entrar(CORREO_ESPECTADOR, PASSWORD_TEMPORAL);
  await primera.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });
  return app.entrar(CORREO_ESPECTADOR, PASSWORD);
}

before(async () => {
  // El doble se levanta para el camino CON llave. Al servidor sin llave no se le
  // dice nada de él: nadie debe llamarlo.
  doble = await arrancarDoble([{ texto: 'Listo.' }]);

  sinLlave = await arrancar({ env: { ANTHROPIC_API_KEY: '' } });
  conLlave = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' },
  });

  sin.admin = await sinLlave.entrar(ROLES.admin);
  con.admin = await conLlave.entrar(ROLES.admin);
  for (const rol of ['juridico', 'finanzas', 'operaciones', 'ventas']) {
    sin[rol] = await sinLlave.entrarYAsentar(ROLES[rol]);
  }
  con.operaciones = await conLlave.entrarYAsentar(ROLES.operaciones);
  sin.espectador = await altaDelEspectador(sinLlave);
});

after(async () => {
  await sinLlave?.cerrar();
  await conLlave?.cerrar();
  await doble?.cerrar();
});

// ───────────────────────────────────────────────────────────────────────────────
describe('sin llave —el estado de producción hoy— se llega y sirve de algo', () => {
  for (const rol of QUE_TRABAJAN) {
    test(`${rol}: entra, ve la pestaña, la abre y encuentra su guía completa`, async () => {
      // 1 · Entra al Tablero, que es donde cae al iniciar sesión.
      const tablero = await sin[rol].pedir('/');
      assert.equal(tablero.status, 200, `${rol}: el Tablero contestó ${tablero.status}`);

      // 2 · Y en su barra hay una puerta al asistente, con su palabra.
      const puerta = puertaDelAsistente(tablero.texto);
      assert.ok(
        puerta,
        `${rol}: en la barra no hay ninguna puerta al asistente, y es la única que existe en toda la ` +
          'plataforma: lo construido sería inalcanzable salvo escribiendo la dirección a mano'
      );

      // 3 · La abre, por el enlace que la barra le dio.
      const pantalla = await sin[rol].pedir(puerta);
      assert.equal(pantalla.status, 200, `${rol}: ${puerta} contestó ${pantalla.status}`);
      const html = comoSeLee(pantalla.texto);
      noEstaRota(html, rol);

      // 4 · Y encuentra algo útil: su guía entera, y dicho qué sí puede hoy.
      const faltan = seccionesDe(rol).filter((t) => !html.includes(t));
      assert.ok(seccionesDe(rol).length > 0, `${rol}: no hay guía escrita para este rol`);
      assert.deepEqual(faltan, [], `${rol}: la pantalla no pintó estas secciones de su guía: ${faltan.join(' · ')}`);
      assert.match(
        html,
        /solo puede enseñar/i,
        `${rol}: la pantalla no dice que ahora mismo solo puede enseñar las guías, así que se lee como rota`
      );
      // Y no se le ofrece conversar, que es lo único que hoy no puede hacer.
      assert.ok(!/Preguntar<\/button>/.test(html), `${rol}: se ofrece preguntar sin con quién conversar`);
    });
  }

  test('el espectador sigue fuera: ni pestaña ni API, como decidió el director', async () => {
    const tablero = await sin.espectador.pedir('/');
    assert.equal(tablero.status, 200);
    assert.equal(
      puertaDelAsistente(tablero.texto),
      null,
      'al espectador se le ofrece una pestaña del asistente que no puede usar'
    );

    const api = await sin.espectador.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'hola', previas: [] }),
    });
    assert.equal(api.status, 403, `${api.status}: ${api.texto.slice(0, 200)}`);

    // Y si escribe la dirección a mano no se le castiga con un error pelado:
    // encuentra su guía, que es lo que esa pantalla sabe hacer sin cobrar nada.
    const pantalla = await sin.espectador.pedir('/asistente');
    assert.equal(pantalla.status, 200);
    assert.match(comoSeLee(pantalla.texto), /para quien trabaja en la plataforma/i);
  });

  test('y nadie llamó al servicio externo para enseñar una guía', () => {
    assert.equal(
      doble.peticiones().length,
      0,
      'se llamó al servicio externo sin llave puesta: la guía no necesita ningún servicio'
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('con llave, el mismo camino termina en una respuesta con su fuente', () => {
  test('operaciones: entra, abre la pestaña, pregunta y recibe cifra con su procedencia', async () => {
    // La cifra contra la que se mide sale de la propia plataforma, no de aquí.
    const lista = await con.admin.pedir('/api/servicios?estatus=ACTIVO');
    assert.equal(lista.status, 200, lista.texto.slice(0, 200));
    const activos = lista.json.servicios;
    const esperado = `${activos.length} · ${activos.reduce((a, s) => a + (Number(s.total_guardias) || 0), 0)}`;

    // 1 y 2 · Entra y encuentra la puerta en su barra.
    const tablero = await con.operaciones.pedir('/');
    const puerta = puertaDelAsistente(tablero.texto);
    assert.ok(puerta, 'con llave tampoco hay puerta al asistente en la barra');

    // 3 · La abre y sí se le ofrece conversar.
    const pantalla = await con.operaciones.pedir(puerta);
    assert.equal(pantalla.status, 200);
    const html = comoSeLee(pantalla.texto);
    noEstaRota(html, 'operaciones');
    assert.match(html, /Preguntar<\/button>/, 'con llave no se ofrece la caja de preguntar');
    // La guía no se quita: sigue siendo la respuesta más barata a media pregunta.
    const faltan = seccionesDe('operaciones').filter((t) => !html.includes(t));
    assert.deepEqual(faltan, [], `con llave desaparecieron secciones de la guía: ${faltan.join(' · ')}`);

    // 4 · Pregunta, y lo que recibe es útil Y comprobable.
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'resumen_operacion', args: {} }] },
      { texto: 'Ahora mismo la operación está así.' },
    ]);
    const r = await con.operaciones.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: '¿cómo va la operación?', previas: [] }),
    });
    assert.equal(r.status, 200, `${r.status}: ${r.texto.slice(0, 200)}`);

    const evs = eventos(r.texto);
    assert.ok(
      evs.some((e) => e.tipo === 'texto' && e.texto.includes('operación')),
      'no llegó ni una palabra de respuesta'
    );
    const fichas = evs.filter((e) => e.tipo === 'ficha').map((e) => e.ficha);
    assert.equal(fichas.length, 1, 'la respuesta llegó sin el recuadro «De dónde salió esto»');
    assert.equal(fichas[0].pantalla, 'Tablero');
    assert.equal(
      fichas[0].valor,
      esperado,
      `la ficha dice «${fichas[0].valor}» y la plataforma dice «${esperado}»`
    );
    assert.equal(fichas[0].enlace, '/', 'la ficha no deja el enlace a la pantalla donde se comprueba');
    assert.ok(evs.at(-1).tipo === 'fin', 'el canal no cerró con el aviso de cuántas preguntas quedan');
  });

  test('y con el servicio caído la pestaña sigue ahí y la pantalla dice qué sí puede hacer', async () => {
    /**
     * El otro escenario del mismo error, y la razón por la que la pestaña no
     * puede depender de nada externo: con la llave puesta y el servicio caído
     * —o con la llave caducada, que desde aquí es lo mismo— la mitad que no
     * necesita el servicio sigue entera. Si la entrada dependiera de que el
     * servicio esté en pie, un corte del proveedor borraría de la barra una
     * pantalla que en ese momento es MÁS útil, no menos.
     */
    doble.olvidar();
    doble.guionar([{ estado: 500, error: 'el proveedor se cayó' }]);
    const r = await con.operaciones.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'con el servicio caído', previas: [] }),
    });
    assert.equal(r.status, 200, 'el canal no se abrió');
    const err = eventos(r.texto).find((e) => e.tipo === 'error');
    assert.ok(err, 'el servicio se cayó y el canal no dijo nada');
    assert.ok(!err.mensaje.includes('el proveedor se cayó'), 'se le repitió a la persona el mensaje del proveedor');

    // Y el camino sigue completo: pestaña, pantalla, guía, y dicho que la guía
    // no depende de ningún servicio.
    const tablero = await con.operaciones.pedir('/');
    const puerta = puertaDelAsistente(tablero.texto);
    assert.ok(puerta, 'con el servicio caído desapareció la puerta al asistente de la barra');
    const pantalla = await con.operaciones.pedir(puerta);
    assert.equal(pantalla.status, 200);
    const html = comoSeLee(pantalla.texto);
    noEstaRota(html, 'operaciones con el servicio caído');
    const faltan = seccionesDe('operaciones').filter((t) => !html.includes(t));
    assert.deepEqual(faltan, [], `faltan secciones de la guía con el servicio caído: ${faltan.join(' · ')}`);
    assert.match(
      html,
      /no depende de ningún servicio externo/i,
      'la pantalla no dice que la guía sigue sirviendo aunque el asistente no conteste'
    );
  });
});
