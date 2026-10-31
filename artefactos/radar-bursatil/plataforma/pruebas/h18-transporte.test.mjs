// H18 · A7.6 y A7.1 portados (12b §F.8): lib/http.mjs rechaza antes del transporte lo que WHATWG y curl leerían distinto,
// compara rutas /api/ en minúsculas y entrega a curl u.href; un 200 cortado llega como errorRed (curl 18)
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { crearHttp, transporteCurl, ErrorHttp } from "../lib/http.mjs";
import { crearEToro } from "../lib/etoro.mjs";

const E = "https://public-api.etoro.com";
function conTransporte() {
  const urls = [];
  return { urls, h: crearHttp({ transporte: async q => { urls.push(q.url); return { http: 200, texto: "{}" }; } }) };
}
const bloqueada = async f => { try { await f(); return false; } catch (e) { return e instanceof ErrorHttp; } };

test("A7.6 · las 11 variantes de POST siguen bloqueadas antes del transporte; las 2 rutas exactas pasan", async () => {
  const { h, urls } = conTransporte();
  const variantes = [
    `${E}/api/v2/trading/execution/demo/orders?x=1`, `${E}/api/v2/trading/execution/demo/orders/`, `${E}/api/v2/trading/execution/demo/../orders`,
    `${E}/api/v2/trading/execution/Demo/orders`, `${E}//api/v2/trading/execution/demo/orders`, `${E}/api/v2/trading/execution/demo%2F..%2Forders`,
    `${E}/api/v1/trading/execution/demo/market-close-orders/positions/1?x`, `${E}/api/v1/trading/execution/demo/market-close-orders/positions/1/../../../../../execution/orders`,
    "https://PUBLIC-API.ETORO.COM/api/v2/trading/execution/demo/orders", "https://public-api.etoro.com:443/api/v2/trading/execution/demo/orders", `${E}/api/v2/trading/execution/demo/orders#frag`,
  ];
  for (const u of variantes) assert.ok(await bloqueada(() => h.post(u, {})), u);
  assert.equal(urls.length, 0);
  await h.post(`${E}/api/v2/trading/execution/demo/orders`, {});
  await h.post(`${E}/api/v1/trading/execution/demo/market-close-orders/positions/2600000005`, {});
  assert.deepEqual(urls, [`${E}/api/v2/trading/execution/demo/orders`, `${E}/api/v1/trading/execution/demo/market-close-orders/positions/2600000005`]);
});

test("A7.6 · GET: \\@, mayúsculas en /api/, sin /demo/, real, ../ y %2F/%5C/%40, espacios y control → ErrorHttp; el transporte recibe u.href", async () => {
  const { h, urls } = conTransporte();
  for (const u of [`${E}\\@127.0.0.1/x`, `${E}/api/v1/TRADING/info/portfolio`, `${E}/api/v1/trading/info/portfolio`, `${E}/api/v1/trading/info/real/pnl`,
    `${E}/api/v1/trading/info/demo/../portfolio`, `${E}/api/v1/market-data%2Fsearch`, `${E}/api/v1/market-data%5csearch`, `${E}/api/v1/x%40y`, `${E}/api/v1/market-data/search?a=b c`,
    `${E}/api/v1/market-data/search\n`, "https://user@public-api.etoro.com/api/v1/trading/info/demo/portfolio", "http://public-api.etoro.com/api/v1/trading/info/demo/portfolio",
    "https://127.0.0.1/api/v1/trading/info/demo/portfolio"]) assert.ok(await bloqueada(() => h.get(u)), JSON.stringify(u));
  assert.equal(urls.length, 0);
  await h.get(`${E}/api/v1/market-data/./instruments/rates?instrumentIds=3000,63`);
  await h.get("https://financialmodelingprep.com/stable/quote?symbol=%5EGSPC");
  assert.deepEqual(urls, [`${E}/api/v1/market-data/instruments/rates?instrumentIds=3000,63`, "https://financialmodelingprep.com/stable/quote?symbol=%5EGSPC"]);
});

test("A7.1 · curl contra un servidor local que corta un 200: errorRed curl 18 → la compra queda incierta, 1 intento", async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "200" }); res.write('{"token":"t","orderId":12'); setTimeout(() => res.destroy(), 50); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  try {
    const curl = transporteCurl(), local = `http://127.0.0.1:${srv.address().port}/truncado`, vistos = [];
    const r = await crearEToro({ transporte: q => { vistos.push(q.url); return curl(Object.assign({}, q, { url: local, timeoutMs: 3000 })); } })
      .comprar({ instrumentId: 3006, montoUSD: 100, requestId: "3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b" });
    assert.deepEqual([r.clase, r.http, r.motivo], ["incierta", 200, "curl 18"]);
    assert.deepEqual(vistos, [`${E}/api/v2/trading/execution/demo/orders`]);
  } finally { srv.close(); }
});
