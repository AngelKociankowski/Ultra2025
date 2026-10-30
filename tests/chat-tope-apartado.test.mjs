/**
 * El cupo se aparta, no se mira y luego se anota.
 *
 * Tres cosas se miden aquí, y las tres eran defectos medidos:
 *
 *   1. Varias preguntas a la vez. El plan decía que dos pestañas podían colarse
 *      UNA pregunta por encima del tope, y eso era falso: el cupo se leía antes de
 *      llamar y se anotaba al terminar, así que todas las que llegaran antes de la
 *      primera escritura leían el mismo cero y pasaban. Medido con el tope en dos:
 *      veinticinco preguntas simultáneas dejaban pasar entre cuatro y seis, y el
 *      número dependía de cuánto tardara la primera escritura.
 *   2. Lo que cuesta una pregunta que falla. El cliente lleva un reintento, así
 *      que un 500 son dos llamadas facturables; y como un 500 no devuelve uso, el
 *      contador de centavos sumaba cero por las dos. Un día con el servicio
 *      inestable gastaba el doble de llamadas de lo que el contador creía, y el
 *      tope de la empresa —el que de verdad topa la factura— no veía nada.
 *   3. Que el contador no se pueda escribir. Antes se registraba y se seguía: la
 *      pregunta se contestaba y no se contaba, y el único rastro era un renglón en
 *      el registro del servidor. Una racha de fallos de escritura dejaba el tope
 *      apagado sin que nada se viera. Aquí se fuerza el fallo a propósito —se le
 *      quita la tabla por debajo— porque un fallo silencioso que nadie provoca es
 *      un fallo silencioso que se queda años.
 *
 * Los números no se escriben: el tope se lee del entorno con el que arranca cada
 * servidor y las llamadas se cuentan en el doble.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

/** El tope con el que corre este archivo: dos, para medirlo barato. */
const TOPE = 2;
/** Cuántas preguntas se mandan a la vez. De sobra para que se note el hueco. */
const A_LA_VEZ = 25;

let app;
let doble;
let ventas;
let finanzas;

const preguntar = (sesion, pregunta) =>
  sesion.pedir('/api/chat', { method: 'POST', body: JSON.stringify({ pregunta, previas: [] }) });

