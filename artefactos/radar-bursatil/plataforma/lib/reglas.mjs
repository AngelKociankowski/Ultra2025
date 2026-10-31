// Motor de reglas determinista (12-plan §6). Puro: recibe todo y devuelve decisiones y órdenes; no envía nada.
import crypto from "node:crypto";
import { CONFIG_DEFECTO, CONFIG_RANGOS } from "./constantes.mjs";
import { unidadesAVender } from "./libro.mjs";

const isNum = v => typeof v === "number" && Number.isFinite(v);
const copia = o => JSON.parse(JSON.stringify(o));
const piso = x => Math.floor(x * 100 + 1e-7) / 100;
const seis = x => Math.floor(x * 1e6 + 1e-6) / 1e6;
const p1 = x => (Math.round(x * 10) / 10).toFixed(1);
// desviaciones con la cifra redondeada a centésimas, la misma que compara la banda (H10)
const signo = x => { const r = Math.round(x * 100) / 100; return (r < 0 ? "−" : "+") + Math.abs(r).toFixed(2); };
const ETIQUETA = { 1: "Evitar", 2: "Mantener", 3: "Compra" };

// ---- rutina-config efectiva (§5.9.6): fuera de rango → defecto + alerta ----
export function configEfectiva(doc) {
  const c = copia(CONFIG_DEFECTO), alertas = [];
  if (!doc || typeof doc !== "object") return { config: c, alertas: ["rutina-config no disponible: se usan los valores por defecto (simulación)."] };
  const R = CONFIG_RANGOS;
  const rango = (k, [a, b]) => {
    if (doc[k] === undefined) return;
    if (isNum(doc[k]) && doc[k] >= a && doc[k] <= b) c[k] = doc[k]; else alertas.push(`rutina-config.${k} fuera de rango (${a}–${b}): se usa ${c[k]}.`);
  };
  for (const k of ["bandaPts", "minOrdenUSD", "nuevoSatelitePct", "diasSalida", "maxOrdenesDia", "noticiasVentanaH", "tolPrecioPct"]) rango(k, R[k]);
  for (const k of ["maxOrdenesDia", "diasSalida"]) if (!Number.isInteger(c[k])) { c[k] = CONFIG_DEFECTO[k]; alertas.push(`rutina-config.${k} debe ser entero.`); }
  if (doc.perfil !== undefined) { if (R.perfil.includes(doc.perfil)) c.perfil = doc.perfil; else alertas.push(`rutina-config.perfil inválido: se usa ${c.perfil}.`); }
  for (const k of ["operar", "podar"]) if (doc[k] !== undefined) { if (typeof doc[k] === "boolean") c[k] = doc[k]; else alertas.push(`rutina-config.${k} no es booleano: se usa ${c[k]}.`); }
  const hhmm = v => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
  const v = doc.ventanaET || {};
  if (v.desde !== undefined) { if (hhmm(v.desde) && v.desde >= R.ventanaDesde[0] && v.desde <= R.ventanaDesde[1]) c.ventanaET.desde = v.desde; else alertas.push("rutina-config.ventanaET.desde fuera de rango (09:35–11:00)."); }
  if (v.hasta !== undefined) { if (hhmm(v.hasta) && v.hasta >= R.ventanaHasta[0] && v.hasta <= R.ventanaHasta[1]) c.ventanaET.hasta = v.hasta; else alertas.push("rutina-config.ventanaET.hasta fuera de rango (12:00–15:45)."); }
  if (doc.activadoEl !== undefined) { if (doc.activadoEl === null || (typeof doc.activadoEl === "string" && !Number.isNaN(Date.parse(doc.activadoEl)))) c.activadoEl = doc.activadoEl; else alertas.push("rutina-config.activadoEl inválido."); }
  // operar sin activación del director no cuenta (T20 pone activadoEl)
  if (c.operar && !c.activadoEl) { c.operar = false; alertas.push("rutina-config.operar = true sin activadoEl: se queda en simulación."); }
  return { config: c, alertas };
}

