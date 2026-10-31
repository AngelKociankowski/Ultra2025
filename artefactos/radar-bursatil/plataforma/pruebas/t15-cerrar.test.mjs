// T15 / K8 · Cierre: grupo final (§E.6), verificar.json, sin Radar, --degradado y cierre mínimo (H12 en h12, H15 en h15, H24 en h24)
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { main as cerrar, TEXTO_FALLA } from "../bin/60-cerrar.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { escribirTrabajo, leerTrabajo } from "../lib/archivos.mjs";
import { lectura, leerVersiones, conH } from "../lib/db.mjs";
import { validarDoc, kindDeId } from "../lib/esquemas.mjs";
import { semilla } from "../lib/libro.mjs";
import { DOC_TOPES, DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, PAG } from "./escenario.mjs";
import { leerSalida, carpetaConDb } from "./util.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { aviso, grupo, idsDe, docDe, NOTAS, outXleEvitar, T_CIERRE } from "./cierre.mjs";

test("grupo final: orden exacto de §E.6, esquemas, topes, ifVersion solo en leídos, verificar.json y escritos con los h", async () => {
  const s = semilla(); delete s["etoro-mapa"].i.DIA; delete s["etoro-mapa"].rech.DIA; // fuerza un cambio del mapa
  const e = await prepararDia({ out: outXleEvitar(), notas: NOTAS, dbExtra: { "etoro-mapa": s["etoro-mapa"] } });
  const r = await cerrar(["--dir", e.dir], { ahora: () => T_CIERRE(e) });
  assert.equal(r.codigo, 0); assert.equal(r.linea.escribir, "salida/final/db_write.json");
  assert.deepEqual(idsDe(e.dir), ["ops-2026-10-30", "ops-2026-11-02", "cartera-libro", "etoro-mapa", "punto-2026-11-02", "radar-2026-11-02", "bitacora-2026-11-02", "bitacora-mes-2026-11", "rutina-estado"]);
  const ver = leerVersiones(e.dir);
  for (const op of grupo(e.dir).ops) {
    const id = op.path.slice(DB_RUTA.length + 1), b = Buffer.byteLength(JSON.stringify(op.data));
    assert.equal(op.op, "set");
    assert.deepEqual(validarDoc(id, op.data), [], id);
    assert.equal(conH(op.data).h, op.data.h, `${id}: h`);
    assert.ok(b <= DOC_TOPES[kindDeId(id)], `${id}: ${b} B > ${DOC_TOPES[kindDeId(id)]}`);
    if (ver[id] && ver[id].estado === "ok") assert.equal(op.ifVersion, ver[id].version, id); else assert.equal(op.ifVersion, undefined, id);
    assert.ok(!/"CID"|10000001/.test(JSON.stringify(op.data)), id); // CID ficticio de los fixtures: nunca va a db
  }
  const est = docDe(e.dir, "rutina-estado");
  assert.deepEqual([est.estado, est.paso], ["hecha", "cerrar"]);
  assert.deepEqual(est.escritos, Object.fromEntries(grupo(e.dir).ops.slice(0, -1).map(o => [o.path.slice(DB_RUTA.length + 1), o.data.h])));
  // N-5b (00o): tras escribir se releen rutina-estado y cartera-libro (sin envíos, ejecucion-<hoy> no)
  assert.deepEqual(leerTrabajo(e.dir, "verificar.json"), { lecturas: ["rutina-estado", "cartera-libro"].map(id => lectura(id, { obligatoria: true, dirAbs: path.resolve(e.dir) })) });
  const ops = docDe(e.dir, "ops-2026-10-30").ops, hoy = docDe(e.dir, "ops-2026-11-02").ops;
  assert.ok(ops.every(o => o.est === "ejecutada"));
  assert.deepEqual(hoy.map(o => [o.id, o.est, o.sim]), [["2026-11-02-XLE-V1", "simulada", true]]);
  const libro = docDe(e.dir, "cartera-libro");
  assert.equal(libro.pend.length, 0); assert.equal(libro.lotes.length, 5); assert.equal(libro.efectivo, 0.56); assert.equal(libro.refs.dia[0], "2026-11-02");
  const b = docDe(e.dir, "bitacora-2026-11-02");
  assert.deepEqual([b.estado, b.sim, b.radar.estado], ["completa", true, "listo"]);
  assert.equal(b.aviso, aviso(e.dir)); assert.ok(Number.isInteger(b.presupuesto) && b.presupuesto < 36000, String(b.presupuesto));
  assert.deepEqual(docDe(e.dir, "bitacora-mes-2026-11").d, [["2026-11-02", "completa", 32010.04, b.rend.usd[0], 0, 1]]);
  // el grupo se aplica al db falso sin conflictos y los documentos de la página no cambian
  assert.equal(e.S.escribir("final").accion, "listo");
  assert.deepEqual([e.db.version("indice"), e.db.version("corrida")], [1, 1]);
});

