// T06 / K3 · 00-preparar nuevo (12b §D.2): las 8 reglas en orden (H13 en h13, H14 y la lista en h14)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as preparar } from "../bin/00-preparar.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { semilla, libroADb, libroDeDb } from "../lib/libro.mjs";
import { conH } from "../lib/db.mjs";
import { carpetaConDb, carpetaTemporal, leerSalida, existe } from "./util.mjs";

const pag = cargarPagina();
const S = semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") });
const OBL = ["rutina-estado", "rutina-config", "cartera-libro", "etoro-mapa"];
const T = iso => Date.parse(iso);
const estado = (o = {}) => Object.assign({ kind: "rutinaEstado", v: 2, fecha: "2026-11-02", estado: "hecha", paso: "cerrar", sesion: "s-viejo", inicio: "2026-11-02T14:47:00Z", latido: "2026-11-02T14:47:00Z",
  fin: "2026-11-02T15:00:00Z", commit: null, modo: "en_linea", ejecucionesAbiertas: [], previo: null, escritos: {}, motivo: null }, o);
// carpeta con los obligatorios leídos (los que no se dan, como exists:false) y bitacora-mes del mes
function carpeta(iso, docs = {}, { fallos = null, versiones = {}, extraNo = [] } = {}) {
  const mes = new Date(T(iso) - 5 * 3600000).toISOString().slice(0, 7);
  const base = Object.assign({ "rutina-config": S["rutina-config"], "cartera-libro": S["cartera-libro"], "etoro-mapa": S["etoro-mapa"] }, docs);
  const no = OBL.concat([`bitacora-mes-${mes}`], extraNo).filter(id => !(id in base) && !(fallos && id in fallos));
  for (const [k, v] of Object.entries(base)) if (v === null) { delete base[k]; no.push(k); }
  return carpetaConDb(base, fallos, { noExisten: no, versiones });
}
async function correr(iso, docs, opts = {}) {
  const dir = carpeta(iso, docs, opts);
  const r = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => T(iso), pagina: opts.pagina || pag, sesion: "s-nuevo" });
  const p = existe(dir, "trabajo/preparar.json") ? leerSalida(dir, "trabajo/preparar.json") : null;
  const w = existe(dir, "salida/ahora/db_write.json") ? leerSalida(dir, "salida/ahora/db_write.json") : null;
  const aviso = existe(dir, "salida/aviso.txt") ? fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8") : null;
  const lm = existe(dir, "trabajo/leer-mas.json") ? leerSalida(dir, "trabajo/leer-mas.json").lecturas.map(l => l.id) : null;
  return { dir, r, p, w, aviso, lm };
}
const LUN = "2026-11-02T14:47:00Z";

test("--ahora solo con RADAR_PRUEBAS=1", async () => {
  delete process.env.RADAR_PRUEBAS;
  await assert.rejects(() => preparar(["--fase", "lista", "--modo", "en_linea", "--ahora", LUN], { raiz: carpetaTemporal() }), e => e.codigo === "args");
  process.env.RADAR_PRUEBAS = "1";
  const r = await preparar(["--fase", "lista", "--modo", "en_linea", "--ahora", "2026-11-03T14:47:00Z"], { raiz: carpetaTemporal() });
  assert.equal(r.linea.fecha, "2026-11-03");
  delete process.env.RADAR_PRUEBAS;
});

test("regla 1 · documento obligatorio dañado o en fallo → salir/integridad sin escribir", async () => {
  const dir = carpeta(LUN, {}, {});
  // un carácter cambiado en la copia de cartera-libro
  const malo = conH(S["cartera-libro"]); malo.efectivo = 0.57;
  fs.appendFileSync(path.join(dir, "entrada/lecturas.jsonl"), JSON.stringify({ id: "cartera-libro", exists: true, version: 2, data: malo }) + "\n");
  await (await import("../lib/db.mjs")).importar(dir, { requeridos: [] });
  const r = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => T(LUN), pagina: pag });
  assert.equal(r.codigo, 2); assert.equal(leerSalida(dir, "trabajo/preparar.json").rutina.motivoSalida, "integridad");
  assert.ok(!existe(dir, "salida/ahora/db_write.json"));
  assert.equal(fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8"), "Radar · lun 2-nov · Falla: el documento cartera-libro llegó dañado desde db; hoy no se operó.");
  const f = await correr(LUN, {}, { fallos: { "etoro-mapa": "unavailable" } });
  assert.equal(f.p.rutina.motivoSalida, "integridad"); assert.equal(f.w, null);
});

test("regla 2 · sábado → fin_de_semana sin escribir; Thanksgiving → feriado con rutina-estado sin_mercado (ifVersion)", async () => {
  const a = await correr("2026-10-31T13:47:00Z", {});
  assert.equal(a.r.codigo, 2); assert.equal(a.p.rutina.motivoSalida, "fin_de_semana"); assert.equal(a.w, null);
  assert.equal(a.aviso, "Radar · sáb 31-oct · Fin de semana: sin operación.");
  const b = await correr("2026-11-26T14:47:00Z", { "rutina-estado": estado({ fecha: "2026-11-25" }) }, { versiones: { "rutina-estado": 8 } });
  assert.equal(b.p.rutina.motivoSalida, "feriado"); assert.equal(b.r.linea.escribir, "salida/ahora/db_write.json");
  assert.equal(b.w.ops.length, 1); assert.equal(b.w.ops[0].ifVersion, 8); assert.equal(b.w.ops[0].data.estado, "sin_mercado");
  assert.equal(b.aviso, "Radar · jue 26-nov · Feriado NYSE (Thanksgiving Day): sin operación.");
});

