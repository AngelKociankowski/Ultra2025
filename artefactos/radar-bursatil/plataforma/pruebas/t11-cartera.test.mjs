// T11 · 20-cartera
import test from "node:test";
import assert from "node:assert/strict";
import { main as cartera } from "../bin/20-cartera.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { semilla } from "../lib/libro.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { escribirTrabajo } from "../lib/archivos.mjs";
import { carpetaConDb, leerSalida, leerFix, dia30 } from "./util.mjs";
import { etoroFalso } from "./etoro-falso.mjs";

const { C } = cargarPagina();
const { out } = dia30(C);
const T = Date.parse("2026-11-02T14:50:00Z");

function preparar({ docs = {}, fallos = null, conAnalisis = true, mercadoAbierto = true } = {}) {
  const s = semilla({ ahora: () => 1 });
  const dir = carpetaConDb(Object.assign({ "cartera-libro": s.libro, "etoro-mapa": s.mapa, "cartera-serie-2026": s.serie, "operaciones-2026-10": s.ops["2026-10"],
    "rutina-config": s.config, preferencias: leerFix("dia-2026-10-30/preferencias.json") }, docs), fallos);
  escribirTrabajo(dir, "preparar.json", { fechaET: "2026-11-02", horaET: "09:50", ahora: T, mercado: { abierto: mercadoAbierto }, bloqueos: { libro: false, serie: false, ops: false },
    recuperacion: null, config: JSON.parse(JSON.stringify(CONFIG_DEFECTO)) });
  escribirTrabajo(dir, "analisis.json", conAnalisis ? { fuente: "navegador", estado: "listo", parcial: false, out } : { fuente: "ninguna", estado: "sin_radar", parcial: false, out: null });
  return { dir, s };
}
const lunes = (o = {}) => etoroFalso(Object.assign({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: leerFix("etoro/lunes-tasas.json").rates }, o));
const sinFmp = () => transporteFalso(() => { throw new Error("FMP no debe llamarse"); });

test("con fixtures de eToro y el análisis del 30-oct: cartera.json con la forma de §5.11.3", async () => {
  const { dir } = preparar();
  const t = lunes();
  const r = await cartera(["--dir", dir], { transporteEToro: t, transporteFmp: sinFmp(), ahora: () => T });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo");
  const c = leerSalida(dir, "trabajo/cartera.json");
  for (const k of ["estado", "libro", "eventos", "alertas", "valuacion", "mapa", "rendimientos", "composicion", "puntoSerie"]) assert.ok(k in c, k);
  assert.equal(c.estado, "listo");
  assert.equal(c.libro.pendientes.length, 0); assert.equal(c.libro.posiciones.flatMap(p => p.lotes).length, 5);
  assert.equal(c.valuacion.fx, 18.774); assert.equal(c.valuacion.fxFuente, "radar");
  assert.deepEqual(Object.keys(c.puntoSerie), ["f", "h", "v", "e", "fx", "spy", "fl"]);
  assert.equal(c.puntoSerie.f, "2026-11-02"); assert.equal(c.puntoSerie.spy, 758.20);
  assert.ok(Math.abs(c.rendimientos.usd.inicio - (c.valuacion.valorUSD / 31959.09 - 1)) < 1e-12);
  assert.equal(c.serie.puntos.length, 1);
  assert.ok(t.llamadas.every(x => x.metodo === "GET"));
  assert.ok(!t.llamadas.some(x => x.url.includes("/search")), "el mapa de la semilla está vigente: no se busca");
  assert.ok(!/"CID"/.test(JSON.stringify(c)));
});

