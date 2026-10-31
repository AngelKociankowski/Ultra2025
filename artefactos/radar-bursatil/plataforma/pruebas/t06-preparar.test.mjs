// T06 · 00-preparar y tiempo (tabla de casos con reloj inyectado)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as preparar, listaLectura } from "../bin/00-preparar.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { semilla } from "../lib/libro.mjs";
import { feriadosAnio } from "../lib/tiempo.mjs";
import { carpetaConDb, carpetaTemporal, leerSalida, existe, leerFix } from "./util.mjs";

const pag = cargarPagina();
const s = semilla({ ahora: () => 1 });
const LUN = "2026-11-02T14:47:00Z"; // 9:47 ET
const T = Date.parse(LUN);
const base = (extra = {}) => Object.assign({ "cartera-libro": s.libro, "rutina-config": s.config, "etoro-mapa": s.mapa, "bitacora-indice": s.indiceBitacora,
  "feriados-2026": leerFix("dia-2026-10-30/feriados-2026.json") }, extra);
function diaHoy(fecha, { parcial = false } = {}) {
  const m = leerFix("dia-2026-10-30/dia-2026-10-30.json");
  return Object.assign({}, m, { dateET: fecha, partial: parcial, parts: m.parts.map((p, i) => Object.assign({}, p, { id: `dia-${fecha}-p${i}` })) });
}
async function correr(docs, iso, { fallos = null, pagina = pag } = {}) {
  const dir = carpetaConDb(docs, fallos);
  const r = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => Date.parse(iso), pagina });
  const p = existe(dir, "trabajo/preparar.json") ? leerSalida(dir, "trabajo/preparar.json") : null;
  const orden = existe(dir, "salida/ahora/_orden.json") ? leerSalida(dir, "salida/ahora/_orden.json").map(x => x.id) : [];
  const aviso = existe(dir, "salida/aviso.txt") ? fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8") : null;
  return { dir, r, p, orden, aviso };
}

test("--fase lista: crea la carpeta del día y lista los 14 documentos con fechas resueltas", async () => {
  const raiz = carpetaTemporal();
  const r = await preparar(["--fase", "lista"], { ahora: () => T, raiz });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "leer");
  assert.equal(r.linea.dir, ".trabajo/2026-11-02");
  assert.deepEqual(r.linea.leer, ["rutina-estado", "rutina-config", "cartera-libro", "cartera-serie-2026", "operaciones-2026-11", "etoro-mapa", "bitacora-indice", "corrida", "indice",
    "dia-2026-11-02", "feriados-2026", "plan", "contador-drutina0001", "preferencias"]);
  assert.ok(fs.existsSync(path.join(raiz, ".trabajo/2026-11-02/entrada/db")));
  assert.deepEqual(listaLectura("2027-01-05").slice(3, 5), ["cartera-serie-2027", "operaciones-2027-01"]);
});

test("--ahora solo con RADAR_PRUEBAS=1", async () => {
  delete process.env.RADAR_PRUEBAS;
  await assert.rejects(() => preparar(["--fase", "lista", "--ahora", LUN], { raiz: carpetaTemporal() }), e => e.codigo === "args");
  process.env.RADAR_PRUEBAS = "1";
  const r = await preparar(["--fase", "lista", "--ahora", "2026-11-03T14:47:00Z"], { raiz: carpetaTemporal() });
  assert.equal(r.linea.dir, ".trabajo/2026-11-03");
  delete process.env.RADAR_PRUEBAS;
});

test("sábado → salir/fin_de_semana con rutina-estado sin_mercado y aviso", async () => {
  const x = await correr(base(), "2026-10-31T13:47:00Z");
  assert.equal(x.r.codigo, 2); assert.equal(x.p.rutina.motivoSalida, "fin_de_semana");
  assert.deepEqual(x.orden, ["rutina-estado"]);
  assert.equal(leerSalida(x.dir, "salida/ahora/rutina-estado.json").estado, "sin_mercado");
  assert.equal(x.aviso, "Radar · sáb 31-oct · Fin de semana: sin operación.");
});

test("2026-11-26 9:47 → feriado (Thanksgiving)", async () => {
  const x = await correr(base(), "2026-11-26T14:47:00Z");
  assert.equal(x.r.codigo, 2); assert.equal(x.p.rutina.motivoSalida, "feriado");
  assert.equal(x.aviso, "Radar · jue 26-nov · Feriado NYSE (Thanksgiving Day): sin operación.");
  assert.deepEqual(x.orden, ["rutina-estado"]);
});

test("2026-11-27 9:47 → continuar con ventana.hasta 12:30 (cierre 13:00)", async () => {
  const x = await correr(base(), "2026-11-27T14:47:00Z");
  assert.equal(x.r.codigo, 0); assert.equal(x.p.rutina.accion, "continuar");
  assert.deepEqual(x.p.ventana, { desde: "09:45", hasta: "12:30", dentro: true });
  assert.equal(x.p.mercado.cierreAnticipado, true);
});

