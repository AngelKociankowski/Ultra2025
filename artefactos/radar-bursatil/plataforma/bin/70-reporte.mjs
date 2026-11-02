// Paso 9b · Reporte del dashboard "Cartera Radar" (12c §F.2). Nunca falla el día: cualquier problema → accion "saltar" con motivo
// (y la línea "Reporte: sin actualizar (…)" al final del aviso). No escribe en la db del Radar; en el dashboard solo `datasets/<id>`.
//   node bin/70-reporte.mjs --dir D --fase lista      → trabajo/leer-reporte.json (LEER-REPORTE)
//   node bin/70-reporte.mjs --dir D --fase armar      → salida/reporte/<id>.json (9) y trabajo/subir-reporte.json (Artifact publish)
//   node bin/70-reporte.mjs --dir D --fase escribir   → salida/reporte/ds-<id>.json y salida/reporte/artifactdata.json (un batch)
//   node bin/70-reporte.mjs --dir D --fase registrar  → una línea al final de salida/aviso.txt
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerTrabajo, escribirTrabajo, leerJson, escribirJson, rutas } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { DASH_URL, ARTEFACTO_URL, COLECCION_ARCHIVO } from "../lib/constantes.mjs";
import { hOk, reservarNumero } from "../lib/db.mjs";
import { libroDeDb } from "../lib/libro.mjs";
import { validarNoticias } from "../lib/noticias.mjs";
import { DATASETS, armarDatasets, validarDataset } from "../lib/reporte.mjs";
import { avisoConLinea } from "../lib/aviso.mjs";

