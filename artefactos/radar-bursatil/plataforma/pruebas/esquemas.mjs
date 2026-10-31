// Validadores de forma de los documentos de db de la plataforma (12-plan §5.9). Devuelven la lista de problemas ([] = válido).
const isNum = v => typeof v === "number" && Number.isFinite(v);
const isStr = v => typeof v === "string";
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const numONull = v => v === null || isNum(v);
const fecha = v => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function revisar(doc, reglas) {
  const p = [];
  for (const [k, f] of Object.entries(reglas)) if (!f(doc[k])) p.push(k);
  return p;
}
const base = kind => ({ kind: v => v === kind, v: v => v === 1 });

const lote = l => isObj(l) && isNum(l.positionId) && numONull(l.orderId) && isNum(l.unidades) && isNum(l.costoUSD) && isStr(l.abiertaEl);
const pendiente = p => isObj(p) && isStr(p.opId) && numONull(p.orderId) && isStr(p.sym) && isNum(p.instrumentId) && ["compra", "venta"].includes(p.lado) && numONull(p.montoUSD) && isStr(p.enviadaEl);
const op = o => isObj(o) && isStr(o.id) && fecha(o.fecha) && isStr(o.hora) && isStr(o.sym) && ["compra", "venta"].includes(o.lado)
  && ["INICIAL", "V1", "N2", "V2", "R1", "C1", "EXTERNA"].includes(o.regla) && isStr(o.motivo)
  && ["simulada", "enviada", "pendiente", "ejecutada", "rechazada", "cancelada", "desconocida"].includes(o.estado) && Array.isArray(o.positionIds) && typeof o.simulacion === "boolean";

export const ESQUEMAS = {
  carteraLibro: d => revisar(d, Object.assign(base("carteraLibro"), {
    at: isNum, mandato: m => isObj(m) && m.capitalBaseUSD === 31959.09 && m.capitalBaseMXN === 600000, efectivoUSD: v => isNum(v) && v >= -0.01, realizadoUSD: isNum,
    posiciones: a => Array.isArray(a) && a.every(p => isStr(p.sym) && isNum(p.instrumentId) && Array.isArray(p.lotes) && p.lotes.every(lote)),
    pendientes: a => Array.isArray(a) && a.every(pendiente), fueraDelObjetivo: isObj, operadoHoy: o => isObj(o) && Array.isArray(o.syms),
    ultimaValuacion: o => isObj(o) && isNum(o.valorUSD), ultimaRutina: v => v === null || fecha(v),
  })),
  carteraOps: d => revisar(d, Object.assign(base("carteraOps"), { mes: v => isStr(v) && /^\d{4}-\d{2}$/.test(v), at: isNum, ops: a => Array.isArray(a) && a.every(op) })),
  carteraSerie: d => revisar(d, Object.assign(base("carteraSerie"), { anio: isNum, at: isNum,
    base: b => isObj(b) && fecha(b.fecha) && isNum(b.valorUSD) && isNum(b.fx) && numONull(b.spy),
    puntos: a => Array.isArray(a) && a.every(p => fecha(p.f) && isNum(p.v) && isNum(p.e) && isNum(p.fx) && numONull(p.spy) && isNum(p.fl)) })),
  etoroMapa: d => revisar(d, Object.assign(base("etoroMapa"), { at: isNum, instrumentos: o => isObj(o) && Object.values(o).every(x => isNum(x.instrumentId) && isNum(x.clase)), rechazados: isObj })),
  rutinaConfig: d => revisar(d, Object.assign(base("rutinaConfig"), { operar: v => typeof v === "boolean", perfil: isStr, bandaPts: isNum, ventanaET: isObj, podar: v => typeof v === "boolean" })),
  rutinaEstado: d => revisar(d, Object.assign(base("rutinaEstado"), { fecha, estado: v => ["en_curso", "hecha", "degradada", "fallida", "sin_mercado"].includes(v),
    paso: v => ["preparar", "radar", "cartera", "noticias", "decidir", "ejecutando", "cerrar"].includes(v), inicio: isNum, fin: numONull, intentos: isNum,
    ejecucion: e => isObj(e) && typeof e.simulacion === "boolean" && Array.isArray(e.plan) })),
  bitacora: d => revisar(d, Object.assign(base("bitacora"), { fecha, at: isNum, sesion: s => isObj(s) && s.version === "1.0.0" && typeof s.simulacion === "boolean",
    estado: v => ["completa", "parcial", "degradada", "sin_mercado"].includes(v), mercado: isObj,
    radar: r => isObj(r) && ["rutina", "navegador", "ninguna"].includes(r.fuente) && Array.isArray(r.cambios), senales: a => Array.isArray(a) && a.every(s => Array.isArray(s) && s.length === 3),
    objetivo: a => Array.isArray(a) && a.every(o => isStr(o.id) && isNum(o.peso)), cartera: isObj, rendimientos: r => isObj(r) && isObj(r.usd) && isObj(r.mxn) && isObj(r.spy),
    noticias: n => isObj(n) && Array.isArray(n.notas) && Array.isArray(n.eventos) && Array.isArray(n.vetos) && isNum(n.descartadas),
    decisiones: Array.isArray, operaciones: a => Array.isArray(a) && a.every(isStr), alertas: a => Array.isArray(a) && a.every(isStr), errores: Array.isArray, aviso: isStr })),
  bitacoraIndice: d => revisar(d, Object.assign(base("bitacoraIndice"), { at: isNum, dias: a => Array.isArray(a) && a.length <= 400 && a.every(x => fecha(x.f) && isStr(x.estado) && typeof x.sim === "boolean") })),
  contador: d => revisar(d, Object.assign(base("contador"), { dev: v => v === "drutina0001", dateET: fecha, used: v => Number.isInteger(v) && v >= 0,
    byCat: b => isObj(b) && Object.values(b).every(Number.isInteger) && Object.keys(b).length === 9, limitHit: v => v === false })),
};
export const esquemaDe = doc => (doc && ESQUEMAS[doc.kind] ? ESQUEMAS[doc.kind](doc) : [`kind desconocido: ${doc && doc.kind}`]);