test("sin Radar (sin FMP): radar sin_radar, bitácora parcial, rutina-estado hecha y la línea de §H", async () => {
  const e = await prepararDia({ sinRadar: true, notas: NOTAS });
  await cerrar(["--dir", e.dir], { ahora: () => T_CIERRE(e) });
  assert.match(aviso(e.dir), /\nRadar: sin datos de FMP hoy; sin Radar no se opera\.\n/);
  assert.deepEqual([docDe(e.dir, "radar-2026-11-02").estado, docDe(e.dir, "radar-2026-11-02").motivo], ["sin_radar", "policy"]);
  assert.equal(docDe(e.dir, "bitacora-2026-11-02").estado, "parcial");
  assert.equal(docDe(e.dir, "rutina-estado").estado, "hecha");
});

test("--degradado: cualquier paso sale 0 con Falla:; sin eToro no se reescribe el libro", async () => {
  const a = await prepararDia({ sinRadar: true });
  for (const paso of Object.keys(TEXTO_FALLA).concat(["50-ejecutar", "registrar", "x y", ""])) {
    const r = await cerrar(["--dir", a.dir, "--degradado", paso], { ahora: () => T_CIERRE(a) });
    assert.equal(r.codigo, 0, paso);
    assert.equal(docDe(a.dir, "rutina-estado").estado, "degradada", paso);
    assert.match(aviso(a.dir), /\nFalla: [a-z0-9-]+ — /, paso);
  }
  await cerrar(["--dir", a.dir, "--degradado", "radar"], { ahora: () => T_CIERRE(a) });
  assert.match(aviso(a.dir), /\nFalla: radar — el Radar no corrió; sin análisis de hoy$/);
  const b = await prepararDia({ etoro: transporteFalso(() => ({ http: 503, texto: "" })) });
  assert.equal((await cerrar(["--dir", b.dir, "--degradado", "cartera"], { ahora: () => T_CIERRE(b) })).codigo, 0);
  assert.equal(docDe(b.dir, "bitacora-2026-11-02").estado, "degradada");
  assert.match(aviso(b.dir), /Falla: cartera — sin datos de eToro; sin órdenes hoy/);
  assert.ok(!idsDe(b.dir).includes("cartera-libro"));
});

test("cierre mínimo: datos de trabajo que hacen fallar el cierre normal → código 0, normal y con --degradado", async () => {
  const e = await prepararDia({});
  escribirTrabajo(e.dir, "cartera.json", { estado: "listo", libro: { posiciones: "x" }, valuacion: { posiciones: 3 }, alertas: [] });
  for (const args of [[], ["--degradado", "cerrar"], ["--degradado", "cartera"]]) {
    const r = await cerrar(["--dir", e.dir, ...args], { ahora: () => T_CIERRE(e) });
    assert.equal(r.codigo, 0, args.join(" ")); assert.equal(r.linea.resumen.minimo, true);
    assert.deepEqual(idsDe(e.dir), ["bitacora-2026-11-02", "bitacora-mes-2026-11", "rutina-estado"]);
    assert.equal(docDe(e.dir, "rutina-estado").estado, "degradada");
    assert.match(aviso(e.dir), /Falla: .+ — /);
  }
});

test("feriado lo arma 00-preparar (aviso de una línea y rutina-estado sin_mercado)", async () => {
  const fer = carpetaConDb(semilla(), null, { noExisten: ["rutina-estado", "bitacora-mes-2026-11"] });
  const r = await preparar(["--dir", fer, "--fase", "decidir"], { ahora: () => Date.parse("2026-11-26T14:47:00Z"), pagina: PAG });
  assert.equal(r.codigo, 2);
  assert.equal(aviso(fer), "Radar · jue 26-nov · Feriado NYSE (Thanksgiving Day): sin operación.");
  assert.equal(leerSalida(fer, "salida/ahora/db_write.json").ops[0].data.estado, "sin_mercado");
});
