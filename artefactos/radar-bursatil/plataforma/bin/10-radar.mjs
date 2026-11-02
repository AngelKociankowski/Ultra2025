// Paso 4 · Radar (12b §D.2, §E.5.6; 12c §C). Uso: node bin/10-radar.mjs --dir <carpeta> --modo correr|pagina|ninguno
//   correr:  corrida propia (FMP REST) → trabajo/analisis.json y trabajo/radar-resumen.json (nada a db en este paso); si no
//            puede correr por la página o por FMP (policy, auth, down, plan), sale sin_radar con `siguiente: "pagina"`
//   pagina:  el último análisis que guardó la página, leído a archivo con ArtifactData (máquina de estados de lib/pagina.mjs:
//            accion leer → la sesión hace LEER-PÁGINA → se vuelve a correr); nunca escribe documentos de la página
//   ninguno: sin análisis de hoy (código 3)
// Con análisis (cualquier fuente) deja una copia en la caché local del Radar (lib/cache-radar.mjs).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { correrRadar } from "../lib/radar-nodo.mjs";
import { feriadosAnio, diasHabilesEntre } from "../lib/tiempo.mjs";
import { pasoPagina } from "../lib/pagina.mjs";
import { guardarAnalisis, cacheDefecto } from "../lib/cache-radar.mjs";
import { objetivoDelDia } from "../lib/reglas.mjs";
import { libroDeDb } from "../lib/libro.mjs";
import { resumenRadar } from "../lib/radar-resumen.mjs";

const PASO = "10-radar";
const AYUDA = "Uso: node bin/10-radar.mjs --dir <carpeta> --modo correr|pagina|ninguno";
// causas por las que la corrida propia no pudo correr y se pasa a la página (12c §C.1)
const A_PAGINA = m => m === "pagina_cambio" || ["policy", "auth", "down"].includes(m) || /^plan_no_soportado/.test(String(m));
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

export async function main(argv, { transporteFmp = null, ahora = Date.now, pagina = null, cache = cacheDefecto() } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--modo"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir || !["correr", "pagina", "ninguno"].includes(a.modo)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json");
  if (!prep) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
  const fecha = prep.fechaET, modo = prep.modo || null;
  const re = leerDoc(dir, "rutina-estado"), previo = re.estado === "ok" ? re.doc.previo : null;
  const sale = (codigo, accion, analisis, resumen, extra = {}) => {
    escribirTrabajo(dir, "analisis.json", analisis);
    escribirTrabajo(dir, "radar-resumen.json", resumen);
    if (analisis.out && cache) {
      try { guardarAnalisis({ dir: cache, analisis, ahora }); } catch (e) { reg.aviso("no se pudo guardar el análisis en la caché del Radar", { codigo: e.code || null }); }
    }
    reg.info(`radar: ${accion}`, { motivo: analisis.motivo, fuente: analisis.fuente });
    return { codigo, linea: lineaPaso({ paso: PASO, ok: codigo === 0, accion, modo, extra,
      resumen: { filas: analisis.out ? analisis.out.rows.length : 0, motivo: analisis.motivo, llamadas: analisis.llamadas.total, fuente: analisis.fuente, asOf: analisis.asOf || null, antiguedad: analisis.antiguedad ?? null } }) };
  };
  const sinRadar = (motivo, llamadas = { total: 0 }, alertas = []) => sale(3, "sin_radar", analisisDe("ninguna", null, { motivo, llamadas, alertas }), resumenRadar({ estado: "sin_radar", motivo, t: ahora(), f: fecha }),
    a.modo === "correr" && A_PAGINA(motivo) ? { siguiente: "pagina" } : {});
  if (a.modo === "ninguno") return sinRadar((prep.radar && prep.radar.motivo) || "sin_radar");
  const pag = pagina || cargarPagina(), C = pag.C;
  if (a.modo === "pagina") {
    let herr = null;
    try { herr = leerTrabajo(dir, "herramientas.json"); } catch (e) { herr = null; }
    if (!herr || herr.artifactdata !== true) return sinRadar("sin_artifactdata");
    const anio = Number(fecha.slice(0, 4)), feriados = [];
    for (const y of [anio - 1, anio]) { const d = leerDoc(dir, `feriados-${y}`); feriados.push(...(feriadosAnio({ anio: y, docDb: d.estado === "ok" ? d.doc : null }).filas || [])); }
    const r = pasoPagina({ C, dir, sesion: (prep.rutina && prep.rutina.sesion) || null, hoy: fecha, feriados });
    if (r.accion === "leer") {
      reg.info("radar: leer página", { ronda: r.lista.ronda, lecturas: r.lista.lecturas.length });
      return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "leer", modo, resumen: { ronda: r.lista.ronda, lecturas: r.lista.lecturas.length }, extra: { lista: "trabajo/leer-pagina.json" } }) };
    }
    if (r.accion === "sin_radar") return sinRadar(r.motivo, { total: 0 }, r.alertas || []);
    // ya terminó en una corrida anterior de este mismo comando: analisis.json está escrito
    if (!r.analisis) return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: r.accion, modo, resumen: { fuente: "pagina", asOf: r.asOf, antiguedad: r.antiguedad } }) };
    const an = Object.assign(r.analisis, { alertas: r.alertas || [] });
    const { objetivo, tenidos } = objetivoPreliminar({ C, out: an.out, dir, config: prep.config });
    return sale(0, an.estado, an, resumenRadar({ out: an.out, estado: an.estado, motivo: null, llamadas: an.llamadas, t: ahora(), f: fecha, objetivo, previo, tenidos, fuente: "pagina", antiguedad: an.antiguedad }));
  }
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
  const antiguedad = diasHabilesEntre(r.out.asOf, fecha, fer.filas || []);
  const resumen = resumenRadar({ out: r.out, estado: r.estado, motivo: r.motivo, llamadas: r.llamadas, t: ahora(), f: fecha, objetivo, previo, tenidos, fuente: "rutina", antiguedad });
  return sale(0, r.estado, analisisDe("rutina", r.out, { motivo: r.motivo, llamadas: r.llamadas, fecha, antiguedad, runIdFuente: `r${fecha.replace(/-/g, "")}` }), resumen);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
