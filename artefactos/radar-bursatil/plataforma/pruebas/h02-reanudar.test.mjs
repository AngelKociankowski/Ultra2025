// H02 · A1.3 y A1.3b portados (12b §F.4): entre --enviar y --reanudar hay a lo más 1 POST por línea
import test from "node:test";
import assert from "node:assert/strict";
import { aplicarResultados, opsNuevo } from "../lib/libro.mjs";
import { ejecutar, montar, armarYReclamar, etoroGuion, reloj, posts, sinEspera, resDe, leerDiario, COMPRA, F, T0 } from "./ejecucion.mjs";

// el proceso muere justo después de que vuelve el n-ésimo POST (antes de anotar la respuesta)
function conCorte(t, base, n = 1) {
  let cortar = false, k = 0;
  const ahora = () => { if (cortar) throw new Error("proceso cortado"); return base(); };
  const transporte = async req => { const r = await t(req); if (req.metodo === "POST" && ++k === n) cortar = true; return r; };
  return { ahora, transporte };
}

test("A1.3 · 503 sin llegar: incierta, sin reintento; --reanudar después no envía nada (total 1 POST)", async () => {
  const { dir } = montar({ plan: COMPRA }), ahora = reloj();
  const t = etoroGuion({ reloj: ahora, retrasoVisible: 3, fallas: { 1: { noLlego: true, resp: { http: 503, texto: "" } } } });
  await armarYReclamar(dir, { transporteEToro: t, ahora, dormir: sinEspera });
  const r = await ejecutar(["--dir", dir, "--enviar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.deepEqual([r.codigo, resDe(dir)[0].est], [3, "incierta"]);
  const r2 = await ejecutar(["--dir", dir, "--reanudar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.deepEqual([r2.codigo, r2.linea.accion], [3, "ya_ejecutado"]);
  assert.equal(posts(t).length, 1);
  assert.deepEqual(leerDiario(dir).map(l => [l.fase, l.clase || null]), [["envio", null], ["respuesta", "incierta"]]);
});

test("A1.3b · corte justo después de un POST aceptado y eToro lento: --reanudar no reenvía, confirma y deja 1 posición y 1 lote", async () => {
  const { dir, libro } = montar({ plan: COMPRA }), base = reloj();
  const t = etoroGuion({ reloj: base, retrasoVisible: 3 });
  await armarYReclamar(dir, { transporteEToro: t, ahora: base, dormir: sinEspera });
  const c = conCorte(t, base);
  await assert.rejects(() => ejecutar(["--dir", dir, "--enviar"], { transporteEToro: c.transporte, ahora: c.ahora, dormir: sinEspera }), /proceso cortado/);
  assert.deepEqual(leerDiario(dir).map(l => l.fase), ["envio"]);
  const r = await ejecutar(["--dir", dir, "--reanudar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  assert.equal(posts(t).length, 1); assert.equal(r.codigo, 0);
  assert.equal(t.pf.clientPortfolio.positions.filter(p => p.instrumentID === 3006).length, 1);
  const x = resDe(dir)[0];
  assert.equal(x.est, "ejecutada");
  const L = aplicarResultados({ libro, opsHoy: opsNuevo(F), plan: COMPRA, res: resDe(dir), simulacion: false, ahora: Date.parse(T0) + 600000 }).libro;
  assert.equal(L.posiciones.find(p => p.sym === "QQQ").lotes.length, 1); assert.equal(L.efectivoUSD, 3500);
});
