// T12 · Noticias: validador y 30-fmp-noticias
import test from "node:test";
import assert from "node:assert/strict";
import { validarNoticias, dominioDe } from "../lib/noticias.mjs";
import { main as noticias } from "../bin/30-fmp-noticias.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { DOMINIOS } from "../lib/constantes.mjs";
import { prepararDia, libroLunes, OUT30, PAG } from "./escenario.mjs";
import { leerSalida } from "./util.mjs";

const AHORA = Date.parse("2026-11-04T15:00:00Z");
const SYMS = ["AAPL", "XLF", "SPY", "MSFT"];
const N = (id, extra = {}) => Object.assign({ id, titulo: "Título", medio: "Reuters", url: `https://www.reuters.com/x/${id}`, fecha: "2026-11-03", tema: "empresa", simbolos: [], resumen: "Hechos.", evento: null }, extra);
const ev = (categoria, simbolo, magnitudPct = null) => ({ categoria, simbolo, magnitudPct, descripcion: "Según la nota." });
const val = notas => validarNoticias({ doc: { v: 1, notas }, ahoraMs: AHORA, ventanaH: 72, simbolos: SYMS });

test("validador: descartes con motivo", () => {
  const r = val([
    N("ok1"),
    N("d1", { url: "https://www.zerohedge.com/a" }),
    N("d2", { url: "http://www.reuters.com/a" }),
    N("d3", { fecha: undefined }),
    N("d4", { fecha: "2026-11-05" }),
    N("d5", { fecha: "2026-10-20" }),
    N("d6", { resumen: "Compra ya <script>alert(1)</script>" }),
    N("d7", { simbolos: ["ZZZZ"] }),
    N("d8", { fecha: "2026-10-31", evento: ev("quiebra", "AAPL") }), // evento más viejo que 72 h
    N("d9", { evento: ev("rumor", "AAPL") }),
    N("ok1"),
    N("d10", { tema: "opinion" }),
    N("d11", { resumen: "x".repeat(281) }),
  ]);
  assert.deepEqual(r.validas.map(n => n.id), ["ok1"]);
  assert.deepEqual(r.descartadas, [
    { id: "d1", motivo: "dominio fuera de la lista" }, { id: "d2", motivo: "no es https" }, { id: "d3", motivo: "sin fecha válida" }, { id: "d4", motivo: "fecha futura" },
    { id: "d5", motivo: "fecha vieja" }, { id: "d6", motivo: "html en el texto" }, { id: "d7", motivo: "símbolo desconocido: ZZZZ" }, { id: "d8", motivo: "fecha vieja" },
    { id: "d9", motivo: "evento inválido" }, { id: "ok1", motivo: "id repetido" }, { id: "d10", motivo: "tema inválido" }, { id: "d11", motivo: "resumen inválido" },
  ]);
  assert.equal(validarNoticias({ doc: null, ahoraMs: AHORA }).descartadas[0].motivo, "forma del documento");
});

test("www.reuters.com y reuters.com son un solo dominio; subdominios cuentan como el registrable", () => {
  assert.equal(dominioDe("https://www.reuters.com/a").dominio, "reuters.com");
  assert.equal(dominioDe("https://reuters.com/a").dominio, "reuters.com");
  assert.equal(dominioDe("https://markets.ft.com/a").dominio, "ft.com");
  assert.equal(dominioDe("https://reuters.com.evil.io/a").dominio, null);
  assert.equal(dominioDe("https://notreuters.com/a").dominio, null);
  const r = val([N("a", { evento: ev("fraude", "AAPL") }), N("b", { url: "https://reuters.com/y", evento: ev("fraude", "AAPL") })]);
  assert.equal(r.eventos.length, 1); assert.equal(r.eventos[0].confirmado, false);
});

test("eventos: 2 de reuters no confirman; reuters + wsj sí; recorte_guia exige ≥ 10 %; gob.mx solo /shcp", () => {
  const a = val([N("a", { evento: ev("quiebra", "AAPL") }), N("b", { medio: "WSJ", url: "https://www.wsj.com/articles/z", evento: ev("quiebra", "AAPL") })]);
  assert.deepEqual(a.eventos, [{ simbolo: "AAPL", categoria: "quiebra", fuentes: ["https://www.reuters.com/x/a", "https://www.wsj.com/articles/z"], medios: ["Reuters", "WSJ"], confirmado: true }]);
  const b = val([N("a", { evento: ev("recorte_guia", "MSFT", 8) }), N("b", { medio: "CNBC", url: "https://www.cnbc.com/z", evento: ev("recorte_guia", "MSFT", null) })]);
  assert.equal(b.eventos[0].confirmado, false);
  const c = val([N("a", { evento: ev("recorte_guia", "MSFT", 12) }), N("b", { medio: "CNBC", url: "https://www.cnbc.com/z", evento: ev("recorte_guia", "MSFT", null) })]);
  assert.equal(c.eventos[0].confirmado, true);
  assert.equal(dominioDe("https://www.gob.mx/shcp/prensa/x").dominio, "gob.mx");
  assert.equal(dominioDe("https://www.gob.mx/otra/x").dominio, null);
  assert.ok(DOMINIOS.includes("banxico.org.mx") && DOMINIOS.length === 16);
});

