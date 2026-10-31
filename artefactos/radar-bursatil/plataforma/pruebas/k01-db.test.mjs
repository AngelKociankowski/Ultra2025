// K1 · Capa de db (12b §E.1–§E.4, §E.8, §E.9): canónico, integridad, importar, armar, registrar, modos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canon, hDe, conH, importar, armarGrupo, registrar, leerVersiones, presupuesto } from "../lib/db.mjs";
import { DB_SLUG, DB_RUTA } from "../lib/constantes.mjs";
import { escribirJson } from "../lib/archivos.mjs";
import { semilla } from "../lib/libro.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { carpetaConDb, carpetaTemporal, agregarLecturas } from "./util.mjs";

const S = semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") });
const lineas = (dir, ls) => fs.writeFileSync(path.join(dir, "entrada", "lecturas.jsonl"), ls.map(l => JSON.stringify(l)).join("\n") + "\n");
const vacia = () => carpetaConDb({});

test("(1) canon ordena claves en todos los niveles; h cambia con un carácter", () => {
  const a = { b: 2, a: [1, { z: 1, y: "x" }], kind: "k" }, b = { kind: "k", a: [1, { y: "x", z: 1 }], b: 2 };
  assert.equal(canon(a), '{"a":[1,{"y":"x","z":1}],"b":2,"kind":"k"}');
  assert.equal(canon(a), canon(b)); assert.equal(hDe(a), hDe(b)); assert.equal(hDe(a).length, 16);
  assert.notEqual(hDe(a), hDe(Object.assign({}, a, { b: 3 })));
  assert.notEqual(hDe({ kind: "k", s: "hola" }), hDe({ kind: "k", s: "holA" }));
  assert.equal(hDe(conH(a)), conH(a).h); // h no entra en su propio cálculo
});

test("(2) importar: 4 formas de línea, gana la última, corrupto por h y por kind, no_leido", () => {
  const dir = vacia();
  const mapa = conH(S["etoro-mapa"]);
  fs.mkdirSync(path.join(dir, "entrada/archivo/data/users/me"), { recursive: true });
  fs.writeFileSync(path.join(dir, "entrada/archivo/data/users/me/etoro-mapa.json"), JSON.stringify(mapa));
  const libro = conH(S["cartera-libro"]), malo = Object.assign({}, libro, { efectivo: 1.56 });
  lineas(dir, [
    { id: "rutina-config", exists: true, version: 3, data: conH(S["rutina-config"]) },
    { id: "etoro-mapa", exists: true, version: 7, archivo: "entrada/archivo/data/users/me/etoro-mapa.json" },
    { id: "rutina-estado", exists: false },
    { id: "bitacora-mes-2026-11", error: "resource_exhausted" },
    { id: "cartera-libro", exists: true, version: 4, data: malo },     // primero dañado…
    { id: "cartera-libro", exists: true, version: 5, data: libro },    // …gana la última
    { id: "punto-2026-10-30", exists: true, version: 1, data: conH(Object.assign({}, S["punto-2026-10-30"], { kind: "carteraOps" })) },
    { id: "ops-2026-10-30", exists: true, version: 2, data: Object.assign({}, conH(S["ops-2026-10-30"]), { h: "0000000000000000" }) },
  ]);
  escribirJson(path.join(dir, "trabajo/lista.json"), { modo: "en_linea", lecturas: [{ id: "radar-2026-11-02", obligatoria: true }, { id: "rutina-config", obligatoria: true }] });
  const r = importar(dir);
  const v = leerVersiones(dir);
  assert.deepEqual([v["rutina-config"].estado, v["rutina-config"].version], ["ok", 3]);
  assert.deepEqual([v["etoro-mapa"].estado, v["etoro-mapa"].version], ["ok", 7]);
  assert.equal(v["rutina-estado"].estado, "no_existe");
  assert.deepEqual([v["bitacora-mes-2026-11"].estado, v["bitacora-mes-2026-11"].codigo], ["fallo", "resource_exhausted"]);
  assert.deepEqual([v["cartera-libro"].estado, v["cartera-libro"].version], ["ok", 5]);
  assert.equal(v["punto-2026-10-30"].estado, "corrupto"); // kind incorrecto
  assert.deepEqual([v["ops-2026-10-30"].estado, v["ops-2026-10-30"].codigo], ["corrupto", "integridad"]);
  assert.deepEqual([v["radar-2026-11-02"].estado, v["radar-2026-11-02"].codigo], ["fallo", "no_leido"]);
  assert.deepEqual(r.corruptos.sort(), ["ops-2026-10-30", "punto-2026-10-30"]);
  // incremental: una línea nueva cambia solo ese id
  agregarLecturas(dir, [{ id: "rutina-estado", exists: true, version: 1, data: conH({ kind: "rutinaEstado", v: 2, fecha: "2026-11-02", estado: "hecha", paso: "cerrar", sesion: "s-1", inicio: "2026-11-02T14:47:00Z",
    latido: "2026-11-02T14:47:00Z", fin: "2026-11-02T15:00:00Z", commit: null, modo: "en_linea", ejecucionesAbiertas: [], previo: null, escritos: {}, motivo: null }) }]);
  const v2 = leerVersiones(dir);
  assert.equal(v2["rutina-estado"].estado, "ok"); assert.equal(v2["cartera-libro"].version, 5);
  // CLI: código 3 con corruptos o fallos
  return dbCli(["importar", "--dir", dir]).then(x => assert.equal(x.codigo, 0)); // ya no hay líneas nuevas
});

