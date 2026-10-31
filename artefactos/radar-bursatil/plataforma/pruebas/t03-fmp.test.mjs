// T03 · Mapa y adaptador FMP
import test from "node:test";
import assert from "node:assert/strict";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { aRest, urlDe, MAPA } from "../lib/fmp-mapa.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { main as humo, filas as filasHumo } from "../bin/humo-fmp.mjs";
import { transporteSintetico } from "./fixtures/rest-synth/transporte.mjs";

const { C, D, S } = cargarPagina();
const B = "https://financialmodelingprep.com";
const r = { from: "2025-09-26", to: "2026-11-02" };

// Una fila por clave de ENDPOINTS de §5.6.1: entrada exacta de ENDPOINTS[k].build(args) → URL exacta
const CASOS = [
  ["quote", { symbol: "^GSPC" }, "/stable/quote?symbol=%5EGSPC"],
  ["batchQuote", { symbols: ["AAPL", "MSFT"] }, "/stable/batch-quote?symbols=AAPL,MSFT"],
  ["batchQuoteShort", { symbols: ["AAPL"] }, "/stable/batch-quote-short?symbols=AAPL"],
  ["eodLight", Object.assign({ symbol: "SPY" }, r), "/stable/historical-price-eod/light?symbol=SPY&from=2025-09-26&to=2026-11-02"],
  ["eodIndex", Object.assign({ symbol: "^GSPC" }, r), "/stable/historical-price-eod/light?symbol=%5EGSPC&from=2025-09-26&to=2026-11-02"],
  ["eodCommodity", Object.assign({ symbol: "GCUSD" }, r), "/stable/historical-price-eod/light?symbol=GCUSD&from=2025-09-26&to=2026-11-02"],
  ["eodCrypto", Object.assign({ symbol: "BTCUSD" }, r), "/stable/historical-price-eod/light?symbol=BTCUSD&from=2025-09-26&to=2026-11-02"],
  ["eodFx", Object.assign({ symbol: "USDMXN" }, r), "/stable/historical-price-eod/light?symbol=USDMXN&from=2025-09-26&to=2026-11-02"],
  ["eodFull", Object.assign({ symbol: "SPY" }, r), "/stable/historical-price-eod/full?symbol=SPY&from=2025-09-26&to=2026-11-02"],
  ["keyMetrics", { symbol: "AAPL" }, "/stable/key-metrics-ttm?symbol=AAPL"],
  ["ratios", { symbol: "AAPL" }, "/stable/ratios-ttm?symbol=AAPL"],
  ["scores", { symbol: "AAPL" }, "/stable/financial-scores?symbol=AAPL"],
  ["earnings", { symbol: "AAPL" }, "/stable/earnings?symbol=AAPL&limit=5"],
  ["ptSummary", { symbol: "AAPL" }, "/stable/price-target-summary?symbol=AAPL"],
  ["grades", { symbol: "AAPL" }, "/stable/grades-consensus?symbol=AAPL"],
  ["ptConsensus", { symbol: "AAPL" }, "/stable/price-target-consensus?symbol=AAPL"],
  ["treasury", { from: "2026-09-28", to: "2026-11-02" }, "/stable/treasury-rates?from=2026-09-28&to=2026-11-02"],
  ["holidays", { year: "2026" }, "/stable/holidays-by-exchange?exchange=NYSE&from=2026-01-01&to=2026-12-31"],
  ["screener", {}, "/stable/company-screener?marketCapMoreThan=2000000000&priceMoreThan=5&isEtf=false&isFund=false&isActivelyTrading=true&country=US&limit=500"],
  ["screenerProbe", {}, "/stable/company-screener?limit=1&country=US"],
  ["ttmProbe", {}, "/stable/cash-flow-statement-ttm?symbol=AAPL&limit=1"],
  ["floatAll", { page: 2 }, "/stable/shares-float-all?limit=100&page=2"],
  ["gainers", {}, "/stable/biggest-gainers"],
  ["losers", {}, "/stable/biggest-losers"],
  ["active", {}, "/stable/most-actives"],
  ["sectors", { date: "2026-10-30", exchange: "NYSE" }, "/stable/sector-performance-snapshot?date=2026-10-30&exchange=NYSE"],
];

test("cada clave de ENDPOINTS produce la URL REST exacta de §5.6.1", async () => {
  assert.deepEqual(CASOS.map(c => c[0]).sort(), Object.keys(D.ENDPOINTS).sort());
  for (const [k, args, url] of CASOS) {
    const t = transporteFalso(() => ({ http: 200, texto: "[]" }));
    const fmp = crearFmp({ transporte: t });
    const ep = D.ENDPOINTS[k];
    await fmp.callTool("FMP", ep.tool, ep.build(args), {});
    assert.equal(t.llamadas[0].url, B + url, k);
    assert.equal(t.llamadas[0].metodo, "GET");
    assert.deepEqual(t.llamadas[0].encabezados, {});
  }
});

