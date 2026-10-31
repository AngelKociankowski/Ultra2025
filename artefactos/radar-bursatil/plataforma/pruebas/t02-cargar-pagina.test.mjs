// T02 · Carga de la página y compatibilidad
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { RAIZ, carpetaTemporal } from "./util.mjs";

test("index.html del repo: compatible y con las funciones de core, data y synth", () => {
  const p = cargarPagina();
  assert.equal(p.compatible, true); assert.deepEqual(p.diferencias, []);
  assert.equal(typeof p.C.analyze, "function"); assert.equal(typeof p.D.create, "function"); assert.equal(typeof p.S.respond, "function");
  assert.equal(p.hashes.core, "ea9b20ab5828357625ffb4d1f7530402dc4eed250f17c959685e792ddf5b79c7");
  assert.equal(p.pagina, "5.5.1");
});

test("un byte cambiado en radar-ui → compatible:false, diferencias [ui]; ui nunca se evalúa", () => {
  const html = fs.readFileSync(path.join(RAIZ, "..", "index.html"), "utf8");
  const i = html.indexOf('<script id="radar-ui">\n') + '<script id="radar-ui">\n'.length + 10;
  const j = html.indexOf('<script id="radar-ui">\n') + '<script id="radar-ui">\n'.length;
  // además del byte cambiado, una sentencia que delataría la evaluación de ui
  const mod = html.slice(0, j) + "globalThis.__UI_EVALUADA__ = 1;\n" + html.slice(j, i) + (html[i] === "x" ? "y" : "x") + html.slice(i + 1);
  const dir = carpetaTemporal();
  fs.writeFileSync(path.join(dir, "index.html"), mod);
  const p = cargarPagina({ rutaIndex: path.join(dir, "index.html") });
  assert.equal(p.compatible, false); assert.deepEqual(p.diferencias, ["ui"]);
  assert.equal(globalThis.document, undefined);
  assert.equal(globalThis.RadarUI, undefined);
  assert.equal(globalThis.__UI_EVALUADA__, undefined);
  assert.equal(typeof p.C.analyze, "function");
});

test("compat.json con otro hash de core → diferencias [core]", () => {
  const dir = carpetaTemporal();
  const c = JSON.parse(fs.readFileSync(path.join(RAIZ, "compat.json"), "utf8"));
  c.sha256.core = "0".repeat(64);
  fs.writeFileSync(path.join(dir, "compat.json"), JSON.stringify(c));
  assert.deepEqual(cargarPagina({ rutaCompat: path.join(dir, "compat.json") }).diferencias, ["core"]);
});
