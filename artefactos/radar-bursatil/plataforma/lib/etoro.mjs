// Cliente eToro solo Demo (12-plan §5.7): 6 lecturas y 2 escrituras con rutas fijas. No hay ruta Real ni método genérico.
import crypto from "node:crypto";
import { crearHttp, ErrorHttp } from "./http.mjs";

export const MODO = "demo";

const CAMPOS_BUSCAR = "instrumentId,internalSymbolFull,displayname,isDelisted,isCurrentlyTradable,isBuyEnabled,internalAssetClassId,currentRate";
const POR_MINUTO = 50;

const entero = (v, que) => { if (!Number.isSafeInteger(v) || v <= 0) throw { codigo: "etoro_argumento", mensaje: `${que} inválido` }; return v; };
const fecha = v => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw { codigo: "etoro_argumento", mensaje: "minDate inválida" }; return v; };
const simbolo = v => { if (typeof v !== "string" || !/^[A-Z0-9.^-]{1,15}$/.test(v)) throw { codigo: "etoro_argumento", mensaje: "símbolo inválido" }; return v; };
const centavos = x => Math.floor(x * 100 + 1e-7) / 100;
const seisDecimales = x => Math.floor(x * 1e6 + 1e-6) / 1e6;

export function crearEToro({ transporte, base = "https://public-api.etoro.com", uuid = crypto.randomUUID }) {
  const http = crearHttp({ transporte });
  const marcas = [];
  async function turno() {
    for (;;) {
      const t = Date.now();
      while (marcas.length && t - marcas[0] >= 60000) marcas.shift();
      if (marcas.length < POR_MINUTO) { marcas.push(t); return; }
      await new Promise(r => setTimeout(r, Math.min(1000, 60000 - (t - marcas[0]) + 5)));
    }
  }

  async function pedir(metodo, ruta, cuerpo, requestId) {
    await turno();
    const encabezados = { "x-request-id": requestId };
    if (metodo === "POST") encabezados["Content-Type"] = "application/json";
    let r;
    try { r = metodo === "GET" ? await http.get(base + ruta, { encabezados }) : await http.post(base + ruta, cuerpo, { encabezados }); }
    catch (e) {
      if (e instanceof ErrorHttp) throw { codigo: "etoro_prohibido", mensaje: e.message };
      throw { codigo: "etoro_caido", reintentable: true, mensaje: String(e && e.message || e).slice(0, 200) };
    }
    const h = r.http;
    if (!h) {
      if (r.conectar === 403 || r.conectar === 407) throw { codigo: "etoro_auth", http: r.conectar, mensaje: "host bloqueado por la política de red" };
      throw { codigo: "etoro_caido", reintentable: true, mensaje: r.errorRed || "sin respuesta" };
    }
    if (h === 401 || h === 403) throw { codigo: "etoro_auth", http: h };
    if (h === 429) {
      const s = Number(r.retryAfter);
      throw { codigo: "etoro_ritmo", http: h, reintentarEnMs: Number.isFinite(s) && s >= 0 ? s * 1000 : undefined };
    }
    if (h >= 500) throw { codigo: "etoro_caido", reintentable: true, http: h };
    if (h >= 400) throw { codigo: "etoro_rechazo", http: h, cuerpo: String(r.texto || "").slice(0, 300) };
    try { return JSON.parse(r.texto); }
    catch (e) { throw { codigo: "etoro_caido", reintentable: true, http: h, mensaje: "respuesta no JSON" }; }
  }
  const get = ruta => pedir("GET", ruta, null, uuid());
  const requerirId = id => { if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw { codigo: "etoro_argumento", mensaje: "requestId determinista obligatorio" }; return id; };

  return Object.freeze({
    portafolio: async () => get("/api/v1/trading/info/demo/portfolio"),
    pnl: async () => get("/api/v1/trading/info/demo/pnl"),
    orden: async orderId => get(`/api/v1/trading/info/demo/orders/${entero(orderId, "orderId")}`),
    historial: async minDate => get(`/api/v1/trading/info/trade/demo/history?minDate=${fecha(minDate)}`),
    tasas: async ids => {
      if (!Array.isArray(ids) || !ids.length) throw { codigo: "etoro_argumento", mensaje: "ids vacíos" };
      return get(`/api/v1/market-data/instruments/rates?instrumentIds=${ids.map(i => entero(i, "instrumentId")).join(",")}`);
    },
    buscar: async sym => get(`/api/v1/market-data/search?internalSymbolFull=${encodeURIComponent(simbolo(sym))}&fields=${CAMPOS_BUSCAR}`),
    comprar: async ({ instrumentId, montoUSD, requestId }) => {
      if (!(typeof montoUSD === "number" && montoUSD > 0 && Number.isFinite(montoUSD))) throw { codigo: "etoro_argumento", mensaje: "monto inválido" };
      const cuerpo = { instrumentId: entero(instrumentId, "instrumentId"), transaction: "buy", orderType: "mkt", amount: centavos(montoUSD), leverage: 1 };
      return pedir("POST", "/api/v2/trading/execution/demo/orders", cuerpo, requerirId(requestId));
    },
    cerrar: async ({ positionId, instrumentId, unidades, requestId }) => {
      if (!(unidades === null || (typeof unidades === "number" && unidades > 0 && Number.isFinite(unidades)))) throw { codigo: "etoro_argumento", mensaje: "unidades inválidas" };
      const cuerpo = { InstrumentId: entero(instrumentId, "instrumentId"), UnitsToDeduct: unidades === null ? null : seisDecimales(unidades) };
      return pedir("POST", `/api/v1/trading/execution/demo/market-close-orders/positions/${entero(positionId, "positionId")}`, cuerpo, requerirId(requestId));
    },
  });
}