test("trampa DIA: la cripto \"DIA\" se descarta y DIA.US (3026) se asigna", async () => {
  const s = semilla();
  delete s.mapa.instrumentos.DIA; delete s.mapa.rechazados.DIA;
  const { dir } = preparar({ docs: { "etoro-mapa": s.mapa } });
  const t = lunes();
  await cartera(["--dir", dir], { transporteEToro: t, transporteFmp: sinFmp(), ahora: () => T });
  const c = leerSalida(dir, "trabajo/cartera.json");
  assert.equal(c.mapa.instrumentos.DIA.instrumentId, 3026);
  assert.equal(c.mapa.instrumentos.DIA.simboloEToro, "DIA.US");
  assert.equal(c.mapa.instrumentos.DIA.verificadoEl, "2026-11-02");
  assert.equal(c.mapa.instrumentos.DIA.precioEToro, 519.00); // bid con el mercado abierto
  assert.deepEqual(c.mapa.rechazados.DIA, [{ instrumentId: 100580, motivo: "clase 10 (cripto)" }]);
  assert.ok(t.llamadas.some(x => x.url.includes("internalSymbolFull=DIA&")));
});

test("diferencia de precio de 2.5 % → rechazados, alerta y sin asignación", async () => {
  const s = semilla();
  delete s.mapa.instrumentos.XLF;
  const { dir } = preparar({ docs: { "etoro-mapa": s.mapa } });
  const rates = leerFix("etoro/lunes-tasas.json").rates.map(x => (x.instrumentID === 3004 ? Object.assign({}, x, { bid: Math.round(56.51 * 1.025 * 100) / 100 }) : x));
  await cartera(["--dir", dir], { transporteEToro: lunes({ tasas: rates }), transporteFmp: sinFmp(), ahora: () => T });
  const c = leerSalida(dir, "trabajo/cartera.json");
  assert.equal(c.mapa.instrumentos.XLF, undefined);
  assert.deepEqual(c.mapa.rechazados.XLF, [{ instrumentId: 3004, motivo: "diferencia de precio 2.50 %" }]);
  assert.ok(c.alertas.includes("XLF sin instrumento verificado en eToro"));
});

test("eToro caído → código 3, estado sin_etoro, sin excepción", async () => {
  const { dir, s } = preparar();
  const r = await cartera(["--dir", dir], { transporteEToro: transporteFalso(() => ({ http: 503, texto: "" })), transporteFmp: sinFmp(), ahora: () => T });
  assert.equal(r.codigo, 3); assert.equal(r.linea.accion, "sin_etoro");
  const c = leerSalida(dir, "trabajo/cartera.json");
  assert.equal(c.estado, "sin_etoro"); assert.equal(c.valuacion, null);
  assert.deepEqual(c.libro, s.libro);
  // cartera-libro en _fallos → sin_libro (código 3)
  const p = preparar({ fallos: { "cartera-libro": "unavailable" } });
  const r2 = await cartera(["--dir", p.dir], { transporteEToro: lunes(), transporteFmp: sinFmp(), ahora: () => T });
  assert.equal(r2.codigo, 3); assert.equal(r2.linea.accion, "sin_libro");
});

test("tipo de cambio: radar → fmp → etoro, en ese orden", async () => {
  const a = preparar();
  await cartera(["--dir", a.dir], { transporteEToro: lunes(), transporteFmp: sinFmp(), ahora: () => T });
  assert.equal(leerSalida(a.dir, "trabajo/cartera.json").valuacion.fxFuente, "radar");
  const b = preparar({ conAnalisis: false });
  const fmp = transporteFalso(() => ({ http: 200, texto: JSON.stringify([{ symbol: "USDMXN", price: 18.65, timestamp: 1 }]) }));
  await cartera(["--dir", b.dir], { transporteEToro: lunes(), transporteFmp: fmp, ahora: () => T });
  const cb = leerSalida(b.dir, "trabajo/cartera.json");
  assert.equal(cb.valuacion.fx, 18.65); assert.equal(cb.valuacion.fxFuente, "fmp"); assert.equal(cb.llamadasFmp, 1);
  assert.equal(fmp.llamadas[0].url, "https://financialmodelingprep.com/stable/quote?symbol=USDMXN");
  const c = preparar({ conAnalisis: false });
  await cartera(["--dir", c.dir], { transporteEToro: lunes(), transporteFmp: transporteFalso(() => ({ http: 403, texto: "" })), ahora: () => T });
  const cc = leerSalida(c.dir, "trabajo/cartera.json");
  assert.equal(cc.valuacion.fx, 18.71); assert.equal(cc.valuacion.fxFuente, "etoro");
});
