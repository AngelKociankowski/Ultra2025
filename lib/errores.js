/**
 * Errores del dominio.
 *
 * Viven aparte de las capas que los lanzan porque los usan tanto `servicios.js`
 * como `catalogos.js`, y tenerlos en una de las dos obligaría a que esa
 * importara la otra solo para esto.
 *
 * `conPermiso()` los traduce a HTTP: ValidacionError → 400, PermisoError → 403,
 * y la falta de espacio en el disco → 507 (ver `respuestaSinEspacio`, abajo).
 */

export class ValidacionError extends Error {}
export class PermisoError extends Error {}

/**
 * No hay sitio en el disco para lo que se pidió.
 *
 * Es un error con nombre propio y no una `ValidacionError` porque no es culpa de
 * quien manda: su archivo está bien, lo que no está bien es el servidor. Y no
 * puede ser el 500 genérico, que es lo que fue durante semanas: «Error interno
 * del servidor» le dice a la persona que el fallo es un misterio, cuando tiene
 * una causa conocida —el disco— y un remedio conocido —hacer sitio—.
 *
 * Lo lanza quien comprueba el espacio ANTES de escribir, con el mensaje ya
 * armado para ese caso (cuánto pesa lo que se quería guardar y cuánto queda).
 */
export class SinEspacioError extends Error {}

/**
 * ¿Este error, venga de donde venga, es «el disco está lleno»?
 *
 * Tres orígenes y un solo significado:
 *
 *   - `SinEspacioError`: lo vimos venir y no llegamos a escribir.
 *   - `ENOSPC` (y `EDQUOT`, que es lo mismo dicho por una cuota): el sistema de
 *     archivos rechazó una escritura. Pasa cuando el disco se llena entre la
 *     comprobación y la escritura, o en un camino que no comprueba antes.
 *   - `SQLITE_FULL`: lo mismo, pero dicho por la base. Las capturas no
 *     comprueban el espacio antes —serían cientos de sitios—, así que con el
 *     disco lleno es así como falla guardar un comentario o una apertura.
 */
export function esFaltaDeEspacio(err) {
  if (!err) return false;
  if (err instanceof SinEspacioError) return true;
  const codigo = String(err.code || '');
  return codigo === 'ENOSPC' || codigo === 'EDQUOT' || codigo.startsWith('SQLITE_FULL');
}

/**
 * Lo que se le contesta a la persona cuando una escritura se topa con el disco
 * lleno sin que nadie lo hubiera comprobado antes.
 *
 * Dice las tres cosas que el 500 callaba: qué pasó, que no se guardó, y qué
 * hacer. El remedio nombra la pantalla de Respaldos porque ahí está tanto el
 * diagnóstico —qué ocupa el disco— como la forma de hacer sitio.
 */
export const MENSAJE_DISCO_LLENO =
  'El disco del servidor se quedó sin espacio, así que lo que acabas de enviar no se guardó. ' +
  'No es un error tuyo ni de tu archivo. Avísale al administrador: en la pantalla de Respaldos ' +
  'se ve qué está ocupando el disco y desde ahí se libera espacio. Cuando haya sitio, vuelve a intentarlo.';

/**
 * El único sitio que decide qué se contesta ante un disco lleno.
 *
 * Devuelve `null` si el error es otra cosa, para que quien llama siga con su
 * manejo de siempre. Va aquí y no dentro de `conPermiso()` porque hay tres
 * rutas que escriben en la base sin pasar por ese envoltorio —entrar, salir y
 * cambiar la contraseña—, y con el disco lleno son justo las primeras que la
 * gente toca.
 *
 * 507 es «Insufficient Storage»: el estado que existe para esto. No es un 400
 * —la petición estaba bien— ni un 500 a secas —sabemos perfectamente qué pasó—.
 */
export function respuestaSinEspacio(err) {
  if (!esFaltaDeEspacio(err)) return null;
  return {
    status: 507,
    cuerpo: { error: err instanceof SinEspacioError ? err.message : MENSAJE_DISCO_LLENO },
  };
}
