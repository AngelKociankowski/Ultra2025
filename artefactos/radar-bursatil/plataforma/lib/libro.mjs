// Libro del mandato "Cartera Radar" (12-plan §5.8, §5.9.2–§5.9.4, §5.10). Puro: no habla con la red.
import { CONFIG_DEFECTO } from "./constantes.mjs";
import { fechaHoraET, mesDe } from "./tiempo.mjs";

export const MANDATO = Object.freeze({
  nombre: "Cartera Radar", cuenta: "eToro Demo", inicio: "2026-10-30", capitalBaseMXN: 600000, fxInicio: 18.774,
  capitalBaseUSD: 31959.09, perfil: "moderado", reglas: "1",
});
// Las 5 órdenes del 30-oct (00j; respuesta real de portfolio guardada el 30-oct). SPY va en dos órdenes.
const ORDENES_INICIALES = Object.freeze([
  { opId: "2026-10-30-SPY-INICIAL", orderId: 391213449, sym: "SPY", instrumentId: 3000, montoUSD: 500.00, enviadaEl: "2026-10-30T21:08:20.19Z" },
  { opId: "2026-10-30-SPY-INICIAL-2", orderId: 391187994, sym: "SPY", instrumentId: 3000, montoUSD: 20273.09, enviadaEl: "2026-10-30T22:18:07.83Z" },
  { opId: "2026-10-30-DIA-INICIAL", orderId: 391187995, sym: "DIA", instrumentId: 3026, montoUSD: 6164.71, enviadaEl: "2026-10-30T22:18:08.18Z" },
  { opId: "2026-10-30-XLF-INICIAL", orderId: 391213506, sym: "XLF", instrumentId: 3004, montoUSD: 3132.01, enviadaEl: "2026-10-30T22:18:08.477Z" },
  { opId: "2026-10-30-XLE-INICIAL", orderId: 391187996, sym: "XLE", instrumentId: 3008, montoUSD: 1888.72, enviadaEl: "2026-10-30T22:18:08.8Z" },
]);
const MOTIVO_INICIAL = "Cartera inicial: buildPortfolio Moderado del análisis del 30-oct (600 000 MXN a 18.774)";
// Asignación verificada el 30-oct (12-plan §0.7, §5.7.1): precio eToro = currentRate de la búsqueda con `fields`;
// precio Radar = row.price del análisis del 30-oct. GLD no tiene precio eToro guardado: queda sin verificar (se verifica al usarse).
const MAPA_SEMILLA = Object.freeze([
  ["SPY", 3000, "SPY", "State Street SPDR S&P 500 ETF", 6, 755.72, 755.77],
  ["DIA", 3026, "DIA.US", "State Street SPDR Dow Jones In", 6, 517.13, 517.13],
  ["XLF", 3004, "XLF", "State Street Financial Select Sector SPDR ETF", 6, 56.51, 56.51],
  ["XLE", 3008, "XLE", "State Street Energy Select Sector SPDR ETF", 6, 70.02, 70.02],
  ["TLT", 3020, "TLT", "iShares 20+ Year Treasury Bond ETF", 6, 81.84, 81.84],
  ["GLD", 3025, "GLD", "SPDR Gold Shares", 6, null, 355.78],
  ["QQQ", 3006, "QQQ", "Invesco QQQ", 6, 690.49, 690.49],
  ["IWM", 3005, "IWM", "Ishares Russell 2000 ETF", 6, 279.33, 279.33],
  ["VWO", 4252, "VWO", "Vanguard FTSE Emerging Markets", 6, 55.51, 55.51],
  ["EFA", 3009, "EFA", "iShares MSCI EAFE ETF", 6, 103.37, 103.37],
  ["XLK", 3021, "XLK", "State Street Technology Select Sector SPDR ETF", 6, 179.51, 179.51],
  ["SLV", 4430, "SLV", "iShares Silver Trust", 6, 44.6, 44.6],
  ["USDMXN", 63, "USDMXN", "USD/MXN", 1, null, 18.774],
]);

