// Paso 1/3/4 · Preparar (12-plan §5.2, §4.4, §5.11.1).
//   node bin/00-preparar.mjs --fase lista               → crea la carpeta del día e imprime {dir, leer}
//   node bin/00-preparar.mjs --dir D --fase decidir     → trabajo/preparar.json, leer-mas.json, salida/ahora/
//   node bin/00-preparar.mjs --dir D --fase radar       → vuelve a decidir solo el Radar (tras esperar)
// `--ahora <ISO>` solo con RADAR_PRUEBAS=1 (pruebas).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerFallos, crearCarpeta, escribirTrabajo, leerTrabajo, limpiarGrupo, escribirDoc, escribirAviso, bytesDe } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { feriadosAnio, ventanaDelDia, fechaHoraET, mesDe, minutosDe } from "../lib/tiempo.mjs";
import { configEfectiva } from "../lib/reglas.mjs";
import { DEV } from "../lib/constantes.mjs";
import { avisoFinDeSemana, avisoFeriado, AVISO_YA_HECHA, AVISO_TEMPRANO, AVISO_SIN_SEMILLA } from "../lib/aviso.mjs";

const PASO = "00-preparar";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AYUDA = "Uso: node bin/00-preparar.mjs --fase lista | --dir <carpeta> --fase decidir | --dir <carpeta> --fase radar";
const TEMPRANO_MIN = minutosDe("09:40");
const MAX_ESPERAS = 3;

export function listaLectura(fecha) {
  const anio = fecha.slice(0, 4), mes = mesDe(fecha);
  return ["rutina-estado", "rutina-config", "cartera-libro", `cartera-serie-${anio}`, `operaciones-${mes}`, "etoro-mapa", "bitacora-indice", "corrida", "indice",
    `dia-${fecha}`, `feriados-${anio}`, "plan", `contador-${DEV}`, "preferencias"];
}

const manifiestoValido = (m, fecha) => !!m && m.kind === "dia" && typeof m.meta === "object" && m.meta && typeof m.runId === "string" && Array.isArray(m.parts) &&
  m.parts.length > 0 && m.parts.every(p => p && typeof p.id === "string" && p.id.startsWith(`dia-${fecha}-p`));

// §4.4. conPartes: las partes del día ya se leyeron (fase radar) y joinDay debe dar algo.
export function decidirRadar({ C, dir, fecha, ahoraMs, compat, conPartes, esperas = 0 }) {
  const corrida = leerDoc(dir, "corrida"), dia = leerDoc(dir, `dia-${fecha}`);
  const c = corrida.estado === "ok" ? corrida.doc : null, m = dia.estado === "ok" ? dia.doc : null;
  let valido = manifiestoValido(m, fecha);
  if (valido && conPartes) {
    const partes = m.parts.map(p => leerDoc(dir, p.id)).filter(x => x.estado === "ok").map(x => x.doc);
    let out = null; try { out = C.joinDay(m, partes); } catch (e) { out = null; }
    valido = !!out;
  }
  const parcial = valido && !!m.partial;
  if (c && c.dateET === fecha && C.runAlive(c, ahoraMs)) {
    if (esperas >= MAX_ESPERAS) return { accion: valido ? "usar_navegador" : "sin_radar", motivo: "corrida del navegador sigue viva tras 3 esperas" };
    return { accion: "esperar", motivo: "corrida del navegador en curso" };
  }
  if (!compat.ok) return valido ? { accion: "usar_navegador", motivo: "pagina_cambio" } : { accion: "sin_radar", motivo: "pagina_cambio" };
  if (corrida.estado === "fallo" || dia.estado === "fallo") return { accion: "correr", motivo: "no se pudo leer corrida o el día; se corre" };
  if (valido && !parcial && c && c.dateET === fecha && c.state === "done") return { accion: "usar_navegador", motivo: null };
  if (valido && parcial) return { accion: "correr", motivo: "el día del navegador es parcial" };
  return { accion: "correr", motivo: null };
}

const reclamo = (fecha, runId, t) => ({ kind: "corrida", v: 1, dateET: fecha, plan: "STARTER", state: "running", auto: true, dev: DEV, runId, startedAt: t, beatAt: t, finishedAt: null, reason: null });

function relojDe(a, ahora) {
  if (a.ahora === undefined) return ahora;
  if (process.env.RADAR_PRUEBAS !== "1") throw Object.assign(new Error("--ahora solo se acepta en pruebas (RADAR_PRUEBAS=1)"), { codigo: "args" });
  const t = Date.parse(a.ahora);
  if (!Number.isFinite(t)) throw Object.assign(new Error("--ahora inválida"), { codigo: "args" });
  return () => t;
}

