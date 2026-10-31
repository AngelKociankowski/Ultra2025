// Carpeta de trabajo del día (12b §D.1): entrada/ (lecturas.jsonl, db/, archivo/, noticias.json), trabajo/, salida/<grupo>/, registro.jsonl.
import fs from "node:fs";
import path from "node:path";

const ID_OK = /^[a-z0-9][a-z0-9-]{0,80}$/;
const NOMBRE_OK = /^[a-z0-9][a-z0-9.-]{0,80}$/;

export class ErrorArchivo extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

const validarId = id => { if (typeof id !== "string" || !ID_OK.test(id)) throw new ErrorArchivo("id_invalido", `id de documento inválido: ${String(id).slice(0, 60)}`); };

export function rutas(dir) {
  return {
    dir, entradaDb: path.join(dir, "entrada", "db"), entrada: path.join(dir, "entrada"), trabajo: path.join(dir, "trabajo"),
    salida: path.join(dir, "salida"), registro: path.join(dir, "registro.jsonl"),
  };
}

export function crearCarpeta(dir) {
  const r = rutas(dir);
  for (const d of [r.entradaDb, path.join(r.entrada, "archivo"), r.trabajo, r.salida]) fs.mkdirSync(d, { recursive: true });
  return r;
}

export const bytesDe = cuerpo => Buffer.byteLength(JSON.stringify(cuerpo), "utf8");

// Lee un JSON; null si no existe. Un archivo ilegible o con JSON inválido lanza ErrorArchivo.
export function leerJson(ruta) {
  let texto;
  try { texto = fs.readFileSync(ruta, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return null; throw new ErrorArchivo("lectura", `${path.basename(ruta)}: ${e.code || e.message}`); }
  try { return JSON.parse(texto); }
  catch (e) { throw new ErrorArchivo("json_invalido", `${path.basename(ruta)}: JSON inválido`); }
}

export function escribirJson(ruta, obj, { compacto = false } = {}) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, compacto ? JSON.stringify(obj) : JSON.stringify(obj, null, 1) + "\n");
}

// Documento de db ya importado (lib/db.mjs importar). estado: ok | no_existe | fallo | corrupto | sin_leer
export function leerDoc(dir, id) {
  validarId(id);
  let ver;
  try { ver = leerJson(path.join(rutas(dir).entradaDb, "_versiones.json")) || {}; } catch (e) { return { estado: "fallo", doc: null, version: null, codigo: "versiones" }; }
  const v = ver[id];
  if (!v) return { estado: "sin_leer", doc: null, version: null, codigo: null };
  if (v.estado !== "ok") return { estado: v.estado, doc: null, version: v.version ?? null, codigo: v.codigo || null };
  try {
    const doc = leerJson(path.join(rutas(dir).entradaDb, id + ".json"));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { estado: "fallo", doc: null, version: v.version, codigo: "sin_cuerpo" };
    return { estado: "ok", doc, version: v.version, codigo: null };
  } catch (e) {
    return { estado: "fallo", doc: null, version: v.version, codigo: e.codigo || "lectura" };
  }
}

const validarNombre = n => { if (typeof n !== "string" || !NOMBRE_OK.test(n)) throw new ErrorArchivo("nombre_invalido", `nombre inválido: ${String(n).slice(0, 60)}`); };

export function leerTrabajo(dir, nombre) { validarNombre(nombre); return leerJson(path.join(rutas(dir).trabajo, nombre)); }
export function escribirTrabajo(dir, nombre, obj) { validarNombre(nombre); escribirJson(path.join(rutas(dir).trabajo, nombre), obj); }

export function escribirAviso(dir, texto) { fs.mkdirSync(rutas(dir).salida, { recursive: true }); fs.writeFileSync(path.join(rutas(dir).salida, "aviso.txt"), texto); }

// ---- Protocolo de los pasos (§5.2): argumentos, una línea JSON en stdout y código de salida ----
// spec: { valores: ["--dir", "--fase"], banderas: ["--reanudar"], posicionales: n }
export function leerArgs(argv, { valores = [], banderas = [], posicionales = 0 } = {}) {
  const out = { ayuda: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.ayuda = true; continue; }
    if (banderas.includes(a)) { out[a.slice(2)] = true; continue; }
    if (valores.includes(a)) {
      if (i + 1 >= argv.length) throw new ErrorArchivo("args", `falta el valor de ${a}`);
      out[a.slice(2)] = argv[++i]; continue;
    }
    if (a.startsWith("--")) throw new ErrorArchivo("args", `opción desconocida: ${a}`);
    out._.push(a);
  }
  if (out._.length > posicionales) throw new ErrorArchivo("args", "demasiados argumentos");
  return out;
}

export const lineaPaso = ({ paso, ok, accion, resumen = {}, escribir = null, modo = null, extra = {} }) =>
  Object.assign({ paso, ok, accion, resumen, escribir }, modo ? { modo } : {}, extra);

// modo de db del día (lo fija 00-preparar --fase lista en trabajo/lista.json)
export function modoDe(dir) {
  try { const l = leerJson(path.join(rutas(dir).trabajo, "lista.json")); return l && l.modo ? l.modo : null; } catch (e) { return null; }
}

// Envoltura de CLI: main(argv) → { codigo, linea }; imprime la línea y sale con el código.
export async function correrCli(main, paso) {
  let codigo = 1, linea;
  try { ({ codigo, linea } = await main(process.argv.slice(2))); }
  catch (e) {
    linea = lineaPaso({ paso, ok: false, accion: "error", resumen: { codigo: e.codigo || "inesperado", texto: String(e.message || e).slice(0, 200) } });
    codigo = 1;
  }
  if (linea) process.stdout.write(JSON.stringify(linea) + "\n");
  process.exitCode = codigo;
}
