// W8 (12c §D) · bin/radar.mjs, el Radar como herramienta de Claude, sobre una caché sembrada con los análisis que guardó la página
// el 30-oct (db-dump-1030b) y el 16-oct (db-dump-1030). Criterios 1–8 de 12c §J W8.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { main as radar, SIN_ANALISIS, PIE, AYUDA } from "../bin/radar.mjs";
import { guardarAnalisis, leerUltimo } from "../lib/cache-radar.mjs";
import { crearDbFalso, artifactDataFalso } from "./db-falso.mjs";
import { PAG, copia } from "./escenario.mjs";
import { docsPagina } from "./pagina-falsa.mjs";
import { carpetaTemporal, leerFix } from "./util.mjs";
import { transporteFalso } from "../lib/http.mjs";

const AHORA = () => Date.parse("2026-11-04T15:00:00Z");
const outDe = f => PAG.C.joinDay(leerFix(`dia-${f}/dia-${f}.json`), [0, 1, 2, 3].map(k => leerFix(`dia-${f}/dia-${f}-p${k}.json`)));
const OUT30 = outDe("2026-10-30"), OUT16 = outDe("2026-10-16");
function cacheSembrada() {
  const dir = carpetaTemporal("radar-cache-");
  guardarAnalisis({ dir, analisis: { fuente: "pagina", fecha: "2026-10-16", asOf: OUT16.asOf, antiguedad: 0, plan: OUT16.plan, parcial: true, runIdFuente: "run16", out: OUT16 }, ahora: () => Date.parse("2026-10-16T21:00:00Z") });
  guardarAnalisis({ dir, analisis: { fuente: "pagina", fecha: "2026-10-30", asOf: OUT30.asOf, antiguedad: 0, plan: OUT30.plan, parcial: false, runIdFuente: "run30", out: OUT30 }, ahora: () => Date.parse("2026-10-30T21:00:00Z") });
  return dir;
}
const CACHE = cacheSembrada();
const R = (...args) => radar(["--cache", CACHE, ...args], { ahora: AHORA, pagina: PAG });

test("(1) resumen --json: 66 rankeados, 13 Compra, 22 Mantener, 31 Evitar, régimen FAVORABLE; análisis de la página del 30-oct con 3 días hábiles", async () => {
  const r = await R("--json", "resumen");
  assert.equal(r.codigo, 0);
  const o = JSON.parse(r.texto);
  assert.deepEqual([o.conteos.rankeados, o.conteos.compra, o.conteos.mantener, o.conteos.evitar, o.regimen.estado], [66, 13, 22, 31, "FAVORABLE"]);
  assert.deepEqual([o.fuente, o.asOf, o.antiguedad, o.parcial], ["pagina", "2026-10-30", 3, false]);
  const f = JSON.parse((await R("--json", "fuente")).texto);
  assert.deepEqual(Object.keys(f), ["archivo", "fuente", "asOf", "antiguedad", "parcial", "obtenidoEl"]);
});

test("(2) top 5 --json = las 5 primeras de out.rows en ese orden; filtros por señal y clase", async () => {
  const o = JSON.parse((await R("--json", "top", "5")).texto);
  assert.deepEqual(o.filas.map(f => f.simbolo), OUT30.rows.slice(0, 5).map(r => r.symbol));
  assert.deepEqual(o.filas.map(f => f.rango), [1, 2, 3, 4, 5]);
  const c = JSON.parse((await R("--json", "top", "66", "--senal", "compra")).texto);
  assert.equal(c.filas.length, 13); assert.ok(c.filas.every(f => f.senal === "Compra"));
  assert.ok(JSON.parse((await R("--json", "top", "--clase", "etf")).texto).filas.every(f => f.clase === "etf"));
  assert.equal((await R("top", "67")).codigo, 1);
});

test("(3) simbolo SPY --json: rankeado, ref sube, contribuciones por valor absoluto; ZZZZ → código 3", async () => {
  const o = JSON.parse((await R("--json", "simbolo", "SPY")).texto), spy = OUT30.rows.find(r => r.symbol === "SPY");
  assert.deepEqual([o.estado, o.fila.ref, o.fila.pct, o.fila.precio], ["rankeado", "sube", spy.pct, spy.price]);
  // SPY trae 4 componentes en el análisis del 30-oct: salen todos (hasta 5), de mayor a menor valor absoluto
  assert.equal(o.contribuciones.length, Math.min(5, spy.components.length));
  const abs = o.contribuciones.map(c => Math.abs(c.contrib));
  assert.deepEqual(abs, abs.slice().sort((x, y) => y - x));
  assert.deepEqual(Object.keys(o.contribuciones[0]), ["codigo", "etiqueta", "bloque", "contrib"]);
  const z = await R("--json", "simbolo", "ZZZZ");
  assert.deepEqual([z.codigo, JSON.parse(z.texto).estado], [3, "ausente"]);
  const rest = OUT30.rest[0];
  if (rest) assert.deepEqual([(await R("--json", "simbolo", rest.symbol)).codigo, JSON.parse((await R("--json", "simbolo", rest.symbol)).texto).estado], [3, "no_finalista"]);
});

