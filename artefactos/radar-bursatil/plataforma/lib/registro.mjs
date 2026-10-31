// registro.jsonl: una línea {t, paso, nivel, msg, datos?} por evento. Nunca encabezados ni cuerpos crudos > 200 caracteres.
import fs from "node:fs";
import path from "node:path";

const MAX_TEXTO = 200;

function limpiar(v, prof = 0) {
  if (typeof v === "string") return v.length > MAX_TEXTO ? v.slice(0, MAX_TEXTO) + "…" : v;
  if (v === null || typeof v !== "object") return v;
  if (prof > 4) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 50).map(x => limpiar(x, prof + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = limpiar(x, prof + 1);
  return out;
}

// dir = carpeta de trabajo del día (o null: solo en memoria, para pruebas)
export function crearRegistro({ dir = null, paso, ahora = Date.now } = {}) {
  const lineas = [];
  const archivo = dir ? path.join(dir, "registro.jsonl") : null;
  const escribir = (nivel, msg, datos) => {
    const l = { t: ahora(), paso, nivel, msg: limpiar(String(msg)) };
    if (datos !== undefined) l.datos = limpiar(datos);
    lineas.push(l);
    if (archivo) {
      try { fs.appendFileSync(archivo, JSON.stringify(l) + "\n"); }
      catch (e) { process.stderr.write(`registro: no se pudo escribir (${e.code || e.message})\n`); }
    }
    return l;
  };
  return {
    lineas,
    info: (msg, datos) => escribir("info", msg, datos),
    aviso: (msg, datos) => escribir("aviso", msg, datos),
    error: (msg, datos) => escribir("error", msg, datos),
  };
}
