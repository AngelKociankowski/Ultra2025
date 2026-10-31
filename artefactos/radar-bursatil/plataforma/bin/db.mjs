// CLI de la capa de db (12b §D.3). Uso:
//   node bin/db.mjs importar    --dir D
//   node bin/db.mjs registrar   --dir D --grupo G [--verificar | --reintento]
//   node bin/db.mjs verificar   --dir D
//   node bin/db.mjs presupuesto --dir D
//   node bin/db.mjs config      --dir D --operar true|false --activado <iso>|null   (solo el director, T20; 00n)
//   node bin/db.mjs revisado    --dir D --libro <archivo>   (solo el director: repone cartera-libro y quita la marca `revisar`; 00o, 00p R2)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, modoDe } from "../lib/archivos.mjs";
import fs from "node:fs";
import { importar, registrar, verificarEstado, presupuesto, armarGrupo, leerVersiones, hOk, ts } from "../lib/db.mjs";
import { validarDoc } from "../lib/esquemas.mjs";
import { leerDoc } from "../lib/archivos.mjs";
import { configEfectiva } from "../lib/reglas.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const PASO = "db";
const AYUDA = "Uso: node bin/db.mjs importar|registrar|verificar|presupuesto|config|revisado --dir <carpeta> [--grupo G] [--verificar] [--reintento] [--operar true|false --activado <iso>|null] [--libro <archivo>]";

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

// R2 (00p §2): el director quita la marca `revisar` solo reponiendo a la vez el cartera-libro que la rutina preparó ese día
// (--libro: el salida/final/cartera-libro.json de la carpeta del día marcado). Se valida esquema, h (integridad) y que su h sea el
// esperado (`revisar.esperado` o `escritos`); la escritura lleva el libro y rutina-estado (sin la marca, con ese h en escritos)
// juntos, cada uno con la versión leída. Sin --libro, se niega.
function armarRevisado({ dir, modo, ahora, libro }) {
  const error = (codigo, accion, texto) => ({ codigo, linea: lineaPaso({ paso: PASO, ok: false, accion, modo, resumen: { texto } }) });
  if (!libro) return error(1, "error", "revisado exige --libro <archivo> (el cartera-libro que la rutina preparó el día marcado)");
  const r = leerDoc(dir, "rutina-estado");
  if (r.estado !== "ok") return error(3, "sin_lectura", `rutina-estado en estado ${r.estado}: léelo primero`);
  if (!r.doc.revisar) return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "nada", modo, resumen: { texto: "rutina-estado no está marcado para revisión" } }) };
  const vl = leerVersiones(dir)["cartera-libro"];
  if (!vl || !["ok", "corrupto"].includes(vl.estado) || !Number.isInteger(vl.version)) return error(3, "sin_lectura", "cartera-libro sin lectura con versión: léelo primero");
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.resolve(libro), "utf8")); } catch (e) { return error(1, "error", `--libro ilegible: ${String(e.message || e).slice(0, 80)}`); }
  const problemas = validarDoc("cartera-libro", doc);
  if (problemas.length) return error(1, "error", `--libro no es un cartera-libro válido: ${problemas.slice(0, 3).join(", ")}`);
  if (!hOk(doc)) return error(1, "error", "--libro con h que no cuadra (integridad)");
  const esperado = (r.doc.revisar.esperado && r.doc.revisar.esperado["cartera-libro"]) || (r.doc.escritos && r.doc.escritos["cartera-libro"]);
  if (!esperado || doc.h !== esperado) return error(1, "error", `--libro no es el que preparó la rutina (h ${String(doc.h).slice(0, 8)} ≠ ${String(esperado).slice(0, 8)})`);
  const estado = Object.assign({}, r.doc, { latido: ts(ahora()), escritos: Object.assign({}, r.doc.escritos, { "cartera-libro": doc.h }) });
  delete estado.h; delete estado.revisar;
  const g = armarGrupo({ dir, grupo: "revisado", docs: [{ id: "cartera-libro", data: doc }, { id: "rutina-estado", data: estado }], modo, reponer: ["cartera-libro"] });
  if (g.ops !== 2) return error(3, "sin_lectura", "no se pudo armar la escritura de libro y marca juntas");
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "escribir", modo, resumen: { quita: r.doc.revisar, libro: doc.h, ifVersion: { "cartera-libro": vl.version, "rutina-estado": r.version } }, escribir: g.escribir }) };
}

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--grupo", "--operar", "--activado", "--libro"], banderas: ["--verificar", "--reintento"], posicionales: 1 });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const sub = a._[0];
  if (!a.dir || !["importar", "registrar", "verificar", "presupuesto", "config", "revisado"].includes(sub)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
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
    return { codigo: r.codigo, linea: lineaPaso({ paso: PASO, ok: r.codigo === 0, accion: r.accion, modo, resumen: r.resumen, escribir: r.escribir }) };
  }
  if (sub === "revisado") return armarRevisado({ dir, modo: modo || "en_linea", ahora, libro: a.libro });
  const r = presupuesto(dir);
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: r.total > r.tope ? "sobre_tope" : "listo", modo, resumen: r }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