test("(3) respuestas reales de db_write y el texto del modo archivo se registran sin suponer de más", () => {
  const dir = carpetaConDb({}, null, { noExisten: ["rutina-estado"] });
  const est = { kind: "rutinaEstado", v: 2, fecha: "2026-11-02", estado: "en_curso", paso: "preparar", sesion: "s-1", inicio: "2026-11-02T14:47:00Z", latido: "2026-11-02T14:47:00Z", fin: null,
    commit: null, modo: "en_linea", ejecucionesAbiertas: [], previo: null, escritos: {}, motivo: null };
  armarGrupo({ dir, grupo: "ahora", docs: [{ id: "rutina-estado", data: est }], modo: "en_linea" });
  fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/db/escritura-ok.json"), path.join(dir, "salida/ahora/resultado.json"));
  const ok = registrar({ dir, grupo: "ahora" });
  assert.equal(ok.accion, "listo"); assert.deepEqual(ok.resumen.escritos, [{ id: "rutina-estado", version: 1 }]);
  assert.deepEqual([leerVersiones(dir)["rutina-estado"].version, leerVersiones(dir)["rutina-estado"].escritoEn], [1, "ahora"]);
  // 409 real en ahora → otra_sesion
  armarGrupo({ dir, grupo: "ahora", docs: [{ id: "rutina-estado", data: est }], modo: "en_linea" });
  fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/db/escritura-409.json"), path.join(dir, "salida/ahora/resultado.json"));
  assert.equal(registrar({ dir, grupo: "ahora" }).accion, "otra_sesion");
  // {"results":[{}]} (forma de un borrado) sobre un set: no hay versión → no se supone escrito; se relee
  armarGrupo({ dir, grupo: "final", docs: [{ id: "rutina-estado", data: est }], modo: "en_linea" });
  fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/db/borrado-ok.json"), path.join(dir, "salida/final/resultado.json"));
  assert.equal(registrar({ dir, grupo: "final" }).accion, "releer");
  // modo archivo: "…The document is now at version 2." → versión 2
  const g = path.join(dir, "salida/semilla");
  fs.mkdirSync(g, { recursive: true });
  escribirJson(path.join(g, "_grupo.json"), { grupo: "semilla", modo: "archivo", ops: [{ id: "rutina-config", h: "x", ifVersion: 1 }], omitidos: [], reintento: false });
  fs.writeFileSync(path.join(g, "resultado.txt"), "Updated rutina-config in data/users/me. The document is now at version 2.");
  const ra = registrar({ dir, grupo: "semilla" });
  assert.equal(ra.accion, "listo"); assert.equal(leerVersiones(dir)["rutina-config"].version, 2);
});

