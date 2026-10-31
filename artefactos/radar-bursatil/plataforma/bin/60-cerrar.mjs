// Paso 9 · Cerrar (12-plan §5.9, §5.12): libro, operaciones, serie, mapa, contador, bitácora, índice, rutina-estado y aviso.
// Uso: node bin/60-cerrar.mjs --dir <carpeta> [--degradado <paso>]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, leerJson, limpiarGrupo, escribirDoc, borrarDoc, escribirAviso, rutas, bytesDe } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { aplicarEjecucion, aplicarEventosOps } from "../lib/libro.mjs";
import { actualizarFuera, configEfectiva } from "../lib/reglas.mjs";
import { validarNoticias } from "../lib/noticias.mjs";
import { armarAviso } from "../lib/aviso.mjs";
import { fechaHoraET, mesDe } from "../lib/tiempo.mjs";
import { CATS, DEV, DOC_MAX, VERSION } from "../lib/constantes.mjs";

const PASO = "60-cerrar";
const AYUDA = "Uso: node bin/60-cerrar.mjs --dir <carpeta> [--degradado <paso>]";
export const TEXTO_FALLA = {
  preparar: "la preparación del día falló", radar: "el Radar no corrió; sin análisis de hoy", cartera: "sin datos de eToro; sin órdenes hoy",
  noticias: "no se juntaron noticias", decidir: "no se calcularon decisiones; sin órdenes", ejecucion: "no se guardó el plan en db; no se ejecutó nada",
  ejecutar: "la ejecución no terminó; se concilia mañana", cerrar: "el cierre falló",
};
const isNum = v => typeof v === "number" && Number.isFinite(v);
const ETQ = { 1: "Evitar", 2: "Mantener", 3: "Compra" };
const MAX_INDICE = 400, OPS_MAX = 140000;

function seguro(dir, nombre, errores) {
  try { return leerTrabajo(dir, nombre); } catch (e) { errores.push({ paso: "cerrar", codigo: e.codigo || "lectura", texto: `${nombre} ilegible` }); return null; }
}

// §5.9.5 cambios: contra senales/objetivo de la bitácora anterior, más el régimen
export function cambiosRadar({ senales, objetivo, prev }) {
  if (!prev) return [];
  const antes = new Map((prev.senales || []).map(s => [s[0], s])), obj0 = new Set((prev.objetivo || []).map(o => o.id)), obj1 = new Set(objetivo.map(o => o.id));
  const out = [];
  for (const o of objetivo) if (!obj0.has(o.id)) out.push({ sym: o.id, tipo: "entra_objetivo", antes: null, ahora: { peso: o.peso } });
  for (const id of obj0) if (!obj1.has(id)) out.push({ sym: id, tipo: "sale_objetivo", antes: { peso: (prev.objetivo.find(o => o.id === id) || {}).peso }, ahora: null });
  for (const s of senales) { const a = antes.get(s[0]); if (a && a[1] !== s[1]) out.push({ sym: s[0], tipo: "senal", antes: { senal: a[1], pct: a[2] }, ahora: { senal: s[1], pct: s[2] } }); }
  return out;
}

