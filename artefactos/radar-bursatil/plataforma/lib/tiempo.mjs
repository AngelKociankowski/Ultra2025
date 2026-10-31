// Tiempo de la rutina (12-plan §5.13.3, §5.11.1). El estado del mercado sale de C.marketState (núcleo de la página);
// fecha y hora ET simples, con Intl, para módulos que no cargan la página.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ET_ZONA } from "./constantes.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FMT = new Intl.DateTimeFormat("en-CA", { timeZone: ET_ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function fechaHoraET(ms) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, diaSemana: DIAS[p.weekday] };
}

export const minutosDe = hhmm => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
export const hhmmDe = min => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function sumarDias(fecha, n) {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diasEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
// Instante UTC de una hora ET de una fecha (prueba los dos desfases de Nueva York)
export function msDeET(fecha, hhmm) {
  for (const h of [4, 5]) { const ms = Date.parse(`${fecha}T${hhmm}:00Z`) + h * 3600000, e = fechaHoraET(ms); if (e.fecha === fecha && e.hora === hhmm) return ms; }
  return null;
}
const esHabil = (d, cerrados) => { const wd = new Date(d + "T12:00:00Z").getUTCDay(); return wd !== 0 && wd !== 6 && !cerrados.has(d); };
const cerradosDe = feriados => new Set((feriados || []).filter(f => f && (f.isClosed === true || f.isFullyClosed === true)).map(f => f.date));
// Apertura NYSE (9:30 ET) en la que pudo llenarse una orden enviada en `ms`: la misma hora si el mercado estaba abierto; si no,
// la apertura del siguiente día hábil (una orden enviada con el mercado cerrado queda en cola hasta entonces)
export function aperturaParaOrden(ms, feriados = []) {
  const cerrados = cerradosDe(feriados), et = fechaHoraET(ms), min = minutosDe(et.hora);
  if (esHabil(et.fecha, cerrados) && min >= 570 && min < 960) return ms;
  let d = esHabil(et.fecha, cerrados) && min < 570 ? et.fecha : sumarDias(et.fecha, 1);
  while (!esHabil(d, cerrados)) d = sumarDias(d, 1);
  return msDeET(d, "09:30");
}
// Días hábiles NYSE en (desde, hasta]: lunes a viernes sin feriado de cierre completo (los de cierre anticipado sí cuentan)
export function diasHabilesEntre(desde, hasta, feriados = []) {
  const cerrados = cerradosDe(feriados);
  let n = 0;
  for (let d = sumarDias(desde, 1); d <= hasta; d = sumarDias(d, 1)) if (esHabil(d, cerrados)) n++;
  return n;
}
export const mesDe = fecha => fecha.slice(0, 7);
export function mesAnterior(mes) { const [y, m] = mes.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; }

const filasValidas = rows => Array.isArray(rows) && rows.every(r => r && typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date));

// Prioridad: feriados-<año> de db → filas de FMP (si las hay) → feriados-nyse.json del repo. Devuelve { filas, fuente }.
export function feriadosAnio({ anio, docDb = null, filasFmp = null, rutaRepo = path.join(RAIZ, "feriados-nyse.json") }) {
  const delAnio = rows => rows.filter(r => r.date.startsWith(String(anio)));
  if (docDb && docDb.kind === "feriados" && filasValidas(docDb.rows) && delAnio(docDb.rows).length) return { filas: delAnio(docDb.rows), fuente: "db" };
  if (filasValidas(filasFmp) && delAnio(filasFmp).length) return { filas: delAnio(filasFmp), fuente: "fmp" };
  let repo = null;
  try { repo = JSON.parse(fs.readFileSync(rutaRepo, "utf8")); } catch (e) { repo = null; }
  const filas = repo && filasValidas(repo[String(anio)]) ? repo[String(anio)] : null;
  return filas ? { filas, fuente: "repo" } : { filas: null, fuente: "ninguna" };
}

// Ventana de órdenes del día (§5.11.1, §5.13.3): con cierre anticipado, hasta = min(config, cierre − 30 min).
export function ventanaDelDia({ C, ahoraMs, feriados, config }) {
  const m = C.marketState(ahoraMs, feriados), et = C.etParts(ahoraMs);
  let hasta = minutosDe(config.ventanaET.hasta);
  if (m.tradingDay && Number.isFinite(m.closeMs)) hasta = Math.min(hasta, C.etParts(m.closeMs).minutes - (m.earlyClose ? 30 : 15));
  const desde = minutosDe(config.ventanaET.desde);
  return { desde: hhmmDe(desde), hasta: hhmmDe(hasta), dentro: m.open && et.minutes >= desde && et.minutes < hasta };
}
