// Paso 8 · Ejecutar en eToro Demo (12b §F). A lo más un POST por línea de plan por día; nunca se reenvía; lo que pudo llegar
// a eToro cuenta como enviado hasta probar lo contrario.
//   --armar     reclamo de envío del día: ejecucion-<hoy> sin ifVersion en salida/pre-ejecucion (F.2)
//   --enviar    ventas primero y luego compras, con el diario sincronizado a disco antes de cada POST (F.3)
//   --reanudar  el mismo proceso caído: nunca reenvía una línea con envío en el diario (F.4)
// Uso: node bin/50-ejecutar.mjs --dir <carpeta> --armar | --enviar | --reanudar
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerTrabajo, escribirTrabajo, leerDoc, leerJson, rutas } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { crearEToro } from "../lib/etoro.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { bidsDe, precioValido } from "../lib/libro.mjs";
import { configEfectiva } from "../lib/reglas.mjs";
import { armarGrupo, conH, ts, usd, u6, precio, sesionDe, escritoPorEstaSesion, leerVersiones } from "../lib/db.mjs";
const leerVersionesDe = (dir, id) => leerVersiones(dir)[id] || {};
import { feriadosAnio, ventanaDelDia, fechaHoraET } from "../lib/tiempo.mjs";
import { shaArchivo } from "./40-decidir.mjs";
import { leerDiario, anotarSync } from "../lib/diario.mjs";

const PASO = "50-ejecutar";
const AYUDA = "Uso: node bin/50-ejecutar.mjs --dir <carpeta> --armar | --enviar | --reanudar";
const SONDEO_MS = 5000, SONDEOS = 24; // F.3.4: cada 5 s hasta 120 s
const ANTES_MS = 120000, DESPUES_MS = 600000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isNum = v => typeof v === "number" && Number.isFinite(v);
const piso = x => Math.floor(x * 100 + 1e-7) / 100;
const posId = p => p.positionID ?? p.positionId ?? null, ordId = p => p.orderID ?? p.orderId ?? null, instId = p => p.instrumentID ?? p.instrumentId ?? null;
const FASES = ["--armar", "--enviar", "--reanudar"];

// líneas de la ejecución (§E.5.10): una por cierre de lote y una por compra
export function lineasDe(plan) {
  const out = [];
  for (const o of plan.ordenes || []) {
    if (o.lado === "venta") (o.cierres || []).forEach((c, k) => out.push({ id: o.id, k, lado: "v", i: o.instrumentId, pos: c.positionId, u: c.unidades ?? null, usd: null, rid: o.requestIds[k] }));
    else out.push({ id: o.id, k: 0, lado: "c", i: o.instrumentId, pos: null, u: null, usd: usd(o.montoUSD), rid: o.requestIds[0] });
  }
  return out;
}
const lineaValida = l => typeof l.rid === "string" && UUID.test(l.rid) && Number.isSafeInteger(l.i) && l.i > 0
  && (l.lado === "v" ? Number.isSafeInteger(l.pos) && l.pos > 0 && (l.u === null || (isNum(l.u) && l.u > 0)) : isNum(l.usd) && l.usd > 0);

