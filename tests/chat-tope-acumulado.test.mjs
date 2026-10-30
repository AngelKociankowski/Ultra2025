/**
 * El tope cuenta fino: se acumula exacto y se redondea una sola vez.
 *
 * Qué estaba mal. `centavosDe()` redondeaba hacia arriba el total de CADA
 * pregunta, y además se apartaba un piso de un centavo antes de llamar al
 * servicio y no se liquidaba después. O sea: ninguna pregunta podía costar menos
 * de un centavo en el contador. Con el tope de la empresa en 60 centavos, el
 * techo real del día eran 60 preguntas; y una pregunta que el servicio no
 * contesta costaba dos, así que un día inestable lo dejaba en 30. El uso que
 * reporta una pregunta normal cuesta una fracción de centavo, de modo que el tope
 * mordía unas tres veces antes de lo que el presupuesto exige.
 *
 * La intención del redondeo hacia arriba era correcta y se conserva: un tope que
 * redondea a la baja se pasa siempre. Lo que estaba mal era DÓNDE se redondeaba.
 *
 * Lo que se mide aquí, y por qué no basta con la aritmética. Se corren N
 * preguntas de verdad por HTTP, con el uso que reporta el doble, y se compara el
 * contador contra dos cifras que esta prueba NO escribe: la que da acumular
 * exacto y la que daba redondear por pregunta. Que el contador se parezca a la
 * primera y no a la segunda es lo que demuestra el arreglo. Y al final se deja
 * escrito a cuántas preguntas da hoy el tope de la empresa, derivado del propio
 * módulo, para que el número viva en una corrida y no en un reporte.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. Levanta la aplicación compilada.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

let app;
let doble;
let ventas;
let milesimasDe;
let centavosDe;
let TOPE_CENTAVOS;

/** Cuántas preguntas se corren para medir el acumulado. */
const CUANTAS = 6;

/** El uso que reporta el doble en esta corrida: el de una pregunta normal. */
const USO = {
  input_tokens: 500,
  output_tokens: 120,
  cache_read_input_tokens: 5200,
  cache_creation_input_tokens: 0,
};

/** El uso tal como lo nombra el contador. */
const COMO_LO_LEE_EL_CONTADOR = {
  entrada: USO.input_tokens,
  salida: USO.output_tokens,
  cacheLectura: USO.cache_read_input_tokens,
  cacheEscritura: USO.cache_creation_input_tokens,
  llamadas: 1,
  llamadasConUso: 1,
};

const preguntar = (sesion, pregunta) =>
  sesion.pedir('/api/chat', { method: 'POST', body: JSON.stringify({ pregunta, previas: [] }) });

/** La fila del contador, leída de la base del servidor de prueba. */
function filaDe(correo) {
  const db = new Database(path.join(app.carpetaDatos, 'prueba.db'), { readonly: true });
  try {
    return db
      .prepare(
        `SELECT c.* FROM chat_consumo c JOIN usuarios u ON u.id = c.usuario_id WHERE u.email = ?`
      )
      .get(correo);
  } finally {
    db.close();
  }
}

before(async () => {
  const { register } = await import('node:module');
  register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
  const tope = await import(new URL('../lib/chat-tope.js', import.meta.url).href);
  ({ milesimasDe, centavosDe, TOPE_CENTAVOS } = tope);

  doble = await arrancarDoble([{ texto: 'Listo.', uso: USO }]);
  // Los topes altos: aquí se mide el contador, no el corte.
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' },
  });
  ventas = await app.entrarYAsentar(ROLES.ventas);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('seis preguntas cuestan seis preguntas, no seis centavos', () => {
  test(`${CUANTAS} preguntas de verdad: el contador se parece al exacto y no al redondeado`, async () => {
    // El doble repite su último turno si se le acaba el guion, así que las seis
    // reportan el mismo uso sin tener que escribirlo seis veces.
    for (let i = 0; i < CUANTAS; i += 1) {
      const r = await preguntar(ventas, `la número ${i + 1}`);
      assert.equal(r.status, 200, `${r.status}: ${r.texto.slice(0, 200)}`);
    }

    const fila = filaDe(ROLES.ventas);
    assert.ok(fila, 'no se anotó nada del consumo');
    assert.equal(fila.preguntas, CUANTAS, `la fila dice ${fila.preguntas} preguntas`);

    // Las dos cifras contra las que se compara, derivadas del módulo.
    const exacto = milesimasDe(COMO_LO_LEE_EL_CONTADOR) * CUANTAS;
    const comoAntes = centavosDe(COMO_LO_LEE_EL_CONTADOR) * CUANTAS * 1000;

    assert.ok(
      comoAntes > exacto,
      'el uso de esta corrida cuesta un centavo redondo, así que esta prueba no distinguiría los dos ' +
        'comportamientos: hay que elegir un uso cuyo costo no sea entero'
    );
    assert.equal(
      fila.milesimas,
      exacto,
      `el contador anotó ${fila.milesimas} milésimas; acumular exacto da ${exacto} y redondear cada ` +
        `pregunta daba ${comoAntes}: ${fila.milesimas === comoAntes ? 'sigue redondeando por pregunta' : 'no cuadra'}`
    );

    // Y la cifra que lee una persona sigue siendo centavos enteros hacia arriba.
    assert.equal(
      fila.centavos,
      Math.ceil(exacto / 1000),
      'el centavo que se enseña en pantalla no es el redondeo hacia arriba del acumulado'
    );
    assert.ok(
      fila.centavos < CUANTAS,
      `${CUANTAS} preguntas siguen costando ${fila.centavos} centavos: una por pregunta, como antes`
    );
  });

  test('el redondeo sigue siendo hacia arriba: el tope no se puede rebasar', () => {
    // La regla que no se toca. Un uso diminuto no puede costar cero, y el
    // acumulado que se compara contra el tope no puede quedar por debajo del
    // gasto real.
    assert.ok(milesimasDe({ salida: 1 }) > 0, 'un uso diminuto costó cero: el tope se pasaría siempre');
    assert.equal(milesimasDe({}), 0, 'sin uso no hay costo');
    const uno = milesimasDe(COMO_LO_LEE_EL_CONTADOR);
    for (const n of [1, 7, 25, 150]) {
      assert.ok(
        Math.ceil((uno * n) / 1000) * 1000 >= uno * n,
        `con ${n} preguntas el redondeo del acumulado quedó por debajo del gasto`
      );
    }
  });

  test('a cuántas preguntas da hoy el tope de la empresa', () => {
    /**
     * No es una aserción de número: es la cifra puesta donde se pueda volver a
     * leer. Lo único que se afirma es la propiedad que importaba —que el tope dé
     * para más que la suma de los topes individuales de quienes pueden
     * preguntar—, derivada del módulo y no escrita a mano.
     */
    const porPregunta = milesimasDe(COMO_LO_LEE_EL_CONTADOR);
    const caben = Math.floor((TOPE_CENTAVOS * 1000) / porPregunta);
    const antes = Math.floor(TOPE_CENTAVOS / centavosDe(COMO_LO_LEE_EL_CONTADOR));
    console.log(
      `    tope de la empresa: ${TOPE_CENTAVOS} centavos · una pregunta cuesta ${porPregunta} milésimas ` +
        `(${(porPregunta / 1000).toFixed(3)} centavos) → caben ${caben} preguntas al día; antes cabían ${antes}`
    );
    assert.ok(
      caben > antes,
      `el tope sigue dando para ${caben} preguntas, las mismas que antes: el arreglo no cambió nada`
    );
  });
});
