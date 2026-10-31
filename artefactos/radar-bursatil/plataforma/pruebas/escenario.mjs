// Escenario de un día con fixtures y db falso: lista → LEER → decidir → ESCRIBIR ahora → leer-mas → (análisis dado o corredor)
// → 20-cartera → noticias → 40-decidir. Para pruebas de pasos y del día completo.
import fs from "node:fs";
import path from "node:path";
import { carpetaTemporal, leerFix, dia30 } from "./util.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { crearDbFalso, crearSesion } from "./db-falso.mjs";
import { semilla, conciliar, libroDeDb, libroADb, valuar, mapaDeDb } from "../lib/libro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { escribirTrabajo, leerTrabajo } from "../lib/archivos.mjs";
import { resumenRadar } from "../lib/radar-resumen.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { main as cartera } from "../bin/20-cartera.mjs";
import { main as decidir } from "../bin/40-decidir.mjs";

export const PAG = cargarPagina();
export const OUT30 = dia30(PAG.C).out;
export const LUNES = Date.parse("2026-11-02T14:50:00Z");
const copia = o => JSON.parse(JSON.stringify(o));

// cartera del lunes en memoria (las 5 órdenes iniciales ya ejecutadas) y en forma de db
export function libroLunes() {
  const { libro } = libroDeDb(semilla({ ahora: () => 1 })["cartera-libro"]);
  return conciliar({ libro, portafolio: leerFix("etoro/lunes-ejecutado.json"), historial: [], ahora: LUNES }).libro;
}
export const libroLunesDb = () => libroADb(libroLunes(), LUNES);

// db inicial: semilla + documentos de la página que no se deben tocar
export function dbInicial(extra = {}) {
  const s = semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") });
  return crearDbFalso(Object.assign({}, s, { indice: { kind: "indice", v: 1, at: 1, dias: [{ dateET: "2026-10-30", parts: 4 }] },
    corrida: { kind: "corrida", v: 1, dateET: "2026-10-30", state: "done", runId: "d-1", startedAt: 1 } }, extra));
}

// Pasos 2–4 (lista, LEER, decidir, ESCRIBIR ahora, leer-mas). Devuelve la carpeta del día.
let nSesion = 0;
export async function abrirDia({ db, t, raiz = carpetaTemporal(), pagina = PAG, sesion = `s-prueba${++nSesion}`, omitir = [], corromper = null }) {
  const l = await preparar(["--fase", "lista", "--modo", "en_linea"], { ahora: () => t, raiz });
  const dir = path.join(raiz, ".trabajo", l.linea.fecha);
  const S = crearSesion({ db, dir, omitir, corromper });
  S.leer(l.linea.lecturas);
  const p = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => t, pagina, sesion });
  let ahora = null;
  if (p.linea.escribir) ahora = S.escribir("ahora");
  if (p.codigo === 0 && ahora && ahora.accion === "listo") S.leer(leerTrabajo(dir, "leer-mas.json").lecturas);
  return { dir, raiz, S, preparar: p, ahora };
}

// Análisis dado (sin correr el corredor): analisis.json y radar-resumen.json como los deja 10-radar
export function ponerAnalisis(dir, { out = OUT30, parcial = false, sinRadar = false, t = LUNES } = {}) {
  const prep = leerTrabajo(dir, "preparar.json");
  if (sinRadar) {
    escribirTrabajo(dir, "analisis.json", { fuente: "ninguna", estado: "sin_radar", parcial: false, runId: null, out: null, motivo: "policy", llamadas: { total: 1 } });
    escribirTrabajo(dir, "radar-resumen.json", resumenRadar({ estado: "sin_radar", motivo: "policy", t, f: prep.fechaET }));
    return;
  }
  const o = parcial ? Object.assign({}, out, { partial: true, partialReason: "cobertura baja" }) : out;
  escribirTrabajo(dir, "analisis.json", { fuente: "rutina", estado: parcial ? "parcial" : "listo", parcial, runId: null, asOf: o.asOf, out: o, motivo: null, llamadas: { total: 626 } });
  escribirTrabajo(dir, "radar-resumen.json", resumenRadar({ out: o, estado: parcial ? "parcial" : "listo", llamadas: { total: 626 }, t, f: prep.fechaET }));
}

// opciones: t, db, dbExtra, out, parcial, sinRadar, notas, portafolio, tasas, etoro, fmp, omitir, corromper
export async function prepararDia(o = {}) {
  const t = o.t || LUNES, db = o.db || dbInicial(o.dbExtra || {});
  const d = await abrirDia({ db, t, raiz: o.raiz, omitir: o.omitir, corromper: o.corromper });
  if (d.preparar.codigo !== 0) return Object.assign(d, { t, db });
  ponerAnalisis(d.dir, { out: o.out || OUT30, parcial: o.parcial, sinRadar: o.sinRadar, t });
  const et = o.etoro || etoroFalso({ portafolio: o.portafolio || leerFix("etoro/lunes-ejecutado.json"), tasas: o.tasas || tasasA(leerFix("etoro/lunes-tasas.json").rates, t) });
  const c = await cartera(["--dir", d.dir], { transporteEToro: et, transporteFmp: o.fmp || transporteFalso(() => ({ http: 403, texto: "" })), ahora: () => t + 60000, pagina: PAG });
  if (o.notas !== null) fs.writeFileSync(path.join(d.dir, "entrada", "noticias.json"), JSON.stringify(o.notas || { v: 1, generadoEl: "x", notas: [] }));
  const r = await decidir(["--dir", d.dir], { ahora: () => t + 600000, pagina: PAG });
  return Object.assign(d, { t, db, cartera: c, decidir: r, etoro: et });
}

// las tasas del lunes con la fecha movida a la hora de la prueba (precio válido: < 20 min)
export const tasasA = (rates, t) => rates.map(r => Object.assign({}, r, { date: new Date(t).toISOString() }));

// cartera.json en memoria para llamar a decidir() directo: libro del lunes, tasas válidas a la hora t (editables) y mapa sembrado
export function carteraEn(t, { tasasMod = null, libroMod = null } = {}) {
  const libro = libroLunes();
  if (libroMod) libroMod(libro);
  let tasas = tasasA(leerFix("etoro/lunes-tasas.json").rates, t);
  if (tasasMod) tasas = tasasMod(tasas);
  const valuacion = valuar({ libro, tasas, fx: { valor: 18.774, fuente: "radar" }, at: t });
  return { libro, valuacion, cartera: { estado: "listo", libro, valuacion, mapa: mapaDeDb(semilla()["etoro-mapa"]) } };
}
export { copia };
