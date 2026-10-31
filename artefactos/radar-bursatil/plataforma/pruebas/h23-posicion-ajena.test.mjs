// H23 · A10.2 portado (12b §F.3.4, §F.5, §F.7): la recuperación de una ejecución abierta no adopta una posición ajena del
// mismo instrumento; la línea queda incierta y al 3.er día hábil no_ejecutada con el efectivo de vuelta
import test from "node:test";
import assert from "node:assert/strict";
import { conciliarEjecucion, conciliar, opsNuevo } from "../lib/libro.mjs";
import { libroLunes, copia } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

const DOC = { kind: "ejecucion", v: 1, f: "2026-11-04", sesion: "s-a", armado: "2026-11-04T15:05:00Z", fin: null, antes: { pos: [], ord: [] },
  lineas: [{ id: "2026-11-04-QQQ-C1", k: 0, lado: "c", i: 3006, pos: null, u: null, usd: 4000, rid: "00000000-0000-4000-8000-000000000001" }], res: [] };

test("A10.2 · la posición del director (690 USD, abierta más tarde) no entra a lotes; incierta → no_ejecutada al 3.er día hábil", () => {
  const libro = libroLunes(); libro.efectivoUSD = 5000;
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  pf.clientPortfolio.positions.push({ positionID: 2899999999, orderID: 555, instrumentID: 3006, units: 1, amount: 690, openRate: 690, openDateTime: "2026-11-04T18:00:00Z", isBuy: true, leverage: 1 });
  // también con la misma hora del armado: el monto distinto la deja fuera
  const pf2 = copia(pf); pf2.clientPortfolio.positions.push({ positionID: 2899999998, orderID: null, instrumentID: 3006, units: 1, amount: 690, openRate: 690, openDateTime: "2026-11-04T15:05:30Z", isBuy: true, leverage: 1 });
  for (const p of [pf, pf2]) {
    const ce = conciliarEjecucion({ libro, doc: DOC, opsDoc: opsNuevo("2026-11-04"), portafolio: p, ahora: Date.parse("2026-11-05T14:50:00Z") });
    assert.deepEqual(ce.doc.res.map(r => r.est), ["incierta"]); assert.ok(ce.doc.fin);
    assert.ok(!ce.libro.posiciones.some(x => x.sym === "QQQ"));
    assert.equal(ce.libro.efectivoUSD, 1000);
    assert.deepEqual(ce.libro.pendientes.map(x => [x.opId, x.estado, x.dia]), [["2026-11-04-QQQ-C1", "incierta", "2026-11-04"]]);
    assert.deepEqual(ce.ops.ops.map(o => [o.id, o.est]), [["2026-11-04-QQQ-C1", "incierta"]]);
    let L = ce.libro;
    for (const [dia, queda] of [["2026-11-06", true], ["2026-11-09", false]]) {
      const c = conciliar({ libro: L, portafolio: p, historial: [], ahora: Date.parse(dia + "T14:50:00Z") });
      L = c.libro;
      assert.equal(L.pendientes.length, queda ? 1 : 0, dia);
      assert.ok(!L.posiciones.some(x => x.sym === "QQQ"), dia);
    }
    assert.equal(L.efectivoUSD, 5000);
  }
});

test("conciliarEjecucion · la compra del plan (fuera de antes, en la ventana del armado, monto ±1 %) sí se adopta; un cierre intacto un día después → no_ejecutada", () => {
  const libro = libroLunes(); libro.efectivoUSD = 5000;
  const doc = Object.assign(copia(DOC), { antes: { pos: [2600000005], ord: [] }, lineas: DOC.lineas.concat([{ id: "2026-11-04-XLE-V1", k: 0, lado: "v", i: 3008, pos: 2600000005, u: null, usd: null, rid: "00000000-0000-4000-8000-000000000002" }]) });
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  pf.clientPortfolio.positions.push({ positionID: 2800000001, orderID: 6001, instrumentID: 3006, units: 5.797101, amount: 4000, openRate: 690, openDateTime: "2026-11-04T15:05:40Z", isBuy: true, leverage: 1 });
  const ce = conciliarEjecucion({ libro, doc, opsDoc: opsNuevo("2026-11-04"), portafolio: pf, ahora: Date.parse("2026-11-05T14:50:00Z") });
  assert.deepEqual(ce.doc.res.map(r => [r.id.slice(11), r.est]), [["QQQ-C1", "ejecutada"], ["XLE-V1", "no_ejecutada"]]);
  assert.equal(ce.libro.efectivoUSD, 1000);
  assert.deepEqual(ce.libro.posiciones.find(x => x.sym === "QQQ").lotes.map(l => [l.positionId, l.orderId]), [[2800000001, 6001]]);
  assert.ok(ce.libro.posiciones.some(x => x.sym === "XLE"));
  assert.deepEqual(ce.ops.ops.map(o => [o.id.slice(11), o.est]), [["QQQ-C1", "ejecutada"], ["XLE-V1", "no_ejecutada"]]);
});
