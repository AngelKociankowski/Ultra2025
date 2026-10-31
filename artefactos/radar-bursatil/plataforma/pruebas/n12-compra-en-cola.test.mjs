// N12 · x15 del tester B5 (17), 12b §F.7: una compra en ordersForOpen se respeta hasta el día hábil siguiente; luego hay alerta
// diaria y al 3.er día hábil se libera (no_ejecutada, vuelve el efectivo) con aviso de cancelarla a mano
import test from "node:test";
import assert from "node:assert/strict";
import { conciliar } from "../lib/libro.mjs";
import { libroLunes, copia } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

test("x15 · QQQ aceptada en cola desde el 4-nov: 5-nov respetada sin alerta; 6-nov alerta; 9-nov no_ejecutada y efectivo 5 000", () => {
  const L = libroLunes(); L.efectivoUSD = 3500;
  L.pendientes.push({ opId: "2026-11-04-QQQ-C1", dia: "2026-11-04", orderId: 7001, sym: "QQQ", instrumentId: 3006, lado: "compra", montoUSD: 1500, unidades: null, positionId: null, enviadaEl: "2026-11-04T15:05:00Z", estado: "aceptada" });
  const pf = copia(leerFix("etoro/lunes-ejecutado.json")); pf.clientPortfolio.ordersForOpen = [{ orderID: 7001, instrumentID: 3006, amount: 1500 }];
  const dia = d => conciliar({ libro: L, portafolio: pf, historial: [], ahora: Date.parse(d + "T14:50:00Z") });
  const a = dia("2026-11-05");
  assert.deepEqual([a.libro.pendientes.length, a.libro.efectivoUSD], [1, 3500]); assert.ok(!a.alertas.some(x => /sigue en cola/.test(x)));
  const b = dia("2026-11-06");
  assert.equal(b.libro.pendientes.length, 1); assert.ok(b.alertas.includes("Compra de QQQ del 2026-11-04 sigue en cola en eToro (2 días hábiles)."));
  for (const d of ["2026-11-09", "2026-11-20"]) {
    const c = dia(d);
    assert.deepEqual([c.libro.pendientes.length, c.libro.efectivoUSD], [0, 5000], d);
    assert.deepEqual(c.eventos.map(e => [e.tipo, e.opId]), [["no_ejecutada", "2026-11-04-QQQ-C1"]]);
    assert.ok(c.alertas.some(x => /sigue en cola tras \d+ días hábiles: se da por no ejecutada .* cancela la orden 7001 a mano en eToro/.test(x)), JSON.stringify(c.alertas));
  }
});