function contexto(dir, pagina) {
  const R = rutas(dir);
  const prep = leerTrabajo(dir, "preparar.json") || {}, dec = leerTrabajo(dir, "decisiones.json"), plan = leerTrabajo(dir, "plan-ordenes.json"), cartera = leerTrabajo(dir, "cartera.json");
  const config = configEfectiva(prep.config || null).config, { C } = pagina || cargarPagina();
  const rutaPlan = path.join(R.trabajo, "plan-ordenes.json");
  const planOk = !!(dec && plan && fs.existsSync(rutaPlan) && dec.planSha === shaArchivo(rutaPlan));
  // N9: la compuerta operar se toma de rutina-config tal como llegó de db (con h válido), no solo de plan.simulacion
  const rc = leerDoc(dir, "rutina-config"), cdb = rc.estado === "ok" ? configEfectiva(rc.doc).config : null;
  const operar = !!(cdb && cdb.operar === true && cdb.activadoEl && config.operar === true);
  return { R, prep, dec, plan, cartera, config, C, planOk, operar, sesion: sesionDe(dir), rutaDiario: path.join(R.trabajo, "diario-ejecucion.jsonl"), rutaEjec: path.join(R.trabajo, "ejecucion.json") };
}
// F.2.1 / F.3.2: mercado abierto y dentro de la ventana con el reloj de ahora y el calendario (sin calendario: no)
function enHorario({ dir, C, config, t }) {
  const anio = fechaHoraET(t).fecha.slice(0, 4), fdb = leerDoc(dir, `feriados-${anio}`);
  const fer = feriadosAnio({ anio, docDb: fdb.estado === "ok" ? fdb.doc : null }).filas;
  return !!fer && C.marketState(t, fer).open && ventanaDelDia({ C, ahoraMs: t, feriados: fer, config }).dentro;
}
async function leerPortafolio(et, dormir) {
  for (let i = 0; i < 3; i++) {
    try { const p = await et.portafolio(); return (p && p.clientPortfolio) || p || {}; } catch (e) { if (i < 2) await dormir(2000); }
  }
  return null;
}
function antesDe(cp, instrumentos) {
  const pos = (cp.positions || []).filter(p => instrumentos.has(instId(p))).map(posId).filter(isNum);
  const ps = new Set(pos);
  const ord = [...(cp.ordersForOpen || []), ...(cp.ordersForClose || [])].filter(o => instrumentos.has(instId(o)) || ps.has(posId(o))).map(ordId).filter(isNum);
  return { pos: [...new Set(pos)].sort((a, b) => a - b), ord: [...new Set(ord)].sort((a, b) => a - b) };
}
const resNoEnviada = (lineas, err) => lineas.map(l => ({ id: l.id, k: l.k, est: "no_enviada", env: null, http: null, o: null, pos: [], px: null, uej: null, usdej: null, usd: null, err }));

// ---- --armar (F.2) ----
async function armar({ dir, x, et, ahora, dormir, reg }) {
  const t = ahora(), f = x.prep.fechaET || fechaHoraET(t).fecha, modo = x.prep.modo || "en_linea";
  if (fs.existsSync(x.rutaDiario) || fs.existsSync(x.rutaEjec)) return { codigo: 3, linea: lineaPaso({ paso: PASO, ok: false, accion: "ya_ejecutado", modo, resumen: { motivo: "ya hay diario o ejecucion.json en esta carpeta" } }) };
  const lineas = x.plan ? lineasDe(x.plan) : [];
  const nada = err => {
    if (lineas.length && err) escribirTrabajo(dir, "ejecucion.json", { doc: null, sesion: x.sesion, res: resNoEnviada(lineas, err) });
    reg.info(`armar: nada (${err || "sin órdenes reales"})`);
    return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "nada", modo, resumen: { motivo: err || "sin órdenes reales", lineas: lineas.length } }) };
  };
  if (!x.plan || !lineas.length || x.plan.simulacion || (x.dec && x.dec.simulacion)) return nada(null);
  if (!x.operar) return nada("rutina-config.operar no está activado");
  if (!enHorario({ dir, C: x.C, config: x.config, t })) return nada("fuera de horario");
  if (!x.planOk) return nada("plan alterado");
  if (!lineas.every(lineaValida)) return nada("línea de plan inválida");
  if (!x.cartera || x.cartera.estado !== "listo" || !x.cartera.libro) return nada("sin cartera conciliada");
  const cp = await leerPortafolio(et, dormir);
  if (!cp) return nada("sin portafolio de eToro");
  const doc = { kind: "ejecucion", v: 1, f, sesion: (x.prep.rutina && x.prep.rutina.sesion) || "s-desconocida", armado: ts(ahora()), fin: null,
    antes: antesDe(cp, new Set(lineas.map(l => l.i))), lineas, res: [] };
  escribirTrabajo(dir, "ejecucion-doc.json", doc);
  const id = `ejecucion-${f}`, docs = [{ id, data: doc }];
  // R1 (00p §2): la fecha queda en rutina-estado.ejecucionesAbiertas antes del primer POST, en el mismo db_write que el reclamo
  // (si cualquiera de los dos choca, no se escribe ninguno y no se envía nada)
  let ahoraDoc = null;
  try { ahoraDoc = leerJson(path.join(x.R.salida, "ahora", "rutina-estado.json")); } catch (e) { ahoraDoc = null; }
  if (ahoraDoc && escritoPorEstaSesion(dir, "rutina-estado", "ahora") && leerVersiones(dir)["rutina-estado"].h === ahoraDoc.h) {
    // solo cambia la lista (y el paso): el latido sigue siendo el del ahora, para no mover la regla de los 30 min de §D.2
    const r = Object.assign({}, ahoraDoc, { paso: "ejecutando", ejecucionesAbiertas: [...new Set((ahoraDoc.ejecucionesAbiertas || []).concat([f]))].sort() });
    delete r.h;
    docs.push({ id: "rutina-estado", data: r });
  } else reg.aviso("pre-ejecucion sin rutina-estado: esta sesión no registró su ahora");
  const g = armarGrupo({ dir, grupo: "pre-ejecucion", docs, modo, crear: [id] });
  reg.info("armado", { lineas: lineas.length, antes: doc.antes });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "armado", modo, resumen: { lineas: lineas.length, antes: doc.antes.pos.length + doc.antes.ord.length }, escribir: g.escribir }) };
}

