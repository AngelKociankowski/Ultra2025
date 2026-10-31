// Carpeta de trabajo del día (12-plan §5.2): entrada/db/, trabajo/, salida/<grupo>/, registro.jsonl.
import fs from "node:fs";
import path from "node:path";
import { DOC_MAX } from "./constantes.mjs";

const ID_OK = /^[a-z0-9][a-z0-9-]{0,80}$/;
const GRUPO_OK = /^[a-z0-9-]{1,40}$/;
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
  for (const d of [r.entradaDb, r.trabajo, r.salida]) fs.mkdirSync(d, { recursive: true });
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

export function leerFallos(dir) {
  const f = leerJson(path.join(rutas(dir).entradaDb, "_fallos.json"));
  return f && typeof f === "object" && !Array.isArray(f) ? f : {};
}

// Documento de db leído por Claude. "no_existe" solo si no hay archivo y el id no está en _fallos.
export function leerDoc(dir, id) {
  validarId(id);
  const fallos = leerFallos(dir);
  if (Object.prototype.hasOwnProperty.call(fallos, id)) return { estado: "fallo", doc: null, codigo: String(fallos[id]).slice(0, 80) };
  try {
    const doc = leerJson(path.join(rutas(dir).entradaDb, id + ".json"));
    if (doc === null) return { estado: "no_existe", doc: null, codigo: null };
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { estado: "fallo", doc: null, codigo: "forma" };
    return { estado: "ok", doc, codigo: null };
  } catch (e) {
    return { estado: "fallo", doc: null, codigo: e.codigo || "lectura" };
  }
}

const validarNombre = n => { if (typeof n !== "string" || !NOMBRE_OK.test(n)) throw new ErrorArchivo("nombre_invalido", `nombre inválido: ${String(n).slice(0, 60)}`); };

export function leerTrabajo(dir, nombre) { validarNombre(nombre); return leerJson(path.join(rutas(dir).trabajo, nombre)); }
export function escribirTrabajo(dir, nombre, obj) { validarNombre(nombre); escribirJson(path.join(rutas(dir).trabajo, nombre), obj); }

// salida/<grupo>/: se vacía al empezar el paso que la produce (una corrida repetida no duplica órdenes de escritura)
export function limpiarGrupo(dir, grupo) {
  if (!GRUPO_OK.test(grupo)) throw new ErrorArchivo("grupo_invalido", `grupo inválido: ${grupo}`);
  const g = path.join(rutas(dir).salida, grupo);
  fs.rmSync(g, { recursive: true, force: true });
  fs.mkdirSync(g, { recursive: true });
  return g;
}

function agregarOrden(dir, grupo, entrada) {
  if (!GRUPO_OK.test(grupo)) throw new ErrorArchivo("grupo_invalido", `grupo inválido: ${grupo}`);
  const g = path.join(rutas(dir).salida, grupo), ruta = path.join(g, "_orden.json");
  const orden = leerJson(ruta) || [];
  orden.push(entrada);
  escribirJson(ruta, orden);
  return ruta;
}

// Escribe salida/<grupo>/<id>.json (JSON compacto) y lo agrega al final de _orden.json.
export function escribirDoc(dir, grupo, id, cuerpo) {
  validarId(id);
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) throw new ErrorArchivo("forma", `${id}: el cuerpo no es un objeto`);
  if (typeof cuerpo.kind !== "string" || !cuerpo.kind) throw new ErrorArchivo("sin_kind", `${id}: falta kind`);
  const n = bytesDe(cuerpo);
  if (n > DOC_MAX) throw new ErrorArchivo("doc_grande", `${id}: ${n} B > ${DOC_MAX} B`);
  const archivo = path.join("salida", grupo, id + ".json");
  escribirJson(path.join(dir, archivo), cuerpo, { compacto: true });
  agregarOrden(dir, grupo, { id, archivo, accion: "escribir" });
  return { id, archivo, bytes: n };
}

export function borrarDoc(dir, grupo, id) {
  validarId(id);
  agregarOrden(dir, grupo, { id, accion: "borrar" });
}

export function ordenDe(dir, grupo) { return leerJson(path.join(rutas(dir).salida, grupo, "_orden.json")) || []; }

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

export const lineaPaso = ({ paso, ok, accion, resumen = {}, escribir = null, extra = {} }) =>
  Object.assign({ paso, ok, accion, resumen, escribir }, extra);

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
