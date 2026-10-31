// Paso 5 · Cartera (12-plan §5.7.1, §5.8; 12b §E.5.3, §I): conciliación con eToro Demo, valuación con precio válido,
// asignación de instrumentos, punto del día y rendimientos por referencias. Solo lecturas (GET) a eToro.
// Uso: node bin/20-cartera.mjs --dir <carpeta>
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { crearEToro } from "../lib/etoro.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { conciliar, conciliarEjecucion, valuar, bidsDe, libroDeDb, mapaDeDb, opsValidas, opsNuevo, aplicarEventosOps } from "../lib/libro.mjs";
import { indicesDelDia, rendimientosRefs, composicion } from "../lib/rendimientos.mjs";
import { leerVersiones, escritoPorEstaSesion, usd, fx4, precio as px, i8 } from "../lib/db.mjs";
import { objetivoDelDia, configEfectiva } from "../lib/reglas.mjs";
import { fechaHoraET, sumarDias, diasEntre, feriadosAnio } from "../lib/tiempo.mjs";

const PASO = "20-cartera";
const AYUDA = "Uso: node bin/20-cartera.mjs --dir <carpeta>";
const isNum = v => typeof v === "number" && Number.isFinite(v);
const copia = o => JSON.parse(JSON.stringify(o));

// ejecucion-<f> leídas sin `fin` que no son el reclamo de esta sesión (12b §F.5: se concilian sin diario)
function ejecucionesAbiertas(dir) {
  const out = [];
  for (const [id, v] of Object.entries(leerVersiones(dir))) {
    const m = id.match(/^ejecucion-(\d{4}-\d{2}-\d{2})$/);
    if (!m || v.estado !== "ok" || escritoPorEstaSesion(dir, id, "pre-ejecucion")) continue;
    const r = leerDoc(dir, id);
    if (r.estado === "ok" && r.doc.fin === null) out.push({ f: m[1], doc: r.doc });
  }
  return out.sort((a, b) => (a.f < b.f ? -1 : 1));
}
// filas NYSE del año en curso y del anterior (plazos de §F.7 que cruzan el año)
function feriadosDe(dir, hoy) {
  const anio = Number(hoy.slice(0, 4)), filas = [];
  for (const y of [anio - 1, anio]) { const d = leerDoc(dir, `feriados-${y}`); filas.push(...(feriadosAnio({ anio: y, docDb: d.estado === "ok" ? d.doc : null }).filas || [])); }
  return filas;
}

// ops-<f> importados con estado ok (para la regla 2 de pertenencia y para resolver pendientes de esos días)
function opsLeidas(dir) {
  const out = {};
  for (const [id, v] of Object.entries(leerVersiones(dir))) {
    const m = id.match(/^ops-(\d{4}-\d{2}-\d{2})$/);
    if (m && v.estado === "ok") { const r = leerDoc(dir, id); if (r.estado === "ok") out[m[1]] = r.doc; }
  }
  return out;
}

// §5.7.1: candidatos exactos (SYM, SYM.US; BRK-B también BRK.B), sin deslistar, clase 5 o 6, precio a ≤ tol del Radar
export async function verificarSimbolo({ et, sym, precioRadar, mercadoAbierto, tolPct, hoy }) {
  const nombres = new Set([sym, sym + ".US", sym.replace("-", ".")]);
  const r = await et.buscar(sym);
  const exactos = (r && Array.isArray(r.items) ? r.items : []).filter(x => nombres.has(x.internalSymbolFull));
  const rechazados = [], cands = [];
  for (const x of exactos) {
    if (x.isDelisted) rechazados.push({ instrumentId: x.instrumentId, motivo: "deslistado" });
    else if (![5, 6].includes(x.internalAssetClassId)) rechazados.push({ instrumentId: x.instrumentId, motivo: `clase ${x.internalAssetClassId}${x.internalAssetClassId === 10 ? " (cripto)" : ""}` });
    else cands.push(x);
  }
  let bids = {};
  if (mercadoAbierto && cands.length) bids = bidsDe(await et.tasas(cands.map(x => x.instrumentId)));
  const pasan = [];
  for (const x of cands) {
    const pe = mercadoAbierto && bids[x.instrumentId] && isNum(bids[x.instrumentId].bid) ? bids[x.instrumentId].bid : x.currentRate;
    const dif = isNum(pe) && isNum(precioRadar) && precioRadar > 0 ? pe / precioRadar - 1 : null;
    if (dif !== null && Math.abs(dif) <= tolPct / 100) pasan.push({ x, pe, dif });
    else rechazados.push({ instrumentId: x.instrumentId, motivo: dif === null ? "sin precio" : `diferencia de precio ${(dif * 100).toFixed(2)} %` });
  }
  if (pasan.length === 1) {
    const { x, pe, dif } = pasan[0];
    return { ok: true, asignacion: { instrumentId: x.instrumentId, simboloEToro: x.internalSymbolFull, nombre: String(x.displayname || "").trim(), clase: x.internalAssetClassId,
      verificadoEl: hoy, precioEToro: pe, precioRadar, difPct: Math.round(dif * 10000) / 100 }, rechazados };
  }
  if (pasan.length > 1) for (const p of pasan) rechazados.push({ instrumentId: p.x.instrumentId, motivo: "más de un candidato pasa el precio" });
  if (!exactos.length) rechazados.push({ instrumentId: null, motivo: "sin candidato en eToro" });
  return { ok: false, asignacion: null, rechazados };
}

