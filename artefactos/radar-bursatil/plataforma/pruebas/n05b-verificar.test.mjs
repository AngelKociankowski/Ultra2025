// N-5b (00o) · x06 del tester B5 (17): después de escribir final se releen rutina-estado, cartera-libro y, si hubo envíos,
// ejecucion-<hoy>; si no tienen el h preparado, verificar marca el día (grupo revision), el aviso lo dice y el día siguiente no
// opera hasta que el director quite la marca con `db.mjs revisado`
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { registrar, conH, TEXTO_REVISION } from "../lib/db.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { semilla } from "../lib/libro.mjs";
import { prepararDia, dbInicial, tasasA, OUT30, copia } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, etoroGuion, reloj, sinEspera } from "./ejecucion.mjs";
import { leerFix, leerSalida, carpetaConDb } from "./util.mjs";

const T2 = Date.parse("2026-11-03T14:47:00Z"), T3 = Date.parse("2026-11-04T14:47:00Z");
const et = t => etoroFalso({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, t) });
const outXle = () => { const o = copia(OUT30); Object.assign(o.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 }); return o; };
const operar = () => ({ "rutina-config": Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) });

// día 1 con la copia de final alterada como en x06; devuelve la carpeta tras registrar
async function diaConCopiaMala(variante, db) {
  const d1 = await prepararDia({ db });
  await cerrar(["--dir", d1.dir], { ahora: () => d1.t + 15 * 60000 });
  const f = path.join(d1.dir, "salida/final/db_write.json"), args = JSON.parse(fs.readFileSync(f, "utf8"));
  const op = args.ops.find(o => o.path.endsWith(variante === "bitacora" ? "/bitacora-2026-11-02" : "/cartera-libro"));
  if (variante === "ruta") { op.path = op.path.replace("cartera-libro", "cartera-libr0"); delete op.ifVersion; }
  if (variante === "numero") op.data = JSON.parse(JSON.stringify(op.data).replace('"efectivo":0.56', '"efectivo":0.66'));
  if (variante === "bitacora") op.data = JSON.parse(JSON.stringify(op.data).replace('"estado":"', '"estado":"x'));
  fs.writeFileSync(path.join(d1.dir, "salida/final/resultado.json"), JSON.stringify(db.write(args)));
  assert.equal(registrar({ dir: d1.dir, grupo: "final" }).accion, "listo");
  d1.S.leer(leerTrabajo(d1.dir, "verificar.json").lecturas);
  return d1;
}

