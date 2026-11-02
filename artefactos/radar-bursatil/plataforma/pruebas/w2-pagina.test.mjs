// W2 (12c §C) · El análisis que guardó la página, leído a archivo con ArtifactData (falso, sobre un db falso sembrado con el volcado
// del 30-oct como documentos de la página y lunes-real-* como propios). Criterios 1–8 de 12c §J W2.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { main as radar } from "../bin/10-radar.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { guardarAnalisis, leerUltimo, MAX_ANALISIS } from "../lib/cache-radar.mjs";
import { candidatosDeIndice } from "../lib/pagina.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { artifactDataFalso } from "./db-falso.mjs";
import { abrirDia, dbInicial, PAG, copia } from "./escenario.mjs";
import { docsPagina, radarPagina } from "./pagina-falsa.mjs";
import { carpetaTemporal, leerFix } from "./util.mjs";

const PAGINA_IDS = ["indice", "dia-2026-10-30", "dia-2026-10-30-p0", "dia-2026-10-30-p1", "dia-2026-10-30-p2", "dia-2026-10-30-p3"];
const PROPIOS = { "cartera-libro": leerFix("db/lunes-real-libro-v2.json"), "rutina-estado": leerFix("db/lunes-real-estado-v2.json") };
const OUT_DUMP = () => PAG.C.joinDay(leerFix("dia-2026-10-30/dia-2026-10-30.json"), [0, 1, 2, 3].map(k => leerFix(`dia-2026-10-30/dia-2026-10-30-p${k}.json`)));

async function dia({ iso = "2026-11-04T14:47:00Z", pagina = {}, herramientas = "artifactdata,artifact,push", modo = "archivo", fallaGet = undefined, cache = null } = {}) {
  const db = dbInicial(Object.assign({}, PROPIOS, docsPagina(pagina))), t = Date.parse(iso);
  const ad = fallaGet ? artifactDataFalso(db, { fallaGet }) : null;
  const d = await abrirDia({ db, t, modo, herramientas, ad });
  assert.equal(d.preparar.codigo, 0);
  const versiones = Object.fromEntries(PAGINA_IDS.map(id => [id, db.version(id)]));
  const r = await radarPagina({ dir: d.dir, S: d.S, pagina: PAG, ahora: () => t + 60000, cache });
  return Object.assign(d, { db, r, versiones });
}

test("(1)(7) mié 4-nov: r1 indice → r2 dia-2026-10-30 → r3 sus 4 partes → listo; out = joinDay del volcado; 3 días hábiles; nada escrito", async () => {
  for (const modo of ["archivo", "en_linea"]) {
    const d = await dia({ modo });
    assert.deepEqual([d.r.codigo, d.r.linea.accion, d.r.rondas], [0, "listo", 3], modo);
    const an = leerTrabajo(d.dir, "analisis.json");
    assert.deepEqual([an.fuente, an.estado, an.fecha, an.asOf, an.antiguedad, an.llamadas.total, an.runIdFuente], ["pagina", "listo", "2026-10-30", "2026-10-30", 3, 0, leerFix("dia-2026-10-30/dia-2026-10-30.json").runId]);
    assert.deepEqual(an.out, copia(OUT_DUMP()));
    assert.equal(leerTrabajo(d.dir, "radar-resumen.json").asOf, "2026-10-30");
    const rondas = fs.readdirSync(path.join(d.dir, "entrada/pagina")).sort();
    assert.deepEqual(rondas, ["r1", "r2", "r3"]);
    assert.deepEqual(fs.readdirSync(path.join(d.dir, "entrada/pagina/r3/data/users/me")).sort(), ["dia-2026-10-30-p0.json", "dia-2026-10-30-p1.json", "dia-2026-10-30-p2.json", "dia-2026-10-30-p3.json"]);
    // (7) nada en salida/ salvo lo del paso 3 (grupo ahora); la página no cambió de versión; ningún grupo la nombra
    assert.deepEqual(fs.readdirSync(path.join(d.dir, "salida")).sort(), ["ahora"]);
    for (const id of PAGINA_IDS) assert.equal(d.db.version(id), d.versiones[id], id);
    assert.ok(d.db.escrituras.every(w => !/\/(indice|dia-|corrida|contador-)/.test(w.path)));
    // la lista que lee la sesión: args literales de §C.2
    assert.deepEqual(leerTrabajo(d.dir, "leer-pagina.json").lecturas.map(l => Object.keys(l.args)), Array(4).fill(["action", "url", "collection", "doc_id", "out_dir"]));
    // una corrida más del mismo comando no relee nada
    assert.equal((await radar(["--dir", d.dir, "--modo", "pagina"], { pagina: PAG, cache: null })).linea.accion, "listo");
  }
});

