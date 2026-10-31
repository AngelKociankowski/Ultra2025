// T08 · Cliente eToro (lecturas y escrituras Demo)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as modulo from "../lib/etoro.mjs";
import { crearEToro, MODO } from "../lib/etoro.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { main as humo } from "../bin/humo-etoro.mjs";
import { RAIZ, archivosBajo, leerFix } from "./util.mjs";
import { etoroFalso } from "./etoro-falso.mjs";

const ID = "3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const ok = (o = {}) => transporteFalso(() => ({ http: 200, texto: JSON.stringify(o) }));

test("cada método produce exactamente la URL y el cuerpo de §5.7", async () => {
  const B = "https://public-api.etoro.com";
  const casos = [
    [et => et.portafolio(), "GET", B + "/api/v1/trading/info/demo/portfolio", null],
    [et => et.pnl(), "GET", B + "/api/v1/trading/info/demo/pnl", null],
    [et => et.orden(391187994), "GET", B + "/api/v1/trading/info/demo/orders/391187994", null],
    [et => et.historial("2026-10-01"), "GET", B + "/api/v1/trading/info/trade/demo/history?minDate=2026-10-01", null],
    [et => et.tasas([3000, 3026, 63]), "GET", B + "/api/v1/market-data/instruments/rates?instrumentIds=3000,3026,63", null],
    [et => et.buscar("DIA.US"), "GET", B + "/api/v1/market-data/search?internalSymbolFull=DIA.US&fields=instrumentId,internalSymbolFull,displayname,isDelisted,isCurrentlyTradable,isBuyEnabled,internalAssetClassId,currentRate", null],
    [et => et.comprar({ instrumentId: 3000, montoUSD: 20273.0999, requestId: ID }), "POST", B + "/api/v2/trading/execution/demo/orders",
      { instrumentId: 3000, transaction: "buy", orderType: "mkt", amount: 20273.09, leverage: 1 }],
    [et => et.cerrar({ positionId: 2551234567, instrumentId: 3006, unidades: null, requestId: ID }), "POST", B + "/api/v1/trading/execution/demo/market-close-orders/positions/2551234567",
      { InstrumentId: 3006, UnitsToDeduct: null }],
    [et => et.cerrar({ positionId: 7, instrumentId: 3000, unidades: 0.6619979, requestId: ID }), "POST", B + "/api/v1/trading/execution/demo/market-close-orders/positions/7",
      { InstrumentId: 3000, UnitsToDeduct: 0.661997 }],
  ];
  for (const [f, metodo, url, cuerpo] of casos) {
    const t = ok({});
    await f(crearEToro({ transporte: t, uuid: () => "00000000-0000-4000-8000-000000000000" }));
    assert.equal(t.llamadas.length, 1);
    const c = t.llamadas[0];
    assert.equal(c.metodo, metodo); assert.equal(c.url, url);
    assert.deepEqual(c.cuerpo === null ? null : JSON.parse(c.cuerpo), cuerpo);
    if (metodo === "POST") { assert.equal(c.encabezados["x-request-id"], ID); assert.equal(c.encabezados["Content-Type"], "application/json"); }
    else assert.equal(c.encabezados["x-request-id"], "00000000-0000-4000-8000-000000000000");
    assert.deepEqual(Object.keys(c.encabezados).filter(k => !["x-request-id", "Content-Type"].includes(k)), []);
  }
});

test("POST sin requestId determinista o con argumentos inválidos no sale", async () => {
  const t = ok({});
  const et = crearEToro({ transporte: t });
  await assert.rejects(() => et.comprar({ instrumentId: 3000, montoUSD: 100 }), e => e.codigo === "etoro_argumento");
  await assert.rejects(() => et.comprar({ instrumentId: 3000, montoUSD: -1, requestId: ID }), e => e.codigo === "etoro_argumento");
  await assert.rejects(() => et.cerrar({ positionId: 0, instrumentId: 3000, unidades: null, requestId: ID }), e => e.codigo === "etoro_argumento");
  await assert.rejects(() => et.orden("1/../../real"), e => e.codigo === "etoro_argumento");
  assert.equal(t.llamadas.length, 0);
});

