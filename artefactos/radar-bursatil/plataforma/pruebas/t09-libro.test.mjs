// T09 · Libro, semilla y conciliación
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { semilla, conciliar, valuar, unidadesAVender, aplicarEjecucion, aplicarEventosOps, bidsDe, MANDATO } from "../lib/libro.mjs";
import { main as semillaCli } from "../bin/semilla.mjs";
import { leerFix, carpetaConDb, existe, leerSalida } from "./util.mjs";

const LUNES = Date.parse("2026-11-02T14:50:00Z");
const cp = o => JSON.parse(JSON.stringify(o));

function invariantes(libro) {
  assert.ok(libro.efectivoUSD >= -0.01, "efectivo ≥ −0.01");
  const ids = libro.posiciones.flatMap(p => p.lotes.map(l => l.positionId));
  assert.equal(new Set(ids).size, ids.length, "cada positionId en un solo lote");
  assert.deepEqual(libro.mandato, Object.assign({}, MANDATO));
}

test("semilla(): 6 documentos, efectivo 0.56 y Σ pendientes 31 958.53", () => {
  const s = semilla({ ahora: () => 1 });
  assert.deepEqual(Object.keys(s).sort(), ["config", "indiceBitacora", "libro", "mapa", "ops", "serie"]);
  assert.equal(s.libro.efectivoUSD, 0.56);
  assert.equal(Math.round(s.libro.pendientes.reduce((a, p) => a + p.montoUSD, 0) * 100) / 100, 31958.53);
  assert.equal(s.libro.pendientes.length, 5);
  assert.deepEqual(s.libro.pendientes.map(p => p.orderId), [391213449, 391187994, 391187995, 391213506, 391187996]);
  assert.equal(s.ops["2026-10"].ops.length, 5);
  assert.ok(s.ops["2026-10"].ops.every(o => o.regla === "INICIAL" && o.estado === "pendiente" && o.motivo.startsWith("Cartera inicial: buildPortfolio Moderado")));
  assert.equal(s.ops["2026-10"].ops[0].hora, "17:08"); // 21:08 UTC = 17:08 ET (horario de verano hasta el 1-nov)
  assert.deepEqual(s.serie.base, { fecha: "2026-10-30", valorUSD: 31959.09, valorMXN: 600000, fx: 18.774, spy: 755.26 });
  assert.equal(s.mapa.instrumentos.DIA.instrumentId, 3026); assert.equal(s.mapa.instrumentos.DIA.simboloEToro, "DIA.US");
  assert.equal(s.mapa.instrumentos.SPY.difPct, -0.01);
  assert.equal(s.mapa.instrumentos.GLD.verificadoEl, null);
  assert.equal(Object.keys(s.mapa.instrumentos).length, 13);
  assert.equal(s.config.operar, false); assert.equal(s.config.kind, "rutinaConfig");
  assert.deepEqual(s.indiceBitacora.dias, []);
  for (const d of [s.libro, s.ops["2026-10"], s.serie, s.mapa, s.config, s.indiceBitacora]) assert.ok(typeof d.kind === "string" && d.v === 1);
  invariantes(s.libro);
});

test("conciliar con port2.json: las 5 siguen pendientes y 0 alertas", () => {
  const { libro } = semilla();
  const r = conciliar({ libro, portafolio: leerFix("etoro/port2.json"), historial: [], ahora: Date.parse("2026-10-31T14:00:00Z") });
  assert.equal(r.libro.pendientes.length, 5);
  assert.deepEqual(r.alertas, []); assert.deepEqual(r.eventos, []);
  assert.equal(r.libro.efectivoUSD, 0.56);
  invariantes(r.libro);
});

function lunes({ sinOrderId = false } = {}) {
  const pf = leerFix("etoro/lunes-ejecutado.json");
  if (sinOrderId) for (const p of pf.clientPortfolio.positions) delete p.orderID;
  return pf;
}

