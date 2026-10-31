// Libro del mandato "Cartera Radar" (12-plan §5.8; 12b §E.5.3–§E.5.10, §E.11, §I). Puro: no habla con la red.
// En memoria se usa la forma expandida (posiciones/lotes/pendientes); en db, la compacta v2 (libroADb / libroDeDb).
import { CONFIG_DEFECTO } from "./constantes.mjs";
import { fechaHoraET, diasHabilesEntre, aperturaParaOrden } from "./tiempo.mjs";
import { usd, u6, precio as px, ts } from "./db.mjs";

export const MANDATO = Object.freeze({ inicio: "2026-10-30", baseMXN: 600000, fx0: 18.774, baseUSD: 31959.09, perfil: "moderado" });
// Base de rendimientos (cierre del 30-oct): [f, v, vm, spy, i, im]
export const REF_BASE = Object.freeze(["2026-10-30", 31959.09, 600000, 755.26, 1, 1]);
// Las 5 órdenes del 30-oct (00j; respuesta real de portfolio guardada el 30-oct). SPY va en dos órdenes.
const ORDENES_INICIALES = Object.freeze([
  { id: "2026-10-30-SPY-INICIAL-1", o: 391213449, sym: "SPY", i: 3000, usd: 500.00, env: "2026-10-30T21:08:20Z" },
  { id: "2026-10-30-SPY-INICIAL-2", o: 391187994, sym: "SPY", i: 3000, usd: 20273.09, env: "2026-10-30T22:18:07Z" },
  { id: "2026-10-30-DIA-INICIAL", o: 391187995, sym: "DIA", i: 3026, usd: 6164.71, env: "2026-10-30T22:18:08Z" },
  { id: "2026-10-30-XLF-INICIAL", o: 391213506, sym: "XLF", i: 3004, usd: 3132.01, env: "2026-10-30T22:18:08Z" },
  { id: "2026-10-30-XLE-INICIAL", o: 391187996, sym: "XLE", i: 3008, usd: 1888.72, env: "2026-10-30T22:18:08Z" },
]);
const MOTIVO_INICIAL = "Cartera inicial: buildPortfolio Moderado del 30-oct (600 000 MXN a 18.774)";
// Asignación verificada el 30-oct (12-plan §5.7.1): [sym, instrumentId, clase, verificadoEl, difPct]. GLD sin precio eToro guardado.
const MAPA_SEMILLA = Object.freeze([
  ["SPY", 3000, 6, "2026-10-30", -0.01], ["DIA", 3026, 6, "2026-10-30", 0], ["XLF", 3004, 6, "2026-10-30", 0], ["XLE", 3008, 6, "2026-10-30", 0],
  ["TLT", 3020, 6, "2026-10-30", 0], ["GLD", 3025, 6, null, null], ["QQQ", 3006, 6, "2026-10-30", 0], ["IWM", 3005, 6, "2026-10-30", 0],
  ["VWO", 4252, 6, "2026-10-30", 0], ["EFA", 3009, 6, "2026-10-30", 0], ["XLK", 3021, 6, "2026-10-30", 0], ["SLV", 4430, 6, "2026-10-30", 0],
  ["USDMXN", 63, 1, "2026-10-30", null],
]);

export const cts = x => Math.round(x * 100) / 100;
const seis = x => Math.floor(x * 1e6 + 1e-6) / 1e6;
const copia = o => JSON.parse(JSON.stringify(o));
const isNum = v => typeof v === "number" && Number.isFinite(v);
const num = (...vs) => { for (const v of vs) if (isNum(v)) return v; return null; };
const esFecha = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Semilla (12b §E.11): 5 documentos nuevos en forma de db (sin h; lo pone lib/db.mjs al armar el grupo)
export function semilla({ ahora = Date.now } = {}) {
  const at = ts(ahora());
  const efectivo = usd(MANDATO.baseUSD - ORDENES_INICIALES.reduce((a, o) => a + o.usd, 0));
  const pend = ORDENES_INICIALES.map(o => ({ id: o.id, dia: "2026-10-30", sym: o.sym, i: o.i, lado: "c", o: o.o, usd: o.usd, u: null, pos: null, env: o.env, est: "aceptada" }));
  const refs = { base: REF_BASE.slice(), dia: REF_BASE.slice(), sem: REF_BASE.slice(), mes: REF_BASE.slice(), anio: REF_BASE.slice() };
  const libro = { kind: "carteraLibro", v: 2, at, mandato: Object.assign({}, MANDATO), efectivo, realizado: 0, lotes: [], pend, fuera: {}, precios: {}, refs };
  const ops = { kind: "carteraOps", v: 2, f: "2026-10-30", ops: ORDENES_INICIALES.map(o => ({ id: o.id, sym: o.sym, i: o.i, lado: "c", regla: "INICIAL", mot: MOTIVO_INICIAL,
    usd: o.usd, u: null, est: "aceptada", o: o.o, pos: [], px: null, uej: null, usdej: null, real: null, env: o.env, err: null, not: [], sim: false })) };
  const mapa = { kind: "etoroMapa", v: 2, at, i: Object.fromEntries(MAPA_SEMILLA.map(([sym, id, clase, f, d]) => [sym, [id, clase, f, d]])), rech: { DIA: [[100580, "clase 10"]] } };
  const config = Object.assign({ kind: "rutinaConfig", v: 2, at }, copia(CONFIG_DEFECTO));
  const punto = { kind: "carteraPunto", v: 1, f: "2026-10-30", t: "16:00", v_: MANDATO.baseUSD, vm: MANDATO.baseMXN, e: efectivo, fx: MANDATO.fx0, spy: 755.26, i: 1, im: 1, fl: 0 };
  return { "rutina-config": config, "cartera-libro": libro, "etoro-mapa": mapa, "ops-2026-10-30": ops, "punto-2026-10-30": punto };
}

