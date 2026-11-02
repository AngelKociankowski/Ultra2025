// W3 (12c §C.5–C.6, 00s §1) · V2 por análisis distinto, `fuera` de 3 elementos, radar-<f> v:2, aviso y push con la fuente del
// análisis, y compras solo con un análisis de ≤ 1 día hábil.
import test from "node:test";
import assert from "node:assert/strict";
import { decidir, actualizarFuera, configEfectiva } from "../lib/reglas.mjs";
import { libroDeDb, libroADb } from "../lib/libro.mjs";
import { resumenRadar, previoDe } from "../lib/radar-resumen.mjs";
import { armarAviso, armarPush, MAX_PUSH } from "../lib/aviso.mjs";
import { conH } from "../lib/db.mjs";
import { validarDoc } from "../lib/esquemas.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { PAG, OUT30, LUNES, carteraEn, copia, libroLunesDb } from "./escenario.mjs";

const QQQ = { sym: "QQQ", instrumentId: 3006, lotes: [{ positionId: 2600000110, orderId: null, unidades: 3, costoUSD: 2000, abiertaEl: "2026-10-20T15:00:00Z" }] };
const precio = OUT30.rows.find(r => r.symbol === "QQQ").price;
const OBJ = { pesos: { SPY: 0.65, DIA: 0.19, XLF: 0.1 }, roles: {} };
function dia({ fecha, asOf, fuera, antiguedad = 0, objetivo = OBJ }) {
  const out = copia(OUT30); out.asOf = asOf;
  const { cartera } = carteraEn(LUNES, { libroMod: l => { l.posiciones.push(copia(QQQ)); l.fueraDelObjetivo = fuera; l.ultimaRutina = null; },
    tasasMod: ts => ts.concat([{ instrumentID: 3006, bid: precio, ask: precio, date: new Date(LUNES).toISOString() }]) });
  const r = decidir({ C: PAG.C, analisis: { fuente: "pagina", parcial: false, antiguedad, out }, cartera, eventos: [], config: configEfectiva(copia(CONFIG_DEFECTO)).config,
    contexto: { fecha, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: LUNES }, objetivo });
  const sig = actualizarFuera({ libro: cartera.libro, pesos: r.objetivo.pesos, completo: true, fecha, asOf }).fueraDelObjetivo;
  return { r, d: r.decisiones.find(x => x.sym === "QQQ"), fuera: sig };
}

test("(1) el mismo análisis 4 días con QQQ fuera del objetivo: V2 no vende y `dias` queda en 1; con tres análisis distintos vende el 3.º", () => {
  let fuera = {};
  for (const fecha of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
    const x = dia({ fecha, asOf: "2026-10-30", fuera });
    assert.equal(x.d.accion, "mantener", fecha); fuera = x.fuera;
    assert.deepEqual(fuera.QQQ, { desde: "2026-11-02", dias: 1, asOf: "2026-10-30" }, fecha);
  }
  fuera = {};
  const acciones = [];
  for (const [fecha, asOf] of [["2026-11-02", "2026-10-30"], ["2026-11-03", "2026-11-02"], ["2026-11-04", "2026-11-03"]]) { const x = dia({ fecha, asOf, fuera }); acciones.push([x.d.regla, x.d.accion]); fuera = x.fuera; }
  assert.deepEqual(acciones, [[null, "mantener"], [null, "mantener"], ["V2", "vender"]]);
});

