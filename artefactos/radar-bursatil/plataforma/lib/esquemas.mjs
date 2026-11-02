// Forma de los documentos propios de db (12b §E.5). Cada validador devuelve la lista de campos que no cuadran ([] = válido).
// Las listas acumulativas (lotes, pend, d, ops) solo se exigen como arreglos: una entrada mala la descarta quien la usa (H15).
const isNum = v => typeof v === "number" && Number.isFinite(v);
const isStr = v => typeof v === "string";
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const numONull = v => v === null || isNum(v);
const strONull = v => v === null || isStr(v);
export const esFecha = v => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
export const esTs = v => isStr(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && Number.isFinite(Date.parse(v));
const tsONull = v => v === null || esTs(v);
const ref6 = r => Array.isArray(r) && r.length === 6 && esFecha(r[0]) && isNum(r[1]) && isNum(r[2]) && numONull(r[3]) && isNum(r[4]) && isNum(r[5]);

function revisar(doc, reglas) {
  const p = [];
  for (const [k, f] of Object.entries(reglas)) if (!f(doc[k])) p.push(k);
  return p;
}
const base = (kind, v) => ({ kind: x => x === kind, v: x => x === v, h: isStr });
export const FUENTES_RADAR = Object.freeze(["rutina", "pagina"]);

export const ESQUEMAS = Object.freeze({
  rutinaEstado: d => revisar(d, Object.assign(base("rutinaEstado", 2), {
    fecha: esFecha, estado: v => ["en_curso", "hecha", "degradada", "sin_mercado"].includes(v), paso: isStr, sesion: isStr, inicio: esTs, latido: tsONull, fin: tsONull,
    commit: strONull, modo: v => v === "en_linea" || v === "archivo", ejecucionesAbiertas: a => Array.isArray(a) && a.every(esFecha),
    // 12c §C.5: previo agrega fa (asOf del análisis) y fu (fuente); los previos sin ellos siguen valiendo
    previo: p => p === null || (isObj(p) && esFecha(p.f) && isStr(p.s) && isStr(p.obj) && (p.fa === undefined || p.fa === null || esFecha(p.fa)) && (p.fu === undefined || p.fu === null || FUENTES_RADAR.includes(p.fu))), escritos: isObj, motivo: strONull,
  })),
  rutinaConfig: d => revisar(d, Object.assign(base("rutinaConfig", 2), {
    operar: v => typeof v === "boolean", perfil: isStr, bandaPts: isNum, minOrdenUSD: isNum, nuevoSatelitePct: isNum, diasSalida: isNum, maxOrdenesDia: isNum,
    ventanaET: v => isObj(v) && isStr(v.desde) && isStr(v.hasta), noticiasVentanaH: isNum, tolPrecioPct: isNum, activadoEl: strONull,
  })),
  carteraLibro: d => revisar(d, Object.assign(base("carteraLibro", 2), {
    at: esTs, mandato: m => isObj(m) && esFecha(m.inicio) && isNum(m.baseMXN) && isNum(m.fx0) && isNum(m.baseUSD) && isStr(m.perfil),
    efectivo: isNum, realizado: isNum, lotes: Array.isArray, pend: Array.isArray, fuera: isObj, precios: isObj,
    refs: r => isObj(r) && ["base", "dia", "sem", "mes", "anio"].every(k => ref6(r[k])),
  })),
  etoroMapa: d => revisar(d, Object.assign(base("etoroMapa", 2), {
    at: esTs, i: o => isObj(o) && Object.values(o).every(x => Array.isArray(x) && x.length === 4 && isNum(x[0]) && isNum(x[1])), rech: isObj,
  })),
  bitacoraMes: d => revisar(d, Object.assign(base("bitacoraMes", 1), { mes: v => isStr(v) && /^\d{4}-\d{2}$/.test(v), d: Array.isArray })),
  carteraPunto: d => revisar(d, Object.assign(base("carteraPunto", 1), {
    f: esFecha, t: v => isStr(v) && /^\d{2}:\d{2}$/.test(v), v_: isNum, vm: numONull, e: isNum, fx: numONull, spy: numONull, i: isNum, im: numONull, fl: isNum,
  })),
  // v:1 (12b) y v:2 (12c §C.5: + fu, fa, ant)
  radarResumen: d => revisar(d, Object.assign({ kind: x => x === "radarResumen", v: x => x === 1 || x === 2, h: isStr,
    f: esFecha, estado: v => ["listo", "parcial", "sin_radar"].includes(v), motivo: strONull, t: esTs,
  }, d && d.estado !== "sin_radar" ? { filas: Array.isArray, obj: Array.isArray, cambios: Array.isArray, s: isStr, reg: isObj, n: isObj } : {},
  d && d.v === 2 ? { fu: v => FUENTES_RADAR.includes(v), fa: esFecha, ant: v => Number.isInteger(v) && v >= 0 } : {})),
  bitacora: d => revisar(d, Object.assign(base("bitacora", 2), {
    f: esFecha, t: esTs, estado: v => ["completa", "parcial", "degradada", "sin_mercado"].includes(v), sim: v => typeof v === "boolean", modo: isStr,
    mercado: isObj, radar: isObj, cartera: isObj, rend: isObj, comp: isObj, notas: Array.isArray, eventos: Array.isArray, vetos: Array.isArray,
    dec: Array.isArray, ops: Array.isArray, alertas: a => Array.isArray(a) && a.every(isStr), errores: Array.isArray, aviso: isStr,
  })),
  carteraOps: d => revisar(d, Object.assign(base("carteraOps", 2), { f: esFecha, ops: Array.isArray })),
  ejecucion: d => revisar(d, Object.assign(base("ejecucion", 1), {
    f: esFecha, sesion: isStr, armado: esTs, fin: tsONull, antes: a => isObj(a) && Array.isArray(a.pos) && Array.isArray(a.ord), lineas: Array.isArray, res: Array.isArray,
  })),
});

// id → kind esperado (null = no es un documento que la rutina conozca)
export function kindDeId(id) {
  if (id === "rutina-estado") return "rutinaEstado";
  if (id === "rutina-config") return "rutinaConfig";
  if (id === "cartera-libro") return "carteraLibro";
  if (id === "etoro-mapa") return "etoroMapa";
  if (/^bitacora-mes-\d{4}-\d{2}$/.test(id)) return "bitacoraMes";
  if (/^punto-\d{4}-\d{2}-\d{2}$/.test(id)) return "carteraPunto";
  if (/^radar-\d{4}-\d{2}-\d{2}$/.test(id)) return "radarResumen";
  if (/^bitacora-\d{4}-\d{2}-\d{2}$/.test(id)) return "bitacora";
  if (/^ops-\d{4}-\d{2}-\d{2}$/.test(id)) return "carteraOps";
  if (/^ejecucion-\d{4}-\d{2}-\d{2}$/.test(id)) return "ejecucion";
  if (/^feriados-\d{4}$/.test(id)) return "feriados";
  return null;
}
// Documentos de la página: la rutina nunca los lee ni los escribe (salvo leer feriados-<año>)
export const esDePagina = id => /^(dia-|indice$|corrida$|contador-|vivo$|plan$|preferencias$)/.test(id);

export function validarDoc(id, doc) {
  const kind = kindDeId(id);
  if (!kind) return [`id desconocido: ${id}`];
  if (!isObj(doc) || doc.kind !== kind) return [`kind: se esperaba ${kind}`];
  if (kind === "feriados") return Array.isArray(doc.rows) ? [] : ["rows"];
  return ESQUEMAS[kind](doc);
}

// validOutput de ui.js v5.5.1 (líneas 231–250), copiado literal; CFG e isNum vienen del núcleo de la página (12c §C.3: antes en
// pruebas/validar-salida.mjs). Valida un AnalysisOutput completo (corrida propia o análisis guardado por la página).
export function crearValidarSalida(C) {
  const CFG = C.CONFIG, isNum = C.isNum;
  const isCount = v => Number.isInteger(v) && v >= 0;
  const isStr = v => typeof v === "string", numOrNull = v => v === null || isNum(v), isObj = v => !!v && typeof v === "object";
  const arrOf = f => a => Array.isArray(a) && a.every(f), strs = arrOf(isStr);
  const shape = spec => o => isObj(o) && Object.keys(spec).every(k => spec[k](o[k]));
  const validRow = shape({
    symbol: isStr, display: isStr, name: isStr, cls: isStr, clsLabel: isStr, signalLabel: isStr, confidence: isStr,
    price: isNum, priceTime: isNum, S: isNum, alpha: isNum, coverage: isNum, changePct: numOrNull, pBeat: numOrNull, pBase: numOrNull, pUp: numOrNull,
    group: v => v === "acciones" || v === "otros", ref: v => v === "sp500" || v === "sube", pRef: isNum, pct: v => isCount(v) && v >= 35 && v <= 65, factorPct: v => isCount(v) && v <= 100,
    capReason: v => v === null || isStr(v), capShort: v => v === null || isStr(v), pUpStock: numOrNull, expRet: isNum, medRet: isNum,
    signal: v => [1, 2, 3].includes(v), capReasons: strs, tags: strs, cone: shape({ lo: isNum, med: isNum, hi: isNum }),
    drivers: shape({ pos: arrOf(shape({ label: isStr })), neg: arrOf(shape({ label: isStr })) }), flags: arrOf(shape({ text: isStr })),
    penalties: arrOf(shape({ text: isStr, z: isNum })), blocks: v => v === null || arrOf(shape({ key: isStr, label: isStr, weight: isNum }))(v),
    components: arrOf(shape({ code: isStr, block: isStr, label: isStr, contrib: isNum })), fundamentals: v => v === null || isObj(v), tech: isObj,
    series: arrOf(x => Array.isArray(x) && isNum(x[0]) && isNum(x[1])),
  });
  const validOutput = shape({
    asOf: v => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v), plan: v => !!CFG.K[v], nowMs: isNum, rows: arrOf(validRow), notes: strs,
    excluded: arrOf(shape({ symbol: isStr, reason: isStr })), rest: arrOf(shape({ symbol: isStr, display: isStr, name: isStr, reason: isStr, S1: numOrNull, price: numOrNull, changePct: numOrNull })),
    counts: shape(Object.fromEntries(["universe", "eligible", "quoted", "finalists", "ranked", "nonStock"].map(k => [k, v => v === undefined || isCount(v)]))), regime: shape({ state: isStr, label: isStr, weights: arrOf(isNum) }),
  });
  return validOutput;
}
