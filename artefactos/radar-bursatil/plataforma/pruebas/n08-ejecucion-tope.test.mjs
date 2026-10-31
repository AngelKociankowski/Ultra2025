// N8 · x08 del tester B5 (17): tamaño de ejecucion-<f> en un día con maxOrdenesDia = 12 (6 ventas de 2 lotes + 6 compras =
// 18 líneas). Con la forma de §E.5.10 el cierre no cabe en los 3 000 B de §E.5: DESVÍO N8 del reporte 16 (decide el director).
import test from "node:test";
import assert from "node:assert/strict";
import { bytes, conH } from "../lib/db.mjs";
import { requestIdDe } from "../lib/reglas.mjs";
import { lineasDe } from "../bin/50-ejecutar.mjs";
import { DOC_TOPES } from "../lib/constantes.mjs";

const F = "2026-11-04", SYMS = ["SPY", "DIA", "XLF", "XLE", "QQQ", "IWM", "XLK", "EFA", "VWO", "TLT", "GLD", "SLV"];
const plan = { ordenes: SYMS.map((s, i) => (i < 6
  ? { id: `${F}-${s}-R1`, sym: s, instrumentId: 3000 + i, lado: "venta", cierres: [{ positionId: 2600000000 + i, unidades: 1.234567 }, { positionId: 2600000100 + i, unidades: null }], requestIds: [0, 1].map(k => requestIdDe(F, `${F}-${s}-R1`, k)) }
  : { id: `${F}-${s}-C1`, sym: s, instrumentId: 3000 + i, lado: "compra", montoUSD: 1234.56, cierres: null, requestIds: [requestIdDe(F, `${F}-${s}-C1`, 0)] })) };
const lineas = lineasDe(plan);
const doc = { kind: "ejecucion", v: 1, f: F, sesion: "s-1a2b3c4d", armado: "2026-11-04T15:04:40Z", fin: null, antes: { pos: Array.from({ length: 14 }, (_, i) => 2600000000 + i), ord: [] }, lineas, res: [] };
const res = lineas.map(l => ({ id: l.id, k: l.k, est: "ejecutada", env: "2026-11-04T15:05:02Z", http: 200, o: 391300001, pos: [3456789012], px: 690.12, uej: 6.347123, usdej: 4380.12, usd: l.lado === "c" ? 1234.56 : null, err: null }));

test("x08 · el reclamo (armado) de 18 líneas cabe en el tope de ejecucion", () => {
  assert.equal(lineas.length, 18);
  assert.ok(bytes(conH(doc)) <= DOC_TOPES.ejecucion, `${bytes(conH(doc))} B`);
});

test("x08 · el cierre de 18 líneas cabe en el tope de ejecucion", { todo: "DESVÍO N8: con la forma de §E.5.10 el cierre de 18 líneas mide ≈ 6 200 B (tope 3 000)" }, t => {
  const n = bytes(conH(Object.assign({}, doc, { res, fin: "2026-11-04T15:20:00Z" })));
  t.diagnostic(`cierre con 18 líneas: ${n} B`);
  assert.ok(n <= DOC_TOPES.ejecucion, `${n} B`);
});