test("(2) un libro con `fuera` viejo de 2 elementos se lee y la primera actualización agrega el tercero", () => {
  const doc = Object.assign(libroLunesDb(), { fuera: { QQQ: ["2026-11-03", 2] } });
  const L = libroDeDb(doc).libro;
  assert.deepEqual(L.fueraDelObjetivo, { QQQ: { desde: "2026-11-03", dias: 2 } });
  L.posiciones.push(copia(QQQ)); L.ultimaRutina = "2026-11-04";
  const f = actualizarFuera({ libro: L, pesos: OBJ.pesos, completo: true, fecha: "2026-11-05", asOf: "2026-11-05" }).fueraDelObjetivo;
  assert.deepEqual(f.QQQ, { desde: "2026-11-03", dias: 3, asOf: "2026-11-05" });
  assert.deepEqual(libroADb(Object.assign(L, { fueraDelObjetivo: f }), LUNES).fuera.QQQ, ["2026-11-03", 3, "2026-11-05"]);
  // la misma fecha ya contada (sin asOf): no suma, pero gana el tercer elemento
  const g = actualizarFuera({ libro: Object.assign(copia(L), { fueraDelObjetivo: { QQQ: { desde: "2026-11-03", dias: 2 } }, ultimaRutina: "2026-11-05" }), pesos: OBJ.pesos, completo: true, fecha: "2026-11-05", asOf: "2026-11-05" }).fueraDelObjetivo;
  assert.deepEqual(g.QQQ, { desde: "2026-11-03", dias: 2, asOf: "2026-11-05" });
  assert.deepEqual(validarDoc("cartera-libro", conH(libroADb(Object.assign(L, { fueraDelObjetivo: f }), LUNES))), []);
});

test("(3) radar-<f> v:2 con fu, fa y ant valida con h; un v:1 sigue validando; previo lleva fa y fu", () => {
  const v2 = conH(resumenRadar({ out: OUT30, estado: "listo", t: LUNES, f: "2026-11-04", fuente: "pagina", antiguedad: 3 }));
  assert.deepEqual([v2.v, v2.fu, v2.fa, v2.ant], [2, "pagina", "2026-10-30", 3]);
  assert.deepEqual(validarDoc("radar-2026-11-04", v2), []);
  assert.deepEqual(validarDoc("radar-2026-11-04", conH(resumenRadar({ out: OUT30, estado: "listo", t: LUNES, f: "2026-11-04" }))), []);
  assert.deepEqual(validarDoc("radar-2026-11-04", conH(Object.assign({}, v2, { fu: "otra" }))), ["fu"]);
  const p = previoDe(v2);
  assert.deepEqual([p.fa, p.fu], ["2026-10-30", "pagina"]);
  // con el mismo asOf que el día anterior no hay cambios
  const mismo = resumenRadar({ out: OUT30, estado: "listo", t: LUNES, f: "2026-11-05", fuente: "pagina", antiguedad: 4, previo: Object.assign({}, p, { reg: "otro", s: "" }) });
  assert.deepEqual(mismo.cambios, []);
});

const BASE = { fecha: "2026-11-04", hora: "09:59", simulacion: true, cartera: { valorUSD: 32121.42, valorMXN: 596440.12 }, rend: { usd: [0.0004, 0, 0, 0, 0.005], mxn: [0.001], spy: [0, 0, 0, 0, 0.01] },
  notas: [], operaciones: [], alertas: [], fallas: [] };
test("(4) aviso con fuente y fecha; mismo análisis que el día anterior; push con Radar pág / Radar hoy / Sin Radar", () => {
  const pag = { fuente: "pagina", fa: "2026-10-30", ant: 3, regimen: "Favorable", cambios: ["XLK pasa a Compra"] };
  assert.ok(armarAviso(Object.assign({}, BASE, { radar: pag })).includes("\nRadar: análisis de la página del 30-oct (3 días hábiles); régimen Favorable; XLK pasa a Compra\n"));
  assert.ok(armarAviso(Object.assign({}, BASE, { radar: Object.assign({}, pag, { mismo: true }) })).includes("\nRadar: mismo análisis que el día anterior (página del 30-oct)"));
  assert.ok(armarAviso(Object.assign({}, BASE, { radar: Object.assign({}, pag, { sinCompras: true }) })).includes("; sin compras: el Radar tiene 3 días"));
  assert.match(armarPush(Object.assign({}, BASE, { radar: pag })), / · Radar pág 30-oct · Ops: ninguna$/);
  assert.match(armarPush(Object.assign({}, BASE, { radar: { fuente: "rutina", fa: "2026-11-04", ant: 0, regimen: "x" } })), / · Radar hoy · /);
  assert.match(armarPush(Object.assign({}, BASE, { radar: { sinRadar: true, motivo: "policy" } })), / · Sin Radar · /);
});

