// H12 · A4.2 portado de punta a punta (12b §H): plan real con una compra sin efectivo → 0 POST, "Operaciones: ninguna" y
// "No se ejecutaron: QQQ (sin efectivo)"; nada que no llegó a eToro dice "compré"
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, resDe, planDe } from "./ejecucion.mjs";
import { escribirTrabajo, escribirJson } from "../lib/archivos.mjs";
import { armarAviso } from "../lib/aviso.mjs";
import { prepararDia } from "./escenario.mjs";
import { aviso, docDe, NOTAS, outXleEvitar, operarDb, T_CIERRE, cts } from "./cierre.mjs";

test("A4.2 · compra cancelada en 50-ejecutar por falta de efectivo: el aviso no dice 'compré'", async () => {
  const QQQ = [Object.assign({}, planDe("2026-11-02")[2], { orden: 1 })];
  const e = await diaReal({ plan: QQQ, efectivo: 0 });
  const ahora = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: ahora });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
  const r = await ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.equal(r.codigo, 0); assert.equal(posts(t).length, 0);
  assert.deepEqual(resDe(e.dir).map(x => [x.est, x.err]), [["no_enviada", "sin efectivo"]]);
  await cerrar(["--dir", e.dir], { ahora: () => e.t + 15 * 60000 });
  const aviso = fs.readFileSync(path.join(e.dir, "salida/aviso.txt"), "utf8");
  assert.match(aviso, /\nOperaciones: ninguna\nNo se ejecutaron: QQQ \(sin efectivo\)/);
  assert.ok(!/compré|vendí/.test(aviso));
});

// desde 60-cerrar con ejecucion.json dado (antes en t15)
test("aviso H12: simulación; real ejecutada; A4.2 compra sin efectivo → ninguna + No se ejecutaron; aceptada e incierta sin 'compré'", async () => {
  const sim = await prepararDia({ out: outXleEvitar(), notas: NOTAS });
  await cerrar(["--dir", sim.dir], { ahora: () => T_CIERRE(sim) });
  assert.equal(aviso(sim.dir), [
    "Radar · lun 2-nov · 10:05 ET · SIMULACIÓN",
    "Cartera: US$ 32,010 (+0.16 % hoy · +0.16 % desde inicio) · MXN $ 600,956 (+0.16 %)",
    "vs SPY desde inicio: −0.23 % · meta 15 % anual: +0.04 pts",
    "Radar: régimen Favorable",
    "Noticias: Fed holds rates steady as inflation cools (CNBC)",
    "Operaciones: 1 simulada — vender XLE (V1)",
  ].join("\n"));
  const real = async res => {
    const d = await prepararDia({ out: outXleEvitar(), notas: NOTAS, dbExtra: operarDb() });
    assert.equal(d.decidir.linea.accion, "ejecutar");
    if (res.plan) escribirJson(path.join(d.dir, "trabajo/plan-ordenes.json"), { fecha: "2026-11-02", simulacion: false, ordenes: res.plan });
    escribirTrabajo(d.dir, "ejecucion.json", { doc: null, res: res.res });
    assert.equal((await cerrar(["--dir", d.dir], { ahora: () => T_CIERRE(d) })).codigo, 0);
    return d;
  };
  const xle = await real({ res: [{ id: "2026-11-02-XLE-V1", k: 0, est: "ejecutada", env: "2026-11-02T15:01:00Z", http: 200, o: 391400001, pos: [2600000005], px: 70.1, uej: 27.059025, usdej: 1896.84 }] });
  assert.match(aviso(xle.dir), /\nOperaciones: 1 — vendí XLE \(V1\)$/);
  assert.ok(!/SIMULACIÓN/.test(aviso(xle.dir)));
  const lx = docDe(xle.dir, "cartera-libro");
  assert.equal(lx.efectivo, 1897.4); assert.equal(lx.realizado, 8.12); assert.equal(lx.lotes.length, 4);
  assert.deepEqual(docDe(xle.dir, "ops-2026-11-02").ops.map(o => [o.id, o.est, o.sim, o.usdej]), [["2026-11-02-XLE-V1", "ejecutada", false, 1896.84]]);
  const QQQ = { id: "2026-11-02-QQQ-C1", orden: 1, sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 1500, cierres: null, motivo: "Entra al objetivo", noticias: [], requestIds: ["x"] };
  const sinEf = await real({ plan: [QQQ], res: [{ id: QQQ.id, k: 0, est: "no_enviada", env: null, http: null, err: "sin efectivo" }] });
  assert.match(aviso(sinEf.dir), /\nOperaciones: ninguna\nNo se ejecutaron: QQQ \(sin efectivo\)/);
  assert.equal(docDe(sinEf.dir, "cartera-libro").efectivo, 0.56);
  const acep = await real({ plan: [QQQ], res: [{ id: QQQ.id, k: 0, est: "aceptada", env: "2026-11-02T15:01:00Z", http: 200, o: 6001 }] });
  assert.match(aviso(acep.dir), /\nOperaciones: 1 — compra QQQ enviada, sin ejecutar aún/);
  const inc = await real({ plan: [QQQ], res: [{ id: QQQ.id, k: 0, est: "incierta", env: "2026-11-02T15:01:00Z", http: null }] });
  assert.match(aviso(inc.dir), /\nOperaciones: 1 — compra QQQ sin confirmar/);
  const li = docDe(inc.dir, "cartera-libro");
  assert.equal(li.efectivo, cts(0.56 - 1500)); assert.deepEqual(li.pend.map(p => [p.id, p.est, p.env, p.usd]), [[QQQ.id, "incierta", "2026-11-02T15:01:00Z", 1500]]);
  for (const d of [sinEf, acep, inc]) assert.ok(!/compré|vendí/.test(aviso(d.dir)), aviso(d.dir));
  // tope de 700 con muchas alertas y notas largas
  const largo = armarAviso({ fecha: "2026-11-02", hora: "09:58", simulacion: false, cartera: null, rend: null, radar: { regimen: "Favorable", cambios: [] },
    notas: [{ titulo: "x".repeat(300), medio: "CNBC" }, { titulo: "y".repeat(300), medio: "Bloomberg" }], operaciones: [], alertas: Array.from({ length: 30 }, (_, i) => "alerta larga ".repeat(5) + i), fallas: [] });
  assert.ok(largo.length <= 700); assert.match(largo, /^Radar · lun 2-nov · 9:58 ET/);
});
