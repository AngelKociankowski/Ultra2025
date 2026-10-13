/**
 * Si un servicio nació para quedarse o para terminar.
 *
 * `aperturas.tipo` distinguía TEMPORAL desde el principio, pero esa marca se
 * quedaba en el movimiento. Una vez aplicada la apertura, el servicio temporal
 * era idéntico a uno fijo: mismo renglón en el estado de fuerza, misma
 * propuesta de factura todos los meses, misma entrada a la revisión anual de
 * precios. Nadie sabía que tenía que salir, y salía —cuando salía— porque
 * alguien se acordaba.
 *
 * De ahí que esto no sea una etiqueta de adorno. Un temporal con fecha de
 * término es lo que permite avisar antes, en lugar de descubrir en la
 * conciliación de tres meses después que se siguió facturando un servicio que
 * ya había acabado.
 *
 * Vive aparte de `lib/servicios.js` porque los filtros corren en el navegador y
 * de allá se arrastraría SQLite entero.
 */

export const MODALIDADES = {
  FIJO: {
    etiqueta: 'Fijo',
    tono: 'slate',
    descripcion: 'Contratado sin fecha de término. Es el caso normal.',
    llevaFin: false,
  },
  TEMPORAL: {
    etiqueta: 'Temporal',
    tono: 'cyan',
    descripcion: 'Abierto por un periodo acordado. Tiene que salir del estado de fuerza al terminar.',
    llevaFin: true,
  },
  EVENTO: {
    etiqueta: 'Evento',
    tono: 'violet',
    descripcion: 'De unos días: una feria, una asamblea, una mudanza.',
    llevaFin: true,
  },
};

/** Las que traen fecha de término, para no repetir la lista en cada pantalla. */
export const CON_TERMINO = Object.keys(MODALIDADES).filter((k) => MODALIDADES[k].llevaFin);

/**
 * ¿Existe de verdad esta modalidad?
 *
 * Por `Set` y no por `MODALIDADES[valor]`, que es la forma que parecía
 * equivalente y no lo es: el objeto hereda lo de `Object.prototype`, así que
 * `MODALIDADES['__proto__']` o `['toString']` son truthy y un valor inventado
 * se colaba por los guardias como si estuviera en la lista. Es el mismo defecto
 * que tenía la validación del esquema de facturación, y el mismo arreglo:
 * preguntar por pertenencia, como ya hace `exigirDelCatalogo()`.
 */
const VALIDAS = new Set(Object.keys(MODALIDADES));

export function esModalidad(valor) {
  return VALIDAS.has(valor);
}

/**
 * En qué punto de su vigencia está un servicio con fecha de término.
 *
 * Devuelve null para los fijos: no tienen término y preguntarlo no significa
 * nada. Para los demás dice si ya se pasó y por cuánto, que es lo único que se
 * necesita para decidir a cuál llamarle hoy.
 */
export function estadoDelTermino(servicio, referencia) {
  if (!servicio || servicio.modalidad === 'FIJO' || !esModalidad(servicio.modalidad)) return null;
  const fin = String(servicio.fecha_fin_prevista || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fin)) return { fin: null, dias: null, vencido: false, sinFecha: true };

  const a = Date.parse(`${referencia}T00:00:00Z`);
  const b = Date.parse(`${fin}T00:00:00Z`);
  const dias = Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
  return { fin, dias, vencido: dias !== null && dias < 0, sinFecha: false };
}
