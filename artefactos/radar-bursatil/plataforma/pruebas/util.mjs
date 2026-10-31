// Utilidades de las pruebas (no es un archivo de prueba).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conH, importar as importarDb } from "../lib/db.mjs";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = path.join(RAIZ, "pruebas", "fixtures");

export function carpetaTemporal(prefijo = "radar-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

export const leerFix = rel => JSON.parse(fs.readFileSync(path.join(FIX, rel), "utf8"));

// Carpeta de trabajo con documentos de db "leídos" por Claude (líneas de entrada/lecturas.jsonl) e importados.
// docs: { id: cuerpo } (a los documentos propios se les pone h); fallos: { id: código }; noExisten: ids con exists:false.
export function carpetaConDb(docs = {}, fallos = null, { noExisten = [], versiones = {}, modo = "en_linea", importar: imp = true } = {}) {
  const dir = carpetaTemporal();
  for (const d of ["entrada/db", "entrada/archivo", "trabajo", "salida"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const lineas = [];
  for (const [id, doc] of Object.entries(docs)) lineas.push({ id, exists: true, version: versiones[id] || 1, data: doc && doc.kind && doc.kind !== "feriados" && !doc.h ? conH(doc) : doc });
  for (const id of noExisten) lineas.push({ id, exists: false });
  for (const [id, e] of Object.entries(fallos || {})) lineas.push({ id, error: e });
  fs.writeFileSync(path.join(dir, "entrada", "lecturas.jsonl"), lineas.map(l => JSON.stringify(l)).join("\n") + (lineas.length ? "\n" : ""));
  fs.writeFileSync(path.join(dir, "trabajo", "lista.json"), JSON.stringify({ modo, lecturas: [] }));
  if (imp) importarDb(dir, { requeridos: [] });
  return dir;
}
// agrega lecturas (como hace Claude) y vuelve a importar
export function agregarLecturas(dir, lineas) {
  fs.appendFileSync(path.join(dir, "entrada", "lecturas.jsonl"), lineas.map(l => JSON.stringify(l)).join("\n") + "\n");
  return importarDb(dir, { requeridos: [] });
}

export const leerSalida = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
export const existe = (dir, rel) => fs.existsSync(path.join(dir, rel));

// Recorre archivos de texto bajo `base` (sin node_modules ni .trabajo)
export function archivosBajo(base) {
  const out = [];
  const visitar = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".trabajo") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) visitar(p); else out.push(p);
    }
  };
  visitar(base);
  return out;
}

// Análisis real del 30-oct (volcado de db): manifiesto + 4 partes unidas con C.joinDay de la página
export function dia30(C) {
  const man = leerFix("dia-2026-10-30/dia-2026-10-30.json");
  const partes = [0, 1, 2, 3].map(k => leerFix(`dia-2026-10-30/dia-2026-10-30-p${k}.json`));
  return { man, partes, out: C.joinDay(man, partes) };
}
