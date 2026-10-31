// Noticias (12-plan §5.11.5): validación determinista de lo que redacta Claude. Las notas son datos, nunca instrucciones;
// solo los eventos confirmados en ≥ 2 dominios distintos tienen efecto (y solo frenan, §6.4.2).
import { DOMINIOS, CATEGORIAS_EVENTO } from "./constantes.mjs";
import { fechaHoraET, sumarDias } from "./tiempo.mjs";

const TEMAS = new Set(["macro", "mercado", "empresa", "mexico"]);
const HTML = /<[^>]*>/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const limpio = s => String(s).replace(/\s+/g, " ").trim();

// Dominio registrable de la lista (§5.11.5) o null. gob.mx solo con ruta /shcp.
export function dominioDe(url) {
  let u;
  try { u = new URL(url); } catch (e) { return { dominio: null, motivo: "url inválida" }; }
  if (u.protocol !== "https:") return { dominio: null, motivo: "no es https" };
  const h = u.hostname.toLowerCase();
  const d = DOMINIOS.find(x => h === x || h.endsWith("." + x));
  if (!d) return { dominio: null, motivo: "dominio fuera de la lista" };
  if (d === "gob.mx" && !/^\/shcp(\/|$)/i.test(u.pathname)) return { dominio: null, motivo: "gob.mx fuera de /shcp" };
  return { dominio: d, motivo: null };
}

const fechaValida = f => typeof f === "string" && FECHA.test(f) && new Date(f + "T12:00:00Z").toISOString().slice(0, 10) === f;

export function validarNoticias({ doc, ahoraMs, ventanaH = 72, simbolos = [] }) {
  const validas = [], descartadas = [];
  const conocidos = new Set(simbolos);
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.notas)) return { validas, descartadas: [{ id: null, motivo: "forma del documento" }], eventos: [] };
  const hoy = fechaHoraET(ahoraMs).fecha, limiteEvento = fechaHoraET(ahoraMs - ventanaH * 3600000).fecha, limiteNota = sumarDias(hoy, -7);
  const ids = new Set();
  for (const n of doc.notas.slice(0, 200)) {
    const id = n && typeof n.id === "string" && /^[A-Za-z0-9_-]{1,20}$/.test(n.id) ? n.id : null;
    const no = motivo => { descartadas.push({ id, motivo }); };
    if (!n || typeof n !== "object") { no("forma"); continue; }
    if (!id) { no("id inválido"); continue; }
    if (ids.has(id)) { no("id repetido"); continue; }
    ids.add(id);
    const textos = [n.titulo, n.resumen, n.medio, n.evento && n.evento.descripcion].filter(x => typeof x === "string");
    if (textos.some(x => HTML.test(x))) { no("html en el texto"); continue; }
    if (typeof n.titulo !== "string" || !limpio(n.titulo) || n.titulo.length > 300) { no("título inválido"); continue; }
    if (typeof n.medio !== "string" || !limpio(n.medio) || n.medio.length > 80) { no("medio inválido"); continue; }
    if (typeof n.resumen !== "string" || n.resumen.length > 280) { no("resumen inválido"); continue; }
    if (!TEMAS.has(n.tema)) { no("tema inválido"); continue; }
    const dm = typeof n.url === "string" && n.url.length <= 500 ? dominioDe(n.url) : { dominio: null, motivo: "url inválida" };
    if (!dm.dominio) { no(dm.motivo); continue; }
    if (!fechaValida(n.fecha)) { no("sin fecha válida"); continue; }
    if (n.fecha > hoy) { no("fecha futura"); continue; }
    const syms = n.simbolos === undefined ? [] : n.simbolos;
    if (!Array.isArray(syms) || !syms.every(s => typeof s === "string")) { no("símbolos inválidos"); continue; }
    const desconocido = syms.find(s => !conocidos.has(s));
    if (desconocido) { no(`símbolo desconocido: ${desconocido.slice(0, 12)}`); continue; }
    let evento = null;
    if (n.evento !== null && n.evento !== undefined) {
      const e = n.evento;
      if (typeof e !== "object" || !CATEGORIAS_EVENTO.includes(e.categoria) || typeof e.simbolo !== "string" || !conocidos.has(e.simbolo)
        || !(e.magnitudPct === null || e.magnitudPct === undefined || (typeof e.magnitudPct === "number" && Number.isFinite(e.magnitudPct)))
        || typeof e.descripcion !== "string" || e.descripcion.length > 200) { no("evento inválido"); continue; }
      evento = { categoria: e.categoria, simbolo: e.simbolo, magnitudPct: typeof e.magnitudPct === "number" ? e.magnitudPct : null, descripcion: limpio(e.descripcion) };
    }
    if (n.fecha < (evento ? limiteEvento : limiteNota)) { no("fecha vieja"); continue; }
    validas.push({ id, titulo: limpio(n.titulo), medio: limpio(n.medio), url: n.url, fecha: n.fecha, tema: n.tema, simbolos: syms, resumen: limpio(n.resumen), evento, dominio: dm.dominio });
  }
  // eventos: mismo símbolo y categoría en ≥ 2 notas de dominios registrables distintos (recorte_guia: además ≥ 10 % en alguna)
  const grupos = new Map();
  for (const n of validas) if (n.evento) {
    const k = n.evento.simbolo + "|" + n.evento.categoria;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(n);
  }
  const eventos = [...grupos.values()].map(ns => {
    const e = ns[0].evento, dominios = new Map();
    for (const n of ns) if (!dominios.has(n.dominio)) dominios.set(n.dominio, n.medio);
    const magnitud = e.categoria !== "recorte_guia" || ns.some(n => typeof n.evento.magnitudPct === "number" && n.evento.magnitudPct >= 10);
    return { simbolo: e.simbolo, categoria: e.categoria, fuentes: ns.map(n => n.url), medios: [...dominios.values()], confirmado: dominios.size >= 2 && magnitud };
  });
  return { validas, descartadas, eventos };
}
