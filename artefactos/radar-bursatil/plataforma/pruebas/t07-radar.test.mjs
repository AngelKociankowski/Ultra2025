// T07 · 10-radar
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as radar } from "../bin/10-radar.mjs";
import { escribirTrabajo } from "../lib/archivos.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { carpetaConDb, leerSalida, existe, leerFix, dia30 } from "./util.mjs";
import { PAGINA, fmpSintetico, NOW_SINT } from "./sintetico.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { crearValidador } from "./validar-salida.mjs";

const { C } = PAGINA;
const RUN = `drutina0001-rutina-${NOW_SINT}`;
function carpeta(docs = {}, fecha = "2026-11-02") {
  const dir = carpetaConDb(docs);
  escribirTrabajo(dir, "preparar.json", { fechaET: fecha, ahora: NOW_SINT, radar: { accion: "correr", runId: RUN, startedAt: NOW_SINT, esperas: 0 }, config: JSON.parse(JSON.stringify(CONFIG_DEFECTO)) });
  return dir;
}
const orden = dir => leerSalida(dir, "salida/radar/_orden.json");
const indice = dias => ({ kind: "indice", v: 1, at: 1, dias });

test("correr: dia-*, manifiesto, indice, corrida, contador y luego los borrar de días podados", async () => {
  const dir = carpeta({ indice: indice([{ dateET: "2026-11-02", parts: 3 }, { dateET: "2026-10-30", parts: 4 }, { dateET: "2026-10-16", parts: 4 }]) });
  const { transporte, ahora } = fmpSintetico();
  const r = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: transporte, ahora, pagina: PAGINA });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo"); assert.equal(r.linea.escribir, "salida/radar/_orden.json");
  const ids = orden(dir).map(x => `${x.accion[0]}:${x.id}`);
  const man = leerSalida(dir, "salida/radar/dia-2026-11-02.json"), n = man.parts.length;
  assert.deepEqual(ids, [...Array.from({ length: n }, (_, k) => `e:dia-2026-11-02-p${k}`), "e:dia-2026-11-02", "e:indice", "e:corrida", "e:contador-drutina0001",
    "b:dia-2026-10-16-p0", "b:dia-2026-10-16-p1", "b:dia-2026-10-16-p2", "b:dia-2026-10-16-p3", "b:dia-2026-10-16"]);
  assert.deepEqual(leerSalida(dir, "salida/radar/indice.json").dias, [{ dateET: "2026-11-02", parts: n }, { dateET: "2026-10-30", parts: 4 }]);
  const cor = leerSalida(dir, "salida/radar/corrida.json");
  assert.equal(cor.state, "done"); assert.equal(cor.runId, RUN); assert.ok(Number.isFinite(cor.finishedAt)); assert.equal(cor.dev, "drutina0001"); assert.equal(cor.startedAt, NOW_SINT);
  assert.equal(man.runId, RUN); assert.equal(man.dev, "drutina0001"); assert.equal(man.kind, "dia");
  const c = leerSalida(dir, "salida/radar/contador-drutina0001.json");
  assert.deepEqual(c.byCat, { sonda: 2, arranque: 0, franja: 13, tabla: 0, mercado: 0, macro: 2, corrida: 609, detalle: 0, manual: 0 }); assert.equal(c.used, 626);
  // lo que escribió la rutina lo une la página igual
  const partes = Array.from({ length: n }, (_, k) => leerSalida(dir, `salida/radar/dia-2026-11-02-p${k}.json`));
  const out = C.joinDay(man, partes);
  assert.equal(crearValidador(C)(out), true);
  const an = leerSalida(dir, "trabajo/analisis.json");
  assert.equal(an.fuente, "rutina"); assert.deepEqual(an.out, out); assert.equal(an.llamadas.total, 626);
});

