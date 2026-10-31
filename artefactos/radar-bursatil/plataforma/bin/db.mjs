// CLI de la capa de db (12b §D.3). Uso:
//   node bin/db.mjs importar    --dir D
//   node bin/db.mjs registrar   --dir D --grupo G [--verificar | --reintento]
//   node bin/db.mjs verificar   --dir D
//   node bin/db.mjs presupuesto --dir D
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, modoDe } from "../lib/archivos.mjs";
import { importar, registrar, verificarEstado, presupuesto } from "../lib/db.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const PASO = "db";
const AYUDA = "Uso: node bin/db.mjs importar|registrar|verificar|presupuesto --dir <carpeta> [--grupo G] [--verificar] [--reintento]";

export async function main(argv) {
  const a = leerArgs(argv, { valores: ["--dir", "--grupo"], banderas: ["--verificar", "--reintento"], posicionales: 1 });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const sub = a._[0];
  if (!a.dir || !["importar", "registrar", "verificar", "presupuesto"].includes(sub)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), modo = modoDe(dir), reg = crearRegistro({ dir, paso: `db ${sub}` });
  if (sub === "importar") {
    const r = importar(dir);
    const malo = r.corruptos.length > 0 || r.fallos.length > 0;
    reg.info("importar", r);
    return { codigo: malo ? 3 : 0, linea: lineaPaso({ paso: PASO, ok: !malo, accion: malo ? "con_fallas" : "listo", modo,
      resumen: { ok: r.ok.length, leidos: r.ok.length + r.no_existen.length, no_existen: r.no_existen.length, fallos: r.fallos, corruptos: r.corruptos, bytes: r.bytes, ignorados: r.ignorados } }) };
  }
  if (sub === "registrar") {
    if (!a.grupo) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: "falta --grupo" } }) };
    const r = registrar({ dir, grupo: a.grupo, verificar: !!a.verificar, reintento: !!a.reintento });
    reg.info(`registrar ${a.grupo}: ${r.accion}`, r.resumen);
    return { codigo: r.codigo, linea: lineaPaso({ paso: PASO, ok: r.codigo === 0, accion: r.accion, modo, resumen: r.resumen, escribir: r.resumen.reintento }) };
  }
  if (sub === "verificar") {
    const r = verificarEstado(dir);
    return { codigo: r.codigo, linea: lineaPaso({ paso: PASO, ok: r.codigo === 0, accion: r.accion, modo, resumen: r.resumen }) };
  }
  const r = presupuesto(dir);
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: r.total > r.tope ? "sobre_tope" : "listo", modo, resumen: r }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
