// R2 (00p §2) · x18 del tester B5 (ronda 2): `db.mjs revisado` no quita la marca a ciegas: exige --libro con el cartera-libro que
// preparó la rutina (esquema, h y h esperado) y escribe libro y marca juntos; el día completo está en n05b
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as dbCli } from "../bin/db.mjs";
import { conH } from "../lib/db.mjs";
import { semilla, libroADb } from "../lib/libro.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { dbInicial, libroLunes, LUNES } from "./escenario.mjs";
import { carpetaConDb, carpetaTemporal, leerSalida } from "./util.mjs";

const bueno = conH(libroADb(libroLunes(), LUNES));
const estadoMarcado = () => ({ kind: "rutinaEstado", v: 2, fecha: "2026-11-02", estado: "hecha", paso: "cerrar", sesion: "s-a", inicio: "2026-11-02T14:47:00Z", latido: "2026-11-02T15:05:00Z",
  fin: "2026-11-02T15:05:00Z", commit: null, modo: "en_linea", ejecucionesAbiertas: [], previo: null, escritos: { "cartera-libro": bueno.h },
  motivo: null, revisar: { f: "2026-11-02", motivo: "no quedó en db como se preparó: cartera-libro", ids: ["cartera-libro"], esperado: { "cartera-libro": bueno.h } } });
const archivo = doc => { const f = path.join(carpetaTemporal(), "libro.json"); fs.writeFileSync(f, JSON.stringify(doc)); return f; };
const correr = (dir, extra = []) => dbCli(["revisado", "--dir", dir, ...extra], { ahora: () => Date.parse("2026-11-02T20:00:00Z") });

test("x18 · sin lectura → sin_lectura; sin marca → nada; sin --libro → se niega; libro con otro h o dañado → se niega", async () => {
  assert.equal((await correr(carpetaConDb({}), ["--libro", archivo(bueno)])).linea.accion, "sin_lectura");
  const sinMarca = estadoMarcado(); delete sinMarca.revisar;
  assert.equal((await correr(carpetaConDb({ "rutina-estado": sinMarca, "cartera-libro": semilla()["cartera-libro"] }), ["--libro", archivo(bueno)])).linea.accion, "nada");
  const dir = carpetaConDb({ "rutina-estado": estadoMarcado(), "cartera-libro": semilla()["cartera-libro"] }, null, { versiones: { "rutina-estado": 7, "cartera-libro": 4 } });
  const sinLibro = await correr(dir);
  assert.deepEqual([sinLibro.codigo, sinLibro.linea.accion], [1, "error"]);
  assert.match((await correr(dir, ["--libro", archivo(conH(semilla()["cartera-libro"]))])).linea.resumen.texto, /no es el que preparó la rutina/);
  assert.match((await correr(dir, ["--libro", archivo(Object.assign({}, bueno, { efectivo: 9 }))])).linea.resumen.texto, /integridad/);
  assert.match((await correr(dir, ["--libro", archivo({ kind: "carteraLibro" })])).linea.resumen.texto, /no es un cartera-libro válido/);
  assert.ok(!fs.existsSync(path.join(dir, "salida/revisado")));
  const ok = await correr(dir, ["--libro", archivo(bueno)]);
  assert.equal(ok.codigo, 0);
  assert.deepEqual(leerSalida(dir, "salida/revisado/db_write.json").ops.map(o => [o.path.slice(DB_RUTA.length + 1), o.ifVersion]), [["cartera-libro", 4], ["rutina-estado", 7]]);
});

test("x18 · versión vieja de rutina-estado (otra escritura en medio): el db rechaza todo; ni el libro ni la marca cambian", async () => {
  const db = dbInicial({ "rutina-estado": estadoMarcado() });
  const dir = carpetaConDb({ "rutina-estado": db.doc("rutina-estado"), "cartera-libro": db.doc("cartera-libro") }, null, { versiones: { "rutina-estado": 1, "cartera-libro": 1 } });
  assert.equal((await correr(dir, ["--libro", archivo(bueno)])).codigo, 0);
  db.docs.get(`${DB_RUTA}/rutina-estado`).version += 1; // escritura ajena
  const antes = db.doc("cartera-libro").h;
  const r = db.write(leerSalida(dir, "salida/revisado/db_write.json"));
  assert.equal(r.error.code, "version_mismatch");
  assert.equal(db.doc("cartera-libro").h, antes); assert.ok(db.doc("rutina-estado").revisar);
});
