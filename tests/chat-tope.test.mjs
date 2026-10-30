/**
 * El tope: 25 preguntas por persona y por día, más un tope de la empresa.
 *
 * La decisión del director es que al llegar se cierra hasta el día siguiente,
 * con un aviso que dice cuándo vuelve. Es la única forma que topa el gasto sin
 * trabajo del director, y el aviso importa tanto como el tope: «no puedes
 * preguntar» sin decir cuándo vuelve se lee como una falla y alguien va a
 * llamar para reportarlo.
 *
 * El tope se baja a 2 por variable de entorno para poder medirlo en tres
 * preguntas en vez de veintiséis. Los números NO se escriben en las
 * aserciones: se leen del módulo, que es quien los decide.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

let app;
let doble;
let ventas;
let operaciones;

/** El tope con el que corre este archivo. Dos preguntas, para medirlo barato. */
const TOPE = 2;
/** Los tokens que el doble reporta, para poder comprobar el contador. */
const USO = {
  input_tokens: 777,
  output_tokens: 131,
  cache_read_input_tokens: 5111,
  cache_creation_input_tokens: 42,
};

const preguntar = (sesion, pregunta) =>
  sesion.pedir('/api/chat', { method: 'POST', body: JSON.stringify({ pregunta, previas: [] }) });

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const consumoDe = (email) =>
  conLaBase((db) =>
    db
      .prepare(
        `SELECT c.* FROM chat_consumo c JOIN usuarios u ON u.id = c.usuario_id
          WHERE u.email = ? ORDER BY c.dia DESC`
      )
      .all(email)
  );

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.', uso: USO }]);
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: String(TOPE), CHAT_TOPE_CENTAVOS: '100000' },
  });
  ventas = await app.entrarYAsentar(ROLES.ventas);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('el tope por persona y por día', () => {
  test('la tercera pregunta del día devuelve 429 y dice cuándo vuelve', async () => {
    for (let i = 1; i <= TOPE; i += 1) {
      const r = await preguntar(ventas, `pregunta ${i}`);
      assert.equal(r.status, 200, `la pregunta ${i} tenía que entrar: ${r.texto.slice(0, 200)}`);
      const fin = eventos(r.texto).at(-1);
      assert.equal(fin.tipo, 'fin');
      assert.equal(fin.restantes, TOPE - i, `después de la ${i} tenían que quedar ${TOPE - i}`);
    }

    const pasada = await preguntar(ventas, 'una más, por favor');
    assert.equal(pasada.status, 429, `la pregunta de más → ${pasada.status}: ${pasada.texto.slice(0, 200)}`);
    assert.match(pasada.json.error, new RegExp(`${TOPE} preguntas`), pasada.json.error);
    assert.match(pasada.json.error, /mañana/i, `el aviso no dice cuándo vuelve: «${pasada.json.error}»`);
    // Y manda a donde sí hay respuesta, en vez de dejar a la persona sin salida.
    assert.match(pasada.json.error, /pantallas/i, pasada.json.error);
  });

  test('el tope es por persona: otra cuenta sigue teniendo cupo', async () => {
    const r = await preguntar(operaciones, '¿cómo va la operación?');
    assert.equal(r.status, 200, `operaciones se quedó sin cupo por lo que gastó ventas: ${r.texto.slice(0, 200)}`);
    assert.equal(eventos(r.texto).at(-1).restantes, TOPE - 1);
  });

  test('el consumo queda anotado, con los tokens que devolvió el servicio', () => {
    const [fila] = consumoDe(ROLES.ventas);
    assert.ok(fila, 'no se anotó nada del consumo de ventas');
    // Se anotan las que entraron, no la que se rechazó: la rechazada no llamó
    // al servicio y no costó nada.
    assert.equal(fila.preguntas, TOPE);
    assert.equal(fila.tokens_entrada, USO.input_tokens * TOPE);
    assert.equal(fila.tokens_salida, USO.output_tokens * TOPE);
    assert.equal(fila.tokens_cache_lee, USO.cache_read_input_tokens * TOPE);
    assert.equal(fila.tokens_cache_pone, USO.cache_creation_input_tokens * TOPE);
    assert.ok(fila.centavos > 0, 'el costo estimado salió en cero: el tope de la empresa no podría existir');
    assert.match(fila.dia, /^20\d{2}-\d{2}-\d{2}$/, `el día se anotó como «${fila.dia}»`);

    // Una sola fila por cuenta y por día: el UNIQUE y el ON CONFLICT hacen su
    // trabajo, y no hay dos contadores del mismo día contándose por separado.
    assert.equal(consumoDe(ROLES.ventas).length, 1);

    // Y el día es el de la oficina, el mismo que usa el resto de la plataforma.
    const hoyEnLaOficina = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    assert.equal(fila.dia, hoyEnLaOficina, 'el contador usa otro reloj que el resto de la plataforma');
  });

  test('al topar, el doble ya no recibe nada: el tope se mira antes de gastar', async () => {
    doble.olvidar();
    const r = await preguntar(ventas, 'y otra');
    assert.equal(r.status, 429);
    assert.equal(doble.peticiones().length, 0, 'una pregunta sin cupo llegó al servicio externo y costó dinero');
  });
});