for (const sinOrderId of [false, true]) {
  test(`conciliar con lunes-ejecutado${sinOrderId ? " sin orderID (regla 3)" : ""}: 5 lotes (SPY con 2), 0 pendientes, AAPL ajena ignorada`, () => {
    const { libro } = semilla();
    const r = conciliar({ libro, portafolio: lunes({ sinOrderId }), historial: [], ahora: LUNES });
    assert.equal(r.libro.pendientes.length, 0);
    const lotes = r.libro.posiciones.flatMap(p => p.lotes.map(l => [p.sym, l.positionId, l.orderId]));
    assert.equal(lotes.length, 5);
    assert.deepEqual(r.libro.posiciones.map(p => [p.sym, p.lotes.length]).sort(), [["DIA", 1], ["SPY", 2], ["XLE", 1], ["XLF", 1]]);
    assert.ok(!lotes.some(l => l[1] === 2500000099), "la posición de AAPL no es del mandato");
    assert.ok(!r.libro.posiciones.some(p => p.sym === "AAPL"));
    assert.deepEqual(r.alertas, []);
    assert.equal(r.libro.efectivoUSD, 0.56); // ya se descontó al enviar
    const spy = r.libro.posiciones.find(p => p.sym === "SPY");
    assert.deepEqual(spy.lotes.map(l => l.orderId).sort(), [391187994, 391213449]);
    assert.equal(spy.lotes.find(l => l.orderId === 391187994).unidades, 26.777294);
    assert.equal(r.eventos.filter(e => e.tipo === "ejecutada").length, 5);
    invariantes(r.libro);
    // ninguna salida del libro ni de los eventos lleva el CID de la cuenta
    assert.ok(!/"CID"/.test(JSON.stringify(r)));
    // las operaciones INICIAL pasan a ejecutada
    const s = semilla();
    const o = aplicarEventosOps({ docs: s.ops, eventos: r.eventos, ahora: LUNES });
    assert.deepEqual(o.tocados, ["2026-10"]);
    assert.ok(o.docs["2026-10"].ops.every(x => x.estado === "ejecutada" && x.positionIds.length === 1 && x.ejecucion.unidades > 0));
  });
}