test("(4) db_write.json: ifVersion solo en ids ok; sin ids sin leer; nunca páginas ni delete", () => {
  const dir = carpetaConDb({ "cartera-libro": S["cartera-libro"] }, { "etoro-mapa": "unavailable" }, { versiones: { "cartera-libro": 9 }, noExisten: ["punto-2026-11-02"] });
  const g = armarGrupo({ dir, grupo: "final", modo: "en_linea", accionDia: "recuperar", delDia: ["bitacora-2026-11-02"], docs: [
    { id: "cartera-libro", data: S["cartera-libro"] }, { id: "punto-2026-11-02", data: Object.assign({}, S["punto-2026-10-30"], { f: "2026-11-02" }) },
    { id: "etoro-mapa", data: S["etoro-mapa"] }, { id: "rutina-config", data: S["rutina-config"] },
    { id: "bitacora-2026-11-02", data: { kind: "bitacora" } }] }).esperado;
  const w = JSON.parse(fs.readFileSync(path.join(dir, "salida/final/db_write.json"), "utf8"));
  assert.equal(w.slug, DB_SLUG);
  assert.deepEqual(w.ops.map(o => [o.path.replace(DB_RUTA + "/", ""), o.ifVersion]), [["cartera-libro", 9], ["punto-2026-11-02", undefined]]);
  assert.ok(w.ops.every(o => o.op === "set" && o.data.h));
  assert.equal(g.length, 2);
  const omit = JSON.parse(fs.readFileSync(path.join(dir, "salida/final/_grupo.json"), "utf8")).omitidos.map(o => o.id);
  assert.deepEqual(omit, ["etoro-mapa", "rutina-config", "bitacora-2026-11-02"]); // fallo, sin leer, del día con recuperar sin lectura
  for (const id of ["dia-2026-11-02", "indice", "corrida", "contador-drutina0001", "vivo"]) assert.throws(() => armarGrupo({ dir, grupo: "x", modo: "en_linea", docs: [{ id, data: { kind: "dia" } }] }), e => e.codigo === "doc_prohibido");
  // con "continuar" un documento del día sin lectura va sin ifVersion
  const d2 = carpetaConDb({});
  armarGrupo({ dir: d2, grupo: "final", modo: "en_linea", accionDia: "continuar", delDia: ["punto-2026-11-02"], docs: [{ id: "punto-2026-11-02", data: Object.assign({}, S["punto-2026-10-30"], { f: "2026-11-02" }) }] });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d2, "salida/final/db_write.json"), "utf8")).ops[0].ifVersion, undefined);
});

// db mínimo para (5): aplica ops con la semántica real
function aplicar(db, args) {
  for (const o of args.ops) { const d = db[o.path]; if (d ? o.ifVersion !== d.version : o.ifVersion !== undefined) return { error: { code: "version_mismatch", status: 409, required: true, version: d ? d.version : 0 } }; }
  return { results: args.ops.map(o => { const v = (db[o.path] ? db[o.path].version : 0) + 1; db[o.path] = { data: o.data, version: v }; return { version: v }; }) };
}
test("(5) 409: ahora → otra_sesion; pre-ejecucion → ya_hubo_envio; final → releer → escrito / reintento / conflicto", () => {
  const dir = carpetaConDb({ "cartera-libro": S["cartera-libro"], "etoro-mapa": S["etoro-mapa"] }, null, { versiones: { "cartera-libro": 4, "etoro-mapa": 2 } });
  // pre-ejecución: el documento ya existe → 409
  armarGrupo({ dir, grupo: "pre-ejecucion", modo: "en_linea", crear: ["ejecucion-2026-11-04"], docs: [{ id: "ejecucion-2026-11-04", data: { kind: "ejecucion", v: 1, f: "2026-11-04", sesion: "s", armado: "2026-11-04T15:00:00Z", fin: null, antes: { pos: [], ord: [] }, lineas: [], res: [] } }] });
  fs.writeFileSync(path.join(dir, "salida/pre-ejecucion/resultado.json"), JSON.stringify({ error: { code: "version_mismatch", status: 409, required: true, version: 1 } }));
  assert.equal(registrar({ dir, grupo: "pre-ejecucion" }).accion, "ya_hubo_envio");
  // final con un 409: se relee; libro quedó escrito (h igual), mapa no (versión igual) → reintento solo del mapa
  const libro2 = Object.assign({}, S["cartera-libro"], { efectivo: 9.99 }), mapa2 = Object.assign({}, S["etoro-mapa"], { at: "2026-11-04T15:00:00Z" });
  armarGrupo({ dir, grupo: "final", modo: "en_linea", docs: [{ id: "cartera-libro", data: libro2 }, { id: "etoro-mapa", data: mapa2 }] });
  fs.writeFileSync(path.join(dir, "salida/final/resultado.json"), JSON.stringify({ error: { code: "version_mismatch", status: 409 } }));
  assert.equal(registrar({ dir, grupo: "final" }).accion, "releer");
  const releer = JSON.parse(fs.readFileSync(path.join(dir, "trabajo/releer.json"), "utf8")).lecturas.map(l => l.id);
  assert.deepEqual(releer, ["cartera-libro", "etoro-mapa"]);
  agregarLecturas(dir, [{ id: "cartera-libro", exists: true, version: 5, data: conH(libro2) }, { id: "etoro-mapa", exists: true, version: 2, data: conH(S["etoro-mapa"]) }]);
  const v = registrar({ dir, grupo: "final", verificar: true });
  assert.equal(v.accion, "reintentar"); assert.deepEqual(v.resumen.escritos, [{ id: "cartera-libro", version: 5 }]);
  const re = JSON.parse(fs.readFileSync(path.join(dir, "salida/final/db_write-reintento.json"), "utf8"));
  assert.deepEqual(re.ops.map(o => [o.path.split("/").pop(), o.ifVersion]), [["etoro-mapa", 2]]);
  fs.writeFileSync(path.join(dir, "salida/final/resultado-reintento.json"), JSON.stringify({ results: [{ version: 3 }] }));
  assert.equal(registrar({ dir, grupo: "final", reintento: true }).accion, "listo");
  assert.equal(leerVersiones(dir)["etoro-mapa"].version, 3);
  // cambio ajeno → conflicto
  armarGrupo({ dir, grupo: "final", modo: "en_linea", docs: [{ id: "cartera-libro", data: Object.assign({}, libro2, { efectivo: 1 }) }] });
  fs.writeFileSync(path.join(dir, "salida/final/resultado.json"), "no es json");
  assert.equal(registrar({ dir, grupo: "final" }).accion, "releer");
  agregarLecturas(dir, [{ id: "cartera-libro", exists: true, version: 7, data: conH(Object.assign({}, libro2, { efectivo: 2 })) }]);
  const c = registrar({ dir, grupo: "final", verificar: true });
  assert.equal(c.accion, "conflicto"); assert.equal(c.codigo, 3); assert.deepEqual(c.resumen.conflictos, ["cartera-libro"]);
  // presupuesto cuenta lo leído y lo escrito
  const p = presupuesto(dir);
  assert.ok(p.leidos > 0 && p.escritos > 0 && p.total === p.leidos + p.escritos && p.tope === 40000);
});

