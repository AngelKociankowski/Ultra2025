// N2 · x03 del tester B5 (17): carpeta del día compartida; A envía y se detiene antes de 60-cerrar; B (misma exportación,
// 40 min después) concilia la ejecución de A (no la toma como propia) y su cierre la aplica al libro
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { leerVersiones } from "../lib/db.mjs";
import { prepararDia, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, planDe } from "./ejecucion.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const F1 = "2026-11-02", QQQ = [Object.assign({}, planDe(F1)[2], { orden: 1 })];

for (const conRadar of [false, true]) {
  test(`x03 (${conRadar ? "B con Radar" : "B sin Radar"}) · la compra de A entra al libro de B (efectivo 3 500) y ejecucion-<hoy> se cierra aplicada`, async () => {
    const e = await diaReal({ plan: QQQ });
    const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base });
    await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
    e.S.escribir("pre-ejecucion");
    await ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
    assert.equal(leerTrabajo(e.dir, "ejecucion.json").res[0].est, "ejecutada");
    const tB = e.t + 40 * 60000;
    const etB = etoroFalso({ portafolio: t.pf, tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 690, ask: 690.1 }]), tB) });
    const B = await prepararDia({ db: e.db, t: tB, raiz: e.raiz, etoro: etB, sinRadar: !conRadar });
    assert.equal(B.dir, e.dir); assert.equal(B.preparar.linea.accion, "recuperar");
    assert.notEqual(leerVersiones(B.dir)[`ejecucion-${F1}`].sesion, leerTrabajo(B.dir, "preparar.json").rutina.sesion);
    const c = leerTrabajo(B.dir, "cartera.json");
    assert.deepEqual(Object.keys(c.ejecuciones), [F1]);
    assert.equal(c.libro.efectivoUSD, 3500); assert.ok(c.libro.posiciones.some(p => p.sym === "QQQ"));
    await cerrar(["--dir", B.dir], { ahora: () => tB + 15 * 60000 });
    const fin = leerSalida(B.dir, "salida/final/db_write.json").ops, get = id => (fin.find(o => o.path.endsWith("/" + id)) || {}).data;
    const lib = get("cartera-libro"), ej = get(`ejecucion-${F1}`), ops = get(`ops-${F1}`);
    assert.equal(lib.efectivo, 3500); assert.equal(lib.lotes.filter(l => l[0] === "QQQ").length, 1);
    assert.ok(ej.fin); assert.ok(ops.ops.some(o => o.id === QQQ[0].id && o.est === "ejecutada"));
    assert.equal(B.S.escribir("final").accion, "listo");
    assert.equal(e.db.doc("cartera-libro").efectivo, 3500);
    assert.equal(posts(t).length, 1);
  });
}
