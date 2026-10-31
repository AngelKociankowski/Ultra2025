// T15 · Cierre, bitácora y aviso
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { escribirTrabajo, escribirJson } from "../lib/archivos.mjs";
import { armarAviso } from "../lib/aviso.mjs";
import { DOC_MAX } from "../lib/constantes.mjs";
import { esquemaDe } from "./esquemas.mjs";
import { prepararDia, OUT30, libroLunes, PAG } from "./escenario.mjs";
import { leerSalida, carpetaConDb, leerFix } from "./util.mjs";
import { transporteFalso } from "../lib/http.mjs";

const copia = o => JSON.parse(JSON.stringify(o));
const aviso = dir => fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8");
const orden = dir => leerSalida(dir, "salida/final/_orden.json");
const NOTAS = { v: 1, generadoEl: "2026-11-02T15:00:00Z", notas: [{ id: "n1", titulo: "Fed holds rates steady as inflation cools", medio: "Reuters", url: "https://www.reuters.com/markets/us/fed-holds-2026-11-02/",
  fecha: "2026-11-02", tema: "macro", simbolos: [], resumen: "La Reserva Federal mantuvo su tasa sin cambios.", evento: null }] };
function outXleEvitar() {
  const out = copia(OUT30), xle = out.rows.find(r => r.symbol === "XLE");
  Object.assign(xle, { signal: 1, signalLabel: "Evitar", pct: 44 });
  return out;
}
const EJEC_XLE = t => ({ inicio: t + 610000, resultados: [{ id: "2026-11-02-XLE-V1", estado: "ejecutada", orderId: 391400001, positionIds: [2600000005],
  ejecucion: { precio: 70.1, unidades: 27.059025, montoUSD: 1896.84, at: "2026-11-02T15:01:00Z" }, error: null,
  detalle: [{ positionId: 2600000005, unidades: null, estado: "ejecutada", precio: 70.1, orderId: 391400001 }] }], efectivoAntesUSD: 0.56, efectivoDespuesUSD: 1897.4 });

test("día completo (lunes, órdenes iniciales ejecutadas): orden de escritura y esquemas", async () => {
  const e = await prepararDia({ notas: NOTAS });
  escribirJson(path.join(e.dir, "trabajo/noticias-fmp.json"), { porSimbolo: {}, generales: [], economico: [], resultados: [], errores: [], llamadas: 4 });
  escribirJson(path.join(e.dir, "salida/radar/contador-drutina0001.json"), { kind: "contador", v: 1, dev: "drutina0001", dateET: "2026-11-02", used: 626,
    byCat: { sonda: 2, arranque: 0, franja: 13, tabla: 0, mercado: 0, macro: 2, corrida: 609, detalle: 0, manual: 0 }, limitHit: false, suspect: null, at: 1 });
  const r = await cerrar(["--dir", e.dir], { ahora: () => e.t + 900000 });
  assert.equal(r.codigo, 0); assert.equal(r.linea.escribir, "salida/final/_orden.json");
  assert.deepEqual(orden(e.dir).map(x => x.id), ["operaciones-2026-10", "cartera-libro", "cartera-serie-2026", "etoro-mapa", "contador-drutina0001", "bitacora-2026-11-02", "bitacora-indice", "rutina-estado"]);
  for (const x of orden(e.dir)) {
    const doc = leerSalida(e.dir, x.archivo);
    assert.deepEqual(esquemaDe(doc), [], x.id);
    assert.ok(Buffer.byteLength(JSON.stringify(doc)) <= DOC_MAX, x.id);
    assert.ok(!/"CID"/.test(JSON.stringify(doc)), x.id);
  }
  const c = leerSalida(e.dir, "salida/final/contador-drutina0001.json");
  assert.equal(c.byCat.manual, 4); assert.equal(c.used, 630);
  const ops = leerSalida(e.dir, "salida/final/operaciones-2026-10.json").ops;
  assert.ok(ops.every(o => o.estado === "ejecutada"));
  const libro = leerSalida(e.dir, "salida/final/cartera-libro.json");
  assert.equal(libro.pendientes.length, 0); assert.equal(libro.ultimaRutina, "2026-11-02");
  const est = leerSalida(e.dir, "salida/final/rutina-estado.json");
  assert.equal(est.estado, "hecha"); assert.equal(est.paso, "cerrar");
  const b = leerSalida(e.dir, "salida/final/bitacora-2026-11-02.json");
  assert.equal(b.estado, "completa"); assert.equal(b.sesion.simulacion, true); assert.equal(b.radar.fuente, "navegador"); assert.equal(b.senales.length, 66);
  assert.equal(b.aviso, aviso(e.dir));
  assert.deepEqual(leerSalida(e.dir, "salida/final/bitacora-indice.json").dias, [{ f: "2026-11-02", estado: "completa", vUSD: 32010.04, rDia: b.rendimientos.usd.dia, nOps: 0, sim: true }]);
});