export const cts = x => Math.round(x * 100) / 100;
const seis = x => Math.floor(x * 1e6 + 1e-6) / 1e6;
const copia = o => JSON.parse(JSON.stringify(o));
const isNum = v => typeof v === "number" && Number.isFinite(v);
const num = (...vs) => { for (const v of vs) if (isNum(v)) return v; return null; };

function opDe({ id, fechaIso, sym, instrumentId, lado, regla, motivo, montoUSD = null, unidades = null, orderId = null, estado, simulacion = false, noticias = [] }) {
  const et = fechaHoraET(Date.parse(fechaIso));
  return { id, fecha: et.fecha, hora: et.hora, sym, instrumentId, lado, regla, motivo, montoUSD, unidades, orderId, positionIds: [],
    estado, ejecucion: null, realizadoUSD: null, error: null, noticias, simulacion };
}

export function semilla({ ahora = Date.now } = {}) {
  const at = ahora();
  const efectivo = cts(MANDATO.capitalBaseUSD - ORDENES_INICIALES.reduce((a, o) => a + o.montoUSD, 0));
  const libro = {
    kind: "carteraLibro", v: 1, at, mandato: Object.assign({}, MANDATO), efectivoUSD: efectivo, realizadoUSD: 0, posiciones: [],
    pendientes: ORDENES_INICIALES.map(o => ({ opId: o.opId, orderId: o.orderId, sym: o.sym, instrumentId: o.instrumentId, lado: "compra", montoUSD: o.montoUSD, positionId: null, unidades: null, enviadaEl: o.enviadaEl })),
    fueraDelObjetivo: {}, operadoHoy: { fecha: null, syms: [] },
    ultimaValuacion: { at, valorUSD: MANDATO.capitalBaseUSD, valorMXN: MANDATO.capitalBaseMXN, fx: MANDATO.fxInicio }, ultimaRutina: null,
  };
  const ops = { "2026-10": { kind: "carteraOps", v: 1, mes: "2026-10", at,
    ops: ORDENES_INICIALES.map(o => opDe({ id: o.opId, fechaIso: o.enviadaEl, sym: o.sym, instrumentId: o.instrumentId, lado: "compra", regla: "INICIAL", motivo: MOTIVO_INICIAL, montoUSD: o.montoUSD, orderId: o.orderId, estado: "pendiente" })) } };
  const serie = { kind: "carteraSerie", v: 1, anio: 2026, at, base: { fecha: "2026-10-30", valorUSD: MANDATO.capitalBaseUSD, valorMXN: MANDATO.capitalBaseMXN, fx: MANDATO.fxInicio, spy: 755.26 }, puntos: [] };
  const instrumentos = {};
  for (const [sym, id, simboloEToro, nombre, clase, pe, pr] of MAPA_SEMILLA) {
    const verificado = isNum(pe) && isNum(pr);
    instrumentos[sym] = { instrumentId: id, simboloEToro, nombre, clase, verificadoEl: verificado ? "2026-10-30" : null, precioEToro: pe, precioRadar: pr,
      difPct: verificado ? Math.round((pe / pr - 1) * 10000) / 100 : null };
  }
  const mapa = { kind: "etoroMapa", v: 1, at, instrumentos, rechazados: { DIA: [{ instrumentId: 100580, motivo: "clase 10 (cripto)" }] } };
  const config = Object.assign({ kind: "rutinaConfig", v: 1, at }, copia(CONFIG_DEFECTO));
  const indiceBitacora = { kind: "bitacoraIndice", v: 1, at, dias: [] };
  return { libro, ops, serie, mapa, config, indiceBitacora };
}

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
  p.lotes.push({ positionId, orderId, unidades, costoUSD: cts(costoUSD), abiertaEl });
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
// ops: operaciones del mes (regla 2 de pertenencia). bids: { instrumentId: {bid} } para cierres sin fila en historial.
export function conciliar({ libro, portafolio, historial, ahora, planRecuperado = null, ordenes = {}, ops = [], bids = {} }) {
  const L = copia(libro), eventos = [], alertas = [];
  const t = typeof ahora === "function" ? ahora() : ahora, hoy = fechaHoraET(t).fecha;
  const cp = cpDe(portafolio), posiciones = Array.isArray(cp.positions) ? cp.positions : [], enCola = Array.isArray(cp.ordersForOpen) ? cp.ordersForOpen : [];
  const colaIds = new Set(enCola.map(ordId).filter(x => x !== null));
  const bidDe = id => (bids[id] && isNum(bids[id].bid) ? bids[id].bid : null);

  // 0. Recuperación: lo que la sesión caída envió se adopta con su regla (§5.8)
  if (planRecuperado && Array.isArray(planRecuperado.plan)) {
    const inicio = num(planRecuperado.inicio) || 0, operados = [];
    for (const o of planRecuperado.plan) {
      if (o.lado === "compra") {
        if (L.pendientes.some(p => p.opId === o.id)) continue;
        const nueva = enCola.find(x => instId(x) === o.instrumentId && Date.parse(x.openDateTime) >= inicio && !L.pendientes.some(p => p.orderId === ordId(x)))
          || posiciones.find(x => instId(x) === o.instrumentId && Date.parse(x.openDateTime) >= inicio && !L.posiciones.some(p => p.lotes.some(l => l.positionId === posId(x))) && !L.pendientes.some(p => p.orderId === ordId(x)));
        if (!nueva) continue;
        L.pendientes.push({ opId: o.id, orderId: ordId(nueva), sym: o.sym, instrumentId: o.instrumentId, lado: "compra", montoUSD: o.montoUSD, positionId: null, unidades: null, enviadaEl: new Date(inicio).toISOString() });
        L.efectivoUSD = cts(L.efectivoUSD - o.montoUSD);
        eventos.push({ tipo: "adoptada", opId: o.id, orden: o, orderId: ordId(nueva) });
        operados.push(o.sym);
      } else {
        for (const c of o.cierres || []) {
          const lote = L.posiciones.flatMap(p => p.lotes).find(l => l.positionId === c.positionId);
          if (!lote || L.pendientes.some(p => p.lado === "venta" && p.positionId === c.positionId)) continue;
          const pos = posiciones.find(x => posId(x) === c.positionId);
          if (pos && !(num(pos.units) < lote.unidades - 1e-9)) continue;
          L.pendientes.push({ opId: o.id, orderId: null, sym: o.sym, instrumentId: o.instrumentId, lado: "venta", montoUSD: null, positionId: c.positionId, unidades: c.unidades, enviadaEl: new Date(inicio).toISOString() });
          eventos.push({ tipo: "adoptada", opId: o.id, orden: o, orderId: null });
          operados.push(o.sym);
        }
      }
    }
    if (planRecuperado.de === hoy && operados.length) {
      const prev = L.operadoHoy && L.operadoHoy.fecha === hoy ? L.operadoHoy.syms : [];
      L.operadoHoy = { fecha: hoy, syms: [...new Set(prev.concat(operados))] };
    }
  }

  const lotes = () => L.posiciones.flatMap(p => p.lotes.map(l => ({ p, l })));
  const opsOrden = new Set((Array.isArray(ops) ? ops : []).map(o => o && o.orderId).filter(x => x !== null && x !== undefined));
  const asignadas = new Set(lotes().map(x => x.l.positionId));

  // 1. Compras pendientes
  for (const pend of L.pendientes.filter(p => p.lado === "compra")) {
    let match = posiciones.filter(x => !asignadas.has(posId(x)) && pend.orderId !== null && ordId(x) === pend.orderId);
    if (!match.length) { // regla 3: la posición no trae orderID
      const c = posiciones.find(x => !asignadas.has(posId(x)) && ordId(x) === null && instId(x) === pend.instrumentId
        && Date.parse(x.openDateTime) >= Date.parse(pend.enviadaEl) && isNum(x.amount) && Math.abs(x.amount / pend.montoUSD - 1) <= 0.01);
      if (c) match = [c];
    }
    if (match.length) {
      const posIds = [];
      let u = 0, costo = 0;
      for (const x of match) {
        agregarLote(L, { sym: pend.sym, instrumentId: pend.instrumentId, positionId: posId(x), orderId: pend.orderId !== null ? pend.orderId : ordId(x), unidades: num(x.units), costoUSD: num(x.amount, pend.montoUSD), abiertaEl: x.openDateTime });
        asignadas.add(posId(x)); posIds.push(posId(x)); u += num(x.units) || 0; costo += num(x.amount, pend.montoUSD) || 0;
      }
      L.pendientes.splice(L.pendientes.indexOf(pend), 1);
      eventos.push({ tipo: "ejecutada", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym, positionIds: posIds,
        ejecucion: { precio: u > 0 ? Math.round(costo / u * 1e4) / 1e4 : null, unidades: seis(u), montoUSD: cts(costo), at: match[0].openDateTime } });
      continue;
    }
    if (pend.orderId !== null && colaIds.has(pend.orderId)) continue; // sigue pendiente
    const o = pend.orderId !== null ? ordenes[pend.orderId] : null;
    const err = o && (num(o.errorCode) > 0 || (typeof o.errorCode === "string" && o.errorCode && o.errorCode !== "0"));
    if (err) {
      L.efectivoUSD = cts(L.efectivoUSD + pend.montoUSD);
      L.pendientes.splice(L.pendientes.indexOf(pend), 1);
      eventos.push({ tipo: "rechazada", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym, error: `errorCode ${o.errorCode}, statusID ${o.statusID}` });
    } else {
      if (pend.estado !== "desconocida") eventos.push({ tipo: "desconocida", lado: "compra", opId: pend.opId, orderId: pend.orderId, sym: pend.sym });
      pend.estado = "desconocida";
      alertas.push(`Compra de ${pend.sym} (orden ${pend.orderId === null ? "sin número" : pend.orderId}) sin rastro en eToro: el monto no vuelve al efectivo hasta aclararse.`);
    }
  }

  // 2. Ventas (cierres) pendientes
  const vendidas = new Set();
  for (const pend of L.pendientes.filter(p => p.lado === "venta")) {
    const ent = lotes().find(x => x.l.positionId === pend.positionId);
    if (!ent) { L.pendientes.splice(L.pendientes.indexOf(pend), 1); alertas.push(`Cierre pendiente de ${pend.sym} sin lote en el libro (posición ${pend.positionId}).`); continue; }
    const pos = posiciones.find(x => posId(x) === pend.positionId);
    const antes = ent.l.unidades, ahoraU = pos ? num(pos.units) : 0;
    if (pos && !(ahoraU < antes - 1e-9)) continue; // aún no se ejecuta
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
    alertas.push(`Posición ${posId(x)} (orden ${ordId(x)}) aparece en las operaciones del mes sin pendiente: revisar.`);
  }
  return { libro: L, eventos, alertas };
}
const cts6 = x => Math.round(x * 1e6) / 1e6;

