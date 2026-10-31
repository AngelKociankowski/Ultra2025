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

export const ESQUEMAS = Object.freeze({
  rutinaEstado: d => revisar(d, Object.assign(base("rutinaEstado", 2), {
    fecha: esFecha, estado: v => ["en_curso", "hecha", "degradada", "sin_mercado"].includes(v), paso: isStr, sesion: isStr, inicio: esTs, latido: tsONull, fin: tsONull,
    commit: strONull, modo: v => v === "en_linea" || v === "archivo", ejecucionesAbiertas: a => Array.isArray(a) && a.every(esFecha),
    previo: p => p === null || (isObj(p) && esFecha(p.f) && isStr(p.s) && isStr(p.obj)), escritos: isObj, motivo: strONull,
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
  radarResumen: d => revisar(d, Object.assign(base("radarResumen", 1), {
    f: esFecha, estado: v => ["listo", "parcial", "sin_radar"].includes(v), motivo: strONull, t: esTs,
  }, d && d.estado !== "sin_radar" ? { filas: Array.isArray, obj: Array.isArray, cambios: Array.isArray, s: isStr, reg: isObj, n: isObj } : {})),
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
