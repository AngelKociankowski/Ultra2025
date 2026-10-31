// B4 · a4-cifras del tester (14): A4.1 cifras del lunes contra un cálculo a mano (A4.2 está en h12)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, OUT30 } from "./escenario.mjs";
import { leerSalida, leerFix } from "./util.mjs";

test("A4.1 · lunes 2-nov: valor, rendimientos USD/MXN/SPY del día y la meta contra cálculo independiente", async () => {
  const d = await prepararDia({});
  await cerrar(["--dir", d.dir], { ahora: () => d.t + 900000 });
  const c = leerSalida(d.dir, "trabajo/cartera.json");
  const pf = leerFix("etoro/lunes-ejecutado.json").clientPortfolio.positions, tasas = leerFix("etoro/lunes-tasas.json").rates;
  const bid = id => tasas.find(r => r.instrumentID === id).bid;
  const propias = pf.filter(p => [391213449, 391187994, 391187995, 391213506, 391187996].includes(p.orderID));
  const v = propias.reduce((a, p) => a + p.units * bid(p.instrumentID), 0) + 0.56;
  const fx = OUT30.rows.find(r => r.symbol === "USDMXN").price;
  const rUSD = v / 31959.09 - 1, rMXN = v * fx / 600000 - 1, rSPY = bid(3000) / 755.26 - 1, g = Math.pow(1.15, 3 / 365.25);
  assert.ok(Math.abs(c.valuacion.valorUSD - v) < 0.011, `${c.valuacion.valorUSD} vs ${v}`);
  assert.ok(Math.abs(c.rendimientos.usd[0] - rUSD) < 1e-6); assert.ok(Math.abs(c.rendimientos.mxn[0] - rMXN) < 1e-6);
  assert.ok(Math.abs(c.rendimientos.spy[4] - rSPY) < 1e-6);
  assert.ok(Math.abs(c.rendimientos.meta[1] - (v / 31959.09 - g) * 100) < 1e-4);
  const aviso = fs.readFileSync(path.join(d.dir, "salida/aviso.txt"), "utf8");
  assert.match(aviso, new RegExp(`Cartera: US\\$ ${Math.round(v).toLocaleString("en-US")} \\(\\+${(rUSD * 100).toFixed(2)} % hoy`));
  const bit = leerSalida(d.dir, "salida/final/db_write.json").ops.find(o => o.path === `${DB_RUTA}/bitacora-2026-11-02`).data;
  assert.equal(bit.cartera.v_, c.valuacion.valorUSD); assert.deepEqual(bit.errores.filter(e => e[0] !== "30-fmp-noticias" && e[0] !== "noticias"), []);
});
