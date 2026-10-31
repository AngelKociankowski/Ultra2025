// Paso 7 · Decidir (12-plan §6, §5.11.6–§5.11.8): reglas deterministas → decisiones.json, plan-ordenes.json con su huella
// y, si hay órdenes reales, salida/pre-ejecucion/ (rutina-estado "ejecutando" con el plan). Uso: node bin/40-decidir.mjs --dir <carpeta>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo, leerJson, limpiarGrupo, escribirDoc, rutas } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { decidir, configEfectiva } from "../lib/reglas.mjs";
import { validarNoticias } from "../lib/noticias.mjs";
import { feriadosAnio, ventanaDelDia } from "../lib/tiempo.mjs";

const PASO = "40-decidir";
const AYUDA = "Uso: node bin/40-decidir.mjs --dir <carpeta>";

export const shaArchivo = ruta => crypto.createHash("sha256").update(fs.readFileSync(ruta)).digest("hex");

export async function main(argv, { ahora = Date.now, pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json");
  if (!prep) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
  const t = ahora(), { C } = pagina || cargarPagina();
  const config = prep.config || configEfectiva(leerDoc(dir, "rutina-config").doc).config;
  const analisis = leerTrabajo(dir, "analisis.json"), cartera = leerTrabajo(dir, "cartera.json"), temas = leerTrabajo(dir, "temas-noticias.json");
  let notas = null, alertasNot = [];
  try { notas = leerJson(path.join(rutas(dir).entrada, "noticias.json")); } catch (e) { alertasNot.push("entrada/noticias.json ilegible: se decide sin noticias."); }
  const out = analisis && analisis.out ? analisis.out : null;
  const simbolos = [...new Set([...(out ? out.rows.map(r => r.symbol) : []), ...((cartera && cartera.libro && cartera.libro.posiciones) || []).map(p => p.sym), ...((temas && temas.simbolos) || []).map(s => s.sym)])];
  const nv = notas ? validarNoticias({ doc: notas, ahoraMs: t, ventanaH: config.noticiasVentanaH, simbolos }) : { validas: [], descartadas: [], eventos: [] };
  // la ventana y el mercado se evalúan ahora, no a la hora de preparar
  const anio = (prep.fechaET || C.etParts(t).date).slice(0, 4);
  const fer = feriadosAnio({ anio, docDb: leerDoc(dir, `feriados-${anio}`).doc }).filas;
  const ventana = ventanaDelDia({ C, ahoraMs: t, feriados: fer, config });
  const pref = leerDoc(dir, "preferencias").doc;
  const cetesPct = pref && pref.portafolio && typeof pref.portafolio.cetesPct === "number" ? pref.portafolio.cetesPct : null;
  const r = decidir({ C, analisis, cartera, eventos: nv.eventos, config, contexto: { fecha: prep.fechaET, mercadoAbierto: C.marketState(t, fer).open, ventanaDentro: ventana.dentro,
    bloqueoLibro: !!(prep.bloqueos && prep.bloqueos.libro), cetesPct, nowMs: t } });
  r.alertas.push(...alertasNot);
  const plan = { fecha: r.fecha, simulacion: r.simulacion, ordenes: r.ordenes };
  escribirTrabajo(dir, "plan-ordenes.json", plan);
  const planSha = shaArchivo(path.join(rutas(dir).trabajo, "plan-ordenes.json"));
  const dec = { fecha: r.fecha, simulacion: r.simulacion, modo: r.modo, motivoModo: r.motivoModo, objetivo: r.objetivo, valorUSD: r.valorUSD, efectivoDisponibleUSD: r.efectivoDisponibleUSD,
    decisiones: r.decisiones, planSha, alertas: r.alertas, roles: r.roles || {}, ventana, noticias: { validas: nv.validas.length, descartadas: nv.descartadas, eventos: nv.eventos } };
  escribirTrabajo(dir, "decisiones.json", dec);
  limpiarGrupo(dir, "pre-ejecucion");
  const accion = !r.ordenes.length ? "nada" : r.simulacion ? "simulacion" : "ejecutar";
  if (accion === "ejecutar") {
    const est = { kind: "rutinaEstado", v: 1, fecha: prep.fechaET, estado: "en_curso", paso: "ejecutando", inicio: prep.ahora || t, fin: null, intentos: (prep.rutina && prep.rutina.intentos) || 1,
      ejecucion: { inicio: t, simulacion: false, planSha, plan: r.ordenes }, motivo: null };
    if (prep.recuperacion) Object.assign(est, { recuperacion: prep.recuperacion, motivo: `recuperación de ${prep.recuperacion.de}` });
    escribirDoc(dir, "pre-ejecucion", "rutina-estado", est);
  }
  reg.info("decisiones", { modo: r.modo, ordenes: r.ordenes.length, accion });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion, resumen: { modo: r.modo, ordenes: r.ordenes.length, simulacion: r.simulacion, vetadas: r.decisiones.filter(d => d.accion === "vetada").length },
    escribir: accion === "ejecutar" ? "salida/pre-ejecucion/_orden.json" : null }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