// ---- forma de db ↔ forma de trabajo ----
const LADO = { c: "compra", v: "venta" }, LADO_DB = { compra: "c", venta: "v" };
// db v2 → memoria; las entradas malformadas se descartan con alerta (H15)
export function libroDeDb(doc) {
  const alertas = [], posiciones = [];
  for (const l of Array.isArray(doc.lotes) ? doc.lotes : []) {
    if (!Array.isArray(l) || l.length !== 7 || typeof l[0] !== "string" || !isNum(l[1]) || !isNum(l[2]) || !isNum(l[4]) || !isNum(l[5])) { alertas.push(`Lote mal formado en cartera-libro: ${JSON.stringify(l).slice(0, 60)}; se ignora.`); continue; }
    let p = posiciones.find(x => x.sym === l[0]);
    if (!p) { p = { sym: l[0], instrumentId: l[1], lotes: [] }; posiciones.push(p); }
    p.lotes.push({ positionId: l[2], orderId: isNum(l[3]) ? l[3] : null, unidades: l[4], costoUSD: l[5], abiertaEl: String(l[6] || "") });
  }
  const pendientes = [];
  for (const x of Array.isArray(doc.pend) ? doc.pend : []) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || typeof x.sym !== "string" || !isNum(x.i) || !LADO[x.lado] || !["aceptada", "incierta"].includes(x.est)) { alertas.push(`Pendiente mal formado en cartera-libro: ${JSON.stringify(x).slice(0, 60)}; se ignora.`); continue; }
    pendientes.push({ opId: x.id, dia: esFecha(x.dia) ? x.dia : x.id.slice(0, 10), orderId: isNum(x.o) ? x.o : null, sym: x.sym, instrumentId: x.i, lado: LADO[x.lado],
      montoUSD: isNum(x.usd) ? x.usd : null, unidades: isNum(x.u) ? x.u : null, positionId: isNum(x.pos) ? x.pos : null, enviadaEl: String(x.env || ""), estado: x.est });
  }
  const fueraDelObjetivo = {};
  for (const [sym, v] of Object.entries(doc.fuera || {})) if (Array.isArray(v) && esFecha(v[0]) && Number.isInteger(v[1])) fueraDelObjetivo[sym] = { desde: v[0], dias: v[1] };
  const refs = copia(doc.refs);
  return { libro: { mandato: copia(doc.mandato), efectivoUSD: doc.efectivo, realizadoUSD: doc.realizado, posiciones, pendientes, fueraDelObjetivo,
    precios: copia(doc.precios || {}), refs, ultimaRutina: refs && refs.dia ? refs.dia[0] : null }, alertas };
}
export function libroADb(L, atMs) {
  const lotes = [];
  for (const p of L.posiciones) for (const l of p.lotes) lotes.push([p.sym, p.instrumentId, l.positionId, l.orderId ?? null, u6(l.unidades), usd(l.costoUSD), ts(Date.parse(l.abiertaEl)) || l.abiertaEl || null]);
  const pend = L.pendientes.map(x => ({ id: x.opId, dia: x.dia || x.opId.slice(0, 10), sym: x.sym, i: x.instrumentId, lado: LADO_DB[x.lado], o: x.orderId ?? null,
    usd: x.montoUSD === null || x.montoUSD === undefined ? null : usd(x.montoUSD), u: x.unidades === null || x.unidades === undefined ? null : u6(x.unidades), pos: x.positionId ?? null,
    env: ts(Date.parse(x.enviadaEl)) || x.enviadaEl || null, est: x.estado === "incierta" ? "incierta" : "aceptada" }));
  const fuera = Object.fromEntries(Object.entries(L.fueraDelObjetivo || {}).map(([s, v]) => [s, [v.desde, v.dias]]));
  const precios = Object.fromEntries(Object.entries(L.precios || {}).map(([s, v]) => [s, [px(v[0]), v[1]]]));
  return { kind: "carteraLibro", v: 2, at: ts(atMs), mandato: copia(L.mandato), efectivo: usd(L.efectivoUSD), realizado: usd(L.realizadoUSD), lotes, pend, fuera, precios, refs: copia(L.refs) };
}
// etoro-mapa v2 ↔ memoria ({ instrumentos: { sym: {instrumentId, clase, verificadoEl, difPct} }, rechazados })
export function mapaDeDb(doc) {
  const instrumentos = {}, rechazados = {};
  for (const [sym, v] of Object.entries((doc && doc.i) || {})) if (Array.isArray(v) && isNum(v[0])) instrumentos[sym] = { instrumentId: v[0], clase: v[1], verificadoEl: v[2] || null, difPct: isNum(v[3]) ? v[3] : null };
  for (const [sym, v] of Object.entries((doc && doc.rech) || {})) if (Array.isArray(v)) rechazados[sym] = v.filter(Array.isArray).map(([instrumentId, motivo]) => ({ instrumentId, motivo }));
  return { instrumentos, rechazados };
}
export function mapaADb(m, atMs) {
  return { kind: "etoroMapa", v: 2, at: ts(atMs), i: Object.fromEntries(Object.entries(m.instrumentos).map(([s, x]) => [s, [x.instrumentId, x.clase, x.verificadoEl || null, isNum(x.difPct) ? x.difPct : null]])),
    rech: Object.fromEntries(Object.entries(m.rechazados || {}).map(([s, l]) => [s, l.map(r => [r.instrumentId ?? null, String(r.motivo).slice(0, 40)])])) };
}
// ops-<f>: entradas válidas (H15) y documento nuevo
export function opsValidas(doc, alertas = []) {
  return (Array.isArray(doc && doc.ops) ? doc.ops : []).filter(o => {
    const ok = o && typeof o === "object" && typeof o.id === "string" && typeof o.sym === "string" && (o.lado === "c" || o.lado === "v") && typeof o.est === "string";
    if (!ok) alertas.push(`Operación mal formada en ops-${doc.f}: ${JSON.stringify(o).slice(0, 60)}; se ignora.`);
    return ok;
  });
}
export const opsNuevo = f => ({ kind: "carteraOps", v: 2, f, ops: [] });

