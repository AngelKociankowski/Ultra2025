// Datasets del dashboard "Cartera Radar" (12c §F.1): se arman con lo que la rutina ya calculó y guardó; la página solo los formatea.
// Puro salvo leer reporte/datasets.json. Ningún dataset lleva identificadores de eToro (cuenta, orden, posición), token ni llaves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clasificar } from "./rendimientos.mjs";
import { diasEntre, fechaHoraET } from "./tiempo.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATASETS = JSON.parse(fs.readFileSync(path.join(RAIZ, "reporte", "datasets.json"), "utf8"));
export const MAX_BYTES = 8 * 1024 * 1024;
const isNum = v => typeof v === "number" && Number.isFinite(v);
const r2 = x => (isNum(x) ? Math.round(x * 100) / 100 : null), r4 = x => (isNum(x) ? Math.round(x * 10000) / 10000 : null), r6 = x => (isNum(x) ? Math.round(x * 1e6) / 1e6 : null);
const nOrNull = x => (isNum(x) ? x : null);

export const REGLA_TEXTO = { V1: "Pasó a Evitar", N2: "Evento confirmado en noticias", V2: "Fuera del objetivo", R1: "Rebalanceo", C1: "Entra al objetivo",
  INICIAL: "Cartera inicial", EXTERNA: "Cerrada fuera de la rutina" };
const SENAL = { 1: "Evitar", 2: "Mantener", 3: "Compra" };
const ACCION = { comprar: "Comprar", vender: "Vender", mantener: "Mantener", vetada: "Vetada", omitida: "Omitida" };
const ESTADO = { simulada: "Simulada", no_enviada: "No enviada", rechazada: "Rechazada", aceptada: "Enviada, sin ejecutar", incierta: "Sin confirmar", ejecutada: "Ejecutada", no_ejecutada: "No ejecutada" };
const FUENTE = { rutina: "Corrida propia (FMP)", pagina: "Página del Radar" };
const ROL = { "Núcleo": "Núcleo", "Satélite": "Satélite" };

// ---- validación contra datasets.json (columnas exactas, tipos, nulos, clave única, < 8 MB) ----
const TIPO = { t: v => typeof v === "string", n: isNum, e: Number.isInteger, b: v => typeof v === "boolean" };
export function validarDataset(id, filas) {
  const def = DATASETS.find(d => d.id === id);
  if (!def) return [`dataset desconocido: ${id}`];
  if (!Array.isArray(filas)) return [`${id}: no es un arreglo`];
  const p = [], nombres = def.columnas.map(c => c.nombre), claves = new Set(), clave = def.clave.split(",");
  filas.forEach((f, i) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) { p.push(`${id}[${i}]: no es objeto`); return; }
    const k = Object.keys(f);
    if (k.length !== nombres.length || !nombres.every(n => k.includes(n))) p.push(`${id}[${i}]: columnas distintas`);
    for (const c of def.columnas) {
      const v = f[c.nombre];
      if (v === null ? !c.nulo : !TIPO[c.tipo](v)) p.push(`${id}[${i}].${c.nombre}: ${JSON.stringify(v)} no es ${c.tipo}${c.nulo ? "?" : ""}`);
    }
    const kv = JSON.stringify(clave.map(n => f[n]));
    if (claves.has(kv)) p.push(`${id}[${i}]: clave repetida ${kv}`);
    claves.add(kv);
  });
  if (Buffer.byteLength(JSON.stringify(filas)) >= MAX_BYTES) p.push(`${id}: pesa 8 MB o más`);
  return p;
}

// S1 (tester ronda 5): los textos del día pueden nombrar posiciones u órdenes de eToro por su número; en el dashboard (archivos que
// lee cualquiera que pueda abrirlo) van sin él: "la posición de SPY", "la orden", y cualquier otro número de 9+ dígitos → "[id]"
export function sinIdsEToro(texto) {
  const sym = (String(texto).match(/^([A-Z0-9^.=-]{1,12}): /) || [])[1];
  return String(texto)
    .replace(/\b([Pp])osición \d{6,} \(orden \d{6,}\)/g, (m, p) => (p === "P" ? "Una posición" : "una posición"))
    .replace(/\b([Pp])osición \d{6,}/g, (m, p) => `${p}osición${sym ? ` de ${sym}` : ""}`)
    .replace(/\b(la|una|su) orden \d{6,}/g, "$1 orden")
    .replace(/\d{9,}/g, "[id]");
}
const limpiarFilas = filas => filas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" && k !== "url" ? sinIdsEToro(v) : v])));

