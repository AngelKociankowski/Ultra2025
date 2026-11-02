// W5 (12c §F.3) · La página del dashboard "Cartera Radar" (reporte/index.html) cumple las reglas del tipo Dashboard (SKILL.md,
// one-writer.md, design-defaults.md): se lee el archivo, sin dependencias.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./util.mjs";
import { DATASETS } from "../lib/reporte.mjs";

const HTML = fs.readFileSync(path.join(RAIZ, "reporte/index.html"), "utf8");
const SCRIPTS = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const MARCADO = HTML.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
const ETIQUETAS = [...MARCADO.matchAll(/<([a-z][a-z0-9]*)(\s[^>]*)?>/g)].map(m => ({ tag: m[1], attrs: Object.fromEntries([...(m[2] || "").matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map(a => [a[1], a[2] ?? ""])), i: m.index }));
const COLUMNAS = Object.fromEntries(DATASETS.map(d => [d.id, d.columnas.map(c => c.nombre)]));
// tokens del tipo: los de SKILL.md y los --cds-* que nombra design-defaults.md (las familias gap/pad/font-size con sus sufijos)
const TOKENS = new Set(["--color-fg", "--color-fg-muted", "--color-bg", "--color-panel", "--color-border-line", "--color-ok", "--color-warn", "--color-bad", "--font-anthropic-sans",
  "--font-anthropic-serif", "--dash-gutter", "--cds-radius", "--cds-font-weight-medium", "--cds-chart-muted", "--cds-chart-status-critical", "--cds-chart-grid", "--cds-chart-axis",
  "--cds-chart-reference", "--cds-surface-popover", "--cds-border", "--cds-shadow-popover", "--cds-text-secondary", "--cds-dur-slow", "--cds-ease-out",
  ...["xs", "sm", "md", "lg", "xl"].flatMap(s => [`--cds-gap-${s}`, `--cds-pad-${s}`]), ...["caption", "body", "heading", "title"].map(s => `--cds-font-size-${s}`)]);

test("(1)(2) abre con dash-one-writer, pesa < 100 KB y no usa red, módulos, almacenamiento ni HTML desde datos", () => {
  assert.ok(HTML.startsWith('<meta name="dash-one-writer">'));
  assert.ok(Buffer.byteLength(HTML) < 100 * 1024, `${Buffer.byteLength(HTML)} B`);
  for (const p of ["<script src", "<link", "<iframe", "<form", "<base", "innerHTML", "outerHTML", "insertAdjacentHTML", ".html(", "fetch(", "XMLHttpRequest", "WebSocket", "localStorage",
    "sessionStorage", "document.cookie", "import ", "eval(", "new Function"]) assert.ok(!HTML.includes(p), p);
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(MARCADO), "atributos on…=");
  assert.ok(/\bd3\./.test(SCRIPTS) && !/require\(/.test(SCRIPTS));
});

test("(3)(7) cada data-source es un dataset, cada data-field una columna suya, cada tabla con data-row-key = clave; se usan los 9", () => {
  const usados = new Set();
  let tabla = null;
  for (const e of ETIQUETAS) {
    if (e.tag === "table") tabla = e.attrs["data-source"] || null;
    const src = e.attrs["data-source"];
    if (src !== undefined) { for (const s of src.split(" ")) { assert.ok(COLUMNAS[s], `data-source desconocido: ${s}`); usados.add(s); } }
    if (e.attrs["data-field"] !== undefined) {
      const s = src || (e.tag === "th" ? tabla : null);
      assert.ok(s && COLUMNAS[s].includes(e.attrs["data-field"]), `${e.tag} data-field=${e.attrs["data-field"]} en ${s}`);
    }
    if (e.tag === "table" && src) assert.equal(e.attrs["data-row-key"], DATASETS.find(d => d.id === src).clave, src);
  }
  assert.deepEqual([...usados].sort(), DATASETS.map(d => d.id).sort());
});

test("(4) cada data-draw se guarda vacío o con —, y cada dash.draw('…') tiene su data-draw y al revés", () => {
  const enHtml = new Set();
  for (const m of MARCADO.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-draw="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) { enHtml.add(m[2]); assert.ok(["", "—"].includes(m[3]), `${m[2]}: «${m[3]}»`); }
  const enScript = new Set([...SCRIPTS.matchAll(/dash\.draw\(\s*["']([^"']+)["']\s*,/g)].map(m => m[1]));
  assert.deepEqual([...enHtml].sort(), [...enScript].sort());
});

test("(5)(6) ningún dígito en el texto fuera de <script>/<style>; cada var(--…) es un token del tipo", () => {
  const texto = MARCADO.replace(/<[^>]*>/g, " ");
  assert.equal((texto.match(/\d/g) || []).length, 0, texto.match(/.{0,30}\d.{0,30}/));
  for (const m of HTML.matchAll(/var\((--[a-z0-9-]+)\)/g)) assert.ok(TOKENS.has(m[1]), m[1]);
  // las referencias fijas del dueño son constantes de un script, dibujadas
  assert.match(SCRIPTS, /const META = 0\.15, BASE = 100;/);
});

test("(8) las secciones de 12c §F.3, en orden, cada una con su id", () => {
  const ids = ["cr-cabecera", "cr-cifras", "cr-evolucion", "cr-posiciones", "cr-composicion", "cr-radar", "cr-decisiones", "cr-operaciones", "cr-noticias", "cr-alertas"];
  const pos = ids.map(id => MARCADO.indexOf(`<section id="${id}"`));
  assert.ok(pos.every(p => p >= 0), JSON.stringify(pos));
  assert.deepEqual(pos.slice().sort((a, b) => a - b), pos);
  assert.equal((MARCADO.match(/<h1>Cartera Radar<\/h1>/g) || []).length, 1);
  assert.equal((MARCADO.match(/class="cr-cifra/g) || []).length, 6);
});