// ---- lecturas auxiliares de respuestas de eToro (formas observadas el 30-oct; las de posiciones se fijan en T09b) ----
const cpDe = portafolio => (portafolio && portafolio.clientPortfolio) || portafolio || {};
const posId = p => num(p.positionID, p.positionId, p.PositionID);
const ordId = p => num(p.orderID, p.orderId, p.OrderID);
const instId = p => num(p.instrumentID, p.instrumentId, p.InstrumentID);
export function bidsDe(tasas) {
  const rows = Array.isArray(tasas) ? tasas : tasas && Array.isArray(tasas.rates) ? tasas.rates : [];
  const m = {};
  for (const r of rows) { const id = instId(r); if (id !== null) m[id] = { bid: num(r.bid), ask: num(r.ask), date: r.date || null }; }
  return m;
}
function filaHistorial(historial, positionId) {
  for (const h of Array.isArray(historial) ? historial : []) if (h && num(h.positionId, h.positionID, h.PositionID) === positionId) return h;
  return null;
}
const precioCierre = h => (h ? num(h.closeRate, h.CloseRate, h.closePrice) : null);

function quitarUnidades(L, sym, positionId, unidades) {
  const p = L.posiciones.find(x => x.sym === sym) || L.posiciones.find(x => x.lotes.some(l => l.positionId === positionId));
  if (!p) return null;
  const i = p.lotes.findIndex(l => l.positionId === positionId);
  if (i < 0) return null;
  const l = p.lotes[i], u = Math.min(unidades === null ? l.unidades : unidades, l.unidades);
  const costoUnit = l.unidades > 0 ? l.costoUSD / l.unidades : 0;
  const costo = cts(costoUnit * u);
  if (u >= l.unidades - 1e-9) p.lotes.splice(i, 1); else { l.unidades = seis(l.unidades - u); l.costoUSD = cts(l.costoUSD - costo); }
  if (!p.lotes.length) L.posiciones.splice(L.posiciones.indexOf(p), 1);
  return { unidades: u, costoUSD: costo, costoUnit };
}
function agregarLote(L, { sym, instrumentId, positionId, orderId, unidades, costoUSD, abiertaEl }) {
  let p = L.posiciones.find(x => x.sym === sym);
  if (!p) { p = { sym, instrumentId, lotes: [] }; L.posiciones.push(p); }
  if (L.posiciones.some(x => x.lotes.some(l => l.positionId === positionId))) return false;
  p.lotes.push({ positionId, orderId: orderId ?? null, unidades, costoUSD: cts(costoUSD), abiertaEl: abiertaEl || null });
  return true;
}
function registrarVenta(L, { sym, positionId, unidades, precio }) {
  const q = quitarUnidades(L, sym, positionId, unidades);
  if (!q) return null;
  const monto = cts(q.unidades * precio), realizado = cts(monto - q.costoUSD);
  L.efectivoUSD = cts(L.efectivoUSD + monto); L.realizadoUSD = cts(L.realizadoUSD + realizado);
  return { unidades: q.unidades, montoUSD: monto, realizadoUSD: realizado, precio };
}

