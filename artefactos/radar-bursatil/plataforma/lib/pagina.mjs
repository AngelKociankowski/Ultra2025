// Análisis que guardó la página del Radar en db (12c §C): solo lectura, a archivo. Validación determinista (§C.3) y la máquina de
// estados de `10-radar --modo pagina` (§C.4). Ningún dato ni texto de estas lecturas pasa por el modelo: la sesión llama a
// ArtifactData con los `args` exactos y los archivos quedan en el `out_dir` de cada ronda.
import fs from "node:fs";
import path from "node:path";
import { ARTEFACTO_URL, COLECCION_ARCHIVO } from "./constantes.mjs";
import { crearValidarSalida } from "./esquemas.mjs";
import { diasHabilesEntre } from "./tiempo.mjs";
import { leerJson, escribirJson, rutas } from "./archivos.mjs";

export const MAX_RONDAS = 6, MAX_ANTIGUEDAD = 5, MAX_CANDIDATOS = 2;
const esFecha = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

// días hábiles NYSE entre `fecha` y el último día hábil ≤ hoy (el mismo día = 0)
export const antiguedadDe = (fecha, hoy, feriados) => diasHabilesEntre(fecha, hoy, feriados);

// §C.3.1–2: entradas válidas del índice y candidatos (≤ hoy, antigüedad ≤ 5, descendente, a lo más 2)
export function candidatosDeIndice(indice, { hoy, feriados }) {
  const alertas = [];
  if (!isObj(indice) || indice.kind !== "indice" || !Array.isArray(indice.dias)) return { candidatos: [], alertas, motivo: "sin_indice" };
  const validas = [];
  for (const d of indice.dias) {
    if (isObj(d) && esFecha(d.dateET) && Number.isInteger(d.parts) && d.parts >= 1) validas.push(d);
    else alertas.push(`Entrada del índice de la página ignorada: ${String(JSON.stringify(d)).slice(0, 60)}`);
  }
  const pasadas = validas.filter(d => d.dateET <= hoy).sort((a, b) => (a.dateET < b.dateET ? 1 : -1));
  const candidatos = pasadas.filter(d => antiguedadDe(d.dateET, hoy, feriados) <= MAX_ANTIGUEDAD).slice(0, MAX_CANDIDATOS).map(d => ({ fecha: d.dateET, parts: d.parts }));
  return { candidatos, alertas, motivo: candidatos.length ? null : pasadas.length ? "analisis_viejo" : "sin_candidato" };
}

// §C.3.3: manifiesto dia-<f>
export function validarManifiesto(C, m, fecha) {
  if (!isObj(m) || m.kind !== "dia") return "forma";
  if (m.v !== C.CONFIG.DAY_SCHEMA_VERSION) return "version_dia";
  if (m.dateET !== fecha || typeof m.runId !== "string" || !m.runId || !isObj(m.meta) || !Array.isArray(m.parts) || !m.parts.length) return "forma";
  if (!m.parts.every((p, k) => isObj(p) && p.id === `dia-${fecha}-p${k}` && ["rows", "rest", "series"].includes(p.kind))) return "forma";
  return null;
}

// §C.3.4–7: partes, joinDay, validOutput, antigüedad con asOf y parcial
export function validarDia({ C, fecha, manifiesto, partes, hoy, feriados }) {
  const m = validarManifiesto(C, manifiesto, fecha);
  if (m) return { ok: false, motivo: m };
  const usadas = [];
  for (const [k, d] of manifiesto.parts.entries()) {
    const p = partes[d.id];
    if (!p) { if (d.kind === "series") continue; return { ok: false, motivo: "partes_incompletas" }; }
    if (!isObj(p) || p.kind !== "diaParte" || p.v !== manifiesto.v || p.dateET !== fecha || p.runId !== manifiesto.runId || p.k !== k) return { ok: false, motivo: "forma" };
    usadas.push(p);
  }
  const out = C.joinDay(manifiesto, usadas);
  if (!out || !crearValidarSalida(C)(out) || !out.rows.length) return { ok: false, motivo: "forma" };
  const antiguedad = antiguedadDe(out.asOf, hoy, feriados);
  if (antiguedad > MAX_ANTIGUEDAD) return { ok: false, motivo: "analisis_viejo" };
  return { ok: true, motivo: null, out, antiguedad, parcial: manifiesto.partial === true };
}