function libroConAcciones() {
  const l = libroLunes();
  l.posiciones = l.posiciones.filter(p => !["XLF", "XLE"].includes(p.sym));
  l.efectivoUSD = 5000;
  const acciones = OUT30.rows.filter(r => r.cls === "stock").slice(0, 12);
  acciones.forEach((r, i) => l.posiciones.push({ sym: r.symbol, instrumentId: 9000 + i, lotes: [{ positionId: 2700000000 + i, orderId: 1, unidades: 1, costoUSD: r.price, abiertaEl: "2026-10-20T15:00:00Z" }] }));
  return { libro: l, acciones: acciones.map(r => r.symbol) };
}
const respuestas = req => {
  const p = new URL(req.url).pathname;
  const J = o => ({ http: 200, texto: JSON.stringify(o) });
  if (p === "/stable/news/stock") return J([{ symbol: "XLF", publishedDate: "2026-11-02 08:00:00", title: "Banks <b>rally</b>", site: "reuters.com", url: "https://www.reuters.com/b" },
    { symbol: "OTRO", publishedDate: "2026-11-02 08:00:00", title: "x", site: "x.com", url: "https://x.com/a" }, { symbol: "SPY", title: "sin url", site: "x" }]);
  if (p === "/stable/news/general-latest") return J([{ publishedDate: "2026-11-02 07:00:00", title: "Stocks open higher", site: "cnbc.com", url: "https://www.cnbc.com/a" }]);
  if (p === "/stable/economic-calendar") return J([{ date: "2026-11-04 14:00:00", country: "US", event: "FOMC Rate Decision", impact: "High" }, { date: "2026-11-05", country: "US", event: "Jobless", impact: "Medium" },
    { date: "2026-11-06", country: "MX", event: "Banxico Rate Decision", impact: "High" }, { date: "2026-11-06", country: "JP", event: "BoJ", impact: "High" }]);
  if (p === "/stable/earnings-calendar") return J([{ symbol: "XLF", date: "2026-11-09" }, { symbol: "ZZZ", date: "2026-11-05" }]);
  return { http: 404, texto: "" };
};

test("30-fmp-noticias: 4 llamadas, económico US/MX High, ≤ 12 consultas con prioridad; sin FMP → código 3 y mismos temas", async () => {
  const { libro, acciones } = libroConAcciones();
  const e = await prepararDia({ libro });
  const t = transporteFalso(respuestas);
  const r = await noticias(["--dir", e.dir], { transporteFmp: t, ahora: () => e.t + 120000, pagina: PAG });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo");
  assert.equal(t.llamadas.length, 4);
  const nf = leerSalida(e.dir, "trabajo/noticias-fmp.json");
  assert.deepEqual(nf.economico.map(x => [x.pais, x.evento]), [["US", "FOMC Rate Decision"], ["MX", "Banxico Rate Decision"]]);
  assert.deepEqual(nf.porSimbolo, { XLF: [{ fecha: "2026-11-02T08:00:00", titulo: "Banks rally", medio: "reuters.com", url: "https://www.reuters.com/b" }] });
  assert.deepEqual(nf.resultados, [{ sym: "XLF", fecha: "2026-11-09" }]);
  assert.equal(nf.llamadas, 4);
  const tm = leerSalida(e.dir, "trabajo/temas-noticias.json");
  assert.equal(tm.consultas.length, 12);
  assert.deepEqual(tm.consultas.slice(0, 3).map(q => q.tema), ["macro", "mercado", "mexico"]);
  // candidatos a compra primero (las compras que decidir produce sin noticias, por monto), luego acciones en cartera
  const cand = leerSalida(e.dir, "trabajo/decisiones.json").decisiones.filter(d => d.lado === "compra").sort((x, y) => y.montoUSD - x.montoUSD).map(d => d.sym);
  assert.ok(cand.includes("XLF") && cand.includes("XLE"), cand.join());
  assert.deepEqual(tm.simbolos.filter(s => s.motivo === "candidato a compra").map(s => s.sym), cand);
  assert.deepEqual(tm.consultas.slice(3).map(q => q.sym), cand.concat(acciones).slice(0, 9));
  assert.deepEqual(tm.dominios, DOMINIOS.slice()); assert.equal(tm.ventanaH, 72);
  const url = new URL(t.llamadas[0].url);
  assert.ok(url.searchParams.get("symbols").split(",").length <= 20);
  // sin FMP
  const sin = await noticias(["--dir", e.dir], { transporteFmp: transporteFalso(() => ({ http: 0, conectar: 403, texto: "" })), ahora: () => e.t + 120000, pagina: PAG });
  assert.equal(sin.codigo, 3); assert.equal(sin.linea.accion, "sin_fmp");
  assert.deepEqual(leerSalida(e.dir, "trabajo/temas-noticias.json"), tm);
  assert.equal(leerSalida(e.dir, "trabajo/noticias-fmp.json").errores.length, 4);
});

test("sin análisis: solo las 3 consultas fijas más acciones en cartera; no hay candidatos", async () => {
  const e = await prepararDia({ sinRadar: true });
  await noticias(["--dir", e.dir], { transporteFmp: transporteFalso(respuestas), ahora: () => e.t + 120000, pagina: PAG });
  const tm = leerSalida(e.dir, "trabajo/temas-noticias.json");
  assert.equal(tm.consultas.length, 3);
  assert.ok(tm.simbolos.every(s => s.motivo === "en cartera"));
});