// ordenes: { [orderId]: respuesta de orden(orderId) } para pendientes que ya no están ni en cola ni como posición.
// ops: operaciones conocidas (regla 2 de pertenencia). bids: { instrumentId: {bid} } para cierres sin fila en historial.
// feriados: filas NYSE de los años en juego (plazos de 12b §F.7 en días hábiles).
// La recuperación de ejecuciones abiertas (ejecucion-<f>) va aparte: conciliarEjecucion (12b §F.5).
export const VENTANA_ANTES_MS = 120000, VENTANA_DESPUES_MS = 600000, DIAS_INCIERTA = 3;
export function conciliar({ libro, portafolio, historial, ahora, ordenes = {}, ops = [], bids = {}, feriados = [] }) {
  const L = copia(libro), eventos = [], alertas = [];
  const t = typeof ahora === "function" ? ahora() : ahora, hoy = fechaHoraET(t).fecha;
  const diaDe = p => p.dia || String(p.enviadaEl).slice(0, 10) || hoy;
  const cp = cpDe(portafolio), posiciones = Array.isArray(cp.positions) ? cp.positions : [], enCola = Array.isArray(cp.ordersForOpen) ? cp.ordersForOpen : [];
  const colaIds = new Set(enCola.map(ordId).filter(x => x !== null));
  const bidDe = id => (bids[id] && isNum(bids[id].bid) && bids[id].bid > 0 ? bids[id].bid : null);

  const lotes = () => L.posiciones.flatMap(p => p.lotes.map(l => ({ p, l })));
  const opsOrden = new Set((Array.isArray(ops) ? ops : []).map(o => o && (o.o ?? o.orderId)).filter(x => x !== null && x !== undefined));
  const asignadas = new Set(lotes().map(x => x.l.positionId));

  // 1. Compras pendientes
  for (const pend of L.pendientes.filter(p => p.lado === "compra")) {
    let match = posiciones.filter(x => !asignadas.has(posId(x)) && pend.orderId !== null && ordId(x) === pend.orderId);
    if (!match.length) { // regla 3 (H21): sin orderId o la posición no lo trae → instrumento, ventana [env − 120 s, env + 10 min] y monto ±1 %;
      // una orden enviada con el mercado cerrado se llena a la apertura siguiente: la ventana cierra 10 min después de esa apertura
      const env = Date.parse(pend.enviadaEl), hasta = Number.isFinite(env) ? Math.max(env, aperturaParaOrden(env, feriados) || env) + VENTANA_DESPUES_MS : NaN;
      const c = posiciones.find(x => !asignadas.has(posId(x)) && (ordId(x) === null || pend.orderId === null) && instId(x) === pend.instrumentId
        && Number.isFinite(env) && Date.parse(x.openDateTime) >= env - VENTANA_ANTES_MS && Date.parse(x.openDateTime) <= hasta
        && isNum(x.amount) && isNum(pend.montoUSD) && Math.abs(x.amount / pend.montoUSD - 1) <= 0.01);
      if (c) match = [c];
    }
    if (match.length) {
      const posIds = [];
      let u = 0, costo = 0;
      for (const x of match) {
        agregarLote(L, { sym: pend.sym, instrumentId: pend.instrumentId, positionId: posId(x), orderId: pend.orderId !== null ? pend.orderId : ordId(x), unidades: num(x.units), costoUSD: num(x.amount, pend.montoUSD), abiertaEl: x.openDateTime || pend.enviadaEl || null });
        asignadas.add(posId(x)); posIds.push(posId(x)); u += num(x.units) || 0; costo += num(x.amount, pend.montoUSD) || 0;
      }
      L.pendientes.splice(L.pendientes.indexOf(pend), 1);
      eventos.push({ tipo: "ejecutada", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym, positionIds: posIds,
        ejecucion: { precio: u > 0 ? Math.round(costo / u * 1e4) / 1e4 : null, unidades: seis(u), montoUSD: cts(costo), at: match[0].openDateTime } });
      continue;
    }
    if (pend.orderId !== null && colaIds.has(pend.orderId)) {
      // F.7 (N12): en cola se respeta hasta el día hábil siguiente; después se avisa a diario y al 3.er día hábil se libera
      const n = diasHabilesEntre(diaDe(pend), hoy, feriados);
      pend.estado = "aceptada";
      if (n <= 1) continue;
      if (n < DIAS_INCIERTA) { alertas.push(`Compra de ${pend.sym} del ${diaDe(pend)} sigue en cola en eToro (${n} días hábiles).`); continue; }
      L.efectivoUSD = cts(L.efectivoUSD + pend.montoUSD);
      L.pendientes.splice(L.pendientes.indexOf(pend), 1);
      eventos.push({ tipo: "no_ejecutada", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym, error: `en cola sin llenar ${n} días hábiles` });
      alertas.push(`Compra de ${pend.sym} del ${diaDe(pend)} sigue en cola tras ${n} días hábiles: se da por no ejecutada y vuelven US$ ${cts(pend.montoUSD).toFixed(2)}; cancela la orden ${pend.orderId} a mano en eToro para que no se llene fuera del mandato.`);
      continue;
    }
    const o = pend.orderId !== null ? ordenes[pend.orderId] : null;
    const err = o && (num(o.errorCode) > 0 || (typeof o.errorCode === "string" && o.errorCode && o.errorCode !== "0"));
    const vencida = diasHabilesEntre(diaDe(pend), hoy, feriados) >= DIAS_INCIERTA; // F.7: sin rastro al 3.er día hábil
    if (err || vencida) {
      L.efectivoUSD = cts(L.efectivoUSD + pend.montoUSD);
      L.pendientes.splice(L.pendientes.indexOf(pend), 1);
      const error = err ? `errorCode ${o.errorCode}, statusID ${o.statusID}` : `sin rastro en ${DIAS_INCIERTA} días hábiles`;
      eventos.push({ tipo: "no_ejecutada", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym, error });
      alertas.push(`Compra de ${pend.sym} del ${diaDe(pend)} no se ejecutó (${error}): vuelven US$ ${cts(pend.montoUSD).toFixed(2)} al efectivo.`);
    } else {
      if (pend.estado !== "incierta") eventos.push({ tipo: "incierta", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym });
      pend.estado = "incierta";
    }
  }

  // 2. Ventas (cierres) pendientes
  const vendidas = new Set();
  for (const pend of L.pendientes.filter(p => p.lado === "venta")) {
    const ent = lotes().find(x => x.l.positionId === pend.positionId);
    if (!ent) { L.pendientes.splice(L.pendientes.indexOf(pend), 1); alertas.push(`Cierre pendiente de ${pend.sym} sin lote en el libro (posición ${pend.positionId}).`); continue; }
    const pos = posiciones.find(x => posId(x) === pend.positionId);
    const antes = ent.l.unidades, ahoraU = pos ? num(pos.units) : 0;
    if (pos && !(ahoraU < antes - 1e-9)) {
      // F.5/F.7 (H9): con orden de cierre en cola sigue aceptada; intacta y sin orden al día hábil siguiente → no_ejecutada
      if ((cp.ordersForClose || []).some(x => posId(x) === pend.positionId)) { pend.estado = "aceptada"; pend.enCola = true; continue; }
      if (diasHabilesEntre(diaDe(pend), hoy, feriados) < 1) continue;
      L.pendientes.splice(L.pendientes.indexOf(pend), 1);
      eventos.push({ tipo: "no_ejecutada", lado: "venta", opId: pend.opId, sym: pend.sym, error: "posición intacta y sin orden de cierre" });
      alertas.push(`Cierre de ${pend.sym} del ${diaDe(pend)} no se ejecutó (posición intacta): la regla vuelve a decidir.`);
      continue;
    }
    const h = filaHistorial(historial, pend.positionId), precio = num(precioCierre(h), bidDe(pend.instrumentId));
    if (precio === null) { alertas.push(`Cierre de ${pend.sym} sin precio (ni historial ni bid): se reintenta mañana.`); continue; }
    const r = registrarVenta(L, { sym: pend.sym, positionId: pend.positionId, unidades: cts6(antes - ahoraU), precio });
    L.pendientes.splice(L.pendientes.indexOf(pend), 1);
    vendidas.add(pend.positionId);
    eventos.push({ tipo: "ejecutada", lado: "venta", opId: pend.opId, sym: pend.sym, positionIds: [pend.positionId], fuentePrecio: h ? "historial" : "bid",
      ejecucion: { precio, unidades: r.unidades, montoUSD: r.montoUSD, at: (h && (h.closeTimestamp || h.closeDateTime)) || new Date(t).toISOString() }, realizadoUSD: r.realizadoUSD });
  }

  // 3. Lotes sin posición y sin cierre pendiente → cerrados fuera del sistema; unidades distintas → manda eToro
  for (const { p, l } of lotes()) {
    if (vendidas.has(l.positionId) || L.pendientes.some(x => x.lado === "venta" && x.positionId === l.positionId)) continue;
    const pos = posiciones.find(x => posId(x) === l.positionId);
    if (!pos) {
      const h = filaHistorial(historial, l.positionId), precio = num(precioCierre(h), bidDe(p.instrumentId));
      if (precio === null) { alertas.push(`${p.sym}: la posición ${l.positionId} ya no está en eToro y no hay precio de cierre.`); continue; }
      const r = registrarVenta(L, { sym: p.sym, positionId: l.positionId, unidades: null, precio });
      eventos.push({ tipo: "externa", lado: "venta", sym: p.sym, instrumentId: p.instrumentId, positionIds: [l.positionId], fuentePrecio: h ? "historial" : "bid",
        ejecucion: { precio, unidades: r.unidades, montoUSD: r.montoUSD, at: (h && (h.closeTimestamp || h.closeDateTime)) || new Date(t).toISOString() }, realizadoUSD: r.realizadoUSD });
      alertas.push(`${p.sym}: posición ${l.positionId} cerrada fuera de la rutina.`);
    } else if (isNum(pos.units) && Math.abs(pos.units - l.unidades) > 1e-6) {
      alertas.push(`${p.sym}: eToro reporta ${pos.units} unidades en la posición ${l.positionId}; el libro tenía ${l.unidades}. Se ajusta a eToro.`);
      eventos.push({ tipo: "ajuste", sym: p.sym, positionId: l.positionId, antes: l.unidades, ahora: pos.units });
      l.unidades = pos.units; if (isNum(pos.amount)) l.costoUSD = cts(pos.amount);
    }
  }
  if (opsOrden.size) for (const x of posiciones) if (!asignadas.has(posId(x)) && opsOrden.has(ordId(x)) && !lotes().some(e => e.l.positionId === posId(x))) {
    alertas.push(`Posición ${posId(x)} (orden ${ordId(x)}) aparece en las operaciones sin pendiente: revisar.`);
  }
  for (const x of L.pendientes) alertas.push(alertaPendiente(x));
  return { libro: L, eventos, alertas };
}
const cts6 = x => Math.round(x * 1e6) / 1e6;

