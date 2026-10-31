// CLI de la capa de db (12b §D.3). Uso:
//   node bin/db.mjs importar    --dir D
//   node bin/db.mjs registrar   --dir D --grupo G [--verificar | --reintento]
//   node bin/db.mjs verificar   --dir D
//   node bin/db.mjs presupuesto --dir D
//   node bin/db.mjs config      --dir D --operar true|false --activado <iso>|null   (solo el director, T20; 00n)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, modoDe } from "../lib/archivos.mjs";
import { importar, registrar, verificarEstado, presupuesto, armarGrupo, ts } from "../lib/db.mjs";
import { leerDoc } from "../lib/archivos.mjs";
import { configEfectiva } from "../lib/reglas.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const PASO = "db";
const AYUDA = "Uso: node bin/db.mjs importar|registrar|verificar|presupuesto|config --dir <carpeta> [--grupo G] [--verificar] [--reintento] [--operar true|false --activado <iso>|null]";

// rutina-config con operar/activadoEl nuevos sobre la versión leída (salida/config/db_write.json con ifVersion y h)
function armarConfig({ dir, modo, operar, activado, ahora }) {
  const error = texto => ({ codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", modo, resumen: { texto } }) });
  if (operar !== "true" && operar !== "false") return error("--operar debe ser true o false");
  const act = activado === "null" ? null : activado;
  if (act !== null && (typeof act !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(act) || !Number.isFinite(Date.parse(act)))) return error("--activado debe ser ISO UTC (AAAA-MM-DDTHH:MM:SSZ) o null");
  if (operar === "true" && act === null) return error("--operar true exige --activado");
  const r = leerDoc(dir, "rutina-config");
  if (r.estado !== "ok") return { codigo: 3, linea: lineaPaso({ paso: PASO, ok: false, accion: "sin_lectura", modo, resumen: { texto: `rutina-config en estado ${r.estado}: léela primero` } }) };
  const doc = Object.assign({}, r.doc, { at: ts(ahora()), operar: operar === "true", activadoEl: act === null ? null : ts(Date.parse(act)) });
  delete doc.h;
  const { alertas } = configEfectiva(doc);
  if (alertas.length) return error(`rutina-config quedaría con valores fuera de rango: ${alertas.join(" ")}`);
  const g = armarGrupo({ dir, grupo: "config", docs: [{ id: "rutina-config", data: doc }], modo });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "escribir", modo, resumen: { operar: doc.operar, activadoEl: doc.activadoEl, ifVersion: r.version }, escribir: g.escribir }) };
}

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--grupo", "--operar", "--activado"], banderas: ["--verificar", "--reintento"], posicionales: 1 });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const sub = a._[0];
  if (!a.dir || !["importar", "registrar", "verificar", "presupuesto", "config"].includes(sub)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), modo = modoDe(dir), reg = crearRegistro({ dir, paso: `db ${sub}` });
  if (sub === "config") return armarConfig({ dir, modo: modo || "en_linea", operar: a.operar, activado: a.activado === undefined ? "null" : a.activado, ahora });
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
