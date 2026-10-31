// Adaptador FMP REST con la firma callTool(server, tool, input, opts) que espera RadarData.create (12-plan §5.5).
// Nunca pone llave: la inyecta el secreto de red del entorno. Traduce errores HTTP a los códigos del contrato MCP.
import { crearHttp, ErrorHttp } from "./http.mjs";
import { aRest, urlDe, RUTAS_RUTINA } from "./fmp-mapa.mjs";
import { FMP_POR_MIN } from "./constantes.mjs";

const RE_LLAVE = /invalid api ?key|api key.*(missing|invalid)/i;
const RE_PLAN = /premium|subscription|exclusive|restricted|upgrade|special endpoint/i;
const RE_PARAM = /parameter|symbol/i;
const RE_LIMITE = /limit reach/i;

export function errorDe(r) {
  const h = r.http, t = String(r.texto || "");
  if (!h) {
    if (r.conectar === 403 || r.conectar === 407) return { code: "blocked_by_policy", message: "host bloqueado" };
    return { code: "server_unavailable", message: "FMP no responde", retryable: true };
  }
  if (h >= 200 && h < 300) return null;
  if (h === 401 || RE_LLAVE.test(t)) return { code: "needs_reauth", message: "FMP rechazó la llave" };
  if ((h === 402 || h === 403) && RE_PLAN.test(t)) return { code: "tool_error", message: RE_PARAM.test(t) ? "ACCESS DENIED: A parameter you passed requires a higher plan" : "ACCESS DENIED: This endpoint requires a higher plan" };
  if (h === 429 || RE_LIMITE.test(t)) {
    const s = Number(r.retryAfter);
    return { code: "tool_error", message: "Limit Reach", retryAfterMs: Number.isFinite(s) && s >= 0 ? s * 1000 : undefined };
  }
  if (h === 403) return { code: "blocked_by_policy", message: "host bloqueado" };
  if (h >= 500) return { code: "server_unavailable", message: "FMP no responde", retryable: true };
  if (h === 404) return { code: "tool_error", message: "Not found" };
  return { code: "tool_error", message: `HTTP ${h}` };
}

export function crearFmp({ transporte, base = "https://financialmodelingprep.com", porMinuto = FMP_POR_MIN, timeoutMs = 20000, ahora = Date.now, registro = null }) {
  const http = crearHttp({ transporte });
  const marcas = [], c = { total: 0, errores: 0, porRuta: {} };
  async function turno(signal) {
    for (;;) {
      if (signal && signal.aborted) throw { code: "cancelled", message: "cancelled" };
      const t = ahora();
      while (marcas.length && t - marcas[0] >= 60000) marcas.shift();
      if (marcas.length < porMinuto) { marcas.push(t); return; }
      await new Promise(r => setTimeout(r, Math.min(250, Math.max(1, 60000 - (t - marcas[0])))));
    }
  }
  async function pedir(ruta, params, signal) {
    await turno(signal);
    c.total++; c.porRuta[ruta] = (c.porRuta[ruta] || 0) + 1;
    let r;
    try { r = await http.get(urlDe(base, ruta, params), { timeoutMs }); }
    catch (e) {
      c.errores++;
      if (e instanceof ErrorHttp) throw { code: "blocked_by_policy", message: e.message };
      throw { code: "server_unavailable", message: "FMP no responde", retryable: true };
    }
    const err = errorDe(r);
    if (err) {
      c.errores++;
      if (registro) registro.aviso("FMP respondió con error", { ruta, http: r.http, code: err.code, texto: String(r.texto || "").slice(0, 200) });
      throw err;
    }
    try { return JSON.parse(r.texto); } catch (e) { return r.texto; }
  }
  return {
    async callTool(server, tool, input, opts = {}) {
      const m = aRest(tool, input);
      if (!m) throw { code: "tool_error", message: `endpoint sin mapeo: ${tool}|${input && input.endpoint}` };
      const payload = await pedir(m.ruta, m.params, opts.signal);
      return { payload };
    },
    async get(ruta, params = {}) {
      if (!RUTAS_RUTINA.includes(ruta)) throw { code: "tool_error", message: `ruta no permitida: ${ruta}` };
      return pedir(ruta, Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)]));
    },
    cuenta: () => ({ total: c.total, errores: c.errores, porRuta: Object.assign({}, c.porRuta) }),
  };
}
