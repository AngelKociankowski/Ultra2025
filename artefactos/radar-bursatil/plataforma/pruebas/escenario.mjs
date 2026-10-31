// Escenario de un día con fixtures: preparar → (análisis dado) → 20-cartera → noticias → 40-decidir. Para pruebas de pasos.
import fs from "node:fs";
import path from "node:path";
import { carpetaConDb, leerFix, dia30 } from "./util.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { semilla, conciliar } from "../lib/libro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { escribirTrabajo } from "../lib/archivos.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { main as cartera } from "../bin/20-cartera.mjs";
import { main as decidir } from "../bin/40-decidir.mjs";

export const PAG = cargarPagina();
export const OUT30 = dia30(PAG.C).out;
export const LUNES = Date.parse("2026-11-02T14:50:00Z");
const copia = o => JSON.parse(JSON.stringify(o));

export function libroLunes() {
  return conciliar({ libro: semilla({ ahora: () => 1 }).libro, portafolio: leerFix("etoro/lunes-ejecutado.json"), historial: [], ahora: LUNES }).libro;
}

// opciones: t (ms del día), docs extra, libro, config, out (análisis), parcial, notas, portafolio, tasas, sinRadar
export async function prepararDia(o = {}) {
  const t = o.t || LUNES, s = semilla({ ahora: () => 1 });
  const config = Object.assign(copia(s.config), o.config || {});
  const docs = Object.assign({ "cartera-libro": o.libro || s.libro, "etoro-mapa": o.mapa || s.mapa, "cartera-serie-2026": o.serie || s.serie, "operaciones-2026-10": s.ops["2026-10"],
    "rutina-config": config, "bitacora-indice": o.indice || s.indiceBitacora, preferencias: leerFix("dia-2026-10-30/preferencias.json"),
    "feriados-2026": leerFix("dia-2026-10-30/feriados-2026.json") }, o.docs || {});
  const dir = carpetaConDb(docs, o.fallos || null);
  await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => t, pagina: PAG });
  const out = o.sinRadar ? null : o.out || OUT30;
  escribirTrabajo(dir, "analisis.json", out ? { fuente: "navegador", estado: o.parcial ? "parcial" : "listo", parcial: !!o.parcial, runId: "navegador-1", asOf: out.asOf, out: o.parcial ? Object.assign({}, out, { partial: true }) : out, motivo: null, llamadas: { total: 0 } }
    : { fuente: "ninguna", estado: "sin_radar", parcial: false, runId: null, out: null, motivo: "auth", llamadas: { total: 0 } });
  const et = o.etoro || etoroFalso({ portafolio: o.portafolio || leerFix("etoro/lunes-ejecutado.json"), tasas: o.tasas || leerFix("etoro/lunes-tasas.json").rates });
  await cartera(["--dir", dir], { transporteEToro: et, transporteFmp: o.fmp || transporteFalso(() => ({ http: 403, texto: "" })), ahora: () => t + 60000 });
  if (o.notas !== null) fs.writeFileSync(path.join(dir, "entrada", "noticias.json"), JSON.stringify(o.notas || { v: 1, generadoEl: "x", notas: [] }));
  const r = await decidir(["--dir", dir], { ahora: () => t + 600000, pagina: PAG });
  return { dir, t, decidir: r, etoro: et };
}