test("aviso: normal con operaciones, simulación y feriado (texto exacto, ≤ 700)", async () => {
  const real = await prepararDia({ libro: libroLunes(), out: outXleEvitar(), notas: NOTAS, config: { operar: true, activadoEl: "2026-11-01T15:00:00Z" } });
  escribirTrabajo(real.dir, "ejecucion.json", EJEC_XLE(real.t));
  await cerrar(["--dir", real.dir], { ahora: () => real.t + 900000 });
  assert.equal(aviso(real.dir), [
    "Radar · lun 2-nov · 10:05 ET",
    "Cartera: US$ 32,010 (+0.16 % hoy · +0.16 % desde inicio) · MXN $ 600,956 (+0.16 %)",
    "vs SPY desde inicio: −0.23 % · meta 15 % anual: +0.04 pts",
    "Radar: régimen Favorable",
    "Noticias: Fed holds rates steady as inflation cools (Reuters)",
    "Operaciones: 1 — vendí XLE (V1)",
  ].join("\n"));
  const lr = leerSalida(real.dir, "salida/final/cartera-libro.json");
  assert.equal(lr.efectivoUSD, 1897.4); assert.equal(lr.realizadoUSD, 8.12); // 1 896.84 − 1 888.72
  assert.deepEqual(leerSalida(real.dir, "salida/final/operaciones-2026-11.json").ops.map(o => [o.id, o.estado, o.simulacion]), [["2026-11-02-XLE-V1", "ejecutada", false]]);
  const sim = await prepararDia({ libro: libroLunes(), out: outXleEvitar(), notas: NOTAS });
  await cerrar(["--dir", sim.dir], { ahora: () => sim.t + 900000 });
  assert.equal(aviso(sim.dir), [
    "Radar · lun 2-nov · 10:05 ET · SIMULACIÓN",
    "Cartera: US$ 32,010 (+0.16 % hoy · +0.16 % desde inicio) · MXN $ 600,956 (+0.16 %)",
    "vs SPY desde inicio: −0.23 % · meta 15 % anual: +0.04 pts",
    "Radar: régimen Favorable",
    "Noticias: Fed holds rates steady as inflation cools (Reuters)",
    "Operaciones: 1 simulada — vender XLE (V1)",
  ].join("\n"));
  const ls = leerSalida(sim.dir, "salida/final/cartera-libro.json");
  assert.equal(ls.efectivoUSD, 0.56); assert.equal(ls.posiciones.length, 4);
  assert.deepEqual(leerSalida(sim.dir, "salida/final/operaciones-2026-11.json").ops.map(o => [o.estado, o.simulacion]), [["simulada", true]]);
  // feriado: lo arma 00-preparar
  const fer = carpetaConDb({ "cartera-libro": libroLunes() });
  await preparar(["--dir", fer, "--fase", "decidir"], { ahora: () => Date.parse("2026-11-26T14:47:00Z"), pagina: PAG });
  assert.equal(aviso(fer), "Radar · jue 26-nov · Feriado NYSE (Thanksgiving Day): sin operación.");
  // tope de 700 con muchas alertas y notas largas
  const largo = armarAviso({ fecha: "2026-11-02", hora: "09:58", simulacion: false, cartera: null, rend: null, radar: { regimen: "Favorable", cambios: [] },
    notas: [{ titulo: "x".repeat(300), medio: "Reuters" }, { titulo: "y".repeat(300), medio: "WSJ" }], operaciones: [], alertas: Array.from({ length: 30 }, (_, i) => "alerta larga ".repeat(5) + i), fallas: [] });
  assert.ok(largo.length <= 700); assert.match(largo, /^Radar · lun 2-nov · 9:58 ET/);
});

