// T09 / K2 / K5 / K9 · Libro v2, semilla, conciliación, valuación con precio válido y resultados del día
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { semilla, libroDeDb, libroADb, mapaDeDb, mapaADb, conciliar, valuar, unidadesAVender, aplicarEventosOps, aplicarResultados, bidsDe, opsNuevo, MANDATO, REF_BASE } from "../lib/libro.mjs";
import { conH, importar, leerVersiones } from "../lib/db.mjs";
import { validarDoc } from "../lib/esquemas.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { main as semillaCli } from "../bin/semilla.mjs";
import { leerFix, carpetaConDb, agregarLecturas } from "./util.mjs";

const LUNES = Date.parse("2026-11-02T14:50:00Z");
const S = semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") });
const libroSemilla = () => libroDeDb(S["cartera-libro"]).libro;
const tasasLunes = (t = LUNES) => leerFix("etoro/lunes-tasas.json").rates.map(r => Object.assign({}, r, { date: new Date(t).toISOString() }));
function invariantes(libro) {
  assert.ok(libro.efectivoUSD >= -0.01, "efectivo ≥ −0.01");
  const ids = libro.posiciones.flatMap(p => p.lotes.map(l => l.positionId));
  assert.equal(new Set(ids).size, ids.length, "cada positionId en un solo lote");
  assert.deepEqual(libro.mandato, Object.assign({}, MANDATO));
}
const lunes = ({ sinOrderId = false } = {}) => { const pf = leerFix("etoro/lunes-ejecutado.json"); if (sinOrderId) for (const p of pf.clientPortfolio.positions) delete p.orderID; return pf; };

test("semilla (12b §E.11): 5 documentos válidos; efectivo 0.56; Σ pend 31 958.53; refs = base", () => {
  assert.deepEqual(Object.keys(S), ["rutina-config", "cartera-libro", "etoro-mapa", "ops-2026-10-30", "punto-2026-10-30"]);
  for (const [id, d] of Object.entries(S)) assert.deepEqual(validarDoc(id, conH(d)), [], id);
  const l = S["cartera-libro"];
  assert.equal(l.efectivo, 0.56);
  assert.equal(Math.round(l.pend.reduce((a, p) => a + p.usd, 0) * 100) / 100, 31958.53);
  assert.deepEqual(l.pend.map(p => [p.o, p.est, p.dia, p.lado]), [[391213449, "aceptada", "2026-10-30", "c"], [391187994, "aceptada", "2026-10-30", "c"], [391187995, "aceptada", "2026-10-30", "c"],
    [391213506, "aceptada", "2026-10-30", "c"], [391187996, "aceptada", "2026-10-30", "c"]]);
  assert.equal(l.pend[0].env, "2026-10-30T21:08:20Z");
  for (const k of ["base", "dia", "sem", "mes", "anio"]) assert.deepEqual(l.refs[k], REF_BASE.slice());
  assert.ok(S["ops-2026-10-30"].ops.every(o => o.regla === "INICIAL" && o.est === "aceptada"));
  assert.equal(S["punto-2026-10-30"].v_, 31959.09); assert.equal(S["punto-2026-10-30"].i, 1);
  assert.deepEqual(S["etoro-mapa"].i.DIA, [3026, 6, "2026-10-30", 0]); assert.equal(S["etoro-mapa"].i.GLD[2], null);
  assert.equal(S["rutina-config"].operar, false); assert.equal(S["rutina-config"].v, 2);
});

test("libro y mapa: db ↔ memoria sin pérdida; entradas malformadas se descartan con alerta (H15)", () => {
  const { libro, alertas } = libroDeDb(S["cartera-libro"]);
  assert.deepEqual(alertas, []);
  const vuelta = libroADb(libro, Date.parse("2026-10-31T12:00:00Z"));
  assert.deepEqual(vuelta, S["cartera-libro"]);
  assert.deepEqual(mapaADb(mapaDeDb(S["etoro-mapa"]), Date.parse("2026-10-31T12:00:00Z")), S["etoro-mapa"]);
  const sucio = Object.assign({}, S["cartera-libro"], { lotes: [["SPY", 3000, 1, null, 1, 700, "2026-11-02T14:30:00Z"], null, ["x"]], pend: S["cartera-libro"].pend.concat([{ id: 7 }, "x"]) });
  const r = libroDeDb(sucio);
  assert.equal(r.libro.posiciones.length, 1); assert.equal(r.libro.pendientes.length, 5); assert.equal(r.alertas.length, 4);
});