// Precio válido (12b §I, H8): número finito > 0 con fecha de hace < 20 min (si se conoce la hora de la valuación).
const VIGENCIA_MS = 20 * 60000;
export function precioValido(b, at) {
  if (!b || !isNum(b.bid) || b.bid <= 0) return false;
  if (at === null || at === undefined) return true;
  const d = Date.parse(b.date);
  return Number.isFinite(d) && Math.abs(at - d) < VIGENCIA_MS;
}
// fx: { valor, fuente }. tasas: respuesta de tasas() o arreglo de rates. Sin precio válido: último válido del libro
// (libro.precios) o costo, con alerta; `precioValido:false` impide órdenes sobre ese símbolo.
export function valuar({ libro, tasas, fx, at = null }) {
  const bids = bidsDe(tasas), posiciones = [], alertas = [], precios = copia(libro.precios || {});
  const hoy = at !== null && at !== undefined ? fechaHoraET(at).fecha : null;
  for (const p of libro.posiciones) {
    if (!p.lotes.length) continue;
    const unidades = cts6(p.lotes.reduce((a, l) => a + l.unidades, 0)), costo = cts(p.lotes.reduce((a, l) => a + l.costoUSD, 0));
    const b = bids[p.instrumentId], valido = precioValido(b, at);
    let pu = null;
    if (valido) { pu = b.bid; if (hoy) precios[p.sym] = [b.bid, hoy]; }
    else if (Array.isArray(precios[p.sym]) && isNum(precios[p.sym][0]) && precios[p.sym][0] > 0) { pu = precios[p.sym][0]; alertas.push(`Precio inválido de eToro para ${p.sym}; se valúa con el de ${precios[p.sym][1]}`); }
    else alertas.push(`Precio inválido de eToro para ${p.sym}; se valúa a costo`);
    const valor = cts(pu === null ? costo : unidades * pu);
    posiciones.push({ sym: p.sym, instrumentId: p.instrumentId, unidades, costoUSD: costo, precioUSD: pu, precioValido: valido, valorUSD: valor, peso: 0,
      gpUSD: cts(valor - costo), gpPct: costo > 0 ? (valor / costo - 1) * 100 : 0, lotes: p.lotes.length });
  }
  for (const s of Object.keys(precios)) if (!libro.posiciones.some(p => p.sym === s && p.lotes.length)) delete precios[s];
  const pendientesUSD = cts(libro.pendientes.filter(x => x.lado === "compra").reduce((a, x) => a + (x.montoUSD || 0), 0));
  const valorUSD = cts(posiciones.reduce((a, x) => a + x.valorUSD, 0) + libro.efectivoUSD + pendientesUSD);
  for (const x of posiciones) x.peso = valorUSD > 0 ? x.valorUSD / valorUSD : 0;
  const fxv = fx && isNum(fx.valor) ? fx.valor : null;
  return { at, fx: fxv, fxFuente: fx ? fx.fuente || null : null, valorUSD, efectivoUSD: libro.efectivoUSD, invertidoUSD: cts(valorUSD - libro.efectivoUSD),
    valorMXN: fxv === null ? null : cts(valorUSD * fxv), posiciones, pendientesUSD, spyUSD: precioValido(bids[3000], at) ? bids[3000].bid : null, precios, alertas };
}