test("(2) lun 9-nov: el 30-oct tiene 6 días hábiles → sin_radar/analisis_viejo tras leer solo el índice", async () => {
  const d = await dia({ iso: "2026-11-09T14:47:00Z" });
  assert.deepEqual([d.r.codigo, d.r.linea.accion, d.r.linea.resumen.motivo, d.r.rondas], [3, "sin_radar", "analisis_viejo", 1]);
  assert.equal(leerTrabajo(d.dir, "analisis.json").fuente, "ninguna");
});

test("(3) version_dia, partes incompletas, runId ajeno, parcial e índice con entradas malas", async () => {
  const man = leerFix("dia-2026-10-30/dia-2026-10-30.json"), parte = k => leerFix(`dia-2026-10-30/dia-2026-10-30-p${k}.json`);
  assert.equal((await dia({ pagina: { "dia-2026-10-30": Object.assign({}, man, { v: 3 }) } })).r.linea.resumen.motivo, "version_dia");
  const sinRows = await dia({ pagina: { "dia-2026-10-30-p1": null } });
  assert.equal(sinRows.r.linea.resumen.motivo, "partes_incompletas");
  assert.equal((await dia({ pagina: { "dia-2026-10-30-p0": Object.assign(parte(0), { runId: "otro-run" }) } })).r.linea.resumen.motivo, "forma");
  // falta una parte de series: joinDay la tolera
  assert.equal((await dia({ pagina: { "dia-2026-10-30-p3": null } })).r.linea.accion, "listo");
  const parcial = await dia({ pagina: { "dia-2026-10-30": Object.assign({}, man, { partial: true }) } });
  assert.deepEqual([parcial.r.linea.accion, leerTrabajo(parcial.dir, "analisis.json").estado], ["parcial", "parcial"]);
  const malo = await dia({ pagina: { indice: { kind: "indice", v: 1, dias: [null, { dateET: "x" }, { dateET: "2026-10-30", parts: 4 }] } } });
  assert.equal(malo.r.linea.accion, "listo");
  assert.equal(leerTrabajo(malo.dir, "analisis.json").alertas.length, 2);
  const c = candidatosDeIndice({ kind: "indice", dias: [null, { dateET: "x" }] }, { hoy: "2026-11-04", feriados: [] });
  assert.deepEqual([c.candidatos, c.alertas.length, c.motivo], [[], 2, "sin_candidato"]);
});

test("(4) una lectura que no deja archivo cuenta como inexistente y se pasa al siguiente candidato", async () => {
  // el índice trae dos candidatos (30-oct y 29-oct); el manifiesto del 30-oct "falla" y el del 29-oct es el del 30 copiado
  const man29 = Object.assign(leerFix("dia-2026-10-30/dia-2026-10-30.json"), { dateET: "2026-10-29" });
  man29.parts = man29.parts.map((p, k) => Object.assign({}, p, { id: `dia-2026-10-29-p${k}` }));
  const extra = { indice: { kind: "indice", v: 1, dias: [{ dateET: "2026-10-30", parts: 4 }, { dateET: "2026-10-29", parts: 4 }] }, "dia-2026-10-29": man29 };
  for (let k = 0; k < 4; k++) extra[`dia-2026-10-29-p${k}`] = Object.assign(leerFix(`dia-2026-10-30/dia-2026-10-30-p${k}.json`), { dateET: "2026-10-29" });
  const d = await dia({ pagina: extra, fallaGet: id => id === "dia-2026-10-30" });
  assert.deepEqual([d.r.linea.accion, d.r.rondas], ["listo", 4]);
  assert.equal(leerTrabajo(d.dir, "analisis.json").fecha, "2026-10-29");
  // y si fallan los dos: sin_radar con el motivo del primero
  const n = await dia({ fallaGet: id => id.startsWith("dia-") });
  assert.deepEqual([n.r.linea.accion, n.r.linea.resumen.motivo], ["sin_radar", "lectura_incompleta"]);
});

test("(5) sin ArtifactData en el día → sin_radar/sin_artifactdata, 0 rondas; --herramientas desconocida → error", async () => {
  const d = await dia({ herramientas: "artifact,push" });
  assert.deepEqual([d.r.linea.accion, d.r.linea.resumen.motivo, d.r.rondas], ["sin_radar", "sin_artifactdata", 0]);
  assert.deepEqual(leerTrabajo(d.dir, "herramientas.json"), { artifactdata: false, artifact: true, push: true });
  assert.ok(!fs.existsSync(path.join(d.dir, "trabajo/leer-pagina.json")));
  assert.equal((await preparar(["--fase", "lista", "--modo", "archivo", "--herramientas", "artifactdata,otra"], { ahora: () => Date.parse("2026-11-04T14:47:00Z"), raiz: carpetaTemporal() })).codigo, 1);
});

