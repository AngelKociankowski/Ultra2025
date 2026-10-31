// Corrida del Radar contra el transporte sintético (T04, T07). Reloj virtual: avanza 200× para que las pausas por minuto
// de la capa de datos de la página no hagan esperar minutos reales.
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { feriadosAnio } from "../lib/tiempo.mjs";
import { transporteSintetico } from "./fixtures/rest-synth/transporte.mjs";

export const PAGINA = cargarPagina();
export const FERIADOS_2026 = feriadosAnio({ anio: 2026 }).filas;
export const NOW_SINT = Date.parse("2026-11-02T14:47:00Z");
// screenerN 500 (como coder-prod.spec de la página): con el defecto de 400 solo 208 filas pasan el filtro de universo
export const CTX_SINT = Object.freeze({ plan: "STARTER", gate: true, nowMs: NOW_SINT, seed: 7, holidays: FERIADOS_2026, screenerN: 500 });

export function relojVirtual(t0 = NOW_SINT, k = 200) { const r0 = Date.now(); return () => t0 + (Date.now() - r0) * k; }

export function fmpSintetico({ falla = null, ahora = relojVirtual(), ctx = CTX_SINT } = {}) {
  const transporte = transporteSintetico({ S: PAGINA.S, ctx, falla });
  return { transporte, fmp: crearFmp({ transporte, ahora }), ahora };
}
