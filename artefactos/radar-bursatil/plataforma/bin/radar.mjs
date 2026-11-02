// El Radar como herramienta de Claude (12c §D): consulta el último análisis guardado (caché local, §C.7) con el núcleo de la
// página. No habla con eToro ni escribe en db; solo `obtener --corredor` habla con FMP.
//   node bin/radar.mjs [--cache <dir>] [--analisis <archivo>] [--json] <comando> [opciones]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, rutas } from "../lib/archivos.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { cacheDefecto, leerUltimo, listarAnalisis, leerAnalisis, guardarAnalisis } from "../lib/cache-radar.mjs";
import { pasoPagina } from "../lib/pagina.mjs";
import { fechaHoraET, feriadosAnio, diasHabilesEntre } from "../lib/tiempo.mjs";
import { crearFmp } from "../lib/fmp-rest.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { correrRadar } from "../lib/radar-nodo.mjs";

export const AYUDA = `Uso: node bin/radar.mjs [--cache <dir>] [--analisis <archivo>] [--json] <comando> [opciones]

  fuente                                   qué análisis se usa, de dónde y qué tan viejo es
  resumen                                  fecha, fuente, régimen y conteos
  top [n] [--senal compra|mantener|evitar] [--clase stock|etf|index|commodity|crypto|fx] [--grupo acciones|otros]
  simbolo <SYM>                            señal, probabilidad, precio, cono y contribuciones principales
  portafolio [--perfil conservador|moderado|agresivo] [--monto <MXN>] [--fraccional|--enteros] [--cetes <pct>]
  cambios [--contra <AAAA-MM-DD>]          contra el análisis anterior de la caché (o el de esa fecha)
  obtener --pagina [--dir <carpeta>]       máquina de estados para la herramienta (accion: leer | listo | parcial | sin_radar)
  obtener --corredor                       corre el Radar sin navegador (FMP; 2–5 min, ≈ 626 llamadas)`;
export const SIN_ANALISIS = "Aún no hay análisis guardado: pídeme que lo obtenga.";
export const PIE = "Probabilidades del modelo, no certezas. No es asesoría financiera.";
const COMANDOS = ["fuente", "resumen", "top", "simbolo", "portafolio", "cambios", "obtener"];
const SENAL = { 1: "Evitar", 2: "Mantener", 3: "Compra" }, SENAL_DE = { compra: 3, mantener: 2, evitar: 1 };
const FUENTE_TXT = { rutina: "corrida propia con FMP", pagina: "página del Radar" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dma = f => { const [a, m, d] = f.split("-"); return `${Number(d)}-${MESES[Number(m) - 1]}-${a}`; };
const isNum = v => typeof v === "number" && Number.isFinite(v);
const pct = (x, d = 1) => (isNum(x) ? `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(d)} %` : "—");
const claseDe = c => (c === "stock" ? "stock" : c === "etf" ? "etf" : c === "index" || c === "vol" || c === "future" ? "index" : c === "commodity" ? "commodity" : String(c).startsWith("crypto") ? "crypto" : c === "fx" ? "fx" : "otro");

// feriados NYSE del repo (año en curso y anterior) para la antigüedad en días hábiles
function feriados(hoy) { const y = Number(hoy.slice(0, 4)); return [y - 1, y].flatMap(a => feriadosAnio({ anio: a }).filas || []); }

// análisis elegido: --analisis (forma de la caché o AnalysisOutput) o el último de la caché
function cargar({ cache, archivo }) {
  if (archivo) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.resolve(archivo), "utf8")); } catch (e) { return { error: `no se pudo leer ${archivo}: ${e.code || "JSON inválido"}` }; }
    const out = j && j.out ? j.out : j;
    if (!out || !Array.isArray(out.rows)) return { error: `${archivo} no trae un análisis del Radar` };
    return { archivo: path.resolve(archivo), fuente: j.fuente || "pagina", out, parcial: !!(j.parcial || out.partial), obtenidoEl: j.obtenidoEl || null };
  }
  const u = leerUltimo(cache);
  if (!u) return null;
  return { archivo: path.join(cache, u.ultimo.archivo), fuente: u.analisis.fuente, out: u.analisis.out, parcial: !!(u.analisis.parcial || u.analisis.out.partial), obtenidoEl: u.analisis.obtenidoEl };
}
const antiguedad = (asOf, ahora) => { const hoy = fechaHoraET(ahora()).fecha; return diasHabilesEntre(asOf, hoy, feriados(hoy)); };

