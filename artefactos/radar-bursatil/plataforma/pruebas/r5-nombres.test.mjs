// R5 (12c §I.1, tester ronda 4): los textos de modo archivo salen de un contador global del día; verificar.json (armado antes de
// escribir) y releer.json (armado después de un fallo del final) nunca comparten nombre. Porta runbook-dia4.mjs
// 2026-11-09T14:47:00Z --modo archivo --falla-final; la sesión falsa nunca pisa un archivo (variante --no-sobrescribir).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lectura } from "../lib/db.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { prepararDia, dbInicial } from "./escenario.mjs";
import { carpetaConDb, leerFix } from "./util.mjs";

test("200 lecturas sobre 3 ids dan 200 nombres de texto distintos (contador global)", () => {
  const dir = carpetaConDb({}, null, { modo: "archivo" }), nombres = new Set();
  for (let i = 0; i < 200; i++) nombres.add(lectura(["rutina-estado", "cartera-libro", "etoro-mapa"][i % 3], { dirAbs: dir }).archivo.texto);
  assert.equal(nombres.size, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "entrada/archivo/_reservas.json"), "utf8")), { siguiente: 201 });
});

test("lun 9-nov, modo archivo, el final falla una vez (unavailable): releer y verificar no comparten nombres; verificar ok y `hecha` sin pisar ningún archivo", async () => {
  const t = Date.parse("2026-11-09T14:47:00Z");
  const db = dbInicial({ "cartera-libro": leerFix("db/lunes-real-libro-v2.json"), "rutina-estado": leerFix("db/lunes-real-estado-v2.json") });
  const e = await prepararDia({ db, t, modo: "archivo", sinRadar: true, portafolio: leerFix("etoro/lunes-real-portfolio.json"), fallaEscritura: { grupo: "final", veces: 1, codigo: "unavailable" } });
  await cerrar(["--dir", e.dir], { ahora: () => t + 15 * 60000 });
  const verif = leerTrabajo(e.dir, "verificar.json").lecturas;
  const r = e.S.escribir("final"); // la sesión falsa escribe los textos con flag "wx": si un nombre ya existiera, fallaría
  assert.equal(r.accion, "listo");
  const releer = leerTrabajo(e.dir, "releer.json").lecturas;
  assert.ok(releer.some(l => l.id === "rutina-estado") && verif.some(l => l.id === "rutina-estado"));
  const nombresR = new Set(releer.map(l => l.archivo.texto));
  for (const l of verif) assert.ok(!nombresR.has(l.archivo.texto), l.archivo.texto);
  e.S.leer(verif);
  const v = await dbCli(["verificar", "--dir", e.dir]);
  assert.deepEqual([v.codigo, v.linea.resumen.h_ok, v.linea.resumen.estado], [0, true, "hecha"]);
  assert.equal(db.doc("rutina-estado").estado, "hecha"); assert.equal(db.doc("rutina-estado").fecha, "2026-11-09");
  // todos los textos del día tienen nombre distinto y cada línea de lecturas.jsonl apunta a uno
  const lineas = fs.readFileSync(path.join(e.dir, "entrada/lecturas.jsonl"), "utf8").trim().split("\n").map(x => JSON.parse(x).texto);
  assert.equal(new Set(lineas).size, lineas.length);
});