test("(4) portafolio --json (moderado, 600 000, fraccional): SPY 65.00, DIA 19.29, XLF 9.80, XLE 5.91, igual que C.buildPortfolio", async () => {
  const o = JSON.parse((await R("--json", "portafolio")).texto);
  assert.deepEqual([o.perfil, o.montoMXN, o.fraccional], ["moderado", 600000, true]);
  const w = Object.fromEntries(o.posiciones.map(x => [x.id, (x.peso * 100).toFixed(2)]));
  assert.deepEqual([w.SPY, w.DIA, w.XLF, w.XLE], ["65.00", "19.29", "9.80", "5.91"]);
  const p = PAG.C.buildPortfolio({ output: copia(OUT30), live: null, profile: "moderado", amountMXN: 600000, fractional: true, nowMs: AHORA(), cetesPct: null, prices: null });
  assert.deepEqual(o.posiciones.map(x => [x.id, x.peso, x.montoMXN]), p.positions.map(x => [x.id, x.weight, x.amountMXN]));
  assert.equal((await R("portafolio", "--perfil", "otro")).codigo, 1);
});

test("(5) cambios --contra 2026-10-16 --json: AAPL sale del objetivo y XLF entra", async () => {
  const o = JSON.parse((await R("--json", "cambios", "--contra", "2026-10-16")).texto);
  assert.deepEqual([o.actual.asOf, o.anterior.asOf], ["2026-10-30", "2026-10-16"]);
  assert.ok(o.objetivo.salen.includes("AAPL"), JSON.stringify(o.objetivo));
  assert.ok(o.objetivo.entran.includes("XLF"), JSON.stringify(o.objetivo));
  assert.ok(Array.isArray(o.senales) && Array.isArray(o.entranTop10));
});

test("(6)(7) caché vacía → código 2 con el texto de §D; toda salida de texto con el encabezado y el pie", async () => {
  const v = await radar(["--cache", carpetaTemporal("radar-cache-"), "resumen"], { ahora: AHORA, pagina: PAG });
  assert.deepEqual([v.codigo, v.texto], [2, SIN_ANALISIS]);
  assert.equal(SIN_ANALISIS, "Aún no hay análisis guardado: pídeme que lo obtenga.");
  for (const args of [["fuente"], ["resumen"], ["top", "3"], ["simbolo", "SPY"], ["simbolo", "ZZZZ"], ["portafolio"], ["cambios"]]) {
    const r = await R(...args), l = r.texto.split("\n");
    assert.equal(l[0], "Análisis del 30-oct-2026 · fuente: página del Radar · 3 días hábiles de antigüedad", args.join(" "));
    assert.equal(l[l.length - 1], PIE);
  }
  assert.equal(PIE, "Probabilidades del modelo, no certezas. No es asesoría financiera.");
  assert.equal((await R("--help")).texto, AYUDA);
});

test("(8) obtener --pagina con el ArtifactData falso de W2: leer → … → listo y deja la caché", async () => {
  const cache = carpetaTemporal("radar-cache-"), ad = artifactDataFalso(crearDbFalso(docsPagina()));
  const O = () => radar(["--cache", cache, "--json", "obtener", "--pagina"], { ahora: AHORA, pagina: PAG });
  let r = JSON.parse((await O()).texto), vueltas = 0;
  while (r.accion === "leer" && vueltas < 6) { vueltas++; for (const l of JSON.parse(fs.readFileSync(r.lista, "utf8")).lecturas) ad.get(l.args); r = JSON.parse((await O()).texto); }
  assert.deepEqual([r.accion, vueltas], ["listo", 3]);
  assert.ok(fs.existsSync(r.archivo));
  assert.equal(leerUltimo(cache).ultimo.asOf, "2026-10-30");
  // y desde ahí responde
  assert.equal(JSON.parse((await radar(["--cache", cache, "--json", "resumen"], { ahora: AHORA, pagina: PAG })).texto).conteos.compra, 13);
});

test("obtener --corredor: sin FMP (403 del proxy) → sin_radar con su motivo; con la página incompatible no llama a FMP", async () => {
  let n = 0;
  const proxy = transporteFalso(() => { n++; return { http: 0, conectar: 403, texto: "", errorRed: "curl 56" }; }), cache = carpetaTemporal("radar-cache-");
  const r = await radar(["--cache", cache, "--json", "obtener", "--corredor"], { ahora: AHORA, pagina: PAG, transporteFmp: proxy });
  assert.deepEqual([r.codigo, JSON.parse(r.texto).accion], [3, "sin_radar"]); assert.ok(n >= 1);
  n = 0;
  const c = await radar(["--cache", cache, "--json", "obtener", "--corredor"], { ahora: AHORA, pagina: Object.assign({}, PAG, { compatible: false }), transporteFmp: proxy });
  assert.deepEqual([c.codigo, JSON.parse(c.texto).motivo, n], [3, "pagina_cambio", 0]);
  assert.equal(leerUltimo(cache), null);
  assert.equal((await radar(["--cache", cache, "obtener"], { ahora: AHORA, pagina: PAG })).codigo, 1);
});
