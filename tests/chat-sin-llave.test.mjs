/**
 * Sin llave, que es el estado de producción HOY.
 *
 * Esto no es el caso raro: es el normal. Mientras no haya llave puesta, la
 * plataforma tiene que comportarse exactamente como se comportaba antes de este
 * encargo. Nada de pestañas que llevan a un error, nada de pantallas lentas,
 * nada de un 500 porque falta una variable de entorno.
 *
 * Y la pantalla del asistente, sin llave, no es un error: enseña la guía del
 * rol. La mitad de lo que se pidió —los tutoriales— ya está escrita en el
 * lenguaje de la casa, y se puede contestar sin llamar a ningún servicio
 * externo, sin costo y sin riesgo de que algo se invente. Así, el día que el
 * servicio esté caído la pantalla sigue siendo útil.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
/** Las guías, para comprobar que la pantalla pinta la del rol completa. */
import { GUIAS } from '../scripts/guias/contenido.mjs';

let app;
/** El doble se levanta pero NO se le dice a la aplicación: nadie debe llamarlo. */
let doble;
const sesiones = {};

const CORREO_ESPECTADOR = 'espectador@corporativoultra.com';
const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

before(async () => {
  doble = await arrancarDoble([{ texto: 'nadie debería ver esto' }]);
  app = await arrancar({
    // La llave vacía y no ausente: así la prueba vale también si el entorno del
    // CI trajera una puesta por otro motivo. Una llave de espacios no es llave.
    env: { ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: doble.base },
  });

  const admin = await app.entrar(ROLES.admin);
  sesiones.admin = admin;
  for (const rol of ['juridico', 'finanzas', 'operaciones', 'ventas']) {
    sesiones[rol] = await app.entrarYAsentar(ROLES[rol]);
  }
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
  sesiones.espectador = await app.entrar(CORREO_ESPECTADOR, PASSWORD);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('la barra no ofrece lo que no hay', () => {
  test('ningún rol ve la pestaña del asistente', async () => {
    for (const rol of Object.keys(sesiones)) {
      const r = await sesiones[rol].pedir('/');
      assert.equal(r.status, 200, `${rol} → ${r.status}`);
      assert.ok(
        !r.texto.includes('href="/asistente"'),
        `al rol «${rol}» se le ofrece una pestaña que lleva a una pantalla que no puede contestar`
      );
    }
  });

  test('las pestañas de siempre siguen ahí, y en el mismo orden', async () => {
    const r = await sesiones.admin.pedir('/');
    const html = comoSeLee(r.texto);
    const esperadas = [
      'Tablero',
      'Estado de fuerza',
      'Aperturas',
      'Cancelaciones',
      'Cobranza',
      'Jurídico',
    ];
    let desde = 0;
    for (const etiqueta of esperadas) {
      const donde = html.indexOf(etiqueta, desde);
      assert.ok(donde > -1, `desapareció la pestaña «${etiqueta}»`);
      desde = donde;
    }
  });
});

describe('las pantallas de todos los días no cambian', () => {
  const deTodosLosDias = [
    ['/', /Servicios activos/],
    ['/estado-fuerza', /Estado de fuerza/],
    ['/aperturas', /Aperturas/],
    ['/cancelaciones', /Cancelaciones/],
    ['/juridico', /Jurídico/],
  ];

  for (const [ruta, señal] of deTodosLosDias) {
    test(`${ruta} contesta 200 y pinta lo de siempre`, async () => {
      const r = await sesiones.admin.pedir(ruta);
      assert.equal(r.status, 200, `${ruta} → ${r.status}`);
      assert.match(comoSeLee(r.texto), señal, `${ruta} dejó de pintar lo de siempre`);
    });
  }

  test('y el espectador las sigue viendo igual', async () => {
    for (const [ruta, señal] of deTodosLosDias) {
      const r = await sesiones.espectador.pedir(ruta);
      assert.equal(r.status, 200, `${ruta} → ${r.status} para el espectador`);
      assert.match(comoSeLee(r.texto), señal, `${ruta} cambió para el espectador`);
    }
  });

  test('ninguna pantalla existente llamó al servicio externo', () => {
    assert.equal(
      doble.peticiones().length,
      0,
      'alguna pantalla llamó al servicio externo: el asistente dejó de ser un añadido aislado'
    );
  });
});

describe('la pantalla del asistente enseña la guía, no un error', () => {
  for (const rol of ['admin', 'juridico', 'finanzas', 'operaciones', 'ventas', 'espectador']) {
    test(`${rol}: /asistente contesta 200 y pinta su guía`, async () => {
      const r = await sesiones[rol].pedir('/asistente');
      assert.equal(r.status, 200, `${rol} → ${r.status}: ${r.texto.slice(0, 200)}`);
      const html = comoSeLee(r.texto);

      /**
       * Su guía, completa, derivada del contenido y no de una lista escrita aquí.
       *
       * Se comprueban los títulos de TODAS las secciones de ese rol: si mañana
       * se añade una sección a una guía y la pantalla no la pinta, esta prueba
       * lo dice. Afirmar «sale la guía» mirando una frase suelta daría verde con
       * media guía pintada.
       */
      const guia = GUIAS.find((g) => g.rol === rol);
      assert.ok(guia, `no hay guía escrita para el rol «${rol}»`);
      assert.match(html, /Tu guía/, `${rol}: no se pintó la guía`);
      assert.ok(html.includes(guia.titulo), `${rol}: la guía no dice de quién es`);
      const faltan = guia.secciones.map((s) => s.titulo).filter((t) => !html.includes(t));
      assert.deepEqual(faltan, [], `${rol}: la pantalla no pintó estas secciones: ${faltan.join(' · ')}`);

      // Y una explicación, no un error. Se buscan las marcas de un fallo de
      // verdad: un «500» suelto aparece en los nombres de los colores.
      assert.ok(!/Error interno del servidor/.test(html), `${rol}: la pantalla contesta un error interno`);
      assert.ok(!/Application error/.test(html), `${rol}: la pantalla reventó en el navegador`);
      assert.ok(!/digest&quot;:/.test(html), `${rol}: la pantalla trae el rastro de una excepción`);
    });
  }

  test('al que sí lo tendría se le explica que falta configurarlo', async () => {
    const r = await sesiones.admin.pedir('/asistente');
    const html = comoSeLee(r.texto);
    assert.match(html, /todavía no está configurado/i);
    assert.match(html, /todo lo demás funciona igual/i, 'no se dice que la plataforma no está rota');
    // No hay caja de preguntar: ofrecerla sería prometer algo que no puede pasar.
    assert.ok(!/Preguntar<\/button>/.test(html), 'se pinta el botón de preguntar sin con quién conversar');
  });

  test('al espectador se le dice que el asistente es para quien trabaja en la plataforma', async () => {
    const r = await sesiones.espectador.pedir('/asistente');
    const html = comoSeLee(r.texto);
    assert.match(html, /para quien trabaja en la plataforma/i);
    assert.ok(!/Preguntar<\/button>/.test(html));
  });

  test('la llave no viaja al navegador por ningún camino', async () => {
    // Aquí está vacía, así que lo que se vigila es que el nombre de la variable
    // y cualquier rastro de llave no aparezcan en el HTML. Es la comprobación
    // que hay que poder correr también el día que sí haya llave.
    for (const ruta of ['/', '/asistente', '/estado-fuerza']) {
      const r = await sesiones.admin.pedir(ruta);
      assert.ok(!r.texto.includes('ANTHROPIC_API_KEY'), `${ruta} nombra la variable de la llave`);
      assert.ok(!/sk-ant-/.test(r.texto), `${ruta} trae algo con forma de llave`);
    }
  });
});

describe('la ruta del chat contesta 503 en español', () => {
  test('al administrador: 503, sin tocar el servicio externo', async () => {
    doble.olvidar();
    const r = await sesiones.admin.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: '¿cuántos guardias hay?', previas: [] }),
    });
    assert.equal(r.status, 503, `${r.status}: ${r.texto.slice(0, 200)}`);
    assert.match(r.json.error, /no está configurado/i);
    assert.match(r.json.error, /funciona igual/i, 'el mensaje no dice que la plataforma no está rota');
    assert.equal(doble.peticiones().length, 0);
  });

  test('y al espectador le sigue ganando el permiso: 403 antes del 503', async () => {
    // El orden importa: quien no tiene el asistente no necesita enterarse de
    // cómo está configurado el servidor.
    const r = await sesiones.espectador.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'hola', previas: [] }),
    });
    assert.equal(r.status, 403, `${r.status}: ${r.texto.slice(0, 200)}`);
  });

  test('un cuerpo inválido sin llave también contesta 503: primero lo que falta', async () => {
    // Sin llave no hay nada que hacer con el cuerpo, y leerlo primero para
    // contestar un 400 diría que el problema es de quien preguntó.
    const r = await sesiones.admin.pedir('/api/chat', { method: 'POST', body: 'null' });
    assert.equal(r.status, 503, `${r.status}: ${r.texto.slice(0, 200)}`);
  });
});
