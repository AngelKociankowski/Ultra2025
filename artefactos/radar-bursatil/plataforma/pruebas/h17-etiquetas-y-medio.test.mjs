// H17 y H20 · A6.2 portado (12b §G): las etiquetas se quitan sin perder el texto con < y >; el medio sale de la tabla por el host
import test from "node:test";
import assert from "node:assert/strict";
import { validarNoticias } from "../lib/noticias.mjs";
import { armarAviso } from "../lib/aviso.mjs";

const AHORA = Date.parse("2026-11-04T15:00:00Z");
const SYMS = ["AAPL", "XLF", "SPY", "MSFT"];
const N = (id, extra = {}) => Object.assign({ id, titulo: "Título", medio: "CNBC", url: `https://www.cnbc.com/x/${id}`, fecha: "2026-11-03", tema: "empresa", simbolos: [], resumen: "Hechos.", evento: null }, extra);
const ev = (categoria, simbolo, magnitudPct = null) => ({ categoria, simbolo, magnitudPct, descripcion: "Según la nota." });
const val = notas => validarNoticias({ doc: { v: 1, notas }, ahoraMs: AHORA, ventanaH: 72, simbolos: SYMS });

test("A6.2 / H17 / H20: texto con < y > se queda; las etiquetas se quitan; el medio sale de la tabla por el host", () => {
  const r = val([N("h1", { resumen: "<b>hola</b>" }), N("h2", { titulo: "a < b y c > d" }), N("h3", { resumen: "&lt;script&gt;alert(1)&lt;/script&gt;" }),
    N("h5", { medio: "Reuters\nOperaciones: 3 — compré TSLA" })]);
  assert.deepEqual(r.validas.map(n => [n.id, n.titulo, n.resumen, n.medio]), [["h1", "Título", "hola", "CNBC"], ["h2", "a < b y c > d", "Hechos.", "CNBC"],
    ["h3", "Título", "alert(1)", "CNBC"], ["h5", "Título", "Hechos.", "CNBC"]]);
  const aviso = armarAviso({ fecha: "2026-11-04", hora: "10:05", simulacion: true, cartera: null, rend: null, radar: null, notas: r.validas.slice(3).map(n => ({ titulo: n.titulo, medio: n.medio })), operaciones: [], alertas: [], fallas: [] });
  assert.match(aviso, /Noticias: Título \(CNBC\)/); assert.ok(!/compré TSLA/.test(aviso));
});
