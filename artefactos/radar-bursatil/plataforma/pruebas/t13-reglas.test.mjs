// T13 · Reglas y 40-decidir: escenarios de pruebas/fixtures/escenarios/ (análisis del 30-oct + cartera del lunes + cambios)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decidir, configEfectiva, actualizarFuera, requestIdDe } from "../lib/reglas.mjs";
import { valuar, semilla, mapaDeDb } from "../lib/libro.mjs";
import { validarNoticias } from "../lib/noticias.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { PAG, OUT30, libroLunes, prepararDia } from "./escenario.mjs";
import { FIX, leerFix, leerSalida } from "./util.mjs";

const C = PAG.C, F = "2026-11-02", T = Date.parse("2026-11-02T15:00:00Z");
const copia = o => JSON.parse(JSON.stringify(o));

function montarEscenario(e, extra = {}) {
  const out = e.sinAnalisis ? null : copia(OUT30);
  if (out && e.parcial) Object.assign(out, { partial: true, partialReason: "cobertura baja" });
  const libro = libroLunes();
  if (e.quitarSyms) libro.posiciones = libro.posiciones.filter(p => !e.quitarSyms.includes(p.sym));
  for (const l of e.agregarLotes || []) {
    let p = libro.posiciones.find(x => x.sym === l.sym);
    if (!p) { p = { sym: l.sym, instrumentId: l.instrumentId, lotes: [] }; libro.posiciones.push(p); }
    p.lotes.push({ positionId: l.positionId, orderId: null, unidades: l.unidades, costoUSD: l.costoUSD, abiertaEl: l.abiertaEl });
  }
  if (e.efectivoUSD !== undefined) libro.efectivoUSD = e.efectivoUSD;
  if (e.fuera) libro.fueraDelObjetivo = e.fuera;
  if (e.pendientes) libro.pendientes = libro.pendientes.concat(e.pendientes);
  // bid de eToro = precio del Radar para lo que no está en las tasas del lunes; todas con fecha de ahora (precio válido)
  const tasas = leerFix("etoro/lunes-tasas.json").rates.map(r => Object.assign({}, r, { date: new Date(T).toISOString() }));
  for (const p of libro.posiciones) if (!tasas.some(r => r.instrumentID === p.instrumentId)) { const r = OUT30.rows.find(x => x.symbol === p.sym); tasas.push({ instrumentID: p.instrumentId, bid: r.price, ask: r.price, date: new Date(T).toISOString() }); }
  const valuacion = valuar({ libro, tasas, fx: { valor: 18.774, fuente: "radar" }, at: T });
  const mapa = mapaDeDb(semilla()["etoro-mapa"]);
  for (const s of e.mapaQuitar || []) delete mapa.instrumentos[s];
  let objetivo = null;
  if (e.objetivo) {
    const actual = s => { const p = valuacion.posiciones.find(x => x.sym === s); return p ? p.valorUSD / valuacion.valorUSD : 0; };
    const pesos = {};
    for (const [s, v] of Object.entries(e.objetivo.pesos)) {
      const m = typeof v === "string" ? v.match(/^actual([+-]\d*\.?\d+)?$/) : null;
      pesos[s] = m ? actual(s) + (m[1] ? Number(m[1]) : 0) : v;
    }
    objetivo = { pesos, roles: e.objetivo.roles || {} };
  }
  const simbolos = (out ? out.rows.map(r => r.symbol) : []).concat(libro.posiciones.map(p => p.sym));
  const nv = validarNoticias({ doc: { v: 1, notas: e.notas || [] }, ahoraMs: T, ventanaH: 72, simbolos });
  const config = configEfectiva(Object.assign({}, copia(CONFIG_DEFECTO), e.config || {}, extra.config || {})).config;
  const cartera = { estado: "listo", libro, valuacion, mapa };
  return decidir({ C, analisis: out ? { fuente: "navegador", parcial: !!e.parcial, out } : { fuente: "ninguna", out: null }, cartera, eventos: nv.eventos, config,
    contexto: Object.assign({ fecha: F, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: 7.44, nowMs: T }, e.contexto || {}), objetivo });
}

