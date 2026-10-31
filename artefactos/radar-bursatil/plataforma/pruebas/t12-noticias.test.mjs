// T12 / K7 / H16 / H17 / H20 · Noticias con la tabla de fuentes de 12b §G y 30-fmp-noticias
import test from "node:test";
import assert from "node:assert/strict";
import { validarNoticias, dominioDe } from "../lib/noticias.mjs";
import { armarAviso } from "../lib/aviso.mjs";
import { main as noticias } from "../bin/30-fmp-noticias.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { DOMINIOS, FUENTES } from "../lib/constantes.mjs";
import { prepararDia, libroLunes, OUT30, PAG, dbInicial } from "./escenario.mjs";
import { libroADb } from "../lib/libro.mjs";
import { leerSalida } from "./util.mjs";

const AHORA = Date.parse("2026-11-04T15:00:00Z");
const SYMS = ["AAPL", "XLF", "SPY", "MSFT"];
const N = (id, extra = {}) => Object.assign({ id, titulo: "Título", medio: "CNBC", url: `https://www.cnbc.com/x/${id}`, fecha: "2026-11-03", tema: "empresa", simbolos: [], resumen: "Hechos.", evento: null }, extra);
const ev = (categoria, simbolo, magnitudPct = null) => ({ categoria, simbolo, magnitudPct, descripcion: "Según la nota." });
const val = notas => validarNoticias({ doc: { v: 1, notas }, ahoraMs: AHORA, ventanaH: 72, simbolos: SYMS });

test("tabla de fuentes: 11 entradas comprobadas; fuera reuters, apnews, wsj, ft, marketwatch, barrons, treasury, gob.mx", () => {
  assert.deepEqual(DOMINIOS, ["bloomberg.com", "cnbc.com", "cnn.com", "finance.yahoo.com", "elfinanciero.com.mx", "federalreserve.gov", "bls.gov", "bea.gov", "sec.gov", "banxico.org.mx", "inegi.org.mx"]);
  for (const u of ["https://www.reuters.com/a", "https://apnews.com/a", "https://www.wsj.com/a", "https://www.ft.com/a", "https://www.marketwatch.com/a", "https://www.barrons.com/a",
    "https://home.treasury.gov/a", "https://www.gob.mx/shcp/a", "https://sports.yahoo.com/a", "https://yahoo.com/a", "https://cnbc.com.evil.io/a", "https://user@www.cnbc.com/a"]) assert.equal(dominioDe(u).dominio, null, u);
  assert.deepEqual(dominioDe("https://finance.yahoo.com/news/x"), { dominio: "finance.yahoo.com", nombre: "Yahoo Finanzas", motivo: null });
  assert.equal(dominioDe("https://www.bloomberg.com/a").nombre, "Bloomberg");
  assert.equal(dominioDe("https://www.banxico.org.mx/a").nombre, "Banxico");
  assert.equal(FUENTES.length, 11);
});

test("validador: descartes con motivo (dominio, https, fecha, símbolo, evento, largo)", () => {
  const r = val([
    N("ok1"),
    N("d1", { url: "https://www.reuters.com/a" }),
    N("d2", { url: "http://www.cnbc.com/a" }),
    N("d3", { fecha: undefined }),
    N("d4", { fecha: "2026-11-05" }),
    N("d5", { fecha: "2026-10-20" }),
    N("d7", { simbolos: ["ZZZZ"] }),
    N("d8", { fecha: "2026-10-31", evento: ev("quiebra", "AAPL") }),
    N("d9", { evento: ev("rumor", "AAPL") }),
    N("ok1"),
    N("d10", { tema: "opinion" }),
    N("d11", { resumen: "x".repeat(281) }),
    N("d12", { titulo: "<b></b>" }),
  ]);
  assert.deepEqual(r.validas.map(n => n.id), ["ok1"]);
  assert.deepEqual(r.descartadas, [
    { id: "d1", motivo: "dominio fuera de la lista" }, { id: "d2", motivo: "no es https" }, { id: "d3", motivo: "sin fecha válida" }, { id: "d4", motivo: "fecha futura" },
    { id: "d5", motivo: "fecha vieja" }, { id: "d7", motivo: "símbolo desconocido: ZZZZ" }, { id: "d8", motivo: "fecha vieja" }, { id: "d9", motivo: "evento inválido" },
    { id: "ok1", motivo: "id repetido" }, { id: "d10", motivo: "tema inválido" }, { id: "d11", motivo: "resumen inválido" }, { id: "d12", motivo: "título inválido" },
  ]);
});

