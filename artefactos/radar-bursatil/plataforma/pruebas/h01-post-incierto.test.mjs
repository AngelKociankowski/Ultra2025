// H01 · A1.1 y A7.1 portados (12b §F.1, §F.3.4): un 200 ilegible, sin orderId o con errorRed es `incierta`, nunca se reenvía;
// se confirma por la posición nueva del instrumento (fuera de `antes`, ventana de envío, monto ±1 %)
import test from "node:test";
import assert from "node:assert/strict";
import { aplicarResultados, opsNuevo } from "../lib/libro.mjs";
import { ejecutar, montar, armarYReclamar, etoroGuion, reloj, posts, sinEspera, resDe, COMPRA, F, T0 } from "./ejecucion.mjs";

const op = (t, ahora) => ({ transporteEToro: t, ahora, dormir: sinEspera });
const libroTras = (libro, dir) => aplicarResultados({ libro, opsHoy: opsNuevo(F), plan: COMPRA, res: resDe(dir), simulacion: false, ahora: Date.parse(T0) + 600000 }).libro;

test("A1.1 · 200 con el cuerpo cortado y la posición visible en la 2.ª lectura → 1 POST, ejecutada, 1 lote, efectivo −1 500", async () => {
  const { dir, libro } = montar({ plan: COMPRA }), ahora = reloj();
  const t = etoroGuion({ reloj: ahora, retrasoVisible: 2, fallas: { 1: { resp: { http: 200, texto: '{"token":"t","orderId":60' } } } });
  await armarYReclamar(dir, op(t, ahora));
  const r = await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  assert.equal(posts(t).length, 1); assert.equal(r.codigo, 0);
  const x = resDe(dir)[0];
  assert.deepEqual([x.est, x.http, x.o, x.pos, x.usdej], ["ejecutada", 200, 6001, [2800000001], 1500]);
  const L = libroTras(libro, dir);
  assert.equal(L.efectivoUSD, 3500); assert.equal(L.posiciones.find(p => p.sym === "QQQ").lotes.length, 1); assert.equal(L.pendientes.length, 0);
  assert.equal(t.pf.clientPortfolio.positions.filter(p => p.instrumentID === 3006).length, 1);
});

test("A1.1 · si no se ve en 120 s → incierta, efectivo −1 500 provisional, pend incierta, código 3", async () => {
  const { dir, libro } = montar({ plan: COMPRA }), ahora = reloj();
  const t = etoroGuion({ reloj: ahora, retrasoVisible: 1000, fallas: { 1: { resp: { http: 200, texto: '{"token":"t","orderId":60' } } } });
  await armarYReclamar(dir, op(t, ahora));
  const r = await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  assert.equal(posts(t).length, 1); assert.deepEqual([r.codigo, r.linea.accion], [3, "incompleto"]);
  const x = resDe(dir)[0];
  assert.deepEqual([x.est, x.usd], ["incierta", 1500]);
  const L = libroTras(libro, dir);
  assert.equal(L.efectivoUSD, 3500);
  assert.deepEqual(L.pendientes.map(p => [p.opId, p.estado, p.montoUSD, p.enviadaEl]), [[COMPRA[0].id, "incierta", 1500, x.env]]);
});

test("A7.1 · curl 18 con 200 y orderId → incierta en el POST, sin reenvío; la posición con ese orderID la confirma", async () => {
  const { dir } = montar({ plan: COMPRA }), ahora = reloj();
  const t = etoroGuion({ reloj: ahora, fallas: { 1: { resp: { http: 200, texto: '{"token":"t","orderId":6001}', errorRed: "curl 18" } } } });
  await armarYReclamar(dir, op(t, ahora));
  await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  assert.equal(posts(t).length, 1);
  const d = resDe(dir)[0];
  assert.deepEqual([d.est, d.o], ["ejecutada", 6001]);
});

test("H23 (F.3.4) · una posición ajena del mismo instrumento abierta en la ventana, con otro monto, no se adopta", async () => {
  const { dir } = montar({ plan: COMPRA }), ahora = reloj();
  // la posición del director (690 USD, sin orderID) aparece en el momento del envío, que no llegó a eToro
  const t = etoroGuion({ reloj: ahora, fallas: { 1: { noLlego: true, resp: { http: 503, texto: "" } } },
    antesDePost: () => t.pf.clientPortfolio.positions.push({ positionID: 2899999999, orderID: null, instrumentID: 3006, units: 1, amount: 690, openRate: 690, openDateTime: new Date(ahora.ahora()).toISOString(), isBuy: true, leverage: 1 }) });
  await armarYReclamar(dir, op(t, ahora));
  await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  assert.equal(posts(t).length, 1);
  assert.deepEqual([resDe(dir)[0].est, resDe(dir)[0].pos], ["incierta", []]);
});
