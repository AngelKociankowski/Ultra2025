// Transporte falso de eToro: responde con fixtures por ruta. `estado` permite cambiar el portafolio durante la prueba.
import { transporteFalso } from "../lib/http.mjs";
import { leerFix } from "./util.mjs";

const json = (o, http = 200) => ({ http, texto: JSON.stringify(o) });

export function etoroFalso({ portafolio = leerFix("etoro/port2.json"), tasas = null, historial = [], ordenes = {}, buscar = null, post = null, extra = null } = {}) {
  const estado = { portafolio, tasas, historial, ordenes, posts: [] };
  const t = transporteFalso(async (req, n) => {
    if (extra) { const r = await extra(req, n, estado); if (r) return r; }
    const u = new URL(req.url), p = u.pathname;
    if (req.metodo === "POST") {
      estado.posts.push({ ruta: p, cuerpo: JSON.parse(req.cuerpo), requestId: req.encabezados["x-request-id"] });
      return post ? post(req, estado) : json({ token: "t", orderId: 1, referenceId: "r" });
    }
    if (p === "/api/v1/trading/info/demo/portfolio") return json(typeof estado.portafolio === "function" ? estado.portafolio(estado) : estado.portafolio);
    if (p === "/api/v1/trading/info/demo/pnl") return json(leerFix("etoro/pnl.json"));
    if (p === "/api/v1/trading/info/trade/demo/history") return json(estado.historial);
    const mo = p.match(/^\/api\/v1\/trading\/info\/demo\/orders\/(\d+)$/);
    if (mo) return estado.ordenes[mo[1]] ? json(estado.ordenes[mo[1]]) : json({ errorCode: "NotFound" }, 404);
    if (p === "/api/v1/market-data/instruments/rates") {
      const ids = u.searchParams.get("instrumentIds").split(",").map(Number);
      const base = estado.tasas || leerFix("etoro/tasas-3000-3026-3004-3008.json").rates;
      return json({ rates: base.filter(r => ids.includes(r.instrumentID)) });
    }
    if (p === "/api/v1/market-data/search") {
      const s = u.searchParams.get("internalSymbolFull");
      if (buscar && buscar[s]) return json(buscar[s]);
      try { return json(leerFix(`etoro/buscar-${s}.json`)); } catch (e) { return json({ page: 1, pageSize: 20, totalItems: 0, items: [] }); }
    }
    return json({ errorCode: "RouteNotFound" }, 404);
  });
  t.estado = estado;
  return t;
}
