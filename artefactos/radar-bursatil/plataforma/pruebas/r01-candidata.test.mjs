// R1 (00p §2) · x17 del tester B5 (ronda 2): la fecha de una ejecución enviada queda en db antes del primer POST (en el mismo
// db_write del reclamo) y una candidata solo sale de ejecucionesAbiertas cuando se concilió; si su lectura falla o llega dañada,
// se conserva, el día no opera y el aviso lo dice
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { leerVersiones } from "../lib/db.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, planDe } from "./ejecucion.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const F1 = "2026-11-02", QQQ = [Object.assign({}, planDe(F1)[2], { orden: 1 })];
const tasas = t => tasasA(leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 691, ask: 691.2 }]), t);

test("R1 · el reclamo y la fecha en rutina-estado.ejecucionesAbiertas van juntos en pre-ejecucion, antes del primer POST", async () => {
  const e = await diaReal({ plan: QQQ });
  const base = reloj(new Date(e.t + 11 * 60000).toISOString());
  let vistoEnPost = null;
  const t = etoroGuion({ reloj: base, antesDePost: () => { vistoEnPost = e.db.doc("rutina-estado").ejecucionesAbiertas; } });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  const w = leerSalida(e.dir, "salida/pre-ejecucion/db_write.json").ops;
  assert.deepEqual(w.map(o => [o.path.slice(DB_RUTA.length + 1), o.ifVersion]), [[`ejecucion-${F1}`, undefined], ["rutina-estado", e.db.version("rutina-estado")]]);
  assert.deepEqual(w[1].data.ejecucionesAbiertas, [F1]);
  assert.equal(w[1].data.latido, e.db.doc("rutina-estado").latido, "el latido sigue siendo el del ahora");
  assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
  await ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  assert.deepEqual(vistoEnPost, [F1]);
  assert.equal(posts(t).length, 1);
});

for (const modo of ["fallo", "corrupto"]) {
  test(`x17 (${modo}) · la lectura de ejecucion-<candidata> ${modo === "fallo" ? "falla" : "llega dañada"}: el día no opera, el aviso lo dice, la fecha sigue; al otro día se concilia`, async () => {
    const e = await diaReal({ plan: QQQ });
    const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base });
    await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
    e.S.escribir("pre-ejecucion");
    await ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
    // la sesión muere sin 60-cerrar
    const t2 = Date.parse("2026-11-03T14:47:00Z");
    const corromper = L => (L.id !== `ejecucion-${F1}` ? L : modo === "fallo" ? { id: L.id, error: "resource_exhausted" } : (L.data ? Object.assign({}, L, { data: JSON.parse(JSON.stringify(L.data).replace('"usd":1500', '"usd":1501')) }) : L));
    const d2 = await prepararDia({ db: e.db, t: t2, corromper, etoro: etoroFalso({ portafolio: t.pf, tasas: tasas(t2) }) });
    assert.equal(leerVersiones(d2.dir)[`ejecucion-${F1}`].estado, modo);
    assert.equal(leerTrabajo(d2.dir, "cartera.json").estado, "sin_libro");
    assert.notEqual(d2.decidir.linea.accion, "ejecutar");
    await cerrar(["--dir", d2.dir], { ahora: () => t2 + 15 * 60000 });
    const fin = leerSalida(d2.dir, "salida/final/db_write.json").ops, est = fin.find(o => o.path.endsWith("/rutina-estado")).data;
    assert.deepEqual(est.ejecucionesAbiertas, [F1]);
    assert.ok(!fin.some(o => o.path.endsWith("/cartera-libro")));
    assert.match(fs.readFileSync(path.join(d2.dir, "salida/aviso.txt"), "utf8"), new RegExp(`Falla: cartera — ejecucion-${F1} llegó dañada o no se pudo leer: sin conciliación ni órdenes hoy`));
    assert.equal(d2.S.escribir("final").accion, "listo");
    // día 3: lectura buena
    const t3 = Date.parse("2026-11-04T14:47:00Z");
    const d3 = await prepararDia({ db: e.db, t: t3, etoro: etoroFalso({ portafolio: t.pf, tasas: tasas(t3) }) });
    assert.ok(leerTrabajo(d3.dir, "leer-mas.json").lecturas.some(l => l.id === `ejecucion-${F1}`));
    const c3 = leerTrabajo(d3.dir, "cartera.json");
    assert.ok(c3.libro.posiciones.some(p => p.sym === "QQQ"));
    assert.equal(c3.libro.efectivoUSD, 3500);
    await cerrar(["--dir", d3.dir], { ahora: () => t3 + 15 * 60000 });
    assert.deepEqual(leerSalida(d3.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith("/rutina-estado")).data.ejecucionesAbiertas, []);
    assert.equal(posts(t).length, 1);
  });
}