function conLaBase(laApp, fn) {
  const db = new Database(`${laApp.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const consumoDe = (laApp, email) =>
  conLaBase(laApp, (db) =>
    db
      .prepare(
        `SELECT c.* FROM chat_consumo c JOIN usuarios u ON u.id = c.usuario_id
          WHERE u.email = ? ORDER BY c.dia DESC`
      )
      .all(email)
  );

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: String(TOPE), CHAT_TOPE_CENTAVOS: '100000' },
  });
  ventas = await app.entrarYAsentar(ROLES.ventas);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('el cupo se aparta en la misma transacción que lo mira', () => {
  test('veinticinco preguntas a la vez dejan pasar exactamente las del tope', async () => {
    doble.olvidar();
    doble.guionar([{ texto: 'Listo.' }]);

    const respuestas = await Promise.all(
      Array.from({ length: A_LA_VEZ }, (_, i) => preguntar(ventas, `simultánea ${i}`))
    );
    const pasaron = respuestas.filter((r) => r.status === 200).length;
    const topadas = respuestas.filter((r) => r.status === 429).length;

    assert.equal(
      pasaron,
      TOPE,
      `con el tope en ${TOPE} pasaron ${pasaron} de ${A_LA_VEZ} preguntas simultáneas: el cupo se lee y ` +
        'se escribe en dos momentos distintos y en medio cabe todo'
    );
    assert.equal(topadas, A_LA_VEZ - TOPE, 'alguna no contestó ni 200 ni 429');

    // Y en la base queda UNA fila con el tope exacto, no una carrera de filas.
    const filas = consumoDe(app, ROLES.ventas);
    assert.equal(filas.length, 1, 'quedaron varias filas del mismo día para la misma cuenta');
    assert.equal(filas[0].preguntas, TOPE, `la fila dice ${filas[0].preguntas} preguntas`);

    // Las que no pasaron no gastaron una llamada: el tope se mira antes.
    assert.equal(
      doble.peticiones().length,
      TOPE,
      `el servicio externo recibió ${doble.peticiones().length} llamadas y solo pasaron ${TOPE} preguntas`
    );
  });
});

describe('lo que cuesta una pregunta que el servicio no contesta', () => {
  test('una pregunta con 500 cuesta dos llamadas y el contador las ve', async () => {
    doble.olvidar();
    doble.guionar([{ estado: 500, error: 'falla del proveedor' }]);

    const r = await preguntar(finanzas, 'una que falla');
    assert.equal(r.status, 200, 'el canal se abre igual y el error va dentro');

    const llamadas = doble.peticiones().length;
    assert.ok(llamadas >= 2, `una pregunta con 500 generó ${llamadas} llamada(s): el reintento ya no existe`);

    const [fila] = consumoDe(app, ROLES.finanzas);
    assert.ok(fila, 'una pregunta que falla no se anotó');
    assert.equal(fila.preguntas, 1, 'la pregunta que falla también se cuenta');
    // Sin uso reportado, los tokens son cero —el 500 no trae ninguno— y aun así
    // el gasto no puede ser cero: esas llamadas salieron a la red y se pagan. Se
    // exige al menos un centavo por llamada que de verdad se hizo, contada en el
    // doble y no escrita aquí.
    assert.equal(fila.tokens_entrada, 0, 'un 500 no reporta tokens');
    assert.ok(
      fila.centavos >= llamadas,
      `se hicieron ${llamadas} llamadas al servicio y el contador de la empresa anotó ${fila.centavos} ` +
        'centavos: un día con el servicio inestable gastaría el doble de lo que el contador cree'
    );
  });
});

describe('si el contador no se puede escribir, la pregunta no se contesta', () => {
  test('con la escritura del contador rota, el asistente contesta 503 y no gasta una llamada', async () => {
    /**
     * Se levanta un servidor aparte y se le rompe SOLO la escritura del contador,
     * con la aplicación ya en pie: un disparador que aborta cualquier INSERT en
     * la tabla del consumo. La lectura sigue funcionando, que es exactamente la
     * forma del fallo que el reporte del tester dejó como sospecha sin reproducir
     * —la base bloqueada, el disco lleno— y que no encontró cómo provocar desde
     * fuera. Sin provocarlo no se sabe qué hace la aplicación cuando pasa.
     *
     * Lo que tiene que hacer: no contestar. Un asistente que contesta sin poder
     * contar es un asistente sin tope, y el tope es lo único que topa la factura.
     */
    const otroDoble = await arrancarDoble([{ texto: 'no debería llegar a contestar esto' }]);
    const otraApp = await arrancar({ env: { ...otroDoble.env, CHAT_TOPE_PREGUNTAS: '50' } });
    try {
      const sesion = await otraApp.entrarYAsentar(ROLES.operaciones);

      // Antes de quitarla, una pregunta normal: si esto no pasara, la prueba no
      // mediría el fallo de escritura sino cualquier otra cosa.
      otroDoble.olvidar();
      assert.equal((await preguntar(sesion, 'la de control')).status, 200, 'el control no pasó');
      assert.equal(otroDoble.peticiones().length, 1);

      conLaBase(otraApp, (db) =>
        db
          .prepare(
            `CREATE TRIGGER contador_roto BEFORE INSERT ON chat_consumo
               BEGIN SELECT RAISE(ABORT, 'el contador no se puede escribir'); END`
          )
          .run()
      );
      // La lectura sigue entera: la pantalla puede decir cuántas preguntas
      // quedan. Lo único roto es escribir, que es la forma del fallo.
      assert.equal((await sesion.pedir('/asistente')).status, 200, 'se rompió la lectura y no era eso');

      otroDoble.olvidar();
      const r = await preguntar(sesion, 'la de después');
      assert.equal(r.status, 503, `sin contador contestó ${r.status}: ${r.texto.slice(0, 200)}`);
      assert.match(r.json.error, /[áéíóúñ]/, `el aviso no está en español: ${r.json.error}`);
      assert.match(r.json.error, /pantallas/i, 'el aviso no manda a donde sí hay respuesta');
      assert.equal(
        otroDoble.peticiones().length,
        0,
        'se llamó al servicio externo sin poder anotar la pregunta: eso es gastar sin contar'
      );
      // Y no se le repite a la persona lo que dijo la base.
      assert.ok(!/SQLITE|RAISE|chat_consumo/i.test(r.texto), `el aviso filtra el error de la base: ${r.texto}`);

      // Y el consumo que ya estaba anotado sigue ahí: no se perdió nada por el
      // camino, solo no se pudo sumar la pregunta nueva.
      const [fila] = consumoDe(otraApp, ROLES.operaciones);
      assert.equal(fila.preguntas, 1, 'la de control dejó de estar contada');
    } finally {
      await otraApp.cerrar();
      await otroDoble.cerrar();
    }
  });
});
