/**
 * El tope del asistente: cuántas preguntas por persona y por día, y cuánto
 * gasta la empresa en un día.
 *
 * Por qué hay dos topes y no uno. El tope de 25 por persona existe para que un
 * día en el que alguien le toma el gusto no se lleve el mes; el tope de la
 * empresa existe porque seis personas con 25 cada una suman más de lo que el
 * director aceptó gastar. El individual deja preguntar mucho sin repartir
 * cuotas; el de la empresa es el que de verdad topa la factura.
 *
 * El cupo no se comprueba y luego se anota: se APARTA, en una sola transacción
 * que mira el cupo y suma la pregunta sin que nadie se cuele en medio
 * (`apartarPregunta`). Después, cuando la respuesta termina, se le suma lo que
 * costó (`anotarConsumo`), que ya no cuenta otra pregunta.
 *
 * Antes era al revés —mirar, llamar, anotar— y el margen que eso abría no estaba
 * acotado en «una pregunta», como se creía: todas las peticiones que llegaran
 * antes de la primera escritura leían el mismo cero y pasaban. Medido, con el
 * tope en dos: veinticinco preguntas a la vez dejaban pasar entre cuatro y seis,
 * y el número dependía de cuánto tardara la primera escritura, no de ningún
 * candado. Apartar antes de llamar cuesta una transacción por pregunta y deja el
 * margen en cero, con una pega conocida y aceptada: una pregunta que se cae antes
 * de salir del servidor también se cuenta. Es el lado correcto del error —se
 * cuenta de más, no de menos—, y el gasto que no se hizo no se suma.
 *
 * La transacción va en `immediate` y no en diferido: así SQLite toma el candado
 * de escritura al abrirla y dos procesos contra la misma base se serializan igual
 * que dos peticiones del mismo proceso. Con `BEGIN` diferido, el candado se toma
 * en la primera escritura y las dos lecturas podrían verse el mismo cero.
 *
 * El gasto se acumula en MILÉSIMAS de centavo y se redondea hacia arriba una
 * sola vez, al leerlo para compararlo con el tope o para enseñarlo. Redondear
 * cada pregunta a un centavo entero —que es lo que hacía antes— le cobraba el
 * triple de lo que cuesta y recortaba el techo del día de toda la empresa a un
 * tercio, sin que nada lo dijera.
 *
 * Nada de este archivo escribe en una tabla de datos capturados. Lo único que
 * escribe es su propio contador, con números que reporta el servicio externo:
 * no hay nadie tecleando, así que no hay nada que preguntarle al sitio único de
 * la captura.
 */

import { getDb } from './db';
import { hoy, marcaDeTiempo } from './fechas';

/**
 * Se leen con `Number(process.env.X ?? omisión)` y no con `parseInt`.
 *
 * Los módulos del chat no son puertas de captura, pero el guardián de la
 * captura persigue `parseInt` y `parseFloat` justamente porque son los lectores
 * con los que la basura entró cuatro veces: escribir aquí lo que allá está
 * prohibido es cómo se enseña a copiar el error.
 *
 * Un valor que no se entiende cae en la omisión en vez de quedar en `NaN`: un
 * tope `NaN` no topa nada —toda comparación con él es falsa— y sería un tope
 * apagado sin que nadie se enterara.
 */
function numeroDeEntorno(crudo, omision) {
  const n = Number(crudo ?? omision);
  return Number.isFinite(n) && n > 0 ? n : omision;
}

/** Preguntas por persona y por día. Decisión del director. */
export const TOPE_PREGUNTAS = numeroDeEntorno(process.env.CHAT_TOPE_PREGUNTAS, 25);

/**
 * Gasto estimado de toda la empresa en un día, en centavos de dólar.
 *
 * Sale del presupuesto que el director aceptó —12 a 15 USD al mes— repartido en
 * días hábiles, con holgura para un día cargado.
 */
export const TOPE_CENTAVOS = numeroDeEntorno(process.env.CHAT_TOPE_CENTAVOS, 60);

/**
 * Las tarifas con las que se estima el costo, en centavos de dólar por millón
 * de tokens. No nombran el modelo: ese vive en un solo archivo.
 *
 * Es una estimación para que el tope de la empresa pueda existir, no una
 * factura, y la pantalla lo dice con esa palabra. La factura de verdad la emite
 * el proveedor y puede no coincidir al centavo.
 */
const TARIFAS = {
  entrada: 200,
  salida: 1000,
  cacheLectura: 20,
  cacheEscritura: 250,
};