const ESC = path.join(FIX, "escenarios");
for (const f of fs.readdirSync(ESC).filter(x => x.endsWith(".json")).sort()) {
  const e = JSON.parse(fs.readFileSync(path.join(ESC, f), "utf8"));
  test(`escenario ${e.nombre}: ${e.descripcion}`, () => {
    const r = montarEscenario(e), x = e.esperado;
    const dec = s => r.decisiones.find(d => d.sym === s);
    if (x.modo) assert.equal(r.modo, x.modo);
    if (x.ordenes) {
      assert.deepEqual(r.ordenes.map(o => [o.sym, o.lado, o.regla]), x.ordenes.map(o => o.slice(0, 3)));
      x.ordenes.forEach((o, i) => { if (o[3] !== null) assert.ok(Math.abs(r.ordenes[i].montoUSD - o[3]) <= 0.01, `${o[0]} ${r.ordenes[i].montoUSD} vs ${o[3]}`); });
    }
    if (x.nOrdenes !== undefined) assert.equal(r.ordenes.length, x.nOrdenes);
    for (const [s, [accion, regla]] of Object.entries(x.acciones || {})) { assert.ok(dec(s), `sin decisión para ${s}`); assert.equal(dec(s).accion, accion, s); assert.equal(dec(s).regla, regla, s); }
    for (const [s, m] of Object.entries(x.motivos || {})) assert.equal(dec(s).motivo, m);
    for (const [s, m] of Object.entries(x.razones || {})) assert.equal(dec(s).razonOmision, m);
    for (const a of x.alertas || []) assert.ok(r.alertas.some(y => y.includes(a)), `${a} en ${JSON.stringify(r.alertas)}`);
    for (const [s, cs] of Object.entries(x.cierres || {})) {
      const o = r.ordenes.find(q => q.sym === s);
      assert.equal(o.cierres.length, cs.length);
      cs.forEach(([pid, u], i) => { assert.equal(o.cierres[i].positionId, pid); if (u === null) assert.equal(o.cierres[i].unidades, null); else assert.ok(Math.abs(o.cierres[i].unidades - u) < 2e-6, `${o.cierres[i].unidades} vs ${u}`); });
    }
    // invariantes del plan: ventas antes que compras; requestId determinista por (fecha, id, k); compras en centavos hacia abajo
    const lados = r.ordenes.map(o => o.lado), iC = lados.indexOf("compra");
    assert.ok(iC < 0 || lados.slice(iC).every(l => l === "compra"));
    for (const o of r.ordenes) {
      o.requestIds.forEach((id, k) => { assert.equal(id, requestIdDe(F, o.id, k)); assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); });
      if (o.lado === "compra") assert.equal(Math.round(o.montoUSD * 100) / 100, o.montoUSD);
    }
  });
}

test("c · QQQ fuera del objetivo con señal Compra: días 1 y 2 mantener, día parcial no suma, día 3 V2", () => {
  const e = { agregarLotes: [{ sym: "QQQ", instrumentId: 3006, positionId: 2600000110, unidades: 3, costoUSD: 2000, abiertaEl: "2026-10-20T15:00:00Z" }], objetivo: null };
  let fuera = {};
  const dia = (fecha, parcial) => {
    const r = montarEscenario(Object.assign({}, e, { fuera, parcial }));
    const d = r.decisiones.find(x => x.sym === "QQQ");
    const l = Object.assign(libroLunes(), { fueraDelObjetivo: fuera, ultimaRutina: null, refs: null });
    l.posiciones.push({ sym: "QQQ", instrumentId: 3006, lotes: [{ positionId: 2600000110, orderId: null, unidades: 3, costoUSD: 2000, abiertaEl: "x" }] });
    fuera = actualizarFuera({ libro: l, pesos: r.objetivo.pesos, completo: !parcial, fecha }).fueraDelObjetivo;
    return d;
  };
  const d1 = dia("2026-11-02", false);
  assert.equal(d1.accion, "mantener"); assert.equal(d1.motivo, "Fuera del objetivo 1 de 3 días hábiles (señal Compra, 56 %)");
  assert.deepEqual(fuera.QQQ, { desde: "2026-11-02", dias: 1 });
  assert.equal(dia("2026-11-03", false).accion, "mantener");
  assert.deepEqual(fuera.QQQ, { desde: "2026-11-02", dias: 2 });
  assert.equal(dia("2026-11-04", true).accion, "mantener"); // parcial: no hay V2 y el contador no cambia
  assert.deepEqual(fuera.QQQ, { desde: "2026-11-02", dias: 2 });
  const d3 = dia("2026-11-05", false);
  assert.equal(d3.accion, "vender"); assert.equal(d3.regla, "V2"); assert.equal(d3.motivo, "Fuera del objetivo 3 días hábiles seguidos (señal Compra, 56 %)");
});

test("j · operar:false → simulación con las mismas órdenes que operar:true", () => {
  const e = JSON.parse(fs.readFileSync(path.join(ESC, "h-noticias.json"), "utf8"));
  const sim = montarEscenario(e), real = montarEscenario(e, { config: { operar: true, activadoEl: "2026-11-01T15:00:00Z" } });
  assert.equal(sim.simulacion, true); assert.equal(real.simulacion, false);
  assert.ok(real.ordenes.length > 0);
  assert.deepEqual(sim.ordenes, real.ordenes);
  // operar sin activadoEl no cuenta
  assert.equal(montarEscenario(e, { config: { operar: true } }).simulacion, true);
});

test("bloqueado (fuera de ventana): las decisiones quedan omitidas y no hay órdenes", () => {
  const e = JSON.parse(fs.readFileSync(path.join(ESC, "b-gld-evitar.json"), "utf8"));
  const r = montarEscenario(Object.assign({}, e, { contexto: { ventanaDentro: false } }));
  assert.equal(r.modo, "bloqueado"); assert.equal(r.ordenes.length, 0);
  assert.equal(r.decisiones.find(d => d.sym === "GLD").razonOmision, "Bloqueado: fuera de la ventana de órdenes");
  const s = montarEscenario({ sinAnalisis: true, objetivo: null });
  assert.equal(s.modo, "sin_objetivo"); assert.equal(s.ordenes.length, 0);
});

