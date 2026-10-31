// H16 · A6.3 portado (12b §G): recorte_guia con magnitud negativa confirma (Math.abs); dos URL de una misma entrada no confirman
import test from "node:test";
import assert from "node:assert/strict";
import { validarNoticias } from "../lib/noticias.mjs";

const AHORA = Date.parse("2026-11-04T15:00:00Z");
const SYMS = ["AAPL", "XLF", "SPY", "MSFT"];
const N = (id, extra = {}) => Object.assign({ id, titulo: "Título", medio: "CNBC", url: `https://www.cnbc.com/x/${id}`, fecha: "2026-11-03", tema: "empresa", simbolos: [], resumen: "Hechos.", evento: null }, extra);
const ev = (categoria, simbolo, magnitudPct = null) => ({ categoria, simbolo, magnitudPct, descripcion: "Según la nota." });
const val = notas => validarNoticias({ doc: { v: 1, notas }, ahoraMs: AHORA, ventanaH: 72, simbolos: SYMS });

test("eventos: 2 notas de la misma entrada no confirman; cnbc + finance.yahoo sí; A6.3 / H16 recorte_guia −15 % confirma", () => {
  const a = val([N("a", { evento: ev("quiebra", "AAPL") }), N("b", { url: "https://cnbc.com/y", evento: ev("quiebra", "AAPL") })]);
  assert.equal(a.eventos[0].confirmado, false);
  const b = val([N("a", { evento: ev("quiebra", "AAPL") }), N("b", { url: "https://finance.yahoo.com/z", evento: ev("quiebra", "AAPL") })]);
  assert.deepEqual(b.eventos, [{ simbolo: "AAPL", categoria: "quiebra", fuentes: ["https://www.cnbc.com/x/a", "https://finance.yahoo.com/z"], medios: ["CNBC", "Yahoo Finanzas"], confirmado: true }]);
  const c = val([N("a", { evento: ev("recorte_guia", "MSFT", -15) }), N("b", { url: "https://finance.yahoo.com/b", evento: ev("recorte_guia", "MSFT", -15) })]);
  assert.equal(c.eventos[0].confirmado, true);
  const d = val([N("a", { evento: ev("recorte_guia", "MSFT", 8) }), N("b", { url: "https://www.bloomberg.com/b", evento: ev("recorte_guia", "MSFT", null) })]);
  assert.equal(d.eventos[0].confirmado, false);
});
