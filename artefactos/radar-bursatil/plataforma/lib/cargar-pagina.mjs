// Carga del código de la página publicada (12-plan §5.3): radar-core, radar-synth y radar-data se evalúan tal cual en el
// ámbito global; radar-ui nunca se evalúa (solo se le saca la huella para detectar cambios de orquestación).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BLOQUE = /<script id="radar-(core|synth|data|ui)">\n([\s\S]*?)\n<\/script>/g;

export function cargarPagina({ rutaIndex = "../index.html", rutaCompat = "compat.json" } = {}) {
  const html = fs.readFileSync(path.resolve(RAIZ, rutaIndex), "utf8");
  const compat = JSON.parse(fs.readFileSync(path.resolve(RAIZ, rutaCompat), "utf8"));
  const bloques = {};
  for (const m of html.matchAll(BLOQUE)) bloques[m[1]] = m[2];
  for (const k of ["core", "synth", "data", "ui"]) if (typeof bloques[k] !== "string") throw new Error(`index.html sin el bloque radar-${k}`);
  const hashes = Object.fromEntries(Object.entries(bloques).map(([k, t]) => [k, crypto.createHash("sha256").update(t).digest("hex")]));
  const diferencias = ["core", "data", "ui"].filter(k => !compat.sha256 || compat.sha256[k] !== hashes[k]);
  for (const k of ["core", "synth", "data"]) new Function(bloques[k])();
  const C = globalThis.RadarCore, D = globalThis.RadarData, S = globalThis.RadarSynth;
  if (!C || !D || !S) throw new Error("la página no definió RadarCore, RadarData o RadarSynth");
  return { C, D, S, hashes, compatible: diferencias.length === 0, diferencias, pagina: compat.pagina || null };
}