// ---- --enviar / --reanudar (F.3, F.4) ----
async function enviar({ dir, x, et, ahora, dormir, reg, reanudar }) {
  const t0 = ahora(), f = x.prep.fechaET || fechaHoraET(t0).fecha, modo = x.prep.modo || "en_linea";
  const salir = (motivo, accion = "ya_ejecutado") => { reg.aviso(`${accion}: ${motivo}`); return { codigo: 3, linea: lineaPaso({ paso: PASO, ok: false, accion, modo, resumen: { motivo, post: 0 } }) }; };
  const diario0 = leerDiario(x.rutaDiario);
  if (fs.existsSync(x.rutaEjec)) return salir("la ejecución de hoy ya terminó (ejecucion.json)");
  if (!reanudar && fs.existsSync(x.rutaDiario)) return salir("ya hay diario: solo --reanudar (una vez)");
  if (reanudar && !fs.existsSync(x.rutaDiario)) return salir("sin diario en esta carpeta: no hay nada que reanudar");
  if (reanudar && diario0.some(l => l.fase === "reanudar")) return salir("ya se reanudó una vez");
  // barrera 4 de F.6: el reclamo ejecucion-<hoy> lo escribió esta sesión y es el mismo documento armado
  const doc = leerTrabajo(dir, "ejecucion-doc.json"), id = `ejecucion-${f}`;
  if (!doc || !escritoPorEstaSesion(dir, id, "pre-ejecucion") || leerVersionesDe(dir, id).h !== conH(doc).h) return salir("ejecucion-<hoy> no la escribió esta sesión (sin reclamo de envío)");
  if (!x.operar || x.plan.simulacion || (x.dec && x.dec.simulacion)) return salir("rutina-config.operar no está activado (o el plan es de simulación)", "incompleto");
  if (!x.planOk || JSON.stringify(lineasDe(x.plan)) !== JSON.stringify(doc.lineas)) return salir("el plan no coincide con el armado", "incompleto");
  const anotar = l => anotarSync(x.rutaDiario, Object.assign({ t: ts(ahora()) }, l));
  if (reanudar) anotar({ fase: "reanudar" });

  const libro = x.cartera.libro, minOrden = x.config.minOrdenUSD;
  const antesPos = new Set(doc.antes.pos), lotes = new Map(libro.posiciones.flatMap(p => p.lotes.map(l => [l.positionId, l])));
  const L = doc.lineas.map(l => {
    const e = diario0.find(d => d.fase === "envio" && d.id === l.id && d.k === l.k), r = diario0.filter(d => d.fase === "respuesta" && d.id === l.id && d.k === l.k).pop();
    const final = r && (r.clase === "rechazada" || r.clase === "no_enviada") ? r.clase : null;
    return Object.assign({}, l, { env: e ? e.t : null, usdEnv: e && isNum(e.usd) ? e.usd : null, http: r ? r.http ?? null : null, clase: r ? r.clase : e ? "incierta" : null, o: r ? r.orderId ?? null : null,
      est: final, pos: [], px: null, uej: null, usdej: null, err: r && r.clase !== "aceptada" ? r.motivo || null : null, abierta: null, posLote: l.pos });
  });
  let detener = diario0.some(d => d.fase === "respuesta" && d.detener), sinCartera = false;
  const sinPost = l => { l.est = "no_enviada"; };
  // F.3.1: la cartera no cambió entre el armado y el envío (en --reanudar las posiciones nuevas pueden ser nuestras)
  const cp0 = await leerPortafolio(et, dormir);
  if (!cp0) {
    sinCartera = true;
    for (const l of L.filter(q => !q.est)) if (l.env) l.est = "incierta"; else { sinPost(l); l.err = "sin portafolio de eToro"; }
    return terminar();
  }
  if (!reanudar) {
    const ahoraAntes = antesDe(cp0, new Set(L.map(l => l.i)));
    const nuevos = ahoraAntes.pos.filter(p => !antesPos.has(p)).concat(ahoraAntes.ord.filter(o => !doc.antes.ord.includes(o)));
    if (nuevos.length) { for (const l of L) { sinPost(l); l.err = "la cartera cambió entre el armado y el envío"; } return terminar(); }
  }
  async function post(l, hacer) {
    if (detener) { sinPost(l); l.err = "detenido: eToro rechazó la autorización"; return; }
    if (!enHorario({ dir, C: x.C, config: x.config, t: ahora() })) { sinPost(l); l.err = "fuera de horario"; return; }
    l.env = ts(ahora());
    anotar(Object.assign({ id: l.id, k: l.k, fase: "envio", rid: l.rid }, l.lado === "c" ? { usd: l.usdEnv } : {}));
    let r;
    try { r = await hacer(); } catch (e) { r = { clase: "no_enviada", http: null, orderId: null, motivo: (e && (e.mensaje || e.codigo)) || "argumento inválido" }; }
    anotar(Object.assign({ id: l.id, k: l.k, fase: "respuesta", http: r.http, clase: r.clase, orderId: r.orderId, motivo: r.motivo }, r.detener ? { detener: true } : {}));
    Object.assign(l, { clase: r.clase, http: r.http, o: r.orderId, err: r.clase === "aceptada" ? null : r.motivo });
    if (r.clase === "no_enviada" || r.clase === "rechazada") l.est = r.clase;
    if (r.detener) detener = true;
  }
  const porVer = lado => L.filter(l => l.lado === lado && !l.est && l.env);
  async function sondear(lado, ver) {
    for (let i = 0; i < SONDEOS && porVer(lado).length; i++) {
      let cp = null;
      try { const p = await et.portafolio(); cp = (p && p.clientPortfolio) || p || null; } catch (e) { cp = null; }
      if (cp) ver(cp);
      if (porVer(lado).length) await dormir(SONDEO_MS);
    }
  }

  // ventas (cierres de lotes del libro)
  for (const l of L.filter(q => q.lado === "v" && !q.env && !q.est)) await post(l, () => et.cerrar({ positionId: l.posLote, instrumentId: l.i, unidades: l.u, requestId: l.rid }));
  const enColaV = new Set();
  await sondear("v", cp => {
    for (const l of porVer("v")) {
      const p = (cp.positions || []).find(q => posId(q) === l.posLote), lote = lotes.get(l.posLote);
      if (!p || (lote && isNum(p.units) && p.units < lote.unidades - 1e-9)) l.est = "vista";
      else if ((cp.ordersForClose || []).some(o => posId(o) === l.posLote)) enColaV.add(l);
    }
  });
  const vistas = L.filter(l => l.est === "vista");
  if (vistas.length) {
    let hist = [], bids = {};
    try { const h = await et.historial(f); hist = Array.isArray(h) ? h : []; } catch (e) { hist = []; }
    try { bids = bidsDe(await et.tasas([...new Set(vistas.map(l => l.i))])); } catch (e) { bids = {}; }
    for (const l of vistas) {
      const h = hist.find(q => (q.positionId ?? q.positionID) === l.posLote), b = bids[l.i];
      const px = h && isNum(h.closeRate) ? h.closeRate : precioValido(b, ahora()) ? b.bid : null, lote = lotes.get(l.posLote);
      const uej = l.u !== null ? l.u : lote ? lote.unidades : null;
      if (isNum(px) && isNum(uej)) Object.assign(l, { est: "ejecutada", px: precio(px), uej: u6(uej), usdej: usd(uej * px), pos: [l.posLote], err: null });
      else Object.assign(l, { est: "aceptada", pos: [l.posLote], err: "cerrada en eToro sin precio de cierre: se concilia mañana" });
    }
  }
  for (const l of porVer("v")) Object.assign(l, { est: l.clase === "aceptada" || enColaV.has(l) ? "aceptada" : "incierta", pos: [l.posLote] });

  // compras: efectivo del mandato + cierres confirmados − compras ya enviadas; si no alcanza, se escalan por igual
  const ingresos = L.filter(l => l.lado === "v" && l.est === "ejecutada").reduce((s, l) => s + l.usdej, 0);
  const gastado = L.filter(l => l.lado === "c" && l.env && l.est !== "rechazada" && l.est !== "no_enviada").reduce((s, l) => s + (l.usdEnv ?? l.usd), 0);
  const nuevas = L.filter(l => l.lado === "c" && !l.env && !l.est);
  const disponible = Math.max(0, libro.efectivoUSD + ingresos - gastado), pedido = nuevas.reduce((s, l) => s + l.usd, 0);
  const factor = pedido > disponible + 0.005 ? disponible / pedido : 1;
  for (const l of nuevas) {
    const monto = piso(l.usd * factor);
    if (monto < minOrden) { sinPost(l); l.err = "sin efectivo"; continue; }
    l.usdEnv = monto;
    await post(l, () => et.comprar({ instrumentId: l.i, montoUSD: monto, requestId: l.rid }));
  }
  const tomadas = new Set(), enColaC = new Set();
  const casa = (l, x) => {
    const env = Date.parse(l.env), d = Date.parse(x.openDateTime), monto = l.usdEnv ?? l.usd;
    return instId(x) === l.i && Number.isFinite(d) && d >= env - ANTES_MS && d <= env + DESPUES_MS && isNum(x.amount) && monto > 0 && Math.abs(x.amount / monto - 1) <= 0.01;
  };
  await sondear("c", cp => {
    for (const l of porVer("c")) {
      const libre = q => !antesPos.has(posId(q)) && !tomadas.has(posId(q));
      const p = (l.o ? (cp.positions || []).find(q => ordId(q) === l.o && libre(q)) : null)
        || (cp.positions || []).find(q => (ordId(q) === null || !l.o) && libre(q) && casa(l, q));
      if (p) {
        tomadas.add(posId(p));
        Object.assign(l, { est: "ejecutada", o: l.o ?? ordId(p), pos: [posId(p)], px: precio(isNum(p.openRate) ? p.openRate : p.amount / p.units), uej: u6(p.units), usdej: usd(p.amount), abierta: p.openDateTime, err: null });
      } else if ((cp.ordersForOpen || []).some(q => (l.o && ordId(q) === l.o) || (!doc.antes.ord.includes(ordId(q)) && casa(l, q)))) enColaC.add(l);
    }
  });
  for (const l of porVer("c")) l.est = l.clase === "aceptada" || enColaC.has(l) ? "aceptada" : "incierta";
  return terminar();

  function terminar() {
    const res = L.map(l => ({ id: l.id, k: l.k, est: l.est || "no_enviada", env: l.env, http: l.http, o: l.o ?? null, pos: l.pos, px: l.px, uej: l.uej, usdej: l.usdej,
      usd: l.lado === "c" && l.env ? l.usdEnv ?? l.usd : null, err: l.err ? String(l.err).slice(0, 80) : null, ...(l.abierta ? { abierta: l.abierta } : {}) }));
    escribirTrabajo(dir, "ejecucion.json", { doc, sesion: x.sesion, res });
    const n = res.reduce((m, r) => ((m[r.est] = (m[r.est] || 0) + 1), m), {});
    const incompleto = detener || sinCartera || res.some(r => r.est === "incierta");
    reg.info(`ejecución: ${incompleto ? "incompleto" : "listo"}`, { estados: n, reanudar });
    return { codigo: incompleto ? 3 : 0, linea: lineaPaso({ paso: PASO, ok: !incompleto, accion: incompleto ? "incompleto" : "listo", modo, resumen: { lineas: res.length, estados: n } }) };
  }
}

export async function main(argv, { transporteEToro = null, ahora = Date.now, dormir = ms => new Promise(r => setTimeout(r, ms)), pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"], banderas: FASES });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const fases = FASES.filter(k => a[k.slice(2)]);
  if (!a.dir || fases.length !== 1) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const x = contexto(dir, pagina), et = crearEToro({ transporte: transporteEToro || transporteCurl() });
  if (fases[0] === "--armar") return armar({ dir, x, et, ahora, dormir, reg });
  return enviar({ dir, x, et, ahora, dormir, reg, reanudar: fases[0] === "--reanudar" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