function filaTop(r, i) {
  return { rango: i + 1, simbolo: r.symbol, nombre: r.name, clase: claseDe(r.cls), senal: SENAL[r.signal], pct: r.pct, ref: r.ref, pRef: r.pRef, precio: r.price, cambioPct: r.changePct ?? null,
    rendEsperado3m: r.expRet ?? null, confianza: r.confidence };
}
function portafolio(C, out, o, ahora) {
  const p = C.buildPortfolio({ output: out, live: null, profile: o.perfil, amountMXN: o.monto, fractional: o.fraccional, nowMs: ahora(), cetesPct: o.cetes, prices: null });
  return { estado: p.state, tipoCambio: p.meta && p.meta.fx ? p.meta.fx.rate : null, analisisViejo: !!(p.meta && p.meta.stale),
    posiciones: (p.positions || []).map(x => ({ rol: x.role, id: x.id, nombre: x.name, senal: x.signalLabel || SENAL[x.signal] || null, peso: x.weight, objetivo: x.target ?? null, montoMXN: x.amountMXN,
      precioUSD: x.priceUSD ?? null, titulos: x.shares ?? null })),
    liquidezMXN: p.cashMXN ?? null, stats: p.stats ? { muAnn: p.stats.muAnn, sigAnn: p.stats.sigAnn, lo: p.stats.lo, med: p.stats.med, hi: p.stats.hi, pAbove: p.stats.pAbove, badYear: p.stats.badYear } : null,
    notas: (p.notes || []).map(String), excluidos: (p.excluded || []).map(x => ({ id: x.id, motivo: x.reason })) };
}
const OBJ = { perfil: "moderado", monto: 600000, fraccional: true, cetes: null };