/**
 * Lo que cuesta como mínimo una llamada al servicio que no reportó su uso.
 *
 * Un 500, un corte a media respuesta o una espera agotada no traen `usage`, así
 * que por tokens suman cero… y la llamada se hizo y se paga: el prefijo entero
 * viajó antes de que el servicio se cayera. Con el contador en cero, un día con
 * el servicio inestable gasta el doble de llamadas de lo que el contador cree, y
 * el tope de la empresa —el que de verdad topa la factura— no ve nada.
 *
 * Un centavo por intento es el piso, no la factura: es aproximadamente lo que
 * cuesta leer de caché un prefijo de este tamaño. Se queda corto antes que largo
 * a propósito; lo que no puede es quedarse en cero.
 */
const CENTAVOS_MINIMOS_POR_INTENTO = 1;

/**
 * En qué unidad se acumula el gasto: milésimas de centavo.
 *
 * El contador no puede acumular en centavos enteros. Una pregunta cuesta una
 * fracción de centavo —con el uso que reporta el servicio, del orden de un
 * tercio— y redondear hacia arriba PREGUNTA POR PREGUNTA le cobraba un centavo
 * entero a cada una: con el tope de la empresa en 60, el techo real del día eran
 * 60 preguntas en vez de las que el presupuesto paga. Y una pregunta que el
 * servicio no contesta cobraba dos, así que un día inestable lo dejaba en 30.
 *
 * La intención del redondeo hacia arriba era correcta y se conserva: un tope que
 * redondea a la baja se pasa siempre. Lo que estaba mal era DÓNDE se redondeaba.
 * Aquí se acumula exacto, en milésimas, y se redondea hacia arriba una sola vez:
 * al leer el gasto para compararlo con el tope y para enseñarlo en pantalla.
 */
const MILESIMAS_POR_CENTAVO = 1000;

/**
 * Cuántas veces puede llegar a salir a la red UNA llamada.
 *
 * El cliente se arma con un reintento, así que una pregunta que falla cuesta dos
 * llamadas facturables. El tester lo midió: un 500 genera dos peticiones.
 */
const INTENTOS_POR_LLAMADA = 2;

/**
 * Lo que cuesta un uso reportado, estimado y en MILÉSIMAS de centavo.
 *
 * Esta es la cifra que se acumula, y no se redondea a centavos aquí: el redondeo
 * hacia arriba pasa una vez, al leer el total del día. La milésima sí se cierra
 * hacia arriba, que es un error de una milésima por pregunta y conserva la regla
 * de no quedarse nunca por debajo.
 *
 * `uso.llamadas` y `uso.llamadasConUso` los lleva el ciclo de la conversación. La
 * diferencia entre las dos son las llamadas que se hicieron y no reportaron nada:
 * esas se cobran al piso, por intento, porque salieron a la red igual.
 */
export function milesimasDe(uso = {}) {
  const t = (cuantos, tarifa) => ((Number(cuantos) || 0) * tarifa) / 1_000_000;
  const total =
    t(uso.entrada, TARIFAS.entrada) +
    t(uso.salida, TARIFAS.salida) +
    t(uso.cacheLectura, TARIFAS.cacheLectura) +
    t(uso.cacheEscritura, TARIFAS.cacheEscritura);
  const sinReportar = Math.max(0, (Number(uso.llamadas) || 0) - (Number(uso.llamadasConUso) || 0));
  const piso = sinReportar * INTENTOS_POR_LLAMADA * CENTAVOS_MINIMOS_POR_INTENTO;
  return Math.ceil(total * MILESIMAS_POR_CENTAVO) + piso * MILESIMAS_POR_CENTAVO;
}

/**
 * Lo mismo en centavos enteros y hacia arriba: lo que costaría UNA pregunta
 * suelta, en la unidad en la que una persona lee el dinero.
 *
 * No es lo que se acumula —eso son milésimas— y por eso no se usa para sumar.
 * Se usa para una cosa concreta: saber cuánto apartar antes de llamar al
 * servicio, que es el peor caso de una pregunta.
 */
export function centavosDe(uso = {}) {
  return Math.ceil(milesimasDe(uso) / MILESIMAS_POR_CENTAVO);
}

/**
 * Lo que se aparta antes de llamar al servicio, en milésimas.
 *
 * Es el PEOR caso de una pregunta: una llamada que no reporta nada y que el
 * cliente reintenta, o sea los dos intentos cobrados al piso. Se aparta de más a
 * propósito, porque mientras la pregunta está en vuelo nadie sabe lo que va a
 * costar y el tope de la empresa no puede ir por detrás de la realidad.
 *
 * Y se liquida al terminar: `anotarGasto` quita lo apartado y pone lo que de
 * verdad costó, que casi siempre es menos. Si esa escritura no llegara a ocurrir,
 * lo apartado se queda, que es exactamente lo que tiene que pasar.
 */
const MILESIMAS_APARTADAS = centavosDe({ llamadas: 1, llamadasConUso: 0 }) * MILESIMAS_POR_CENTAVO;

