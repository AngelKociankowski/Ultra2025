// Paso 4 · Radar (12-plan §5.4, §5.9.1, §4.4). Uso: node bin/10-radar.mjs --dir <carpeta> --modo correr|navegador|ninguno
//   correr:    corrida propia (FMP REST) → salida/radar/: dia-*, indice, corrida, contador, borrar de días podados
//   navegador: usa el día que ya guardó la página hoy (nada que escribir)
//   ninguno:   sin análisis de hoy (código 3)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo, limpiarGrupo, escribirDoc, borrarDoc } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { correrRadar } from "../lib/radar-nodo.mjs";
import { feriadosAnio } from "../lib/tiempo.mjs";
import { CATS, DEV } from "../lib/constantes.mjs";

const PASO = "10-radar";
const AYUDA = "Uso: node bin/10-radar.mjs --dir <carpeta> --modo correr|navegador|ninguno";

// Día de hoy guardado por la página (manifiesto + partes leídas por Claude); null si no está completo
export function diaNavegador(C, dir, fecha) {
  const m = leerDoc(dir, `dia-${fecha}`);
  if (m.estado !== "ok" || !m.doc || !Array.isArray(m.doc.parts)) return null;
  const partes = m.doc.parts.map(p => (p && typeof p.id === "string" ? leerDoc(dir, p.id) : { estado: "fallo" })).filter(x => x.estado === "ok").map(x => x.doc);
  let out = null;
  try { out = C.joinDay(m.doc, partes); } catch (e) { out = null; }
  return out && Array.isArray(out.rows) && out.rows.length ? { manifiesto: m.doc, out } : null;
}

// Regla de la página (runAnalysis): una corrida nueva solo reemplaza a la de hoy si es mejor
export function esMejor(nuevo, previo) {
  const q = r => [r.rows.length, r.rows.reduce((a, x) => a + (typeof x.coverage === "number" ? x.coverage : 0), 0)];
  const [n1, c1] = q(nuevo), [n0, c0] = q(previo);
  const worse = n1 < n0 || (n1 === n0 && c1 < c0 - 1e-9), better = n1 > n0 || c1 > c0 + 1e-9 || (!!previo.partial && !nuevo.partial);
  return !worse && better;
}

const analisisDe = (fuente, out, extra = {}) => Object.assign({ fuente, estado: out ? (out.partial ? "parcial" : "listo") : "sin_radar", motivo: null, runId: null,
  asOf: out ? out.asOf : null, nowMs: out ? out.nowMs : null, plan: out ? out.plan : null, parcial: !!(out && out.partial), llamadas: { total: 0 }, out }, extra);

