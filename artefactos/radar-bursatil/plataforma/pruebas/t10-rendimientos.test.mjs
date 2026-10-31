// T10 / K2(3) · Rendimientos por índices encadenados y referencias del libro contra la serie completa (12-plan §5.13.1)
import test from "node:test";
import assert from "node:assert/strict";
import { indicesDelDia, rendimientosRefs, actualizarRefs, meta15, composicion, AVISO_ANUALIZADO } from "../lib/rendimientos.mjs";
import { semilla, libroDeDb, conciliar, valuar } from "../lib/libro.mjs";
import { i8 } from "../lib/db.mjs";
import { sumarDias, diasEntre } from "../lib/tiempo.mjs";
import { leerFix } from "./util.mjs";

const cerca = (a, b, tol = 1e-6) => assert.ok(a === b || Math.abs(a - b) < tol, `${a} vs ${b}`);

// Referencia: el cálculo de T10 sobre la serie completa (12-plan §5.13.1), escrito aparte
function referencia(base, puntos) {
  const P = [{ f: base[0], v: base[1], vm: base[2], spy: base[3], fl: 0, fx: base[2] / base[1] }].concat(puntos);
  const n = P.length - 1, ult = P[n];
  const lunes = f => sumarDias(f, -((new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7));
  const refAntes = lim => { let k = 0; for (let i = 0; i < P.length; i++) if (P[i].f < lim) k = i; return k; };
  const desde = (k, val, flujo) => { let g = 1; for (let i = k + 1; i < P.length; i++) g *= (val(P[i]) - flujo(P[i])) / val(P[i - 1]); return g - 1; };
  const refs = [n - 1, refAntes(lunes(ult.f)), refAntes(ult.f.slice(0, 8) + "01"), refAntes(ult.f.slice(0, 5) + "01-01"), 0];
  return {
    usd: refs.map(k => desde(k, p => p.v, p => p.fl)),
    mxn: refs.map(k => desde(k, p => p.vm, p => p.fl * p.fx)),
    spy: refs.map(k => desde(k, p => p.spy, () => 0)),
  };
}

// recorre los días como la rutina: índices del día, rendimientos por refs, luego actualizar refs
function porRefs(base, puntos) {
  let refs = { base: base.slice(), dia: base.slice(), sem: base.slice(), mes: base.slice(), anio: base.slice() }, r = null;
  for (const p of puntos) {
    const ix = indicesDelDia({ refs, v: p.v, fx: p.fx, fl: p.fl });
    const punto = { f: p.f, v: p.v, vm: p.v * p.fx, spy: p.spy, i: i8(ix.i), im: i8(ix.im) };
    r = rendimientosRefs({ refs, punto });
    refs = actualizarRefs({ refs, punto });
  }
  return r;
}
const BASE = ["2026-10-30", 31959.09, 600000, 755.26, 1, 1];
const pto = (f, v, fx, spy, fl = 0) => ({ f, v, vm: v * fx, fx, spy, fl });

const CASOS = {
  "cruce de lunes (vie → lun → mar)": [pto("2026-11-02", 32010, 18.7, 758.2), pto("2026-11-03", 32100, 18.65, 760), pto("2026-11-06", 31900, 18.8, 752), pto("2026-11-09", 32200, 18.6, 765), pto("2026-11-10", 32300, 18.55, 770)],
  "cruce de 1-dic": [pto("2026-11-27", 32000, 18.7, 758), pto("2026-11-30", 32050, 18.71, 759), pto("2026-12-01", 32400, 18.4, 771), pto("2026-12-02", 32390, 18.42, 770)],
  "cruce de 1-ene": [pto("2026-12-30", 33000, 18.2, 780), pto("2026-12-31", 33100, 18.1, 782), pto("2027-01-04", 32900, 18.3, 776), pto("2027-01-05", 33050, 18.25, 779)],
  "con un flujo fl ≠ 0": [pto("2026-11-02", 32010, 18.7, 758.2), pto("2026-11-03", 35100, 18.7, 760, 3000), pto("2026-11-04", 35200, 18.7, 761)],
};
for (const [nombre, puntos] of Object.entries(CASOS)) {
  test(`refs = serie completa (< 1e-6): ${nombre}`, () => {
    const a = porRefs(BASE, puntos), b = referencia(BASE, puntos);
    for (const k of ["usd", "mxn", "spy"]) for (let i = 0; i < 5; i++) cerca(a[k][i], b[k][i]);
  });
}

test("anualizado: null con 89 días; con aviso a 90; sin aviso a 365; meta15 con 182.625 d = 1.15^0.5", () => {
  const con = dias => porRefs(["2026-01-01", 100, 2000, 10, 1, 1], [pto(new Date(Date.parse("2026-01-01T12:00:00Z") + dias * 86400000).toISOString().slice(0, 10), 110, 20, 11)]);
  const a = con(89), b = con(90), c = con(365);
  assert.equal(a.dias, 89); assert.equal(a.usd[5], null); assert.equal(a.aviso, null);
  cerca(b.usd[5], Math.pow(1.1, 365.25 / 90) - 1); assert.equal(b.aviso, AVISO_ANUALIZADO);
  cerca(c.usd[5], Math.pow(1.1, 365.25 / 365) - 1); assert.equal(c.aviso, null);
  const m = meta15({ base: { v: 31959.09, vMXN: 600000 }, v: 33000, vMXN: 620000, dias: 182.625 }), g = Math.sqrt(1.15);
  cerca(m.esperadoUSD, 31959.09 * g, 1e-9); cerca(m.difPtsUSD, (33000 / 31959.09 - g) * 100, 1e-12);
});

test("refs del libro: al cambiar de semana, mes o año, la referencia pasa a ser el último punto", () => {
  let refs = { base: BASE.slice(), dia: ["2026-11-27", 32000, 598400, 758, 1.001, 0.99], sem: BASE.slice(), mes: BASE.slice(), anio: BASE.slice() };
  refs = actualizarRefs({ refs, punto: { f: "2026-12-01", v: 32400, vm: 596160, spy: 771, i: 1.0135, im: 0.9936 } });
  assert.equal(refs.sem[0], "2026-11-27"); assert.equal(refs.mes[0], "2026-11-27"); assert.equal(refs.anio[0], "2026-10-30"); assert.equal(refs.dia[0], "2026-12-01");
  assert.equal(diasEntre(refs.base[0], refs.dia[0]), 32);
});

test("composición de la cartera del 30-oct y del lunes suma 1 en cada eje", () => {
  const sumas = c => ["clase", "sector", "region", "donde"].map(k => Object.values(c[k]).reduce((a, x) => a + x, 0));
  const libro0 = libroDeDb(semilla()["cartera-libro"]).libro;
  const c0 = composicion({ valuacion: valuar({ libro: libro0, tasas: [], fx: { valor: 18.774, fuente: "radar" } }), libro: libro0 });
  for (const x of sumas(c0)) cerca(x, 1, 1e-9);
  cerca(c0.clase["ETF de acciones (amplio)"], (20773.09 + 6164.71) / 31959.09, 1e-9);
  const t = Date.parse("2026-11-02T14:50:00Z");
  const { libro } = conciliar({ libro: libro0, portafolio: leerFix("etoro/lunes-ejecutado.json"), historial: [], ahora: t });
  const tasas = leerFix("etoro/lunes-tasas.json").rates;
  const c1 = composicion({ valuacion: valuar({ libro, tasas, fx: { valor: 18.7, fuente: "etoro" }, at: t }), libro });
  for (const x of sumas(c1)) cerca(x, 1, 1e-9);
  assert.deepEqual(Object.keys(c1.region).sort(), ["Dólares", "EE. UU."]);
});