export async function main(argv, { ahora = Date.now, pagina = null, transporteFmp = null, cache = undefined } = {}) {
  let a;
  try { a = leerArgs(argv, { valores: ["--cache", "--analisis", "--senal", "--clase", "--grupo", "--perfil", "--monto", "--cetes", "--contra", "--dir"], banderas: ["--json", "--fraccional", "--enteros", "--pagina", "--corredor"], posicionales: 2 }); }
  catch (e) { return { codigo: 1, texto: `${e.message}\n${AYUDA}` }; }
  if (a.ayuda) return { codigo: 0, texto: AYUDA };
  const [cmd, arg] = a._;
  if (!COMANDOS.includes(cmd)) return { codigo: 1, texto: AYUDA };
  const dirCache = a.cache || (cache !== undefined ? cache : cacheDefecto());
  const sale = (codigo, obj, texto) => ({ codigo, json: obj, texto: a.json ? JSON.stringify(obj) : texto });
  const pag = pagina || cargarPagina(), C = pag.C;

  if (cmd === "obtener") return obtener({ a, C, pag, dirCache, ahora, transporteFmp, sale });

  const an = cargar({ cache: dirCache, archivo: a.analisis });
  if (!an) return { codigo: 2, json: { error: SIN_ANALISIS }, texto: a.json ? JSON.stringify({ error: SIN_ANALISIS }) : SIN_ANALISIS };
  if (an.error) return { codigo: 1, texto: an.error };
  const out = an.out, ant = antiguedad(out.asOf, ahora), base = { fuente: an.fuente, asOf: out.asOf };
  const encabezado = `Análisis del ${dma(out.asOf)} · fuente: ${FUENTE_TXT[an.fuente] || an.fuente} · ${ant} días hábiles de antigüedad${an.parcial ? " · parcial" : ""}`;
  const texto = lineas => [encabezado, ...lineas, PIE].join("\n");

  if (cmd === "fuente") {
    const o = { archivo: an.archivo, fuente: an.fuente, asOf: out.asOf, antiguedad: ant, parcial: an.parcial, obtenidoEl: an.obtenidoEl };
    return sale(0, o, texto([`Archivo: ${path.basename(an.archivo)}`, `Obtenido el ${an.obtenidoEl || "—"}`]));
  }
  if (cmd === "resumen") {
    const g = out.regime || {}, c = out.counts || {}, n = k => out.rows.filter(r => r.signal === k).length;
    const o = Object.assign({}, base, { antiguedad: ant, plan: out.plan, parcial: an.parcial,
      regimen: { estado: g.state || null, etiqueta: g.label || null, explicacion: g.explain || null, vix: g.vix ?? null, r12: g.r12 ?? null, dd: g.dd ?? null, rf: g.rf ?? null },
      conteos: { universo: c.universe ?? null, elegibles: c.eligible ?? null, finalistas: c.finalists ?? null, rankeados: c.ranked ?? out.rows.length, compra: n(3), mantener: n(2), evitar: n(1) },
      notas: (out.notes || []).map(String) });
    return sale(0, o, texto([`Régimen: ${o.regimen.etiqueta || "—"}. ${o.regimen.explicacion || ""}`.trim(),
      `Rankeados ${o.conteos.rankeados}: ${o.conteos.compra} en Compra, ${o.conteos.mantener} en Mantener, ${o.conteos.evitar} en Evitar (de ${o.conteos.universo ?? "—"} en el universo).`]));
  }
  if (cmd === "top") {
    const n = arg === undefined ? 10 : Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 66) return { codigo: 1, texto: "top: n debe ser un entero de 1 a 66" };
    if (a.senal && !SENAL_DE[a.senal]) return { codigo: 1, texto: AYUDA };
    const filas = out.rows.map(filaTop).filter(f => (!a.senal || f.senal === SENAL[SENAL_DE[a.senal]]) && (!a.clase || f.clase === a.clase)
      && (!a.grupo || (out.rows[f.rango - 1].group === a.grupo))).slice(0, n);
    return sale(0, Object.assign({}, base, { filas }), texto(filas.map(f => `${f.rango}. ${f.simbolo} · ${f.nombre} · ${f.senal} ${f.pct} % (${f.ref === "sp500" ? "ganarle al S&P 500" : "subir"}) · US$ ${f.precio}`)));
  }
  if (cmd === "simbolo") {
    if (!arg) return { codigo: 1, texto: AYUDA };
    const sym = arg.toUpperCase(), r = out.rows.find(x => x.symbol === sym);
    if (!r) {
      const rest = (out.rest || []).find(x => x.symbol === sym), exc = (out.excluded || []).find(x => x.symbol === sym);
      const o = Object.assign({}, base, { estado: rest ? "no_finalista" : exc ? "excluido" : "ausente", fila: null, contribuciones: [], impulsores: { pos: [], neg: [] }, banderas: [], fundamentales: null,
        motivo: rest ? rest.reason : exc ? exc.reason : null });
      const donde = rest ? `no llegó a finalista (${rest.reason})` : exc ? `quedó excluido (${exc.reason})` : "no aparece en el análisis";
      return sale(3, o, texto([`${sym} no está entre los rankeados: ${donde}.`]));
    }
    const contrib = (r.components || []).slice().sort((x, y) => Math.abs(y.contrib) - Math.abs(x.contrib)).slice(0, 5).map(c => ({ codigo: c.code, etiqueta: c.label, bloque: c.block, contrib: c.contrib }));
    const o = Object.assign({}, base, { estado: "rankeado",
      fila: { simbolo: r.symbol, nombre: r.name, clase: claseDe(r.cls), senal: SENAL[r.signal], pct: r.pct, ref: r.ref, pRef: r.pRef, precio: r.price, precioHora: r.priceTime ?? null, cambioPct: r.changePct ?? null,
        rendEsperado3m: r.expRet ?? null, rendMediano3m: r.medRet ?? null, cono: r.cone ? { lo: r.cone.lo, med: r.cone.med, hi: r.cone.hi } : null, confianza: r.confidence, cobertura: r.coverage, motivoTope: r.capReason ?? null },
      contribuciones: contrib, impulsores: { pos: ((r.drivers && r.drivers.pos) || []).slice(0, 3).map(x => x.label), neg: ((r.drivers && r.drivers.neg) || []).slice(0, 3).map(x => x.label) },
      banderas: (r.flags || []).map(x => x.text), fundamentales: r.fundamentals || null, motivo: null });
    return sale(0, o, texto([`${r.symbol} · ${r.name}: ${SENAL[r.signal]} con ${r.pct} % de ${r.ref === "sp500" ? "ganarle al S&P 500" : "subir"} a 3 meses. Precio US$ ${r.price}.`,
      `Rendimiento esperado a 3 meses ${pct(r.expRet)} (cono ${pct(r.cone && r.cone.lo)} a ${pct(r.cone && r.cone.hi)}); confianza ${r.confidence}.`,
      `A favor: ${o.impulsores.pos.join("; ") || "—"}. En contra: ${o.impulsores.neg.join("; ") || "—"}.`, ...o.banderas.map(b => `Ojo: ${b}`)]));
  }
  if (cmd === "portafolio") {
    const perfil = a.perfil || OBJ.perfil, monto = a.monto === undefined ? OBJ.monto : Number(a.monto), cetes = a.cetes === undefined ? null : Number(a.cetes);
    if (!["conservador", "moderado", "agresivo"].includes(perfil) || !(monto > 0) || (cetes !== null && !isNum(cetes)) || (a.fraccional && a.enteros)) return { codigo: 1, texto: AYUDA };
    const p = portafolio(C, out, { perfil, monto, fraccional: !a.enteros, cetes }, ahora);
    const o = Object.assign({}, base, { perfil, montoMXN: monto, fraccional: !a.enteros }, p);
    return sale(0, o, texto([`Portafolio ${perfil} para MXN $ ${monto.toLocaleString("en-US")} (${o.fraccional ? "fraccional" : "títulos enteros"}):`,
      ...o.posiciones.map(x => `${x.id} · ${x.rol} · ${(x.peso * 100).toFixed(2)} % · MXN $ ${Math.round(x.montoMXN).toLocaleString("en-US")}`),
      ...o.excluidos.map(x => `Fuera: ${x.id} (${x.motivo})`)]));
  }
  // cambios: contra el análisis anterior de la caché (por asOf) o el de --contra
  const lista = listarAnalisis(dirCache).filter(x => x.asOf < out.asOf).sort((x, y) => (x.asOf < y.asOf ? 1 : -1));
  const cand = a.contra ? lista.find(x => x.asOf === a.contra) : lista[0];
  const prev = cand ? leerAnalisis(dirCache, cand.archivo) : null;
  if (!prev) {
    const o = { actual: base, anterior: null, regimen: null, senales: [], entranTop10: [], salenTop10: [], objetivo: { entran: [], salen: [], cambian: [] } };
    return sale(0, o, texto([a.contra ? `No hay en la caché un análisis del ${a.contra}.` : "No hay un análisis anterior en la caché para comparar."]));
  }
  const po = prev.out, m0 = new Map(po.rows.map(r => [r.symbol, r]));
  const senales = out.rows.filter(r => m0.has(r.symbol) && m0.get(r.symbol).signal !== r.signal).map(r => ({ simbolo: r.symbol, antes: { senal: SENAL[m0.get(r.symbol).signal], pct: m0.get(r.symbol).pct }, ahora: { senal: SENAL[r.signal], pct: r.pct } }));
  const top = o => o.rows.slice(0, 10).map(r => r.symbol), t1 = top(out), t0 = top(po);
  const pesos = o => Object.fromEntries(portafolio(C, o, OBJ, ahora).posiciones.filter(x => x.peso > 0).map(x => [x.id, x.peso]));
  const w1 = pesos(out), w0 = pesos(po);
  const o = { actual: base, anterior: { asOf: po.asOf, fuente: prev.fuente }, regimen: (po.regime || {}).state !== (out.regime || {}).state ? { antes: po.regime.state, ahora: out.regime.state } : null, senales,
    entranTop10: t1.filter(s => !t0.includes(s)), salenTop10: t0.filter(s => !t1.includes(s)),
    objetivo: { entran: Object.keys(w1).filter(id => !(id in w0)), salen: Object.keys(w0).filter(id => !(id in w1)),
      cambian: Object.keys(w1).filter(id => id in w0 && Math.abs(w1[id] - w0[id]) >= 0.0001).map(id => ({ id, antes: w0[id], ahora: w1[id] })) } };
  return sale(0, o, texto([`Contra el análisis del ${dma(po.asOf)} (${FUENTE_TXT[prev.fuente] || prev.fuente}):`,
    o.regimen ? `Régimen: ${o.regimen.antes} → ${o.regimen.ahora}.` : "Régimen sin cambio.",
    `Cambian de señal: ${senales.map(x => `${x.simbolo} ${x.antes.senal} → ${x.ahora.senal}`).join(", ") || "ninguna"}.`,
    `Entran al top 10: ${o.entranTop10.join(", ") || "ninguna"}; salen: ${o.salenTop10.join(", ") || "ninguna"}.`,
    `Objetivo moderado: entran ${o.objetivo.entran.join(", ") || "ninguno"}; salen ${o.objetivo.salen.join(", ") || "ninguno"}.`]));
}

