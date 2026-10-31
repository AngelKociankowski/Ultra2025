// Rendimientos y composición (12-plan §5.13.1–§5.13.2). Puro.
import { sumarDias, diasEntre } from "./tiempo.mjs";

const isNum = v => typeof v === "number" && Number.isFinite(v);
export const AVISO_ANUALIZADO = "Menos de un año de historia: el anualizado exagera el ruido.";

// Serie P = [base, …puntos] ordenada por fecha; el punto de hoy reemplaza al de la misma fecha.
export function puntosDe(serie, punto = null) {
  const b = serie.base;
  const base = { f: b.fecha, v: b.valorUSD, vMXN: isNum(b.valorMXN) ? b.valorMXN : b.valorUSD * b.fx, fx: b.fx, spy: b.spy, fl: 0 };
  const pts = (serie.puntos || []).filter(p => !punto || p.f !== punto.f).concat(punto ? [punto] : []).filter(p => p.f > base.f);
  pts.sort((a, b) => (a.f < b.f ? -1 : 1));
  return [base].concat(pts.map(p => ({ f: p.f, v: p.v, vMXN: p.v * p.fx, fx: p.fx, spy: p.spy, fl: isNum(p.fl) ? p.fl : 0 })));
}

const diaSemana = f => new Date(f + "T12:00:00Z").getUTCDay();
const lunesDe = f => sumarDias(f, -((diaSemana(f) + 6) % 7));
const refAntes = (P, limite) => { let k = 0; for (let i = 0; i < P.length; i++) if (P[i].f < limite) k = i; return k; };

function serieDe(P, valor, flujo) {
  const r = [null];
  for (let i = 1; i < P.length; i++) {
    const a = valor(P[i - 1]), b = valor(P[i]);
    r.push(isNum(a) && isNum(b) && a > 0 ? (b - flujo(P[i])) / a - 1 : null);
  }
  const desde = k => { // Π(1 + r_i) − 1 sobre los puntos posteriores a k
    let g = 1;
    for (let i = k + 1; i < P.length; i++) { if (r[i] === null) return null; g *= 1 + r[i]; }
    return g - 1;
  };
  return desde;
}

export function meta15({ base, v, vMXN, dias }) {
  const g = Math.pow(1.15, dias / 365.25);
  return { esperadoUSD: base.v * g, esperadoMXN: base.vMXN * g, difPtsUSD: (v / base.v - g) * 100, difPtsMXN: isNum(vMXN) ? (vMXN / base.vMXN - g) * 100 : null };
}

export function rendimientos({ serie, punto = null }) {
  const P = puntosDe(serie, punto), n = P.length - 1, ult = P[n];
  const dias = diasEntre(P[0].f, ult.f);
  const refs = n === 0 ? null : {
    dia: n - 1, semana: refAntes(P, lunesDe(ult.f)), mes: refAntes(P, ult.f.slice(0, 8) + "01"), anio: refAntes(P, ult.f.slice(0, 5) + "01-01"), inicio: 0,
  };
  const calc = desde => {
    if (!refs) return { dia: null, semana: null, mes: null, anio: null, inicio: null, anualizado: null, avisoAnualizado: null };
    const o = {};
    for (const [k, i] of Object.entries(refs)) o[k] = desde(i);
    o.anualizado = dias >= 90 && o.inicio !== null ? Math.pow(1 + o.inicio, 365.25 / dias) - 1 : null;
    o.avisoAnualizado = dias >= 90 && dias < 365 ? AVISO_ANUALIZADO : null;
    return o;
  };
  return {
    f: ult.f, dias,
    usd: calc(serieDe(P, p => p.v, p => p.fl)),
    mxn: calc(serieDe(P, p => p.vMXN, p => p.fl * p.fx)),
    spy: calc(serieDe(P, p => p.spy, () => 0)),
    meta15: n === 0 ? null : meta15({ base: P[0], v: ult.v, vMXN: ult.vMXN, dias }),
  };
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
