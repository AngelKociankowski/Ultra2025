// Pasos 2–3 · Preparar (12b §D.2).
//   node bin/00-preparar.mjs --fase lista --modo en_linea|archivo   → crea .trabajo/<fechaET>/ y .trabajo/hoy; lista de lecturas
//   node bin/00-preparar.mjs --dir D --fase decidir                 → trabajo/preparar.json, trabajo/leer-mas.json, salida/ahora/
// `--ahora <ISO>` solo con RADAR_PRUEBAS=1 (pruebas).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, crearCarpeta, escribirTrabajo, leerTrabajo, escribirAviso } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { feriadosAnio, ventanaDelDia, fechaHoraET, minutosDe } from "../lib/tiempo.mjs";
import { configEfectiva } from "../lib/reglas.mjs";
import { lectura, armarGrupo, ts } from "../lib/db.mjs";
import { ACCION_REEMPLAZO } from "../lib/constantes.mjs";
import { esFecha } from "../lib/esquemas.mjs";
import { avisoFinDeSemana, avisoFeriado, AVISO_YA_HECHA, AVISO_TEMPRANO, AVISO_SIN_SEMILLA, fechaCorta } from "../lib/aviso.mjs";

const PASO = "00-preparar";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AYUDA = "Uso: node bin/00-preparar.mjs --fase lista --modo en_linea|archivo | --dir <carpeta> --fase decidir";
const TEMPRANO_MIN = minutosDe("09:40");
const LATIDO_VIVO_MS = 30 * 60000;
const OBLIGATORIOS = ["rutina-estado", "rutina-config", "cartera-libro", "etoro-mapa"];