// e: { fecha, bit (bitácora final), libro (cartera.json → libro), valuacion, composicion, analisis, resumenRadar, decis, ops: {id: op} (todas,
//      las de hoy ya encima), puntos: [punto docs], avisoFallas: [texto], alertasReporte: [texto], notas: { validas, eventos } }
export function armarDatasets(e) {
  const out = e.analisis && e.analisis.out ? e.analisis.out : null;
  const fila = sym => (out ? out.rows.find(r => r.symbol === sym) || null : null);
  const pesosObj = e.decis && e.decis.objetivo && e.decis.objetivo.estado === "ok" ? e.decis.objetivo.pesos : null, roles = (e.decis && e.decis.roles) || {};
  const v = e.valuacion, valor = v ? v.valorUSD : null;

  const alertas = [...((e.bit && e.bit.alertas) || []).map(t => ["Alerta", t]), ...(e.alertasReporte || []).map(t => ["Alerta", t]), ...(e.avisoFallas || []).map(t => ["Falla", t])]
    .map(([tipo, texto], i) => ({ n: i + 1, fecha: e.fecha, tipo, texto: String(texto) }));

  const posiciones = [];
  if (v) {
    const syms = [...new Set(v.posiciones.map(p => p.sym).concat(e.libro.pendientes.filter(x => x.lado === "compra").map(x => x.sym)))];
    for (const sym of syms) {
      const p = v.posiciones.find(x => x.sym === sym), pend = e.libro.pendientes.filter(x => x.lado === "compra" && x.sym === sym).reduce((s, x) => s + (x.montoUSD || 0), 0);
      const f = fila(sym), [clase, sector, region] = clasificar(sym, f), val = (p ? p.valorUSD : 0) + pend, peso = valor > 0 ? val / valor : 0;
      const obj = pesosObj ? pesosObj[sym] || 0 : null;
      posiciones.push({ simbolo: sym, nombre: f ? f.name : sym, clase, sector, region, donde: "eToro Demo", unidades: p ? r6(p.unidades) : null, costo_usd: r2((p ? p.costoUSD : 0) + pend),
        precio_usd: p ? nOrNull(p.precioUSD) : null, valor_usd: r2(val), gp_usd: p ? r2(p.gpUSD) : null, gp_pct: p && isNum(p.gpPct) ? r6(p.gpPct / 100) : null, peso: r6(peso),
        peso_objetivo: obj === null ? null : r6(obj), desv_pts: obj === null ? null : r2((peso - obj) * 100), senal: f ? SENAL[f.signal] || "Sin dato" : "Sin dato", prob_pct: f ? f.pct : null,
        rol: pesosObj && pesosObj[sym] > 0 ? ROL[roles[sym]] || "Satélite" : "Fuera del objetivo" });
    }
    const ef = v.efectivoUSD;
    posiciones.push({ simbolo: "EFECTIVO", nombre: "Efectivo del mandato", clase: "Efectivo", sector: "—", region: "Dólares", donde: "eToro Demo", unidades: null, costo_usd: r2(ef), precio_usd: null,
      valor_usd: r2(ef), gp_usd: null, gp_pct: null, peso: valor > 0 ? r6(ef / valor) : 0, peso_objetivo: e.decis && isNum(e.decis.objetivo && e.decis.objetivo.efectivo) && pesosObj ? r6(e.decis.objetivo.efectivo) : null,
      desv_pts: null, senal: "—", prob_pct: null, rol: "Efectivo" });
  }

  const composicion = [];
  if (v && e.composicion) {
    const ejes = [["Clase", e.composicion.clase], ["Sector", e.composicion.sector], ["Región", e.composicion.region],
      ["Dónde está", { "Posiciones en eToro Demo": valor > 0 ? v.posiciones.reduce((s, p) => s + p.valorUSD, 0) / valor : 0, "Compras por confirmar": valor > 0 ? (v.pendientesUSD || 0) / valor : 0, "Efectivo del mandato": valor > 0 ? v.efectivoUSD / valor : 0 }]];
    for (const [eje, m] of ejes) Object.entries(m || {}).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1])
      .forEach(([grupo, w], i) => composicion.push({ eje, grupo, peso: r6(w), valor_usd: r2(w * valor), orden: i + 1 }));
  }

  const refs = e.libro ? e.libro.refs : null, base = refs && refs.base;
  const evolucion = [];
  if (base) {
    const porFecha = new Map([[base[0], { f: base[0], v_: base[1], vm: base[2], spy: base[3], i: base[4], im: base[5] }]]);
    for (const p of e.puntos || []) if (p && p.f >= base[0]) porFecha.set(p.f, p);
    for (const p of [...porFecha.values()].sort((a, b) => (a.f < b.f ? -1 : 1))) {
      if (!isNum(p.v_) || !isNum(p.vm) || !isNum(p.i) || !isNum(p.im)) continue;
      evolucion.push({ fecha: p.f, valor_usd: r2(p.v_), valor_mxn: r2(p.vm), idx_usd: r2(100 * p.i), idx_mxn: r2(100 * p.im), idx_spy: isNum(p.spy) && isNum(base[3]) ? r2(100 * p.spy / base[3]) : null,
        idx_meta15: r2(100 * Math.pow(1.15, diasEntre(base[0], p.f) / 365.25)) });
    }
  }

  const radar = [];
  if (out) {
    const tenidos = new Set(posiciones.filter(p => p.simbolo !== "EFECTIVO").map(p => p.simbolo)), quiero = new Set([...tenidos, ...Object.keys(pesosObj || {}), ...out.rows.slice(0, 15).map(r => r.symbol)]);
    out.rows.forEach((r, i) => {
      if (!quiero.has(r.symbol)) return;
      const imp = r.drivers && r.drivers.pos && r.drivers.pos[0] ? r.drivers.pos[0].label : null;
      radar.push({ rango: i + 1, simbolo: r.symbol, nombre: r.name, clase: clasificar(r.symbol, r)[0], senal: SENAL[r.signal] || "Sin dato", prob_pct: r.pct, referencia: r.ref === "sp500" ? "ganarle al S&P 500" : "subir",
        precio: r.price, cambio_dia: isNum(r.changePct) ? r6(r.changePct / 100) : null, rend_esperado_3m: nOrNull(r6(r.expRet)), en_cartera: tenidos.has(r.symbol),
        peso_objetivo: pesosObj && pesosObj[r.symbol] > 0 ? r6(pesosObj[r.symbol]) : null, impulsor: imp });
    });
  }

  const decisiones = ((e.decis && e.decis.decisiones) || []).map(d => ({ simbolo: d.sym, regla: d.regla || "—", regla_texto: d.regla ? REGLA_TEXTO[d.regla] || d.regla : "Sin regla",
    accion: ACCION[d.accion] || "Mantener", peso_actual: nOrNull(r6(d.pesoActual)), peso_objetivo: nOrNull(r6(d.pesoObjetivo)), desv_pts: nOrNull(r2(d.desvPts)), monto_usd: nOrNull(r2(d.montoUSD)),
    motivo: [d.motivo, d.razonOmision].filter(Boolean).join(" — ") || "—", simulacion: !!e.decis.simulacion }));

  const operaciones = Object.values(e.ops || {}).sort((a, b) => (a.id < b.id ? 1 : -1)).map(o => ({ id: o.id, fecha: o.id.slice(0, 10), simbolo: o.sym, lado: o.lado === "v" ? "Venta" : "Compra",
    regla: o.regla || "—", regla_texto: REGLA_TEXTO[o.regla] || o.regla || "—", estado: ESTADO[o.est] || "No enviada", monto_usd: nOrNull(r2(o.usdej ?? o.usd)), unidades: nOrNull(r6(o.uej ?? o.u)),
    precio: nOrNull(o.px), realizado_usd: nOrNull(r2(o.real)), motivo: String(o.mot || o.err || "—"), simulacion: !!o.sim }));

  const confirmado = n => !!(n.evento && ((e.notas && e.notas.eventos) || []).some(x => x.confirmado && x.simbolo === n.evento.simbolo && x.categoria === n.evento.categoria));
  const noticias = ((e.notas && e.notas.validas) || []).slice(0, 8).map((n, i) => ({ id: String(n.id || `n${i + 1}`), fecha: n.fecha, medio: n.medio, titulo: n.titulo, url: n.url, tema: n.tema,
    simbolos: (n.simbolos || []).join(", "), resumen: n.resumen || "", evento: n.evento ? `${n.evento.categoria} · ${n.evento.simbolo}` : null, confirmado: confirmado(n) }));

  const resumen = [];
  if (v && e.bit && e.bit.rend && e.bit.rend.usd) {
    const R = e.bit.rend, u = R.usd, m = R.mxn || [], s = R.spy || [], meta = R.meta || [], an = e.analisis || {}, rr = e.resumenRadar || {};
    const conRadar = !!out && ["rutina", "pagina"].includes(an.fuente);
    resumen.push({ fecha: e.fecha, hora_et: fechaHoraET(Date.parse(e.bit.t)).hora, valor_usd: r2(valor), valor_mxn: r2(v.valorMXN), tipo_cambio: v.fx, efectivo_usd: r2(v.efectivoUSD),
      rend_dia_usd: nOrNull(u[0]), rend_dia_mxn: nOrNull(m[0]), rend_semana_usd: nOrNull(u[1]), rend_mes_usd: nOrNull(u[2]), rend_anio_usd: nOrNull(u[3]), rend_inicio_usd: u[4], rend_inicio_mxn: m[4],
      rend_inicio_spy: nOrNull(s[4]), vs_spy_pts: isNum(u[4]) && isNum(s[4]) ? r2((u[4] - s[4]) * 100) : null, meta15_valor_usd: meta[0], meta15_dif_pts: meta[1], meta15_dif_pts_mxn: meta[3],
      anualizado_usd: nOrNull(u[5]), aviso_anualizado: R.aviso || null, inicio: e.libro.mandato.inicio, base_usd: e.libro.mandato.baseUSD, base_mxn: e.libro.mandato.baseMXN,
      radar_fecha: conRadar ? out.asOf : null, radar_fuente: conRadar ? FUENTE[an.fuente] : "Sin Radar", radar_antiguedad: conRadar && Number.isInteger(an.antiguedad) ? an.antiguedad : null,
      regimen: conRadar && rr.reg ? rr.reg.l || null : null, simulacion: !!e.bit.sim, estado_dia: e.bit.estado, n_posiciones: posiciones.filter(p => p.simbolo !== "EFECTIVO").length,
      n_operaciones: operaciones.filter(o => o.fecha === e.fecha).length, n_alertas: alertas.length });
  }
  return Object.fromEntries(Object.entries({ resumen, posiciones, composicion, evolucion, radar, decisiones, operaciones, noticias, alertas }).map(([id, filas]) => [id, limpiarFilas(filas)]));
}

