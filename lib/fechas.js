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

/** Hoy donde opera la empresa, como AAAA-MM-DD. */
export function hoy() {
  return FORMATO.format(new Date());
}

/** El mes que está corriendo, como AAAA-MM. */
export function mesActual() {
  return hoy().slice(0, 7);
}

/** El año en curso, para los folios. */
export function anioActual() {
  return Number(hoy().slice(0, 4));
}
