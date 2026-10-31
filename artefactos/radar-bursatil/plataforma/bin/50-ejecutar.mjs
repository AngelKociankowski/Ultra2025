// Paso 8 · Ejecutar en eToro Demo (12-plan §6.6, §5.11.9). Solo envía lo de trabajo/plan-ordenes.json con la huella que
// escribió 40-decidir. Ventas (cierres) primero, luego compras. Uso: node bin/50-ejecutar.mjs --dir <carpeta> [--reanudar]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerTrabajo, escribirTrabajo, rutas } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { crearEToro } from "../lib/etoro.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { bidsDe } from "../lib/libro.mjs";
import { shaArchivo } from "./40-decidir.mjs";
import { fechaHoraET } from "../lib/tiempo.mjs";

const PASO = "50-ejecutar";
const AYUDA = "Uso: node bin/50-ejecutar.mjs --dir <carpeta> [--reanudar]";
const SONDEO_MS = 5000, ESPERA_MAX_MS = 90000;
const isNum = v => typeof v === "number" && Number.isFinite(v);
const cts = x => Math.round(x * 100) / 100;
const piso = x => Math.floor(x * 100 + 1e-7) / 100;
const posId = p => p.positionID ?? p.positionId ?? null, ordId = p => p.orderID ?? p.orderId ?? null, instId = p => p.instrumentID ?? p.instrumentId ?? null;