// fx: { valor, fuente }. tasas: respuesta de tasas() o arreglo de rates.
export function valuar({ libro, tasas, fx, at = null }) {
  const bids = bidsDe(tasas), posiciones = [], alertas = [];
  for (const p of libro.posiciones) {
    if (!p.lotes.length) continue;
    const unidades = cts6(p.lotes.reduce((a, l) => a + l.unidades, 0)), costo = cts(p.lotes.reduce((a, l) => a + l.costoUSD, 0));
    const bid = bids[p.instrumentId] ? bids[p.instrumentId].bid : null;
    if (bid === null) alertas.push(`${p.sym} sin precio de eToro: se valúa a costo.`);
    const valor = cts(bid === null ? costo : unidades * bid);
    posiciones.push({ sym: p.sym, instrumentId: p.instrumentId, unidades, costoUSD: costo, precioUSD: bid, valorUSD: valor, peso: 0,
      gpUSD: cts(valor - costo), gpPct: costo > 0 ? (valor / costo - 1) * 100 : 0, lotes: p.lotes.length });
  }
  const pendientesUSD = cts(libro.pendientes.filter(x => x.lado === "compra").reduce((a, x) => a + x.montoUSD, 0));
  const valorUSD = cts(posiciones.reduce((a, x) => a + x.valorUSD, 0) + libro.efectivoUSD + pendientesUSD);
  for (const x of posiciones) x.peso = valorUSD > 0 ? x.valorUSD / valorUSD : 0;
  const fxv = fx && isNum(fx.valor) ? fx.valor : null;
  return { at, fx: fxv, fxFuente: fx ? fx.fuente || null : null, valorUSD, efectivoUSD: libro.efectivoUSD, invertidoUSD: cts(valorUSD - libro.efectivoUSD),
    valorMXN: fxv === null ? null : cts(valorUSD * fxv), posiciones, pendientesUSD, spyUSD: bids[3000] ? bids[3000].bid : null, alertas };
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

// Tras 50-ejecutar. resultados: cada orden del plan con su resultado mezclado
// ({id, sym, instrumentId, lado, regla, motivo, montoUSD, cierres, noticias, estado, orderId, positionIds, ejecucion, error, detalle}).
export function aplicarEjecucion({ libro, ops, resultados, ahora }) {
  const L = copia(libro), O = copia(ops), t = typeof ahora === "function" ? ahora() : ahora, hoy = fechaHoraET(t).fecha, iso = new Date(t).toISOString();
  const enviados = [];
  for (const r of resultados) {
    const op = opDe({ id: r.id, fechaIso: iso, sym: r.sym, instrumentId: r.instrumentId, lado: r.lado, regla: r.regla, motivo: r.motivo,
      montoUSD: r.lado === "compra" ? r.montoUSD : null, unidades: null, orderId: r.orderId ?? null, estado: r.estado, simulacion: r.estado === "simulada", noticias: r.noticias || [] });
    op.positionIds = r.positionIds || []; op.error = r.error || null;
    if (r.estado === "simulada") {
      if (r.lado === "venta") op.unidades = (r.cierres || []).every(c => c.unidades === null) ? null : (r.cierres || []).reduce((a, c) => a + (c.unidades || 0), 0);
      O.ops = O.ops.filter(x => x.id !== op.id).concat([op]);
      continue;
    }
    if (r.estado !== "cancelada") enviados.push(r.sym);
    if (r.lado === "compra") {
      if (["ejecutada", "pendiente", "enviada", "desconocida"].includes(r.estado)) L.efectivoUSD = cts(L.efectivoUSD - r.montoUSD);
      if (r.estado === "ejecutada" && r.ejecucion && (r.positionIds || []).length) {
        const porPos = r.detalle && Array.isArray(r.detalle) ? r.detalle : [{ positionId: r.positionIds[0], unidades: r.ejecucion.unidades, montoUSD: r.ejecucion.montoUSD }];
        for (const d of porPos) agregarLote(L, { sym: r.sym, instrumentId: r.instrumentId, positionId: d.positionId, orderId: r.orderId, unidades: d.unidades, costoUSD: d.montoUSD, abiertaEl: r.ejecucion.at });
        op.ejecucion = r.ejecucion; op.unidades = r.ejecucion.unidades;
      } else if (["pendiente", "enviada", "desconocida"].includes(r.estado)) {
        L.pendientes.push(Object.assign({ opId: r.id, orderId: r.orderId ?? null, sym: r.sym, instrumentId: r.instrumentId, lado: "compra", montoUSD: r.montoUSD, positionId: null, unidades: null, enviadaEl: iso },
          r.estado === "desconocida" ? { estado: "desconocida" } : {}));
      }
    } else {
      let monto = 0, realizado = 0, unidades = 0, alguna = false;
      for (const d of r.detalle || []) {
        if (d.estado === "ejecutada" && isNum(d.precio)) {
          const v = registrarVenta(L, { sym: r.sym, positionId: d.positionId, unidades: d.unidades, precio: d.precio });
          if (v) { monto += v.montoUSD; realizado += v.realizadoUSD; unidades += v.unidades; alguna = true; }
        } else if (["pendiente", "enviada", "desconocida"].includes(d.estado)) {
          L.pendientes.push(Object.assign({ opId: r.id, orderId: d.orderId ?? null, sym: r.sym, instrumentId: r.instrumentId, lado: "venta", montoUSD: null, positionId: d.positionId, unidades: d.unidades, enviadaEl: iso },
            d.estado === "desconocida" ? { estado: "desconocida" } : {}));
        }
      }
      if (alguna) { op.ejecucion = { precio: unidades > 0 ? Math.round(monto / unidades * 1e4) / 1e4 : null, unidades: cts6(unidades), montoUSD: cts(monto), at: iso }; op.realizadoUSD = cts(realizado); op.unidades = cts6(unidades); }
    }
    O.ops = O.ops.filter(x => x.id !== op.id).concat([op]);
  }
  if (enviados.length) {
    const prev = L.operadoHoy && L.operadoHoy.fecha === hoy ? L.operadoHoy.syms : [];
    L.operadoHoy = { fecha: hoy, syms: [...new Set(prev.concat(enviados))] };
  }
  L.at = t; O.at = t;
  return { libro: L, ops: O };
}

// Aplica los eventos de conciliar a los documentos de operaciones ({ "<mes>": OpsDoc }). Devuelve meses tocados y alertas.
export function aplicarEventosOps({ docs, eventos, ahora }) {
  const t = typeof ahora === "function" ? ahora() : ahora, iso = new Date(t).toISOString(), hoy = fechaHoraET(t).fecha, mesHoy = mesDe(hoy);
  const D = copia(docs), tocados = new Set(), alertas = [];
  const buscar = id => { for (const [mes, d] of Object.entries(D)) { const o = (d.ops || []).find(x => x.id === id); if (o) return { mes, o }; } return null; };
  const docHoy = () => (D[mesHoy] = D[mesHoy] || { kind: "carteraOps", v: 1, mes: mesHoy, at: t, ops: [] });
  const idLibre = base => { let id = base, k = 2; while (buscar(id)) id = `${base}-${k++}`; return id; };
  for (const e of eventos) {
    if (e.tipo === "ajuste") continue;
    if (e.tipo === "externa") {
      const op = opDe({ id: idLibre(`${hoy}-${e.sym}-EXTERNA`), fechaIso: iso, sym: e.sym, instrumentId: e.instrumentId, lado: "venta", regla: "EXTERNA", motivo: "Cerrada fuera de la rutina", estado: "ejecutada" });
      Object.assign(op, { positionIds: e.positionIds, ejecucion: e.ejecucion, unidades: e.ejecucion.unidades, realizadoUSD: e.realizadoUSD });
      docHoy().ops.push(op); tocados.add(mesHoy); continue;
    }
    if (e.tipo === "adoptada") {
      if (buscar(e.opId)) continue;
      const o = e.orden, op = opDe({ id: e.opId, fechaIso: iso, sym: o.sym, instrumentId: o.instrumentId, lado: o.lado, regla: o.regla, motivo: o.motivo, montoUSD: o.lado === "compra" ? o.montoUSD : null, orderId: e.orderId, estado: "enviada", noticias: o.noticias || [] });
      docHoy().ops.push(op); tocados.add(mesHoy); continue;
    }
    const f = buscar(e.opId);
    if (!f) { alertas.push(`Operación ${e.opId} no encontrada en los meses leídos; su estado (${e.tipo}) queda solo en el libro.`); continue; }
    const o = f.o;
    if (e.tipo === "ejecutada") { o.estado = "ejecutada"; o.positionIds = e.positionIds || o.positionIds; o.ejecucion = e.ejecucion; o.unidades = e.ejecucion.unidades; if (e.realizadoUSD !== undefined) o.realizadoUSD = e.realizadoUSD; }
    else if (e.tipo === "rechazada") { o.estado = "rechazada"; o.error = e.error || null; }
    else if (e.tipo === "desconocida") o.estado = "desconocida";
    D[f.mes].at = t; tocados.add(f.mes);
  }
  return { docs: D, tocados: [...tocados].sort(), alertas };
}
