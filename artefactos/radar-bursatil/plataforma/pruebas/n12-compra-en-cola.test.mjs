// N12 / R3 (00p §2) · x15 y x19 del tester B5: una compra visible en ordersForOpen no se libera nunca (su efectivo sigue
// reservado); desde el 2.º día hábil el aviso pide cancelarla a mano; si eToro la llena tarde, casa por orderID y entra al libro;
// solo cuando ya no está en cola ni hay posición sigue la regla de no_ejecutada
import test from "node:test";
import assert from "node:assert/strict";
import { conciliar } from "../lib/libro.mjs";
import { libroLunes, copia } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

const PEND = { opId: "2026-11-04-QQQ-C1", dia: "2026-11-04", orderId: 7001, sym: "QQQ", instrumentId: 3006, lado: "compra", montoUSD: 1500, unidades: null, positionId: null, enviadaEl: "2026-11-04T15:05:00Z", estado: "aceptada" };
const libro = () => { const L = libroLunes(); L.efectivoUSD = 3500; L.pendientes.push(Object.assign({}, PEND)); return L; };
const enCola = () => { const pf = copia(leerFix("etoro/lunes-ejecutado.json")); pf.clientPortfolio.ordersForOpen = [{ orderID: 7001, instrumentID: 3006, amount: 1500 }]; return pf; };
const dia = (L, pf, d) => conciliar({ libro: L, portafolio: pf, historial: [], ahora: Date.parse(d + "T14:50:00Z") });
const ALERTA = /^Compra de QQQ del 2026-11-04 sigue en cola en eToro \(\d+ días hábiles; US\$ 1500\.00 reservados\): cancela la orden 7001 a mano en eToro/;

test("x15 · en cola del 5 al 20-nov: nunca se libera, efectivo reservado (3 500); alerta desde el 2.º día hábil", () => {
  const a = dia(libro(), enCola(), "2026-11-05");
  assert.deepEqual([a.libro.pendientes.length, a.libro.efectivoUSD], [1, 3500]); assert.ok(!a.alertas.some(x => ALERTA.test(x)));
  for (const d of ["2026-11-06", "2026-11-09", "2026-11-20"]) {
    const c = dia(libro(), enCola(), d);
    assert.deepEqual([c.libro.pendientes.map(p => p.estado), c.libro.efectivoUSD, c.eventos.length], [["aceptada"], 3500, 0], d);
    assert.ok(c.alertas.some(x => ALERTA.test(x)), JSON.stringify(c.alertas));
  }
});

test("x19 · eToro llena la orden 7001 el 10-nov (después de 4 días en cola): casa por orderID y entra al libro", () => {
  let L = libro();
  for (const d of ["2026-11-05", "2026-11-06", "2026-11-09"]) L = dia(L, enCola(), d).libro;
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  pf.clientPortfolio.positions.push({ positionID: 2800007001, orderID: 7001, instrumentID: 3006, units: 2.17, amount: 1500, openRate: 690, openDateTime: "2026-11-10T14:30:01Z", isBuy: true, leverage: 1 });
  const c = dia(L, pf, "2026-11-10");
  assert.deepEqual(c.libro.posiciones.find(p => p.sym === "QQQ").lotes.map(l => [l.positionId, l.orderId]), [[2800007001, 7001]]);
  assert.deepEqual([c.libro.pendientes.length, c.libro.efectivoUSD], [0, 3500]);
  assert.deepEqual(c.eventos.map(e => [e.tipo, e.opId]), [["ejecutada", "2026-11-04-QQQ-C1"]]);
});

test("ya no está en cola ni hay posición: sigue la regla de no_ejecutada (3.er día hábil desde su día)", () => {
  const pf = leerFix("etoro/lunes-ejecutado.json");
  const a = dia(libro(), pf, "2026-11-06");
  assert.deepEqual([a.libro.pendientes.map(p => p.estado), a.libro.efectivoUSD], [["incierta"], 3500]);
  const b = dia(libro(), pf, "2026-11-09");
  assert.deepEqual([b.libro.pendientes.length, b.libro.efectivoUSD], [0, 5000]);
  assert.deepEqual(b.eventos.map(e => e.tipo), ["no_ejecutada"]);
});