// ---- máquina de estados (§C.4) ----
// estado: { sesion, rondas:[{n, tipo, fecha, out_dir, ids}], candidatos, i, motivos, alertas, fin }
const args = (id, outDir) => ({ action: "get", url: ARTEFACTO_URL, collection: COLECCION_ARCHIVO, doc_id: id, out_dir: outDir });
const leerDe = (outDir, id) => { try { return leerJson(path.join(outDir, "data", "users", "me", id + ".json")); } catch (e) { return null; } };

// avanza un paso: procesa la última ronda emitida (si la hay) y devuelve la siguiente lista o el final.
// Resultado: { accion: "leer", lista } | { accion: "listo"|"parcial", analisis } | { accion: "sin_radar", motivo }
export function pasoPagina({ C, dir, sesion, hoy, feriados }) {
  const R = rutas(dir), fEstado = path.join(R.trabajo, "pagina-estado.json"), base = path.join(fs.realpathSync(dir), "entrada", "pagina");
  let st = null;
  try { st = leerJson(fEstado); } catch (e) { st = null; }
  if (!st || st.sesion !== sesion) {
    fs.rmSync(base, { recursive: true, force: true });
    st = { sesion, rondas: [], candidatos: null, i: 0, manifiesto: null, motivos: [], alertas: [], fin: null };
  }
  const guardar = () => escribirJson(fEstado, st);
  if (st.fin) return st.fin;
  const terminar = fin => { st.fin = fin; guardar(); return fin; };
  const emitir = (tipo, fecha, ids) => {
    if (st.rondas.length >= MAX_RONDAS) return terminar({ accion: "sin_radar", motivo: st.motivos[0] || "lectura_incompleta", alertas: st.alertas });
    const n = st.rondas.length + 1, outDir = path.join(base, `r${n}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    st.rondas.push({ n, tipo, fecha, out_dir: outDir, ids });
    const lista = { ronda: n, lecturas: ids.map(id => ({ id, args: args(id, outDir) })) };
    escribirJson(path.join(R.trabajo, "leer-pagina.json"), lista);
    guardar();
    return { accion: "leer", lista };
  };
  const siguienteCandidato = motivo => {
    st.motivos.push(motivo);
    st.i++; st.manifiesto = null;
    if (st.i >= st.candidatos.length) return terminar({ accion: "sin_radar", motivo: st.motivos[0], alertas: st.alertas });
    return emitir("manifiesto", st.candidatos[st.i].fecha, [`dia-${st.candidatos[st.i].fecha}`]);
  };
  const ultima = st.rondas[st.rondas.length - 1];
  if (!ultima) return emitir("indice", null, ["indice"]);
  if (ultima.tipo === "indice") {
    const indice = leerDe(ultima.out_dir, "indice");
    if (!indice) return terminar({ accion: "sin_radar", motivo: "sin_indice", alertas: st.alertas });
    const c = candidatosDeIndice(indice, { hoy, feriados });
    st.alertas.push(...c.alertas);
    st.candidatos = c.candidatos; st.i = 0;
    if (!c.candidatos.length) return terminar({ accion: "sin_radar", motivo: c.motivo, alertas: st.alertas });
    return emitir("manifiesto", c.candidatos[0].fecha, [`dia-${c.candidatos[0].fecha}`]);
  }
  const fecha = ultima.fecha;
  if (ultima.tipo === "manifiesto") {
    const m = leerDe(ultima.out_dir, `dia-${fecha}`);
    if (!m) return siguienteCandidato("lectura_incompleta");
    const malo = validarManifiesto(C, m, fecha);
    if (malo) return siguienteCandidato(malo);
    st.manifiesto = m;
    return emitir("partes", fecha, m.parts.map(p => p.id));
  }
  const partes = {};
  for (const id of ultima.ids) { const p = leerDe(ultima.out_dir, id); if (p) partes[id] = p; }
  const v = validarDia({ C, fecha, manifiesto: st.manifiesto, partes, hoy, feriados });
  if (!v.ok) return siguienteCandidato(v.motivo);
  const m = st.manifiesto;
  const analisis = { fuente: "pagina", estado: v.parcial ? "parcial" : "listo", motivo: null, fecha, asOf: v.out.asOf, antiguedad: v.antiguedad, plan: v.out.plan,
    parcial: v.parcial, nowMs: v.out.nowMs, runId: null, runIdFuente: m.runId, guardadoPagina: m.savedAt ?? null, llamadas: { total: 0 }, out: v.out };
  // el análisis completo (≈ 1.3 MB) no se guarda en el estado: queda en analisis.json y en la caché
  st.fin = { accion: analisis.estado, alertas: st.alertas, asOf: analisis.asOf, antiguedad: analisis.antiguedad };
  guardar();
  return { accion: analisis.estado, analisis, alertas: st.alertas };
}
