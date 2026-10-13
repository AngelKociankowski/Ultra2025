/**
 * La fecha de la operación, no la del servidor.
 *
 * Dos errores distintos vivían aquí y los dos se sienten igual: la plataforma
 * «va atrasada».
 *
 *   1. El mes en curso se sacaba del último corte importado. Cuando llegó
 *      agosto, la pantalla seguía diciendo «julio · en curso» porque julio era
 *      el último corte que había en la base. El mes que corre lo dice el
 *      calendario, no el archivo.
 *
 *   2. Todo lo demás usaba `toISOString()`, que es UTC. El servidor vive en
 *      UTC y la operación en el centro de México, seis horas atrás: a partir de
 *      las 18:00 hora local, el servidor ya cambió de día. Una factura
 *      registrada por la tarde salía con la fecha de mañana, y su vencimiento
 *      corrido un día.
 *
 * Por eso todo lo que dependa de «hoy» pasa por aquí. La zona se puede cambiar
 * con ZONA_HORARIA si algún día la operación se mueve.
 */

const ZONA = process.env.ZONA_HORARIA || 'America/Mexico_City';

// en-CA da exactamente AAAA-MM-DD, que es como se guarda todo en la base.
const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Hoy donde opera la empresa, como AAAA-MM-DD.
 *
 * Admite el instante porque hay decisiones que además de leer «hoy» escriben un
 * renglón, y las dos cosas tienen que hablar del mismo momento: si la regla
 * pregunta por el reloj y el INSERT vuelve a preguntarle, una petición que entra
 * a las 23:59:59.9 decide con el día de ayer y queda registrada con el de hoy.
 * Ver `marcaDeTiempo()`.
 */
export function hoy(cuando = new Date()) {
  return FORMATO.format(cuando);
}

/**
 * Ese mismo instante escrito como lo escribe la base: UTC, «AAAA-MM-DD HH:MM:SS».
 *
 * Es lo que produce `datetime('now')` de SQLite. Existe para poder fechar un
 * renglón con el MISMO instante con el que se tomó la decisión, en vez de dejar
 * que el INSERT vuelva a mirar el reloj: entre lo uno y lo otro puede haber
 * cambiado el día de la oficina, y entonces la bitácora contradice a la regla que
 * la escribió.
 */
export function marcaDeTiempo(cuando = new Date()) {
  return cuando.toISOString().slice(0, 19).replace('T', ' ');
}

/** El mes que está corriendo, como AAAA-MM. */
export function mesActual() {
  return hoy().slice(0, 7);
}

/** El año en curso, para los folios. */
export function anioActual() {
  return Number(hoy().slice(0, 4));
}

/**
 * El día de la operación al que pertenece una marca de tiempo de la base.
 *
 * Todo lo que se guarda con `datetime('now')` queda en UTC, y la operación vive
 * seis horas atrás. Comparar esa cadena contra `hoy()` es el error número 2 de
 * la cabecera visto desde el otro lado: un dato capturado a las 19:00 del jueves
 * se guardó con la fecha del viernes, así que el viernes por la mañana «es de
 * hoy» y el jueves por la noche «fue ayer». Las dos respuestas están mal, y la
 * segunda es la que importa aquí: de ella depende si alguien puede corregir lo
 * que acaba de capturar.
 *
 * Devuelve nulo cuando la marca no se entiende, en vez de una fecha inventada:
 * quien pregunte «¿es de hoy?» tiene que poder contestar «no se sabe» y negar,
 * que es el lado seguro.
 *
 * @param {string} ts marca de tiempo de la base, en UTC («AAAA-MM-DD HH:MM:SS»)
 * @returns {string|null} el día en la zona de la operación, como AAAA-MM-DD
 */
export function diaDe(ts) {
  if (!ts) return null;
  const texto = String(ts).trim();
  // Una fecha sin hora ya es un día: convertirla sería restarle las seis horas
  // a una medianoche que nadie escribió y devolver el día anterior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  if (!/^\d{4}-\d{2}-\d{2}[ T]/.test(texto)) return null;
  // La «Z» explícita no sobra: sin ella, JavaScript lee «2026-10-09 23:50:00»
  // como hora local del servidor, que es la zona que este archivo existe para
  // no usar nunca.
  const conZona = /([Zz]|[+-]\d{2}:?\d{2})$/.test(texto) ? texto : `${texto}Z`;
  const d = new Date(conZona.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : FORMATO.format(d);
}
