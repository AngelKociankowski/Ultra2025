// N11 · x14 del tester B5 (17): una compra escalada en --enviar (la venta que la financiaba no se confirmó) y doble caída; el
// cierre degradado deja en ejecucion-<f> lo que sabía el diario y la conciliación del día siguiente casa el monto enviado
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { prepararDia, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, planDe } from "./ejecucion.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const F1 = "2026-11-02";

test("x14 · QQQ escalada a 1 000 (de 1 500) entra al libro al día siguiente; el efectivo nunca es negativo", async () => {
  const plan = [planDe(F1)[1], planDe(F1)[2]].map((o, i) => Object.assign({}, o, { orden: i + 1 })); // SPY-R1 venta, QQQ-C1 1 500
  const e = await diaReal({ plan, efectivo: 1000 });
  const base = reloj(new Date(e.t + 11 * 60000).toISOString());
  const t = etoroGuion({ reloj: base, fallas: { 1: { noLlego: true, resp: { http: 200, texto: '{"orderForClose":{"orderID":5001}}' } }, 2: { noLlego: true, resp: { http: 200, texto: '{"orderForClose":{"orderID":5002}}' } } } });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  e.S.escribir("pre-ejecucion");
  let n = 0;
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: async q => { const r = await t(q); if (q.metodo === "POST") n++; return r; }, ahora: () => { if (n >= 3) throw new Error("cortado"); return base(); }, dormir: sinEspera }));
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--reanudar"], { transporteEToro: t, ahora: () => { throw new Error("cortado"); }, dormir: sinEspera }));
  const compra = posts(t).find(p => p.url.endsWith("/demo/orders"));
  assert.equal(JSON.parse(compra.cuerpo).amount, 1000);
  await cerrar(["--dir", e.dir, "--degradado", "ejecutar"], { ahora: () => e.t + 15 * 60000 });
  const ej = leerSalida(e.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith(`/ejecucion-${F1}`)).data;
  assert.equal(ej.fin, null);
  assert.deepEqual(ej.res.map(r => [r.id.slice(11), r.k, r.est, r.usd]), [["SPY-R1", 0, "aceptada", null], ["SPY-R1", 1, "aceptada", null], ["QQQ-C1", 0, "incierta", 1000]]);
  e.S.escribir("final");
  let ultimo;
  for (const dia of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
    const tt = Date.parse(dia + "T14:47:00Z");
    const d = await prepararDia({ db: e.db, t: tt, etoro: etoroFalso({ portafolio: t.pf, tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 691, ask: 691.2 }]), tt) }) });
    const c = leerTrabajo(d.dir, "cartera.json");
    assert.ok(c.libro.efectivoUSD >= 0, `${dia}: efectivo ${c.libro.efectivoUSD}`);
    await cerrar(["--dir", d.dir], { ahora: () => tt + 15 * 60000 }); d.S.escribir("final"); ultimo = c;
  }
  const qqq = ultimo.libro.posiciones.find(p => p.sym === "QQQ");
  assert.ok(qqq && qqq.lotes.length === 1, "la compra enviada termina en el libro");
  assert.equal(qqq.lotes[0].costoUSD, 1000); assert.equal(ultimo.libro.efectivoUSD, 0);
});