test("toda ruta /trading/ del código contiene /demo/ y no hay ruta real", () => {
  const malos = [];
  for (const base of ["lib", "bin"]) for (const f of archivosBajo(path.join(RAIZ, base))) {
    for (const [i, l] of fs.readFileSync(f, "utf8").split("\n").entries()) {
      for (const m of l.matchAll(/\/api\/v\d\/trading\/[^"'`\s]*/g)) if (!m[0].includes("/demo/") && !/\/trading\/\)?$/.test(m[0])) malos.push(`${path.relative(RAIZ, f)}:${i + 1} ${m[0]}`);
      if (/\/real\//i.test(l)) malos.push(`${path.relative(RAIZ, f)}:${i + 1} /real/`);
    }
  }
  assert.deepEqual(malos, []);
  assert.equal(MODO, "demo");
});

test("el módulo no exporta nada que reciba una ruta", () => {
  assert.deepEqual(Object.keys(modulo).sort(), ["MODO", "crearEToro"]);
  const et = crearEToro({ transporte: ok() });
  assert.deepEqual(Object.keys(et).sort(), ["buscar", "cerrar", "comprar", "historial", "orden", "pnl", "portafolio", "tasas"]);
  assert.ok(Object.isFrozen(et));
});

test("portafolio() sobre port2.json: 5 ordersForOpen con sus orderID", async () => {
  const et = crearEToro({ transporte: etoroFalso() });
  const r = await et.portafolio();
  const ids = r.clientPortfolio.ordersForOpen.map(o => o.orderID).sort();
  assert.deepEqual(ids, [391187994, 391187995, 391187996, 391213449, 391213506]);
  assert.ok(r.clientPortfolio.ordersForOpen.every(o => o.statusID === 11 && o.orderType === 17));
  assert.equal(r.clientPortfolio.positions.length, 0);
  const o = await crearEToro({ transporte: etoroFalso({ ordenes: { 391187994: leerFix("etoro/orden-391187994.json") } }) }).orden(391187994);
  assert.equal(o.statusID, 11); assert.equal(o.units, 26.841464);
});

test("errores 401, 403, 429, 503, 400, red y proxy dan los códigos de §5.7", async () => {
  const casos = [
    [{ http: 401, texto: "" }, { codigo: "etoro_auth", http: 401 }],
    [{ http: 403, texto: "" }, { codigo: "etoro_auth", http: 403 }],
    [{ http: 429, texto: "", retryAfter: "7" }, { codigo: "etoro_ritmo", http: 429, reintentarEnMs: 7000 }],
    [{ http: 503, texto: "x" }, { codigo: "etoro_caido", reintentable: true, http: 503 }],
    [{ http: 400, texto: JSON.stringify({ errorCode: "InvalidAmount", pad: "z".repeat(400) }) }, { codigo: "etoro_rechazo", http: 400 }],
    [{ http: 0, texto: "", errorRed: "curl 28 (tiempo)" }, { codigo: "etoro_caido", reintentable: true }],
    [{ http: 0, texto: "", conectar: 403, errorRed: "curl 56" }, { codigo: "etoro_auth", http: 403 }],
    [{ http: 200, texto: "<html>" }, { codigo: "etoro_caido", reintentable: true }],
  ];
  for (const [resp, esperado] of casos) {
    const et = crearEToro({ transporte: transporteFalso(() => resp) });
    const e = await et.portafolio().then(() => null, x => x);
    for (const [k, v] of Object.entries(esperado)) assert.equal(e[k], v, `${JSON.stringify(resp).slice(0, 40)} → ${k}`);
    if (esperado.codigo === "etoro_rechazo") assert.ok(e.cuerpo.length <= 300 && e.cuerpo.startsWith('{"errorCode":"InvalidAmount"'));
  }
});

test("humo-etoro: solo GET (portafolio, pnl, tasas, buscar) y OK por fila", async () => {
  const t = etoroFalso();
  let texto = "";
  const r = await humo([], { transporte: t, escribir: s => { texto += s; } });
  assert.equal(r.codigo, 0);
  assert.equal(texto.split("\n").filter(Boolean).length, 4);
  assert.ok(texto.split("\n").filter(Boolean).every(l => / OK$/.test(l)), texto);
  assert.ok(t.llamadas.every(c => c.metodo === "GET"));
  assert.equal(t.llamadas.length, 4);
  assert.ok(t.llamadas.every(c => !c.url.includes("/execution/")));
  const src = fs.readFileSync(path.join(RAIZ, "bin/humo-etoro.mjs"), "utf8");
  assert.ok(!/\.comprar\(|\.cerrar\(/.test(src));
  // con eToro caído: FALLA por fila y código 1
  texto = "";
  const r2 = await humo([], { transporte: transporteFalso(() => ({ http: 503, texto: "" })), escribir: s => { texto += s; } });
  assert.equal(r2.codigo, 1); assert.equal((texto.match(/FALLA etoro_caido/g) || []).length, 4);
});
