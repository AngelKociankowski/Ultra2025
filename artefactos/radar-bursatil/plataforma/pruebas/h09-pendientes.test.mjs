// H09 · A2.3 portado (12b §F.5, §F.7, §I): un cierre incierta/aceptada se resuelve o se libera al día hábil siguiente; nunca
// bloquea para siempre la salida de un Evitar
import test from "node:test";
import assert from "node:assert/strict";
import { conciliar, aplicarResultados, opsNuevo, valuar, semilla, mapaDeDb, alertaPendiente } from "../lib/libro.mjs";
import { decidir, configEfectiva, requestIdDe } from "../lib/reglas.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { libroLunes, PAG, OUT30, copia } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

const D1 = "2026-11-04", D2 = "2026-11-05";
const GLD = { id: `${D1}-GLD-V1`, orden: 1, sym: "GLD", instrumentId: 3025, lado: "venta", regla: "V1", montoUSD: null, cierres: [{ positionId: 2600000101, unidades: null }], motivo: "Pasó a Evitar", noticias: [], requestIds: [requestIdDe(D1, `${D1}-GLD-V1`, 0)] };
const cfg = configEfectiva(Object.assign(copia(CONFIG_DEFECTO), { operar: true, activadoEl: "2026-11-03T12:00:00Z" })).config;
const out = () => { const o = copia(OUT30); Object.assign(o.rows.find(r => r.symbol === "GLD"), { signal: 1, signalLabel: "Evitar", pct: 45 }); return o; };
function portafolio({ cola = false } = {}) {
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  pf.clientPortfolio.positions.push({ positionID: 2600000101, instrumentID: 3025, units: 1, amount: 350, openRate: 350, openDateTime: "2026-10-20T15:00:00Z", isBuy: true, leverage: 1, orderID: 1 });
  pf.clientPortfolio.ordersForClose = cola ? [{ positionID: 2600000101, instrumentID: 3025, orderID: 5555 }] : [];
  return pf;
}
function decidirEl(libro, fecha) {
  const t = Date.parse(fecha + "T15:00:00Z"), tasas = leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3025, bid: 340, ask: 340.2 }]).map(r => Object.assign({}, r, { date: new Date(t).toISOString() }));
  const valuacion = valuar({ libro, tasas, fx: { valor: 18.774, fuente: "radar" }, at: t });
  return decidir({ C: PAG.C, analisis: { fuente: "rutina", parcial: false, out: out() }, cartera: { estado: "listo", libro, valuacion, mapa: mapaDeDb(semilla()["etoro-mapa"]) }, eventos: [], config: cfg,
    contexto: { fecha, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs: t } });
}
function dia1() {
  const libro = libroLunes();
  libro.posiciones.push({ sym: "GLD", instrumentId: 3025, lotes: [{ positionId: 2600000101, orderId: null, unidades: 1, costoUSD: 350, abiertaEl: "2026-10-20T15:00:00Z" }] });
  // el V1 del día 1 terminó incierta (503) y la posición siguió intacta
  return aplicarResultados({ libro, opsHoy: opsNuevo(D1), plan: [GLD], res: [{ id: GLD.id, k: 0, est: "incierta", env: `${D1}T15:05:00Z`, http: 503, o: null, pos: [], err: "HTTP 503" }], simulacion: false, ahora: Date.parse(`${D1}T15:20:00Z`) }).libro;
}

test("A2.3 · día 1: pendiente con alerta y la V1 de hoy no se repite; día 2 (sin ordersForClose): no_ejecutada y V1 vende con línea nueva", () => {
  const L1 = dia1();
  assert.deepEqual(L1.pendientes.map(p => [p.sym, p.lado, p.estado, p.dia]), [["GLD", "venta", "incierta", D1]]);
  assert.equal(alertaPendiente(L1.pendientes[0]), `Pendiente de confirmar: GLD venta desde ${D1}`);
  // otra sesión del mismo día: el pendiente sigue y frena otra venta
  const c1 = conciliar({ libro: L1, portafolio: portafolio(), historial: [], ahora: Date.parse(`${D1}T16:00:00Z`) });
  assert.equal(c1.libro.pendientes.length, 1); assert.ok(c1.alertas.includes(`Pendiente de confirmar: GLD venta desde ${D1}`));
  const g1 = decidirEl(c1.libro, D1).decisiones.find(d => d.sym === "GLD");
  assert.deepEqual([g1.accion, g1.razonOmision], ["omitida", "Ya tiene un cierre enviado hoy"]);
  // día hábil siguiente
  const c2 = conciliar({ libro: L1, portafolio: portafolio(), historial: [], ahora: Date.parse(`${D2}T14:50:00Z`) });
  assert.equal(c2.libro.pendientes.length, 0);
  assert.deepEqual(c2.eventos.map(e => [e.tipo, e.lado, e.opId]), [["no_ejecutada", "venta", GLD.id]]);
  assert.ok(c2.alertas.some(a => /^Cierre de GLD del 2026-11-04 no se ejecutó/.test(a)));
  const r2 = decidirEl(c2.libro, D2);
  assert.deepEqual(r2.ordenes.filter(o => o.sym === "GLD").map(o => [o.id, o.regla, o.cierres]), [[`${D2}-GLD-V1`, "V1", [{ positionId: 2600000101, unidades: null }]]]);
});

test("cierre en ordersForClose al día siguiente → sigue aceptada y no se reenvía (la V1 queda omitida)", () => {
  const c = conciliar({ libro: dia1(), portafolio: portafolio({ cola: true }), historial: [], ahora: Date.parse(`${D2}T14:50:00Z`) });
  assert.deepEqual(c.libro.pendientes.map(p => [p.estado, p.enCola]), [["aceptada", true]]);
  const g = decidirEl(c.libro, D2).decisiones.find(d => d.sym === "GLD");
  assert.deepEqual([g.accion, g.razonOmision], ["omitida", "Tiene un cierre en cola en eToro"]);
});

test("F.7 · compra incierta sin rastro: sigue 2 días hábiles y al 3.º → no_ejecutada, vuelve el efectivo (feriado no cuenta)", () => {
  const libro = libroLunes(); libro.efectivoUSD = 1000;
  libro.pendientes.push({ opId: "2026-11-24-QQQ-C1", dia: "2026-11-24", orderId: null, sym: "QQQ", instrumentId: 3006, lado: "compra", montoUSD: 4000, unidades: null, positionId: null, enviadaEl: "2026-11-24T15:05:00Z", estado: "incierta" });
  const fer = [{ date: "2026-11-26", isClosed: true }, { date: "2026-11-27", isClosed: null, isFullyClosed: false }];
  const pf = leerFix("etoro/lunes-ejecutado.json");
  for (const [dia, queda] of [["2026-11-25", 1], ["2026-11-27", 1], ["2026-11-30", 0]]) {
    const c = conciliar({ libro, portafolio: pf, historial: [], ahora: Date.parse(dia + "T14:50:00Z"), feriados: fer });
    assert.equal(c.libro.pendientes.length, queda, dia);
    assert.equal(c.libro.efectivoUSD, queda ? 1000 : 5000, dia);
    if (!queda) assert.ok(c.alertas.some(a => /^Compra de QQQ del 2026-11-24 no se ejecutó \(sin rastro en 3 días hábiles\)/.test(a)));
  }
});
