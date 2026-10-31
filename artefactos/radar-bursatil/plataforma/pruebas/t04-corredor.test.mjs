// T04 · Corredor del Radar (puerto de ui.js) contra el generador sintético de la página
import test from "node:test";
import assert from "node:assert/strict";
import { correrRadar } from "../lib/radar-nodo.mjs";
import { crearValidador } from "./validar-salida.mjs";
import { PAGINA, FERIADOS_2026, fmpSintetico, CTX_SINT } from "./sintetico.mjs";

const { C, D } = PAGINA;
const validOutput = crearValidador(C);

test("corrida Starter completa: listo, 626 llamadas, salida válida y partible", async () => {
  const { fmp, ahora, transporte } = fmpSintetico();
  const r = await correrRadar({ C, D, mcp: fmp, ahora, feriados: FERIADOS_2026 });
  assert.equal(r.estado, "listo"); assert.equal(r.motivo, null); assert.equal(r.tier, "STARTER");
  assert.equal(r.llamadas.total, 626);
  assert.deepEqual(r.llamadas.porCat, { sonda: 2, macro: 2, franja: 13, corrida: 609 });
  assert.equal(transporte.llamadas.length, 626);
  assert.ok(r.out.rows.length >= 50, `${r.out.rows.length} filas`);
  assert.equal(r.out.plan, "STARTER"); assert.equal(r.out.asOf, "2026-11-02");
  assert.equal(validOutput(r.out), true);
  const { manifest, parts } = C.splitDay(r.out, { dateET: "2026-11-02", runId: "drutina0001-rutina-1", dev: "drutina0001", savedAt: 1 });
  assert.deepEqual(C.joinDay(manifest, parts), r.out);
  for (const p of parts.concat([manifest])) assert.ok(C.bytesOf(p) <= 150000, `${p.kind} ${C.bytesOf(p)} B`);
  assert.ok(transporte.llamadas.every(c => c.metodo === "GET" && c.url.startsWith("https://financialmodelingprep.com/stable/")));
});

test("401 a todo → error auth con ≤ 3 llamadas", async () => {
  const { fmp, ahora, transporte } = fmpSintetico({ falla: () => ({ http: 401, texto: '{"Error Message":"Invalid API KEY."}' }) });
  const r = await correrRadar({ C, D, mcp: fmp, ahora, feriados: FERIADOS_2026 });
  assert.equal(r.estado, "error"); assert.equal(r.motivo, "auth"); assert.equal(r.out, null);
  assert.ok(transporte.llamadas.length <= 3, `${transporte.llamadas.length} llamadas`);
  assert.ok(r.llamadas.total <= 3);
});

test("429 en 6 llamadas seguidas → parcial con la nota de 'por minuto'", async () => {
  const { fmp, ahora } = fmpSintetico({ falla: (req, n) => (n >= 120 && n < 126 ? { http: 429, texto: '{"Error Message":"Limit Reach . Please upgrade your plan"}', retryAfter: "1" } : null) });
  const r = await correrRadar({ C, D, mcp: fmp, ahora, feriados: FERIADOS_2026 });
  assert.equal(r.estado, "parcial", r.motivo);
  assert.equal(r.out.partialReason, "por minuto");
  assert.ok(r.out.notes.includes("Análisis parcial: FMP limitó las consultas por minuto; se puede reanudar."), JSON.stringify(r.out.notes));
});

test("plan Free detectado → plan_no_soportado sin más llamadas; 503 seguidos → caída", async () => {
  const free = fmpSintetico({ ctx: Object.assign({}, CTX_SINT, { plan: "FREE" }) });
  const r = await correrRadar({ C, D, mcp: free.fmp, ahora: free.ahora, feriados: FERIADOS_2026 });
  assert.equal(r.estado, "error"); assert.equal(r.motivo, "plan_no_soportado:FREE");
  assert.equal(free.transporte.llamadas.length, 1);
  const caida = fmpSintetico({ falla: (req, n) => (n > 20 ? { http: 503, texto: "" } : null) });
  const r2 = await correrRadar({ C, D, mcp: caida.fmp, ahora: caida.ahora, feriados: FERIADOS_2026 });
  assert.equal(r2.estado, "error"); assert.equal(r2.out, null);
  assert.equal(r2.motivo, "down"); // 3 fallas reintentables seguidas (OUTAGE_STREAK) cortan la corrida
});
