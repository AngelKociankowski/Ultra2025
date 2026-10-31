// Uso: node bin/esperar.mjs <segundos>   (1–300). La sesión programada no usa `sleep`.
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli } from "../lib/archivos.mjs";

const PASO = "esperar";
const AYUDA = "Uso: node bin/esperar.mjs <segundos>  (entero de 1 a 300)";

export async function main(argv, { dormir = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const a = leerArgs(argv, { posicionales: 1 });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const s = Number(a._[0]);
  if (!Number.isInteger(s) || s < 1 || s > 300) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  await dormir(s * 1000);
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "listo", resumen: { segundos: s } }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