test("27-nov 9:47 → ventana hasta 12:30; 8:47 → temprano (nada en db); 15:40 → continuar fuera de ventana", async () => {
  const a = await correr("2026-11-27T14:47:00Z", {});
  assert.deepEqual(a.p.ventana, { desde: "09:45", hasta: "12:30", dentro: true });
  const b = await correr("2026-11-02T13:47:00Z", {});
  assert.equal(b.p.rutina.motivoSalida, "temprano"); assert.equal(b.w, null); assert.equal(b.aviso, "Radar · fuera de horario; corre a las 9:47 ET.");
  const c = await correr("2026-11-02T20:40:00Z", {});
  assert.equal(c.p.rutina.accion, "continuar"); assert.equal(c.p.ventana.dentro, false);
});

test("reglas 4–6 · hecha hoy → ya_hecha; en_curso con latido < 30 min → otra_sesion_viva; ≥ 30 min o de ayer → recuperar", async () => {
  const a = await correr(LUN, { "rutina-estado": estado() });
  assert.equal(a.p.rutina.motivoSalida, "ya_hecha"); assert.equal(a.w, null);
  const vivo = estado({ estado: "en_curso", paso: "radar", fin: null, latido: "2026-11-02T14:40:00Z" });
  const b = await correr(LUN, { "rutina-estado": vivo });
  assert.equal(b.p.rutina.motivoSalida, "otra_sesion_viva"); assert.equal(b.w, null);
  assert.equal(b.aviso, "Radar · lun 2-nov · Otra sesión está corriendo la rutina de hoy; esta se detuvo.");
  const viejo = estado({ estado: "en_curso", paso: "radar", fin: null, latido: "2026-11-02T14:10:00Z", ejecucionesAbiertas: ["2026-10-30"] });
  const c = await correr(LUN, { "rutina-estado": viejo }, { versiones: { "rutina-estado": 5 } });
  assert.equal(c.r.codigo, 0); assert.equal(c.p.rutina.accion, "recuperar");
  assert.deepEqual(c.p.recuperacion, { ejecuciones: ["2026-10-30"] });
  assert.deepEqual(c.lm, ["ejecucion-2026-10-30", "ops-2026-10-30", "punto-2026-11-02", "radar-2026-11-02", "bitacora-2026-11-02", "ops-2026-11-02", "ejecucion-2026-11-02"]);
  assert.equal(c.w.ops[0].ifVersion, 5); assert.equal(c.w.ops[0].data.sesion, "s-nuevo");
  const ayer = await correr(LUN, { "rutina-estado": estado({ fecha: "2026-10-30", estado: "en_curso", fin: null }) });
  assert.equal(ayer.p.rutina.accion, "recuperar");
  assert.deepEqual(ayer.lm, ["ops-2026-10-30"]); // los pendientes del 30-oct; nada del día porque la sesión caída no era de hoy
});

test("regla 7 · sin cartera-libro → sin_semilla; regla 8 · continuar con un solo set de rutina-estado", async () => {
  const a = await correr(LUN, { "cartera-libro": null });
  assert.equal(a.p.rutina.motivoSalida, "sin_semilla"); assert.equal(a.w, null);
  const b = await correr(LUN, {});
  assert.equal(b.r.codigo, 0); assert.equal(b.p.rutina.accion, "continuar");
  assert.equal(b.w.ops.length, 1); assert.equal(b.w.ops[0].ifVersion, undefined); // rutina-estado no existía
  const e = b.w.ops[0].data;
  assert.deepEqual([e.estado, e.paso, e.sesion, e.modo, e.latido], ["en_curso", "preparar", "s-nuevo", "en_linea", "2026-11-02T14:47:00Z"]);
  assert.deepEqual(b.lm, ["ops-2026-10-30"]);
  const c = await correr(LUN, { "rutina-estado": estado({ fecha: "2026-10-30" }) }, { versiones: { "rutina-estado": 3 } });
  assert.equal(c.w.ops[0].ifVersion, 3);
  // con la cartera ya ejecutada (sin pendientes) no hay nada más que leer
  const libro = libroDeDb(S["cartera-libro"]).libro; libro.pendientes = [];
  const d = await correr(LUN, { "cartera-libro": libroADb(libro, T(LUN)) });
  assert.deepEqual(d.lm, []);
});

test("compat falso → radar ninguno (pagina_cambio)", async () => {
  const x = await correr(LUN, {}, { pagina: Object.assign({}, pag, { compatible: false, diferencias: ["ui"] }) });
  assert.deepEqual(x.p.radar, { accion: "ninguno", motivo: "pagina_cambio" });
});
