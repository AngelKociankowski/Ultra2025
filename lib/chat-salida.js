/**
 * El sitio único de lo que sale hacia el modelo: ninguna lista viaja sin su
 * total.
 *
 * Por qué existe este archivo, dicho sin adornos. Van cuatro vueltas de este
 * ciclo cerrando hallazgos de la misma familia: una consulta recorta su lista a
 * veinticinco renglones, el total de verdad no viaja al lado, y el modelo
 * describe esos veinticinco como si fueran todo. Se cerró en las aperturas sin
 * aplicar, se cerró en los conteos de `movimientos`… y seguía abierto en
 * `estado_de_un_dia`, en `cobranza` y en `contratos`. Tapar los sitios uno por
 * uno es lo que no ha funcionado: el que falta siempre es el que nadie miró.
 *
 * Así que el recorte deja de ser algo que cada herramienta hace a mano y pasa a
 * ser lo único que este archivo sabe hacer. Es el mismo patrón que `lib/captura.js`
 * para los datos que ENTRAN —un sitio único por el que pasa todo— aplicado a los
 * datos que SALEN hacia el modelo. Y como un sitio único al que nadie está
 * obligado a entrar no sirve de nada, hay dos guardianes derivados del código y
 * del resultado de verdad (`tests/chat-listas-con-total.test.mjs`): uno rompe la
 * suite si aparece un recorte a mano en las herramientas, y el otro corre las
 * siete y exige que CADA lista que sale lleve su total y diga qué cuenta.
 *
 * Qué viaja, para cada lista:
 *
 *   ultimasAltas:            [ … los renglones, recortados … ]
 *   ultimasAltasTotal:       58                ← cuántas hay de verdad
 *   ultimasAltasQueCuenta:   'altas del mes 2023-10; la lista «ultimasAltas»
 *                             trae 25 de 58'   ← qué cuenta ese total, y el aviso
 *
 * El tercer campo no es decoración: el tester midió que en un mismo resultado
 * viajan cifras de conceptos distintos con nombres parecidos —«servicios: 58» al
 * lado de 25 renglones de altas, dos «vencidos» con valores distintos— y que una
 * coincidencia numérica puede hacer pasar por bueno un dato equivocado. Que cada
 * cifra diga qué cuenta es lo que rompe esa coincidencia.
 */

/**
 * Cuántos renglones de una lista viajan como máximo.
 *
 * Vive aquí y no en las herramientas a propósito: es el único sitio que recorta,
 * así que es el único que necesita saber el número.
 */
export const TOPE_RENGLONES = 25;

/**
 * Lo que se le pide a una consulta que acepta un límite cuando lo que se quiere
 * es todo lo que hay.
 *
 * Hace falta porque un límite puesto en la consulta miente al llegar aquí: una
 * consulta que devuelve veinticinco de ochenta y cuatro deja a este archivo
 * contando veinticinco, y el total saldría igual de corto que antes, pero ahora
 * con cara de total. El recorte lo hace este archivo y nadie más, así que las
 * consultas se piden completas.
 */
export const SIN_RECORTE = 1_000_000;

/** Un texto que diga algo, o se cae aquí y no delante de una persona. */
function exigirTexto(valor, cual) {
  const texto = String(valor ?? '').trim();
  if (!texto) {
    throw new Error(`Una lista que sale hacia el modelo no dice ${cual}. Sin eso no sale.`);
  }
  return texto;
}

/** Un entero que no sea negativo ni `NaN`: un total así sería peor que ninguno. */
function exigirConteo(valor, cual) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`El total «${cual}» que sale hacia el modelo no es un conteo: «${valor}».`);
  }
  return n;
}

/**
 * El total de una lista y qué cuenta, como las dos claves que viajan a su lado.
 *
 * Se usa suelto cuando la lista viaja con la forma que le da su pantalla y no se
 * puede cambiar —los motivos de baja son el caso— y por dentro lo usa
 * `conSuTotal`, para que el total se escriba de una sola manera en todo el
 * asistente.
 */
export function elTotalAparte(nombre, { total, mostrados, queCuenta }) {
  const clave = exigirTexto(nombre, 'de qué lista es el total');
  const hay = exigirConteo(total, `${clave}Total`);
  const traen = exigirConteo(mostrados, `${clave} (renglones que viajan)`);
  const que = exigirTexto(queCuenta, `qué cuenta «${clave}Total»`);
  return {
    [`${clave}Total`]: hay,
    // El aviso de recorte va dentro de este texto y no en un campo aparte: así
    // no hay forma de mandar el total y olvidar el aviso, y la frase se lee
    // igual de bien complete o recortada —«trae 25 de 58» lo dice todo—.
    [`${clave}QueCuenta`]: `${que}; la lista «${clave}» trae ${traen} de ${hay}`,
  };
}

/**
 * Una lista hacia el modelo, recortada, con su total y con qué cuenta.
 *
 * Es la única forma de mandarle una lista. Devuelve las tres claves juntas para
 * que se desparramen en el resultado con `...`: separarlas sería volver a poder
 * mandar la lista sin el total, que es el defecto que este archivo existe para
 * hacer imposible.
 *
 * @param nombre   la clave con la que viaja la lista
 * @param filas    TODAS las que hay, sin recortar antes (ver `SIN_RECORTE`)
 * @param renglon  qué se queda de cada fila; aquí se sanea el texto del equipo
 * @param queCuenta  qué cuenta el total, en español y escrito por el servidor
 * @param opciones.total  el conteo de verdad, cuando la consulta que trajo
 *   `filas` tiene su propio límite por dentro y contarlas daría de menos. Va a
 *   mano porque ese conteo sale de OTRA consulta —la que cuenta sin traer—, y
 *   nadie más que quien llama sabe cuál es.
 */
export function conSuTotal(nombre, filas, renglon, queCuenta, opciones = {}) {
  const clave = exigirTexto(nombre, 'cómo se llama');
  if (!Array.isArray(filas)) {
    throw new Error(`La lista «${clave}» que sale hacia el modelo no es una lista.`);
  }
  if (typeof renglon !== 'function') {
    throw new Error(`La lista «${clave}» no dice qué se queda de cada renglón.`);
  }
  const renglones = filas.slice(0, TOPE_RENGLONES).map(renglon);
  const total = opciones.total === undefined ? filas.length : opciones.total;
  return {
    [clave]: renglones,
    ...elTotalAparte(clave, { total, mostrados: renglones.length, queCuenta }),
  };
}