test("(6) --modo correr: 403 del proxy en la 1.ª llamada o página incompatible → sin_radar con siguiente: pagina (0 llamadas a FMP con compat inválido)", async () => {
  const db = dbInicial(PROPIOS), t = Date.parse("2026-11-04T14:47:00Z"), d = await abrirDia({ db, t, herramientas: "artifactdata" });
  let n = 0;
  const proxy = transporteFalso(() => { n++; return { http: 0, conectar: 403, texto: "", errorRed: "curl 56" }; });
  const r = await radar(["--dir", d.dir, "--modo", "correr"], { transporteFmp: proxy, ahora: () => t, pagina: PAG, cache: null });
  assert.deepEqual([r.codigo, r.linea.accion, r.linea.siguiente], [3, "sin_radar", "pagina"]); assert.ok(n >= 1);
  n = 0;
  const c = await radar(["--dir", d.dir, "--modo", "correr"], { transporteFmp: proxy, ahora: () => t, pagina: Object.assign({}, PAG, { compatible: false }), cache: null });
  assert.deepEqual([c.linea.accion, c.linea.siguiente, n], ["sin_radar", "pagina", 0]);
});

test("(8) caché: analisis-<asOf>-pagina-<runId12>.json + ultimo.json con sha256; atómica; el 11.º borra el más viejo; sha distinto se ignora", async () => {
  const cache = carpetaTemporal("radar-cache-");
  const d = await dia({ cache });
  const run12 = leerFix("dia-2026-10-30/dia-2026-10-30.json").runId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12);
  const nombre = `analisis-2026-10-30-pagina-${run12}.json`;
  assert.deepEqual(fs.readdirSync(cache).sort(), [nombre, "ultimo.json"]);
  const ult = JSON.parse(fs.readFileSync(path.join(cache, "ultimo.json"), "utf8"));
  assert.equal(ult.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(cache, nombre))).digest("hex"));
  assert.deepEqual(leerUltimo(cache).analisis.out, leerTrabajo(d.dir, "analisis.json").out);
  // diez análisis más con asOf posteriores: queda el máximo y se borra el más viejo (el 30-oct)
  const out = OUT_DUMP();
  for (let i = 1; i <= MAX_ANALISIS; i++) guardarAnalisis({ dir: cache, analisis: { fuente: "pagina", fecha: `2026-11-${String(i).padStart(2, "0")}`, asOf: `2026-11-${String(i).padStart(2, "0")}`, antiguedad: 0, plan: "STARTER", parcial: false, runIdFuente: `run${i}`, out } });
  const archivos = fs.readdirSync(cache).filter(f => f.startsWith("analisis-"));
  assert.equal(archivos.length, MAX_ANALISIS); assert.ok(!archivos.includes(nombre));
  assert.equal(leerUltimo(cache).ultimo.asOf, "2026-11-10");
  assert.ok(!fs.readdirSync(cache).some(f => f.endsWith(".tmp")));
  // a igual asOf la corrida propia gana sobre la página
  guardarAnalisis({ dir: cache, analisis: { fuente: "rutina", fecha: "2026-11-10", asOf: "2026-11-10", antiguedad: 0, plan: "STARTER", parcial: false, runIdFuente: "r20261110", out } });
  guardarAnalisis({ dir: cache, analisis: { fuente: "pagina", fecha: "2026-11-10", asOf: "2026-11-10", antiguedad: 0, plan: "STARTER", parcial: false, runIdFuente: "otra", out } });
  assert.equal(leerUltimo(cache).ultimo.fuente, "rutina");
  // ultimo.json con un sha que no cuadra: se ignora
  const u = JSON.parse(fs.readFileSync(path.join(cache, "ultimo.json"), "utf8"));
  fs.writeFileSync(path.join(cache, "ultimo.json"), JSON.stringify(Object.assign(u, { sha256: "0".repeat(64) })));
  assert.equal(leerUltimo(cache), null);
});

test("D-R1: el índice real guardado por out_dir (forma medida) da los candidatos esperados", () => {
  const indice = leerFix("dia-2026-10-30/indice.json");
  assert.match(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/dash/indice-get-real.txt"), "utf8"), /^- "indice"  252 bytes  version 6  "/m);
  assert.deepEqual(candidatosDeIndice(indice, { hoy: "2026-11-04", feriados: [] }).candidatos, [{ fecha: "2026-10-30", parts: 4 }]);
});
