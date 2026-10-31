// Utilidades de las pruebas (no es un archivo de prueba).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = path.join(RAIZ, "pruebas", "fixtures");

export function carpetaTemporal(prefijo = "radar-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

export const leerFix = rel => JSON.parse(fs.readFileSync(path.join(FIX, rel), "utf8"));

// Carpeta de trabajo con documentos de db ya "leídos" por Claude
export function carpetaConDb(docs = {}, fallos = null) {
  const dir = carpetaTemporal();
  const db = path.join(dir, "entrada", "db");
  fs.mkdirSync(db, { recursive: true });
  fs.mkdirSync(path.join(dir, "trabajo"), { recursive: true });
  fs.mkdirSync(path.join(dir, "salida"), { recursive: true });
  for (const [id, doc] of Object.entries(docs)) fs.writeFileSync(path.join(db, id + ".json"), JSON.stringify(doc));
  if (fallos) fs.writeFileSync(path.join(db, "_fallos.json"), JSON.stringify(fallos));
  return dir;
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
