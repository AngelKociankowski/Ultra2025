// Paso 5 · Cartera (12-plan §5.2, §5.7.1, §5.8, §5.13): conciliación con eToro Demo, valuación, asignación de
// instrumentos, punto de la serie y rendimientos. Solo lecturas (GET) a eToro. Uso: node bin/20-cartera.mjs --dir <carpeta>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo, rutas } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { crearEToro } from "../lib/etoro.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { conciliar, valuar, bidsDe } from "../lib/libro.mjs";
import { rendimientos, composicion } from "../lib/rendimientos.mjs";
import { objetivoDelDia, configEfectiva } from "../lib/reglas.mjs";
import { fechaHoraET, sumarDias, diasEntre } from "../lib/tiempo.mjs";

const PASO = "20-cartera";
const AYUDA = "Uso: node bin/20-cartera.mjs --dir <carpeta>";
const isNum = v => typeof v === "number" && Number.isFinite(v);
const copia = o => JSON.parse(JSON.stringify(o));

function opsLeidas(dir) {
  const db = rutas(dir).entradaDb, out = {};
  let nombres = [];
  try { nombres = fs.readdirSync(db).filter(f => /^operaciones-\d{4}-\d{2}(-2)?\.json$/.test(f)); } catch (e) { nombres = []; }
  for (const f of nombres) { const r = leerDoc(dir, f.slice(0, -5)); if (r.estado === "ok") out[f.slice(0, -5)] = r.doc; }
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

export async function main(argv, { transporteEToro = null, transporteFmp = null, ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json");
  if (!prep) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
  const analisis = leerTrabajo(dir, "analisis.json"), out = analisis && analisis.out ? analisis.out : null;
  const config = prep.config || configEfectiva(leerDoc(dir, "rutina-config").doc).config;
  const t = ahora(), et0 = fechaHoraET(t), hoy = prep.fechaET || et0.fecha, anio = hoy.slice(0, 4);
  const alertas = [];
  const fin = (codigo, accion, cuerpo) => {
    escribirTrabajo(dir, "cartera.json", cuerpo);
    reg.info(`cartera: ${accion}`, { alertas: cuerpo.alertas.length });
    return { codigo, linea: lineaPaso({ paso: PASO, ok: codigo === 0, accion, resumen: { valorUSD: cuerpo.valuacion ? cuerpo.valuacion.valorUSD : null, alertas: cuerpo.alertas.length, eventos: cuerpo.eventos.length } }) };
  };

  const rl = leerDoc(dir, "cartera-libro");
  const rm = leerDoc(dir, "etoro-mapa");
  const mapa = rm.estado === "ok" ? copia(rm.doc) : { kind: "etoroMapa", v: 1, at: t, instrumentos: {}, rechazados: {} };
  if (rm.estado === "fallo") alertas.push("etoro-mapa no se pudo leer: hoy no se guarda el mapa.");
  const vacio = { libro: rl.doc, eventos: [], valuacion: null, mapa, rendimientos: null, composicion: null, puntoSerie: null, serie: null, llamadasFmp: 0,
    bloqueos: { mapa: rm.estado === "fallo", serie: true } };
  if (rl.estado !== "ok" || (prep.bloqueos && prep.bloqueos.libro)) {
    alertas.push("cartera-libro no se pudo leer: sin conciliación ni valuación hoy.");
    return fin(3, "sin_libro", Object.assign({ estado: "sin_libro", alertas }, vacio));
  }
  const et = crearEToro({ transporte: transporteEToro || transporteCurl() });
  let portafolio;
  try { portafolio = await et.portafolio(); }
  catch (e) {
    reg.error("eToro no respondió al portafolio", { codigo: e.codigo, http: e.http });
    alertas.push(`eToro no disponible (${e.codigo || "error"}): sin conciliación ni valuación hoy.`);
    return fin(3, "sin_etoro", Object.assign({ estado: "sin_etoro", alertas }, vacio));
  }
  const libro0 = rl.doc, cp = portafolio.clientPortfolio || {};
  // órdenes que ya no están en cola ni como posición: se consulta su estado
  const cola = new Set((cp.ordersForOpen || []).map(o => o.orderID)), conPos = new Set((cp.positions || []).map(p => p.orderID));
  const ordenes = {};
  for (const p of libro0.pendientes) if (p.lado === "compra" && p.orderId && !cola.has(p.orderId) && !conPos.has(p.orderId)) {
    try { ordenes[p.orderId] = await et.orden(p.orderId); } catch (e) { reg.aviso("orden() falló", { orderId: p.orderId, codigo: e.codigo }); }
  }
  let historial = [];
  const hayLotes = libro0.posiciones.some(p => p.lotes.length);
  if (hayLotes) {
    const desde = [libro0.mandato.inicio, sumarDias(hoy, -30)].sort()[1];
    try { const h = await et.historial(desde); historial = Array.isArray(h) ? h : []; }
    catch (e) { alertas.push(`Historial de eToro no disponible (${e.codigo}).`); }
  }
  const ids = new Set([3000, 63]);
  for (const p of libro0.posiciones) ids.add(p.instrumentId);
  for (const p of libro0.pendientes) ids.add(p.instrumentId);
  let tasas;
  try { tasas = await et.tasas([...ids]); }
  catch (e) {
    alertas.push(`Precios de eToro no disponibles (${e.codigo}): sin valuación hoy.`);
    return fin(3, "sin_etoro", Object.assign({ estado: "sin_etoro", alertas }, vacio));
  }
  const bids = bidsDe(tasas);
  const ops = Object.values(opsLeidas(dir)).flatMap(d => d.ops || []);
  const conc = conciliar({ libro: libro0, portafolio, historial, ahora: t, planRecuperado: prep.recuperacion || null, ordenes, ops, bids });
  alertas.push(...conc.alertas);

  // tipo de cambio: Radar → FMP → eToro (§5.8)
  let fx = null, llamadasFmp = 0;
  const filaFx = out && (out.rows || []).find(r => r.symbol === "USDMXN");
  if (filaFx && isNum(filaFx.price)) fx = { valor: filaFx.price, fuente: "radar" };
  if (!fx) {
    const fmp = crearFmp({ transporte: transporteFmp || transporteCurl(), ahora, registro: reg });
    try { const q = await fmp.get("/stable/quote", { symbol: "USDMXN" }); const p = Array.isArray(q) && q[0] ? q[0].price : null; if (isNum(p)) fx = { valor: p, fuente: "fmp" }; }
    catch (e) { reg.aviso("FMP sin tipo de cambio", { code: e.code }); }
    llamadasFmp = fmp.cuenta().total;
  }
  if (!fx && bids[63] && isNum(bids[63].bid) && isNum(bids[63].ask)) fx = { valor: Math.round((bids[63].bid + bids[63].ask) / 2 * 1e4) / 1e4, fuente: "etoro" };
  if (!fx) alertas.push("Sin tipo de cambio USD/MXN: valores en pesos no disponibles.");
  const valuacion = valuar({ libro: conc.libro, tasas, fx, at: t });
  alertas.push(...valuacion.alertas); delete valuacion.alertas;

  // asignación símbolo → instrumento para el objetivo del día (§5.7.1)
  if (out && fx) {
    const pref = leerDoc(dir, "preferencias").doc, cetesPct = pref && pref.portafolio && isNum(pref.portafolio.cetesPct) ? pref.portafolio.cetesPct : null;
    const { C } = cargarPagina();
    const obj = objetivoDelDia({ C, out, perfil: config.perfil, valorUSD: valuacion.valorUSD, fx: fx.valor, cetesPct, nowMs: t });
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
    mapa.at = t;
  }

  // serie del año y rendimientos (§5.9.4, §5.13.1)
  const rs = leerDoc(dir, `cartera-serie-${anio}`);
  let serie = null, bloqueoSerie = rs.estado === "fallo" || !!(prep.bloqueos && prep.bloqueos.serie);
  if (rs.estado === "ok") serie = copia(rs.doc);
  else if (rs.estado === "no_existe") {
    const prev = leerDoc(dir, `cartera-serie-${Number(anio) - 1}`);
    if (prev.estado === "ok") { // enero: mismo base; el último punto del año anterior queda como referencia del rendimiento del año
      const ult = (prev.doc.puntos || []).slice(-1);
      serie = { kind: "carteraSerie", v: 1, anio: Number(anio), at: t, base: prev.doc.base, puntos: ult };
    } else {
      const m = conc.libro.mandato;
      serie = { kind: "carteraSerie", v: 1, anio: Number(anio), at: t, base: { fecha: m.inicio, valorUSD: m.capitalBaseUSD, valorMXN: m.capitalBaseMXN, fx: m.fxInicio, spy: null }, puntos: [] };
      alertas.push(`No existía cartera-serie-${anio}: se abre con la base del mandato (SPY de la base desconocido).`);
    }
  }
  if (bloqueoSerie) alertas.push(`cartera-serie-${anio} no se pudo leer: hoy no se guarda el punto de la serie.`);
  const puntoSerie = { f: hoy, h: et0.hora, v: valuacion.valorUSD, e: valuacion.efectivoUSD, fx: fx ? fx.valor : null, spy: valuacion.spyUSD, fl: 0 };
  let rend = null;
  if (serie && fx) {
    rend = rendimientos({ serie, punto: puntoSerie });
    serie.puntos = (serie.puntos || []).filter(p => p.f !== hoy).concat([puntoSerie]).sort((x, y) => (x.f < y.f ? -1 : 1));
    serie.at = t;
  }
  const filas = {};
  for (const r of (out && out.rows) || []) filas[r.symbol] = r;
  const comp = composicion({ valuacion, libro: conc.libro, filas });
  return fin(0, "listo", { estado: "listo", libro: conc.libro, eventos: conc.eventos, alertas, valuacion, mapa, rendimientos: rend, composicion: comp, puntoSerie,
    serie, llamadasFmp, bloqueos: { mapa: rm.estado === "fallo", serie: bloqueoSerie || !serie || !fx } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
