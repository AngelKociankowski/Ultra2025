// H10 · A2.5 portado (12b §I): la desviación se redondea a 0.01 pt antes de comparar con la banda; igual para nuevoSatelitePct
import test from "node:test";
import assert from "node:assert/strict";
import { decidir, configEfectiva } from "../lib/reglas.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { PAG, OUT30, carteraEn, copia } from "./escenario.mjs";

const C = PAG.C, F = "2026-11-04", T = Date.parse("2026-11-04T15:00:00Z");
const cfg = configEfectiva(Object.assign(copia(CONFIG_DEFECTO), { operar: true, activadoEl: "2026-11-03T12:00:00Z" })).config;
const ctx = { fecha: F, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: T };
const analisis = { fuente: "rutina", parcial: false, out: OUT30 };

test("A2.5: 5.00 y 5.0000001 pts → mantener; 5.01 → R1 con la cifra redondeada en el motivo", () => {
  const { cartera, valuacion } = carteraEn(T);
  const w = s => valuacion.posiciones.find(p => p.sym === s).valorUSD / valuacion.valorUSD;
  const r = d => {
    const pesos = { SPY: w("SPY") - d, DIA: w("DIA"), XLF: w("XLF"), XLE: w("XLE") };
    return decidir({ C, analisis, cartera, config: cfg, contexto: ctx, objetivo: { pesos, roles: {} } }).decisiones.find(z => z.sym === "SPY");
  };
  for (const d of [0.05, 0.050000001, 0.0499999]) { const x = r(d); assert.equal(x.accion, "mantener", String(d)); assert.equal(x.regla, null); }
  const x = r(0.0501);
  assert.deepEqual([x.accion, x.regla, x.desvPts], ["vender", "R1", 5.01]);
  assert.match(x.motivo, /^Desviación de \+5\.01 pts contra el objetivo \(/);
  assert.equal(r(0.05).motivo, "Dentro de la banda (desviación +5.00 pts)");
});

test("nuevoSatelitePct: 2.995 % → 3.00 (C1); 2.994 % → 2.99 (no abre)", () => {
  const { cartera, valuacion } = carteraEn(T);
  const w = s => valuacion.posiciones.find(p => p.sym === s).valorUSD / valuacion.valorUSD;
  const r = q => decidir({ C, analisis, cartera, config: cfg, contexto: ctx, objetivo: { pesos: { SPY: w("SPY"), DIA: w("DIA"), XLF: w("XLF"), XLE: w("XLE"), IWM: q }, roles: {} } }).decisiones.find(z => z.sym === "IWM");
  assert.equal(r(0.02995).regla, "C1");
  const n = r(0.02994); assert.equal(n.regla, null); assert.match(n.motivo, /menor al mínimo de 3 %/);
});
