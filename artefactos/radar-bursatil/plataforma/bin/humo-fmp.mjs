// Prueba de humo de FMP REST para el director (12-plan §5.6.3, T00b): 22 llamadas, una por fila. No imprime cuerpos.
// Uso: node bin/humo-fmp.mjs
import { pathToFileURL } from "node:url";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { leerArgs } from "../lib/archivos.mjs";
import { fechaHoraET, sumarDias } from "../lib/tiempo.mjs";

const AYUDA = "Uso: node bin/humo-fmp.mjs   (22 llamadas a FMP; OK | FALTAN <campos> | HTTP <n> | ERROR <code> por fila)";
const Q = ["symbol", "name", "price", "changePercentage", "change", "volume", "previousClose", "yearHigh", "yearLow", "priceAvg50", "priceAvg200", "marketCap", "exchange", "timestamp"];
const EOD = ["symbol", "date", "price", "volume"];

export function filas(hoy) {
  const r10 = { from: sumarDias(hoy, -14), to: hoy };
  // [nombre, clave de ENDPOINTS | ruta de fmp.get, args, campos obligatorios, usada por la corrida]
  return [
    ["quote SPY", "quote", { symbol: "SPY" }, Q, true],
    ["quote ^GSPC", "quote", { symbol: "^GSPC" }, ["symbol", "price", "timestamp"], true],
    ["eodLight SPY", "eodLight", Object.assign({ symbol: "SPY" }, r10), EOD, true],
    ["eodIndex ^GSPC", "eodIndex", Object.assign({ symbol: "^GSPC" }, r10), EOD, true],
    ["eodCommodity GCUSD", "eodCommodity", Object.assign({ symbol: "GCUSD" }, r10), EOD, true],
    ["eodCrypto BTCUSD", "eodCrypto", Object.assign({ symbol: "BTCUSD" }, r10), EOD, true],
    ["eodFx USDMXN", "eodFx", Object.assign({ symbol: "USDMXN" }, r10), EOD, true],
    ["keyMetrics AAPL", "keyMetrics", { symbol: "AAPL" }, ["symbol"], true],
    ["ratios AAPL", "ratios", { symbol: "AAPL" }, ["symbol", "dividendYieldTTM"], true],
    ["scores AAPL", "scores", { symbol: "AAPL" }, ["altmanZScore", "piotroskiScore"], true],
    ["earnings AAPL", "earnings", { symbol: "AAPL" }, ["symbol", "date", "epsActual", "epsEstimated"], true],
    ["ptSummary AAPL", "ptSummary", { symbol: "AAPL" }, ["lastMonthCount", "lastMonthAvgPriceTarget"], true],
    ["grades AAPL", "grades", { symbol: "AAPL" }, ["strongBuy", "buy", "hold", "sell", "strongSell", "consensus"], true],
    ["ptConsensus AAPL", "ptConsensus", { symbol: "AAPL" }, ["targetConsensus", "targetHigh", "targetLow", "targetMedian"], true],
    ["treasury 7 días", "treasury", { from: sumarDias(hoy, -7), to: hoy }, ["date", "month3", "year2", "year10"], true],
    ["holidays año", "holidays", { year: hoy.slice(0, 4) }, ["date", "name"], true],
    ["screener limit=5", "screener", { limit: 5 }, ["symbol", "exchangeShortName", "volume", "price", "marketCap", "sector"], true],
    ["batchQuoteShort AAPL", "batchQuoteShort", { symbols: ["AAPL"] }, "plan_denied", true],
    ["news/stock SPY", "/stable/news/stock", { symbols: "SPY", limit: 5 }, ["symbol", "publishedDate", "title", "site", "url"], false],
    ["news/general-latest", "/stable/news/general-latest", { page: 0, limit: 5 }, ["publishedDate", "title", "site", "url"], false],
    ["economic-calendar", "/stable/economic-calendar", { from: hoy, to: sumarDias(hoy, 7) }, ["date", "country", "event", "impact"], false],
    ["earnings-calendar", "/stable/earnings-calendar", { from: hoy, to: sumarDias(hoy, 10) }, ["symbol", "date"], false],
  ];
}

export async function main(argv, { transporte = transporteCurl(), ahora = Date.now, escribir = t => process.stdout.write(t) } = {}) {
  const a = leerArgs(argv);
  if (a.ayuda) { escribir(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const { C, D } = cargarPagina();
  const fmp = crearFmp({ transporte, ahora });
  const hoy = fechaHoraET(ahora()).fecha;
  let malas = 0;
  for (const [nombre, clave, args, campos, corrida] of filas(hoy)) {
    let txt;
    try {
      let rows;
      if (clave.startsWith("/")) rows = await fmp.get(clave, args);
      else {
        const ep = D.ENDPOINTS[clave], input = ep.build(args);
        if (clave === "screener") input.limit = args.limit;
        rows = C.extractRows(await fmp.callTool("FMP", ep.tool, input, {}));
      }
      rows = Array.isArray(rows) ? rows : [rows];
      if (campos === "plan_denied") txt = "FALTAN error de plan (respondió datos)";
      else if (!rows.length) txt = "FALTAN filas (arreglo vacío)";
      else { const f = campos.filter(k => !(k in rows[0])); txt = f.length ? `FALTAN ${f.join(",")}` : "OK"; }
    } catch (raw) {
      const e = D.classifyError(raw);
      if (campos === "plan_denied" && e.kind === "plan_denied") txt = "OK";
      else txt = /^HTTP \d+$/.test(raw && raw.message) ? raw.message : `ERROR ${raw && raw.code ? raw.code : e.kind}${raw && raw.message ? " (" + String(raw.message).slice(0, 60) + ")" : ""}`;
    }
    if (txt !== "OK" && corrida) malas++;
    escribir(`${nombre.padEnd(22)} ${txt}\n`);
  }
  escribir(`llamadas: ${fmp.cuenta().total}\n`);
  return { codigo: malas ? 1 : 0, linea: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(r => { process.exitCode = r.codigo; }, e => { process.stderr.write(String(e && e.message || e) + "\n"); process.exitCode = 1; });
}