for (const variante of ["ruta", "numero"]) {
  test(`x06/x18 (${variante}) · día 1: verificar marca el día y el aviso lo dice; día 2 no opera; revisado --libro repone el libro y quita la marca; día 3 opera`, async () => {
    const db = dbInicial(operar());
    const d1 = await diaConCopiaMala(variante, db);
    assert.deepEqual(leerTrabajo(d1.dir, "verificar.json").lecturas.map(l => l.id), ["rutina-estado", "cartera-libro"]);
    const v = await dbCli(["verificar", "--dir", d1.dir]);
    assert.deepEqual([v.codigo, v.linea.accion, v.linea.resumen.distintos, v.linea.escribir], [3, "marcar", ["cartera-libro"], "salida/revision/db_write.json"]);
    assert.ok(fs.readFileSync(path.join(d1.dir, "salida/aviso.txt"), "utf8").endsWith(TEXTO_REVISION(["cartera-libro"])));
    const w = leerSalida(d1.dir, "salida/revision/db_write.json");
    assert.deepEqual([w.ops.length, w.ops[0].path, w.ops[0].ifVersion], [1, `${DB_RUTA}/rutina-estado`, db.version("rutina-estado")]);
    assert.equal(d1.S.escribir("revision").accion, "listo");
    assert.deepEqual(db.doc("rutina-estado").revisar.ids, ["cartera-libro"]);
    // día 2: no se opera. Con `numero` el libro de db está dañado y el día para por integridad; con `ruta` sigue marcado
    const d2 = await prepararDia({ db, t: T2, out: outXle(), etoro: et(T2) });
    if (variante === "numero") assert.deepEqual([d2.preparar.codigo, d2.preparar.linea.resumen.motivo], [2, "integridad"]);
    else {
      assert.ok(leerTrabajo(d2.dir, "preparar.json").alertas.some(a => /^No se opera: el día 2026-11-02 quedó marcado para revisión del director/.test(a)));
      assert.notEqual(d2.decidir.linea.accion, "ejecutar");
      await cerrar(["--dir", d2.dir], { ahora: () => T2 + 15 * 60000 });
      assert.ok(leerSalida(d2.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith("/rutina-estado")).data.revisar);
      assert.equal(d2.S.escribir("final").accion, "listo");
    }
    // R2: el director repone el libro que preparó la rutina (salida/final del día marcado) y quita la marca, juntos
    const dir = carpetaConDb({ "rutina-estado": db.doc("rutina-estado"), "cartera-libro": db.doc("cartera-libro") }, null,
      { versiones: { "rutina-estado": db.version("rutina-estado"), "cartera-libro": db.version("cartera-libro") } });
    const sinLibro = await dbCli(["revisado", "--dir", dir], { ahora: () => T2 + 3 * 3600000 });
    assert.deepEqual([sinLibro.codigo, sinLibro.linea.accion], [1, "error"]);
    const otro = path.join(dir, "otro-libro.json");
    fs.writeFileSync(otro, JSON.stringify(conH(semilla()["cartera-libro"])));
    const malo = await dbCli(["revisado", "--dir", dir, "--libro", otro], { ahora: () => T2 + 3 * 3600000 });
    assert.equal(malo.codigo, 1); assert.match(malo.linea.resumen.texto, /no es el que preparó la rutina/);
    assert.ok(!fs.existsSync(path.join(dir, "salida/revisado")));
    const bueno = path.join(d1.dir, "salida/final/cartera-libro.json");
    const q = await dbCli(["revisado", "--dir", dir, "--libro", bueno], { ahora: () => T2 + 3 * 3600000 });
    assert.deepEqual([q.codigo, q.linea.escribir], [0, "salida/revisado/db_write.json"]);
    const wq = leerSalida(dir, "salida/revisado/db_write.json").ops;
    assert.deepEqual(wq.map(o => [o.path.split("/").pop(), o.ifVersion]), [["cartera-libro", db.version("cartera-libro")], ["rutina-estado", db.version("rutina-estado")]]);
    assert.equal(wq[1].data.revisar, undefined); assert.equal(wq[1].data.escritos["cartera-libro"], wq[0].data.h);
    assert.ok(!db.write(leerSalida(dir, "salida/revisado/db_write.json")).error);
    assert.equal(db.doc("rutina-estado").revisar, undefined); assert.equal(db.doc("cartera-libro").lotes.length, 5);
    // día 3: sin marca y con el libro repuesto, el día opera (x18)
    const d3 = await prepararDia({ db, t: T3, out: outXle(), etoro: et(T3) });
    const p3 = leerTrabajo(d3.dir, "preparar.json");
    assert.equal(d3.preparar.codigo, 0);
    assert.ok(!p3.alertas.some(a => /marcado para revisión|no es el que escribió/.test(a)), JSON.stringify(p3.alertas));
    assert.notEqual(leerTrabajo(d3.dir, "decisiones.json").modo, "bloqueado");
    assert.equal(d3.decidir.linea.accion, "ejecutar");
  });
}

test("sin errores de copia: verificar ok (código 0), sin grupo revision; con envíos se relee también ejecucion-<hoy>", async () => {
  const db = dbInicial(operar());
  const d = await prepararDia({ db, out: outXle() });
  assert.equal(d.decidir.linea.accion, "ejecutar");
  const ahora = reloj(new Date(d.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: ahora });
  await ejecutar(["--dir", d.dir, "--armar"], { transporteEToro: t, ahora, dormir: sinEspera });
  d.S.escribir("pre-ejecucion");
  await ejecutar(["--dir", d.dir, "--enviar"], { transporteEToro: t, ahora, dormir: sinEspera });
  await cerrar(["--dir", d.dir], { ahora: () => d.t + 15 * 60000 });
  assert.equal(d.S.escribir("final").accion, "listo");
  assert.deepEqual(leerTrabajo(d.dir, "verificar.json").lecturas.map(l => l.id), ["rutina-estado", "cartera-libro", "ejecucion-2026-11-02"]);
  d.S.leer(leerTrabajo(d.dir, "verificar.json").lecturas);
  const v = await dbCli(["verificar", "--dir", d.dir]);
  assert.deepEqual([v.codigo, v.linea.accion, v.linea.resumen.distintos, v.linea.escribir], [0, "listo", [], null]);
  assert.ok(!fs.existsSync(path.join(d.dir, "salida/revision")));
  assert.deepEqual(db.doc("ejecucion-2026-11-02").lineas, [], "N8: el cierre va sin lineas");
});

test("x06 (bitacora) · un carácter en bitacora-<hoy> no se relee el día 1 (00o: no se relee todo final)", async () => {
  const db = dbInicial({});
  const d1 = await diaConCopiaMala("bitacora", db);
  const v = await dbCli(["verificar", "--dir", d1.dir]);
  assert.equal(v.codigo, 0);
});
