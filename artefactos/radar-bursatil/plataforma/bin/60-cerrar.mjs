// Paso 9 · Cerrar (12b §E.6 grupo final, §E.5, §H): ops, ejecución, libro, mapa, punto, radar, bitácora, bitácora del mes,
// rutina-estado (último) y aviso. Nunca lanza por datos de db (H15): ante un error de datos cierra en modo degradado.
// Uso: node bin/60-cerrar.mjs --dir <carpeta> [--degradado <paso>]
import path from "node:path";
import { pathToFileURL } from "node:url";
import { leerArgs, lineaPaso, correrCli, leerDoc, leerTrabajo, leerJson, escribirAviso, escribirTrabajo, rutas } from "../lib/archivos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { aplicarResultados, alertaPendiente, libroADb, mapaADb, opsNuevo, opsValidas } from "../lib/libro.mjs";
import { actualizarFuera, configEfectiva } from "../lib/reglas.mjs";
import { actualizarRefs } from "../lib/rendimientos.mjs";
import { validarNoticias } from "../lib/noticias.mjs";
import { resumenRadar, previoDe } from "../lib/radar-resumen.mjs";
import { armarAviso } from "../lib/aviso.mjs";
import { armarGrupo, leerVersiones, conH, lectura, presupuesto, bytes, usd, u6, p4, r6, precio, ts, sesionDe, escritoPorEstaSesion } from "../lib/db.mjs";
import { leerDiario, resDesdeDiario } from "../lib/diario.mjs";
import { fechaHoraET } from "../lib/tiempo.mjs";
import { esFecha } from "../lib/esquemas.mjs";
import { DOC_TOPES, PRESUPUESTO_DIA } from "../lib/constantes.mjs";

const PASO = "60-cerrar";
const AYUDA = "Uso: node bin/60-cerrar.mjs --dir <carpeta> [--degradado <paso>]";
export const TEXTO_FALLA = {
  preparar: "la preparación del día falló", radar: "el Radar no corrió; sin análisis de hoy", cartera: "sin datos de eToro; sin órdenes hoy",
  noticias: "no se juntaron noticias", decidir: "no se calcularon decisiones; sin órdenes", ejecucion: "no se guardó el reclamo de envío; no se ejecutó nada",
  ejecutar: "la ejecución no terminó; se concilia mañana", cerrar: "el cierre falló", db: "otra escritura cambió un documento; la rutina se detuvo",
};
// --degradado acepta cualquier nombre de paso: el cierre no puede fallar por cómo se llamó al paso que falló
export const pasoDegradado = x => (/^[a-z0-9-]{1,20}$/.test(String(x)) ? String(x) : "otro");
const textoFalla = paso => TEXTO_FALLA[paso] || `falló el paso ${paso}`;
const isNum = v => typeof v === "number" && Number.isFinite(v);
const ETQ = { 1: "Evitar", 2: "Mantener", 3: "Compra" };
const corto = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

function seguro(dir, nombre, errores) {
  try { return leerTrabajo(dir, nombre); } catch (e) { errores.push(["cerrar", `${nombre} ilegible`]); return null; }
}
const frase = c => (c[1] === "entra_objetivo" ? `${c[0]} entra al objetivo` : c[1] === "sale_objetivo" ? `${c[0]} sale del objetivo` : c[1] === "regimen" ? null : `${c[0]} pasa a ${ETQ[c[4]]}`);

// Bitácora ≤ 6 000 B: se recortan notas (8 → 4), resúmenes (→ 120), decisiones "mantener", comp.sector (§E.5.7). Si aun así
// no cabe (caso extremo, fuera de §E.5.7): alertas a 5, motivos de dec a 60 y notas a 2.
export function recortarBitacora(b) {
  const tope = DOC_TOPES.bitacora - 40, cabe = () => bytes(conH(b)) <= tope;
  if (!cabe()) b.notas = b.notas.slice(0, 4);
  if (!cabe()) b.notas = b.notas.map(n => n.slice(0, 5).concat([corto(n[5] || "", 120)]));
  if (!cabe()) b.dec = b.dec.filter(d => d[2] !== "mantener");
  if (!cabe()) delete b.comp.sector;
  if (!cabe()) b.alertas = b.alertas.slice(0, 5);
  if (!cabe()) b.dec = b.dec.map(d => d.slice(0, 7).concat([corto(d[7] || "", 60)]));
  if (!cabe()) b.notas = b.notas.slice(0, 2);
  return b;
}

