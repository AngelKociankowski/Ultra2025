// T11 / K5 · 20-cartera con documentos v2: conciliación, valuación, punto, refs, mapa y tipo de cambio
import test from "node:test";
import assert from "node:assert/strict";
import { main as cartera } from "../bin/20-cartera.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { conH } from "../lib/db.mjs";
import { validarDoc } from "../lib/esquemas.mjs";
import { semilla } from "../lib/libro.mjs";
import { leerSalida, leerFix } from "./util.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { abrirDia, ponerAnalisis, dbInicial, tasasA, PAG, OUT30, LUNES, copia } from "./escenario.mjs";

const lunesEt = (o = {}) => etoroFalso(Object.assign({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, LUNES) }, o));
const sinFmp = () => transporteFalso(() => { throw new Error("FMP no debe llamarse"); });
async function dia({ db = dbInicial(), out = OUT30, sinRadar = false, etoro = lunesEt(), fmp = sinFmp() } = {}) {
  const d = await abrirDia({ db, t: LUNES });
  ponerAnalisis(d.dir, { out, sinRadar });
  const r = await cartera(["--dir", d.dir], { transporteEToro: etoro, transporteFmp: fmp, ahora: () => LUNES + 60000, pagina: PAG });
  return { r, c: leerSalida(d.dir, "trabajo/cartera.json"), dir: d.dir, etoro };
}

test("lunes-ejecutado + análisis del 30-oct: 5 lotes, ops-2026-10-30 en ejecutada, punto y rendimientos por refs", async () => {
  const { r, c, etoro } = await dia();
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo"); assert.equal(r.linea.modo, "en_linea");
  assert.equal(c.libro.pendientes.length, 0); assert.equal(c.libro.posiciones.flatMap(p => p.lotes).length, 5);
  assert.deepEqual(Object.keys(c.ops), ["2026-10-30"]);
  assert.ok(c.ops["2026-10-30"].ops.every(o => o.est === "ejecutada"));
  assert.deepEqual(validarDoc("ops-2026-10-30", conH(c.ops["2026-10-30"])), []);
  assert.deepEqual(validarDoc("punto-2026-11-02", conH(c.punto)), []);
  assert.equal(c.punto.v_, 32010.04); assert.equal(c.punto.fx, 18.774); assert.equal(c.punto.spy, 758.2);
  assert.ok(Math.abs(c.punto.i - 32010.04 / 31959.09) < 1e-8);
  assert.ok(Math.abs(c.rendimientos.usd[4] - (32010.04 / 31959.09 - 1)) < 1e-7);
  assert.ok(Math.abs(c.rendimientos.spy[0] - (758.2 / 755.26 - 1)) < 1e-9);
  assert.deepEqual(c.libro.precios.SPY, [758.2, "2026-11-02"]);
  assert.equal(c.valuacion.fxFuente, "radar"); assert.equal(c.mapaCambio, false);
  assert.ok(etoro.llamadas.every(x => x.metodo === "GET"));
  assert.ok(!/"CID"|10000001/.test(JSON.stringify(c)));
});

test("trampa DIA: sin DIA en el mapa, la cripto se descarta y DIA.US (3026) se asigna; el mapa cambia", async () => {
  const s = semilla(); delete s["etoro-mapa"].i.DIA; delete s["etoro-mapa"].rech.DIA;
  const { c } = await dia({ db: dbInicial({ "etoro-mapa": s["etoro-mapa"] }) });
  assert.equal(c.mapa.instrumentos.DIA.instrumentId, 3026); assert.equal(c.mapa.instrumentos.DIA.verificadoEl, "2026-11-02");
  assert.deepEqual(c.mapa.rechazados.DIA, [{ instrumentId: 100580, motivo: "clase 10 (cripto)" }]);
  assert.equal(c.mapaCambio, true);
});

test("diferencia de precio de 2.5 % → rechazados, alerta y sin asignación", async () => {
  const s = semilla(); delete s["etoro-mapa"].i.XLF;
  const rates = tasasA(leerFix("etoro/lunes-tasas.json").rates, LUNES).map(x => (x.instrumentID === 3004 ? Object.assign({}, x, { bid: Math.round(56.51 * 1.025 * 100) / 100 }) : x));
  const { c } = await dia({ db: dbInicial({ "etoro-mapa": s["etoro-mapa"] }), etoro: lunesEt({ tasas: rates }) });
  assert.equal(c.mapa.instrumentos.XLF, undefined);
  assert.deepEqual(c.mapa.rechazados.XLF, [{ instrumentId: 3004, motivo: "diferencia de precio 2.50 %" }]);
  assert.ok(c.alertas.includes("XLF sin instrumento verificado en eToro"));
});

test("eToro caído → código 3, sin_etoro, sin excepción", async () => {
  const { r, c } = await dia({ etoro: transporteFalso(() => ({ http: 503, texto: "" })) });
  assert.equal(r.codigo, 3); assert.equal(r.linea.accion, "sin_etoro"); assert.equal(c.valuacion, null);
});

test("tipo de cambio: radar → fmp → eToro; y si Radar y eToro difieren > 2 %, eToro con alerta (N6)", async () => {
  const fmp = transporteFalso(() => ({ http: 200, texto: JSON.stringify([{ symbol: "USDMXN", price: 18.65 }]) }));
  const b = await dia({ sinRadar: true, fmp });
  assert.deepEqual([b.c.valuacion.fx, b.c.valuacion.fxFuente, b.c.llamadasFmp], [18.65, "fmp", 1]);
  const c = await dia({ sinRadar: true, fmp: transporteFalso(() => ({ http: 0, conectar: 403, texto: "" })) });
  assert.deepEqual([c.c.valuacion.fx, c.c.valuacion.fxFuente], [18.71, "etoro"]);
  const out = copia(OUT30); out.rows.find(x => x.symbol === "USDMXN").price = 18.70;
  const rates = tasasA(leerFix("etoro/lunes-tasas.json").rates, LUNES).map(x => (x.instrumentID === 63 ? Object.assign({}, x, { bid: 19.19, ask: 19.21 }) : x));
  const d = await dia({ out, etoro: lunesEt({ tasas: rates }) });
  assert.deepEqual([d.c.valuacion.fx, d.c.valuacion.fxFuente], [19.2, "etoro"]);
  assert.ok(d.c.alertas.some(x => /difieren más de 2 %/.test(x)));
});