// FIFO por abiertaEl. unidades null o ≥ 99 % del total → cierre total de cada lote.
export function unidadesAVender({ libro, sym, unidades }) {
  const p = libro.posiciones.find(x => x.sym === sym);
  if (!p || !p.lotes.length) return [];
  const lotes = p.lotes.slice().sort((a, b) => (a.abiertaEl < b.abiertaEl ? -1 : a.abiertaEl > b.abiertaEl ? 1 : a.positionId - b.positionId));
  const total = lotes.reduce((a, l) => a + l.unidades, 0);
  if (unidades === null || unidades >= 0.99 * total) return lotes.map(l => ({ positionId: l.positionId, instrumentId: p.instrumentId, unidades: null }));
  const out = [];
  let resto = unidades;
  for (const l of lotes) {
    if (resto <= 1e-9) break;
    const u = Math.min(l.unidades, resto);
    out.push({ positionId: l.positionId, instrumentId: p.instrumentId, unidades: u >= l.unidades - 1e-9 ? null : seis(u) });
    resto -= u;
  }
  return out.filter(c => c.unidades === null || c.unidades > 0);
}

export const alertaPendiente = x => `Pendiente de confirmar: ${x.sym} ${x.lado} desde ${x.dia || String(x.enviadaEl).slice(0, 10)}`;