function cerrar({ dir, a, t, reg }) {
  const errores = [], alertas = [];
  const prep = seguro(dir, "preparar.json", errores) || {};
  const fecha = prep.fechaET || fechaHoraET(t).fecha, mes = fecha.slice(0, 7), modo = prep.modo || "en_linea";
  const config = prep.config || configEfectiva(null).config;
  const analisis = seguro(dir, "analisis.json", errores), resumen0 = seguro(dir, "radar-resumen.json", errores), cartera = seguro(dir, "cartera.json", errores);
  const decis = seguro(dir, "decisiones.json", errores), planDoc = seguro(dir, "plan-ordenes.json", errores), ejec = seguro(dir, "ejecucion.json", errores);
  const nfmp = seguro(dir, "noticias-fmp.json", errores), temas = seguro(dir, "temas-noticias.json", errores);
  let notasDoc = null;
  try { notasDoc = leerJson(path.join(rutas(dir).entrada, "noticias.json")); } catch (e) { errores.push(["noticias", "json_invalido"]); }
  const out = analisis && analisis.out ? analisis.out : null;
  const fallas = [];
  if (a.degradado) { fallas.push({ paso: a.degradado, texto: textoFalla(a.degradado) }); errores.push([a.degradado, "degradado"]); }
  const carteraOk = !!(cartera && cartera.estado === "listo" && cartera.libro && cartera.valuacion);
  if (cartera && !carteraOk && a.degradado !== "cartera") fallas.push({ paso: "cartera", texto: cartera.estado === "sin_libro" ? "no se pudo leer cartera-libro; sin órdenes hoy" : TEXTO_FALLA.cartera });
  if (nfmp && Array.isArray(nfmp.errores) && nfmp.errores.length) errores.push(["30-fmp-noticias", "sin_fmp"]);
  if (!out) errores.push(["10-radar", (analisis && analisis.motivo) || "sin_radar"]);
  if (!notasDoc) errores.push(["noticias", "sin_notas"]);
  const re = leerDoc(dir, "rutina-estado"), estadoPrevio = re.estado === "ok" ? re.doc : null;
  const ver = leerVersiones(dir);
  const simulacion = decis ? decis.simulacion : !config.operar;
  const plan = planDoc && Array.isArray(planDoc.ordenes) ? planDoc.ordenes : [];
  // ejecución de hoy: escrita en pre-ejecución por ESTA sesión (N2: en carpeta compartida, la de otra sesión la concilia
  // 20-cartera) y sin ejecucion.json de esta sesión → queda abierta (F.5)
  const sesion = sesionDe(dir), ejecHoy = escritoPorEstaSesion(dir, `ejecucion-${fecha}`, "pre-ejecucion");
  const ejecP = ejec && Array.isArray(ejec.res) && ejec.sesion === sesion ? ejec : null;
  const abierta = ejecHoy && !ejecP;
  const docs = [];
  const poner = (id, data) => docs.push({ id, data });

  // ---- operaciones y libro ----
  let libro = carteraOk ? cartera.libro : null, opsIds = [], resultadosOps = [];
  if (carteraOk) {
    for (const [f, d] of Object.entries(cartera.ops || {})) if (f !== fecha) poner(`ops-${f}`, d);
    const hoyLeido = leerDoc(dir, `ops-${fecha}`);
    let opsHoy = (cartera.ops && cartera.ops[fecha]) || (hoyLeido.estado === "ok" ? hoyLeido.doc : opsNuevo(fecha));
    opsHoy = Object.assign({}, opsHoy, { ops: opsValidas(opsHoy, alertas) });
    const res = ejecP ? ejecP.res : [];
    if (plan.length && (simulacion || res.length)) {
      const r = aplicarResultados({ libro, opsHoy, plan, res, simulacion, ahora: t });
      libro = r.libro; opsHoy = r.ops;
      opsIds = plan.map(o => o.id);
      resultadosOps = r.ops.ops.filter(o => opsIds.includes(o.id));
    }
    if (opsHoy.ops.length) poner(`ops-${fecha}`, opsHoy);
    // cierre de ejecuciones: las abiertas que 20-cartera concilió (F.5) y la de hoy de esta sesión
    for (const [f, d] of Object.entries(cartera.ejecuciones || {})) poner(`ejecucion-${f}`, d);
    if (ejecHoy && ejecP && ejecP.doc) poner(`ejecucion-${fecha}`, Object.assign({}, ejecP.doc, { res: ejecP.res, fin: ts(t) }));
    // N11: abierta → queda sin fin, pero con lo que el diario sabe (qué salió, cuándo, con qué monto) para conciliarla mañana
    if (abierta) {
      const doc = leerTrabajo(dir, "ejecucion-doc.json");
      if (doc && conH(doc).h === ver[`ejecucion-${fecha}`].h) poner(`ejecucion-${fecha}`, Object.assign({}, doc, { res: resDesdeDiario(doc, leerDiario(path.join(rutas(dir).trabajo, "diario-ejecucion.jsonl"))), fin: null }));
    }
    for (const x of libro.pendientes) alertas.push(alertaPendiente(x));
    const faltantes = decis ? decis.decisiones.filter(d => /dato faltante/.test(d.razonOmision || "")).map(d => d.sym) : [];
    const completo = !!(out && !out.partial && decis && decis.objetivo && decis.objetivo.estado === "ok");
    libro = actualizarFuera({ libro, pesos: decis && decis.objetivo ? decis.objetivo.pesos : {}, completo, fecha, faltantes });
    const p = cartera.punto;
    if (p) libro.refs = actualizarRefs({ refs: libro.refs, punto: { f: p.f, v: p.v_, vm: p.vm, spy: p.spy, i: p.i, im: p.im } });
    poner("cartera-libro", libroADb(libro, t));
    if (cartera.mapaCambio && !(cartera.bloqueos && cartera.bloqueos.mapa)) poner("etoro-mapa", mapaADb(cartera.mapa, t));
    if (p) poner(`punto-${fecha}`, p);
  }
  // ---- radar del día (con el objetivo definitivo de 40-decidir si lo hay) ----
  const tenidos = libro ? [...new Set(libro.posiciones.filter(x => x.lotes.length).map(x => x.sym).concat(libro.pendientes.map(x => x.sym)))] : [];
  const radar = out ? resumenRadar({ out, estado: analisis.estado, motivo: analisis.motivo, llamadas: analisis.llamadas, t, f: fecha,
    objetivo: decis && decis.objetivo && decis.objetivo.estado === "ok" ? { pesos: decis.objetivo.pesos, roles: decis.roles || {} } : null, previo: estadoPrevio ? estadoPrevio.previo : null, tenidos })
    : Object.assign({}, resumen0 || resumenRadar({ estado: "sin_radar", motivo: (analisis && analisis.motivo) || "sin_radar", t, f: fecha }), { t: ts(t) });
  poner(`radar-${fecha}`, radar);

  // ---- noticias ----
  const simbolos = new Set([...(out ? out.rows.map(r => r.symbol) : []), ...tenidos, ...((temas && temas.simbolos) || []).map(x => x.sym)]);
  const nv = notasDoc ? validarNoticias({ doc: notasDoc, ahoraMs: t, ventanaH: config.noticiasVentanaH, simbolos: [...simbolos] }) : { validas: [], descartadas: [], eventos: [] };

  // ---- qué se puede escribir (sin lectura registrada no se escribe: H24) ----
  const delDia = [`punto-${fecha}`, `radar-${fecha}`, `bitacora-${fecha}`, `ops-${fecha}`, `ejecucion-${fecha}`];
  // N3: recuperar la sesión caída de OTRO día es la primera sesión de hoy (los documentos de hoy no existen): como continuar
  const previoDia = prep.rutina && prep.rutina.previo ? prep.rutina.previo.fecha : null;
  const accionDia = prep.rutina ? (prep.rutina.accion === "recuperar" && previoDia !== fecha ? "continuar" : prep.rutina.accion) : null;
  // N5: lo que no coincidió con lo escrito por la sesión anterior no se reescribe hoy
  const desact = (prep.bloqueos && prep.bloqueos.desactualizados) || [];
  for (const id of desact) alertas.push(`${id} no se escribe hoy: no coincide con el que escribió la sesión anterior.`);
  const escribible = id => { const v = ver[id]; return (v && (v.estado === "ok" || v.estado === "no_existe")) || (!v && delDia.includes(id) && accionDia === "continuar"); };
  const bmId = `bitacora-mes-${mes}`;
  for (const id of docs.map(d => d.id).concat([`bitacora-${fecha}`, bmId])) if (!escribible(id)) alertas.push(`no se leyó ${id}; no se escribe`);

  // ---- aviso ----
  const v = carteraOk ? cartera.valuacion : null, rend = carteraOk ? cartera.rendimientos : null;
  const opsAviso = simulacion ? plan.map(o => ({ sym: o.sym, lado: o.lado, regla: o.regla, est: "simulada" }))
    : resultadosOps.map(o => ({ sym: o.sym, lado: o.lado === "c" ? "compra" : "venta", regla: o.regla, est: o.est, motivo: o.err || (o.est === "no_enviada" ? "no enviada" : o.est) }));
  if (!simulacion && !resultadosOps.length && plan.length && !ejecP) for (const o of plan) opsAviso.push({ sym: o.sym, lado: o.lado, regla: o.regla, est: "no_enviada", motivo: abierta ? "sin confirmar" : "no enviada" });
  const pri = c => (c[1] !== "senal" ? 0 : (radar.obj || []).some(x => x[0] === c[0]) || tenidos.includes(c[0]) ? 1 : 2);
  const notasAviso = nv.eventos.filter(e => e.confirmado).map(e => nv.validas.find(n => n.evento && n.evento.simbolo === e.simbolo && n.evento.categoria === e.categoria))
    .concat(nv.validas.filter(n => n.tema === "macro" || n.tema === "mercado").sort((x, y) => (x.fecha < y.fecha ? 1 : -1))).filter(Boolean);
  const alertasTodas = [...new Set([...(prep.alertas || []), ...((cartera && cartera.alertas) || []), ...((decis && decis.alertas) || []), ...alertas])];
  if (abierta) alertasTodas.push(`La ejecución de hoy quedó abierta (sin resultado): se concilia mañana.`);
  // H15: entradas malas de db (descartadas con alerta) dejan el día degradado; la entrada mala no se reescribe
  let malos = (cartera && cartera.datosMalos) || 0;
  const bmLeido = leerDoc(dir, bmId);
  const previas = bmLeido.estado === "ok" ? bmLeido.doc.d.filter(x => {
    const ok = Array.isArray(x) && esFecha(x[0]) && x[0].slice(0, 7) === mes;
    if (!ok) { malos++; const txt = `Entrada mala en ${bmId}: ${String(JSON.stringify(x)).slice(0, 40)}; se descarta.`; if (!alertasTodas.includes(txt)) alertasTodas.push(txt); }
    return ok;
  }) : [];
  malos += alertas.filter(x => /^Operación mal formada/.test(x)).length;
  const degradada = !!a.degradado || !carteraOk || !decis || abierta || malos > 0;
  const estado = degradada ? "degradada" : (!out || out.partial || errores.some(e => e[0] === "30-fmp-noticias" || e[0] === "noticias")) ? "parcial" : "completa";
  const aviso = armarAviso({
    fecha, hora: fechaHoraET(t).hora, simulacion, cartera: v ? { valorUSD: v.valorUSD, valorMXN: v.valorMXN } : null, rend,
    radar: out ? { regimen: radar.reg && radar.reg.l, cambios: (radar.cambios || []).slice().sort((x, y) => pri(x) - pri(y)).map(frase).filter(Boolean) } : { sinRadar: true, motivo: radar.motivo },
    notas: [...new Set(notasAviso)].slice(0, 2).map(n => ({ titulo: n.titulo, medio: n.medio })), operaciones: opsAviso, alertas: alertasTodas, fallas,
  });

  // ---- bitácora ----
  const dec = decis ? decis.decisiones.map(d => [d.sym, d.regla, d.accion, p4(d.pesoActual), p4(d.pesoObjetivo), red2(d.desvPts), d.montoUSD === null ? null : usd(d.montoUSD), corto(d.motivo || d.razonOmision || "", 120)]) : [];
  const comp = c => Object.entries(c || {}).map(([k, w]) => [k, p4(w)]);
  const vetos = decis ? decis.decisiones.filter(d => d.accion === "vetada" || d.regla === "N2").map(d => {
    const e = nv.eventos.find(x => x.confirmado && x.simbolo === d.sym);
    return [d.sym, e ? e.categoria : null, d.accion === "vetada" ? "veto_compra" : "N2", (d.noticias || []).slice(0, 2)];
  }) : [];
  const bit = recortarBitacora({
    kind: "bitacora", v: 2, f: fecha, t: ts(t), estado, sim: simulacion, commit: prep.commit || null, modo,
    mercado: { abierto: !!(prep.mercado && prep.mercado.abierto), cal: (prep.mercado && prep.mercado.calendario) || null, horaET: prep.horaET || null },
    radar: { estado: radar.estado, motivo: radar.motivo || null },
    cartera: v ? { v_: usd(v.valorUSD), vm: usd(v.valorMXN), fx: v.fx, fxFuente: v.fxFuente, e: usd(v.efectivoUSD),
      pos: v.posiciones.map(x => [x.sym, u6(x.unidades), usd(x.costoUSD), precio(x.precioUSD), usd(x.valorUSD), p4(x.peso)]) } : {},
    rend: rend ? { usd: rend.usd.map(r6), mxn: rend.mxn.map(r6), spy: rend.spy.map(r6), meta: [usd(rend.meta[0]), red2(rend.meta[1]), usd(rend.meta[2]), red2(rend.meta[3])], aviso: rend.aviso } : {},
    comp: carteraOk ? { clase: comp(cartera.composicion.clase), sector: comp(cartera.composicion.sector), region: comp(cartera.composicion.region) } : {},
    notas: nv.validas.slice(0, 8).map(n => [corto(n.titulo, 160), n.medio, n.url, n.fecha, n.tema, corto(n.resumen, 200)]),
    eventos: ((nfmp && nfmp.economico) || []).slice(0, 6).map(e => [String(e.fecha || "").slice(0, 10), e.pais, corto(e.evento, 60)]),
    vetos, dec, ops: opsIds, alertas: alertasTodas.slice(0, 10).map(x => corto(x, 160)), errores: errores.slice(0, 8), aviso, presupuesto: 0,
  });
  // bitácora del mes: entradas válidas (filtradas arriba) + la de hoy
  const nReales = simulacion ? 0 : resultadosOps.filter(o => ["ejecutada", "aceptada", "incierta"].includes(o.est)).length;
  const bm = { kind: "bitacoraMes", v: 1, mes, d: previas.filter(x => x[0] !== fecha).concat([[fecha, estado, v ? usd(v.valorUSD) : null, rend && isNum(rend.usd[0]) ? r6(rend.usd[0]) : null, nReales, simulacion ? 1 : 0]]).sort((x, y) => (x[0] < y[0] ? -1 : 1)) };
  docs.push({ id: `bitacora-${fecha}`, data: bit }, { id: bmId, data: bm });
  for (const d of docs.slice()) if (!escribible(d.id) || desact.includes(d.id)) docs.splice(docs.indexOf(d), 1);
  // presupuesto estimado del día (lecturas + grupos anteriores + este grupo)
  const p0 = presupuesto(dir), finalBytes = docs.reduce((s, d) => s + bytes(conH(d.data)), 0) + 1600;
  // §E.10/§O: la bitácora lleva el presupuesto estimado del día (lo medido después lo da db.mjs presupuesto)
  bit.presupuesto = p0.total + finalBytes;
  if (bit.presupuesto > PRESUPUESTO_DIA) { bit.alertas.unshift(`Presupuesto de copia del día ≈ ${bit.presupuesto} B (> ${PRESUPUESTO_DIA})`); recortarBitacora(bit); }
  // ---- rutina-estado (último) ----
  // ejecuciones abiertas (N1, N2): las de la lista previa, toda ejecucion-<f> leída sin fin y la de hoy si quedó abierta;
  // salen solo si su cierre (con fin) va en este grupo o si se leyó que no existe
  const cerradas = new Set(docs.filter(d => /^ejecucion-/.test(d.id) && d.data.fin).map(d => d.id.slice("ejecucion-".length)));
  const leidasAbiertas = [], noExisten = new Set();
  for (const [id, v] of Object.entries(ver)) {
    const m = id.match(/^ejecucion-(\d{4}-\d{2}-\d{2})$/);
    if (!m) continue;
    if (v.estado === "no_existe") noExisten.add(m[1]);
    else if (v.estado === "ok") { const r = leerDoc(dir, id); if (r.estado === "ok" && r.doc.fin === null) leidasAbiertas.push(m[1]); }
  }
  const abiertas = [...new Set((estadoPrevio && Array.isArray(estadoPrevio.ejecucionesAbiertas) ? estadoPrevio.ejecucionesAbiertas : []).concat(leidasAbiertas, abierta ? [fecha] : []))]
    .filter(f => esFecha(f) && !cerradas.has(f) && !noExisten.has(f) && (f !== fecha || abierta || leidasAbiertas.includes(f))).sort();
  // escritos (§E.5.1): h de este grupo + los de los documentos de lectura diaria que hoy no se reescribieron (salvo los desactualizados)
  const escritos = Object.fromEntries(docs.map(d => [d.id, conH(d.data).h]));
  const persistentes = id => id === "cartera-libro" || id === "etoro-mapa" || /^bitacora-mes-/.test(id);
  for (const [id, h] of Object.entries((estadoPrevio && estadoPrevio.escritos) || {})) if (persistentes(id) && !(id in escritos) && !desact.includes(id) && typeof h === "string") escritos[id] = h;
  const estadoFin = { kind: "rutinaEstado", v: 2, fecha, estado: degradada ? "degradada" : "hecha", paso: "cerrar", sesion: (prep.rutina && prep.rutina.sesion) || "s-desconocida",
    inicio: (prep.rutina && prep.rutina.inicio) || ts(t), latido: ts(t), fin: ts(t), commit: prep.commit || null, modo, ejecucionesAbiertas: abiertas,
    previo: previoDe(radar) || (estadoPrevio ? estadoPrevio.previo || null : null), escritos, motivo: a.degradado ? `degradado: ${a.degradado}` : null };
  docs.push({ id: "rutina-estado", data: estadoFin });
  const g = armarGrupo({ dir, grupo: "final", docs, modo, delDia, accionDia });
  escribirAviso(dir, aviso);
  escribirTrabajo(dir, "verificar.json", { lecturas: [lectura("rutina-estado", { obligatoria: true, dirAbs: path.resolve(dir) })] });
  reg.info("cierre listo", { estado, docs: docs.map(d => d.id), omitidos: g.omitidos });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "listo", modo, resumen: { estado, docs: g.ops, omitidos: g.omitidos.map(o => o.id), aviso: aviso.length }, escribir: g.escribir }) };
}
const red2 = x => (isNum(x) ? Math.round(x * 100) / 100 : null);