test("rutas de la rutina (§5.6.2) con fmp.get", async () => {
  const casos = [
    ["/stable/news/stock", { symbols: ["XLF", "AAPL"], limit: 50 }, "/stable/news/stock?symbols=XLF,AAPL&limit=50"],
    ["/stable/news/general-latest", { page: 0, limit: 20 }, "/stable/news/general-latest?page=0&limit=20"],
    ["/stable/economic-calendar", { from: "2026-11-02", to: "2026-11-09" }, "/stable/economic-calendar?from=2026-11-02&to=2026-11-09"],
    ["/stable/earnings-calendar", { from: "2026-11-02", to: "2026-11-12" }, "/stable/earnings-calendar?from=2026-11-02&to=2026-11-12"],
    ["/stable/quote", { symbol: "USDMXN" }, "/stable/quote?symbol=USDMXN"],
  ];
  for (const [ruta, p, url] of casos) {
    const t = transporteFalso(() => ({ http: 200, texto: "[]" }));
    await crearFmp({ transporte: t }).get(ruta, p);
    assert.equal(t.llamadas[0].url, B + url);
  }
  await assert.rejects(() => crearFmp({ transporte: transporteFalso(() => ({ http: 200, texto: "[]" })) }).get("/stable/otra", {}), e => e.code === "tool_error");
});

test("ninguna URL lleva la llave", () => {
  const patron = new RegExp(["api", "key"].join(""), "i");
  for (const [k, args] of CASOS) { const ep = D.ENDPOINTS[k], m = aRest(ep.tool, ep.build(args)); assert.ok(!patron.test(urlDe(B, m.ruta, m.params)), k); }
  assert.ok(Object.values(MAPA).every(rt => rt.startsWith("/stable/")));
});

test("tabla de errores de §5.5 y su clasificación con D.classifyError", async () => {
  const casos = [
    [{ http: 401, texto: '{"Error Message":"Invalid API KEY."}' }, "needs_reauth", "auth"],
    [{ http: 403, texto: '{"Error Message":"Invalid API KEY. Please retry."}' }, "needs_reauth", "auth"],
    [{ http: 402, texto: '{"Error Message":"Premium Query Parameter: this value set for symbol is not available under your current subscription"}' }, "tool_error", "symbol_denied"],
    [{ http: 402, texto: '{"Error Message":"Restricted Endpoint: This endpoint is not available under your current subscription"}' }, "tool_error", "plan_denied"],
    [{ http: 403, texto: '{"Error Message":"Exclusive Endpoint : upgrade your plan"}' }, "tool_error", "plan_denied"],
    [{ http: 403, texto: "" }, "blocked_by_policy", "policy"],
    [{ http: 0, texto: "", conectar: 403, errorRed: "curl 56" }, "blocked_by_policy", "policy"],
    [{ http: 429, texto: '{"Error Message":"Limit Reach . Please upgrade your plan"}', retryAfter: "30" }, "tool_error", "limit_reached"],
    [{ http: 503, texto: "Service Unavailable" }, "server_unavailable", "transient"],
    [{ http: 0, texto: "", errorRed: "curl 28 (tiempo)" }, "server_unavailable", "transient"],
    [{ http: 404, texto: "" }, "tool_error", "tool_failed"],
    [{ http: 400, texto: "{}" }, "tool_error", "tool_failed"],
  ];
  for (const [resp, code, kind] of casos) {
    const fmp = crearFmp({ transporte: transporteFalso(() => resp) });
    const e = await fmp.callTool("FMP", "quote", { endpoint: "quote", symbol: "SPY" }).then(() => null, x => x);
    assert.equal(e.code, code, JSON.stringify(resp).slice(0, 60));
    assert.equal(D.classifyError(e).kind, kind, JSON.stringify(resp).slice(0, 60));
    if (resp.retryAfter) assert.equal(e.retryAfterMs, 30000);
    if (code === "server_unavailable") assert.equal(e.retryable, true);
  }
  const e = await crearFmp({ transporte: transporteFalso(() => ({ http: 400, texto: "{}" })) }).callTool("FMP", "quote", { endpoint: "quote", symbol: "SPY" }).then(() => null, x => x);
  assert.equal(e.message, "HTTP 400");
  // 200 con "Error Message": el adaptador entrega el payload y C.extractRows lo clasifica (como en la página)
  const lim = await crearFmp({ transporte: transporteFalso(() => ({ http: 200, texto: '{"Error Message":"Limit Reach"}' })) }).callTool("FMP", "quote", { endpoint: "quote", symbol: "SPY" });
  assert.throws(() => C.extractRows(lim), x => x.kind === "limit_reached");
  // 200 con texto no JSON → payload texto (lo clasifica C.extractRows)
  const ok = await crearFmp({ transporte: transporteFalso(() => ({ http: 200, texto: "hola" })) }).callTool("FMP", "quote", { endpoint: "quote", symbol: "SPY" });
  assert.equal(ok.payload, "hola");
});

