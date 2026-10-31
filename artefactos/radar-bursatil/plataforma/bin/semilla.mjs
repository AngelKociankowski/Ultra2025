// Siembra única de la Cartera Radar en db (12-plan §5.10; la corre el director en T18).
// Uso: node bin/semilla.mjs --dir <carpeta>   (la carpeta trae entrada/db/ leída con la lista de 00-preparar --fase lista)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, limpiarGrupo, escribirDoc } from "../lib/archivos.mjs";
import { semilla } from "../lib/libro.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const PASO = "semilla";
const AYUDA = "Uso: node bin/semilla.mjs --dir <carpeta>";

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const libro = leerDoc(dir, "cartera-libro");
  if (libro.estado !== "no_existe") {
    reg.aviso("cartera-libro ya existe o no se pudo leer; no se siembra", { estado: libro.estado, codigo: libro.codigo });
    return { codigo: 2, linea: lineaPaso({ paso: PASO, ok: true, accion: "ya_existe", resumen: { estado: libro.estado } }) };
  }
  const s = semilla({ ahora });
  limpiarGrupo(dir, "semilla");
  const docs = [["cartera-libro", s.libro], ["operaciones-2026-10", s.ops["2026-10"]], ["cartera-serie-2026", s.serie], ["etoro-mapa", s.mapa],
    ["rutina-config", s.config], ["bitacora-indice", s.indiceBitacora]];
  for (const [id, d] of docs) escribirDoc(dir, "semilla", id, d);
  reg.info("semilla lista", { docs: docs.map(d => d[0]) });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "sembrar", resumen: { docs: docs.length, efectivoUSD: s.libro.efectivoUSD, pendientes: s.libro.pendientes.length },
    escribir: "salida/semilla/_orden.json" }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