/** Centavos enteros, hacia arriba, a partir de un acumulado en milésimas. */
const aCentavos = (milesimas) => Math.ceil((Number(milesimas) || 0) / MILESIMAS_POR_CENTAVO);

/** El renglón de hoy de esa cuenta, o uno en ceros si todavía no preguntó. */
export function consumoDeHoy(usuarioId) {
  const dia = hoy();
  const fila = getDb()
    .prepare('SELECT * FROM chat_consumo WHERE usuario_id = ? AND dia = ?')
    .get(Number(usuarioId), dia);
  return (
    fila || {
      usuario_id: Number(usuarioId),
      dia,
      preguntas: 0,
      tokens_entrada: 0,
      tokens_salida: 0,
      tokens_cache_lee: 0,
      tokens_cache_pone: 0,
      milesimas: 0,
      centavos: 0,
    }
  );
}

/**
 * Lo que la empresa lleva gastado hoy, estimado y en centavos.
 *
 * Se suman las milésimas de todas las cuentas y se redondea hacia arriba UNA
 * vez, aquí. Sumar el `centavos` ya redondeado de cada fila volvería a cobrar el
 * redondeo por cuenta, que es la misma equivocación un piso más arriba.
 */
export function gastoDelDia(dia = hoy()) {
  const suma =
    getDb().prepare('SELECT COALESCE(SUM(milesimas), 0) AS m FROM chat_consumo WHERE dia = ?').get(dia).m || 0;
  return aCentavos(suma);
}

/** Lo que la empresa lleva gastado en el mes, estimado y en centavos. */
export function gastoDelMes(mes = hoy().slice(0, 7)) {
  const suma =
    getDb()
      .prepare("SELECT COALESCE(SUM(milesimas), 0) AS m FROM chat_consumo WHERE substr(dia, 1, 7) = ?")
      .get(mes).m || 0;
  return aCentavos(suma);
}

/**
 * El veredicto sobre un consumo ya leído: ¿queda cupo?
 *
 * Se parte en una función aparte porque lo usan los dos caminos —la pantalla, que
 * solo mira, y el apartado, que mira y escribe en la misma transacción— y el día
 * que los dos digan cosas distintas, la persona verá «te quedan 3» y recibirá un
 * 429. Un solo sitio decide y un solo sitio escribe el aviso.
 *
 * El `motivo` va en español y dice cuándo vuelve, porque es el texto que lee una
 * persona en la pantalla y no un código que lee otro programa.
 */
function veredicto(preguntas, gasto) {
  const restantes = Math.max(0, TOPE_PREGUNTAS - preguntas);

  if (preguntas >= TOPE_PREGUNTAS) {
    return {
      cupo: false,
      preguntas,
      tope: TOPE_PREGUNTAS,
      restantes: 0,
      motivo:
        `Llegaste a tus ${TOPE_PREGUNTAS} preguntas de hoy. El asistente vuelve mañana a las 00:00. ` +
        'Mientras tanto, lo que necesites se ve en las pantallas de siempre.',
    };
  }

  if (gasto >= TOPE_CENTAVOS) {
    return {
      cupo: false,
      preguntas,
      tope: TOPE_PREGUNTAS,
      restantes,
      motivo:
        'El asistente llegó al gasto del día de toda la empresa. Vuelve mañana a las 00:00. ' +
        'Tus preguntas de hoy no se gastaron: es el tope de la empresa, no el tuyo.',
    };
  }

  return { cupo: true, preguntas, tope: TOPE_PREGUNTAS, restantes, motivo: '' };
}

/**
 * ¿Le queda cupo a esta cuenta hoy? Solo mira; no aparta nada.
 *
 * Es lo que necesita la pantalla, que tiene que decir cuántas quedan incluso
 * cuando sí hay: «te quedan 3» evita la sorpresa de llegar al tope a media
 * conversación. Para contestar una pregunta NO se usa esta: se usa
 * `apartarPregunta`, porque mirar y después escribir es justo el hueco por el que
 * se colaban varias preguntas a la vez.
 */
export function hayCupo(usuarioId) {
  return veredicto(consumoDeHoy(usuarioId).preguntas || 0, gastoDelDia());
}

/**
 * Aparta una pregunta del cupo de hoy, o dice por qué no.
 *
 * Mirar el cupo y sumar la pregunta pasan en la MISMA transacción, en
 * `immediate`, así que entre lo uno y lo otro no cabe otra petición ni otro
 * proceso. Es lo que deja el margen en cero: antes el cupo se leía antes de
 * llamar al servicio y se anotaba al terminar, y todo lo que llegara en medio
 * leía el mismo número viejo.
 *
 * Se aparta además el peor caso del gasto (`MILESIMAS_APARTADAS`), antes de que
 * la llamada salga. Dos razones: la llamada se va a hacer y se va a pagar aunque
 * la respuesta se caiga, y si la escritura del final no llegara a ocurrir —ese es
 * el otro camino, el que se queda callado— el gasto de la empresa no se quedaría
 * en cero por esta pregunta. Al terminar, `anotarGasto` lo liquida y deja el
 * costo real.
 */
