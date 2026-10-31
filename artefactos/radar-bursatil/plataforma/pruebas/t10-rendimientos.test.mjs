// T10 · Rendimientos y composición (cifras esperadas calculadas a mano como cocientes directos)
import test from "node:test";
import assert from "node:assert/strict";
import { rendimientos, meta15, composicion, AVISO_ANUALIZADO } from "../lib/rendimientos.mjs";
import { semilla, conciliar, valuar } from "../lib/libro.mjs";
import { leerFix } from "./util.mjs";

const cerca = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const serie = (base, puntos) => ({ kind: "carteraSerie", v: 1, anio: 2026, base, puntos });
const B = { fecha: "2026-11-27", valorUSD: 1000, valorMXN: 20000, fx: 20, spy: 500 };

test("base + 3 puntos: día, semana (cruza lunes), mes (cruza 1-dic), año, inicio", () => {
  // vie 27-nov base; lun 30-nov; mar 1-dic; mié 2-dic
  const s = serie(B, [{ f: "2026-11-30", h: "09:50", v: 1010, e: 0, fx: 20.2, spy: 505, fl: 0 }, { f: "2026-12-01", h: "09:50", v: 1030, e: 0, fx: 20.1, spy: 503, fl: 0 },
    { f: "2026-12-02", h: "09:50", v: 1015, e: 0, fx: 19.9, spy: 508, fl: 0 }]);
  const r = rendimientos({ serie: s });
  cerca(r.usd.dia, 1015 / 1030 - 1);
  cerca(r.usd.semana, 1015 / 1000 - 1); // lunes 30-nov → último punto antes: la base
  cerca(r.usd.mes, 1015 / 1010 - 1); // 1-dic → último punto antes: 30-nov
  cerca(r.usd.anio, 1015 / 1000 - 1);
  cerca(r.usd.inicio, 1015 / 1000 - 1);
  // MXN y SPY
  cerca(r.mxn.dia, (1015 * 19.9) / (1030 * 20.1) - 1);
  cerca(r.mxn.inicio, (1015 * 19.9) / 20000 - 1);
  cerca(r.mxn.mes, (1015 * 19.9) / (1010 * 20.2) - 1);
  cerca(r.spy.dia, 508 / 503 - 1); cerca(r.spy.inicio, 508 / 500 - 1); cerca(r.spy.semana, 508 / 500 - 1);
  assert.equal(r.dias, 5); assert.equal(r.usd.anualizado, null); assert.equal(r.usd.avisoAnualizado, null);
  // cruce de año: base mar 29-dic; 30-dic; 31-dic; lun 4-ene
  const s2 = serie({ fecha: "2026-12-29", valorUSD: 2000, valorMXN: 40000, fx: 20, spy: 600 }, [{ f: "2026-12-30", v: 2010, fx: 20, spy: 601, fl: 0 },
    { f: "2026-12-31", v: 2040, fx: 20, spy: 603, fl: 0 }, { f: "2027-01-04", v: 2020, fx: 20, spy: 610, fl: 0 }]);
  const r2 = rendimientos({ serie: s2 });
  cerca(r2.usd.anio, 2020 / 2040 - 1); cerca(r2.usd.mes, 2020 / 2040 - 1); cerca(r2.usd.semana, 2020 / 2040 - 1);
  cerca(r2.usd.dia, 2020 / 2040 - 1); cerca(r2.usd.inicio, 2020 / 2000 - 1);
});

test("el punto de hoy reemplaza al de la misma fecha", () => {
  const s = serie(B, [{ f: "2026-11-30", v: 1010, fx: 20, spy: 505, fl: 0 }]);
  const r = rendimientos({ serie: s, punto: { f: "2026-11-30", v: 1020, fx: 20, spy: 505, fl: 0 } });
  cerca(r.usd.dia, 0.02);
});

