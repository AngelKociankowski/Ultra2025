// Capa de db de la rutina (12b §E): canónico + integridad, importar lecturas, armar escrituras con ifVersion, registrar
// resultados (409, escrituras parciales, un reintento) y medir el presupuesto de copia. Solo toca la carpeta de trabajo:
// las llamadas a db las hace la sesión copiando los archivos que arma este módulo.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DB_SLUG, DB_RUTA, ARTEFACTO_URL, COLECCION_ARCHIVO, ACCION_REEMPLAZO, DOC_MAX, DOC_TOPES, PRESUPUESTO_DIA } from "./constantes.mjs";
import { validarDoc, kindDeId, esDePagina } from "./esquemas.mjs";
import { rutas, leerJson, escribirJson, ErrorArchivo } from "./archivos.mjs";

// ---- canónico, integridad y precisión (§E.3) ----
export function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map(k => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
const sinH = doc => { const o = Object.assign({}, doc); delete o.h; return o; };
export const hDe = doc => crypto.createHash("sha256").update(canon(sinH(doc))).digest("hex").slice(0, 16);
export const conH = doc => Object.assign(sinH(doc), { h: hDe(doc) });
export const hOk = doc => !!doc && typeof doc.h === "string" && doc.h === hDe(doc);

export const red = (x, d) => { if (typeof x !== "number" || !Number.isFinite(x)) return x; const r = Number(x.toFixed(d)); return Object.is(r, -0) ? 0 : r; };
export const usd = x => red(x, 2);
export const u6 = x => red(x, 6);
export const fx4 = x => red(x, 4);
export const p4 = x => red(x, 4);
export const r6 = x => red(x, 6);
// índices encadenados i/im: 8 decimales (con 6, el redondeo acumulado pasa de 1e-6 en 4 días; ver reporte 16, desvío)
export const i8 = x => red(x, 8);
export const precio = x => (typeof x === "number" ? red(x, Math.abs(x) >= 1 ? 2 : 4) : x);
export const ts = ms => (Number.isFinite(ms) ? new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z") : null);
export const bytes = x => Buffer.byteLength(JSON.stringify(x), "utf8");

// ---- Lectura (§D.2) ----
export function lectura(id, { obligatoria = true, dirAbs }) {
  return { id, obligatoria,
    en_linea: { herramienta: "mcp__claude-artifacts__db_get", args: { slug: DB_SLUG, path: `${DB_RUTA}/${id}` } },
    archivo: { herramienta: "ArtifactData", args: { action: "get", url: ARTEFACTO_URL, collection: COLECCION_ARCHIVO, doc_id: id, out_dir: path.join(dirAbs, "entrada", "archivo") } } };
}

const rutaVersiones = dir => path.join(rutas(dir).entradaDb, "_versiones.json");
export const leerVersiones = dir => leerJson(rutaVersiones(dir)) || {};
const escribirVersiones = (dir, v) => escribirJson(rutaVersiones(dir), v);

// ids que los pasos pidieron como obligatorios (listas de lectura escritas en trabajo/)
function requeridosDe(dir) {
  const out = new Set();
  for (const f of ["lista.json", "leer-mas.json", "releer.json", "verificar.json"]) {
    let j = null;
    try { j = leerJson(path.join(rutas(dir).trabajo, f)); } catch (e) { j = null; }
    for (const l of (j && j.lecturas) || []) if (l && l.obligatoria) out.add(l.id);
  }
  return out;
}

// ---- importar (§E.2): entrada/lecturas.jsonl → entrada/db/<id>.json, _versiones.json, _fallos.json ----
export function importar(dir, { requeridos = null } = {}) {
  const R = rutas(dir), archivoL = path.join(R.entrada, "lecturas.jsonl"), marca = path.join(R.entradaDb, "_importado.json");
  fs.mkdirSync(R.entradaDb, { recursive: true });
  const lineas = fs.existsSync(archivoL) ? fs.readFileSync(archivoL, "utf8").split("\n").filter(l => l.trim()) : [];
  const hechas = (leerJson(marca) || { lineas: 0 }).lineas;
  const ultima = new Map(), malas = [];
  lineas.slice(hechas).forEach((l, i) => {
    let o = null;
    try { o = JSON.parse(l); } catch (e) { malas.push(hechas + i + 1); return; }
    if (!o || typeof o.id !== "string") { malas.push(hechas + i + 1); return; }
    ultima.set(o.id, o);
  });
  const ver = leerVersiones(dir);
  const res = { ok: [], no_existen: [], fallos: [], corruptos: [], ignorados: [], bytes: 0, lineasMalas: malas };
  for (const [id, o] of ultima) {
    if (esDePagina(id) || !kindDeId(id)) { res.ignorados.push(id); continue; }
    const previo = ver[id] || {};
    const poner = x => { ver[id] = Object.assign({ estado: null, version: null, h: null, escritoEn: previo.escritoEn || null }, x); };
    if (o.error !== undefined) { poner({ estado: "fallo", codigo: String(o.error).slice(0, 80) }); res.fallos.push(id); continue; }
    if (o.exists === false) { poner({ estado: "no_existe" }); res.no_existen.push(id); fs.rmSync(path.join(R.entradaDb, id + ".json"), { force: true }); continue; }
    if (o.exists !== true || !Number.isInteger(o.version) || o.version < 1) { poner({ estado: "fallo", codigo: "linea_invalida" }); res.fallos.push(id); continue; }
    let data = o.data;
    if (data === undefined && typeof o.archivo === "string") {
      const ruta = path.resolve(dir, o.archivo);
      if (!ruta.startsWith(path.resolve(dir) + path.sep)) { poner({ estado: "fallo", codigo: "ruta_invalida" }); res.fallos.push(id); continue; }
      try { data = JSON.parse(fs.readFileSync(ruta, "utf8")); } catch (e) { poner({ estado: "corrupto", version: o.version, codigo: "json_invalido" }); res.corruptos.push(id); continue; }
    }
    const kind = kindDeId(id), problemas = validarDoc(id, data);
    const integro = kind === "feriados" || hOk(data);
    if (problemas.length || !integro) { poner({ estado: "corrupto", version: o.version, codigo: !integro ? "integridad" : "forma:" + problemas.slice(0, 3).join(",") }); res.corruptos.push(id); continue; }
    escribirJson(path.join(R.entradaDb, id + ".json"), data, { compacto: true });
    poner({ estado: "ok", version: o.version, h: data.h || null });
    res.ok.push(id); res.bytes += bytes(data);
  }
  for (const id of requeridos || requeridosDe(dir)) if (!ver[id]) { ver[id] = { estado: "fallo", version: null, h: null, escritoEn: null, codigo: "no_leido" }; res.fallos.push(id); }
  escribirVersiones(dir, ver);
  escribirJson(path.join(R.entradaDb, "_fallos.json"), Object.fromEntries(Object.entries(ver).filter(([, x]) => x.estado === "fallo").map(([k, x]) => [k, x.codigo || "fallo"])));
  escribirJson(marca, { lineas: lineas.length });
  return res;
}

// ---- armar un grupo de escritura (§E.4, §E.8) ----
// docs: [{ id, data }] en el orden de escritura. crear: ids que se escriben siempre sin ifVersion (reclamo de envío).
// delDia: ids del día que, si nadie los leyó y preparar dijo "continuar", se escriben sin ifVersion.
export function armarGrupo({ dir, grupo, docs, modo, crear = [], delDia = [], accionDia = null }) {
  if (!/^[a-z0-9-]{1,40}$/.test(grupo)) throw new ErrorArchivo("grupo_invalido", grupo);
  const R = rutas(dir), g = path.join(R.salida, grupo);
  fs.rmSync(g, { recursive: true, force: true });
  fs.mkdirSync(g, { recursive: true });
  const ver = leerVersiones(dir), ops = [], esperado = [], omitidos = [];
  for (const { id, data } of docs) {
    if (esDePagina(id) || !kindDeId(id) || kindDeId(id) === "feriados") throw new ErrorArchivo("doc_prohibido", `la rutina no escribe ${id}`);
    const v = ver[id];
    let ifVersion;
    if (crear.includes(id)) ifVersion = null;
    else if (v && v.estado === "ok" && Number.isInteger(v.version)) ifVersion = v.version;
    else if (v && v.estado === "no_existe") ifVersion = null;
    else if (!v && delDia.includes(id) && accionDia === "continuar") ifVersion = null;
    else { omitidos.push({ id, motivo: !v ? `no se leyó ${id}; no se escribe` : `${id} en estado ${v.estado}; no se escribe` }); continue; }
    const doc = conH(data), p = validarDoc(id, doc), n = bytes(doc);
    if (p.length) throw new ErrorArchivo("forma", `${id}: ${p.join(",")}`);
    if (n > DOC_MAX) throw new ErrorArchivo("doc_grande", `${id}: ${n} B`);
    escribirJson(path.join(g, id + ".json"), doc, { compacto: true });
    const op = { op: "set", path: `${DB_RUTA}/${id}`, data: doc };
    if (ifVersion !== null) op.ifVersion = ifVersion;
    ops.push(op);
    esperado.push({ id, h: doc.h, ifVersion, bytes: n, tope: DOC_TOPES[doc.kind] || null });
  }
  if (ops.length > 50) throw new ErrorArchivo("muchas_ops", `${grupo}: ${ops.length} ops`);
  let escribir = null;
  if (ops.length) {
    if (modo === "archivo") {
      if (!ACCION_REEMPLAZO) throw new ErrorArchivo("sin_db", "modo archivo desactivado (D7)");
      const batch = esperado.map(e => Object.assign({ action: ACCION_REEMPLAZO, doc_id: e.id, file_path: path.resolve(g, e.id + ".json") }, e.ifVersion !== null ? { if_version: e.ifVersion } : {}));
      fs.writeFileSync(path.join(g, "artifactdata.json"), JSON.stringify({ action: "batch", url: ARTEFACTO_URL, collection: COLECCION_ARCHIVO, batch }));
      escribir = `salida/${grupo}/artifactdata.json`;
    } else {
      fs.writeFileSync(path.join(g, "db_write.json"), JSON.stringify({ slug: DB_SLUG, ops }));
      escribir = `salida/${grupo}/db_write.json`;
    }
  }
  escribirJson(path.join(g, "_grupo.json"), { grupo, modo, ops: esperado, omitidos, reintento: false });
  return { escribir, ops: ops.length, omitidos, bytes: esperado.reduce((s, e) => s + e.bytes, 0), esperado };
}

// ---- registrar (§E.9) ----
function leerRespuesta(g, modo, nombre) {
  if (modo === "archivo") {
    const f = path.join(g, nombre + ".txt");
    if (!fs.existsSync(f)) return { tipo: "ilegible" };
    const t = fs.readFileSync(f, "utf8");
    if (/version[_ ]mismatch|409/i.test(t)) return { tipo: "conflicto" };
    return { tipo: "texto", versiones: [...t.matchAll(/version\s+(\d+)/gi)].map(m => Number(m[1])) };
  }
  const f = path.join(g, nombre + ".json");
  if (!fs.existsSync(f)) return { tipo: "ilegible" };
  let o;
  try { o = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return { tipo: "ilegible" }; }
  if (o && o.error) return { tipo: o.error.code === "version_mismatch" || o.error.status === 409 ? "conflicto" : "error", codigo: o.error.code || null };
  if (o && Array.isArray(o.results)) return { tipo: "resultados", versiones: o.results.map(r => (r && Number.isInteger(r.version) ? r.version : null)) };
  return { tipo: "ilegible" };
}

export function registrar({ dir, grupo, verificar = false, reintento = false }) {
  const R = rutas(dir), g = path.join(R.salida, grupo), meta = leerJson(path.join(g, "_grupo.json"));
  if (!meta) throw new ErrorArchivo("sin_grupo", `no hay salida/${grupo}/_grupo.json`);
  const ver = leerVersiones(dir), modo = meta.modo;
  const res = { escritos: [], conflictos: [], sin_confirmar: [], reintento: null };
  const marcar = (e, version) => { ver[e.id] = { estado: "ok", version, h: e.h, escritoEn: grupo }; res.escritos.push({ id: e.id, version }); };
  const fin = (codigo, accion) => { escribirVersiones(dir, ver); escribirJson(path.join(g, "_grupo.json"), meta); return { codigo, accion, resumen: res }; };
  const pendientes = verificar || reintento ? meta.ops.filter(e => !(ver[e.id] && ver[e.id].escritoEn === grupo && ver[e.id].h === e.h)) : meta.ops;

  if (reintento) {
    const r = leerRespuesta(g, modo, "resultado-reintento"), lista = meta.reintentoOps || [];
    if ((r.tipo === "resultados" || r.tipo === "texto") && r.versiones.length === lista.length && r.versiones.every(Number.isInteger)) {
      lista.forEach((e, i) => marcar(e, r.versiones[i]));
      return fin(0, "listo");
    }
    res.conflictos = lista.map(e => e.id);
    return fin(3, "conflicto");
  }
  if (verificar) {
    importar(dir, { requeridos: [] });
    const v2 = leerVersiones(dir), ajenos = [], noEscritos = [];
    for (const e of pendientes) {
      const x = v2[e.id];
      if (x && x.estado === "ok" && x.h === e.h) marcar(e, x.version);
      else if ((x && x.estado === "no_existe" && e.ifVersion === null) || (x && x.estado === "ok" && x.version === e.ifVersion)) noEscritos.push(Object.assign({}, e, { ifVersion: x.estado === "ok" ? x.version : null }));
      else ajenos.push(e.id);
    }
    if (ajenos.length || (noEscritos.length && meta.reintento)) { res.conflictos = ajenos.length ? ajenos : noEscritos.map(e => e.id); return fin(3, "conflicto"); }
    if (!noEscritos.length) return fin(0, "listo");
    // un solo reintento con los no escritos y sus versiones actuales
    const ops = noEscritos.map(e => { const data = leerJson(path.join(g, e.id + ".json")), op = { op: "set", path: `${DB_RUTA}/${e.id}`, data }; if (e.ifVersion !== null) op.ifVersion = e.ifVersion; return op; });
    if (modo === "archivo") {
      const batch = noEscritos.map(e => Object.assign({ action: ACCION_REEMPLAZO, doc_id: e.id, file_path: path.resolve(g, e.id + ".json") }, e.ifVersion !== null ? { if_version: e.ifVersion } : {}));
      fs.writeFileSync(path.join(g, "artifactdata-reintento.json"), JSON.stringify({ action: "batch", url: ARTEFACTO_URL, collection: COLECCION_ARCHIVO, batch }));
      res.reintento = `salida/${grupo}/artifactdata-reintento.json`;
    } else {
      fs.writeFileSync(path.join(g, "db_write-reintento.json"), JSON.stringify({ slug: DB_SLUG, ops }));
      res.reintento = `salida/${grupo}/db_write-reintento.json`;
    }
    meta.reintento = true; meta.reintentoOps = noEscritos;
    res.sin_confirmar = noEscritos.map(e => e.id);
    return fin(0, "reintentar");
  }
  const r = leerRespuesta(g, modo, "resultado");
  if ((r.tipo === "resultados" || r.tipo === "texto") && r.versiones.length === meta.ops.length && r.versiones.every(Number.isInteger)) {
    meta.ops.forEach((e, i) => marcar(e, r.versiones[i]));
    return fin(0, "listo");
  }
  if (r.tipo === "conflicto" && grupo === "ahora") { res.conflictos = meta.ops.map(e => e.id); return fin(3, "otra_sesion"); }
  if (r.tipo === "conflicto" && grupo === "pre-ejecucion") { res.conflictos = meta.ops.map(e => e.id); return fin(3, "ya_hubo_envio"); }
  // error, 409 en otro grupo, parcial o ilegible: no se supone nada; se relee cada id del grupo
  escribirJson(path.join(R.trabajo, "releer.json"), { grupo, lecturas: meta.ops.map(e => lectura(e.id, { obligatoria: false, dirAbs: path.resolve(dir) })) });
  res.sin_confirmar = meta.ops.map(e => e.id);
  return fin(0, "releer");
}

// ---- verificar (tras releer rutina-estado al final del día) ----
export function verificarEstado(dir) {
  importar(dir, { requeridos: [] });
  const ver = leerVersiones(dir), meta = leerJson(path.join(rutas(dir).salida, "final", "_grupo.json"));
  const esperado = meta && meta.ops.find(e => e.id === "rutina-estado");
  const doc = leerJson(path.join(rutas(dir).entradaDb, "rutina-estado.json"));
  const v = ver["rutina-estado"];
  const hOkay = !!(v && v.estado === "ok" && esperado && v.h === esperado.h);
  const ok = hOkay && !!doc && doc.estado !== "en_curso";
  return { codigo: ok ? 0 : 3, accion: ok ? "listo" : "fallo", resumen: { ok, estado: doc ? doc.estado : null, h_ok: hOkay } };
}

// ---- presupuesto (§E.10) ----
export function presupuesto(dir) {
  const R = rutas(dir), porDocumento = {};
  const sumar = (id, i, n) => { porDocumento[id] = porDocumento[id] || [0, 0]; porDocumento[id][i] += n; };
  const archivoL = path.join(R.entrada, "lecturas.jsonl");
  if (fs.existsSync(archivoL)) for (const l of fs.readFileSync(archivoL, "utf8").split("\n").filter(x => x.trim())) {
    let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o && o.exists && o.data) sumar(o.id, 0, bytes(o.data));
    else if (o && o.exists && typeof o.archivo === "string") { try { sumar(o.id, 0, fs.statSync(path.resolve(dir, o.archivo)).size); } catch (e) { /* sin archivo */ } }
  }
  if (fs.existsSync(R.salida)) for (const g of fs.readdirSync(R.salida)) {
    for (const f of ["db_write.json", "db_write-reintento.json"]) {
      const ruta = path.join(R.salida, g, f);
      if (!fs.existsSync(ruta)) continue;
      let o; try { o = JSON.parse(fs.readFileSync(ruta, "utf8")); } catch (e) { continue; }
      for (const op of o.ops || []) sumar(op.path.split("/").pop(), 1, bytes(op.data));
    }
  }
  const leidos = Object.values(porDocumento).reduce((s, x) => s + x[0], 0), escritos = Object.values(porDocumento).reduce((s, x) => s + x[1], 0);
  const r = { leidos, escritos, total: leidos + escritos, tope: PRESUPUESTO_DIA, porDocumento };
  escribirJson(path.join(R.trabajo, "presupuesto.json"), r);
  return r;
}