// Cierre mínimo si el normal falla por datos (H15): bitácora degradada, bitácora del mes y rutina-estado
function cerrarMinimo({ dir, t, error, a }) {
  const prep = (() => { try { return leerTrabajo(dir, "preparar.json") || {}; } catch (e) { return {}; } })();
  const fecha = prep.fechaET || fechaHoraET(t).fecha, mes = fecha.slice(0, 7), modo = prep.modo || "en_linea";
  const aviso = armarAviso({ fecha, hora: fechaHoraET(t).hora, simulacion: true, cartera: null, rend: null, radar: null, notas: [], operaciones: [], alertas: [],
    fallas: [{ paso: a.degradado || "cerrar", texto: a.degradado ? textoFalla(a.degradado) : TEXTO_FALLA.cerrar }, ...(a.degradado && a.degradado !== "cerrar" ? [{ paso: "cerrar", texto: TEXTO_FALLA.cerrar }] : [])] });
  const re = leerDoc(dir, "rutina-estado"), previo = re.estado === "ok" ? re.doc : null;
  const bit = { kind: "bitacora", v: 2, f: fecha, t: ts(t), estado: "degradada", sim: true, commit: prep.commit || null, modo, mercado: {}, radar: { estado: "sin_radar", motivo: null },
    cartera: {}, rend: {}, comp: {}, notas: [], eventos: [], vetos: [], dec: [], ops: [], alertas: [corto(`Cierre mínimo: ${error}`, 160)], errores: [["cerrar", "datos"]], aviso };
  const bmLeido = leerDoc(dir, `bitacora-mes-${mes}`);
  const previas = bmLeido.estado === "ok" ? bmLeido.doc.d.filter(x => Array.isArray(x) && esFecha(x[0]) && x[0].slice(0, 7) === mes && x[0] !== fecha) : [];
  const docs = [{ id: `bitacora-${fecha}`, data: bit }, { id: `bitacora-mes-${mes}`, data: { kind: "bitacoraMes", v: 1, mes, d: previas.concat([[fecha, "degradada", null, null, 0, 1]]) } }];
  docs.push({ id: "rutina-estado", data: { kind: "rutinaEstado", v: 2, fecha, estado: "degradada", paso: "cerrar", sesion: (prep.rutina && prep.rutina.sesion) || "s-desconocida", inicio: (prep.rutina && prep.rutina.inicio) || ts(t),
    latido: ts(t), fin: ts(t), commit: prep.commit || null, modo, ejecucionesAbiertas: previo && Array.isArray(previo.ejecucionesAbiertas) ? previo.ejecucionesAbiertas.filter(esFecha) : [],
    previo: previo ? previo.previo || null : null, escritos: {}, motivo: corto(`cierre mínimo: ${error}`, 120) } });
  const g = armarGrupo({ dir, grupo: "final", docs, modo, delDia: [`bitacora-${fecha}`], accionDia: prep.rutina ? prep.rutina.accion : null });
  escribirAviso(dir, aviso);
  escribirTrabajo(dir, "verificar.json", { lecturas: [lectura("rutina-estado", { obligatoria: true, dirAbs: path.resolve(dir) })] });
  return { codigo: 0, linea: lineaPaso({ paso: PASO, ok: true, accion: "listo", modo, resumen: { estado: "degradada", minimo: true, docs: g.ops }, escribir: g.escribir }) };
}

export async function main(argv, { ahora = Date.now } = {}) {
  const a = leerArgs(argv, { valores: ["--dir", "--degradado"] });
  if (a.ayuda) { process.stdout.write(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  if (!a.dir) return { codigo: 1, linea: lineaPaso({ paso: PASO, ok: false, accion: "error", resumen: { texto: AYUDA } }) };
  if (a.degradado !== undefined) a.degradado = pasoDegradado(a.degradado);
  const dir = path.resolve(a.dir), reg = crearRegistro({ dir, paso: PASO, ahora }), t = ahora();
  try { return cerrar({ dir, a, t, reg }); }
  catch (e) {
    reg.error("cierre normal falló; cierre mínimo", { error: String(e.message || e).slice(0, 200) });
    return cerrarMinimo({ dir, t, error: String(e.message || e), a });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) correrCli(main, PASO);