describe('el tope de toda la empresa', () => {
  test('con el gasto del día agotado, se cierra para todos y se dice que no es tuyo', async () => {
    /**
     * Se levanta un servidor aparte con el tope de la empresa en el mínimo.
     *
     * Hace falta otro porque los dos topes se leen del entorno al arrancar, y es
     * así a propósito: un tope que se pudiera cambiar en caliente no sería un
     * tope. El del individuo se deja alto para que lo que falle sea el de la
     * empresa y no el otro.
     */
    const otroDoble = await arrancarDoble([{ texto: 'Listo.', uso: USO }]);
    const otraApp = await arrancar({
      env: { ...otroDoble.env, CHAT_TOPE_PREGUNTAS: '50', CHAT_TOPE_CENTAVOS: '1' },
    });
    try {
      const unaCuenta = await otraApp.entrarYAsentar(ROLES.ventas);
      const otraCuenta = await otraApp.entrarYAsentar(ROLES.finanzas);

      // La primera entra: el gasto del día arranca en cero.
      assert.equal((await preguntar(unaCuenta, 'la primera')).status, 200);

      // Y a partir de ahí se cierra para quien sea, porque el gasto es de la
      // empresa y no de la persona.
      const topada = await preguntar(otraCuenta, 'la segunda, de otra cuenta');
      assert.equal(topada.status, 429, `${topada.status}: ${topada.texto.slice(0, 200)}`);
      assert.match(topada.json.error, /de la empresa/i, topada.json.error);
      assert.match(topada.json.error, /mañana/i, topada.json.error);
      // Dice que las preguntas propias no se gastaron: si no, la persona cree
      // que el error es suyo y no vuelve a intentarlo mañana.
      assert.match(topada.json.error, /no se gastaron/i, topada.json.error);
    } finally {
      await otraApp.cerrar();
      await otroDoble.cerrar();
    }
  });

  test('los topes por omisión son los que decidió el director', async () => {
    // Sin variables de entorno. Se leen del módulo y no se escriben aquí dos
    // veces: lo que se afirma es que el valor por omisión es 25, que es la
    // decisión, y que no se lee con parseInt, que es lo prohibido en la casa.
    const { register } = await import('node:module');
    register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
    const fuente = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../lib/chat-tope.js', import.meta.url), 'utf8')
    );
    assert.match(fuente, /TOPE_PREGUNTAS = numeroDeEntorno\(process\.env\.CHAT_TOPE_PREGUNTAS, 25\)/);
    assert.match(fuente, /TOPE_CENTAVOS = numeroDeEntorno\(process\.env\.CHAT_TOPE_CENTAVOS, 60\)/);
    assert.ok(!/\bparse(Int|Float)\s*\(/.test(fuente), 'el módulo del tope lee números con parseInt');
  });

  test('el costo estimado crece con el uso y redondea hacia arriba', async () => {
    /**
     * El estimado es lo único que hace posible el tope de la empresa, así que
     * tiene que cumplir tres cosas: no dar cero para un uso real, crecer cuando
     * el uso crece, y redondear HACIA ARRIBA. Un estimado que redondea a la baja
     * se pasa del tope siempre, un centavo por pregunta.
     */
    const { register } = await import('node:module');
    register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
    const { centavosDe } = await import(new URL('../lib/chat-tope.js', import.meta.url).href);

    assert.equal(centavosDe({}), 0, 'sin uso no hay costo');
    const poco = centavosDe({ entrada: 500, salida: 120, cacheLectura: 5200, cacheEscritura: 0 });
    const mucho = centavosDe({ entrada: 5000, salida: 1200, cacheLectura: 52000, cacheEscritura: 0 });
    assert.ok(poco > 0, 'una pregunta de verdad costó cero: el tope de la empresa no podría existir');
    assert.ok(mucho > poco, `diez veces el uso costó ${mucho} y el uso normal ${poco}`);

    // Hacia arriba: un uso diminuto cuesta un centavo, no cero.
    assert.equal(centavosDe({ salida: 1 }), 1);

    // Y la lectura de caché es mucho más barata que la entrada sin cachear, que
    // es la razón entera de tener un prefijo estable.
    const sinCache = centavosDe({ entrada: 10_000 });
    const conCache = centavosDe({ cacheLectura: 10_000 });
    assert.ok(conCache < sinCache, 'leer de caché no sale más barato: el prefijo estable no serviría de nada');
  });

  test('un tope mal escrito en el entorno no apaga el tope', async () => {
    /**
     * Un `NaN` no topa nada: toda comparación con él es falsa. Así que un valor
     * que no se entiende tiene que caer en la omisión y no dejar el tope
     * apagado en silencio, que es la peor de las dos formas de equivocarse.
     */
    const otroDoble = await arrancarDoble([{ texto: 'Listo.' }]);
    const otraApp = await arrancar({
      env: { ...otroDoble.env, CHAT_TOPE_PREGUNTAS: 'muchas', CHAT_TOPE_CENTAVOS: '-5' },
    });
    try {
      const sesion = await otraApp.entrarYAsentar(ROLES.ventas);
      const r = await preguntar(sesion, 'una pregunta');
      assert.equal(r.status, 200, r.texto.slice(0, 200));
      // Con la omisión puesta, quedan 24 de 25.
      assert.equal(eventos(r.texto).at(-1).restantes, 24, 'el tope no cayó en su valor por omisión');
    } finally {
      await otraApp.cerrar();
      await otroDoble.cerrar();
    }
  });
});