// ---- §6.1 Objetivo del día ----
export function objetivoDelDia({ C, out, perfil, valorUSD, fx, cetesPct, nowMs }) {
  const P = C.PORT, amountMXN = Math.min(P.MAX_AMOUNT, Math.max(P.MIN_AMOUNT, valorUSD * fx));
  const pf = C.buildPortfolio({ output: out, live: null, profile: perfil, amountMXN, fractional: true, nowMs, cetesPct, prices: null });
  if (pf.state !== "ok") return { estado: pf.state, pesos: {}, efectivo: 1, filas: {}, notas: pf.notes || [], roles: {}, proxyOf: {} };
  const pesos = {}, filas = {}, roles = {}, proxyOf = {};
  const fila = id => (out.rows || []).find(r => r.symbol === id) || null;
  for (const p of pf.positions) {
    if (p.kind === "cash" || p.kind === "usd") continue;
    pesos[p.id] = p.target; roles[p.id] = p.role; proxyOf[p.id] = p.proxyOf || null;
    filas[p.id] = fila(p.id) || (p.proxyOf ? fila(p.proxyOf) : null);
  }
  return { estado: "ok", pesos, efectivo: 1 - Object.values(pesos).reduce((a, x) => a + x, 0), filas, notas: pf.notes || [], roles, proxyOf };
}

