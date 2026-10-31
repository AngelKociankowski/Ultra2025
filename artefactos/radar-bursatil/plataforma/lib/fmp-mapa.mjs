// Mapeo FMP: herramienta|endpoint del MCP de la página → ruta REST /stable/ (12-plan §5.6.1).
// Parámetros: from_date → from, to_date → to, arreglos → "A,B,C", el resto con el mismo nombre; se quita `endpoint`.
// Ev. C (sin página de FMP encontrada) se confirma en T00b antes de la primera corrida real.
export const MAPA = Object.freeze({
  "quote|quote": "/stable/quote",
  "quote|batch-quote": "/stable/batch-quote",
  "quote|batch-quote-short": "/stable/batch-quote-short",
  "chart|historical-price-eod-light": "/stable/historical-price-eod/light",
  "indexes|index-historical-price-eod-light": "/stable/historical-price-eod/light",
  "commodity|commodities-historical-price-eod-light": "/stable/historical-price-eod/light",
  "crypto|cryptocurrency-historical-price-eod-light": "/stable/historical-price-eod/light",
  "forex|forex-historical-price-eod-light": "/stable/historical-price-eod/light",
  "chart|historical-price-eod-full": "/stable/historical-price-eod/full",
  "statements|key-metrics-ttm": "/stable/key-metrics-ttm",
  "statements|metrics-ratios-ttm": "/stable/ratios-ttm",
  "statements|financial-scores": "/stable/financial-scores",
  "calendar|earnings-company": "/stable/earnings",
  "analyst|price-target-summary": "/stable/price-target-summary",
  "analyst|grades-summary": "/stable/grades-consensus",
  "analyst|price-target-consensus": "/stable/price-target-consensus",
  "economics|treasury-rates": "/stable/treasury-rates",
  "marketHours|holidays-by-exchange": "/stable/holidays-by-exchange",
  "search|search-company-screener": "/stable/company-screener",
  "statements|cashflow-statements-ttm": "/stable/cash-flow-statement-ttm",
  "company|all-shares-float": "/stable/shares-float-all",
  "marketPerformance|biggest-gainers": "/stable/biggest-gainers",
  "marketPerformance|biggest-losers": "/stable/biggest-losers",
  "marketPerformance|most-active": "/stable/most-actives",
  "marketPerformance|sector-performance-snapshot": "/stable/sector-performance-snapshot",
});

// Rutas que solo usa la rutina con fmp.get (§5.6.2)
export const RUTAS_RUTINA = Object.freeze(["/stable/news/stock", "/stable/news/general-latest", "/stable/economic-calendar", "/stable/earnings-calendar", "/stable/quote"]);

const RENOMBRE = { from_date: "from", to_date: "to" };

export function aRest(tool, input = {}) {
  const ruta = MAPA[`${tool}|${input.endpoint}`];
  if (!ruta) return null;
  const params = [];
  for (const [k, v] of Object.entries(input)) {
    if (k === "endpoint" || v === undefined || v === null) continue;
    params.push([RENOMBRE[k] || k, Array.isArray(v) ? v.join(",") : String(v)]);
  }
  return { ruta, params };
}

// URL con URLSearchParams (codifica ^ como %5E); las comas de las listas quedan legibles.
export function urlDe(base, ruta, params) {
  const q = new URLSearchParams(params).toString().replace(/%2C/gi, ",");
  return base + ruta + (q ? "?" + q : "");
}

// Inversa (solo pruebas con el generador sintético): ruta REST → herramienta|endpoint canónico de la página.
const CANON = { "/stable/historical-price-eod/light": "chart|historical-price-eod-light" };
export function deRest(ruta, params) {
  const clave = CANON[ruta] || Object.keys(MAPA).find(k => MAPA[k] === ruta);
  if (!clave) return null;
  const [tool, endpoint] = clave.split("|"), input = { endpoint };
  const INV = { from: "from_date", to: "to_date" };
  for (const [k, v] of params) input[INV[k] || k] = k === "symbols" ? v.split(",") : /^(limit|page|marketCapMoreThan|priceMoreThan)$/.test(k) ? Number(v) : v === "true" ? true : v === "false" ? false : v;
  return { tool, input };
}
