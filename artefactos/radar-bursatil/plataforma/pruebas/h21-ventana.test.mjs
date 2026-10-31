// H21 · a9-conciliar portado (12b §F.3.2, §F.3.4): pend.env = hora del envío del diario y ventana [env − 120 s, env + 10 min]
import test from "node:test";
import assert from "node:assert/strict";
import { conciliar, aplicarResultados, opsNuevo } from "../lib/libro.mjs";
import { libroLunes, copia } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

const PLAN = [{ id: "2026-11-04-QQQ-C1", sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 1500, cierres: null, motivo: "x", noticias: [] }];
const libroCon = (r) => {
  const libro = libroLunes(); libro.efectivoUSD = 5000;
  return aplicarResultados({ libro, opsHoy: opsNuevo("2026-11-04"), plan: PLAN, res: [Object.assign({ id: PLAN[0].id, k: 0, est: "aceptada", env: "2026-11-04T15:05:00Z", http: 200, o: 7001, pos: [], usd: 1500 }, r)], simulacion: false, ahora: Date.parse("2026-11-04T15:20:00Z") }).libro;
};
const pfCon = (pos, sinOrderId) => {
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  pf.clientPortfolio.positions.push(pos);
  if (sinOrderId) for (const p of pf.clientPortfolio.positions) delete p.orderID;
  return pf;
};
const MANANA = Date.parse("2026-11-05T14:50:00Z");

for (const conOrderId of [true, false]) {
  test(`A9.1 · enviada 10:05 ET (diario), cerrada 10:20, la posición abrió 10:06:30 · ${conOrderId ? "con" : "sin"} orderID → 1 lote al día siguiente`, () => {
    const libro = libroCon();
    assert.equal(libro.pendientes[0].enviadaEl, "2026-11-04T15:05:00Z");
    const pos = { positionID: 2800000777, instrumentID: 3006, units: 2.173913, amount: 1500, openRate: 690, openDateTime: "2026-11-04T15:06:30Z", isBuy: true, leverage: 1, orderID: 7001 };
    const c = conciliar({ libro, portafolio: pfCon(pos, !conOrderId), historial: [], ahora: MANANA, ordenes: { 7001: { orderID: 7001, statusID: 3, errorCode: 0 } } });
    assert.deepEqual(c.libro.posiciones.find(p => p.sym === "QQQ").lotes.map(l => l.positionId), [2800000777]);
    assert.equal(c.libro.pendientes.length, 0); assert.equal(c.libro.efectivoUSD, 3500);
  });
}

test("fuera de la ventana (env + 11 min, sin orderID) o con otro monto → no se adopta", () => {
  for (const pos of [{ openDateTime: "2026-11-04T15:16:01Z", amount: 1500 }, { openDateTime: "2026-11-04T15:06:30Z", amount: 690 }, { openDateTime: "2026-11-04T15:02:59Z", amount: 1500 }]) {
    const c = conciliar({ libro: libroCon({ o: null, est: "incierta" }), portafolio: pfCon(Object.assign({ positionID: 2800000778, instrumentID: 3006, units: 2, openRate: 690, isBuy: true, leverage: 1 }, pos), true), historial: [], ahora: MANANA });
    assert.ok(!c.libro.posiciones.some(p => p.sym === "QQQ"), JSON.stringify(pos)); assert.equal(c.libro.pendientes.length, 1);
  }
});

test("una orden enviada con el mercado cerrado se llena en la apertura siguiente: la ventana llega a apertura + 10 min", () => {
  const c = conciliar({ libro: libroCon({ env: "2026-11-04T22:00:00Z", o: null }), portafolio: pfCon({ positionID: 2800000779, instrumentID: 3006, units: 2.17, amount: 1500, openRate: 690, openDateTime: "2026-11-05T14:30:02Z", isBuy: true, leverage: 1 }, true),
    historial: [], ahora: Date.parse("2026-11-05T16:00:00Z") });
  assert.deepEqual(c.libro.posiciones.find(p => p.sym === "QQQ").lotes.map(l => l.positionId), [2800000779]);
});