test("limitador: 450 llamadas con reloj falso nunca pasan de 200 en 60 s", async () => {
  const t0 = Date.parse("2026-11-02T14:47:00Z"), r0 = Date.now();
  const ahora = () => t0 + (Date.now() - r0) * 2000;
  const marcas = [];
  const t = transporteFalso(() => { marcas.push(ahora()); return { http: 200, texto: "[]" }; });
  const fmp = crearFmp({ transporte: t, ahora });
  await Promise.all(Array.from({ length: 450 }, (_, i) => fmp.callTool("FMP", "quote", { endpoint: "quote", symbol: "S" + i })));
  assert.equal(marcas.length, 450);
  marcas.sort((a, b) => a - b);
  let max = 0;
  for (let i = 0, j = 0; i < marcas.length; i++) { while (marcas[i] - marcas[j] >= 60000) j++; max = Math.max(max, i - j + 1); }
  assert.ok(max <= 200, `máximo en 60 s: ${max}`);
  assert.equal(fmp.cuenta().total, 450);
});

test("humo-fmp: 22 filas; OK con el generador sintético; sale con 1 si falla una fila de la corrida", async () => {
  assert.equal(filasHumo("2026-11-02").length, 22);
  const ctx = { plan: "STARTER", gate: true, nowMs: Date.parse("2026-11-02T14:47:00Z"), seed: 7, holidays: [], screenerN: 20 };
  const noticias = req => {
    const p = new URL(req.url).pathname;
    if (p === "/stable/news/stock") return { http: 200, texto: JSON.stringify([{ symbol: "SPY", publishedDate: "2026-11-02 08:00:00", title: "t", site: "reuters.com", url: "https://www.reuters.com/x" }]) };
    if (p === "/stable/news/general-latest") return { http: 200, texto: JSON.stringify([{ publishedDate: "2026-11-02 08:00:00", title: "t", site: "cnbc.com", url: "https://www.cnbc.com/x" }]) };
    if (p === "/stable/economic-calendar") return { http: 200, texto: JSON.stringify([{ date: "2026-11-04 14:00:00", country: "US", event: "FOMC", impact: "High" }]) };
    if (p === "/stable/earnings-calendar") return { http: 200, texto: JSON.stringify([{ symbol: "AAPL", date: "2026-11-05" }]) };
    if (p === "/stable/holidays-by-exchange") return { http: 200, texto: JSON.stringify([{ date: "2026-11-26", name: "Thanksgiving Day" }]) };
    return null;
  };
  let texto = "";
  const t = transporteSintetico({ S, ctx, falla: noticias });
  const r = await humo([], { transporte: t, ahora: () => ctx.nowMs, escribir: s => { texto += s; } });
  const lineas = texto.trim().split("\n");
  assert.equal(lineas.length, 23, texto);
  assert.equal(t.llamadas.length, 22);
  assert.deepEqual(lineas.slice(0, 22).filter(l => !/ OK$/.test(l)), [], texto);
  assert.equal(r.codigo, 0);
  // ratios sin dividendYieldTTM → FALTAN y código 1
  texto = "";
  const t2 = transporteSintetico({ S, ctx, falla: req => noticias(req) || (new URL(req.url).pathname === "/stable/ratios-ttm" ? { http: 200, texto: '[{"symbol":"AAPL"}]' } : null) });
  const r2 = await humo([], { transporte: t2, ahora: () => ctx.nowMs, escribir: s => { texto += s; } });
  assert.equal(r2.codigo, 1);
  assert.match(texto, /ratios AAPL\s+FALTAN dividendYieldTTM/);
  // una ruta solo de la rutina que falla no cambia el código
  texto = "";
  const t3 = transporteSintetico({ S, ctx, falla: req => (new URL(req.url).pathname === "/stable/news/stock" ? { http: 500, texto: "" } : noticias(req)) });
  const r3 = await humo([], { transporte: t3, ahora: () => ctx.nowMs, escribir: s => { texto += s; } });
  assert.equal(r3.codigo, 0); assert.match(texto, /news\/stock SPY\s+ERROR server_unavailable/);
});