test("cierres total (historial) y parcial (bid): efectivo y realizado al centavo", () => {
  const { libro } = semilla();
  const base = conciliar({ libro, portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  base.pendientes.push({ opId: "2026-11-04-XLE-V1", orderId: null, sym: "XLE", instrumentId: 3008, lado: "venta", montoUSD: null, positionId: 2600000005, unidades: null, enviadaEl: "2026-11-04T14:55:00Z" });
  base.pendientes.push({ opId: "2026-11-04-SPY-R1", orderId: null, sym: "SPY", instrumentId: 3000, lado: "venta", montoUSD: null, positionId: 2600000002, unidades: 10, enviadaEl: "2026-11-04T14:55:01Z" });
  const pf = lunes();
  pf.clientPortfolio.positions = pf.clientPortfolio.positions.filter(p => p.positionID !== 2600000005);
  pf.clientPortfolio.positions.find(p => p.positionID === 2600000002).units = 16.777294;
  const historial = [{ positionId: 2600000005, instrumentId: 3008, closeRate: 71.00, openRate: 69.80, units: 27.059025, netProfit: 32.47, closeTimestamp: "2026-11-04T14:55:03Z" }];
  const r = conciliar({ libro: base, portafolio: pf, historial, ahora: Date.parse("2026-11-05T14:50:00Z"), bids: bidsDe(leerFix("etoro/lunes-tasas.json")) });
  // XLE: 27.059025 × 71.00 = 1 921.19; costo 1 888.72 → +32.47. SPY: 10 × 758.20 = 7 582.00; costo 20 273.09 / 26.777294 × 10 = 7 571.00 → +11.00
  assert.equal(r.libro.efectivoUSD, 9503.75);
  assert.equal(r.libro.realizadoUSD, 43.47);
  assert.equal(r.libro.pendientes.length, 0);
  assert.ok(!r.libro.posiciones.some(p => p.sym === "XLE"));
  const l = r.libro.posiciones.find(p => p.sym === "SPY").lotes.find(x => x.positionId === 2600000002);
  assert.equal(l.unidades, 16.777294); assert.equal(l.costoUSD, 12702.09);
  assert.deepEqual(r.eventos.map(e => [e.tipo, e.sym, e.fuentePrecio]), [["ejecutada", "XLE", "historial"], ["ejecutada", "SPY", "bid"]]);
  invariantes(r.libro);
});

test("pendiente que desaparece: rechazada con errorCode (vuelve el efectivo); sin rastro → desconocida con alerta", () => {
  const { libro } = semilla();
  const pf = leerFix("etoro/port2.json");
  pf.clientPortfolio.ordersForOpen = pf.clientPortfolio.ordersForOpen.filter(o => ![391187996, 391213506].includes(o.orderID));
  const r = conciliar({ libro, portafolio: pf, historial: [], ahora: LUNES, ordenes: { 391187996: { orderID: 391187996, statusID: 4, errorCode: 720 } } });
  assert.equal(r.libro.efectivoUSD, 0.56 + 1888.72);
  assert.ok(r.libro.pendientes.some(p => p.orderId === 391213506 && p.estado === "desconocida"));
  assert.equal(r.alertas.length, 1);
  assert.deepEqual(r.eventos.map(e => e.tipo).sort(), ["desconocida", "rechazada"]);
});

test("lote sin posición ni cierre pendiente → EXTERNA; unidades distintas → manda eToro", () => {
  const { libro } = semilla();
  const base = conciliar({ libro, portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  const pf = lunes();
  pf.clientPortfolio.positions = pf.clientPortfolio.positions.filter(p => p.positionID !== 2600000004);
  pf.clientPortfolio.positions.find(p => p.positionID === 2600000003).units = 11.5;
  const r = conciliar({ libro: base, portafolio: pf, historial: [], ahora: LUNES + 86400000, bids: bidsDe(leerFix("etoro/lunes-tasas.json")) });
  assert.ok(r.eventos.some(e => e.tipo === "externa" && e.sym === "XLF"));
  assert.equal(r.libro.efectivoUSD, Math.round((0.56 + 55.238271 * 56.80) * 100) / 100);
  assert.equal(r.libro.posiciones.find(p => p.sym === "DIA").lotes[0].unidades, 11.5);
  assert.equal(r.alertas.length, 2);
  const o = aplicarEventosOps({ docs: {}, eventos: r.eventos, ahora: LUNES + 86400000 });
  assert.equal(o.docs["2026-11"].ops[0].regla, "EXTERNA"); assert.equal(o.docs["2026-11"].ops[0].id, "2026-11-03-XLF-EXTERNA");
});

test("recuperación: compras con orden nueva tras el inicio se adoptan y marcan operadoHoy", () => {
  const { libro } = conciliar({ libro: semilla().libro, portafolio: lunes(), historial: [], ahora: LUNES });
  const inicio = Date.parse("2026-11-04T14:58:00Z");
  const pf = lunes();
  pf.clientPortfolio.ordersForOpen = [{ instrumentID: 3006, amount: 3000, orderID: 391300001, statusID: 11, openDateTime: "2026-11-04T14:59:00Z" }];
  const plan = [{ id: "2026-11-04-QQQ-C1", sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 3000, cierres: null, motivo: "Entra al objetivo" },
    { id: "2026-11-04-IWM-C1", sym: "IWM", instrumentId: 3005, lado: "compra", regla: "C1", montoUSD: 1000, cierres: null, motivo: "Entra al objetivo" }];
  const r = conciliar({ libro, portafolio: pf, historial: [], ahora: Date.parse("2026-11-04T15:20:00Z"), planRecuperado: { de: "2026-11-04", inicio, plan } });
  assert.equal(r.libro.pendientes.length, 1);
  assert.equal(r.libro.pendientes[0].orderId, 391300001);
  assert.equal(r.libro.efectivoUSD, Math.round((0.56 - 3000) * 100) / 100 + 0); // la compra adoptada descuenta al enviarse
  assert.deepEqual(r.libro.operadoHoy, { fecha: "2026-11-04", syms: ["QQQ"] });
  assert.ok(r.eventos.some(e => e.tipo === "adoptada" && e.opId === "2026-11-04-QQQ-C1"));
});

test("valuar: Σ unidades × bid + efectivo + pendientes; pesos suman con el efectivo", () => {
  const { libro } = conciliar({ libro: semilla().libro, portafolio: lunes(), historial: [], ahora: LUNES });
  const v = valuar({ libro, tasas: leerFix("etoro/lunes-tasas.json"), fx: { valor: 18.70, fuente: "etoro" }, at: LUNES });
  const esperado = Math.round((0.660414 * 758.20 + 26.777294 * 758.20 + 11.891801 * 519.00 + 55.238271 * 56.80 + 27.059025 * 70.10) * 100) / 100;
  assert.ok(Math.abs(v.valorUSD - (esperado + 0.56)) <= 0.03, `${v.valorUSD} vs ${esperado + 0.56}`);
  assert.equal(v.spyUSD, 758.20);
  assert.equal(v.posiciones.find(p => p.sym === "SPY").lotes, 2);
  assert.ok(Math.abs(v.posiciones.reduce((a, p) => a + p.peso, 0) + v.efectivoUSD / v.valorUSD - 1) < 1e-6);
  const v2 = valuar({ libro: semilla().libro, tasas: [], fx: { valor: 18.774, fuente: "radar" } });
  assert.equal(v2.valorUSD, 31959.09); assert.equal(v2.pendientesUSD, 31958.53);
});

test("unidadesAVender: FIFO por fecha de apertura; ≥ 99 % → cierre total", () => {
  const { libro } = conciliar({ libro: semilla().libro, portafolio: lunes(), historial: [], ahora: LUNES });
  assert.deepEqual(unidadesAVender({ libro, sym: "SPY", unidades: 5 }), [{ positionId: 2600000001, instrumentId: 3000, unidades: null }, { positionId: 2600000002, instrumentId: 3000, unidades: 4.339586 }]);
  assert.deepEqual(unidadesAVender({ libro, sym: "SPY", unidades: 0.5 }), [{ positionId: 2600000001, instrumentId: 3000, unidades: 0.5 }]);
  assert.deepEqual(unidadesAVender({ libro, sym: "SPY", unidades: 27.2 }).map(c => c.unidades), [null, null]);
  assert.deepEqual(unidadesAVender({ libro, sym: "SPY", unidades: null }).map(c => c.unidades), [null, null]);
  assert.deepEqual(unidadesAVender({ libro, sym: "QQQ", unidades: 1 }), []);
});

test("aplicarEjecucion: compra ejecutada crea lote y descuenta; venta total suma; simulada no toca el libro", () => {
  const { libro } = conciliar({ libro: semilla().libro, portafolio: lunes(), historial: [], ahora: LUNES });
  libro.efectivoUSD = 5000;
  const t = Date.parse("2026-11-04T15:05:00Z");
  const r = aplicarEjecucion({ libro, ops: { kind: "carteraOps", v: 1, mes: "2026-11", at: 0, ops: [] }, ahora: t, resultados: [
    { id: "2026-11-04-XLE-V1", sym: "XLE", instrumentId: 3008, lado: "venta", regla: "V1", motivo: "Pasó a Evitar (44 %)", montoUSD: null, cierres: [{ positionId: 2600000005, unidades: null }],
      estado: "ejecutada", orderId: 9001, positionIds: [2600000005], detalle: [{ positionId: 2600000005, unidades: null, estado: "ejecutada", precio: 70.00 }] },
    { id: "2026-11-04-QQQ-C1", sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", motivo: "Entra", montoUSD: 3000, estado: "ejecutada", orderId: 9002, positionIds: [2600000100],
      ejecucion: { precio: 690, unidades: 4.347826, montoUSD: 3000, at: "2026-11-04T15:01:00Z" } },
    { id: "2026-11-04-IWM-C1", sym: "IWM", instrumentId: 3005, lado: "compra", regla: "C1", motivo: "Entra", montoUSD: 1000, estado: "pendiente", orderId: 9003, positionIds: [] },
  ] });
  assert.equal(r.libro.efectivoUSD, Math.round((5000 + 27.059025 * 70 - 3000 - 1000) * 100) / 100);
  assert.equal(r.libro.realizadoUSD, Math.round((Math.round(27.059025 * 70 * 100) / 100 - 1888.72) * 100) / 100);
  assert.ok(r.libro.posiciones.find(p => p.sym === "QQQ").lotes[0].positionId === 2600000100);
  assert.ok(r.libro.pendientes.some(p => p.sym === "IWM" && p.orderId === 9003));
  assert.deepEqual(r.libro.operadoHoy, { fecha: "2026-11-04", syms: ["XLE", "QQQ", "IWM"] });
  assert.deepEqual(r.ops.ops.map(o => [o.id, o.estado]), [["2026-11-04-XLE-V1", "ejecutada"], ["2026-11-04-QQQ-C1", "ejecutada"], ["2026-11-04-IWM-C1", "pendiente"]]);
  const s = aplicarEjecucion({ libro, ops: { kind: "carteraOps", v: 1, mes: "2026-11", at: 0, ops: [] }, ahora: t, resultados: [
    { id: "2026-11-04-QQQ-C1", sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", motivo: "Entra", montoUSD: 3000, estado: "simulada" }] });
  assert.equal(s.libro.efectivoUSD, 5000); assert.deepEqual(s.libro.pendientes, libro.pendientes);
  assert.equal(s.ops.ops[0].simulacion, true); assert.equal(s.ops.ops[0].estado, "simulada");
  invariantes(r.libro);
});

test("semilla CLI: escribe los 6 en orden; con cartera-libro existente o en _fallos → código 2 y nada en salida/", async () => {
  const dir = carpetaConDb();
  const r = await semillaCli(["--dir", dir], { ahora: () => 5 });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "sembrar");
  assert.deepEqual(leerSalida(dir, "salida/semilla/_orden.json").map(x => x.id), ["cartera-libro", "operaciones-2026-10", "cartera-serie-2026", "etoro-mapa", "rutina-config", "bitacora-indice"]);
  assert.equal(leerSalida(dir, "salida/semilla/cartera-libro.json").efectivoUSD, 0.56);
  for (const [docs, fallos] of [[{ "cartera-libro": { kind: "carteraLibro" } }, null], [{}, { "cartera-libro": "unavailable" }]]) {
    const d = carpetaConDb(docs, fallos);
    const x = await semillaCli(["--dir", d]);
    assert.equal(x.codigo, 2); assert.equal(x.linea.accion, "ya_existe");
    assert.ok(!existe(d, "salida/semilla"));
    assert.deepEqual(fs.readdirSync(path.join(d, "salida")), []);
  }
});
