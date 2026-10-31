// Rendimientos y composición (12-plan §5.13.1–§5.13.2, 12b §E.5.3). Puro.
import { sumarDias, diasEntre } from "./tiempo.mjs";

const isNum = v => typeof v === "number" && Number.isFinite(v);
export const AVISO_ANUALIZADO = "Menos de un año de historia: el anualizado exagera el ruido.";

// Rendimientos por índices encadenados y referencias del libro (12b §E.5.3): sin leer la serie.
// ref = [f, v, vm, spy, i, im]; i_t = i_{t−1} × (v_t − fl_t) / v_{t−1}; im igual con vm y el flujo en pesos.
const diaSemana = f => new Date(f + "T12:00:00Z").getUTCDay();
const lunesDe = f => sumarDias(f, -((diaSemana(f) + 6) % 7));
const mismaSemana = (a, b) => lunesDe(a) === lunesDe(b);

export function meta15({ base, v, vMXN, dias }) {
  const g = Math.pow(1.15, dias / 365.25);
  return { esperadoUSD: base.v * g, esperadoMXN: base.vMXN * g, difPtsUSD: (v / base.v - g) * 100, difPtsMXN: isNum(vMXN) ? (vMXN / base.vMXN - g) * 100 : null };
}

// Índices del punto de hoy a partir de refs.dia (el último punto guardado)
export function indicesDelDia({ refs, v, fx, fl = 0 }) {
  const d = refs.dia, vm = isNum(fx) ? v * fx : null;
  const i = d[4] * (v - fl) / d[1];
  const im = isNum(vm) && isNum(d[2]) && d[2] > 0 ? d[5] * (vm - fl * fx) / d[2] : null;
  return { i, im, vm };
}

// punto = { f, v, vm, spy, i, im }. Devuelve [día, semana, mes, año, inicio, anualizado] por serie, meta y aviso.
export function rendimientosRefs({ refs, punto }) {
  const f = punto.f, d = refs.dia;
  const ref = { dia: d, sem: mismaSemana(f, d[0]) ? refs.sem : d, mes: f.slice(0, 7) === d[0].slice(0, 7) ? refs.mes : d,
    anio: f.slice(0, 4) === d[0].slice(0, 4) ? refs.anio : d, inicio: refs.base };
  const dias = diasEntre(refs.base[0], f);
  const serie = (ahora, k) => {
    const r = ["dia", "sem", "mes", "anio", "inicio"].map(n => (isNum(ahora) && isNum(ref[n][k]) && ref[n][k] > 0 ? ahora / ref[n][k] - 1 : null));
    r.push(dias >= 90 && r[4] !== null ? Math.pow(1 + r[4], 365.25 / dias) - 1 : null);
    return r;
  };
  const b = refs.base, m = meta15({ base: { v: b[1], vMXN: b[2] }, v: punto.v, vMXN: punto.vm, dias });
  return { dias, usd: serie(punto.i, 4), mxn: serie(punto.im, 5), spy: serie(punto.spy, 3), meta: [m.esperadoUSD, m.difPtsUSD, m.esperadoMXN, m.difPtsMXN],
    aviso: dias >= 90 && dias < 365 ? AVISO_ANUALIZADO : null };
}

// Al cerrar el día: si cambió la semana/mes/año respecto de refs.dia, esa referencia pasa a ser refs.dia; luego refs.dia = hoy
export function actualizarRefs({ refs, punto }) {
  const r = JSON.parse(JSON.stringify(refs)), d = r.dia, f = punto.f;
  if (d[0] === f) { r.dia = [f, punto.v, punto.vm, punto.spy, punto.i, punto.im]; return r; }
  if (!mismaSemana(f, d[0])) r.sem = d.slice();
  if (f.slice(0, 7) !== d[0].slice(0, 7)) r.mes = d.slice();
  if (f.slice(0, 4) !== d[0].slice(0, 4)) r.anio = d.slice();
  r.dia = [f, punto.v, punto.vm, punto.spy, punto.i, punto.im];
  return r;
}

// ---- Composición (§5.13.2) ----
const AMPLIO = "ETF de acciones (amplio)", SECTORIAL = "ETF sectorial";
const TABLA = {
  SPY: [AMPLIO, "Diversificado", "EE. UU."], DIA: [AMPLIO, "Diversificado", "EE. UU."], QQQ: [AMPLIO, "Diversificado", "EE. UU."], IWM: [AMPLIO, "Diversificado", "EE. UU."],
  EFA: [AMPLIO, "Diversificado", "Desarrollados fuera de EE. UU."], VWO: [AMPLIO, "Diversificado", "Emergentes"],
  XLE: [SECTORIAL, "Energía", "EE. UU."], XLF: [SECTORIAL, "Financiero", "EE. UU."], XLK: [SECTORIAL, "Tecnología", "EE. UU."],
  TLT: ["Bonos", "Tesoro de EE. UU. 20+ años", "EE. UU."], GLD: ["Metales", "Oro", "Global"], SLV: ["Metales", "Plata", "Global"],
};
export const SECTORES = {
  "Basic Materials": "Materiales", "Communication Services": "Comunicaciones", "Consumer Cyclical": "Consumo discrecional", "Consumer Defensive": "Consumo básico",
  Energy: "Energía", "Financial Services": "Financiero", Healthcare: "Salud", Industrials: "Industrial", "Real Estate": "Inmobiliario", Technology: "Tecnología",
  Utilities: "Servicios públicos",
};
export function clasificar(sym, fila = null) {
  if (TABLA[sym]) return TABLA[sym];
  const sector = fila && fila.sector ? SECTORES[fila.sector] || fila.sector : "Sin clasificar";
  return ["Acción individual", sector, "EE. UU."];
}

// Pesos por instrumento = (valor + compras pendientes) / total; efectivo aparte. filas: { sym: fila del análisis }.
export function composicion({ valuacion, libro, filas = {} }) {
  const monto = {};
  for (const p of valuacion.posiciones) monto[p.sym] = (monto[p.sym] || 0) + p.valorUSD;
  for (const x of libro.pendientes || []) if (x.lado === "compra") monto[x.sym] = (monto[x.sym] || 0) + x.montoUSD;
  const efectivo = Math.max(0, valuacion.efectivoUSD);
  const total = Object.values(monto).reduce((a, x) => a + x, 0) + efectivo;
  const out = { clase: {}, sector: {}, region: {}, donde: { "eToro Demo": 1 } };
  if (!(total > 0)) return out;
  const sumar = (eje, k, w) => { out[eje][k] = (out[eje][k] || 0) + w; };
  for (const [sym, m] of Object.entries(monto)) {
    const [c, s, r] = clasificar(sym, filas[sym]), w = m / total;
    sumar("clase", c, w); sumar("sector", s, w); sumar("region", r, w);
  }
  if (efectivo > 0) { const w = efectivo / total; sumar("clase", "Efectivo", w); sumar("sector", "—", w); sumar("region", "Dólares", w); }
  return out;
}
