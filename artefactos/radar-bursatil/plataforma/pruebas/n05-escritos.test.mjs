// N5 · x11 y x06 del tester B5 (17), 12b §E.5.1: lo leído hoy se compara con los h que dejó en rutina-estado.escritos la última
// sesión; un cartera-libro distinto (copia vieja con h válido, o la escritura de ayer fue a otra ruta) alerta y no se usa
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { conH, registrar, leerVersiones } from "../lib/db.mjs";
import { semilla } from "../lib/libro.mjs";
import { prepararDia, dbInicial, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const T2 = Date.parse("2026-11-03T14:47:00Z");
const et2 = () => etoroFalso({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, T2) });

function comprobarBloqueo(d2) {
  const p = leerTrabajo(d2.dir, "preparar.json");
  assert.ok(p.alertas.some(a => /^cartera-libro no es el que escribió la sesión anterior/.test(a)), JSON.stringify(p.alertas));
  assert.deepEqual([p.bloqueos.libro, p.bloqueos.desactualizados], [true, ["cartera-libro"]]);
  assert.equal(leerTrabajo(d2.dir, "cartera.json").estado, "sin_libro");
  assert.notEqual(d2.decidir.linea.accion, "ejecutar");
}

test("x11 · día 2 copia el cartera-libro de la semilla (h válido, versión actual): alerta, no se opera ni se reescribe el libro", async () => {
  const db = dbInicial({});
  const d1 = await prepararDia({ db });
  await cerrar(["--dir", d1.dir], { ahora: () => d1.t + 15 * 60000 });
  assert.equal(d1.S.escribir("final").accion, "listo");
  assert.equal(db.doc("rutina-estado").escritos["cartera-libro"], db.doc("cartera-libro").h);
  const viejo = conH(semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") })["cartera-libro"]);
  const d2 = await prepararDia({ db, t: T2, etoro: et2(), corromper: L => (L.id === "cartera-libro" && L.data ? Object.assign({}, L, { data: viejo }) : L) });
  assert.equal(leerVersiones(d2.dir)["cartera-libro"].estado, "ok");
  comprobarBloqueo(d2);
  await cerrar(["--dir", d2.dir], { ahora: () => T2 + 15 * 60000 });
  const fin = leerSalida(d2.dir, "salida/final/db_write.json").ops;
  assert.ok(!fin.some(o => o.path.endsWith("/cartera-libro")));
  // el día siguiente ya no compara contra el h de antier (se sale del bloqueo si db cambió de verdad)
  assert.ok(!("cartera-libro" in fin.find(o => o.path.endsWith("/rutina-estado")).data.escritos));
  assert.equal(d2.S.escribir("final").accion, "listo");
  assert.equal(db.doc("cartera-libro").lotes.length, 5, "en db sigue el libro bueno");
});

test("x06 (ruta) · la escritura de ayer fue a 'cartera-libr0': día 2 lee el libro de antier, lo detecta y no lo usa", async () => {
  const db = dbInicial({});
  const d1 = await prepararDia({ db });
  await cerrar(["--dir", d1.dir], { ahora: () => d1.t + 15 * 60000 });
  const f = path.join(d1.dir, "salida/final/db_write.json"), args = JSON.parse(fs.readFileSync(f, "utf8"));
  const op = args.ops.find(o => o.path.endsWith("/cartera-libro"));
  op.path = op.path.replace("cartera-libro", "cartera-libr0"); delete op.ifVersion;
  fs.writeFileSync(path.join(d1.dir, "salida/final/resultado.json"), JSON.stringify(db.write(args)));
  assert.equal(registrar({ dir: d1.dir, grupo: "final" }).accion, "listo");
  const d2 = await prepararDia({ db, t: T2, etoro: et2() });
  comprobarBloqueo(d2);
});

test("sin errores de copia: día 2 no alerta (escritos coincide) y los h de lectura diaria se arrastran aunque hoy no se reescriban", async () => {
  const s = semilla(); delete s["etoro-mapa"].i.DIA; delete s["etoro-mapa"].rech.DIA; // el día 1 verifica DIA y escribe el mapa
  const db = dbInicial({ "etoro-mapa": s["etoro-mapa"] });
  const d1 = await prepararDia({ db });
  await cerrar(["--dir", d1.dir], { ahora: () => d1.t + 15 * 60000 });
  d1.S.escribir("final");
  assert.equal(db.doc("rutina-estado").escritos["etoro-mapa"], db.doc("etoro-mapa").h);
  const d2 = await prepararDia({ db, t: T2, etoro: et2() });
  const p = leerTrabajo(d2.dir, "preparar.json");
  assert.deepEqual(p.bloqueos.desactualizados, []); assert.ok(!p.alertas.some(a => /no es el que escribió/.test(a)));
  await cerrar(["--dir", d2.dir], { ahora: () => T2 + 15 * 60000 });
  const esc = leerSalida(d2.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith("/rutina-estado")).data.escritos;
  assert.equal(esc["etoro-mapa"], db.doc("etoro-mapa").h, "etoro-mapa no se reescribió hoy y su h se conserva");
});
