// Paso 6 · Noticias de FMP y temas para la búsqueda web (12-plan §5.11.4). Uso: node bin/30-fmp-noticias.mjs --dir <carpeta>
// Lo que llega de FMP es dato: se guarda recortado y sin HTML; nunca se interpreta.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, escribirTrabajo } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { decidir, configEfectiva } from "../lib/reglas.mjs";
import { sumarDias, fechaHoraET } from "../lib/tiempo.mjs";
import { DOMINIOS } from "../lib/constantes.mjs";
import { nombreDeUrl } from "../lib/noticias.mjs";

const PASO = "30-fmp-noticias";
const AYUDA = "Uso: node bin/30-fmp-noticias.mjs --dir <carpeta>";
const MAX_CONSULTAS = 12, MAX_SIMBOLOS = 20, POR_SIMBOLO = 10;
const FIJAS = [
  { id: "q1", texto: "Federal Reserve rates inflation this week", tema: "macro" },
  { id: "q2", texto: "stock market today S&P 500", tema: "mercado" },
  { id: "q3", texto: "peso dólar Banxico tipo de cambio", tema: "mexico" },
];
const texto = (s, n = 300) => String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const urlOk = u => { try { return new URL(u).protocol === "https:" ? String(u).slice(0, 500) : null; } catch (e) { return null; } };
const fechaIso = f => (typeof f === "string" ? f.trim().replace(" ", "T").slice(0, 19) : null);
// 12b §G: una nota de FMP solo vale si la URL de su artículo cae en la tabla de fuentes; el medio sale de la tabla
const nota = r => { const url = urlOk(r.url), nombre = url ? nombreDeUrl(url) : null; return nombre ? { fecha: fechaIso(r.publishedDate), titulo: texto(r.title), medio: nombre, url } : null; };

// Símbolos y consultas (§5.11.4): candidatos a compra = compras que decidir produciría sin noticias
export function temasDelDia({ C, analisis, cartera, config, fecha, nowMs }) {
  const out = analisis && analisis.out ? analisis.out : null;
  const fila = s => (out ? out.rows.find(r => r.symbol === s) : null);
  const mapa = (cartera && cartera.mapa && cartera.mapa.instrumentos) || {};
  const nombre = s => texto((fila(s) && fila(s).name) || s, 80);
  const clase = s => { const r = fila(s); if (r) return r.cls === "stock" ? "stock" : "etf"; return mapa[s] && mapa[s].clase === 5 ? "stock" : "etf"; };
  const enCartera = cartera && cartera.libro ? [...new Set(cartera.libro.posiciones.filter(p => p.lotes.length).map(p => p.sym).concat(cartera.libro.pendientes.filter(p => p.lado === "compra").map(p => p.sym)))] : [];
  let candidatos = [], objetivo = [];
  if (out && cartera && cartera.estado === "listo") {
    const r = decidir({ C, analisis, cartera, eventos: [], config, contexto: { fecha, mercadoAbierto: true, ventanaDentro: true, bloqueoLibro: false, cetesPct: null, nowMs } });
    candidatos = r.decisiones.filter(d => d.lado === "compra").sort((x, y) => (y.montoUSD || 0) - (x.montoUSD || 0)).map(d => d.sym);
    objetivo = Object.keys(r.objetivo.pesos);
  }
  const simbolos = [];
  for (const s of candidatos) simbolos.push({ sym: s, nombre: nombre(s), motivo: "candidato a compra", clase: clase(s) });
  for (const s of enCartera) if (!candidatos.includes(s)) simbolos.push({ sym: s, nombre: nombre(s), motivo: "en cartera", clase: clase(s) });
  const consultas = FIJAS.map(q => Object.assign({}, q));
  const porSym = simbolos.filter(x => x.motivo === "candidato a compra" || x.clase === "stock");
  for (const x of porSym) {
    if (consultas.length >= MAX_CONSULTAS) break;
    consultas.push({ id: `q${consultas.length + 1}`, texto: `${x.nombre} ${x.sym} news`, tema: "empresa", sym: x.sym });
  }
  return { simbolos, consultas, objetivo, enCartera };
}

export async function main(argv, { transporteFmp = null, ahora = Date.now, pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora });
  const prep = leerTrabajo(dir, "preparar.json") || {};
  const config = prep.config || configEfectiva(leerDoc(dir, "rutina-config").doc).config;
  const t = ahora(), hoy = prep.fechaET || fechaHoraET(t).fecha;
  const analisis = leerTrabajo(dir, "analisis.json"), cartera = leerTrabajo(dir, "cartera.json");
  const { C } = pagina || cargarPagina();
  const tm = temasDelDia({ C, analisis, cartera, config, fecha: hoy, nowMs: t });
  escribirTrabajo(dir, "temas-noticias.json", { ventanaH: config.noticiasVentanaH, dominios: DOMINIOS.slice(), simbolos: tm.simbolos, consultas: tm.consultas });

  const fmp = crearFmp({ transporte: transporteFmp || transporteCurl(), ahora, registro: reg });
  const res = { porSimbolo: {}, generales: [], economico: [], resultados: [], errores: [], llamadas: 0 };
  const pedir = async (ruta, params) => { try { const r = await fmp.get(ruta, params); return Array.isArray(r) ? r : []; } catch (e) { res.errores.push({ ruta, codigo: e.code || "error" }); return null; } };
  const syms = tm.simbolos.map(x => x.sym).slice(0, MAX_SIMBOLOS);
  let intentos = 0;
  if (syms.length) {
    intentos++;
    const r = await pedir("/stable/news/stock", { symbols: syms, limit: 50 });
    for (const x of r || []) {
      if (!x || !syms.includes(x.symbol)) continue;
      const n = nota(x); if (!n) continue;
      const lista = (res.porSimbolo[x.symbol] = res.porSimbolo[x.symbol] || []);
      if (lista.length < POR_SIMBOLO) lista.push(n);
    }
  }
  intentos++;
  for (const x of (await pedir("/stable/news/general-latest", { page: 0, limit: 20 })) || []) { const n = x && nota(x); if (n) res.generales.push(n); }
  intentos++;
  for (const x of (await pedir("/stable/economic-calendar", { from: hoy, to: sumarDias(hoy, 7) })) || []) {
    if (x && ["US", "MX"].includes(x.country) && x.impact === "High") res.economico.push({ fecha: fechaIso(x.date), pais: x.country, evento: texto(x.event, 120), impacto: "High" });
  }
  intentos++;
  const relevantes = new Set(tm.enCartera.concat(tm.objetivo));
  for (const x of (await pedir("/stable/earnings-calendar", { from: hoy, to: sumarDias(hoy, 10) })) || []) {
    if (x && relevantes.has(x.symbol) && typeof x.date === "string") res.resultados.push({ sym: x.symbol, fecha: x.date.slice(0, 10) });
  }
  res.llamadas = fmp.cuenta().total;
  escribirTrabajo(dir, "noticias-fmp.json", res);
  const sinFmp = res.errores.length >= intentos;
  reg.info("noticias de FMP", { llamadas: res.llamadas, errores: res.errores.length, consultas: tm.consultas.length });
  return { codigo: sinFmp ? 3 : 0, linea: lineaPaso({ paso: PASO, ok: !sinFmp, accion: sinFmp ? "sin_fmp" : "listo", modo: prep.modo || null,
    resumen: { llamadas: res.llamadas, errores: res.errores.length, consultas: tm.consultas.length, simbolos: tm.simbolos.length } }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