// ---- requestId determinista (§5.11.8) ----
export function requestIdDe(fecha, id, k) {
  const h = crypto.createHash("sha256").update(`${fecha}|${id}|${k}`).digest("hex").slice(0, 32).split("");
  h[12] = "4"; h[16] = "89ab"[parseInt(h[16], 16) & 3];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const PRIORIDAD = { V1: 0, N2: 0, V2: 1, R1: 2, C1: 3 };

// Entradas:
//  analisis: trabajo/analisis.json · cartera: trabajo/cartera.json · eventos: eventos validados de noticias (con `confirmado`)
//  config: configEfectiva · contexto: { fecha, mercadoAbierto, ventanaDentro, bloqueoLibro, calendarioAusente, cetesPct, nowMs }
// objetivo: solo pruebas (escenarios con pesos fijos); en la rutina siempre sale de buildPortfolio
export function decidir({ C, analisis, cartera, eventos = [], config, contexto, objetivo: objetivoFijo = null }) {
  const alertas = [], decisiones = [];
  const out = analisis && analisis.out ? analisis.out : null;
  const libro = cartera && cartera.libro, val = cartera && cartera.valuacion, mapa = (cartera && cartera.mapa) || { instrumentos: {}, rechazados: {} };
  const fecha = contexto.fecha, simulacion = !config.operar;
  const valorUSD = val ? val.valorUSD : 0;

  // modo (§6.2)
  let base = "normal", motivoModo = null, objetivo = { estado: "sin_analisis", pesos: {}, efectivo: 1, filas: {}, roles: {}, proxyOf: {} };
  if (!out) { base = "sin_objetivo"; motivoModo = "sin análisis de hoy"; }
  else {
    if (objetivoFijo) objetivo = Object.assign({ estado: "ok", filas: {}, roles: {}, proxyOf: {}, notas: [] }, objetivoFijo, { efectivo: 1 - Object.values(objetivoFijo.pesos).reduce((x, y) => x + y, 0) });
    if (objetivoFijo && !Object.keys(objetivo.filas).length) objetivo.filas = Object.fromEntries(Object.keys(objetivo.pesos).map(id => [id, (out.rows || []).find(r => r.symbol === id) || null]));
    else if (val && libro && isNum(val.fx)) objetivo = objetivoDelDia({ C, out, perfil: config.perfil, valorUSD, fx: val.fx, cetesPct: contexto.cetesPct, nowMs: contexto.nowMs });
    else objetivo = Object.assign(objetivo, { estado: "sin_valuacion" });
    if (objetivo.estado !== "ok") { base = "sin_objetivo"; motivoModo = `buildPortfolio: ${objetivo.estado}`; }
    else if (out.partial || (analisis && analisis.parcial)) { base = "restringido"; motivoModo = "análisis parcial"; }
  }
  let bloqueo = null;
  if (!cartera || cartera.estado !== "listo" || !libro || !val) bloqueo = "sin datos de eToro o del libro";
  else if (contexto.bloqueoLibro) bloqueo = "cartera-libro no se pudo leer";
  else if (contexto.calendarioAusente) bloqueo = "falta el calendario NYSE del año";
  else if (!contexto.mercadoAbierto) bloqueo = "mercado cerrado";
  else if (!contexto.ventanaDentro) bloqueo = "fuera de la ventana de órdenes";
  const modo = bloqueo ? "bloqueado" : base;
  const permitidas = base === "normal" ? new Set(["V1", "N2", "V2", "R1", "C1"]) : base === "restringido" ? new Set(["V1", "N2"]) : out ? new Set(["V1", "N2"]) : new Set(["N2"]);

  const res = { fecha, simulacion, modo, motivoModo: bloqueo || motivoModo, objetivo: { pesos: objetivo.pesos, efectivo: objetivo.efectivo, estado: objetivo.estado, perfil: config.perfil },
    valorUSD, efectivoDisponibleUSD: libro ? libro.efectivoUSD : 0, decisiones, ordenes: [], alertas, roles: objetivo.roles };
  if (!libro || !val) return res;

  const fila = sym => (out ? (out.rows || []).find(r => r.symbol === sym) || null : null);
  const valorDe = {}, pendDe = {}, unidadesDe = {}, bidDe = {}, sinPrecio = new Set();
  for (const p of val.posiciones) { valorDe[p.sym] = p.valorUSD; unidadesDe[p.sym] = p.unidades; bidDe[p.sym] = p.precioValido === false ? null : p.precioUSD; if (p.precioValido === false) sinPrecio.add(p.sym); }
  for (const x of libro.pendientes) if (x.lado === "compra") pendDe[x.sym] = (pendDe[x.sym] || 0) + (x.montoUSD || 0);
  // §I: un cierre pendiente solo frena otra venta del mismo símbolo el mismo día; una compra pendiente frena otra compra.
  // Un cierre de otro día que la conciliación vio en ordersForClose sigue en cola en eToro (F.5: aceptada, no se reenvía).
  const ventaPendHoy = new Set(libro.pendientes.filter(x => x.lado === "venta" && x.dia === fecha).map(x => x.sym));
  const ventaEnCola = new Set(libro.pendientes.filter(x => x.lado === "venta" && x.dia !== fecha && x.enCola).map(x => x.sym));
  const compraPend = new Set(libro.pendientes.filter(x => x.lado === "compra").map(x => x.sym));
  // "en cartera" por unidades del libro, nunca por valor (H8)
  const enCartera = sym => libro.posiciones.some(p => p.sym === sym && p.lotes.reduce((a, l) => a + l.unidades, 0) > 0) || compraPend.has(sym);
  const conLotes = sym => libro.posiciones.some(p => p.sym === sym && p.lotes.length);
  // N7: ETF que el corredor siempre pide y que falta en un análisis listo → dato faltante (sin órdenes, contador quieto)
  const faltante = sym => !!out && !fila(sym) && C.ETF_PAID.includes(sym);
  const peso = sym => (valorUSD > 0 ? ((valorDe[sym] || 0) + (pendDe[sym] || 0)) / valorUSD : 0);
  const pesos = objetivo.pesos;
  const confirmados = eventos.filter(e => e.confirmado);
  const claseDe = sym => { const m = mapa.instrumentos[sym]; if (m && isNum(m.clase)) return m.clase; const r = fila(sym); return r ? (r.cls === "stock" ? 5 : 6) : null; };
  const fuera = libro.fueraDelObjetivo || {};
  const senalTxt = r => (r ? `señal ${r.signalLabel || ETIQUETA[r.signal]}, ${r.pct} %` : "sin fila en el análisis de hoy");

  const syms = [...new Set(libro.posiciones.filter(p => p.lotes.length).map(p => p.sym).concat(Object.keys(pendDe), Object.keys(pesos)))];
  for (const sym of syms) {
    const a = peso(sym), w = pesos[sym] || 0, desv = (a - w) * 100, desv2 = Math.round(Math.abs(desv) * 100) / 100, r = fila(sym);
    const d = { sym, regla: null, accion: "mantener", lado: null, pesoActual: a, pesoObjetivo: w, desvPts: Math.round(desv * 100) / 100, montoUSD: null, motivo: "", noticias: [], razonOmision: null };
    const evs = confirmados.filter(e => e.simbolo === sym);
    d.noticias = evs.flatMap(e => e.fuentes);
    const venderTodo = (regla, motivo) => Object.assign(d, { regla, accion: "vender", lado: "venta", montoUSD: valorDe[sym] || 0, motivo, total: true });
    if (enCartera(sym) && faltante(sym)) {
      Object.assign(d, { accion: "omitida", razonOmision: "Sin fila en el análisis de hoy (dato faltante)", motivo: "El análisis de hoy no trae este ETF; no se decide nada" });
      alertas.push(`${sym} falta en el análisis de hoy: sin órdenes y su contador fuera del objetivo no cambia.`);
    } else if (enCartera(sym)) {
      const etf = claseDe(sym) === 6;
      const ev = evs.find(e => !etf || ["suspension", "deslistado"].includes(e.categoria));
      if (out && r && r.signal === 1 && permitidas.has("V1")) venderTodo("V1", `Pasó a Evitar (${r.pct} %)`);
      else if (ev && permitidas.has("N2")) venderTodo("N2", `Evento confirmado: ${ev.categoria} (${(ev.medios || []).slice(0, 2).join(", ")})`);
      else if (!(w > 0)) {
        const n = (fuera[sym] ? fuera[sym].dias : 0) + 1;
        if (permitidas.has("V2") && n >= config.diasSalida) venderTodo("V2", `Fuera del objetivo ${n} días hábiles seguidos (${senalTxt(r)})`);
        else d.motivo = permitidas.has("V2") ? `Fuera del objetivo ${n} de ${config.diasSalida} días hábiles (${senalTxt(r)})` : `Fuera del objetivo; hoy no se cuenta (${motivoModo || "modo " + base})`;
      } else if (desv2 > config.bandaPts && permitidas.has("R1")) {
        const monto = (w - a) * valorUSD;
        Object.assign(d, { regla: "R1", accion: monto > 0 ? "comprar" : "vender", lado: monto > 0 ? "compra" : "venta", montoUSD: Math.abs(monto),
          motivo: `Desviación de ${signo(desv)} pts contra el objetivo (${p1(a * 100)} % → ${p1(w * 100)} %)` });
      } else d.motivo = `Dentro de la banda (desviación ${signo(desv)} pts)`;
    } else if (Math.round(w * 10000) / 100 >= config.nuevoSatelitePct && permitidas.has("C1")) {
      const rol = objetivo.roles[sym] || "Satélite", rf = objetivo.filas[sym];
      Object.assign(d, { regla: "C1", accion: "comprar", lado: "compra", montoUSD: w * valorUSD, motivo: `Entra al objetivo con ${p1(w * 100)} % (${rol}, ${rf ? `señal ${rf.signalLabel || ETIQUETA[rf.signal]} ${rf.pct} %` : "sin señal"})` });
    } else if (w > 0) d.motivo = permitidas.has("C1") ? `Peso ${p1(w * 100)} % menor al mínimo de ${config.nuevoSatelitePct} % para abrir posición` : `Entraría al objetivo con ${p1(w * 100)} %; hoy solo se permiten ventas (${motivoModo || base})`;
    else continue;
    decisiones.push(d);
  }

  // ---- salvaguardas (§6.4) ----
  const omitir = (d, razon) => { d.accion = "omitida"; d.razonOmision = razon; };
  const activas = () => decisiones.filter(d => d.accion === "comprar" || d.accion === "vender");
  for (const d of activas()) {
    if (sinPrecio.has(d.sym)) { omitir(d, "Sin precio válido de eToro hoy"); alertas.push(`${d.sym}: sin precio válido de eToro hoy; no recibe órdenes.`); continue; }
    if (d.lado === "venta" && ventaPendHoy.has(d.sym)) { omitir(d, "Ya tiene un cierre enviado hoy"); continue; }
    if (d.lado === "venta" && ventaEnCola.has(d.sym)) { omitir(d, "Tiene un cierre en cola en eToro"); continue; }
    if (d.lado === "venta" && !conLotes(d.sym)) { omitir(d, "Solo tiene una compra pendiente; no hay posición que cerrar"); continue; }
    if (d.lado === "compra" && compraPend.has(d.sym)) { omitir(d, "Tiene una compra pendiente de confirmar"); continue; }
    if (d.lado === "compra") {
      if (confirmados.some(e => e.simbolo === d.sym)) { d.accion = "vetada"; d.razonOmision = "Evento material confirmado en noticias: se pospone"; continue; }
      const m = mapa.instrumentos[d.sym];
      if (!m || !m.verificadoEl || !isNum(m.instrumentId)) { omitir(d, "Sin instrumento verificado en eToro"); alertas.push(`${d.sym} sin instrumento verificado en eToro`); continue; }
      if (![5, 6].includes(m.clase)) { omitir(d, `Clase de instrumento ${m.clase} no permitida`); continue; }
      if (objetivo.proxyOf[d.sym] && !(cartera.mapa && cartera.mapa.instrumentos[d.sym])) { omitir(d, "Entra por respaldo sin asignación previa en eToro"); continue; }
    }
  }
  const exentoMin = d => d.lado === "venta" && d.total && (d.regla === "V1" || d.regla === "N2");
  for (const d of activas()) if (d.montoUSD < config.minOrdenUSD && !exentoMin(d)) omitir(d, `Menor a US$ ${config.minOrdenUSD}`);
  // efectivo: compras ≤ efectivo + ventas del plan; si no alcanza, todas se escalan por el mismo factor
  const ventas = activas().filter(d => d.lado === "venta").reduce((a, d) => a + d.montoUSD, 0);
  const compras = activas().filter(d => d.lado === "compra");
  const disponible = Math.max(0, libro.efectivoUSD + ventas), pedido = compras.reduce((a, d) => a + d.montoUSD, 0);
  if (pedido > disponible + 0.005) {
    const f = disponible / pedido;
    for (const d of compras) { d.montoUSD *= f; d.escalado = f; if (d.montoUSD < config.minOrdenUSD) omitir(d, "Sin efectivo suficiente del mandato"); }
    alertas.push(`Compras escaladas al ${p1(f * 100)} % por efectivo del mandato (US$ ${disponible.toFixed(2)}).`);
  }
  for (const d of activas()) if (d.lado === "compra") d.montoUSD = piso(d.montoUSD);
  // tope de órdenes por día
  const orden = activas().slice().sort((x, y) => PRIORIDAD[x.regla] - PRIORIDAD[y.regla] || y.montoUSD - x.montoUSD);
  orden.slice(config.maxOrdenesDia).forEach(d => omitir(d, `Tope de ${config.maxOrdenesDia} órdenes por día`));
  // A2.4: si el tope dejó fuera una venta cuyo dinero financiaba compras, las compras se vuelven a escalar (§6.4.3)
  const disponible2 = Math.max(0, libro.efectivoUSD + activas().filter(d => d.lado === "venta").reduce((a, d) => a + d.montoUSD, 0));
  const compras2 = activas().filter(d => d.lado === "compra"), pedido2 = compras2.reduce((a, d) => a + d.montoUSD, 0);
  if (pedido2 > disponible2 + 0.005) {
    const f2 = disponible2 / pedido2;
    for (const d of compras2) { d.montoUSD = piso(d.montoUSD * f2); if (d.montoUSD < config.minOrdenUSD) omitir(d, "Sin efectivo suficiente del mandato"); }
    alertas.push(`Compras escaladas de nuevo al ${p1(f2 * 100)} %: el tope dejó fuera una venta (US$ ${disponible2.toFixed(2)} disponibles).`);
  }
  if (bloqueo) for (const d of activas()) omitir(d, `Bloqueado: ${bloqueo}`);

  // ---- plan de órdenes: ventas primero (V1, N2, V2, R1 a la baja), luego compras (R1 al alza, C1) ----
  const grupo = d => (d.lado === "venta" ? ["V1", "N2", "V2", "R1"].indexOf(d.regla) : 4 + ["R1", "C1"].indexOf(d.regla));
  const plan = activas().slice().sort((x, y) => grupo(x) - grupo(y) || y.montoUSD - x.montoUSD);
  plan.forEach((d, i) => {
    const id = `${fecha}-${d.sym}-${d.regla}`, instrumentId = d.lado === "venta" ? (libro.posiciones.find(p => p.sym === d.sym) || {}).instrumentId : mapa.instrumentos[d.sym].instrumentId;
    let cierres = null;
    if (d.lado === "venta") {
      // cierre total solo para V1/N2/V2 o si, con bid válido, lo que se vende es ≥ 99 % de las unidades (H7)
      const bid = bidDe[d.sym], total = unidadesDe[d.sym] || 0;
      const u = d.total ? null : seis(d.montoUSD / bid);
      cierres = unidadesAVender({ libro, sym: d.sym, unidades: u !== null && u >= 0.99 * total ? null : u }).map(c => ({ positionId: c.positionId, unidades: c.unidades }));
    }
    const nK = d.lado === "venta" ? cierres.length : 1;
    res.ordenes.push({ id, orden: i + 1, sym: d.sym, instrumentId, lado: d.lado, regla: d.regla, montoUSD: d.lado === "compra" ? d.montoUSD : null, cierres, motivo: d.motivo,
      noticias: d.noticias, requestIds: Array.from({ length: nK }, (_, k) => requestIdDe(fecha, id, k)) });
  });
  for (const d of decisiones) { d.montoUSD = d.montoUSD === null ? null : Math.round(d.montoUSD * 100) / 100; delete d.total; delete d.escalado; }
  return res;
}

// Al cerrar el día (§6.3): días hábiles seguidos fuera del objetivo, solo con análisis completo y una vez por día.
// faltantes: símbolos sin fila en el análisis por dato faltante (N7): su contador no cambia.
export function actualizarFuera({ libro, pesos, completo, fecha, faltantes = [] }) {
  const L = copia(libro), prev = L.fueraDelObjetivo || {}, next = {};
  const tenidos = [...new Set(L.posiciones.filter(p => p.lotes.length).map(p => p.sym))];
  for (const sym of tenidos) {
    if (!completo || L.ultimaRutina === fecha || faltantes.includes(sym)) { if (prev[sym]) next[sym] = prev[sym]; continue; }
    if (!(pesos[sym] > 0)) next[sym] = prev[sym] ? { desde: prev[sym].desde, dias: prev[sym].dias + 1 } : { desde: fecha, dias: 1 };
  }
  L.fueraDelObjetivo = next;
  return L;
}
