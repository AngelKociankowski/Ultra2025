// B4 · a2-reglas del tester (14): A2.0 y A2.4/A2.4b con las reglas de 12b (A2.1, A2.2, A2.3 y A2.5 están en h07, h08, h09, h10)
import test from "node:test";
import assert from "node:assert/strict";
import { decidir, configEfectiva } from "../lib/reglas.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { PAG, OUT30, carteraEn, copia } from "./escenario.mjs";

const T = Date.parse("2026-11-04T15:00:00Z");
const cfg = (x = {}) => configEfectiva(Object.assign(copia(CONFIG_DEFECTO), { operar: true, activadoEl: "2026-11-03T12:00:00Z" }, x)).config;
const ctx = { fecha: "2026-11-04", mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: T };
const analisis = { fuente: "rutina", parcial: false, out: OUT30 };
const invariante = (r, efectivo) => {
  const sumC = r.ordenes.filter(o => o.lado === "compra").reduce((a, o) => a + o.montoUSD, 0);
  const sumV = r.ordenes.filter(o => o.lado === "venta").reduce((a, o) => a + r.decisiones.find(d => d.sym === o.sym).montoUSD, 0);
  assert.ok(sumC <= efectivo + sumV + 0.01, `compras ${sumC} > efectivo ${efectivo} + ventas del plan ${sumV}`);
};

test("A2.0 · línea base: cartera del lunes con el objetivo de buildPortfolio → 0 órdenes (todo dentro de la banda)", () => {
  const { cartera } = carteraEn(T);
  const r = decidir({ C: PAG.C, analisis, cartera, config: cfg(), contexto: ctx });
  assert.equal(r.modo, "normal"); assert.equal(r.ordenes.length, 0);
});

test("A2.4 · el tope de órdenes deja fuera una venta R1 que financiaba una compra → la compra se vuelve a escalar", () => {
  const { cartera, valuacion } = carteraEn(T, { libroMod: L => { L.efectivoUSD = 0; } });
  const w = s => valuacion.posiciones.find(p => p.sym === s).valorUSD / valuacion.valorUSD;
  // dos ventas R1 de ≈ 960 y una compra R1 de ≈ 1 900; con tope 2 la compra va primero y una venta queda fuera
  const pesos = { SPY: w("SPY") - 0.03, DIA: w("DIA") - 0.03, XLF: w("XLF") + 0.059, XLE: w("XLE") };
  const r = decidir({ C: PAG.C, analisis, cartera, config: cfg({ maxOrdenesDia: 2, bandaPts: 2 }), contexto: ctx, objetivo: { pesos, roles: {} } });
  assert.equal(r.ordenes.length, 2);
  assert.ok(r.decisiones.some(d => d.razonOmision === "Tope de 2 órdenes por día"));
  invariante(r, 0);
  assert.ok(r.alertas.some(a => /^Compras escaladas de nuevo/.test(a)), JSON.stringify(r.alertas));
});

test("A2.4b · tope 2 con una venta grande y dos compras: sin ventas en el plan las compras no pasan del efectivo", () => {
  const { cartera, valuacion } = carteraEn(T, { libroMod: L => { L.efectivoUSD = 0; } });
  const w = s => valuacion.posiciones.find(p => p.sym === s).valorUSD / valuacion.valorUSD;
  for (const tope of [1, 2]) {
    const r = decidir({ C: PAG.C, analisis, cartera, config: cfg({ maxOrdenesDia: tope }), contexto: ctx, objetivo: { pesos: { SPY: w("SPY") - 0.10, DIA: w("DIA") + 0.12, XLF: w("XLF") + 0.12, XLE: w("XLE") }, roles: {} } });
    invariante(r, 0);
    assert.equal(r.ordenes[0].lado, "venta", `tope ${tope}`);
  }
});