for (const sinOrderId of [false, true]) {
  test(`K5 · lunes-ejecutado${sinOrderId ? " sin orderID (regla 3)" : ""}: las 5 aceptadas pasan a 5 lotes y ops-2026-10-30 queda en ejecutada`, () => {
    const r = conciliar({ libro: libroSemilla(), portafolio: lunes({ sinOrderId }), historial: [], ahora: LUNES });
    assert.equal(r.libro.pendientes.length, 0);
    assert.deepEqual(r.libro.posiciones.map(p => [p.sym, p.lotes.length]).sort(), [["DIA", 1], ["SPY", 2], ["XLE", 1], ["XLF", 1]]);
    assert.ok(!r.libro.posiciones.some(p => p.sym === "AAPL"), "la posición de AAPL no es del mandato");
    assert.deepEqual(r.alertas, []);
    assert.equal(r.libro.efectivoUSD, 0.56);
    const o = aplicarEventosOps({ docs: { "2026-10-30": S["ops-2026-10-30"] }, eventos: r.eventos, ahora: LUNES });
    assert.deepEqual(o.tocados, ["2026-10-30"]);
    assert.ok(o.docs["2026-10-30"].ops.every(x => x.est === "ejecutada" && x.pos.length === 1 && x.uej > 0));
    assert.deepEqual(validarDoc("ops-2026-10-30", conH(o.docs["2026-10-30"])), []);
    assert.deepEqual(validarDoc("cartera-libro", conH(libroADb(r.libro, LUNES))), []);
    assert.ok(!/"CID"|10000001/.test(JSON.stringify(r)));
    invariantes(r.libro);
  });
}

test("cola del 30-oct (port2): las 5 siguen aceptadas, con alerta de pendiente", () => {
  const r = conciliar({ libro: libroSemilla(), portafolio: leerFix("etoro/port2.json"), historial: [], ahora: Date.parse("2026-10-31T14:00:00Z") });
  assert.equal(r.libro.pendientes.length, 5); assert.deepEqual(r.eventos, []);
  assert.equal(r.alertas.filter(a => a.startsWith("Pendiente de confirmar: ")).length, 5);
});

