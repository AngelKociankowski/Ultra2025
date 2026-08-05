/**
 * Cómo se leen las fechas y los plazos en esta pantalla.
 *
 * Vive aparte de los componentes porque lo usan los dos lados: la lista, que
 * corre en el navegador, y el panel de inconsistencias, que se arma en el
 * servidor. Un helper exportado desde un archivo `'use client'` no se puede
 * llamar desde el servidor —lo que llega es una referencia, no la función—, y
 * el error solo aparecería al abrir la página.
 */

const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 2026-05-15 → 15/may/2026. La fecha ISO se lee bien de máquina, no de ojo. */
export function comoFecha(v) {
  if (!v) return null;
  const [a, m, d] = String(v).slice(0, 10).split('-');
  if (!a || !m || !d) return String(v);
  return `${d}/${MESES[Number(m)]}/${a}`;
}

/** El mes de una clave AAAA-MM, para las barras de la agenda. */
export function nombreMes(clave) {
  const [a, m] = String(clave).split('-');
  return { mes: MESES[Number(m)], anio: a };
}

/**
 * Cuánto falta o cuánto lleva, en palabras.
 *
 * «vence 2026-05-15» obliga a restar mentalmente contra el día de hoy. «venció
 * hace 3 meses» ya trae la conclusión, que es lo que se necesita para decidir
 * a cuál renovación llamarle primero.
 */
export function enPalabras(dias) {
  if (dias === null || dias === undefined) return '';
  const n = Math.abs(dias);
  if (n === 0) return 'vence hoy';
  const magnitud =
    n === 1
      ? '1 día'
      : n < 45
        ? `${n} días`
        : n < 365
          ? `${Math.round(n / 30)} meses`
          : n < 730
            ? '1 año'
            : `${Math.floor(n / 365)} años`;
  return dias < 0 ? `venció hace ${magnitud}` : `en ${magnitud}`;
}
