// H06 · A3.2 portado (12b §F.5): --enviar y --reanudar mueren sin ejecucion.json; 60-cerrar --degradado deja la ejecución
// abierta; al día siguiente preparar la lista, 20-cartera la concilia sin diario y 60-cerrar la cierra. Dos días con db falso.
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, planDe } from "./ejecucion.mjs";
import { leerSalida, leerFix } from "./util.mjs";

const F1 = "2026-11-02", QQQ = [Object.assign({}, planDe(F1)[2], { orden: 1 })];
const opDe = (dir, id) => leerSalida(dir, "salida/final/db_write.json").ops.find(o => o.path === `${DB_RUTA}/${id}`);

async function dosDias({ visible }) {
  const e = await diaReal({ plan: QQQ });
  const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base, retrasoVisible: visible ? 0 : 100000 });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
  let cortar = false;
  const muere = () => { if (cortar) throw new Error("proceso cortado"); return base(); };
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: async q => { const r = await t(q); if (q.metodo === "POST") cortar = true; return r; }, ahora: muere, dormir: sinEspera }));
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--reanudar"], { transporteEToro: t, ahora: () => { throw new Error("proceso cortado"); }, dormir: sinEspera }));
  assert.equal(posts(t).length, 1);
  // F8: cierre degradado; la ejecución queda abierta y el libro no cambia
  assert.equal((await cerrar(["--dir", e.dir, "--degradado", "ejecutar"], { ahora: () => e.t + 15 * 60000 })).codigo, 0);
  const est1 = opDe(e.dir, "rutina-estado").data;
  assert.deepEqual([est1.estado, est1.ejecucionesAbiertas], ["degradada", [F1]]);
  assert.ok(!opDe(e.dir, `ejecucion-${F1}`), "--degradado nunca cierra una ejecución abierta");
  assert.equal(opDe(e.dir, "bitacora-2026-11-02").data.estado, "degradada");
  assert.equal(opDe(e.dir, "cartera-libro").data.efectivo, 5000);
  assert.equal(e.S.escribir("final").accion, "listo");
  // día 2: mar 3-nov
  const t2 = Date.parse("2026-11-03T14:47:00Z");
  const et2 = etoroFalso({ portafolio: t.pf, tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 691, ask: 691.2 }]), t2) });
  const d = await prepararDia({ db: e.db, t: t2, etoro: et2 });
  assert.deepEqual(leerTrabajo(d.dir, "preparar.json").recuperacion, { ejecuciones: [F1] });
  assert.deepEqual(leerTrabajo(d.dir, "leer-mas.json").lecturas.map(l => l.id), [`ejecucion-${F1}`, `ops-${F1}`]);
  assert.ok(et2.llamadas.every(x => x.metodo === "GET"));
  await cerrar(["--dir", d.dir], { ahora: () => t2 + 15 * 60000 });
  return { e, d, t };
}

test("A3.2 · posición visible al día siguiente → 1 lote QQQ, efectivo 3 500; la ejecución se cierra y sale de ejecucionesAbiertas", async () => {
  const { d, t } = await dosDias({ visible: true });
  const c = leerTrabajo(d.dir, "cartera.json");
  assert.equal(c.libro.efectivoUSD, 3500);
  assert.deepEqual(c.libro.posiciones.find(p => p.sym === "QQQ").lotes.map(l => l.positionId), [2800000001]);
  assert.equal(c.libro.pendientes.length, 0);
  const ej = opDe(d.dir, `ejecucion-${F1}`);
  assert.equal(ej.ifVersion, 1); assert.ok(ej.data.fin); assert.deepEqual(ej.data.res.map(r => [r.id, r.est]), [[QQQ[0].id, "ejecutada"]]);
  assert.deepEqual(opDe(d.dir, `ops-${F1}`).data.ops.map(o => [o.id, o.est, o.usdej]), [[QQQ[0].id, "ejecutada", 1500]]);
  assert.deepEqual(opDe(d.dir, "rutina-estado").data.ejecucionesAbiertas, []);
  assert.equal(d.S.escribir("final").accion, "listo");
  assert.equal(posts(t).length, 1);
});

test("A3.2 · posición no visible → incierta con efectivo 3 500 provisional y pendiente; nunca 5 000 con la posición fuera del libro", async () => {
  const { d } = await dosDias({ visible: false });
  const c = leerTrabajo(d.dir, "cartera.json");
  assert.equal(c.libro.efectivoUSD, 3500);
  assert.deepEqual(c.libro.pendientes.map(p => [p.opId, p.estado, p.dia, p.montoUSD]), [[QQQ[0].id, "incierta", F1, 1500]]);
  assert.ok(c.alertas.includes(`Pendiente de confirmar: QQQ compra desde ${F1}`));
  assert.deepEqual(opDe(d.dir, `ejecucion-${F1}`).data.res.map(r => r.est), ["incierta"]);
  assert.deepEqual(opDe(d.dir, "rutina-estado").data.ejecucionesAbiertas, []);
  assert.match(opDe(d.dir, "bitacora-2026-11-03").data.alertas.join("\n"), /Pendiente de confirmar: QQQ compra desde 2026-11-02/);
});
