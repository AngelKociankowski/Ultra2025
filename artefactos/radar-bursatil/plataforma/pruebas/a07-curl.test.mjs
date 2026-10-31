// B4 · a7-curl del tester (14): transporteCurl contra un servidor local (127.0.0.1, sin proxy). A7.1 y A7.6 están en h18.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { transporteCurl } from "../lib/http.mjs";
import { crearEToro } from "../lib/etoro.mjs";

const srv = http.createServer((req, res) => {
  if (req.url === "/lento") { setTimeout(() => { try { res.end("[]"); } catch (e) { /* ya cerrado */ } }, 4000); return; }
  if (req.url === "/429") { res.writeHead(429, { "Retry-After": "7" }); res.end("Limit Reach"); return; }
  if (req.url === "/marca") { res.writeHead(200); res.end('{"a":"x\n--radar-fin--999|0|"}'); return; }
  if (req.url === "/redir") { res.writeHead(307, { Location: "/otra" }); res.end(""); return; }
  res.writeHead(404); res.end();
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`, T = transporteCurl();
test.after(() => srv.close());

test("A7.2 · tiempo agotado → http 0 con errorRed de curl", async () => {
  const r = await T({ metodo: "GET", url: base + "/lento", encabezados: {}, cuerpo: null, timeoutMs: 1000 });
  assert.equal(r.http, 0); assert.match(r.errorRed, /^curl 28/);
});
test("A7.3 · 429 con Retry-After → retryAfter '7'", async () => {
  const r = await T({ metodo: "GET", url: base + "/429", encabezados: {}, cuerpo: null, timeoutMs: 3000 });
  assert.deepEqual([r.http, r.retryAfter], [429, "7"]);
});
test("A7.4 · un cuerpo que contiene la marca interna no engaña al transporte", async () => {
  const r = await T({ metodo: "GET", url: base + "/marca", encabezados: {}, cuerpo: null, timeoutMs: 3000 });
  assert.equal(r.http, 200); assert.equal(r.texto, '{"a":"x\n--radar-fin--999|0|"}');
});
test("A7.5 · 307 en un POST no se sigue y la compra queda incierta (nunca se reenvía)", async () => {
  const r = await T({ metodo: "POST", url: base + "/redir", encabezados: {}, cuerpo: "{}", timeoutMs: 3000 });
  assert.equal(r.http, 307);
  const c = await crearEToro({ transporte: q => T(Object.assign({}, q, { url: base + "/redir", timeoutMs: 3000 })) }).comprar({ instrumentId: 3006, montoUSD: 100, requestId: "3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b" });
  assert.deepEqual([c.clase, c.http], ["incierta", 307]);
});
