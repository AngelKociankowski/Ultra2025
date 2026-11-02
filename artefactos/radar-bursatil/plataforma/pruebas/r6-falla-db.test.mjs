// R6 (12c §I.2, tester ronda 4): cuando el reintento falla porque la base no respondió, registrar sale `db_no_disponible` (no
// `conflicto`) y el aviso de F6 lo dice; con otra escritura (409 real) sigue saliendo `conflicto` con su texto. Porta
// runbook-dia4.mjs 2026-11-06T14:47:00Z --modo archivo --falla-final (dos `unavailable`); igual en línea.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { conH, registrar } from "../lib/db.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { DB_SLUG, DB_RUTA } from "../lib/constantes.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { prepararDia, dbInicial } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

const T = Date.parse("2026-11-06T14:47:00Z"), RECHAZO = leerFix("db/artifactdata-lunes.json").rechazo_version_vieja;
const dia = (modo, fallaEscritura = null) => prepararDia({ db: dbInicial({ "cartera-libro": leerFix("db/lunes-real-libro-v2.json"), "rutina-estado": leerFix("db/lunes-real-estado-v2.json") }),
  t: T, modo, sinRadar: true, portafolio: leerFix("etoro/lunes-real-portfolio.json"), fallaEscritura });
const leer = (dir, f) => fs.readFileSync(path.join(dir, "salida", f), "utf8");

for (const modo of ["archivo", "en_linea"]) {
  test(`${modo}: el final falla dos veces sin ser de versión → db_no_disponible; F6 dice "no respondió", no "otra escritura"`, async () => {
    const e = await dia(modo, { grupo: "final", veces: 2, codigo: "unavailable" });
    await cerrar(["--dir", e.dir], { ahora: () => T + 15 * 60000 });
    const antes = e.db.version("rutina-estado"), r = e.S.escribir("final");
    assert.deepEqual([r.codigo, r.accion], [3, "db_no_disponible"]);
    assert.deepEqual(leerTrabajo(e.dir, "falla-db.json"), { tipo: "db_no_disponible", codigo: "unavailable", ids: r.resumen.sin_confirmar });
    assert.equal(e.db.version("rutina-estado"), antes);
    await cerrar(["--dir", e.dir, "--degradado", "db"], { ahora: () => T + 16 * 60000 });
    const aviso = leer(e.dir, "aviso.txt"), push = leer(e.dir, "aviso-push.txt");
    assert.ok(aviso.includes("Falla: db no respondió al guardar (unavailable); no se perdió nada: el día siguiente lo recupera."), aviso);
    assert.ok(!/otra escritura/.test(aviso));
    assert.equal(push, "Radar · vie 6-nov · Falla: db no respondió"); assert.ok(push.length <= 200);
  });
}

test("con otra escritura de verdad sigue saliendo conflicto: por el 409 medido en el reintento y por un id ajeno al releer", async () => {
  // reintento rechazado con el texto real de versión vieja → conflicto (la sesión escribe aquí las respuestas a mano)
  const e = await dia("archivo");
  await cerrar(["--dir", e.dir], { ahora: () => T + 15 * 60000 });
  const g = path.join(e.dir, "salida/final");
  fs.writeFileSync(path.join(g, "resultado.txt"), "db batch write failed (unavailable): the database is busy; nothing was written, retry later");
  assert.equal(registrar({ dir: e.dir, grupo: "final" }).accion, "releer");
  e.S.leer(leerTrabajo(e.dir, "releer.json").lecturas);
  assert.equal(registrar({ dir: e.dir, grupo: "final", verificar: true }).accion, "reintentar");
  fs.writeFileSync(path.join(g, "resultado-reintento.txt"), RECHAZO);
  const r = registrar({ dir: e.dir, grupo: "final", reintento: true });
  assert.deepEqual([r.codigo, r.accion, leerTrabajo(e.dir, "falla-db.json").tipo, leerTrabajo(e.dir, "falla-db.json").codigo], [3, "conflicto", "conflicto", "version_mismatch"]);
  // otra escritura sube rutina-estado antes del final → ajeno al releer → conflicto con el id
  const f = await dia("archivo");
  await cerrar(["--dir", f.dir], { ahora: () => T + 15 * 60000 });
  f.db.write({ slug: DB_SLUG, ops: [{ op: "set", path: `${DB_RUTA}/rutina-estado`, data: conH(Object.assign({}, f.db.doc("rutina-estado"), { latido: "2026-11-06T15:00:00Z" })), ifVersion: f.db.version("rutina-estado") }] });
  const rf = f.S.escribir("final");
  assert.deepEqual([rf.codigo, rf.accion], [3, "conflicto"]);
  assert.deepEqual(leerTrabajo(f.dir, "falla-db.json"), { tipo: "conflicto", codigo: "ajeno", ids: ["rutina-estado"] });
  await cerrar(["--dir", f.dir, "--degradado", "db"], { ahora: () => T + 16 * 60000 });
  assert.ok(leer(f.dir, "aviso.txt").includes("Falla: db — otra escritura cambió rutina-estado; la rutina se detuvo."));
  assert.equal(leer(f.dir, "aviso-push.txt"), "Radar · vie 6-nov · Falla: db cambió por otra escritura");
});
