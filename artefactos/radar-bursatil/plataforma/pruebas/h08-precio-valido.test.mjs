// H08 · A2.2 portado (12b §I): bid = 0 o viejo en una posición del mandato → se valúa con precios[sym] (o costo) y no recibe
// ninguna orden; "en cartera" se define por unidades, nunca por valor
import test from "node:test";
import assert from "node:assert/strict";
import { decidir, configEfectiva } from "../lib/reglas.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { PAG, OUT30, carteraEn, copia } from "./escenario.mjs";

const C = PAG.C, F = "2026-11-04", T = Date.parse("2026-11-04T15:00:00Z");
const cfg = configEfectiva(Object.assign(copia(CONFIG_DEFECTO), { operar: true, activadoEl: "2026-11-03T12:00:00Z" })).config;
const ctx = { fecha: F, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: T };
const XLF = 3004;
const conBid = f => t => t.map(r => (r.instrumentID === XLF ? f(Object.assign({}, r)) : r));

for (const [nombre, mod] of [["bid = 0", r => Object.assign(r, { bid: 0 })], ["bid de hace 25 min", r => Object.assign(r, { date: new Date(T - 25 * 60000).toISOString() })],
  ["bid NaN", r => Object.assign(r, { bid: Number.NaN })], ["sin fila de XLF", null]]) {
  test(`A2.2 (${nombre}): XLF valuado con precios.XLF, alerta y ninguna decisión C1/R1/V1 activa sobre XLF`, () => {
    const base = carteraEn(T);
    // precio válido del día hábil anterior guardado en el libro
    const { cartera, valuacion, libro } = carteraEn(T, { libroMod: L => { L.precios = { XLF: [56.4, "2026-11-03"] }; }, tasasMod: mod ? conBid(mod) : t => t.filter(r => r.instrumentID !== XLF) });
    const x = valuacion.posiciones.find(p => p.sym === "XLF"), x0 = base.valuacion.posiciones.find(p => p.sym === "XLF");
    assert.equal(x.precioValido, false);
    assert.equal(x.precioUSD, 56.4); assert.deepEqual(valuacion.precios.XLF, [56.4, "2026-11-03"], "el último válido no se pisa");
    assert.ok(valuacion.alertas.includes("Precio inválido de eToro para XLF; se valúa con el de 2026-11-03"), JSON.stringify(valuacion.alertas));
    assert.deepEqual(libro.precios, { XLF: [56.4, "2026-11-03"] });
    assert.ok(x.valorUSD > 0); assert.ok(Math.abs(valuacion.valorUSD - base.valuacion.valorUSD) < x0.valorUSD * 0.1, "el valor total no pierde la posición");
    for (const objetivo of [undefined, { pesos: { SPY: 0.5, DIA: 0.2, XLE: 0.05, XLF: 0.2 }, roles: {} }]) {
      const out = copia(OUT30);
      const r = decidir({ C, analisis: { fuente: "rutina", parcial: false, out }, cartera, config: cfg, contexto: ctx, objetivo });
      const d = r.decisiones.find(z => z.sym === "XLF");
      assert.ok(!r.ordenes.some(o => o.sym === "XLF"), JSON.stringify(r.ordenes.map(o => o.sym)));
      if (d) { assert.notEqual(d.regla, "C1"); assert.ok(!["comprar", "vender"].includes(d.accion), `${d.accion} ${d.regla}`); }
    }
    // con la señal en Evitar, V1 queda omitida por precio (no vende a ciegas)
    const out = copia(OUT30); Object.assign(out.rows.find(r => r.symbol === "XLF"), { signal: 1, signalLabel: "Evitar", pct: 40 });
    const v = decidir({ C, analisis: { fuente: "rutina", parcial: false, out }, cartera, config: cfg, contexto: ctx }).decisiones.find(z => z.sym === "XLF");
    assert.deepEqual([v.accion, v.regla, v.razonOmision], ["omitida", "V1", "Sin precio válido de eToro hoy"]);
  });
}

test("sin precio de hoy ni precios[sym] en el libro → a costo con la misma alerta", () => {
  const { valuacion, libro } = carteraEn(T, { tasasMod: conBid(r => Object.assign(r, { bid: 0 })) });
  const x = valuacion.posiciones.find(p => p.sym === "XLF");
  assert.equal(x.valorUSD, x.costoUSD); assert.equal(libro.precios.XLF, undefined);
  assert.ok(valuacion.alertas.includes("Precio inválido de eToro para XLF; se valúa a costo"));
});