// DR2 (medido el 4 y 5-nov): `list` de `datasets` del tablero ya no se puede guardar con out_dir (son documentos que pueden haber
// escrito otros). Sin out_dir la respuesta trae un encabezado, `N documents from collection "datasets":` y un JSON por línea
// {id, data, version, updatedAt} entre `=== BEGIN ARTIFACT DB <hex> — … ===` y `=== END ARTIFACT DB <hex> ===`. Solo cuentan las
// líneas entre una marca de cada una con el mismo hex; de cada una se usan `id` (uno de los 9) y `version` (entero ≥ 1), nunca
// `data`. Lo demás del texto (encabezado, notas) se ignora. Devuelve { id: version } o null si algo no cuadra.
const IDS_DATASETS = new Set(DATASETS.map(d => d.id));
const RE_INICIO = /^=== BEGIN ARTIFACT DB ([0-9a-f]+) — .* ===$/, RE_FIN = /^=== END ARTIFACT DB ([0-9a-f]+) ===$/;
export function versionesDeLista(texto) {
  if (typeof texto !== "string") return null;
  const L = texto.split("\n").map(l => l.replace(/\r$/, ""));
  const vacia = L.some(l => l === 'No documents matched in collection "datasets".' || /^0 documents from collection "datasets"/.test(l));
  const marcas = L.map((l, i) => [l, i]).filter(([l]) => /^===.*ARTIFACT DB/.test(l));
  if (!marcas.length) return vacia ? {} : null;
  const ini = marcas.filter(([l]) => RE_INICIO.test(l)), fin = marcas.filter(([l]) => RE_FIN.test(l));
  if (marcas.length !== 2 || ini.length !== 1 || fin.length !== 1 || ini[0][1] > fin[0][1] || ini[0][0].match(RE_INICIO)[1] !== fin[0][0].match(RE_FIN)[1]) return null;
  const v = {};
  for (const l of L.slice(ini[0][1] + 1, fin[0][1])) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch (e) { return null; }
    if (!o || typeof o !== "object" || Array.isArray(o) || !IDS_DATASETS.has(o.id) || o.id in v || !Number.isInteger(o.version) || o.version < 1) return null;
    v[o.id] = o.version;
  }
  // el encabezado dice cuántos documentos vienen: tiene que cuadrar con las líneas leídas
  const cab = L.map(l => l.match(/^(\d+) documents? from collection "datasets":$/)).find(Boolean);
  if (!cab || Number(cab[1]) !== Object.keys(v).length) return null;
  return v;
}
