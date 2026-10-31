// Resumen compacto del Radar del día (12b §E.5.6): lo único del análisis que va a db (radar-<fecha>).
import { precio, red, ts } from "./db.mjs";

const isNum = v => typeof v === "number" && Number.isFinite(v);
const CLASE = c => (c === "stock" ? "stock" : c === "etf" ? "etf" : c === "index" || c === "vol" || c === "future" ? "index" : c === "commodity" ? "commodity" : String(c).startsWith("crypto") ? "crypto" : c === "fx" ? "fx" : "otro");
const MAX_FILAS = 30, MAX_CAMBIOS = 20;

export const firmaSenales = out => out.rows.map(r => `${r.symbol}:${r.signal}:${r.pct}`).join("|");
const parse = s => new Map(String(s || "").split("|").filter(Boolean).map(x => { const [a, b, c] = x.split(":"); return [a, [Number(b), Number(c)]]; }));

// objetivo: { pesos, roles } (buildPortfolio) o null; previo: rutina-estado.previo; tenidos: símbolos en cartera
export function resumenRadar({ out, estado, motivo, llamadas, t, f, objetivo = null, previo = null, tenidos = [] }) {
  if (!out || estado === "sin_radar") return { kind: "radarResumen", v: 1, f, estado: "sin_radar", motivo: motivo || null, t: ts(t) };
  const g = out.regime || {}, c = out.counts || {};
  const reg = { e: g.state || null, l: g.label || null, vix: isNum(g.vix) ? red(g.vix, 2) : null, r12: isNum(g.r12) ? red(g.r12, 4) : null, dd: isNum(g.dd) ? red(g.dd, 4) : null,
    rf: isNum(g.rf) ? red(g.rf, 4) : null, sobre200: typeof g.trendUp === "boolean" ? g.trendUp : null };
  const cuenta = k => out.rows.filter(r => r.signal === k).length;
  const n = { uni: c.universe ?? null, eleg: c.eligible ?? null, fin: c.finalists ?? null, rank: c.ranked ?? out.rows.length, c: cuenta(3), m: cuenta(2), e: cuenta(1) };
  const pesos = (objetivo && objetivo.pesos) || {}, roles = (objetivo && objetivo.roles) || {};
  const obj = Object.entries(pesos).map(([id, w]) => [id, Math.round(w * 10000), roles[id] === "Núcleo" ? "N" : "S"]);
  const efe = Math.max(0, 10000 - obj.reduce((s, x) => s + x[1], 0));
  // cambios contra el último día con Radar
  const cambios = [];
  if (previo) {
    if (previo.reg && previo.reg !== reg.e) cambios.push(["reg", "regimen", previo.reg, null, reg.e, null]);
    const o0 = parse(previo.obj), o1 = new Set(obj.map(x => x[0]));
    for (const [id] of obj) if (!o0.has(id)) cambios.push([id, "entra_objetivo", null, null, null, null]);
    for (const id of o0.keys()) if (!o1.has(id)) cambios.push([id, "sale_objetivo", null, null, null, null]);
    const s0 = parse(previo.s);
    for (const r of out.rows) { const a = s0.get(r.symbol); if (a && a[0] !== r.signal) cambios.push([r.symbol, "senal", a[0], a[1], r.signal, r.pct]); }
  }
  const cambiaron = new Set(cambios.filter(x => x[1] === "senal").map(x => x[0]));
  const quiero = new Set([...tenidos, ...Object.keys(pesos), ...out.rows.slice(0, 10).map(r => r.symbol), ...cambiaron]);
  const filas = out.rows.filter(r => quiero.has(r.symbol)).slice(0, MAX_FILAS).map(r => [r.symbol, CLASE(r.cls), r.signal, r.pct, Math.round(r.pRef * 1000), precio(r.price),
    isNum(r.changePct) ? red(r.changePct, 1) : null, isNum(r.expRet) ? red(r.expRet, 4) : null]);
  return { kind: "radarResumen", v: 1, f, estado, motivo: motivo || null, asOf: out.asOf, plan: out.plan, t: ts(t), llamadas: (llamadas && llamadas.total) || 0,
    reg, n, filas, obj, efe, cambios: cambios.slice(0, MAX_CAMBIOS), s: firmaSenales(out) };
}

// lo que pasa a rutina-estado.previo
export const previoDe = r => (r && r.estado !== "sin_radar" ? { f: r.f, reg: r.reg ? r.reg.e : null, s: r.s, obj: r.obj.map(x => `${x[0]}:${x[1]}`).join("|") } : null);
