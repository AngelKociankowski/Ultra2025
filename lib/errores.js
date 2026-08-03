/**
 * Errores del dominio.
 *
 * Viven aparte de las capas que los lanzan porque los usan tanto `servicios.js`
 * como `catalogos.js`, y tenerlos en una de las dos obligaría a que esa
 * importara la otra solo para esto.
 *
 * `conPermiso()` los traduce a HTTP: ValidacionError → 400, PermisoError → 403.
 */

export class ValidacionError extends Error {}
export class PermisoError extends Error {}