export async function main(argv, { ahora = Date.now, raiz = RAIZ, pagina = null } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--fase", "--ahora"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const reloj = relojDe(a, ahora), t = reloj();
  if (a.fase === "lista") {
    const fecha = fechaHoraET(t).fecha, rel = path.join(".trabajo", fecha);
    crearCarpeta(path.join(raiz, rel));
    const leer = listaLectura(fecha);
    return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "leer", resumen: { fechaET: fecha, n: leer.length }, extra: { dir: rel, leer } }) };
  }
  if (!a.dir || !["decidir", "radar"].includes(a.fase)) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora: reloj });
  const pag = pagina || cargarPagina(), C = pag.C, compat = { ok: pag.compatible, diferencias: pag.diferencias, pagina: pag.pagina };
  const et = C.etParts(t), fecha = et.date, anio = fecha.slice(0, 4);

  if (a.fase === "radar") {
    const prev = leerTrabajo(dir, "preparar.json");
    if (!prev) throw Object.assign(new Error("falta trabajo/preparar.json"), { codigo: "sin_preparar" });
    const esperas = (prev.radar && prev.radar.accion === "esperar" ? prev.radar.esperas || 0 : 0) + 1;
    const r = decidirRadar({ C, dir, fecha, ahoraMs: t, compat, conPartes: true, esperas });
    prev.radar = Object.assign({}, prev.radar, r, { esperas });
    if (r.accion === "correr") {
      prev.radar.runId = `${DEV}-rutina-${t}`; prev.radar.startedAt = t;
      escribirTrabajo(dir, "corrida-error.json", Object.assign(reclamo(fecha, prev.radar.runId, t), { state: "error", finishedAt: t, reason: "rutina_sin_salida" }));
    }
    escribirTrabajo(dir, "preparar.json", prev);
    reg.info("radar decidido", prev.radar);
    return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: r.accion, resumen: { esperas, motivo: r.motivo } }) };
  }

  // ---- fase decidir ----
  const fer = feriadosAnio({ anio, docDb: leerDoc(dir, `feriados-${anio}`).doc });
  const feriados = fer.filas, mercado = C.marketState(t, feriados);
  const rc = leerDoc(dir, "rutina-config"), { config, alertas } = configEfectiva(rc.estado === "ok" ? rc.doc : null);
  const ventana = ventanaDelDia({ C, ahoraMs: t, feriados, config });
  const re = leerDoc(dir, "rutina-estado"), previo = re.estado === "ok" ? re.doc : null;
  const fallos = leerFallos(dir);
  if (re.estado === "fallo") alertas.push("rutina-estado no se pudo leer: se continúa (operadoHoy evita repetir órdenes).");
  const prep = {
    fechaET: fecha, horaET: et.time, ahora: t,
    mercado: { abierto: mercado.open, fase: mercado.phase, feriado: mercado.holiday, cierreAnticipado: mercado.earlyClose, cierreMs: mercado.closeMs },
    ventana, rutina: { estadoPrevio: previo ? { fecha: previo.fecha, estado: previo.estado, paso: previo.paso } : null, accion: "continuar", motivoSalida: null, inicio: t, intentos: 1 },
    radar: { accion: "sin_radar", motivo: null, esperas: 0, runId: null }, compat,
    bloqueos: { libro: "cartera-libro" in fallos, serie: `cartera-serie-${anio}` in fallos, ops: `operaciones-${mesDe(fecha)}` in fallos },
    recuperacion: null, config, feriados: { fuente: fer.fuente }, alertas,
  };
  limpiarGrupo(dir, "ahora");
  const estadoDoc = (estado, extra = {}) => Object.assign({ kind: "rutinaEstado", v: 1, fecha, estado, paso: "preparar", inicio: t, fin: null, intentos: prep.rutina.intentos,
    ejecucion: { inicio: null, simulacion: !config.operar, planSha: null, plan: [] }, motivo: null }, extra);
  const salir = (motivo, aviso, escribirEstado) => {
    prep.rutina.accion = "salir"; prep.rutina.motivoSalida = motivo;
    if (escribirEstado) escribirDoc(dir, "ahora", "rutina-estado", estadoDoc("sin_mercado", { paso: "cerrar", fin: t, motivo }));
    escribirTrabajo(dir, "preparar.json", prep);
    escribirAviso(dir, aviso);
    reg.info(`salir: ${motivo}`);
    return { codigo: 2, linea: lineaPaso({ paso: PASO, ok: true, accion: "salir", resumen: { motivo }, escribir: escribirEstado ? "salida/ahora/_orden.json" : null }) };
  };
  if (et.weekday === 0 || et.weekday === 6) return salir("fin_de_semana", avisoFinDeSemana(fecha), true);
  if (!mercado.tradingDay) return salir("feriado", avisoFeriado(fecha, mercado.holiday || "feriado"), true);
  if (et.minutes < TEMPRANO_MIN) return salir("temprano", AVISO_TEMPRANO, false);
  if (previo && previo.fecha === fecha && ["hecha", "degradada", "sin_mercado"].includes(previo.estado)) return salir("ya_hecha", AVISO_YA_HECHA, false);
  const libro = leerDoc(dir, "cartera-libro");
  if (libro.estado === "no_existe") return salir("sin_semilla", AVISO_SIN_SEMILLA, false);

  // recuperación: una sesión anterior quedó en curso (de hoy o de otro día) con plan enviado o por enviar
  if (previo && previo.estado !== "hecha" && previo.estado !== "degradada" && previo.estado !== "sin_mercado") {
    if (previo.fecha === fecha) { prep.rutina.accion = "recuperar"; prep.rutina.intentos = (previo.intentos || 1) + 1; }
    const planes = [].concat(previo.recuperacion && Array.isArray(previo.recuperacion.plan) ? previo.recuperacion.plan : [], previo.ejecucion && Array.isArray(previo.ejecucion.plan) ? previo.ejecucion.plan : []);
    if (planes.length) {
      const inicios = [previo.recuperacion && previo.recuperacion.inicio, previo.ejecucion && previo.ejecucion.inicio].filter(Number.isFinite);
      prep.recuperacion = { de: (previo.recuperacion && previo.recuperacion.de) || previo.fecha, inicio: inicios.length ? Math.min(...inicios) : previo.inicio, plan: planes };
    }
  }
  const r = decidirRadar({ C, dir, fecha, ahoraMs: t, compat, conPartes: false });
  prep.radar = Object.assign({ esperas: 0, runId: null }, r);
  escribirDoc(dir, "ahora", "rutina-estado", estadoDoc("en_curso", prep.recuperacion ? { recuperacion: prep.recuperacion, motivo: `recuperación de ${prep.recuperacion.de}` } : {}));
  if (r.accion === "correr") {
    const runId = `${DEV}-rutina-${t}`;
    prep.radar.runId = runId; prep.radar.startedAt = t;
    escribirDoc(dir, "ahora", "corrida", reclamo(fecha, runId, t));
    escribirTrabajo(dir, "corrida-error.json", Object.assign(reclamo(fecha, runId, t), { state: "error", finishedAt: t, reason: "rutina_sin_salida" }));
  }
  // lecturas adicionales
  const leer = [];
  const m = leerDoc(dir, `dia-${fecha}`);
  if (m.estado === "ok" && manifiestoValido(m.doc, fecha)) leer.push(...m.doc.parts.map(p => p.id));
  const bi = leerDoc(dir, "bitacora-indice");
  if (bi.estado === "ok" && Array.isArray(bi.doc.dias) && bi.doc.dias.length) leer.push(`bitacora-${bi.doc.dias[0].f}`);
  if (libro.estado === "ok") {
    const meses = new Set((libro.doc.pendientes || []).map(p => (p.opId && /^\d{4}-\d{2}/.test(p.opId) ? p.opId.slice(0, 7) : String(p.enviadaEl || "").slice(0, 7))).filter(x => /^\d{4}-\d{2}$/.test(x) && x !== mesDe(fecha)));
    for (const mm of [...meses].sort()) leer.push(`operaciones-${mm}`);
  }
  const ops = leerDoc(dir, `operaciones-${mesDe(fecha)}`);
  if (ops.estado === "ok" && bytesDe(ops.doc) > 140000) leer.push(`operaciones-${mesDe(fecha)}-2`);
  if (fecha.slice(5, 7) === "01") leer.push(`cartera-serie-${Number(anio) - 1}`);
  escribirTrabajo(dir, "leer-mas.json", { leer: [...new Set(leer)] });
  escribirTrabajo(dir, "preparar.json", prep);
  reg.info("día decidido", { accion: prep.rutina.accion, radar: prep.radar.accion, ventana, bloqueos: prep.bloqueos });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: prep.rutina.accion, resumen: { radar: prep.radar.accion, mercado: mercado.phase, ventana: ventana.dentro, bloqueos: prep.bloqueos },
    escribir: "salida/ahora/_orden.json" }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