test("anualizado: null con 89 días; con aviso a 90; sin aviso a 365", () => {
  const con = dias => rendimientos({ serie: serie({ fecha: "2026-01-01", valorUSD: 100, valorMXN: 2000, fx: 20, spy: 10 }, [{ f: new Date(Date.parse("2026-01-01T12:00:00Z") + dias * 86400000).toISOString().slice(0, 10), v: 110, fx: 20, spy: 11, fl: 0 }]) });
  const a = con(89), b = con(90), c = con(365);
  assert.equal(a.dias, 89); assert.equal(a.usd.anualizado, null); assert.equal(a.usd.avisoAnualizado, null);
  cerca(b.usd.anualizado, Math.pow(1.1, 365.25 / 90) - 1); assert.equal(b.usd.avisoAnualizado, AVISO_ANUALIZADO);
  cerca(c.usd.anualizado, Math.pow(1.1, 365.25 / 365) - 1); assert.equal(c.usd.avisoAnualizado, null);
});

test("un flujo fl ≠ 0 se encadena (no cuenta como rendimiento)", () => {
  const s = serie({ fecha: "2026-11-02", valorUSD: 100, valorMXN: 2000, fx: 20, spy: 10 }, [{ f: "2026-11-03", v: 110, fx: 20, spy: 10, fl: 10 }, { f: "2026-11-04", v: 121, fx: 20, spy: 10, fl: 0 }]);
  const r = rendimientos({ serie: s });
  cerca(r.usd.dia, 121 / 110 - 1);
  cerca(r.usd.inicio, (100 / 100) * (121 / 110) - 1); // r1 = (110 − 10)/100 − 1 = 0
  cerca(r.mxn.inicio, ((110 * 20 - 10 * 20) / 2000) * ((121 * 20) / (110 * 20)) - 1);
});

test("meta15 con 182.625 días = 1.15^0.5", () => {
  const m = meta15({ base: { v: 31959.09, vMXN: 600000 }, v: 33000, vMXN: 620000, dias: 182.625 });
  const g = Math.sqrt(1.15);
  cerca(m.esperadoUSD, 31959.09 * g, 1e-9); cerca(m.esperadoMXN, 600000 * g, 1e-8);
  cerca(m.difPtsUSD, (33000 / 31959.09 - g) * 100); cerca(m.difPtsMXN, (620000 / 600000 - g) * 100);
});

test("sin puntos: todo null", () => {
  const r = rendimientos({ serie: serie(B, []) });
  assert.equal(r.usd.dia, null); assert.equal(r.meta15, null);
});

test("composición de la cartera del 30-oct suma 1 en cada eje (pendiente y ejecutada)", () => {
  const sumas = c => ["clase", "sector", "region", "donde"].map(k => Object.values(c[k]).reduce((a, x) => a + x, 0));
  const s = semilla();
  const v0 = valuar({ libro: s.libro, tasas: [], fx: { valor: 18.774, fuente: "radar" } });
  const c0 = composicion({ valuacion: v0, libro: s.libro });
  for (const x of sumas(c0)) cerca(x, 1, 1e-9);
  cerca(c0.clase["ETF de acciones (amplio)"], (20773.09 + 6164.71) / 31959.09, 1e-9);
  cerca(c0.sector["Energía"], 1888.72 / 31959.09, 1e-9);
  const { libro } = conciliar({ libro: s.libro, portafolio: leerFix("etoro/lunes-ejecutado.json"), historial: [], ahora: Date.parse("2026-11-02T14:50:00Z") });
  const v1 = valuar({ libro, tasas: leerFix("etoro/lunes-tasas.json"), fx: { valor: 18.7, fuente: "etoro" } });
  const c1 = composicion({ valuacion: v1, libro, filas: { AAPL: { sector: "Technology" } } });
  for (const x of sumas(c1)) cerca(x, 1, 1e-9);
  assert.deepEqual(Object.keys(c1.region).sort(), ["Dólares", "EE. UU."]);
  assert.deepEqual(c1.donde, { "eToro Demo": 1 });
});
