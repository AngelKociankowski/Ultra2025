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
 * El cupo se comprueba ANTES de llamar al servicio externo y se anota DESPUÉS,
 * con el uso que devuelve la respuesta. Dos pestañas a la vez pueden colarse una
 * pregunta por encima del tope: se acepta y se dice aquí, porque la alternativa
 * —un candado por usuario— complica el código para ahorrar un centavo.
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

/** Lo que cuesta, estimado y en centavos enteros, un uso reportado. */
export function centavosDe(uso = {}) {
  const t = (cuantos, tarifa) => ((Number(cuantos) || 0) * tarifa) / 1_000_000;
  const total =
    t(uso.entrada, TARIFAS.entrada) +
    t(uso.salida, TARIFAS.salida) +
    t(uso.cacheLectura, TARIFAS.cacheLectura) +
    t(uso.cacheEscritura, TARIFAS.cacheEscritura);
  // Se redondea hacia arriba: un tope que redondea a la baja se pasa siempre.
  return Math.ceil(total);
}

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
      centavos: 0,
    }
  );
}

/** Lo que la empresa lleva gastado hoy, estimado y en centavos. */
export function gastoDelDia(dia = hoy()) {
  return (
    getDb().prepare('SELECT COALESCE(SUM(centavos), 0) AS c FROM chat_consumo WHERE dia = ?').get(dia).c || 0
  );
}

/** Lo que la empresa lleva gastado en el mes, estimado y en centavos. */
export function gastoDelMes(mes = hoy().slice(0, 7)) {
  return (
    getDb()
      .prepare("SELECT COALESCE(SUM(centavos), 0) AS c FROM chat_consumo WHERE substr(dia, 1, 7) = ?")
      .get(mes).c || 0
  );
}

/**
 * ¿Le queda cupo a esta cuenta hoy?
 *
 * Devuelve siempre las cuatro cosas, con cupo o sin él, porque la pantalla
 * necesita decir cuántas quedan incluso cuando sí hay: «te quedan 3» evita la
 * sorpresa de llegar al tope a media conversación.
 *
 * El `motivo` va en español y dice cuándo vuelve, porque es el texto que lee
 * una persona en la pantalla y no un código que lee otro programa.
 */
export function hayCupo(usuarioId) {
  const consumo = consumoDeHoy(usuarioId);
  const preguntas = consumo.preguntas || 0;
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

  const gasto = gastoDelDia();
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
 * Anota una pregunta y lo que costó.
 *
 * Es un `INSERT … ON CONFLICT DO UPDATE` en una transacción: la fila del día de
 * una cuenta se crea la primera vez y se suma las demás, sin que dos preguntas
 * casi simultáneas puedan dejar dos filas del mismo día.
 *
 * Se llama aunque la respuesta haya terminado en error, con el uso que alcanzó a
 * reportarse: lo gastado se gastó, y un tope que solo cuenta los éxitos es un
 * tope que una racha de fallos deja sin efecto.
 */
export function anotarConsumo(usuarioId, uso = {}) {
  const db = getDb();
  const dia = hoy();
  const centavos = centavosDe(uso);
  const n = (v) => Number(v) || 0;

  const guardar = db.transaction(() => {
    db.prepare(
      `INSERT INTO chat_consumo
         (usuario_id, dia, preguntas, tokens_entrada, tokens_salida, tokens_cache_lee, tokens_cache_pone,
          centavos, actualizado_en)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (usuario_id, dia) DO UPDATE SET
         preguntas         = preguntas + 1,
         tokens_entrada    = tokens_entrada + excluded.tokens_entrada,
         tokens_salida     = tokens_salida + excluded.tokens_salida,
         tokens_cache_lee  = tokens_cache_lee + excluded.tokens_cache_lee,
         tokens_cache_pone = tokens_cache_pone + excluded.tokens_cache_pone,
         centavos          = centavos + excluded.centavos,
         actualizado_en    = excluded.actualizado_en`
    ).run(
      Number(usuarioId),
      dia,
      n(uso.entrada),
      n(uso.salida),
      n(uso.cacheLectura),
      n(uso.cacheEscritura),
      centavos,
      marcaDeTiempo()
    );
  });
  guardar();

  return consumoDeHoy(usuarioId);
}