// commit de la exportación (/home/user/rutina/<commit12>/…) o RADAR_COMMIT
export function commitDe(raiz = RAIZ) {
  const m = raiz.match(/\/rutina\/([0-9a-f]{12})\//);
  return m ? m[1] : process.env.RADAR_COMMIT && /^[0-9a-f]{7,40}$/.test(process.env.RADAR_COMMIT) ? process.env.RADAR_COMMIT.slice(0, 12) : null;
}

// Lista fija (§D.2): todos obligatorios; feriados-<año> (documento de la página) solo si el repo no trae el año
export function listaLectura(fecha, dirAbs) {
  const ids = OBLIGATORIOS.concat([`bitacora-mes-${fecha.slice(0, 7)}`]);
  const l = ids.map(id => lectura(id, { obligatoria: true, dirAbs }));
  if (!feriadosAnio({ anio: fecha.slice(0, 4) }).filas) l.push(lectura(`feriados-${fecha.slice(0, 4)}`, { obligatoria: false, dirAbs }));
  return l;
}

function relojDe(a, ahora) {
  if (a.ahora === undefined) return ahora;
  if (process.env.RADAR_PRUEBAS !== "1") throw Object.assign(new Error("--ahora solo se acepta en pruebas (RADAR_PRUEBAS=1)"), { codigo: "args" });
  const t = Date.parse(a.ahora);
  if (!Number.isFinite(t)) throw Object.assign(new Error("--ahora inválida"), { codigo: "args" });
  return () => t;
}

export async function main(argv, { ahora = Date.now, raiz = RAIZ, pagina = null, sesion = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--fase", "--ahora", "--modo"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const reloj = relojDe(a, ahora), t = reloj();
  if (a.fase === "lista") {
    if (!["en_linea", "archivo"].includes(a.modo)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
    if (a.modo === "archivo" && !ACCION_REEMPLAZO) return { codigo: 2, linea: lineaPaso({ paso: PASO, ok: false, accion: "sin_db", modo: a.modo, resumen: { texto: "modo archivo desactivado hasta D7" } }) };
    const fecha = fechaHoraET(t).fecha, base = path.join(raiz, ".trabajo"), dirAbs = path.join(base, fecha);
    crearCarpeta(dirAbs);
    const enlace = path.join(base, "hoy");
    try { fs.rmSync(enlace, { force: true }); } catch (e) { /* no existía */ }
    fs.symlinkSync(fecha, enlace);
    const lecturas = listaLectura(fecha, dirAbs);
    escribirTrabajo(dirAbs, "lista.json", { fecha, modo: a.modo, lecturas });
    return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "leer", modo: a.modo, resumen: { fechaET: fecha, n: lecturas.length }, extra: { dir: ".trabajo/hoy", fecha, lecturas } }) };
  }
  if (!a.dir || a.fase !== "decidir") return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), dirAbs = fs.realpathSync(dir), reg = crearRegistro({ dir, paso: PASO, ahora: reloj });
  const lista = leerTrabajo(dir, "lista.json"), modo = (lista && lista.modo) || "en_linea";
  const pag = pagina || cargarPagina(), C = pag.C, compat = { ok: pag.compatible, diferencias: pag.diferencias, pagina: pag.pagina };
  const et = C.etParts(t), fecha = et.date, anio = fecha.slice(0, 4);
  const linea = (codigo, accion, resumen, escribir = null) => ({ codigo, linea: lineaPaso({ paso: PASO, ok: codigo !== 1, accion, resumen, escribir, modo }) });

  // documentos de la lista
  const docs = Object.fromEntries(OBLIGATORIOS.concat([`bitacora-mes-${fecha.slice(0, 7)}`]).map(id => [id, leerDoc(dir, id)]));
  const re = docs["rutina-estado"], previo = re.estado === "ok" ? re.doc : null;
  const { config, alertas } = configEfectiva(docs["rutina-config"].estado === "ok" ? docs["rutina-config"].doc : null);
  const fdb = leerDoc(dir, `feriados-${anio}`);
  const fer = feriadosAnio({ anio, docDb: fdb.estado === "ok" ? fdb.doc : null });
  const calendario = fer.filas ? fer.fuente : "ausente";
  const feriados = fer.filas || [];
  const mercado = C.marketState(t, feriados);
  const ventana = ventanaDelDia({ C, ahoraMs: t, feriados, config });
  if (calendario === "ausente") { ventana.dentro = false; alertas.push(`Falta el calendario NYSE de ${anio}: hoy no se opera`); }
  const bmId = `bitacora-mes-${fecha.slice(0, 7)}`, bm = docs[bmId];
  if (bm.estado === "ok") for (const x of bm.doc.d) if (!(Array.isArray(x) && esFecha(x[0]))) alertas.push(`Entrada mala en ${bmId}: ${String(JSON.stringify(x)).slice(0, 40)}; se descarta.`);
  const prep = {
    fechaET: fecha, horaET: et.time, ahora: t, modo, commit: commitDe(raiz),
    mercado: { abierto: mercado.open && calendario !== "ausente", fase: mercado.phase, feriado: mercado.holiday, cierreAnticipado: mercado.earlyClose, cierreMs: mercado.closeMs, calendario },
    ventana, rutina: { accion: "continuar", motivoSalida: null, sesion: sesion || "s-" + crypto.randomBytes(4).toString("hex"), inicio: ts(t), previo: previo ? { fecha: previo.fecha, estado: previo.estado } : null },
    radar: { accion: compat.ok ? "correr" : "ninguno", motivo: compat.ok ? null : "pagina_cambio" }, compat,
    bloqueos: { libro: docs["cartera-libro"].estado !== "ok" }, recuperacion: { ejecuciones: [] }, config, alertas,
  };
  const salir = (motivo, aviso, estadoDoc = null) => {
    prep.rutina.accion = "salir"; prep.rutina.motivoSalida = motivo;
    let escribir = null;
    if (estadoDoc) escribir = armarGrupo({ dir, grupo: "ahora", docs: [{ id: "rutina-estado", data: estadoDoc }], modo }).escribir;
    escribirTrabajo(dir, "preparar.json", prep);
    escribirTrabajo(dir, "leer-mas.json", { lecturas: [] });
    escribirAviso(dir, aviso);
    reg.info(`salir: ${motivo}`);
    return linea(2, "salir", { motivo }, escribir);
  };
  const estadoBase = extra => Object.assign({ kind: "rutinaEstado", v: 2, fecha, estado: "en_curso", paso: "preparar", sesion: prep.rutina.sesion, inicio: ts(t), latido: ts(t), fin: null,
    commit: prep.commit, modo, ejecucionesAbiertas: previo && Array.isArray(previo.ejecucionesAbiertas) ? previo.ejecucionesAbiertas : [], previo: previo ? previo.previo || null : null,
    escritos: {}, motivo: null }, extra);

  // 1. integridad de los obligatorios
  const malos = Object.entries(docs).filter(([, d]) => d.estado === "corrupto" || d.estado === "fallo" || d.estado === "sin_leer");
  if (malos.length) {
    const [id, d] = malos[0];
    return salir("integridad", d.estado === "corrupto" ? `Radar · ${fechaCorta(fecha)} · Falla: el documento ${id} llegó dañado desde db; hoy no se operó.`
      : `Radar · ${fechaCorta(fecha)} · Falla: no se pudo leer ${id} de db; hoy no se operó.`);
  }
  // 2. fin de semana y feriado
  if (et.weekday === 0 || et.weekday === 6) return salir("fin_de_semana", avisoFinDeSemana(fecha));
  if (calendario !== "ausente" && !mercado.tradingDay) {
    return salir("feriado", avisoFeriado(fecha, mercado.holiday || "feriado"), estadoBase({ estado: "sin_mercado", paso: "cerrar", fin: ts(t), latido: null, motivo: "feriado" }));
  }
  // 3–6. hora, día ya hecho, otra sesión viva, recuperación
  if (et.minutes < TEMPRANO_MIN) return salir("temprano", AVISO_TEMPRANO);
  if (previo && previo.fecha === fecha && previo.estado === "hecha") return salir("ya_hecha", AVISO_YA_HECHA);
  if (previo && previo.fecha === fecha && previo.estado === "en_curso" && t - Date.parse(previo.latido || previo.inicio) < LATIDO_VIVO_MS) {
    const aviso = `Radar · ${fechaCorta(fecha)} · Otra sesión está corriendo la rutina de hoy; esta se detuvo.`;
    // misma exportación: la carpeta del día es de la sesión viva; esta no pisa sus archivos (nada en db, nada en la carpeta)
    if (leerTrabajo(dir, "preparar.json")) { reg.info("salir: otra_sesion_viva (carpeta en uso; no se toca)"); return linea(2, "salir", { motivo: "otra_sesion_viva", aviso }); }
    return salir("otra_sesion_viva", aviso);
  }
  if (previo && previo.estado === "en_curso") prep.rutina.accion = "recuperar";
  // 7. semilla
  if (docs["cartera-libro"].estado === "no_existe") return salir("sin_semilla", AVISO_SIN_SEMILLA);

  // continuar / recuperar: un solo set de rutina-estado (con ifVersion si existía)
  const abiertas = (previo && Array.isArray(previo.ejecucionesAbiertas) ? previo.ejecucionesAbiertas : []).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f));
  prep.recuperacion = { ejecuciones: abiertas };
  const g = armarGrupo({ dir, grupo: "ahora", docs: [{ id: "rutina-estado", data: estadoBase({ motivo: prep.rutina.accion === "recuperar" ? `recuperación de ${previo.fecha}` : null }) }], modo });
  // leer-mas: ejecuciones abiertas, ops de esas fechas y de los pendientes; con recuperar de hoy, los documentos del día
  const ids = [];
  for (const f of abiertas) ids.push(`ejecucion-${f}`, `ops-${f}`);
  const libro = docs["cartera-libro"].doc;
  for (const p of Array.isArray(libro.pend) ? libro.pend : []) if (p && /^\d{4}-\d{2}-\d{2}$/.test(p.dia)) ids.push(`ops-${p.dia}`);
  if (prep.rutina.accion === "recuperar" && previo.fecha === fecha) ids.push(`punto-${fecha}`, `radar-${fecha}`, `bitacora-${fecha}`, `ops-${fecha}`, `ejecucion-${fecha}`);
  escribirTrabajo(dir, "leer-mas.json", { lecturas: [...new Set(ids)].map(id => lectura(id, { obligatoria: true, dirAbs })) });
  escribirTrabajo(dir, "preparar.json", prep);
  reg.info("día decidido", { accion: prep.rutina.accion, ventana, calendario, abiertas });
  return linea(0, prep.rutina.accion, { radar: prep.radar.accion, mercado: mercado.phase, calendario, ventana: ventana.dentro, abiertas }, g.escribir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