test("(4) push ≤ 200 y de una línea en 20 000 casos al azar (órdenes, cifras, fuentes, fallas)", () => {
  let s = 12345;
  const azar = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const elige = a => a[Math.floor(azar() * a.length)];
  const cifra = () => (azar() < 0.5 ? -1 : 1) * Math.round(azar() * 10 ** Math.ceil(azar() * 10) * 100) / 100;
  let peor = 0;
  for (let i = 0; i < 20000; i++) {
    const n = Math.floor(azar() * 13), sim = azar() < 0.5;
    const d = { fecha: `2026-${String(1 + Math.floor(azar() * 12)).padStart(2, "0")}-${String(1 + Math.floor(azar() * 28)).padStart(2, "0")}`, simulacion: sim,
      cartera: azar() < 0.9 ? { valorUSD: Math.abs(cifra()), valorMXN: azar() < 0.9 ? Math.abs(cifra()) : null } : null,
      rend: { usd: [cifra() / 1000, 0, 0, 0, cifra() / 1000], mxn: [cifra() / 1000], spy: [0, 0, 0, 0, azar() < 0.8 ? cifra() / 1000 : null] },
      radar: elige([{ sinRadar: true }, { fuente: "pagina", fa: "2026-10-30", ant: Math.floor(azar() * 6) }, { fuente: "rutina", fa: "2026-11-04", ant: elige([0, 2]) }, null]),
      operaciones: Array.from({ length: n }, (_, k) => ({ sym: "ABCDEFGHIJ".slice(0, 1 + Math.floor(azar() * 6)) + k, lado: elige(["compra", "venta"]), regla: "R1",
        est: sim ? "simulada" : elige(["ejecutada", "aceptada", "incierta", "rechazada", "no_enviada"]) })),
      fallas: Array.from({ length: Math.floor(azar() * 4) }, () => ({ paso: elige(["20-cartera", "30-fmp-noticias", "cerrar", "db", "50-ejecutar"]), texto: "x" })) };
    const p = armarPush(d);
    assert.ok(p.length <= MAX_PUSH && !p.includes("\n") && p.length > 0, `${p.length}: ${p}`);
    peor = Math.max(peor, p.length);
  }
  assert.ok(peor <= 200);
});

test("00s §1 (b): con un análisis de 3 días hábiles no hay compras ni rebalanceo (sí ventas); con 1 día, sí", () => {
  const objetivo = { pesos: { SPY: 0.5, DIA: 0.19, XLF: 0.1, XLE: 0.06, QQQ: 0.1 }, roles: {} };
  const viejo = dia({ fecha: "2026-11-04", asOf: "2026-10-30", fuera: {}, antiguedad: 3, objetivo });
  assert.ok(!viejo.r.decisiones.some(x => ["R1", "C1"].includes(x.regla)));
  assert.ok(viejo.r.alertas.includes("Sin compras: el Radar tiene 3 días hábiles."));
  assert.deepEqual([viejo.r.antiguedad, viejo.r.sinCompras], [3, true]);
  assert.match(viejo.r.decisiones.find(x => x.sym === "SPY").motivo, /sin rebalanceo: el Radar tiene 3 días hábiles/);
  const nuevo = dia({ fecha: "2026-11-04", asOf: "2026-11-03", fuera: {}, antiguedad: 1, objetivo });
  assert.ok(nuevo.r.decisiones.some(x => x.regla === "R1") && !nuevo.r.sinCompras);
});
