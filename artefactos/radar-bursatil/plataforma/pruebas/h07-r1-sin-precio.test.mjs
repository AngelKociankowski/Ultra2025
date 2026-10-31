// H07 · A2.1 portado (12b §I): R1 a la baja sin bid válido → omitida "sin precio", nunca cierre total
import test from "node:test";
import assert from "node:assert/strict";
import { decidir, configEfectiva } from "../lib/reglas.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { PAG, OUT30, carteraEn, copia } from "./escenario.mjs";

const C = PAG.C, F = "2026-11-04", T = Date.parse("2026-11-04T15:00:00Z");
const cfg = configEfectiva(Object.assign(copia(CONFIG_DEFECTO), { operar: true, activadoEl: "2026-11-03T12:00:00Z" })).config;
const ctx = { fecha: F, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: T };
const analisis = { fuente: "rutina", parcial: false, out: OUT30 };
const pesosCon = (val, sym, delta) => {
  const w = s => val.posiciones.find(p => p.sym === s).valorUSD / val.valorUSD;
  const p = { SPY: w("SPY"), DIA: w("DIA"), XLF: w("XLF"), XLE: w("XLE") };
  p[sym] += delta;
  return p;
};

test("A2.1: SPY sin bid de eToro y objetivo 8 pts abajo → omitida sin precio, 0 órdenes, alerta", () => {
  const { cartera, valuacion } = carteraEn(T, { tasasMod: t => t.filter(r => r.instrumentID !== 3000) });
  const spy = valuacion.posiciones.find(p => p.sym === "SPY");
  assert.equal(spy.precioValido, false);
  assert.ok(valuacion.alertas.some(a => a.startsWith("Precio inválido de eToro para SPY; se valúa")));
  const r = decidir({ C, analisis, cartera, config: cfg, contexto: ctx, objetivo: { pesos: pesosCon(valuacion, "SPY", -0.08), roles: {} } });
  const d = r.decisiones.find(x => x.sym === "SPY");
  assert.equal(d.accion, "omitida"); assert.equal(d.regla, "R1"); assert.match(d.razonOmision, /sin precio/i);
  assert.equal(r.ordenes.length, 0);
  assert.ok(r.alertas.some(a => /SPY: sin precio válido/.test(a)));
});

test("R1 a la baja con bid válido: < 99 % de las unidades → venta parcial; ≥ 99 % → cierre total", () => {
  const { cartera, valuacion } = carteraEn(T);
  const spy = valuacion.posiciones.find(p => p.sym === "SPY"), a = spy.valorUSD / valuacion.valorUSD;
  const parcial = decidir({ C, analisis, cartera, config: cfg, contexto: ctx, objetivo: { pesos: pesosCon(valuacion, "SPY", -0.08), roles: {} } });
  const o = parcial.ordenes.find(x => x.sym === "SPY");
  assert.equal(o.regla, "R1"); assert.ok(o.cierres.some(c => c.unidades !== null), JSON.stringify(o.cierres));
  const casiTodo = decidir({ C, analisis, cartera, config: cfg, contexto: ctx, objetivo: { pesos: pesosCon(valuacion, "SPY", -a * 0.995), roles: {} } });
  const t = casiTodo.ordenes.find(x => x.sym === "SPY");
  assert.equal(t.regla, "R1"); assert.ok(t.cierres.every(c => c.unidades === null), JSON.stringify(t.cierres));
  assert.equal(t.cierres.length, spy.lotes);
});