const PASO = "70-reporte";
const AYUDA = "Uso: node bin/70-reporte.mjs --dir <carpeta> --fase lista|armar|escribir|registrar";
const FASES = ["lista", "armar", "escribir", "registrar"];
const ts = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
// la forma de 00q para la lista de datasets del dashboard: - "<id>"  <n> bytes  version <V>  "<ruta>"
const RE_LISTA = /^- "([^"]+)"\s+\d+ bytes\s+version (\d+)\s+"[^"\n]+"\s*$/gm;

function lineaAviso(dir, linea) {
  const f = path.join(rutas(dir).salida, "aviso.txt");
  let aviso = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  if (aviso.split("\n").some(l => l.startsWith("Reporte: "))) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, avisoConLinea(aviso, linea));
}
// leer un JSON del día sin tumbar el paso: null si falta o no se puede leer
const leer = ruta => { try { return leerJson(ruta); } catch (e) { return null; } };
const docsDe = carpeta => {
  const d = path.join(carpeta, "data", "users", "me");
  return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => leer(path.join(d, f))).filter(Boolean) : [];
};

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--fase"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir || !FASES.includes(a.fase)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), R = rutas(dir), reg = crearRegistro({ dir, paso: `${PASO} ${a.fase}`, ahora });
  const sr = path.join(R.salida, "reporte"), abs = fs.realpathSync(dir);
  const sale = (accion, resumen = {}, extra = {}) => ({ codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion, resumen, extra }) });
  const saltar = motivo => { lineaAviso(dir, `Reporte: sin actualizar (${motivo}).`); reg.aviso(`reporte: saltar (${motivo})`); return sale("saltar", { motivo }); };
  try {
    if (a.fase === "lista") {
      let h = null;
      try { h = leerTrabajo(dir, "herramientas.json"); } catch (e) { h = null; }
      if (!h || !h.artifactdata) return saltar("falta la herramienta ArtifactData");
      if (!h.artifact) return saltar("falta la herramienta Artifact");
      const q = (kind, sub) => ({ args: { action: "query", url: ARTEFACTO_URL, collection: COLECCION_ARCHIVO, query: { where: [["kind", "eq", kind]], limit: 500 }, out_dir: path.join(abs, "entrada", "reporte", sub) } });
      const texto = `entrada/reporte/dash-list.${reservarNumero(dir)}.txt`;
      for (const s of ["puntos", "ops", "dash"]) fs.rmSync(path.join(abs, "entrada", "reporte", s), { recursive: true, force: true });
      fs.mkdirSync(path.join(abs, "entrada", "reporte"), { recursive: true });
      escribirTrabajo(dir, "leer-reporte.json", { lecturas: [q("carteraPunto", "puntos"), q("carteraOps", "ops"),
        { args: { action: "list", url: DASH_URL, collection: "datasets", out_dir: path.join(abs, "entrada", "reporte", "dash") }, texto }] });
      return sale("leer", { lecturas: 3 }, { lista: "trabajo/leer-reporte.json" });
    }

    if (a.fase === "armar") {
      if (DATASETS.some(d => fs.existsSync(path.join(sr, `subida-${d.id}.txt`)))) return saltar("el reporte de hoy ya se subió");
      const prep = leerTrabajo(dir, "preparar.json"), fecha = prep.fechaET, final = path.join(R.salida, "final");
      const bit = leer(path.join(final, `bitacora-${fecha}.json`)), cartera = leerTrabajo(dir, "cartera.json");
      if (!bit) return saltar("no hay bitácora de hoy");
      const libroDoc = leer(path.join(final, "cartera-libro.json")), libro = libroDoc ? libroDeDb(libroDoc).libro : cartera && cartera.libro;
      if (!libro || !cartera || !cartera.valuacion) return saltar("sin cartera valuada hoy");
      const alertasReporte = [];
      // historial (LEER-REPORTE): cada documento propio con h válido; los de hoy salen de salida/final y mandan
      const hist = kind => docsDe(path.join(R.entrada, "reporte", kind === "carteraPunto" ? "puntos" : "ops")).filter(d => {
        if (d.kind !== kind) return false;
        if (!hOk(d)) { alertasReporte.push(`Reporte: se descartó un ${kind === "carteraPunto" ? "punto" : "documento de operaciones"} del historial con h que no cuadra.`); return false; }
        return true;
      });
      const hayHist = fs.existsSync(path.join(R.entrada, "reporte", "puntos")) || fs.existsSync(path.join(R.entrada, "reporte", "ops"));
      const puntosH = hist("carteraPunto"), opsH = hist("carteraOps");
      if (!hayHist || (!puntosH.length && !opsH.length)) alertasReporte.push("Reporte sin historial: hoy no hubo ArtifactData.");
      const hoyFinal = fs.existsSync(final) ? fs.readdirSync(final).filter(f => /^(punto|ops)-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => leer(path.join(final, f))).filter(Boolean) : [];
      const puntos = puntosH.concat(hoyFinal.filter(d => d.kind === "carteraPunto")), ops = {};
      for (const d of opsH.concat(hoyFinal.filter(d => d.kind === "carteraOps"))) for (const o of d.ops || []) if (o && typeof o.id === "string") ops[o.id] = o;
      const analisis = leerTrabajo(dir, "analisis.json"), out = analisis && analisis.out;
      let notasDoc = null;
      try { notasDoc = leerJson(path.join(R.entrada, "noticias.json")); } catch (e) { notasDoc = null; }
      const temas = leerTrabajo(dir, "temas-noticias.json");
      const simbolos = [...new Set([...(out ? out.rows.map(r => r.symbol) : []), ...libro.posiciones.map(p => p.sym), ...((temas && temas.simbolos) || []).map(x => x.sym)])];
      const notas = notasDoc ? validarNoticias({ doc: notasDoc, ahoraMs: Date.parse(bit.t), ventanaH: (prep.config && prep.config.noticiasVentanaH) || 72, simbolos }) : null;
      let aviso = "";
      try { aviso = fs.readFileSync(path.join(R.salida, "aviso.txt"), "utf8"); } catch (e) { aviso = ""; }
      const ds = armarDatasets({ fecha, bit, libro, valuacion: cartera.valuacion, composicion: cartera.composicion, analisis, resumenRadar: leerTrabajo(dir, "radar-resumen.json"),
        decis: leerTrabajo(dir, "decisiones.json"), ops, puntos, notas, alertasReporte, avisoFallas: aviso.split("\n").filter(l => l.startsWith("Falla:")) });
      fs.rmSync(sr, { recursive: true, force: true });
      fs.mkdirSync(sr, { recursive: true });
      const subidas = [], malos = [];
      for (const d of DATASETS) {
        const p = validarDataset(d.id, ds[d.id]);
        if (p.length) { malos.push(d.id); reg.aviso(`reporte: ${d.id} no valida`, { problemas: p.slice(0, 5) }); continue; }
        escribirJson(path.join(sr, d.archivo), ds[d.id], { compacto: true });
        subidas.push({ id: d.id, args: { action: "publish", url: DASH_URL, asset: true, file_path: path.join(abs, "salida", "reporte", d.archivo) }, texto: `salida/reporte/subida-${d.id}.txt` });
      }
      if (!subidas.length) return saltar("ningún archivo del reporte pasó la validación");
      escribirTrabajo(dir, "subir-reporte.json", { subidas });
      return sale("subir", { archivos: subidas.length, no_validan: malos }, { lista: "trabajo/subir-reporte.json" });
    }

    if (a.fase === "escribir") {
      const sub = leerTrabajo(dir, "subir-reporte.json"), lr = leerTrabajo(dir, "leer-reporte.json");
      if (!sub || !lr) return saltar("faltan las fases anteriores del reporte");
      const tl = (lr.lecturas.find(l => l.texto) || {}).texto, ftl = tl ? path.resolve(dir, tl) : null;
      const lista = ftl && fs.existsSync(ftl) ? fs.readFileSync(ftl, "utf8") : null;
      // sin la lista del dashboard no se sabe qué versión fijar: no se escribe a ciegas
      const versiones = lista === null ? {} : Object.fromEntries([...lista.matchAll(RE_LISTA)].map(m => [m[1], Number(m[2])]));
      if (lista === null || !(Object.keys(versiones).length || /^No documents matched in collection "datasets"\./m.test(lista))) return saltar("no se pudo leer la lista del dashboard");
      const t = ts(ahora()), writes = [];
      fs.rmSync(path.join(sr, "artifactdata.json"), { force: true });
      // S4 (tester ronda 5): si una subida no trae su dirección no se escribe ninguno: cada dataset conserva el anterior completo
      // y el dashboard no mezcla el corte de hoy con el de ayer
      const urls = Object.fromEntries(sub.subidas.map(s => { const f = path.join(sr, `subida-${s.id}.txt`), m = fs.existsSync(f) ? fs.readFileSync(f, "utf8").match(/\/_blob\/[A-Za-z0-9_-]+/) : null; return [s.id, m]; }));
      const sinUrl = sub.subidas.filter(s => !urls[s.id]).map(s => s.id);
      if (sinUrl.length) return saltar(`la subida de ${sinUrl.join(", ")} no devolvió la dirección del archivo; el dashboard sigue con el corte anterior`);
      for (const s of sub.subidas) {
        const m = urls[s.id];
        const d = DATASETS.find(x => x.id === s.id), fds = path.join(sr, `ds-${s.id}.json`);
        escribirJson(fds, { title: d.titulo, description: d.descripcion, source: { kind: "file", url: m[0], name: d.archivo, format: "json" },
          updated: { at: t, by: "Rutina diaria de Claude" }, schedule: "Cada día hábil, al terminar la rutina de las 9:47 ET", staleAfterHours: 96 }, { compacto: true });
        writes.push(Object.assign({ op: "set", collection: "datasets", doc_id: s.id, file_path: path.join(abs, "salida", "reporte", `ds-${s.id}.json`) }, versiones[s.id] ? { if_version: versiones[s.id] } : {}));
      }
      fs.writeFileSync(path.join(sr, "artifactdata.json"), JSON.stringify({ action: "batch", url: DASH_URL, writes }));
      return sale("escribir", { datasets: writes.length }, { escribir: "salida/reporte/artifactdata.json" });
    }

    // registrar: cuenta las líneas `- set "datasets"/"<id>" (version <V>)`; un error no se reintenta (mañana se escribe todo)
    const f = path.join(sr, "resultado.txt"), texto = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
    if (texto === null) return saltar("no hay respuesta de la escritura del dashboard");
    const k = new Set([...texto.matchAll(/^- set "datasets"\/"([^"]+)" \(version \d+\)\s*$/gm)].map(m => m[1])).size;
    if (!k) { const c = texto.match(/db batch write failed \(([a-z_]+)\)/); return saltar(c ? `el dashboard rechazó la escritura: ${c[1]}` : "el dashboard no confirmó la escritura"); }
    lineaAviso(dir, `Reporte: actualizado (${k} de ${DATASETS.length}).`);
    return sale("listo", { actualizados: k });
  } catch (e) {
    // datos de entrada raros nunca tumban el día
    reg.error("reporte: error inesperado", { texto: String(e.message || e).slice(0, 160) });
    return saltar("error al armar el reporte");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