test("8:47 ET → temprano (sin escrituras en db); 15:40 ET → continuar con ventana.dentro false", async () => {
  const a = await correr(base(), "2026-11-02T13:47:00Z");
  assert.equal(a.r.codigo, 2); assert.equal(a.p.rutina.motivoSalida, "temprano"); assert.deepEqual(a.orden, []);
  assert.equal(a.aviso, "Radar · fuera de horario; corre a las 9:47 ET.");
  const b = await correr(base(), "2026-11-02T20:40:00Z");
  assert.equal(b.r.codigo, 0); assert.equal(b.p.rutina.accion, "continuar"); assert.equal(b.p.ventana.dentro, false); assert.equal(b.p.ventana.hasta, "15:30");
});

test("rutina-estado hecha hoy → ya_hecha; en_curso hoy → recuperar", async () => {
  const a = await correr(base({ "rutina-estado": { kind: "rutinaEstado", v: 1, fecha: "2026-11-02", estado: "hecha", paso: "cerrar", inicio: 1, fin: 2, intentos: 1 } }), LUN);
  assert.equal(a.r.codigo, 2); assert.equal(a.p.rutina.motivoSalida, "ya_hecha"); assert.deepEqual(a.orden, []);
  assert.equal(a.aviso, "Radar · la rutina de hoy ya corrió.");
  const b = await correr(base({ "rutina-estado": { kind: "rutinaEstado", v: 1, fecha: "2026-11-02", estado: "en_curso", paso: "radar", inicio: 1, fin: null, intentos: 1, ejecucion: { inicio: null, plan: [] } } }), LUN);
  assert.equal(b.r.codigo, 0); assert.equal(b.p.rutina.accion, "recuperar"); assert.equal(b.p.rutina.intentos, 2); assert.equal(b.p.recuperacion, null);
});

test("candado: corrida viva → esperar; done + día válido → usar_navegador; día parcial → correr", async () => {
  const viva = { kind: "corrida", v: 1, dateET: "2026-11-02", state: "running", startedAt: T - 60000, beatAt: T - 10000, runId: "dx-1", dev: "dx", auto: true };
  const a = await correr(base({ corrida: viva }), LUN);
  assert.equal(a.p.radar.accion, "esperar"); assert.deepEqual(a.orden, ["rutina-estado"]);
  const hecha = Object.assign({}, viva, { state: "done", finishedAt: T - 5000 });
  const b = await correr(base({ corrida: hecha, "dia-2026-11-02": diaHoy("2026-11-02") }), LUN);
  assert.equal(b.p.radar.accion, "usar_navegador"); assert.deepEqual(b.orden, ["rutina-estado"]);
  assert.deepEqual(leerSalida(b.dir, "trabajo/leer-mas.json").leer.slice(0, 4), ["dia-2026-11-02-p0", "dia-2026-11-02-p1", "dia-2026-11-02-p2", "dia-2026-11-02-p3"]);
  const c = await correr(base({ corrida: Object.assign({}, hecha, { state: "partial" }), "dia-2026-11-02": diaHoy("2026-11-02", { parcial: true }) }), LUN);
  assert.equal(c.p.radar.accion, "correr");
  // con correr: rutina-estado y luego el reclamo de corrida; corrida-error preparado con el mismo runId
  assert.deepEqual(c.orden, ["rutina-estado", "corrida"]);
  const rec = leerSalida(c.dir, "salida/ahora/corrida.json"), err = leerSalida(c.dir, "trabajo/corrida-error.json");
  assert.equal(rec.state, "running"); assert.equal(rec.dev, "drutina0001"); assert.equal(rec.runId, `drutina0001-rutina-${T}`); assert.equal(rec.auto, true);
  assert.equal(err.runId, rec.runId); assert.equal(err.state, "error"); assert.equal(err.reason, "rutina_sin_salida");
  const d = await correr(base(), LUN);
  assert.equal(d.p.radar.accion, "correr");
});

test("compat falso → usar_navegador si hay día del navegador; si no, sin_radar", async () => {
  const inc = Object.assign({}, pag, { compatible: false, diferencias: ["ui"] });
  const hecha = { kind: "corrida", v: 1, dateET: "2026-11-02", state: "done", startedAt: T - 600000, beatAt: T - 500000, runId: "dx-1", dev: "dx" };
  const a = await correr(base({ corrida: hecha, "dia-2026-11-02": diaHoy("2026-11-02") }), LUN, { pagina: inc });
  assert.equal(a.p.radar.accion, "usar_navegador"); assert.equal(a.p.compat.ok, false);
  const b = await correr(base(), LUN, { pagina: inc });
  assert.equal(b.p.radar.accion, "sin_radar"); assert.equal(b.p.radar.motivo, "pagina_cambio"); assert.deepEqual(b.orden, ["rutina-estado"]);
});

