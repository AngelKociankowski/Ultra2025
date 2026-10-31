// Siembra única de la Cartera Radar en db (12b §E.11; la corre el director en D2).
// Uso: node bin/semilla.mjs --dir <carpeta>   (antes: LEER cartera-libro e importar; debe dar exists:false)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, modoDe } from "../lib/archivos.mjs";
import { semilla } from "../lib/libro.mjs";
import { armarGrupo } from "../lib/db.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const PASO = "semilla";
const AYUDA = "Uso: node bin/semilla.mjs --dir <carpeta>";
const ORDEN = ["rutina-config", "cartera-libro", "etoro-mapa", "ops-2026-10-30", "punto-2026-10-30"];

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora }), modo = modoDe(dir) || "en_linea";
  const libro = leerDoc(dir, "cartera-libro");
  if (libro.estado !== "no_existe") {
    reg.aviso("cartera-libro ya existe, falló o no se leyó; no se siembra", { estado: libro.estado, codigo: libro.codigo });
    return { codigo: 2, linea: lineaPaso({ paso: PASO, ok: true, accion: "ya_existe", modo, resumen: { estado: libro.estado } }) };
  }
  const s = semilla({ ahora });
  // documentos nuevos: todos sin ifVersion (crear) aunque no se hayan leído los otros cuatro
  const g = armarGrupo({ dir, grupo: "semilla", docs: ORDEN.map(id => ({ id, data: s[id] })), modo, crear: ORDEN });
  reg.info("semilla lista", { docs: ORDEN });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "sembrar", modo, resumen: { docs: g.ops, efectivo: s["cartera-libro"].efectivo, pend: s["cartera-libro"].pend.length }, escribir: g.escribir }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
