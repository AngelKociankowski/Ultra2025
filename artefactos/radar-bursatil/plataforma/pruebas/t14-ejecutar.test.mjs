// T14 · 50-ejecutar con transporte falso de eToro con guion (nunca sale a la red)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as ejecutar } from "../bin/50-ejecutar.mjs";
import { shaArchivo } from "../bin/40-decidir.mjs";
import { escribirTrabajo } from "../lib/archivos.mjs";
import { requestIdDe } from "../lib/reglas.mjs";
import { aplicarEjecucion, valuar } from "../lib/libro.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { libroLunes } from "./escenario.mjs";
import { carpetaConDb, leerSalida, leerFix } from "./util.mjs";

const F = "2026-11-04";
const orden = (o, i) => Object.assign({ orden: i + 1, noticias: [], requestIds: (o.cierres || [0]).map((_, k) => requestIdDe(F, o.id, k)) }, o);
const PLAN = [
  { id: `${F}-XLE-V1`, sym: "XLE", instrumentId: 3008, lado: "venta", regla: "V1", montoUSD: null, cierres: [{ positionId: 2600000005, unidades: null }], motivo: "Pasó a Evitar (44 %)" },
  { id: `${F}-SPY-R1`, sym: "SPY", instrumentId: 3000, lado: "venta", regla: "R1", montoUSD: null, cierres: [{ positionId: 2600000001, unidades: null }, { positionId: 2600000002, unidades: 2 }], motivo: "Desviación" },
  { id: `${F}-QQQ-C1`, sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 1500, cierres: null, motivo: "Entra al objetivo" },
  { id: `${F}-IWM-C1`, sym: "IWM", instrumentId: 3005, lado: "compra", regla: "C1", montoUSD: 800, cierres: null, motivo: "Entra al objetivo" },
].map(orden);

function montar({ plan = PLAN, simulacion = false, alterar = false, efectivo = null } = {}) {
  const libro = libroLunes();
  if (efectivo !== null) libro.efectivoUSD = efectivo;
  const dir = carpetaConDb({});
  escribirTrabajo(dir, "preparar.json", { fechaET: F, ahora: 1, config: { minOrdenUSD: 100 } });
  escribirTrabajo(dir, "cartera.json", { estado: "listo", libro, valuacion: valuar({ libro, tasas: leerFix("etoro/lunes-tasas.json"), fx: { valor: 18.7, fuente: "etoro" } }) });
  escribirTrabajo(dir, "plan-ordenes.json", { fecha: F, simulacion, ordenes: plan });
  const sha = shaArchivo(path.join(dir, "trabajo/plan-ordenes.json"));
  escribirTrabajo(dir, "decisiones.json", { fecha: F, simulacion, planSha: alterar ? "0".repeat(64) : sha, decisiones: [] });
  return { dir, libro };
}