test("--degradado radar y --degradado cartera: bitácora degradada y línea Falla:", async () => {
  const a = await prepararDia({ sinRadar: true });
  await cerrar(["--dir", a.dir, "--degradado", "radar"], { ahora: () => a.t + 900000 });
  assert.equal(leerSalida(a.dir, "salida/final/bitacora-2026-11-02.json").estado, "degradada");
  assert.match(aviso(a.dir), /\nRadar: sin análisis de hoy \(auth\)\n/);
  assert.match(aviso(a.dir), /\nFalla: radar — el Radar no corrió; sin análisis de hoy$/);
  assert.equal(leerSalida(a.dir, "salida/final/rutina-estado.json").estado, "degradada");
  const b = await prepararDia({ etoro: transporteFalso(() => ({ http: 503, texto: "" })) });
  const r = await cerrar(["--dir", b.dir, "--degradado", "cartera"], { ahora: () => b.t + 900000 });
  assert.equal(r.codigo, 0);
  const bb = leerSalida(b.dir, "salida/final/bitacora-2026-11-02.json");
  assert.equal(bb.estado, "degradada"); assert.deepEqual(esquemaDe(bb), []);
  assert.match(aviso(b.dir), /Falla: cartera — sin datos de eToro; sin órdenes hoy/);
  assert.ok(!orden(b.dir).some(x => x.id === "cartera-libro"), "sin eToro no se reescribe el libro");
  assert.equal((await cerrar(["--dir", b.dir, "--degradado", "otro"])).codigo, 1);
});

test("bitacora-indice con 400 días: poda el más viejo y lo pone en borrar antes de rutina-estado", async () => {
  const dias = Array.from({ length: 400 }, (_, i) => ({ f: new Date(Date.parse("2026-11-01T12:00:00Z") - i * 86400000).toISOString().slice(0, 10), estado: "completa", vUSD: 1, rDia: 0, nOps: 0, sim: true }));
  const e = await prepararDia({ indice: { kind: "bitacoraIndice", v: 1, at: 1, dias } });
  await cerrar(["--dir", e.dir], { ahora: () => e.t + 900000 });
  const o = orden(e.dir), idx = leerSalida(e.dir, "salida/final/bitacora-indice.json");
  assert.equal(idx.dias.length, 400); assert.equal(idx.dias[0].f, "2026-11-02");
  const viejo = dias[399].f;
  assert.deepEqual(o.slice(-3), [{ id: "bitacora-indice", archivo: "salida/final/bitacora-indice.json", accion: "escribir" }, { id: `bitacora-${viejo}`, accion: "borrar" },
    { id: "rutina-estado", archivo: "salida/final/rutina-estado.json", accion: "escribir" }]);
});

test("cambios del Radar contra la bitácora anterior: señal 2→3 y entrada al objetivo", async () => {
  const prev = { kind: "bitacora", v: 1, fecha: "2026-10-30", senales: OUT30.rows.map(r => [r.symbol, r.symbol === "XLF" ? 2 : r.signal, r.symbol === "XLF" ? 51 : r.pct]),
    objetivo: [{ id: "SPY", peso: 0.65 }, { id: "DIA", peso: 0.2 }, { id: "XLE", peso: 0.06 }], radar: { regimen: { estado: "FAVORABLE", etiqueta: "Favorable" } } };
  const idx = { kind: "bitacoraIndice", v: 1, at: 1, dias: [{ f: "2026-10-30", estado: "completa", vUSD: 1, rDia: 0, nOps: 0, sim: true }] };
  const e = await prepararDia({ indice: idx, docs: { "bitacora-2026-10-30": prev } });
  await cerrar(["--dir", e.dir], { ahora: () => e.t + 900000 });
  const b = leerSalida(e.dir, "salida/final/bitacora-2026-11-02.json");
  assert.deepEqual(b.radar.cambios, [{ sym: "XLF", tipo: "entra_objetivo", antes: null, ahora: { peso: b.objetivo.find(o => o.id === "XLF").peso } },
    { sym: "XLF", tipo: "senal", antes: { senal: 2, pct: 51 }, ahora: { senal: 3, pct: 62 } }]);
  assert.deepEqual(b.radar.regimenAntes, { estado: "FAVORABLE", etiqueta: "Favorable" });
  assert.match(aviso(e.dir), /\nRadar: régimen Favorable; XLF entra al objetivo; XLF pasa a Compra\n/);
});