test("error del corredor → solo corrida (error, reason) y contador; código 3 sin_radar", async () => {
  const dir = carpeta();
  const { transporte, ahora } = fmpSintetico({ falla: () => ({ http: 401, texto: "" }) });
  const r = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: transporte, ahora, pagina: PAGINA });
  assert.equal(r.codigo, 3); assert.equal(r.linea.accion, "sin_radar");
  assert.deepEqual(orden(dir).map(x => x.id), ["corrida", "contador-drutina0001"]);
  const cor = leerSalida(dir, "salida/radar/corrida.json");
  assert.equal(cor.state, "error"); assert.equal(cor.reason, "auth"); assert.equal(cor.runId, RUN);
  assert.equal(leerSalida(dir, "trabajo/analisis.json").fuente, "ninguna");
});

test("navegador con el volcado del 30-oct: analisis.json = joinDay del volcado y nada en salida/radar", async () => {
  const { man, partes, out } = dia30(C);
  const docs = { "dia-2026-10-30": man }; partes.forEach((p, k) => { docs[`dia-2026-10-30-p${k}`] = p; });
  const dir = carpeta(docs, "2026-10-30");
  const r = await radar(["--dir", dir, "--modo", "navegador"], { transporteFmp: transporteFalso(() => { throw new Error("sin FMP"); }), pagina: PAGINA });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo");
  const an = leerSalida(dir, "trabajo/analisis.json");
  assert.equal(an.fuente, "navegador"); assert.deepEqual(an.out, out); assert.equal(an.runId, man.runId);
  assert.ok(!existe(dir, "salida/radar"));
  // ninguno → código 3
  const n = await radar(["--dir", dir, "--modo", "ninguno"], { pagina: PAGINA });
  assert.equal(n.codigo, 3); assert.equal(leerSalida(dir, "trabajo/analisis.json").out, null);
});

test("día del navegador parcial y corrida propia peor → no emite dia-*, usa el del navegador", async () => {
  const { man, partes } = dia30(C);
  const hoy = Object.assign({}, man, { dateET: "2026-11-02", partial: true, partialReason: "por minuto", meta: Object.assign({}, man.meta, { partial: true, partialReason: "por minuto" }),
    parts: man.parts.map((p, i) => Object.assign({}, p, { id: `dia-2026-11-02-p${i}` })) });
  const docs = { "dia-2026-11-02": hoy }; partes.forEach((p, k) => { docs[`dia-2026-11-02-p${k}`] = p; });
  const dir = carpeta(docs);
  const { transporte, ahora } = fmpSintetico({ falla: (req, n) => (n >= 120 && n < 126 ? { http: 429, texto: '{"Error Message":"Limit Reach"}' } : null) });
  const r = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: transporte, ahora, pagina: PAGINA });
  assert.equal(r.codigo, 0);
  assert.deepEqual(orden(dir).map(x => x.id), ["corrida", "contador-drutina0001"]);
  assert.equal(leerSalida(dir, "salida/radar/corrida.json").state, "partial");
  const an = leerSalida(dir, "trabajo/analisis.json");
  assert.equal(an.fuente, "navegador"); assert.equal(an.out.rows.length, 66); assert.equal(an.parcial, true);
});

test("contador previo del mismo día se suma (otro día no)", async () => {
  const previo = { kind: "contador", v: 1, dev: "drutina0001", dateET: "2026-11-02", used: 10, byCat: { sonda: 2, arranque: 0, franja: 0, tabla: 0, mercado: 0, macro: 2, corrida: 6, detalle: 0, manual: 0 }, limitHit: false, suspect: null, at: 1 };
  const dir = carpeta({ "contador-drutina0001": previo });
  const { transporte, ahora } = fmpSintetico();
  await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: transporte, ahora, pagina: PAGINA });
  const c = leerSalida(dir, "salida/radar/contador-drutina0001.json");
  assert.equal(c.used, 636); assert.equal(c.byCat.corrida, 615); assert.equal(c.byCat.sonda, 4);
  const dir2 = carpeta({ "contador-drutina0001": Object.assign({}, previo, { dateET: "2026-10-30" }) });
  const s2 = fmpSintetico();
  await radar(["--dir", dir2, "--modo", "correr"], { transporteFmp: s2.transporte, ahora: s2.ahora, pagina: PAGINA });
  assert.equal(leerSalida(dir2, "salida/radar/contador-drutina0001.json").used, 626);
});
