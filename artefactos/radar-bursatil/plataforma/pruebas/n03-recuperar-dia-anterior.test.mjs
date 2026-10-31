// N3 · x02 del tester B5 (17): el día que sigue a una sesión caída (recuperar de otro día) escribe punto-, radar-, bitacora- y
// ops- de hoy (12b §O F1-A, §E.6): es la primera sesión de hoy, como continuar
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { prepararDia, dbInicial, OUT30, tasasA, copia } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { leerFix, leerSalida } from "./util.mjs";

test("x02 · día 1 muere antes de ESCRIBIR final; día 2 (recuperar de ayer) escribe los 4 documentos del día y queda hecha", async () => {
  const db = dbInicial({});
  const d1 = await prepararDia({ db });
  await cerrar(["--dir", d1.dir], { ahora: () => d1.t + 15 * 60000 });
  const t2 = Date.parse("2026-11-03T14:47:00Z");
  const out = copia(OUT30); Object.assign(out.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 });
  const d2 = await prepararDia({ db, t: t2, out, etoro: etoroFalso({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, t2) }) });
  assert.equal(d2.preparar.linea.accion, "recuperar");
  await cerrar(["--dir", d2.dir], { ahora: () => t2 + 15 * 60000 });
  const ops = leerSalida(d2.dir, "salida/final/db_write.json").ops, ids = ops.map(o => o.path.split("/").pop());
  for (const id of ["punto-2026-11-03", "radar-2026-11-03", "bitacora-2026-11-03", "ops-2026-11-03"]) {
    assert.ok(ids.includes(id), id);
    assert.equal(ops.find(o => o.path.endsWith("/" + id)).ifVersion, undefined, `${id} es nuevo: sin ifVersion`);
  }
  assert.ok(!leerSalida(d2.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith("/bitacora-2026-11-03")).data.alertas.some(a => /^no se leyó/.test(a)));
  assert.equal(d2.S.escribir("final").accion, "listo");
  assert.ok(db.doc("bitacora-2026-11-03")); assert.equal(db.doc("rutina-estado").estado, "hecha");
});