// obtener --pagina: la misma máquina de estados de 10-radar en una carpeta de trabajo propia (sin db propia: solo la página);
// sin --dir sigue la última obtención sin terminar (la herramienta corre el mismo comando mientras diga `leer`)
async function obtener({ a, C, pag, dirCache, ahora, transporteFmp, sale }) {
  const t = ahora(), hoy = fechaHoraET(t).fecha;
  if (a.pagina === a.corredor) return { codigo: 1, texto: AYUDA };
  if (!dirCache) return { codigo: 1, texto: "obtener necesita una caché (--cache <dir>)" };
  if (a.corredor) {
    if (!pag.compatible) return sale(3, { accion: "sin_radar", lista: null, motivo: "pagina_cambio", archivo: null }, "La página del Radar cambió y el corredor no está validado: no se corre.");
    const r = await correrRadar({ C, D: pag.D, mcp: crearFmp({ transporte: transporteFmp || transporteCurl(), ahora }), ahora, feriados: feriados(hoy) });
    if (r.estado === "error") return sale(3, { accion: "sin_radar", lista: null, motivo: r.motivo, archivo: null }, `El Radar no pudo correr (${r.motivo}).`);
    const g = guardarAnalisis({ dir: dirCache, analisis: { fuente: "rutina", fecha: hoy, asOf: r.out.asOf, antiguedad: diasHabilesEntre(r.out.asOf, hoy, feriados(hoy)), plan: r.out.plan, parcial: !!r.out.partial, runIdFuente: `r${hoy.replace(/-/g, "")}`, out: r.out }, ahora });
    return sale(0, { accion: r.estado, lista: null, motivo: r.motivo || null, archivo: path.join(dirCache, g.archivo) }, `Análisis del ${dma(r.out.asOf)} guardado (${r.llamadas.total} llamadas a FMP).`);
  }
  const base = path.join(dirCache, "obtener");
  let dir = a.dir ? path.resolve(a.dir) : null;
  if (!dir && fs.existsSync(base)) {
    const abiertas = fs.readdirSync(base).sort().reverse().map(d => path.join(base, d)).filter(d => {
      try { const e = JSON.parse(fs.readFileSync(path.join(d, "trabajo", "pagina-estado.json"), "utf8")); return !e.fin && t - fs.statSync(d).mtimeMs < 3600000; } catch (x) { return false; }
    });
    dir = abiertas[0] || null;
  }
  if (!dir) dir = path.join(base, new Date(t).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15));
  const R = rutas(dir);
  for (const d of [R.trabajo, path.join(R.entrada, "pagina")]) fs.mkdirSync(d, { recursive: true });
  const r = pasoPagina({ C, dir, sesion: "herramienta", hoy, feriados: feriados(hoy) });
  if (r.accion === "leer") return sale(0, { accion: "leer", lista: path.join(R.trabajo, "leer-pagina.json"), motivo: null, archivo: null },
    `Lee con ArtifactData cada elemento de ${path.join(R.trabajo, "leer-pagina.json")} (sus args exactos) y vuelve a correr este comando.`);
  if (r.accion === "sin_radar") return sale(3, { accion: "sin_radar", lista: null, motivo: r.motivo, archivo: null }, `No hay un análisis de la página que sirva (${r.motivo}).`);
  if (!r.analisis) { const u = leerUltimo(dirCache); return sale(0, { accion: r.accion, lista: null, motivo: null, archivo: u ? path.join(dirCache, u.ultimo.archivo) : null }, "La obtención ya había terminado."); }
  const g = guardarAnalisis({ dir: dirCache, analisis: r.analisis, ahora });
  return sale(0, { accion: r.accion, lista: null, motivo: null, archivo: path.join(dirCache, g.archivo) }, `Análisis de la página del ${dma(r.analisis.asOf)} guardado en la caché.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(r => { process.stdout.write(r.texto + "\n"); process.exitCode = r.codigo; }, e => { process.stdout.write(`Error: ${String(e.message || e).slice(0, 200)}\n`); process.exitCode = 1; });
}
