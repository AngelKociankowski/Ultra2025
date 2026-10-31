// N1 · x01 del tester B5 (17), H6 reabierto: la sesión muere después de --enviar y antes de escribir final (o final choca, F6);
// al día siguiente, en otra carpeta, la ejecución abierta se lee y se concilia (12b §F.5) aunque rutina-estado no la liste
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, dbInicial, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, planDe } from "./ejecucion.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const F1 = "2026-11-02", QQQ = [Object.assign({}, planDe(F1)[2], { orden: 1 })];

for (const variante of ["sin-cerrar", "final-409"]) {
  test(`x01 (${variante}) · día 2 lee ejecucion-${F1}, la concilia: lote QQQ, efectivo 3 500; final la cierra`, async () => {
    const e = await diaReal({ plan: QQQ });
    const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base });
    await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
    assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
    await ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
    assert.equal(posts(t).length, 1);
    if (variante === "final-409") {
      await cerrar(["--dir", e.dir], { ahora: () => e.t + 15 * 60000 });
      e.db.docs.get(`${DB_RUTA}/rutina-estado`).version += 1; // escritura ajena
      assert.equal(e.S.escribir("final").accion, "conflicto");
    }
    // R1 (00p): la fecha ya quedó en db con el reclamo, antes del POST
    assert.deepEqual([e.db.doc("rutina-estado").estado, e.db.doc("rutina-estado").ejecucionesAbiertas], ["en_curso", [F1]]);
    const t2 = Date.parse("2026-11-03T14:47:00Z");
    const et2 = etoroFalso({ portafolio: t.pf, tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 691, ask: 691.2 }]), t2) });
    const d = await prepararDia({ db: e.db, t: t2, etoro: et2 });
    assert.equal(d.preparar.linea.accion, "recuperar");
    assert.deepEqual(leerTrabajo(d.dir, "preparar.json").recuperacion, { ejecuciones: [F1] });
    assert.ok(leerTrabajo(d.dir, "leer-mas.json").lecturas.some(l => l.id === `ejecucion-${F1}`));
    const c = leerTrabajo(d.dir, "cartera.json");
    assert.deepEqual(c.libro.posiciones.find(p => p.sym === "QQQ").lotes.map(l => l.positionId), [2800000001]);
    assert.equal(c.libro.efectivoUSD, 3500);
    await cerrar(["--dir", d.dir], { ahora: () => t2 + 15 * 60000 });
    const fin = leerSalida(d.dir, "salida/final/db_write.json").ops, ej = fin.find(o => o.path.endsWith(`/ejecucion-${F1}`));
    assert.ok(ej && ej.data.fin); assert.deepEqual(ej.data.res.map(r => r.est), ["ejecutada"]);
    assert.deepEqual(fin.find(o => o.path.endsWith("/rutina-estado")).data.ejecucionesAbiertas, []);
    assert.equal(d.S.escribir("final").accion, "listo");
    assert.equal(posts(t).length, 1);
  });
}

test("x01 · la candidata de una sesión caída que no armó nada (ejecucion-<f> no existe) sale de la lista", async () => {
  const db = dbInicial({});
  const d1 = await prepararDia({ db }); // muere: no escribe final
  assert.equal(db.doc("rutina-estado").estado, "en_curso");
  const t2 = Date.parse("2026-11-03T14:47:00Z");
  const d2 = await prepararDia({ db, t: t2, tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, t2) });
  assert.deepEqual(leerTrabajo(d2.dir, "preparar.json").recuperacion, { ejecuciones: [F1] });
  await cerrar(["--dir", d2.dir], { ahora: () => t2 + 15 * 60000 });
  assert.deepEqual(leerSalida(d2.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith("/rutina-estado")).data.ejecucionesAbiertas, []);
  assert.ok(d1.dir !== d2.dir);
});