test("cierres total (historial) y parcial (bid): efectivo y realizado al centavo", () => {
  const base = conciliar({ libro: libroSemilla(), portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  base.pendientes.push({ opId: "2026-11-04-XLE-V1", dia: "2026-11-04", orderId: null, sym: "XLE", instrumentId: 3008, lado: "venta", montoUSD: null, positionId: 2600000005, unidades: null, enviadaEl: "2026-11-04T14:55:00Z", estado: "aceptada" });
  base.pendientes.push({ opId: "2026-11-04-SPY-R1", dia: "2026-11-04", orderId: null, sym: "SPY", instrumentId: 3000, lado: "venta", montoUSD: null, positionId: 2600000002, unidades: 10, enviadaEl: "2026-11-04T14:55:01Z", estado: "aceptada" });
  const pf = lunes();
  pf.clientPortfolio.positions = pf.clientPortfolio.positions.filter(p => p.positionID !== 2600000005);
  pf.clientPortfolio.positions.find(p => p.positionID === 2600000002).units = 16.777294;
  const historial = [{ positionId: 2600000005, closeRate: 71.00, closeTimestamp: "2026-11-04T14:55:03Z" }];
  const r = conciliar({ libro: base, portafolio: pf, historial, ahora: Date.parse("2026-11-05T14:50:00Z"), bids: bidsDe(tasasLunes()) });
  // XLE: 27.059025 × 71.00 = 1 921.19; costo 1 888.72 → +32.47. SPY: 10 × 758.20 = 7 582.00; costo 20 273.09 / 26.777294 × 10 = 7 571.00 → +11.00
  assert.equal(r.libro.efectivoUSD, 9503.75); assert.equal(r.libro.realizadoUSD, 43.47);
  assert.equal(r.libro.pendientes.length, 0);
  const l = r.libro.posiciones.find(p => p.sym === "SPY").lotes.find(x => x.positionId === 2600000002);
  assert.equal(l.unidades, 16.777294); assert.equal(l.costoUSD, 12702.09);
  invariantes(r.libro);
});

test("compra que desaparece: errorCode → no_ejecutada y vuelve el efectivo; sin rastro → incierta", () => {
  const pf = leerFix("etoro/port2.json");
  pf.clientPortfolio.ordersForOpen = pf.clientPortfolio.ordersForOpen.filter(o => ![391187996, 391213506].includes(o.orderID));
  const r = conciliar({ libro: libroSemilla(), portafolio: pf, historial: [], ahora: LUNES, ordenes: { 391187996: { orderID: 391187996, statusID: 4, errorCode: 720 } } });
  assert.equal(r.libro.efectivoUSD, Math.round((0.56 + 1888.72) * 100) / 100);
  assert.ok(r.libro.pendientes.some(p => p.orderId === 391213506 && p.estado === "incierta"));
  assert.deepEqual(r.eventos.map(e => e.tipo).sort(), ["incierta", "no_ejecutada"]);
  const o = aplicarEventosOps({ docs: { "2026-10-30": S["ops-2026-10-30"] }, eventos: r.eventos, ahora: LUNES }).docs["2026-10-30"].ops;
  assert.equal(o.find(x => x.o === 391187996).est, "no_ejecutada"); assert.equal(o.find(x => x.o === 391213506).est, "incierta");
});

test("lote sin posición ni cierre pendiente → EXTERNA en ops-<hoy>; unidades distintas → manda eToro", () => {
  const base = conciliar({ libro: libroSemilla(), portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  const pf = lunes();
  pf.clientPortfolio.positions = pf.clientPortfolio.positions.filter(p => p.positionID !== 2600000004);
  pf.clientPortfolio.positions.find(p => p.positionID === 2600000003).units = 11.5;
  const r = conciliar({ libro: base, portafolio: pf, historial: [], ahora: LUNES + 86400000, bids: bidsDe(tasasLunes()) });
  assert.ok(r.eventos.some(e => e.tipo === "externa" && e.sym === "XLF"));
  assert.equal(r.libro.posiciones.find(p => p.sym === "DIA").lotes[0].unidades, 11.5);
  const o = aplicarEventosOps({ docs: {}, eventos: r.eventos, ahora: LUNES + 86400000 });
  assert.equal(o.docs["2026-11-03"].ops[0].regla, "EXTERNA"); assert.equal(o.docs["2026-11-03"].ops[0].id, "2026-11-03-XLF-EXTERNA");
  assert.deepEqual(validarDoc("ops-2026-11-03", conH(o.docs["2026-11-03"])), []);
});

test("valuar con precio válido (H8): bid 0 o viejo → precio guardado o costo, alerta y precioValido:false", () => {
  const libro = conciliar({ libro: libroSemilla(), portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  const ok = valuar({ libro, tasas: tasasLunes(), fx: { valor: 18.7, fuente: "etoro" }, at: LUNES + 60000 });
  assert.deepEqual(ok.alertas, []); assert.ok(ok.posiciones.every(p => p.precioValido));
  assert.deepEqual(ok.precios.XLF, [56.80, "2026-11-02"]);
  const malas = tasasLunes().map(r => (r.instrumentID === 3004 ? Object.assign({}, r, { bid: 0 }) : r.instrumentID === 3026 ? Object.assign({}, r, { date: "2026-11-02T13:00:00Z" }) : r));
  libro.precios = { DIA: [518.5, "2026-10-30"] };
  const v = valuar({ libro, tasas: malas, fx: { valor: 18.7, fuente: "etoro" }, at: LUNES + 60000 });
  const xlf = v.posiciones.find(p => p.sym === "XLF"), dia = v.posiciones.find(p => p.sym === "DIA");
  assert.equal(xlf.precioValido, false); assert.equal(xlf.valorUSD, 3132.01); // a costo
  assert.equal(dia.precioValido, false); assert.equal(dia.precioUSD, 518.5);
  assert.deepEqual(v.alertas, ["Precio inválido de eToro para DIA; se valúa con el de 2026-10-30", "Precio inválido de eToro para XLF; se valúa a costo"]);
  assert.ok(Math.abs(v.valorUSD - ok.valorUSD) < 120, "el total no pierde la posición sin precio");
});

test("unidadesAVender: FIFO por fecha de apertura; ≥ 99 % → cierre total", () => {
  const libro = conciliar({ libro: libroSemilla(), portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  assert.deepEqual(unidadesAVender({ libro, sym: "SPY", unidades: 5 }), [{ positionId: 2600000001, instrumentId: 3000, unidades: null }, { positionId: 2600000002, instrumentId: 3000, unidades: 4.339586 }]);
  assert.deepEqual(unidadesAVender({ libro, sym: "SPY", unidades: 27.2 }).map(c => c.unidades), [null, null]);
  assert.deepEqual(unidadesAVender({ libro, sym: "QQQ", unidades: 1 }), []);
});

test("aplicarResultados: simulación solo registra; real crea lote, pendiente, venta y deja fuera lo rechazado", () => {
  const libro = conciliar({ libro: libroSemilla(), portafolio: lunes(), historial: [], ahora: LUNES }).libro;
  libro.efectivoUSD = 5000;
  const F = "2026-11-04", t = Date.parse("2026-11-04T15:05:00Z");
  const plan = [{ id: `${F}-XLE-V1`, sym: "XLE", instrumentId: 3008, lado: "venta", regla: "V1", motivo: "Pasó a Evitar (44 %)", montoUSD: null, cierres: [{ positionId: 2600000005, unidades: null }] },
    { id: `${F}-QQQ-C1`, sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", motivo: "Entra", montoUSD: 3000, cierres: null },
    { id: `${F}-IWM-C1`, sym: "IWM", instrumentId: 3005, lado: "compra", regla: "C1", motivo: "Entra", montoUSD: 1000, cierres: null },
    { id: `${F}-VWO-C1`, sym: "VWO", instrumentId: 4252, lado: "compra", regla: "C1", motivo: "Entra", montoUSD: 500, cierres: null }];
  const sim = aplicarResultados({ libro, opsHoy: opsNuevo(F), plan, simulacion: true, ahora: t });
  assert.equal(sim.libro.efectivoUSD, 5000); assert.ok(sim.ops.ops.every(o => o.est === "simulada" && o.sim));
  const res = [{ id: plan[0].id, k: 0, est: "ejecutada", env: "2026-11-04T15:01:00Z", o: 9001, px: 70 },
    { id: plan[1].id, k: 0, est: "ejecutada", env: "2026-11-04T15:01:10Z", o: 9002, pos: [2600000100], px: 690, uej: 4.347826, usdej: 3000, abierta: "2026-11-04T15:01:12Z" },
    { id: plan[2].id, k: 0, est: "aceptada", env: "2026-11-04T15:01:20Z", o: 9003 },
    { id: plan[3].id, k: 0, est: "rechazada", env: "2026-11-04T15:01:30Z", err: "etoro_rechazo HTTP 400" }];
  const r = aplicarResultados({ libro, opsHoy: opsNuevo(F), plan, res, simulacion: false, ahora: t });
  assert.equal(r.libro.efectivoUSD, Math.round((5000 + Math.round(27.059025 * 70 * 100) / 100 - 3000 - 1000) * 100) / 100);
  assert.ok(r.libro.posiciones.find(p => p.sym === "QQQ").lotes[0].positionId === 2600000100);
  assert.deepEqual(r.libro.pendientes.map(p => [p.sym, p.estado, p.enviadaEl]), [["IWM", "aceptada", "2026-11-04T15:01:20Z"]]);
  assert.deepEqual(r.ops.ops.map(o => [o.sym, o.est]), [["XLE", "ejecutada"], ["QQQ", "ejecutada"], ["IWM", "aceptada"], ["VWO", "rechazada"]]);
  assert.deepEqual(validarDoc(`ops-${F}`, conH(r.ops)), []);
  invariantes(r.libro);
});

test("K9 · semilla CLI: 5 set sin ifVersion con h válido; código 2 si cartera-libro está ok, falló o no se leyó", async () => {
  const dir = carpetaConDb({}, null, { noExisten: ["cartera-libro"] });
  const r = await semillaCli(["--dir", dir], { ahora: () => Date.parse("2026-11-01T18:00:00Z") });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "sembrar"); assert.equal(r.linea.escribir, "salida/semilla/db_write.json");
  const w = JSON.parse(fs.readFileSync(path.join(dir, "salida/semilla/db_write.json"), "utf8"));
  assert.deepEqual(w.ops.map(o => o.path.replace(DB_RUTA + "/", "")), ["rutina-config", "cartera-libro", "etoro-mapa", "ops-2026-10-30", "punto-2026-10-30"]);
  assert.ok(w.ops.every(o => o.op === "set" && o.ifVersion === undefined));
  // lo que se escribiría lo acepta importar (h y forma)
  agregarLecturas(dir, w.ops.map(o => ({ id: o.path.split("/").pop(), exists: true, version: 1, data: o.data })));
  const v = leerVersiones(dir);
  assert.ok(w.ops.every(o => v[o.path.split("/").pop()].estado === "ok"));
  for (const [docs, fallos, opts] of [[{ "cartera-libro": S["cartera-libro"] }, null, {}], [{}, { "cartera-libro": "unavailable" }, {}], [{}, null, {}]]) {
    const d = carpetaConDb(docs, fallos, opts);
    const x = await semillaCli(["--dir", d]);
    assert.equal(x.codigo, 2); assert.equal(x.linea.accion, "ya_existe");
    assert.deepEqual(fs.readdirSync(path.join(d, "salida")), []);
  }
});