test("A6.2 / H17 / H20: texto con < y > se queda; las etiquetas se quitan; el medio sale de la tabla por el host", () => {
  const r = val([N("h1", { resumen: "<b>hola</b>" }), N("h2", { titulo: "a < b y c > d" }), N("h3", { resumen: "&lt;script&gt;alert(1)&lt;/script&gt;" }),
    N("h5", { medio: "Reuters\nOperaciones: 3 — compré TSLA" })]);
  assert.deepEqual(r.validas.map(n => [n.id, n.titulo, n.resumen, n.medio]), [["h1", "Título", "hola", "CNBC"], ["h2", "a < b y c > d", "Hechos.", "CNBC"],
    ["h3", "Título", "alert(1)", "CNBC"], ["h5", "Título", "Hechos.", "CNBC"]]);
  const aviso = armarAviso({ fecha: "2026-11-04", hora: "10:05", simulacion: true, cartera: null, rend: null, radar: null, notas: r.validas.slice(3).map(n => ({ titulo: n.titulo, medio: n.medio })), operaciones: [], alertas: [], fallas: [] });
  assert.match(aviso, /Noticias: Título \(CNBC\)/); assert.ok(!/compré TSLA/.test(aviso));
});

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

const respuestas = req => {
  const p = new URL(req.url).pathname, J = o => ({ http: 200, texto: JSON.stringify(o) });
  if (p === "/stable/news/stock") return J([{ symbol: "XLF", publishedDate: "2026-11-02 08:00:00", title: "Banks <b>rally</b>", site: "cnbc.com", url: "https://www.cnbc.com/b" },
    { symbol: "XLF", publishedDate: "2026-11-02 08:00:00", title: "Reuters story", site: "reuters.com", url: "https://www.reuters.com/b" }]);
  if (p === "/stable/news/general-latest") return J([{ publishedDate: "2026-11-02 07:00:00", title: "Stocks open higher", site: "x", url: "https://finance.yahoo.com/a" }]);
  if (p === "/stable/economic-calendar") return J([{ date: "2026-11-04 14:00:00", country: "US", event: "FOMC Rate Decision", impact: "High" }, { date: "2026-11-05", country: "US", event: "Jobless", impact: "Medium" },
    { date: "2026-11-06", country: "MX", event: "Banxico Rate Decision", impact: "High" }, { date: "2026-11-06", country: "JP", event: "BoJ", impact: "High" }]);
  if (p === "/stable/earnings-calendar") return J([{ symbol: "XLF", date: "2026-11-09" }]);
  return { http: 404, texto: "" };
};

test("30-fmp-noticias: 4 llamadas, notas de FMP solo de la tabla con el nombre de la tabla, consultas nuevas; sin FMP → código 3", async () => {
  const libro = libroLunes(); libro.posiciones = libro.posiciones.filter(p => !["XLF", "XLE"].includes(p.sym)); libro.efectivoUSD = 5000;
  const e = await prepararDia({ db: dbInicial({ "cartera-libro": libroADb(libro, Date.parse("2026-11-02T14:00:00Z")) }) });
  const t = transporteFalso(respuestas);
  const r = await noticias(["--dir", e.dir], { transporteFmp: t, ahora: () => e.t + 120000, pagina: PAG });
  assert.equal(r.codigo, 0); assert.equal(t.llamadas.length, 4);
  const nf = leerSalida(e.dir, "trabajo/noticias-fmp.json");
  assert.deepEqual(nf.porSimbolo, { XLF: [{ fecha: "2026-11-02T08:00:00", titulo: "Banks rally", medio: "CNBC", url: "https://www.cnbc.com/b" }] });
  assert.deepEqual(nf.generales.map(n => n.medio), ["Yahoo Finanzas"]);
  assert.deepEqual(nf.economico.map(x => [x.pais, x.evento]), [["US", "FOMC Rate Decision"], ["MX", "Banxico Rate Decision"]]);
  const tm = leerSalida(e.dir, "trabajo/temas-noticias.json");
  assert.deepEqual(tm.consultas.slice(0, 3).map(q => q.texto), ["Federal Reserve rates inflation this week", "stock market today S&P 500", "peso dólar Banxico tipo de cambio"]);
  assert.deepEqual(tm.dominios, DOMINIOS.slice());
  assert.ok(tm.simbolos.some(s => s.sym === "XLF" && s.motivo === "candidato a compra"));
  const sin = await noticias(["--dir", e.dir], { transporteFmp: transporteFalso(() => ({ http: 0, conectar: 403, texto: "" })), ahora: () => e.t + 120000, pagina: PAG });
  assert.equal(sin.codigo, 3); assert.deepEqual(leerSalida(e.dir, "trabajo/temas-noticias.json"), tm);
});