// Ejecución abierta (12b §F.5, H6): ejecucion-<f> sin `fin` y sin diario. Cada línea se busca en el portafolio con F.3.4 contra
// `antes` y la ventana [armado − 120 s, armado + 10 min]: encontrada → ejecutada/aceptada; no encontrada → incierta (efectivo
// provisional); un cierre con la posición intacta y sin orden, un día hábil después → no_ejecutada. Devuelve el libro y el
// ops-<f> con los resultados (vía aplicarResultados) y el documento cerrado (res + fin).
export function conciliarEjecucion({ libro, doc, opsDoc, portafolio, historial = [], bids = {}, ahora, feriados = [] }) {
  const t = typeof ahora === "function" ? ahora() : ahora, hoy = fechaHoraET(t).fecha;
  const cp = cpDe(portafolio), posiciones = Array.isArray(cp.positions) ? cp.positions : [];
  const antesPos = new Set((doc.antes && doc.antes.pos) || []), antesOrd = new Set((doc.antes && doc.antes.ord) || []);
  const armado = Date.parse(doc.armado), tomadas = new Set(libro.posiciones.flatMap(p => p.lotes.map(l => l.positionId)));
  // N11: si 60-cerrar dejó en `res` lo que sabía el diario (sin fin), se usa como pista: hora real de envío, monto enviado
  // (puede venir escalado) y orderId; una línea sin envío en el diario no salió
  const pista = l => (doc.res || []).find(r => r.id === l.id && r.k === l.k) || null;
  const enVentana = (x, desde) => { const d = Date.parse(x.openDateTime); return Number.isFinite(d) && d >= desde - VENTANA_ANTES_MS && d <= desde + VENTANA_DESPUES_MS; };
  const casa = (l, x, desde, monto) => instId(x) === l.i && enVentana(x, desde) && isNum(x.amount) && isNum(monto) && monto > 0 && Math.abs(x.amount / monto - 1) <= 0.01;
  const lote = positionId => libro.posiciones.flatMap(p => p.lotes).find(l => l.positionId === positionId);
  const res = [];
  for (const l of doc.lineas || []) {
    const h = pista(l);
    if (h && (h.est === "no_enviada" || h.est === "rechazada")) { res.push(Object.assign({}, h)); continue; }
    const desde = h && Number.isFinite(Date.parse(h.env)) ? Date.parse(h.env) : armado, monto = l.lado === "c" ? (h && isNum(h.usd) ? h.usd : l.usd) : null, o = h && isNum(h.o) ? h.o : null;
    const r = { id: l.id, k: l.k, est: "incierta", env: h && h.env ? h.env : doc.armado, http: h ? h.http ?? null : null, o, pos: [], px: null, uej: null, usdej: null, usd: monto,
      err: h ? "conciliada con el diario de la sesión" : "sin diario: conciliada al día siguiente" };
    if (l.lado === "c") {
      const libre = x => !antesPos.has(posId(x)) && !tomadas.has(posId(x));
      const p = (o !== null ? posiciones.find(x => ordId(x) === o && libre(x)) : null) || posiciones.find(x => (ordId(x) === null || o === null) && libre(x) && casa(l, x, desde, monto));
      if (p) { tomadas.add(posId(p)); Object.assign(r, { est: "ejecutada", o: ordId(p) ?? o, pos: [posId(p)], px: px(isNum(p.openRate) ? p.openRate : p.amount / p.units), uej: u6(p.units), usdej: usd(p.amount), abierta: p.openDateTime || r.env, err: null }); }
      else {
        const q = (cp.ordersForOpen || []).find(x => !antesOrd.has(ordId(x)) && ((o !== null && ordId(x) === o) || casa(l, x, desde, monto)));
        if (q) Object.assign(r, { est: "aceptada", o: ordId(q), err: null });
      }
    } else {
      const p = posiciones.find(x => posId(x) === l.pos), lt = lote(l.pos);
      r.pos = [l.pos];
      if (lt && (!p || (isNum(p.units) && p.units < lt.unidades - 1e-9))) {
        const fh = filaHistorial(historial, l.pos), precio = num(precioCierre(fh), bids[l.i] && isNum(bids[l.i].bid) && bids[l.i].bid > 0 ? bids[l.i].bid : null);
        if (precio !== null) Object.assign(r, { est: "ejecutada", px: px(precio), err: null });
        else r.err = "cerrada en eToro sin precio de cierre";
      } else if ((cp.ordersForClose || []).some(x => posId(x) === l.pos)) Object.assign(r, { est: "aceptada", err: null });
      else if (!lt) Object.assign(r, { est: "no_ejecutada", err: "el lote ya no está en el libro" });
      else if (diasHabilesEntre(doc.f, hoy, feriados) >= 1) Object.assign(r, { est: "no_ejecutada", err: "posición intacta y sin orden de cierre" });
    }
    res.push(r);
  }
  // plan reconstruido de las líneas (sym y regla salen del id `<f>-<SYM>-<REGLA>`)
  const plan = [];
  for (const l of doc.lineas || []) {
    let o = plan.find(x => x.id === l.id);
    if (!o) {
      const m = String(l.id).match(/^\d{4}-\d{2}-\d{2}-(.+)-([A-Z0-9]+)$/);
      o = { id: l.id, sym: m ? m[1] : l.id, instrumentId: l.i, lado: l.lado === "v" ? "venta" : "compra", regla: m ? m[2] : null, motivo: "", montoUSD: l.usd, cierres: l.lado === "v" ? [] : null, noticias: [] };
      plan.push(o);
    }
    if (l.lado === "v") o.cierres[l.k] = { positionId: l.pos, unidades: l.u };
  }
  const nuevos = new Set(res.map(r => r.id));
  const ap = aplicarResultados({ libro, opsHoy: opsDoc || opsNuevo(doc.f), plan: plan.filter(o => nuevos.has(o.id)), res, simulacion: false, ahora: t, dia: doc.f });
  return { libro: ap.libro, ops: ap.ops, doc: Object.assign({}, doc, { lineas: [], res: res.map(({ abierta, ...r }) => r), fin: ts(t) }) };
}

// Aplica los eventos de conciliar a los documentos ops-<f> ({ "<f>": OpsDoc v2 }). El día de cada operación sale de su id.
export function aplicarEventosOps({ docs, eventos, ahora }) {
  const t = typeof ahora === "function" ? ahora() : ahora, hoy = fechaHoraET(t).fecha;
  const D = copia(docs), tocados = new Set(), alertas = [];
  const buscar = id => { const f = String(id).slice(0, 10), d = D[f]; const o = d && (d.ops || []).find(x => x.id === id); return o ? { f, o } : null; };
  const idLibre = base => { let id = base, k = 2; while (buscar(id)) id = `${base}-${k++}`; return id; };
  for (const e of eventos) {
    if (e.tipo === "ajuste") continue;
    const ej = e.ejecucion || {};
    if (e.tipo === "externa") {
      D[hoy] = D[hoy] || opsNuevo(hoy);
      D[hoy].ops.push({ id: idLibre(`${hoy}-${e.sym}-EXTERNA`), sym: e.sym, i: e.instrumentId, lado: "v", regla: "EXTERNA", mot: "Cerrada fuera de la rutina", usd: null, u: u6(ej.unidades),
        est: "ejecutada", o: null, pos: e.positionIds || [], px: px(ej.precio), uej: u6(ej.unidades), usdej: usd(ej.montoUSD), real: usd(e.realizadoUSD), env: null, err: null, not: [], sim: false });
      tocados.add(hoy); continue;
    }
    const f = buscar(e.opId);
    if (!f) {
      const id = `ops-${String(e.opId).slice(0, 10)}`, txt = `no se leyó ${id}; no se escribe`;
      if (!alertas.includes(txt)) alertas.push(txt);
      alertas.push(`${e.opId}: ${e.tipo} queda solo en el libro.`);
      continue;
    }
    const o = f.o;
    if (e.tipo === "ejecutada") Object.assign(o, { est: "ejecutada", pos: e.positionIds || o.pos, px: px(ej.precio), uej: u6(ej.unidades), usdej: usd(ej.montoUSD) }, e.realizadoUSD !== undefined ? { real: usd(e.realizadoUSD) } : {});
    else if (e.tipo === "no_ejecutada") Object.assign(o, { est: "no_ejecutada", err: e.error ? String(e.error).slice(0, 80) : null });
    else if (e.tipo === "incierta") o.est = "incierta";
    tocados.add(f.f);
  }
  return { docs: D, tocados: [...tocados].sort(), alertas };
}

