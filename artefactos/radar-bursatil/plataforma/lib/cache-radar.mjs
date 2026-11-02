// Caché local del Radar (12c §C.7): la escribe 10-radar con cualquier fuente y la leen la rutina y bin/radar.mjs. Vive fuera de la
// exportación (sobrevive a cambios de commit en el mismo contenedor). Escritura atómica (temporal + rename); se conservan los 10
// análisis más recientes; un archivo cuyo sha256 no coincide con ultimo.json se ignora.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const CACHE_DEFECTO = "/home/user/rutina/radar-cache";
export const MAX_ANALISIS = 10;
const RE_ANALISIS = /^analisis-(\d{4}-\d{2}-\d{2})-(rutina|pagina)-[A-Za-z0-9-]{1,12}\.json$/;

// Carpeta de la caché: RADAR_CACHE si está; si no, la de siempre, salvo bajo `node --test` (las pruebas nunca tocan la caché real
// del contenedor: la paso 0 corre npm test en la misma máquina que la rutina)
export const cacheDefecto = () => process.env.RADAR_CACHE || (process.env.NODE_TEST_CONTEXT ? null : CACHE_DEFECTO);

const sha = texto => crypto.createHash("sha256").update(texto).digest("hex");
function escribirAtomico(ruta, texto) {
  const tmp = `${ruta}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, texto);
  fs.renameSync(tmp, ruta);
}
const leer = ruta => { try { return JSON.parse(fs.readFileSync(ruta, "utf8")); } catch (e) { return null; } };
// a igual asOf, la corrida propia gana sobre la página; después, la más reciente
const rango = x => [x.asOf, x.fuente === "rutina" ? 1 : 0, x.obtenidoEl || ""];
const masNuevo = (a, b) => { const ra = rango(a), rb = rango(b); for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i]; return false; };

// analisis: { fuente: "rutina"|"pagina", fecha, asOf, antiguedad, plan, parcial, runIdFuente, out }
export function guardarAnalisis({ dir, analisis, ahora = Date.now }) {
  fs.mkdirSync(dir, { recursive: true });
  const runId12 = String(analisis.runIdFuente || "sin-runid").replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "sin-runid";
  const nombre = `analisis-${analisis.asOf}-${analisis.fuente}-${runId12}.json`;
  const obtenidoEl = new Date(ahora()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const cuerpo = { fuente: analisis.fuente, fecha: analisis.fecha, asOf: analisis.asOf, antiguedad: analisis.antiguedad, plan: analisis.plan, parcial: !!analisis.parcial,
    runIdFuente: analisis.runIdFuente || null, obtenidoEl, out: analisis.out };
  const texto = JSON.stringify(cuerpo);
  escribirAtomico(path.join(dir, nombre), texto);
  const nuevo = { archivo: nombre, fuente: cuerpo.fuente, asOf: cuerpo.asOf, obtenidoEl, sha256: sha(texto) };
  const actual = leerUltimo(dir);
  if (!actual || actual.ultimo.archivo === nombre || masNuevo(nuevo, actual.ultimo)) escribirAtomico(path.join(dir, "ultimo.json"), JSON.stringify(nuevo));
  podar(dir);
  return nuevo;
}

// los 10 más recientes por (asOf, fuente, obtenidoEl); el de ultimo.json nunca se borra
function podar(dir) {
  const ult = leer(path.join(dir, "ultimo.json"));
  const lista = listarAnalisis(dir).sort((a, b) => (masNuevo(a, b) ? -1 : masNuevo(b, a) ? 1 : 0));
  for (const x of lista.slice(MAX_ANALISIS)) if (!ult || x.archivo !== ult.archivo) fs.rmSync(path.join(dir, x.archivo), { force: true });
}

// análisis de la caché (sin cargar `out`): { archivo, fuente, asOf, obtenidoEl }
export function listarAnalisis(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => RE_ANALISIS.test(f)).map(f => {
    const m = f.match(RE_ANALISIS);
    return { archivo: f, asOf: m[1], fuente: m[2], obtenidoEl: fs.statSync(path.join(dir, f)).mtime.toISOString() };
  });
}

// ultimo.json válido y su análisis con el sha256 que dice; null si falta o no cuadra
export function leerUltimo(dir) {
  if (!dir) return null;
  const ultimo = leer(path.join(dir, "ultimo.json"));
  if (!ultimo || typeof ultimo.archivo !== "string" || !RE_ANALISIS.test(ultimo.archivo)) return null;
  let texto;
  try { texto = fs.readFileSync(path.join(dir, ultimo.archivo), "utf8"); } catch (e) { return null; }
  if (sha(texto) !== ultimo.sha256) return null;
  return { ultimo, analisis: JSON.parse(texto) };
}

// un análisis cualquiera de la caché por nombre (para `cambios`); null si no se puede leer
export const leerAnalisis = (dir, archivo) => (RE_ANALISIS.test(archivo) ? leer(path.join(dir, archivo)) : null);
