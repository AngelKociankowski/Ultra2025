// N7 · x13 del tester B5 (17): un documento de leer-mas dañado detiene lo que depende de él (RUNBOOK F6): con una ejecución
// abierta dañada no se concilia, no se escribe el libro y no se opera; con un ops-<f> dañado no se opera
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { leerVersiones } from "../lib/db.mjs";
import { semilla } from "../lib/libro.mjs";
import { prepararDia, tasasA, OUT30, copia } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, sinEspera, planDe } from "./ejecucion.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const F1 = "2026-11-02", QQQ = [Object.assign({}, planDe(F1)[2], { orden: 1 })];
const outXle = () => { const o = copia(OUT30); Object.assign(o.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 }); return o; };

async function diaUnoAbierto() {
  const e = await diaReal({ plan: QQQ });
  const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base, retrasoVisible: 100000 });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  e.S.escribir("pre-ejecucion");
  let cortar = false;
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: async q => { const r = await t(q); if (q.metodo === "POST") cortar = true; return r; }, ahora: () => { if (cortar) throw new Error("cortado"); return base(); }, dormir: sinEspera }));
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--reanudar"], { transporteEToro: t, ahora: () => { throw new Error("cortado"); }, dormir: sinEspera }));
  await cerrar(["--dir", e.dir, "--degradado", "ejecutar"], { ahora: () => e.t + 15 * 60000 });
  assert.equal(e.S.escribir("final").accion, "listo");
  assert.deepEqual(e.db.doc("rutina-estado").ejecucionesAbiertas, [F1]);
  return { e, t };
}

test("x13 · ejecucion-<ayer> llega dañada: sin conciliación ni libro escrito, 40-decidir no ejecuta, la fecha sigue abierta", async () => {
  const { e, t } = await diaUnoAbierto();
  const t2 = Date.parse("2026-11-03T14:47:00Z");
  const pf = copia(t.pf); pf.clientPortfolio.positions.push({ positionID: 2800000001, orderID: 6001, instrumentID: 3006, units: 2.173913, amount: 1500, openRate: 690, openDateTime: new Date(e.t + 11 * 60000 + 3000).toISOString(), isBuy: true, leverage: 1 });
  const corromper = L => (L.id === `ejecucion-${F1}` && L.data ? Object.assign({}, L, { data: JSON.parse(JSON.stringify(L.data).replace('"usd":1500', '"usd":1501')) }) : L);
  const d = await prepararDia({ db: e.db, t: t2, corromper, out: outXle(), etoro: etoroFalso({ portafolio: pf, tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 691, ask: 691.2 }]), t2) }) });
  assert.equal(leerVersiones(d.dir)[`ejecucion-${F1}`].estado, "corrupto");
  const c = leerTrabajo(d.dir, "cartera.json");
  assert.deepEqual([d.cartera.codigo, c.estado], [3, "sin_libro"]);
  assert.ok(c.alertas.includes(`ejecucion-${F1} llegó dañado o no se pudo leer de db: hoy no se opera.`));
  assert.notEqual(d.decidir.linea.accion, "ejecutar");
  await cerrar(["--dir", d.dir], { ahora: () => t2 + 15 * 60000 });
  const fin = leerSalida(d.dir, "salida/final/db_write.json").ops;
  assert.ok(!fin.some(o => o.path.endsWith("/cartera-libro")), "el libro de ayer queda como está");
  const est = fin.find(o => o.path.endsWith("/rutina-estado")).data;
  assert.deepEqual([est.estado, est.ejecucionesAbiertas], ["degradada", [F1]]);
});

test("x13 · ops-<f> de un pendiente llega dañado: el día valúa pero no opera (bloqueado)", async () => {
  const corromper = L => (L.id === "ops-2026-10-30" && L.data ? Object.assign({}, L, { data: JSON.parse(JSON.stringify(L.data).replace('"usd":500', '"usd":501')) }) : L);
  const s = semilla();
  const d = await prepararDia({ corromper, out: outXle(), dbExtra: { "rutina-config": Object.assign(s["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) } });
  assert.equal(leerVersiones(d.dir)["ops-2026-10-30"].estado, "corrupto");
  const c = leerTrabajo(d.dir, "cartera.json"), dec = leerTrabajo(d.dir, "decisiones.json");
  assert.equal(c.estado, "listo"); assert.ok(c.bloqueos.ordenes);
  assert.equal(dec.modo, "bloqueado"); assert.equal(d.decidir.linea.accion, "nada");
});