test("cartera-libro en _fallos → bloqueos.libro; sin cartera-libro → sin_semilla", async () => {
  const a = await correr(base(), LUN, { fallos: { "cartera-libro": "unavailable" } });
  assert.equal(a.r.codigo, 0); assert.equal(a.p.bloqueos.libro, true);
  const docs = base(); delete docs["cartera-libro"];
  const b = await correr(docs, LUN);
  assert.equal(b.r.codigo, 2); assert.equal(b.p.rutina.motivoSalida, "sin_semilla"); assert.deepEqual(b.orden, []);
  assert.equal(b.aviso, "Radar · Falta sembrar la Cartera Radar en db (T18); sin operaciones.");
});

test("rutina-estado de ayer en_curso con plan → continuar y recuperacion.de = ayer (se conserva en el nuevo estado)", async () => {
  const plan = [{ id: "2026-10-30-QQQ-C1", sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 3000, cierres: null, motivo: "x" }];
  const ayer = { kind: "rutinaEstado", v: 1, fecha: "2026-10-30", estado: "en_curso", paso: "ejecutando", inicio: 5, fin: null, intentos: 1, ejecucion: { inicio: 10, simulacion: false, planSha: "x", plan } };
  const x = await correr(base({ "rutina-estado": ayer }), LUN);
  assert.equal(x.p.rutina.accion, "continuar");
  assert.deepEqual(x.p.recuperacion, { de: "2026-10-30", inicio: 10, plan });
  const est = leerSalida(x.dir, "salida/ahora/rutina-estado.json");
  assert.equal(est.estado, "en_curso"); assert.deepEqual(est.recuperacion.plan, plan);
});

test("leer-mas: bitácora del último día, operaciones del mes de los pendientes, serie del año anterior en enero", async () => {
  const bi = { kind: "bitacoraIndice", v: 1, at: 1, dias: [{ f: "2026-10-30", estado: "completa" }] };
  const x = await correr(base({ "bitacora-indice": bi }), LUN);
  assert.deepEqual(leerSalida(x.dir, "trabajo/leer-mas.json").leer, ["bitacora-2026-10-30", "operaciones-2026-10"]);
  const y = await correr(base(), "2027-01-05T14:47:00Z");
  assert.ok(leerSalida(y.dir, "trabajo/leer-mas.json").leer.includes("cartera-serie-2026"));
});

test("--fase radar: tras 3 esperas con la corrida viva → sin_radar; si terminó → usar_navegador (con partes)", async () => {
  const viva = { kind: "corrida", v: 1, dateET: "2026-11-02", state: "running", startedAt: T - 60000, beatAt: T - 10000, runId: "dx-1", dev: "dx" };
  const x = await correr(base({ corrida: viva }), LUN);
  let r;
  for (let i = 1; i <= 3; i++) {
    const viva2 = Object.assign({}, viva, { beatAt: T + i * 120000 - 5000 });
    fs.writeFileSync(path.join(x.dir, "entrada/db/corrida.json"), JSON.stringify(viva2));
    r = await preparar(["--dir", x.dir, "--fase", "radar"], { ahora: () => T + i * 120000, pagina: pag });
    assert.equal(r.linea.accion, i < 3 ? "esperar" : "sin_radar", `espera ${i}`);
  }
  assert.equal(leerSalida(x.dir, "trabajo/preparar.json").radar.esperas, 3);
  // otra carpeta: tras una espera, la corrida terminó y el día (con partes) es válido
  const y = await correr(base({ corrida: viva }), LUN);
  const man = diaHoy("2026-11-02"), partes = [0, 1, 2, 3].map(k => Object.assign(leerFix(`dia-2026-10-30/dia-2026-10-30-p${k}.json`), {}));
  fs.writeFileSync(path.join(y.dir, "entrada/db/dia-2026-11-02.json"), JSON.stringify(man));
  partes.forEach((p, k) => fs.writeFileSync(path.join(y.dir, `entrada/db/dia-2026-11-02-p${k}.json`), JSON.stringify(p)));
  fs.writeFileSync(path.join(y.dir, "entrada/db/corrida.json"), JSON.stringify(Object.assign({}, viva, { state: "done", finishedAt: T + 60000 })));
  r = await preparar(["--dir", y.dir, "--fase", "radar"], { ahora: () => T + 120000, pagina: pag });
  assert.equal(r.linea.accion, "usar_navegador");
});

test("feriados: db → repo; 2027 desde feriados-nyse.json", () => {
  assert.equal(feriadosAnio({ anio: 2026, docDb: leerFix("dia-2026-10-30/feriados-2026.json") }).fuente, "db");
  const r = feriadosAnio({ anio: 2026 });
  assert.equal(r.fuente, "repo"); assert.equal(r.filas.length, 11);
  const r27 = feriadosAnio({ anio: 2027 });
  assert.ok(r27.filas.some(f => f.date === "2027-03-26" && f.isClosed));
  assert.equal(pag.C.marketState(Date.parse("2027-11-26T15:00:00Z"), r27.filas).earlyClose, true);
});
