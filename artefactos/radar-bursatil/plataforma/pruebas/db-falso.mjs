// db falso con la semántica medida en 15/12b (versiones, ifVersion obligatorio sobre existentes, 409, ≤ 50 ops) y una
// "sesión" que hace los procedimientos LEER y ESCRIBIR del RUNBOOK copiando solo lo que piden los archivos.
import fs from "node:fs";
import path from "node:path";
import { DB_SLUG, DB_RUTA } from "../lib/constantes.mjs";
import { conH, importar, registrar, bytes } from "../lib/db.mjs";
import { kindDeId } from "../lib/esquemas.mjs";

export function crearDbFalso(inicial = {}, { parcial = false } = {}) {
  const docs = new Map(), escrituras = [];
  const ruta = id => `${DB_RUTA}/${id}`;
  for (const [id, d] of Object.entries(inicial)) docs.set(ruta(id), { data: kindDeId(id) && kindDeId(id) !== "feriados" && d && !d.h ? conH(d) : d, version: 1 });
  const db = {
    docs, escrituras,
    get({ slug, path: p }) {
      if (slug !== DB_SLUG) return { error: { code: "not_found" } };
      const d = docs.get(p);
      return d ? { exists: true, version: d.version, data: JSON.parse(JSON.stringify(d.data)) } : { exists: false };
    },
    write({ slug, ops }) {
      if (slug !== DB_SLUG) return { error: { code: "not_found", status: 404 } };
      if (!Array.isArray(ops) || ops.length > 50) return { error: { code: "invalid_argument", status: 400 } };
      const choque = ops.find(o => { const d = docs.get(o.path); return d ? o.ifVersion !== d.version : o.ifVersion !== undefined; });
      if (choque && !parcial) { const d = docs.get(choque.path); return { error: { code: "version_mismatch", status: 409, required: true, version: d ? d.version : 0 } }; }
      const results = [];
      for (const o of ops) {
        const d = docs.get(o.path);
        if (d ? o.ifVersion !== d.version : o.ifVersion !== undefined) return { error: { code: "version_mismatch", status: 409, required: true, version: d ? d.version : 0 } };
        if (o.op === "delete") { docs.delete(o.path); results.push({}); escrituras.push({ path: o.path, op: "delete" }); continue; }
        const version = (d ? d.version : 0) + 1;
        docs.set(o.path, { data: JSON.parse(JSON.stringify(o.data)), version });
        escrituras.push({ path: o.path, op: o.op, version });
        results.push({ version });
      }
      return { results, usage: { documents: docs.size } };
    },
    version: id => (docs.get(ruta(id)) || {}).version || 0,
    doc: id => (docs.get(ruta(id)) || {}).data || null,
  };
  return db;
}

// Sesión de Claude: LEER (agrega líneas a lecturas.jsonl e importa) y ESCRIBIR (copia db_write.json, guarda la respuesta,
// registra y, si hace falta, relee y hace un reintento). `corromper(linea)` simula un error de copia; `omitir` = ids que la
// sesión "olvida" leer (no deja línea).
export function crearSesion({ db, dir, corromper = null, omitir = [] }) {
  const copiado = { leidos: 0, escritos: 0 };
  const archivoL = () => path.join(dir, "entrada", "lecturas.jsonl");
  function leer(lecturas) {
    const lineas = [];
    for (const L of lecturas || []) {
      if (omitir.includes(L.id)) continue;
      const r = db.get(L.en_linea.args);
      let linea = r.error ? { id: L.id, error: r.error.code } : r.exists ? { id: L.id, exists: true, version: r.version, data: r.data } : { id: L.id, exists: false };
      if (corromper) linea = corromper(linea) || linea;
      if (linea.data) copiado.leidos += bytes(linea.data);
      lineas.push(JSON.stringify(linea));
    }
    if (lineas.length) fs.appendFileSync(archivoL(), lineas.join("\n") + "\n");
    return importar(dir);
  }
  function escribir(grupo) {
    const g = path.join(dir, "salida", grupo), f = path.join(g, "db_write.json");
    if (!fs.existsSync(f)) return { accion: "nada" };
    const args = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const op of args.ops) copiado.escritos += bytes(op.data);
    fs.writeFileSync(path.join(g, "resultado.json"), JSON.stringify(db.write(args)));
    let r = registrar({ dir, grupo });
    if (r.accion === "releer") {
      leer(JSON.parse(fs.readFileSync(path.join(dir, "trabajo", "releer.json"), "utf8")).lecturas);
      r = registrar({ dir, grupo, verificar: true });
      if (r.accion === "reintentar") {
        const args2 = JSON.parse(fs.readFileSync(path.join(g, "db_write-reintento.json"), "utf8"));
        fs.writeFileSync(path.join(g, "resultado-reintento.json"), JSON.stringify(db.write(args2)));
        r = registrar({ dir, grupo, reintento: true });
      }
    }
    return { accion: r.accion, codigo: r.codigo, resumen: r.resumen };
  }
  return { leer, escribir, copiado };
}