// eToro con estado: los cierres quitan o reducen la posición; las compras crean una orden que se llena al instante
function etoroGuion({ fallas = {}, reloj }) {
  let n = 0;
  const pf = JSON.parse(JSON.stringify(leerFix("etoro/lunes-ejecutado.json")));
  const t = etoroFalso({ portafolio: () => pf, tasas: leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 690, ask: 690.1 }, { instrumentID: 3005, bid: 280, ask: 280.1 }]),
    historial: [{ positionId: 2600000005, closeRate: 70.5 }],
    post: (req) => {
      n++;
      const f = fallas[n]; if (f) { if (typeof f === "function") return f(); return f; }
      const c = JSON.parse(req.cuerpo), u = new URL(req.url).pathname;
      const m = u.match(/positions\/(\d+)$/);
      if (m) {
        const id = Number(m[1]), i = pf.clientPortfolio.positions.findIndex(p => p.positionID === id);
        if (c.UnitsToDeduct === null) pf.clientPortfolio.positions.splice(i, 1); else pf.clientPortfolio.positions[i].units = Math.round((pf.clientPortfolio.positions[i].units - c.UnitsToDeduct) * 1e6) / 1e6;
        return { http: 200, texto: JSON.stringify({ orderForClose: { positionID: id, instrumentID: c.InstrumentId, unitsToDeduct: c.UnitsToDeduct, orderID: 5000 + n } }) };
      }
      const px = c.instrumentId === 3006 ? 690 : 280;
      pf.clientPortfolio.positions.push({ positionID: 2800000000 + n, orderID: 6000 + n, instrumentID: c.instrumentId, units: Math.floor(c.amount / px * 1e6) / 1e6, amount: c.amount, openRate: px,
        openDateTime: new Date(reloj()).toISOString(), isBuy: true, leverage: 1 });
      return { http: 200, texto: JSON.stringify({ token: "t", orderId: 6000 + n, referenceId: "r" }) };
    } });
  t.pf = pf;
  return t;
}
const reloj = () => { let x = Date.parse("2026-11-04T15:00:00Z"); return () => (x += 1000); };
const posts = t => t.llamadas.filter(c => c.metodo === "POST");
const diario = dir => fs.readFileSync(path.join(dir, "trabajo/diario-ejecucion.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
const sinEspera = async () => {};

test("ventas antes que compras; diario con envío antes de cada POST; efectivo nunca negativo", async () => {
  const { dir, libro } = montar(), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  const r = await ejecutar(["--dir", dir], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.equal(r.codigo, 0, JSON.stringify(r.linea));
  const p = posts(t);
  assert.deepEqual(p.map(c => new URL(c.url).pathname.replace(/\d+$/, "N")), [
    "/api/v1/trading/execution/demo/market-close-orders/positions/N", "/api/v1/trading/execution/demo/market-close-orders/positions/N", "/api/v1/trading/execution/demo/market-close-orders/positions/N",
    "/api/v2/trading/execution/demo/orders", "/api/v2/trading/execution/demo/orders"]);
  assert.deepEqual(p.map(c => c.encabezados["x-request-id"]), [PLAN[0].requestIds[0], PLAN[1].requestIds[0], PLAN[1].requestIds[1], PLAN[2].requestIds[0], PLAN[3].requestIds[0]]);
  const d = diario(dir);
  assert.equal(d.length, 10);
  d.forEach((l, i) => assert.equal(l.fase, i % 2 === 0 ? "envio" : "respuesta"));
  const ej = leerSalida(dir, "trabajo/ejecucion.json");
  assert.deepEqual(ej.resultados.map(x => [x.id, x.estado]), PLAN.map(o => [o.id, "ejecutada"]));
  assert.equal(ej.resultados[0].ejecucion.precio, 70.5); // del historial
  const ops = { kind: "carteraOps", v: 1, mes: "2026-11", at: 0, ops: [] };
  const ap = aplicarEjecucion({ libro, ops, ahora: Date.parse("2026-11-04T15:10:00Z"), resultados: ej.resultados.map(x => Object.assign({}, PLAN.find(o => o.id === x.id), x)) });
  assert.ok(ap.libro.efectivoUSD >= 0, String(ap.libro.efectivoUSD));
  assert.equal(ap.libro.efectivoUSD, ej.efectivoDespuesUSD);
  assert.ok(ap.libro.posiciones.some(p => p.sym === "QQQ") && ap.libro.posiciones.some(p => p.sym === "IWM") && !ap.libro.posiciones.some(p => p.sym === "XLE"));
  assert.equal(ap.libro.posiciones.find(p => p.sym === "SPY").lotes.length, 1);
});

test("planSha distinto → 0 POST y código 3", async () => {
  const { dir } = montar({ alterar: true }), t = etoroGuion({ reloj: reloj() });
  const r = await ejecutar(["--dir", dir], { transporteEToro: t, dormir: sinEspera });
  assert.equal(r.codigo, 3); assert.equal(r.linea.resumen.codigo, "plan_alterado");
  assert.equal(t.llamadas.length, 0);
});

test("503 en una compra: busca en portafolio, nada → un reintento con el mismo x-request-id; si vuelve a fallar → desconocida (nunca 3 POST)", async () => {
  const plan = [PLAN[2]];
  const { dir } = montar({ plan, efectivo: 5000 }), ahora = reloj(), t = etoroGuion({ reloj: ahora, fallas: { 1: { http: 503, texto: "" }, 2: { http: 503, texto: "" }, 3: { http: 200, texto: "{}" } } });
  const r = await ejecutar(["--dir", dir], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.equal(r.codigo, 3);
  const p = posts(t);
  assert.equal(p.length, 2);
  assert.equal(p[0].encabezados["x-request-id"], p[1].encabezados["x-request-id"]);
  const iP = t.llamadas.indexOf(p[0]), iP2 = t.llamadas.indexOf(p[1]);
  assert.ok(t.llamadas.slice(iP + 1, iP2).some(c => c.url.endsWith("/demo/portfolio")), "mira el portafolio antes de reintentar");
  assert.equal(leerSalida(dir, "trabajo/ejecucion.json").resultados[0].estado, "desconocida");
  // si al mirar ya hay una orden nueva de ese instrumento, se adopta sin reintentar
  const b = montar({ plan, efectivo: 5000 }), ah2 = reloj();
  const t2 = etoroGuion({ reloj: ah2, fallas: { 1: () => { t2.pf.clientPortfolio.ordersForOpen.push({ instrumentID: 3006, orderID: 7777, amount: 1500, openDateTime: new Date(ah2()).toISOString(), statusID: 11 }); return { http: 503, texto: "" }; } } });
  await ejecutar(["--dir", b.dir], { transporteEToro: t2, ahora: ah2, dormir: sinEspera });
  assert.equal(posts(t2).length, 1);
  const r2 = leerSalida(b.dir, "trabajo/ejecucion.json").resultados[0];
  assert.equal(r2.estado, "pendiente"); assert.equal(r2.orderId, 7777);
});

test("400 → rechazada sin reintento; 401 a mitad → no envía nada más", async () => {
  const a = montar({ plan: [PLAN[2], PLAN[3]], efectivo: 5000 }), t = etoroGuion({ reloj: reloj(), fallas: { 1: { http: 400, texto: '{"errorCode":"InsufficientFunds"}' } } });
  await ejecutar(["--dir", a.dir], { transporteEToro: t, dormir: sinEspera });
  assert.equal(posts(t).length, 2);
  assert.deepEqual(leerSalida(a.dir, "trabajo/ejecucion.json").resultados.map(x => x.estado), ["rechazada", "ejecutada"]);
  const b = montar(), t2 = etoroGuion({ reloj: reloj(), fallas: { 2: { http: 401, texto: "" } } });
  const r = await ejecutar(["--dir", b.dir], { transporteEToro: t2, dormir: sinEspera });
  assert.equal(r.codigo, 3);
  assert.equal(posts(t2).length, 2);
  assert.deepEqual(leerSalida(b.dir, "trabajo/ejecucion.json").resultados.map(x => x.estado), ["ejecutada", "rechazada", "cancelada", "cancelada"]);
});

test("--reanudar tras cortar después del 2.º POST: los 2 primeros no se reenvían (se adoptan desde portafolio)", async () => {
  // el corte llega justo después del 2.º POST, antes de anotar su respuesta (como un proceso que muere)
  const { dir } = montar(), base = reloj();
  let cortar = false;
  const ahora = () => { if (cortar) throw new Error("proceso cortado"); return base(); };
  const t = etoroGuion({ reloj: base });
  let postsHechos = 0;
  const cortado = async req => { const r = await t(req); if (req.metodo === "POST" && ++postsHechos === 2) cortar = true; return r; };
  await assert.rejects(() => ejecutar(["--dir", dir], { transporteEToro: cortado, ahora, dormir: sinEspera }), /proceso cortado/);
  cortar = false;
  assert.equal(posts(t).length, 2);
  const antes = posts(t).length;
  const r = await ejecutar(["--dir", dir, "--reanudar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.equal(r.codigo, 0, JSON.stringify(r.linea));
  const nuevos = posts(t).slice(antes);
  assert.deepEqual(nuevos.map(c => c.encabezados["x-request-id"]), [PLAN[1].requestIds[1], PLAN[2].requestIds[0], PLAN[3].requestIds[0]]);
  assert.deepEqual(leerSalida(dir, "trabajo/ejecucion.json").resultados.map(x => x.estado), ["ejecutada", "ejecutada", "ejecutada", "ejecutada"]);
});

test("simulación → 0 POST y resultados simulada", async () => {
  const { dir } = montar({ simulacion: true }), t = etoroGuion({ reloj: reloj() });
  const r = await ejecutar(["--dir", dir], { transporteEToro: t, dormir: sinEspera });
  assert.equal(r.codigo, 0); assert.equal(t.llamadas.length, 0);
  assert.ok(leerSalida(dir, "trabajo/ejecucion.json").resultados.every(x => x.estado === "simulada"));
});