test("(6) modo archivo desactivado mientras ACCION_REEMPLAZO sea null", async () => {
  const r = await preparar(["--fase", "lista", "--modo", "archivo"], { ahora: () => Date.parse("2026-11-02T14:47:00Z"), raiz: carpetaTemporal() });
  assert.equal(r.codigo, 2); assert.equal(r.linea.accion, "sin_db");
  const dir = carpetaConDb({}, null, { noExisten: ["punto-2026-11-02"] });
  assert.throws(() => armarGrupo({ dir, grupo: "final", modo: "archivo", docs: [{ id: "punto-2026-11-02", data: Object.assign({}, S["punto-2026-10-30"], { f: "2026-11-02" }) }] }), e => e.codigo === "sin_db");
});

test("00n (desvío 15) · db.mjs config: un set de rutina-config con ifVersion de la lectura y h válido; errores sin escribir", async () => {
  const dir = carpetaConDb({ "rutina-config": S["rutina-config"] }, null, { versiones: { "rutina-config": 4 } });
  const r = await dbCli(["config", "--dir", dir, "--operar", "true", "--activado", "2026-11-10T14:00:00Z"], { ahora: () => Date.parse("2026-11-09T20:00:00Z") });
  assert.equal(r.codigo, 0); assert.equal(r.linea.escribir, "salida/config/db_write.json");
  const w = JSON.parse(fs.readFileSync(path.join(dir, "salida/config/db_write.json"), "utf8"));
  assert.equal(w.slug, DB_SLUG); assert.equal(w.ops.length, 1);
  const op = w.ops[0];
  assert.deepEqual([op.op, op.path, op.ifVersion], ["set", `${DB_RUTA}/rutina-config`, 4]);
  assert.equal(op.data.h, hDe(op.data));
  assert.deepEqual([op.data.operar, op.data.activadoEl, op.data.at, op.data.bandaPts], [true, "2026-11-10T14:00:00Z", "2026-11-09T20:00:00Z", 5]);
  fs.writeFileSync(path.join(dir, "salida/config/resultado.json"), JSON.stringify({ results: [{ version: 5 }] }));
  assert.equal(registrar({ dir, grupo: "config" }).accion, "listo");
  assert.equal(leerVersiones(dir)["rutina-config"].version, 5);
  // vuelta a simulación
  const f = await dbCli(["config", "--dir", dir, "--operar", "false", "--activado", "null"], { ahora: () => Date.parse("2026-11-09T20:05:00Z") });
  assert.equal(f.codigo, 0);
  const op2 = JSON.parse(fs.readFileSync(path.join(dir, "salida/config/db_write.json"), "utf8")).ops[0];
  assert.deepEqual([op2.ifVersion, op2.data.operar, op2.data.activadoEl], [5, false, null]);
  // errores: nada se arma
  for (const [args, codigo] of [[["--operar", "true", "--activado", "null"], 1], [["--operar", "sí"], 1], [["--operar", "true", "--activado", "mañana"], 1]]) {
    fs.rmSync(path.join(dir, "salida/config"), { recursive: true, force: true });
    const e = await dbCli(["config", "--dir", dir, ...args]);
    assert.equal(e.codigo, codigo, args.join(" ")); assert.ok(!fs.existsSync(path.join(dir, "salida/config")));
  }
  const sin = await dbCli(["config", "--dir", vacia(), "--operar", "false"]);
  assert.deepEqual([sin.codigo, sin.linea.accion], [3, "sin_lectura"]);
});