export async function main(argv, { transporteFmp = null, ahora = Date.now, pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--modo"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir || !["correr", "navegador", "ninguno"].includes(a.modo)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json");
  if (!prep) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
  const fecha = prep.fechaET, pag = pagina || cargarPagina(), C = pag.C;
  const nav = diaNavegador(C, dir, fecha);
  const sale = (codigo, accion, analisis, escribir = null, resumen = {}) => {
    escribirTrabajo(dir, "analisis.json", analisis);
    reg.info(`radar: ${accion}`, { fuente: analisis.fuente, motivo: analisis.motivo });
    return { codigo, linea: lineaPaso({ paso: PASO, ok: codigo === 0, accion, resumen: Object.assign({ fuente: analisis.fuente, filas: analisis.out ? analisis.out.rows.length : 0, motivo: analisis.motivo }, resumen), escribir }) };
  };
  if (a.modo === "ninguno") return sale(3, "sin_radar", analisisDe("ninguna", null, { motivo: (prep.radar && prep.radar.motivo) || "sin_radar" }));
  if (a.modo === "navegador") {
    if (!nav) return sale(3, "sin_radar", analisisDe("ninguna", null, { motivo: "dia_navegador_invalido" }));
    return sale(0, nav.out.partial ? "parcial" : "listo", analisisDe("navegador", nav.out, { runId: nav.manifiesto.runId }));
  }

  // ---- correr ----
  const t0 = ahora(), runId = (prep.radar && prep.radar.runId) || `${DEV}-rutina-${t0}`, startedAt = (prep.radar && prep.radar.startedAt) || t0;
  const reclamo = { kind: "corrida", v: 1, dateET: fecha, plan: "STARTER", state: "running", auto: true, dev: DEV, runId, startedAt, beatAt: startedAt, finishedAt: null, reason: null };
  limpiarGrupo(dir, "radar");
  const contador = porCat => {
    const prev = leerDoc(dir, `contador-${DEV}`), base = prev.estado === "ok" && prev.doc.dateET === fecha && prev.doc.byCat ? prev.doc.byCat : {};
    const byCat = Object.fromEntries(CATS.map(k => [k, (Number.isInteger(base[k]) ? base[k] : 0) + (porCat[k] || 0)]));
    return { kind: "contador", v: 1, dev: DEV, dateET: fecha, used: CATS.reduce((s, k) => s + byCat[k], 0), byCat, limitHit: false, suspect: null, at: ahora() };
  };
  if (!pag.compatible) {
    escribirDoc(dir, "radar", "corrida", Object.assign({}, reclamo, { state: "error", finishedAt: ahora(), reason: "pagina_cambio" }));
    return sale(3, "sin_radar", nav ? analisisDe("navegador", nav.out, { runId: nav.manifiesto.runId, motivo: "pagina_cambio" }) : analisisDe("ninguna", null, { motivo: "pagina_cambio" }), "salida/radar/_orden.json");
  }
  const anio = fecha.slice(0, 4), fmp = crearFmp({ transporte: transporteFmp || transporteCurl(), ahora, registro: reg });
  let fer = feriadosAnio({ anio, docDb: leerDoc(dir, `feriados-${anio}`).doc });
  if (!fer.filas) {
    try { const r = await fmp.callTool("FMP", "marketHours", { endpoint: "holidays-by-exchange", exchange: "NYSE", from_date: `${anio}-01-01`, to_date: `${anio}-12-31` }); fer = feriadosAnio({ anio, filasFmp: C.extractRows(r) }); }
    catch (e) { reg.aviso("sin feriados de FMP", { code: e.code }); }
  }
  const r = await correrRadar({ C, D: pag.D, mcp: fmp, ahora, feriados: fer.filas, registro: reg, previo: nav ? nav.out : null });
  const llamadas = Object.assign({}, r.llamadas.porCat);
  const fin = (state, reason) => Object.assign({}, reclamo, { state, finishedAt: ahora(), reason: reason || null });
  if (r.estado === "error") {
    escribirDoc(dir, "radar", "corrida", fin("error", r.motivo));
    escribirDoc(dir, "radar", `contador-${DEV}`, contador(llamadas));
    const an = nav ? analisisDe("navegador", nav.out, { runId: nav.manifiesto.runId, motivo: r.motivo, llamadas: r.llamadas }) : analisisDe("ninguna", null, { motivo: r.motivo, llamadas: r.llamadas });
    return sale(nav ? 0 : 3, nav ? (nav.out.partial ? "parcial" : "listo") : "sin_radar", an, "salida/radar/_orden.json", { llamadas: r.llamadas.total });
  }
  if (nav && !esMejor(r.out, nav.out)) { // se queda el del navegador (regla de la página)
    escribirDoc(dir, "radar", "corrida", fin(nav.out.partial ? "partial" : "done", nav.out.partialReason));
    escribirDoc(dir, "radar", `contador-${DEV}`, contador(llamadas));
    return sale(0, nav.out.partial ? "parcial" : "listo", analisisDe("navegador", nav.out, { runId: nav.manifiesto.runId, motivo: "corrida propia no mejor", llamadas: r.llamadas }), "salida/radar/_orden.json", { llamadas: r.llamadas.total });
  }
  const { manifest, parts } = C.splitDay(r.out, { dateET: fecha, runId, dev: DEV, savedAt: ahora() });
  parts.forEach((p, i) => escribirDoc(dir, "radar", manifest.parts[i].id, p));
  escribirDoc(dir, "radar", `dia-${fecha}`, manifest);
  const ix = leerDoc(dir, "indice"), dias0 = ix.estado === "ok" && Array.isArray(ix.doc.dias) ? ix.doc.dias : [];
  const dias = dias0.filter(d => d && d.dateET !== fecha).concat([{ dateET: fecha, parts: manifest.parts.length }]).sort((x, y) => (x.dateET < y.dateET ? 1 : -1));
  const podar = !prep.config || prep.config.podar !== false, keep = C.CONFIG.SYNC.KEEP_DAYS;
  escribirDoc(dir, "radar", "indice", { kind: "indice", v: 1, dias: podar ? dias.slice(0, keep) : dias, at: ahora() });
  escribirDoc(dir, "radar", "corrida", fin(r.out.partial ? "partial" : "done", r.out.partial ? r.out.partialReason : null));
  escribirDoc(dir, "radar", `contador-${DEV}`, contador(llamadas));
  if (podar) {
    for (const d of dias.slice(keep)) { for (let k = 0; k < (d.parts || 0); k++) borrarDoc(dir, "radar", `dia-${d.dateET}-p${k}`); borrarDoc(dir, "radar", `dia-${d.dateET}`); }
    // partes de hoy del navegador que sobran (su manifiesto tenía más partes)
    if (nav) for (let k = manifest.parts.length; k < nav.manifiesto.parts.length; k++) borrarDoc(dir, "radar", `dia-${fecha}-p${k}`);
  }
  return sale(0, r.estado, analisisDe("rutina", r.out, { runId, motivo: r.motivo, llamadas: r.llamadas }), "salida/radar/_orden.json", { llamadas: r.llamadas.total, partes: parts.length });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
