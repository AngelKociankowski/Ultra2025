// B4 · a9-conciliar del tester (14): A9.2 trampa DIA y sufijos con la búsqueda real (A9.1 está en h21)
import test from "node:test";
import assert from "node:assert/strict";
import { verificarSimbolo } from "../bin/20-cartera.mjs";
import { crearEToro } from "../lib/etoro.mjs";
import { etoroFalso } from "./etoro-falso.mjs";

test("A9.2 · DIA con el mercado cerrado y abierto → DIA.US (3026), la cripto 'DIA' fuera; SPY y QQQ; precio absurdo → sin asignación", async () => {
  const et = crearEToro({ transporte: etoroFalso({ tasas: [{ instrumentID: 3026, bid: 517.1, ask: 517.3 }, { instrumentID: 100580, bid: 0.13, ask: 0.14 }, { instrumentID: 3000, bid: 755.7, ask: 755.8 }, { instrumentID: 3417, bid: 755.7, ask: 755.8 }] }) });
  const v = (sym, precioRadar, mercadoAbierto) => verificarSimbolo({ et, sym, precioRadar, mercadoAbierto, tolPct: 2, hoy: "2026-11-04" });
  for (const abierto of [false, true]) {
    const d = await v("DIA", 517.13, abierto);
    assert.equal(d.ok, true); assert.equal(d.asignacion.instrumentId, 3026);
    assert.deepEqual(d.rechazados, [{ instrumentId: 100580, motivo: "clase 10 (cripto)" }]);
  }
  assert.equal((await v("SPY", 755.77, true)).asignacion.instrumentId, 3000);
  assert.equal((await v("QQQ", 690.49, false)).asignacion.instrumentId, 3006);
  const x = await v("DIA", 0.1332, false);
  assert.equal(x.ok, false); assert.ok(x.rechazados.some(r => r.instrumentId === 3026 && /^diferencia de precio/.test(r.motivo)));
});
