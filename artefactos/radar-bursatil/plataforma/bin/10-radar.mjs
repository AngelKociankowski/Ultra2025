// Paso 4 · Radar (12b §D.2, §E.5.6). Uso: node bin/10-radar.mjs --dir <carpeta> --modo correr|ninguno
//   correr:  corrida propia (FMP REST) → trabajo/analisis.json y trabajo/radar-resumen.json (nada a db en este paso)
//   ninguno: sin análisis de hoy (código 3)
// No lee ni escribe documentos de la página: sin FMP no hay Radar ese día.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { correrRadar } from "../lib/radar-nodo.mjs";
import { feriadosAnio } from "../lib/tiempo.mjs";
import { objetivoDelDia } from "../lib/reglas.mjs";
import { libroDeDb } from "../lib/libro.mjs";
import { resumenRadar } from "../lib/radar-resumen.mjs";

const PASO = "10-radar";
const AYUDA = "Uso: node bin/10-radar.mjs --dir <carpeta> --modo correr|ninguno";
const isNum = v => typeof v === "number" && Number.isFinite(v);

const analisisDe = (fuente, out, extra = {}) => Object.assign({ fuente, estado: out ? (out.partial ? "parcial" : "listo") : "sin_radar", motivo: null, runId: null,
  asOf: out ? out.asOf : null, nowMs: out ? out.nowMs : null, plan: out ? out.plan : null, parcial: !!(out && out.partial), llamadas: { total: 0 }, out }, extra);

// Objetivo preliminar para el resumen (el definitivo sale de 40-decidir con la valuación del día)
export function objetivoPreliminar({ C, out, dir, config }) {
  const l = leerDoc(dir, "cartera-libro");
  if (l.estado !== "ok") return { objetivo: null, tenidos: [] };
  const { libro } = libroDeDb(l.doc);
  const filaFx = out.rows.find(r => r.symbol === "USDMXN"), fx = filaFx && isNum(filaFx.price) ? filaFx.price : libro.mandato.fx0;
  const valorUSD = isNum(libro.refs && libro.refs.dia && libro.refs.dia[1]) ? libro.refs.dia[1] : libro.mandato.baseUSD;
  const o = objetivoDelDia({ C, out, perfil: (config && config.perfil) || libro.mandato.perfil, valorUSD, fx, cetesPct: null, nowMs: out.nowMs });
  const tenidos = [...new Set(libro.posiciones.filter(p => p.lotes.length).map(p => p.sym).concat(libro.pendientes.map(p => p.sym)))];
  return { objetivo: o.estado === "ok" ? o : null, tenidos };
}

export async function main(argv, { transporteFmp = null, ahora = Date.now, pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--modo"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir || !["correr", "ninguno"].includes(a.modo)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json");
  if (!prep) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
  const fecha = prep.fechaET, modo = prep.modo || null;
  const re = leerDoc(dir, "rutina-estado"), previo = re.estado === "ok" ? re.doc.previo : null;
  const sale = (codigo, accion, analisis, resumen) => {
    escribirTrabajo(dir, "analisis.json", analisis);
    escribirTrabajo(dir, "radar-resumen.json", resumen);
    reg.info(`radar: ${accion}`, { motivo: analisis.motivo });
    return { codigo, linea: lineaPaso({ paso: PASO, ok: codigo === 0, accion, modo, resumen: { filas: analisis.out ? analisis.out.rows.length : 0, motivo: analisis.motivo, llamadas: analisis.llamadas.total } }) };
  };
  const sinRadar = (motivo, llamadas = { total: 0 }) => sale(3, "sin_radar", analisisDe("ninguna", null, { motivo, llamadas }), resumenRadar({ estado: "sin_radar", motivo, t: ahora(), f: fecha }));
  if (a.modo === "ninguno") return sinRadar((prep.radar && prep.radar.motivo) || "sin_radar");
  const pag = pagina || cargarPagina(), C = pag.C;
  if (!pag.compatible) return sinRadar("pagina_cambio");
  const anio = fecha.slice(0, 4), fmp = crearFmp({ transporte: transporteFmp || transporteCurl(), ahora, registro: reg });
  const fdb = leerDoc(dir, `feriados-${anio}`);
  let fer = feriadosAnio({ anio, docDb: fdb.estado === "ok" ? fdb.doc : null });
  if (!fer.filas) {
    try { const r = await fmp.callTool("FMP", "marketHours", { endpoint: "holidays-by-exchange", exchange: "NYSE", from_date: `${anio}-01-01`, to_date: `${anio}-12-31` }); fer = feriadosAnio({ anio, filasFmp: C.extractRows(r) }); }
    catch (e) { reg.aviso("sin feriados de FMP", { code: e.code }); }
  }
  const r = await correrRadar({ C, D: pag.D, mcp: fmp, ahora, feriados: fer.filas, registro: reg });
  if (r.estado === "error") return sinRadar(r.motivo, r.llamadas);
  const { objetivo, tenidos } = objetivoPreliminar({ C, out: r.out, dir, config: prep.config });
  const resumen = resumenRadar({ out: r.out, estado: r.estado, motivo: r.motivo, llamadas: r.llamadas, t: ahora(), f: fecha, objetivo, previo, tenidos });
  return sale(0, r.estado, analisisDe("rutina", r.out, { motivo: r.motivo, llamadas: r.llamadas }), resumen);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
