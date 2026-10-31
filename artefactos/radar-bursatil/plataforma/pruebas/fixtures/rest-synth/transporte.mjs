// Transporte falso de FMP REST para pruebas: traduce la URL REST a (herramienta, input) con la tabla inversa y responde con
// el generador sintético de la página (RadarSynth.respond). `falla(req, n)` puede devolver una respuesta HTTP para inyectar errores.
import { transporteFalso } from "../../../lib/http.mjs";
import { deRest } from "../../../lib/fmp-mapa.mjs";

export function transporteSintetico({ S, ctx, falla = null }) {
  const t = transporteFalso((req, n) => {
    if (falla) { const r = falla(req, n); if (r) return r; }
    const u = new URL(req.url);
    const m = deRest(u.pathname, [...u.searchParams.entries()]);
    if (!m) return { http: 404, texto: '{"Error Message":"Not found (mock)"}' };
    try {
      return { http: 200, texto: JSON.stringify(S.respond(m.tool, m.input, ctx)) };
    } catch (e) {
      const msg = e && e.message ? String(e.message) : "error (mock)";
      return { http: /ACCESS DENIED/.test(msg) ? 402 : 400, texto: JSON.stringify({ "Error Message": msg }) };
    }
  });
  return t;
}