export function apartarPregunta(usuarioId) {
  const db = getDb();
  const dia = hoy();
  const id = Number(usuarioId);

  const apartar = db.transaction(() => {
    const fila = db
      .prepare('SELECT preguntas FROM chat_consumo WHERE usuario_id = ? AND dia = ?')
      .get(id, dia);
    const milesimasDelDia =
      db.prepare('SELECT COALESCE(SUM(milesimas), 0) AS m FROM chat_consumo WHERE dia = ?').get(dia).m || 0;

    const dictamen = veredicto(fila?.preguntas || 0, aCentavos(milesimasDelDia));
    if (!dictamen.cupo) return dictamen;

    db.prepare(
      `INSERT INTO chat_consumo
         (usuario_id, dia, preguntas, tokens_entrada, tokens_salida, tokens_cache_lee, tokens_cache_pone,
          milesimas, centavos, actualizado_en)
       VALUES (?, ?, 1, 0, 0, 0, 0, ?, ?, ?)
       ON CONFLICT (usuario_id, dia) DO UPDATE SET
         preguntas      = preguntas + 1,
         milesimas      = milesimas + excluded.milesimas,
         centavos       = (milesimas + excluded.milesimas + ${MILESIMAS_POR_CENTAVO - 1}) / ${MILESIMAS_POR_CENTAVO},
         actualizado_en = excluded.actualizado_en`
    ).run(id, dia, MILESIMAS_APARTADAS, aCentavos(MILESIMAS_APARTADAS), marcaDeTiempo());

    // La pregunta ya está contada: lo que queda es una menos de lo que decía el
    // veredicto, y es lo que la pantalla y el evento de cierre van a enseñar.
    return { ...dictamen, preguntas: dictamen.preguntas + 1, restantes: Math.max(0, dictamen.restantes - 1) };
  });

  return apartar.immediate();
}

/**
 * Suma a la fila de hoy lo que costó una pregunta ya apartada.
 *
 * NO cuenta otra pregunta: esa la contó `apartarPregunta` antes de llamar al
 * servicio. Aquí entran los tokens y la liquidación del gasto: se quita lo que se
 * apartó y se pone lo que de verdad costó.
 *
 * Se llama aunque la respuesta haya terminado en error, con el uso que alcanzó a
 * reportarse: lo gastado se gastó, y un tope que solo cuenta los éxitos es un
 * tope que una racha de fallos deja sin efecto.
 */
export function anotarGasto(usuarioId, uso = {}) {
  const db = getDb();
  const dia = hoy();
  /**
   * Lo que de verdad costó, exacto y en milésimas. Al sumarlo se descuenta lo
   * que se apartó al pedir el turno, así que la fila queda con el costo real y
   * no con el peor caso: esa es la liquidación, y es lo que hace que una
   * pregunta de un tercio de centavo cueste un tercio de centavo y no uno.
   *
   * Si la fila no existiera —solo puede pasar si el día cambió entre apartar y
   * anotar— entra el costo sin descontar nada, porque en esa otra fila no hay
   * nada apartado que liquidar.
   */
  const milesimas = milesimasDe(uso);
  const liquidado = `MAX(0, milesimas + excluded.milesimas - ${MILESIMAS_APARTADAS})`;
  const n = (v) => Number(v) || 0;

  const guardar = db.transaction(() => {
    db.prepare(
      `INSERT INTO chat_consumo
         (usuario_id, dia, preguntas, tokens_entrada, tokens_salida, tokens_cache_lee, tokens_cache_pone,
          milesimas, centavos, actualizado_en)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (usuario_id, dia) DO UPDATE SET
         tokens_entrada    = tokens_entrada + excluded.tokens_entrada,
         tokens_salida     = tokens_salida + excluded.tokens_salida,
         tokens_cache_lee  = tokens_cache_lee + excluded.tokens_cache_lee,
         tokens_cache_pone = tokens_cache_pone + excluded.tokens_cache_pone,
         milesimas         = ${liquidado},
         centavos          = (${liquidado} + ${MILESIMAS_POR_CENTAVO - 1}) / ${MILESIMAS_POR_CENTAVO},
         actualizado_en    = excluded.actualizado_en`
    ).run(
      Number(usuarioId),
      dia,
      n(uso.entrada),
      n(uso.salida),
      n(uso.cacheLectura),
      n(uso.cacheEscritura),
      milesimas,
      aCentavos(milesimas),
      marcaDeTiempo()
    );
  });
  guardar.immediate();

  return consumoDeHoy(usuarioId);
}