export async function main(argv, { transporteEToro = null, transporteFmp = null, ahora = Date.now, pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json");
  if (!prep) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
  const analisis = leerTrabajo(dir, "analisis.json"), out = analisis && analisis.out ? analisis.out : null;
  const config = prep.config || configEfectiva(leerDoc(dir, "rutina-config").doc).config;
  const t = ahora(), et0 = fechaHoraET(t), hoy = prep.fechaET || et0.fecha, modo = prep.modo || null;
  const alertas = [];
  const fin = (codigo, accion, cuerpo) => {
    escribirTrabajo(dir, "cartera.json", cuerpo);
    reg.info(`cartera: ${accion}`, { alertas: cuerpo.alertas.length });
    return { codigo, linea: lineaPaso({ paso: PASO, ok: codigo === 0, accion, modo, resumen: { valorUSD: cuerpo.valuacion ? cuerpo.valuacion.valorUSD : null, alertas: cuerpo.alertas.length, eventos: cuerpo.eventos.length } }) };
  };
  const rl = leerDoc(dir, "cartera-libro"), rm = leerDoc(dir, "etoro-mapa");
  const desact = (prep.bloqueos && prep.bloqueos.desactualizados) || [], mapaBloqueado = rm.estado !== "ok" || desact.includes("etoro-mapa");
  // N7: lo pedido en leer-mas que llegó dañado o no se pudo leer bloquea las órdenes de hoy (RUNBOOK F6)
  let leerMas = [];
  try { leerMas = ((leerTrabajo(dir, "leer-mas.json") || {}).lecturas || []).map(l => l.id); } catch (e) { leerMas = []; }
  const verLm = leerVersiones(dir), danados = leerMas.filter(id => verLm[id] && ["corrupto", "fallo"].includes(verLm[id].estado));
  const bloqueoOrdenes = danados.length ? `${danados.join(", ")} llegó dañado o no se pudo leer de db` : null;
  for (const id of danados) alertas.push(`${id} llegó dañado o no se pudo leer de db: hoy no se opera.`);
  const mapa = rm.estado === "ok" ? mapaDeDb(rm.doc) : { instrumentos: {}, rechazados: {} };
  const mapa0 = JSON.stringify(mapa);
  if (rm.estado !== "ok") alertas.push("etoro-mapa no se pudo leer: hoy no se guarda el mapa.");
  const vacio = { libro: null, eventos: [], valuacion: null, mapa, mapaCambio: false, rendimientos: null, composicion: null, punto: null, ops: {}, llamadasFmp: 0, bloqueos: { mapa: mapaBloqueado, ordenes: bloqueoOrdenes } };
  if (rl.estado !== "ok" || (prep.bloqueos && prep.bloqueos.libro)) {
    alertas.push("cartera-libro no se pudo leer: sin conciliación ni valuación hoy.");
    return fin(3, "sin_libro", Object.assign({ estado: "sin_libro", alertas }, vacio));
  }
  // N7: una ejecución abierta que llegó dañada puede llevar dinero ya enviado: sin ella el libro miente → hoy no se concilia
  // ni se escribe el libro (la fecha sigue en ejecucionesAbiertas para mañana)
  if (danados.some(id => id.startsWith("ejecucion-"))) {
    alertas.push("Sin conciliación ni valuación hoy: una ejecución abierta llegó dañada (se reintenta mañana).");
    return fin(3, "sin_libro", Object.assign({ estado: "sin_libro", alertas }, vacio));
  }
  const conv = libroDeDb(rl.doc), libro0 = conv.libro;
  alertas.push(...conv.alertas);
  vacio.libro = libro0;
  const et = crearEToro({ transporte: transporteEToro || transporteCurl() });
  let portafolio;
  try { portafolio = await et.portafolio(); }
  catch (e) {
    reg.error("eToro no respondió al portafolio", { codigo: e.codigo, http: e.http });
    alertas.push(`eToro no disponible (${e.codigo || "error"}): sin conciliación ni valuación hoy.`);
    return fin(3, "sin_etoro", Object.assign({ estado: "sin_etoro", alertas }, vacio));
  }
  const cp = portafolio.clientPortfolio || {};
  // órdenes que ya no están en cola ni como posición: se consulta su estado
  const cola = new Set((cp.ordersForOpen || []).map(o => o.orderID)), conPos = new Set((cp.positions || []).map(p => p.orderID));
  const ordenes = {};
  for (const p of libro0.pendientes) if (p.lado === "compra" && p.orderId && !cola.has(p.orderId) && !conPos.has(p.orderId)) {
    try { ordenes[p.orderId] = await et.orden(p.orderId); } catch (e) { reg.aviso("orden() falló", { orderId: p.orderId, codigo: e.codigo }); }
  }
  const abiertas = ejecucionesAbiertas(dir);
  let historial = [];
  if (libro0.posiciones.some(p => p.lotes.length) || libro0.pendientes.some(p => p.lado === "venta") || abiertas.length) {
    const desde = [libro0.mandato.inicio, sumarDias(hoy, -30)].sort()[1];
    try { const h = await et.historial(desde); historial = Array.isArray(h) ? h : []; }
    catch (e) { alertas.push(`Historial de eToro no disponible (${e.codigo}).`); }
  }
  const ids = new Set([3000, 63]);
  for (const p of libro0.posiciones) ids.add(p.instrumentId);
  for (const p of libro0.pendientes) ids.add(p.instrumentId);
  for (const e of abiertas) for (const l of e.doc.lineas || []) if (Number.isSafeInteger(l.i)) ids.add(l.i);
  let tasas;
  try { tasas = await et.tasas([...ids]); }
  catch (e) {
    alertas.push(`Precios de eToro no disponibles (${e.codigo}): sin valuación hoy.`);
    return fin(3, "sin_etoro", Object.assign({ estado: "sin_etoro", alertas }, vacio));
  }
  // entradas malas de db (lotes, pend, ops): se descartan con alerta y el día cierra degradado (H15)
  const malas = conv.alertas.slice();
  const bids = bidsDe(tasas), opsDocs = opsLeidas(dir), feriados = feriadosDe(dir, hoy);
  for (const [f, d] of Object.entries(opsDocs)) opsDocs[f] = Object.assign({}, d, { ops: opsValidas(d, malas) });
  alertas.push(...malas.slice(conv.alertas.length));
  // ejecuciones abiertas de días anteriores (o de una sesión de hoy que murió): primero, para que sus líneas entren al libro
  let libroE = libro0;
  const ejecuciones = {};
  for (const { f, doc } of abiertas) {
    const ce = conciliarEjecucion({ libro: libroE, doc, opsDoc: opsDocs[f] || opsNuevo(f), portafolio, historial, bids, ahora: t, feriados });
    libroE = ce.libro; opsDocs[f] = ce.ops; ejecuciones[f] = ce.doc;
    const n = ce.doc.res.reduce((m, r) => ((m[r.est] = (m[r.est] || 0) + 1), m), {});
    alertas.push(`Ejecución del ${f} conciliada sin diario: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(", ")}.`);
  }
  const opsTodas = Object.values(opsDocs).flatMap(d => d.ops);
  const conc = conciliar({ libro: libroE, portafolio, historial, ahora: t, ordenes, ops: opsTodas, bids, feriados });
  alertas.push(...conc.alertas);
  const ev = aplicarEventosOps({ docs: opsDocs, eventos: conc.eventos, ahora: t });
  alertas.push(...ev.alertas);

  // tipo de cambio: Radar → FMP → eToro (§5.8); si Radar y eToro difieren > 2 %, manda eToro (§I, N6)
  let fx = null, llamadasFmp = 0;
  const b63 = bids[63], fxEToro = b63 && isNum(b63.bid) && isNum(b63.ask) && b63.bid > 0 ? fx4((b63.bid + b63.ask) / 2) : null;
  const filaFx = out && (out.rows || []).find(r => r.symbol === "USDMXN");
  if (filaFx && isNum(filaFx.price)) fx = { valor: filaFx.price, fuente: "radar" };
  if (fx && fxEToro && Math.abs(fx.valor / fxEToro - 1) > 0.02) {
    alertas.push(`Tipo de cambio del Radar (${fx.valor}) y de eToro (${fxEToro}) difieren más de 2 %: se usa el de eToro.`);
    fx = { valor: fxEToro, fuente: "etoro" };
  }
  if (!fx) {
    const fmp = crearFmp({ transporte: transporteFmp || transporteCurl(), ahora, registro: reg });
    try { const q = await fmp.get("/stable/quote", { symbol: "USDMXN" }); const p = Array.isArray(q) && q[0] ? q[0].price : null; if (isNum(p) && p > 0) fx = { valor: p, fuente: "fmp" }; }
    catch (e) { reg.aviso("FMP sin tipo de cambio", { code: e.code }); }
    llamadasFmp = fmp.cuenta().total;
  }
  if (!fx && fxEToro) fx = { valor: fxEToro, fuente: "etoro" };
  if (!fx) alertas.push("Sin tipo de cambio USD/MXN: valores en pesos no disponibles.");
  const valuacion = valuar({ libro: conc.libro, tasas, fx, at: t });
  alertas.push(...valuacion.alertas); delete valuacion.alertas;
  conc.libro.precios = valuacion.precios;

  // asignación símbolo → instrumento para el objetivo del día (§5.7.1)
  if (out && fx && rm.estado === "ok") {
    const { C } = pagina || cargarPagina();
    const obj = objetivoDelDia({ C, out, perfil: config.perfil, valorUSD: valuacion.valorUSD, fx: fx.valor, cetesPct: null, nowMs: t });
    for (const sym of Object.keys(obj.pesos)) {
      const m = mapa.instrumentos[sym];
      if (m && m.verificadoEl && diasEntre(m.verificadoEl, hoy) <= 30) continue;
      const fila = (out.rows || []).find(r => r.symbol === sym);
      if (!fila) { if (!m) alertas.push(`${sym} entra por respaldo sin asignación en eToro`); continue; }
      try {
        const v = await verificarSimbolo({ et, sym, precioRadar: fila.price, mercadoAbierto: !!(prep.mercado && prep.mercado.abierto), tolPct: config.tolPrecioPct, hoy });
        if (v.ok) { mapa.instrumentos[sym] = v.asignacion; if (v.rechazados.length) mapa.rechazados[sym] = v.rechazados; else delete mapa.rechazados[sym]; }
        else { delete mapa.instrumentos[sym]; mapa.rechazados[sym] = v.rechazados; alertas.push(`${sym} sin instrumento verificado en eToro`); }
      } catch (e) { alertas.push(`${sym}: no se pudo verificar en eToro (${e.codigo || "error"})`); }
    }
  }

  // punto del día y rendimientos por referencias (§E.5.3, §E.5.5)
  let punto = null, rend = null;
  const refs = conc.libro.refs;
  if (fx && refs && Array.isArray(refs.dia)) {
    const ix = indicesDelDia({ refs, v: valuacion.valorUSD, fx: fx.valor, fl: 0 });
    punto = { kind: "carteraPunto", v: 1, f: hoy, t: et0.hora, v_: usd(valuacion.valorUSD), vm: usd(ix.vm), e: usd(valuacion.efectivoUSD), fx: fx4(fx.valor), spy: valuacion.spyUSD === null ? null : px(valuacion.spyUSD),
      i: i8(ix.i), im: ix.im === null ? null : i8(ix.im), fl: 0 };
    rend = rendimientosRefs({ refs, punto: { f: hoy, v: punto.v_, vm: punto.vm, spy: punto.spy, i: punto.i, im: punto.im } });
  }
  const filas = {};
  for (const r of (out && out.rows) || []) filas[r.symbol] = r;
  const comp = composicion({ valuacion, libro: conc.libro, filas });
  const opsTocados = Object.fromEntries([...new Set(ev.tocados.concat(Object.keys(ejecuciones)))].sort().map(f => [f, ev.docs[f]]));
  return fin(0, "listo", { estado: "listo", libro: conc.libro, eventos: conc.eventos, alertas, valuacion, mapa, mapaCambio: JSON.stringify(mapa) !== mapa0,
    rendimientos: rend, composicion: comp, punto, ops: opsTocados, ejecuciones, llamadasFmp, bloqueos: { mapa: mapaBloqueado, ordenes: bloqueoOrdenes }, datosMalos: malas.length });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
