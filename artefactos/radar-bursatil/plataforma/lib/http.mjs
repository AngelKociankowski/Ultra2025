// Único transporte de red (12-plan §0.4, §4.5): curl vía execFile, sin shell. Las llaves las pone el secreto de red del
// entorno; este módulo nunca las ve ni las pone. Bloquea todo POST que no vaya a una ruta Demo de ejecución de eToro.
import { execFile } from "node:child_process";

export const HOSTS = Object.freeze(["public-api.etoro.com", "financialmodelingprep.com"]);
const POST_ORDENES = "https://public-api.etoro.com/api/v2/trading/execution/demo/orders";
const POST_CIERRE = "https://public-api.etoro.com/api/v1/trading/execution/demo/market-close-orders/positions/";
export const POST_PERMITIDOS = Object.freeze([POST_ORDENES, POST_CIERRE]);
const MARCA = "\n--radar-fin--";

export class ErrorHttp extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

const postPermitido = url => url === POST_ORDENES || (url.startsWith(POST_CIERRE) && /^\d{1,15}$/.test(url.slice(POST_CIERRE.length)));

function validarUrl(metodo, url) {
  if (metodo !== "GET" && metodo !== "POST") throw new ErrorHttp("metodo_prohibido", `método no permitido: ${metodo}`);
  let u;
  try { u = new URL(url); } catch (e) { throw new ErrorHttp("url_invalida", "URL inválida"); }
  if (u.protocol !== "https:" || !HOSTS.includes(u.hostname) || u.username || u.password || u.port) throw new ErrorHttp("host_prohibido", `host no permitido: ${u.hostname}`);
  if (/\/trading\//.test(u.pathname) && !/\/demo\//.test(u.pathname)) throw new ErrorHttp("ruta_prohibida", "ruta de trading sin /demo/");
  if (metodo === "POST" && !postPermitido(url)) throw new ErrorHttp("ruta_prohibida", "POST fuera de las rutas Demo de ejecución");
}

function validarEncabezados(enc) {
  for (const [k, v] of Object.entries(enc || {})) {
    if (!/^[a-z][a-z0-9-]{0,40}$/i.test(k) || /key|auth|token|cookie|secret/i.test(k)) throw new ErrorHttp("encabezado_prohibido", `encabezado no permitido: ${k}`);
    if (typeof v !== "string" || /[\r\n]/.test(v) || v.length > 200) throw new ErrorHttp("encabezado_prohibido", `valor de encabezado inválido: ${k}`);
  }
}

// Transporte real. Respuesta: { http, texto, retryAfter, conectar, errorRed }. http 0 = sin respuesta HTTP.
export function transporteCurl() {
  return function peticion({ metodo, url, encabezados = {}, cuerpo = null, timeoutMs = 20000 }) {
    const args = ["-sS", "-X", metodo, url, "--max-time", String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      "-w", MARCA + "%{http_code}|%{http_connect}|%header{retry-after}"];
    for (const [k, v] of Object.entries(encabezados)) args.push("-H", `${k}: ${v}`);
    if (cuerpo !== null) args.push("--data-binary", cuerpo);
    return new Promise(resolve => {
      execFile("curl", args, { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs + 5000, windowsHide: true }, (err, stdout, stderr) => {
        const s = String(stdout || ""), i = s.lastIndexOf(MARCA);
        const texto = i >= 0 ? s.slice(0, i) : s;
        const [hc, cc, ra] = i >= 0 ? s.slice(i + MARCA.length).split("|") : ["0", "0", ""];
        const http = Number(hc) || 0, conectar = Number(cc) || 0;
        const errorRed = err ? `curl ${err.code !== undefined ? err.code : "?"}${err.killed ? " (tiempo)" : ""}` : null;
        resolve({ http, texto, retryAfter: ra && ra.trim() ? ra.trim() : null, conectar, errorRed, stderr: String(stderr || "").slice(0, 200) });
      });
    });
  };
}

// Transporte falso para pruebas: `manejador(peticion)` devuelve {http, texto, retryAfter?} (o una promesa).
export function transporteFalso(manejador) {
  const llamadas = [];
  const f = async req => {
    llamadas.push(Object.assign({}, req));
    const r = await manejador(req, llamadas.length);
    return Object.assign({ http: 0, texto: "", retryAfter: null, conectar: 0, errorRed: null }, r);
  };
  f.llamadas = llamadas;
  return f;
}

export function crearHttp({ transporte }) {
  if (typeof transporte !== "function") throw new ErrorHttp("sin_transporte", "falta el transporte");
  const enviar = async (metodo, url, cuerpo, { encabezados = {}, timeoutMs = 20000 } = {}) => {
    validarUrl(metodo, url);
    validarEncabezados(encabezados);
    return transporte({ metodo, url, encabezados, cuerpo, timeoutMs });
  };
  return {
    get: (url, o) => enviar("GET", url, null, o),
    post: (url, cuerpo, o) => enviar("POST", url, typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), o),
  };
}