function leerDiario(ruta) {
  if (!fs.existsSync(ruta)) return [];
  return fs.readFileSync(ruta, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

export async function main(argv, { transporteEToro = null, ahora = Date.now, dormir = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"], banderas: ["--reanudar"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const R = rutas(dir), rutaPlan = path.join(R.trabajo, "plan-ordenes.json"), rutaDiario = path.join(R.trabajo, "diario-ejecucion.jsonl");
  const dec = leerTrabajo(dir, "decisiones.json"), plan = leerTrabajo(dir, "plan-ordenes.json"), cartera = leerTrabajo(dir, "cartera.json"), prep = leerTrabajo(dir, "preparar.json") || {};
  const t0 = ahora(), hoy = prep.fechaET || fechaHoraET(t0).fecha;
  const terminar = (codigo, accion, resultados, extra = {}) => {
    const cuerpo = Object.assign({ inicio: t0, resultados, efectivoAntesUSD: cartera && cartera.libro ? cartera.libro.efectivoUSD : null, efectivoDespuesUSD: null }, extra);
    escribirTrabajo(dir, "ejecucion.json", cuerpo);
    reg.info(`ejecución: ${accion}`, { resultados: resultados.map(r => [r.id, r.estado]) });
    return { codigo, linea: lineaPaso({ paso: PASO, ok: codigo === 0, accion, resumen: { ordenes: resultados.length, estados: resultados.reduce((m, r) => (m[r.estado] = (m[r.estado] || 0) + 1, m), {}) } }) };
  };
  // 1. huella del plan
  if (!dec || !plan || !fs.existsSync(rutaPlan) || dec.planSha !== shaArchivo(rutaPlan)) {
    reg.error("plan alterado o ausente: no se envía nada");
    return { codigo: 3, linea: lineaPaso({ paso: PASO, ok: false, accion: "incompleto", resumen: { codigo: "plan_alterado" } }) };
  }
  const ordenes = plan.ordenes || [];
  if (plan.simulacion || dec.simulacion) return terminar(0, "listo", ordenes.map(o => ({ id: o.id, estado: "simulada", orderId: null, positionIds: [], ejecucion: null, error: null })));
  if (!cartera || cartera.estado !== "listo" || !cartera.libro) return terminar(3, "incompleto", ordenes.map(o => ({ id: o.id, estado: "cancelada", orderId: null, positionIds: [], ejecucion: null, error: "sin cartera conciliada" })));

  const et = crearEToro({ transporte: transporteEToro || transporteCurl() });
  const libro = cartera.libro, config = prep.config || {}, minOrden = isNum(config.minOrdenUSD) ? config.minOrdenUSD : 100;
  const diarioPrevio = a.reanudar ? leerDiario(rutaDiario) : [];
  const previos = a.reanudar ? (leerTrabajo(dir, "ejecucion.json") || { resultados: [] }).resultados : [];
  const anotar = l => fs.appendFileSync(rutaDiario, JSON.stringify(Object.assign({ t: ahora() }, l)) + "\n");
  const enviado = (id, k) => diarioPrevio.find(l => l.id === id && l.k === k && l.fase === "envio");
  const respondido = (id, k) => diarioPrevio.filter(l => l.id === id && l.k === k && l.fase === "respuesta").pop();
  let detenido = null;
  const res = new Map(ordenes.map(o => [o.id, { id: o.id, estado: "pendiente", orderId: null, positionIds: [], ejecucion: null, error: null, detalle: [] }]));
  const cp = async () => { const p = await et.portafolio(); return p.clientPortfolio || {}; };
  const propios = new Set(libro.posiciones.flatMap(p => p.lotes.map(l => l.positionId)));
  const pendOrd = new Set(libro.pendientes.map(p => p.orderId).filter(Boolean));

  // 2. portafolio inicial: órdenes del mandato de días anteriores aún en cola bloquean compras de ese instrumento
  let inicial;
  try { inicial = await cp(); }
  catch (e) { return terminar(3, "incompleto", ordenes.map(o => ({ id: o.id, estado: "cancelada", orderId: null, positionIds: [], ejecucion: null, error: `eToro: ${e.codigo}` }))); }
  const colaVieja = new Set((inicial.ordersForOpen || []).filter(o => libro.pendientes.some(p => p.orderId === ordId(o) && String(p.enviadaEl).slice(0, 10) < hoy)).map(instId));

  // envío con un único reintento seguro (§6.6.5); `buscar(cp)` detecta lo que ya entró en eToro tras el envío
  async function enviar({ id, k, requestId, hacer, buscar }) {
    const prev = enviado(id, k);
    if (prev) { // --reanudar: nunca se reenvía sin mirar antes en eToro
      const r0 = respondido(id, k);
      let visto = null;
      try { visto = buscar(await cp(), prev.t); } catch (e) { visto = null; }
      if (visto) return { estado: "adoptada", visto, orderId: (r0 && r0.orderId) || visto.orderId || null };
      if (r0 && r0.http >= 400 && r0.http < 500) return { estado: "rechazada", error: `HTTP ${r0.http}` };
    }
    for (let intento = 0; intento < 2; intento++) {
      const tEnvio = ahora();
      anotar({ id, k, fase: "envio", intento });
      let r = null, e = null;
      try { r = await hacer(requestId); } catch (x) { e = x; }
      if (!e) {
        const orderId = (r && (r.orderId || (r.orderForClose && r.orderForClose.orderID))) || null;
        anotar({ id, k, fase: "respuesta", http: 200, orderId });
        return { estado: "enviada", orderId, tEnvio };
      }
      anotar({ id, k, fase: "respuesta", http: e.http || 0, codigo: e.codigo });
      if (e.codigo === "etoro_auth") { detenido = "etoro_auth"; return { estado: "rechazada", error: "etoro_auth" }; }
      if (e.codigo === "etoro_rechazo" || e.codigo === "etoro_ritmo" || e.codigo === "etoro_argumento" || e.codigo === "etoro_prohibido") return { estado: "rechazada", error: `${e.codigo}${e.http ? " HTTP " + e.http : ""}` };
      if (intento === 1) return { estado: "desconocida", error: e.codigo };
      let visto = null;
      try { visto = buscar(await cp(), tEnvio); } catch (x) { visto = null; }
      if (visto) return { estado: "adoptada", visto, orderId: visto.orderId || null };
    }
    return { estado: "desconocida", error: "sin respuesta" };
  }

  // 3. ventas
  const ventas = ordenes.filter(o => o.lado === "venta"), compras = ordenes.filter(o => o.lado === "compra");
  const loteDe = positionId => libro.posiciones.flatMap(p => p.lotes).find(l => l.positionId === positionId);
  const cierreVisto = (c, cpx) => { const p = (cpx.positions || []).find(x => posId(x) === c.positionId), l = loteDe(c.positionId); return !p || (l && isNum(p.units) && p.units < l.unidades - 1e-9); };
  for (const o of ventas) {
    if (detenido) break;
    const r = res.get(o.id);
    for (const [k, c] of (o.cierres || []).entries()) {
      if (detenido) { r.detalle.push({ positionId: c.positionId, unidades: c.unidades, estado: "cancelada", precio: null, orderId: null }); continue; }
      const e = await enviar({ id: o.id, k, requestId: o.requestIds[k], hacer: rid => et.cerrar({ positionId: c.positionId, instrumentId: o.instrumentId, unidades: c.unidades, requestId: rid }),
        buscar: cpx => (cierreVisto(c, cpx) ? { orderId: null } : null) });
      r.detalle.push({ positionId: c.positionId, unidades: c.unidades, estado: e.estado === "rechazada" || e.estado === "desconocida" ? e.estado : "pendiente", precio: null, orderId: e.orderId || null, error: e.error || null });
    }
  }
  const porConfirmar = () => ventas.flatMap(o => res.get(o.id).detalle.filter(d => d.estado === "pendiente"));
  if (porConfirmar().length) {
    for (let w = 0; w <= ESPERA_MAX_MS; w += SONDEO_MS) {
      let cpx = null;
      try { cpx = await cp(); } catch (e) { cpx = null; }
      if (cpx) for (const d of porConfirmar()) if (cierreVisto(d, cpx)) d.estado = "confirmada";
      if (!porConfirmar().length) break;
      await dormir(SONDEO_MS);
    }
    const confirmadas = ventas.flatMap(o => res.get(o.id).detalle.filter(d => d.estado === "confirmada").map(d => ({ d, o })));
    if (confirmadas.length) {
      let hist = [], bids = {};
      try { hist = await et.historial(hoy); } catch (e) { hist = []; }
      try { bids = bidsDe(await et.tasas([...new Set(confirmadas.map(x => x.o.instrumentId))])); } catch (e) { bids = {}; }
      for (const { d, o } of confirmadas) {
        const h = (Array.isArray(hist) ? hist : []).find(x => (x.positionId ?? x.positionID) === d.positionId);
        d.precio = h && isNum(h.closeRate) ? h.closeRate : bids[o.instrumentId] ? bids[o.instrumentId].bid : null;
        d.estado = isNum(d.precio) ? "ejecutada" : "pendiente";
      }
    }
  }
  let ingresos = 0;
  for (const o of ventas) {
    const r = res.get(o.id), ds = r.detalle, l = id => loteDe(id);
    for (const d of ds) if (d.estado === "ejecutada") ingresos += (d.unidades === null ? l(d.positionId).unidades : d.unidades) * d.precio;
    r.estado = ds.some(d => d.estado === "ejecutada") ? "ejecutada" : ds.some(d => d.estado === "pendiente") ? "pendiente" : ds.some(d => d.estado === "desconocida") ? "desconocida" : ds.every(d => d.estado === "cancelada") ? "cancelada" : "rechazada";
    r.positionIds = ds.filter(d => d.estado === "ejecutada" || d.estado === "pendiente").map(d => d.positionId);
    r.orderId = (ds.find(d => d.orderId) || {}).orderId || null;
    const ej = ds.filter(d => d.estado === "ejecutada");
    if (ej.length) {
      const u = ej.reduce((s, d) => s + (d.unidades === null ? l(d.positionId).unidades : d.unidades), 0), m = ej.reduce((s, d) => s + (d.unidades === null ? l(d.positionId).unidades : d.unidades) * d.precio, 0);
      r.ejecucion = { precio: u > 0 ? Math.round(m / u * 1e4) / 1e4 : null, unidades: Math.round(u * 1e6) / 1e6, montoUSD: cts(m), at: new Date(ahora()).toISOString() };
    }
    r.error = (ds.find(d => d.error) || {}).error || null;
  }

  // 4. compras: efectivo del mandato + ventas confirmadas; si no alcanza, se escalan por igual (§6.4.3)
  const disponible = Math.max(0, libro.efectivoUSD + ingresos);
  const activas = compras.filter(o => {
    const r = res.get(o.id);
    if (detenido) { Object.assign(r, { estado: "cancelada", error: `${detenido}: detenido` }); return false; }
    if (colaVieja.has(o.instrumentId)) { Object.assign(r, { estado: "cancelada", error: "orden anterior del mandato aún en cola" }); return false; }
    return true;
  });
  const pedido = activas.reduce((s, o) => s + o.montoUSD, 0), f = pedido > disponible + 0.005 ? disponible / pedido : 1;
  const enviadas = [];
  for (const o of activas) {
    const r = res.get(o.id), monto = piso(o.montoUSD * f);
    if (detenido) { Object.assign(r, { estado: "cancelada", error: `${detenido}: detenido` }); continue; }
    if (monto < minOrden) { Object.assign(r, { estado: "cancelada", error: `sin efectivo tras las ventas (US$ ${monto.toFixed(2)})` }); continue; }
    const buscarCompra = (cpx, desde) => {
      const ord = (cpx.ordersForOpen || []).find(x => instId(x) === o.instrumentId && Date.parse(x.openDateTime) >= desde - 1000 && !pendOrd.has(ordId(x)));
      if (ord) return { orderId: ordId(ord) };
      const p = (cpx.positions || []).find(x => instId(x) === o.instrumentId && Date.parse(x.openDateTime) >= desde - 1000 && !propios.has(posId(x)));
      return p ? { orderId: ordId(p) } : null;
    };
    const e = await enviar({ id: o.id, k: 0, requestId: o.requestIds[0], hacer: rid => et.comprar({ instrumentId: o.instrumentId, montoUSD: monto, requestId: rid }), buscar: buscarCompra });
    if (e.estado === "rechazada" || e.estado === "desconocida") { Object.assign(r, { estado: e.estado, error: e.error, orderId: e.orderId || null }); continue; }
    Object.assign(r, { estado: "pendiente", orderId: e.orderId || null, montoEnviadoUSD: monto });
    enviadas.push({ o, r, desde: e.tEnvio || t0 });
  }
  // confirmación: posición del mandato con ese orderID (o regla 3) dentro de 90 s; lo no visto queda pendiente
  const sinVer = () => enviadas.filter(x => x.r.estado === "pendiente");
  for (let w = 0; enviadas.length && w <= ESPERA_MAX_MS; w += SONDEO_MS) {
    let cpx = null;
    try { cpx = await cp(); } catch (e) { cpx = null; }
    if (cpx) for (const x of sinVer()) {
      const p = (cpx.positions || []).find(q => !propios.has(posId(q)) && ((x.r.orderId && ordId(q) === x.r.orderId)
        || (ordId(q) === null && instId(q) === x.o.instrumentId && Date.parse(q.openDateTime) >= x.desde - 1000 && isNum(q.amount) && Math.abs(q.amount / x.r.montoEnviadoUSD - 1) <= 0.01)));
      if (p) {
        propios.add(posId(p));
        Object.assign(x.r, { estado: "ejecutada", positionIds: [posId(p)], ejecucion: { precio: isNum(p.openRate) ? p.openRate : p.amount / p.units, unidades: p.units, montoUSD: cts(p.amount), at: p.openDateTime },
          detalle: [{ positionId: posId(p), unidades: p.units, montoUSD: cts(p.amount) }] });
      }
    }
    if (!sinVer().length) break;
    await dormir(SONDEO_MS);
  }
  for (const x of enviadas) { x.r.montoUSD = x.r.montoEnviadoUSD; delete x.r.montoEnviadoUSD; }
  // reanudación: lo resuelto en la corrida anterior se conserva si esta no lo tocó
  const resultados = ordenes.map(o => { const r = res.get(o.id), p = previos.find(x => x.id === o.id); return p && r.estado === "pendiente" && !r.orderId && p.estado !== "pendiente" ? p : r; });
  for (const r of resultados) if (!r.detalle || !r.detalle.length) delete r.detalle;
  const gastado = resultados.filter(r => ordenes.find(o => o.id === r.id).lado === "compra" && ["ejecutada", "pendiente", "desconocida"].includes(r.estado)).reduce((s, r) => s + (r.montoUSD || 0), 0);
  const incompleto = !!detenido || resultados.some(r => r.estado === "desconocida");
  return terminar(incompleto ? 3 : 0, incompleto ? "incompleto" : "listo", resultados, { efectivoDespuesUSD: cts(libro.efectivoUSD + ingresos - gastado), detenido });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