const frase = c => (c.tipo === "entra_objetivo" ? `${c.sym} entra al objetivo` : c.tipo === "sale_objetivo" ? `${c.sym} sale del objetivo` : `${c.sym} pasa a ${ETQ[c.ahora.senal]}`);

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--degradado"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  if (a.degradado !== undefined && !TEXTO_FALLA[a.degradado]) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: `paso desconocido: ${a.degradado}` } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const t = ahora(), errores = [], alertas = [];
  const prep = seguro(dir, "preparar.json", errores) || {};
  const fecha = prep.fechaET || fechaHoraET(t).fecha, mes = mesDe(fecha), anio = fecha.slice(0, 4);
  const config = prep.config || configEfectiva(leerDoc(dir, "rutina-config").doc).config;
  const analisis = seguro(dir, "analisis.json", errores), cartera = seguro(dir, "cartera.json", errores);
  const decis = seguro(dir, "decisiones.json", errores), planDoc = seguro(dir, "plan-ordenes.json", errores), ejec = seguro(dir, "ejecucion.json", errores);
  const nfmp = seguro(dir, "noticias-fmp.json", errores), temas = seguro(dir, "temas-noticias.json", errores);
  let notasDoc = null;
  try { notasDoc = leerJson(path.join(rutas(dir).entrada, "noticias.json")); } catch (e) { errores.push({ paso: "noticias", codigo: "json_invalido", texto: "entrada/noticias.json ilegible" }); }
  const out = analisis && analisis.out ? analisis.out : null;
  const fallas = [];
  if (a.degradado) { fallas.push({ paso: a.degradado, texto: TEXTO_FALLA[a.degradado] }); errores.push({ paso: a.degradado, codigo: "degradado", texto: TEXTO_FALLA[a.degradado] }); }
  if (cartera && cartera.estado !== "listo" && a.degradado !== "cartera") fallas.push({ paso: "cartera", texto: cartera.estado === "sin_libro" ? "no se pudo leer cartera-libro; sin órdenes hoy" : TEXTO_FALLA.cartera });
  if (nfmp && Array.isArray(nfmp.errores) && nfmp.errores.length) errores.push({ paso: "30-fmp-noticias", codigo: "sin_fmp", texto: "FMP no dio noticias ni calendarios" });
  if (analisis && !out) errores.push({ paso: "10-radar", codigo: analisis.motivo || "sin_radar", texto: "sin análisis de hoy" });

  limpiarGrupo(dir, "final");
  const simulacion = decis ? decis.simulacion : !config.operar;
  const carteraOk = !!(cartera && cartera.estado === "listo" && cartera.libro && cartera.valuacion);

  // ---- operaciones y libro ----
  const opsDocs = {};
  const dbDir = rutas(dir).entradaDb;
  for (const f of fs.existsSync(dbDir) ? fs.readdirSync(dbDir) : []) {
    const m = f.match(/^operaciones-(\d{4}-\d{2})\.json$/);
    if (m) { const r = leerDoc(dir, f.slice(0, -5)); if (r.estado === "ok") opsDocs[m[1]] = r.doc; }
  }
  const opsFallo = !!(prep.bloqueos && prep.bloqueos.ops) || leerDoc(dir, `operaciones-${mes}`).estado === "fallo";
  let libro = carteraOk ? cartera.libro : null, tocados = new Set(), idsOps = [];
  if (carteraOk) {
    const ev = aplicarEventosOps({ docs: opsDocs, eventos: cartera.eventos || [], ahora: t });
    Object.assign(opsDocs, ev.docs); ev.tocados.forEach(m => tocados.add(m)); alertas.push(...ev.alertas);
    const plan = planDoc && Array.isArray(planDoc.ordenes) ? planDoc.ordenes : [];
    let resultados = null;
    if (ejec && Array.isArray(ejec.resultados)) resultados = ejec.resultados.map(r => Object.assign({}, plan.find(o => o.id === r.id) || {}, r));
    else if (simulacion && plan.length) resultados = plan.map(o => Object.assign({}, o, { estado: "simulada" }));
    if (resultados && resultados.length) {
      const docMes = opsDocs[mes] || { kind: "carteraOps", v: 1, mes, at: t, ops: [] };
      const r = aplicarEjecucion({ libro, ops: docMes, resultados, ahora: t });
      libro = r.libro; opsDocs[mes] = r.ops; tocados.add(mes); idsOps = resultados.map(x => x.id);
    }
    const completo = !!(out && !out.partial && decis && decis.objetivo && decis.objetivo.estado === "ok");
    libro = actualizarFuera({ libro, pesos: decis && decis.objetivo ? decis.objetivo.pesos : {}, completo, fecha });
    const v = cartera.valuacion;
    libro.ultimaValuacion = { at: t, valorUSD: v.valorUSD, valorMXN: v.valorMXN, fx: v.fx };
    libro.ultimaRutina = fecha; libro.at = t;
  }
  const escritos = [];
  const escribir = (id, doc) => { escribirDoc(dir, "final", id, doc); escritos.push(id); };
  for (const m of [...tocados].sort()) {
    if (m === mes && opsFallo) { alertas.push(`operaciones-${mes} no se pudo leer: las operaciones de hoy no se guardan.`); continue; }
    const d = opsDocs[m];
    if (bytesDe(d) > OPS_MAX && m === mes) { // el mes pasó de 140 000 B: lo nuevo va a operaciones-<mes>-2
      const leidos = (leerDoc(dir, `operaciones-${m}`).doc || { ops: [] }).ops.map(o => o.id);
      const dos = leerDoc(dir, `operaciones-${m}-2`).doc || { kind: "carteraOps", v: 1, mes: m, at: t, ops: [] };
      const nuevas = d.ops.filter(o => !leidos.includes(o.id));
      dos.ops = dos.ops.filter(o => !nuevas.some(n => n.id === o.id)).concat(nuevas); dos.at = t;
      d.ops = d.ops.filter(o => leidos.includes(o.id));
      escribir(`operaciones-${m}`, d); escribir(`operaciones-${m}-2`, dos);
    } else escribir(`operaciones-${m}`, d);
  }
  if (carteraOk && !(prep.bloqueos && prep.bloqueos.libro)) escribir("cartera-libro", libro);
  if (carteraOk && cartera.serie && !(cartera.bloqueos && cartera.bloqueos.serie)) escribir(`cartera-serie-${anio}`, cartera.serie);
  if (carteraOk && cartera.mapa && !(cartera.bloqueos && cartera.bloqueos.mapa)) escribir("etoro-mapa", cartera.mapa);

  // ---- contador: llamadas a FMP después del Radar (byCat.manual) ----
  const llamadasDespues = (cartera && cartera.llamadasFmp || 0) + (nfmp && nfmp.llamadas || 0);
  if (llamadasDespues > 0) {
    let c = null;
    try { c = leerJson(path.join(rutas(dir).salida, "radar", `contador-${DEV}.json`)); } catch (e) { c = null; }
    if (!c) { const e = leerDoc(dir, `contador-${DEV}`); c = e.estado === "ok" && e.doc.dateET === fecha ? e.doc : null; }
    const byCat = Object.fromEntries(CATS.map(k => [k, c && c.byCat && Number.isInteger(c.byCat[k]) ? c.byCat[k] : 0]));
    byCat.manual += llamadasDespues;
    escribir(`contador-${DEV}`, { kind: "contador", v: 1, dev: DEV, dateET: fecha, used: CATS.reduce((s, k) => s + byCat[k], 0), byCat, limitHit: false, suspect: null, at: t });
  }

  // ---- noticias ----
  const simbolos = new Set([...(out ? out.rows.map(r => r.symbol) : []), ...((libro || (cartera && cartera.libro) || { posiciones: [] }).posiciones.map(p => p.sym)), ...((temas && temas.simbolos) || []).map(s => s.sym)]);
  const nv = notasDoc ? validarNoticias({ doc: notasDoc, ahoraMs: t, ventanaH: config.noticiasVentanaH, simbolos: [...simbolos] }) : { validas: [], descartadas: [], eventos: [] };
  if (!notasDoc) errores.push({ paso: "noticias", codigo: "sin_notas", texto: "no se escribió entrada/noticias.json" });

  // ---- bitácora ----
  const bi = leerDoc(dir, "bitacora-indice");
  const idx = bi.estado === "ok" && Array.isArray(bi.doc.dias) ? bi.doc : { kind: "bitacoraIndice", v: 1, at: t, dias: [] };
  const prevF = (idx.dias.find(d => d.f < fecha) || {}).f, prevB = prevF ? leerDoc(dir, `bitacora-${prevF}`).doc : null;
  const senales = out ? out.rows.map(r => [r.symbol, r.signal, r.pct]) : [];
  const roles = (decis && decis.roles) || {};
  const objetivo = decis && decis.objetivo ? Object.entries(decis.objetivo.pesos).map(([id, peso]) => ({ id, peso, rol: roles[id] || null })) : [];
  const regimen = out && out.regime ? { estado: out.regime.state, etiqueta: out.regime.label } : null;
  const cambios = out ? cambiosRadar({ senales, objetivo, prev: prevB }) : [];
  const decisiones = decis ? decis.decisiones.map(d => ({ sym: d.sym, regla: d.regla, accion: d.accion, pesoActual: d.pesoActual, pesoObjetivo: d.pesoObjetivo, desvPts: d.desvPts, montoUSD: d.montoUSD, motivo: d.motivo, noticias: d.noticias, razonOmision: d.razonOmision })) : [];
  const alertasTodas = [...new Set([...(prep.alertas || []), ...((cartera && cartera.alertas) || []), ...((decis && decis.alertas) || []), ...alertas])];
  const resultadosEj = ejec && Array.isArray(ejec.resultados) ? ejec.resultados : [];
  for (const r of resultadosEj) if (r.estado === "rechazada" || r.estado === "desconocida") alertasTodas.push(`Orden ${r.id} ${r.estado}${r.error ? ": " + String(r.error).slice(0, 80) : ""}`);
  const degradada = !!a.degradado || !carteraOk || !out || !decis;
  const estado = degradada ? "degradada" : (out.partial || errores.some(e => e.paso === "30-fmp-noticias" || e.paso === "noticias")) ? "parcial" : "completa";
  // aviso
  const plan = planDoc && Array.isArray(planDoc.ordenes) ? planDoc.ordenes : [];
  const opsAviso = simulacion ? plan.map(o => ({ sym: o.sym, lado: o.lado, regla: o.regla }))
    : resultadosEj.filter(r => !["rechazada", "desconocida"].includes(r.estado)).map(r => { const o = plan.find(x => x.id === r.id) || {}; return { sym: o.sym, lado: o.lado, regla: o.regla }; });
  const pri = c => (c.tipo !== "senal" ? 0 : objetivo.some(o => o.id === c.sym) || (libro && libro.posiciones.some(p => p.sym === c.sym)) ? 1 : 2);
  const notasAviso = nv.eventos.filter(e => e.confirmado).map(e => nv.validas.find(n => n.evento && n.evento.simbolo === e.simbolo && n.evento.categoria === e.categoria))
    .concat(nv.validas.filter(n => n.tema === "macro" || n.tema === "mercado").sort((x, y) => (x.fecha < y.fecha ? 1 : -1))).filter(Boolean);
  const v = carteraOk ? cartera.valuacion : null;
  const horaAviso = fechaHoraET(t).hora;
  const aviso = armarAviso({
    fecha, hora: horaAviso, simulacion, cartera: v ? { valorUSD: v.valorUSD, valorMXN: v.valorMXN } : null, rend: carteraOk ? cartera.rendimientos : null,
    radar: out ? { regimen: regimen && regimen.etiqueta, cambios: cambios.slice().sort((x, y) => pri(x) - pri(y)).slice(0, 3).map(frase) } : { motivoSin: (analisis && analisis.motivo) || "sin análisis" },
    notas: [...new Set(notasAviso)].slice(0, 2).map(n => ({ titulo: n.titulo, medio: n.medio })), operaciones: opsAviso, alertas: alertasTodas, fallas,
  });
  const bit = {
    kind: "bitacora", v: 1, fecha, at: t,
    sesion: { inicio: prep.ahora || null, fin: t, version: VERSION, pagina: prep.compat ? (prep.compat.ok ? prep.compat.pagina || null : "cambió") : null, simulacion },
    estado, mercado: { abierto: !!(prep.mercado && prep.mercado.abierto), feriado: (prep.mercado && prep.mercado.feriado) || null, cierreAnticipado: !!(prep.mercado && prep.mercado.cierreAnticipado), horaET: prep.horaET || null },
    radar: { fuente: analisis ? analisis.fuente : "ninguna", runId: analisis ? analisis.runId || null : null, asOf: out ? out.asOf : null, parcial: !!(out && out.partial), motivo: analisis ? analisis.motivo || null : "sin_radar",
      llamadasFMP: analisis && analisis.llamadas ? analisis.llamadas.total || 0 : 0, regimen, regimenAntes: prevB && prevB.radar ? prevB.radar.regimen : null, cambios },
    senales, objetivo, objetivoEfectivo: decis && decis.objetivo ? decis.objetivo.efectivo : null,
    cartera: v ? { valorUSD: v.valorUSD, valorMXN: v.valorMXN, fx: v.fx, efectivoUSD: v.efectivoUSD, posiciones: v.posiciones, composicion: cartera.composicion } : { valorUSD: null, valorMXN: null, fx: null, efectivoUSD: null, posiciones: [], composicion: {} },
    rendimientos: carteraOk && cartera.rendimientos ? { usd: cartera.rendimientos.usd, mxn: cartera.rendimientos.mxn, spy: cartera.rendimientos.spy, meta15: cartera.rendimientos.meta15 } : { usd: {}, mxn: {}, spy: {}, meta15: {} },
    noticias: { notas: nv.validas.map(n => ({ id: n.id, titulo: n.titulo, medio: n.medio, url: n.url, fecha: n.fecha, tema: n.tema, simbolos: n.simbolos, resumen: n.resumen, evento: n.evento })),
      eventos: nv.eventos, vetos: decisiones.filter(d => d.accion === "vetada").map(d => d.sym), descartadas: nv.descartadas.length },
    decisiones, operaciones: idsOps, alertas: alertasTodas, errores, aviso,
  };
  while (bytesDe(bit) > DOC_MAX && bit.noticias.notas.length) bit.noticias.notas.pop();
  escribir(`bitacora-${fecha}`, bit);
  // índice (≤ 400, descendente); lo que sale se borra
  const fila = { f: fecha, estado, vUSD: v ? v.valorUSD : null, rDia: carteraOk && cartera.rendimientos ? cartera.rendimientos.usd.dia : null, nOps: idsOps.length, sim: simulacion };
  const dias = idx.dias.filter(d => d.f !== fecha).concat([fila]).sort((x, y) => (x.f < y.f ? 1 : -1));
  const quedan = config.podar ? dias.slice(0, MAX_INDICE) : dias, salen = config.podar ? dias.slice(MAX_INDICE) : [];
  if (bi.estado !== "fallo") {
    escribir("bitacora-indice", { kind: "bitacoraIndice", v: 1, at: t, dias: quedan });
    for (const d of salen) borrarDoc(dir, "final", `bitacora-${d.f}`);
  } else alertasTodas.push("bitacora-indice no se pudo leer: hoy no se actualiza.");
  // rutina-estado (último)
  const ejecucion = decis ? { inicio: ejec ? ejec.inicio || null : null, simulacion, planSha: decis.planSha || null, plan } : { inicio: null, simulacion, planSha: null, plan: [] };
  escribir("rutina-estado", { kind: "rutinaEstado", v: 1, fecha, estado: degradada ? "degradada" : "hecha", paso: "cerrar", inicio: prep.ahora || t, fin: t,
    intentos: (prep.rutina && prep.rutina.intentos) || 1, ejecucion, motivo: a.degradado ? `degradado: ${a.degradado}` : null });
  escribirAviso(dir, aviso);
  reg.info("cierre listo", { estado, escritos });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "listo", resumen: { estado, docs: escritos.length, aviso: aviso.length }, escribir: "salida/final/_orden.json" }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