// Resultado de un día en el libro y en ops-<hoy> (12b §F.3.5). plan: órdenes de plan-ordenes.json; res: líneas de
// ejecucion.json ({id, k, est, env, o, pos, px, uej, usdej, abierta, err}); simulacion: solo se registran como simuladas.
export function aplicarResultados({ libro, opsHoy, plan, res = [], simulacion, ahora, dia = null }) {
  const L = copia(libro), O = copia(opsHoy), t = typeof ahora === "function" ? ahora() : ahora, hoy = dia || fechaHoraET(t).fecha;
  const poner = op => { O.ops = O.ops.filter(x => x.id !== op.id).concat([op]); };
  for (const orden of plan) {
    const venta = orden.lado === "venta";
    const op = { id: orden.id, sym: orden.sym, i: orden.instrumentId, lado: venta ? "v" : "c", regla: orden.regla, mot: String(orden.motivo || "").slice(0, 120),
      usd: venta ? null : usd(orden.montoUSD), u: venta ? ((orden.cierres || []).every(c => c.unidades === null) ? null : u6((orden.cierres || []).reduce((a, c) => a + (c.unidades || 0), 0))) : null,
      est: "simulada", o: null, pos: [], px: null, uej: null, usdej: null, real: null, env: null, err: null, not: (orden.noticias || []).slice(0, 4), sim: !!simulacion };
    if (simulacion) { poner(op); continue; }
    const lineas = res.filter(r => r.id === orden.id);
    let u = 0, monto = 0, real = 0, alguna = false;
    for (const r of lineas) {
      op.env = op.env || r.env || null; op.o = op.o || r.o || null; if (r.err) op.err = String(r.err).slice(0, 80);
      if (!venta) {
        if (r.est === "ejecutada") {
          L.efectivoUSD = cts(L.efectivoUSD - (r.usdej ?? orden.montoUSD));
          (r.pos || []).forEach((positionId, j) => agregarLote(L, { sym: orden.sym, instrumentId: orden.instrumentId, positionId, orderId: r.o ?? null,
            unidades: j === 0 ? r.uej : 0, costoUSD: j === 0 ? (r.usdej ?? orden.montoUSD) : 0, abiertaEl: r.abierta || r.env }));
          Object.assign(op, { pos: r.pos || [], px: px(r.px), uej: u6(r.uej), usdej: usd(r.usdej) });
        } else if (r.est === "aceptada" || r.est === "incierta") {
          const m = r.usd ?? orden.montoUSD;
          L.efectivoUSD = cts(L.efectivoUSD - m);
          L.pendientes.push({ opId: orden.id, dia: hoy, orderId: r.o ?? null, sym: orden.sym, instrumentId: orden.instrumentId, lado: "compra", montoUSD: m, unidades: null, positionId: null, enviadaEl: r.env, estado: r.est });
          op.usd = usd(m);
        }
      } else {
        const c = (orden.cierres || [])[r.k] || {};
        if (r.est === "ejecutada" && isNum(r.px)) {
          const v = registrarVenta(L, { sym: orden.sym, positionId: c.positionId, unidades: c.unidades ?? null, precio: r.px });
          if (v) { u += v.unidades; monto += v.montoUSD; real += v.realizadoUSD; alguna = true; op.pos.push(c.positionId); }
        } else if (r.est === "aceptada" || r.est === "incierta") {
          L.pendientes.push({ opId: orden.id, dia: hoy, orderId: r.o ?? null, sym: orden.sym, instrumentId: orden.instrumentId, lado: "venta", montoUSD: null, unidades: c.unidades ?? null, positionId: c.positionId, enviadaEl: r.env, estado: r.est });
          op.pos.push(c.positionId);
        }
      }
    }
    if (venta && alguna) Object.assign(op, { px: px(monto / u), uej: u6(u), usdej: usd(monto), real: usd(real) });
    const ests = lineas.map(r => r.est);
    op.est = ests.includes("ejecutada") ? "ejecutada" : ests.includes("aceptada") ? "aceptada" : ests.includes("incierta") ? "incierta" : ests.includes("no_ejecutada") ? "no_ejecutada"
      : ests.includes("rechazada") ? "rechazada" : "no_enviada";
    poner(op);
  }
  return { libro: L, ops: O };
}