test("n · 40-decidir: planSha = sha256 del plan-ordenes.json escrito; ejecutar con órdenes reales y sin salida/ para db", async () => {
  const out = copia(OUT30);
  Object.assign(out.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 });
  const sim = await prepararDia({ out });
  const d = leerSalida(sim.dir, "trabajo/decisiones.json");
  assert.equal(d.planSha, crypto.createHash("sha256").update(fs.readFileSync(path.join(sim.dir, "trabajo/plan-ordenes.json"))).digest("hex"));
  assert.equal(sim.decidir.linea.accion, "simulacion");
  assert.ok(!fs.existsSync(path.join(sim.dir, "salida/pre-ejecucion")));
  const cfg = Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" });
  const real = await prepararDia({ out, dbExtra: { "rutina-config": cfg } });
  assert.equal(real.decidir.linea.accion, "ejecutar");
  // 12b §C.1: 40-decidir no arma nada para db; el reclamo de envío (pre-ejecucion) lo arma 50-ejecutar --armar
  assert.ok(!fs.existsSync(path.join(real.dir, "salida/pre-ejecucion")));
  assert.equal(leerSalida(real.dir, "trabajo/decisiones.json").planSha, crypto.createHash("sha256").update(fs.readFileSync(path.join(real.dir, "trabajo/plan-ordenes.json"))).digest("hex"));
  const nada = await prepararDia({});
  assert.equal(nada.decidir.linea.accion, "nada");
});

test("configEfectiva: fuera de rango → defecto con alerta", () => {
  const r = configEfectiva({ bandaPts: 40, perfil: "loco", operar: "sí", ventanaET: { desde: "08:00", hasta: "15:00" }, maxOrdenesDia: 3 });
  assert.equal(r.config.bandaPts, 5); assert.equal(r.config.perfil, "moderado"); assert.equal(r.config.operar, false);
  assert.equal(r.config.ventanaET.desde, "09:45"); assert.equal(r.config.ventanaET.hasta, "15:00"); assert.equal(r.config.maxOrdenesDia, 3);
  assert.equal(r.alertas.length, 4);
});

test("N7 · ETF de ETF_PAID sin fila en un análisis listo → dato faltante: omitida, alerta, contador fuera quieto; una acción sin fila sí cuenta", () => {
  const out = copia(OUT30); out.rows = out.rows.filter(r => r.symbol !== "XLE" && r.symbol !== "AAPL");
  const libro = libroLunes(); libro.fueraDelObjetivo = { XLE: { desde: "2026-10-29", dias: 2 } };
  libro.posiciones.push({ sym: "AAPL", instrumentId: 1001, lotes: [{ positionId: 2600000103, orderId: null, unidades: 5, costoUSD: 1700, abiertaEl: "2026-10-20T15:00:00Z" }] });
  const tasas = leerFix("etoro/lunes-tasas.json").rates.map(r => Object.assign({}, r, { date: new Date(T).toISOString() })).concat([{ instrumentID: 1001, bid: 340, ask: 340.1, date: new Date(T).toISOString() }]);
  const valuacion = valuar({ libro, tasas, fx: { valor: 18.774, fuente: "radar" }, at: T });
  const w = s => valuacion.posiciones.find(p => p.sym === s).valorUSD / valuacion.valorUSD;
  const r = decidir({ C, analisis: { fuente: "rutina", parcial: false, out }, cartera: { estado: "listo", libro, valuacion, mapa: mapaDeDb(semilla()["etoro-mapa"]) }, eventos: [],
    config: configEfectiva(copia(CONFIG_DEFECTO)).config, contexto: { fecha: F, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: T },
    objetivo: { pesos: { SPY: w("SPY"), DIA: w("DIA"), XLF: w("XLF") }, roles: {} } });
  const xle = r.decisiones.find(d => d.sym === "XLE"), aapl = r.decisiones.find(d => d.sym === "AAPL");
  assert.equal(xle.accion, "omitida"); assert.match(xle.razonOmision, /dato faltante/);
  assert.ok(r.alertas.some(a => /^XLE falta en el análisis de hoy/.test(a)));
  assert.ok(!r.ordenes.some(o => o.sym === "XLE"));
  assert.deepEqual([aapl.accion, aapl.motivo], ["mantener", "Fuera del objetivo 1 de 3 días hábiles (sin fila en el análisis de hoy)"]);
  const l = Object.assign(copia(libro), { ultimaRutina: "2026-11-01" });
  const f = actualizarFuera({ libro: l, pesos: r.objetivo.pesos, completo: true, fecha: F, faltantes: ["XLE"] }).fueraDelObjetivo;
  assert.deepEqual(f, { XLE: { desde: "2026-10-29", dias: 2 }, AAPL: { desde: F, dias: 1 } });
});
