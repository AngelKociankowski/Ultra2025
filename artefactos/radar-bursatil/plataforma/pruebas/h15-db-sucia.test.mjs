// H15 · a8-db-sucia portado (12b §J): entradas malas de db se descartan con alerta; 00-preparar y 60-cerrar (normal y --degradado) cierran igual
import test from "node:test";
import assert from "node:assert/strict";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { semilla } from "../lib/libro.mjs";
import { prepararDia } from "./escenario.mjs";
import { docDe, T_CIERRE } from "./cierre.mjs";

// H15 · a8-db-sucia portado: entradas malas de bitacora-mes (y de lotes, pend y ops) se descartan con alerta
const SUCIAS = { "entrada null": [null], "f con hora": [{ f: "2026-10-30T00:00" }], "texto": ["x"] };
for (const [nombre, malas] of Object.entries(SUCIAS)) {
  test(`H15 · bitacora-mes.d con ${nombre}: 00-preparar y 60-cerrar (normal y --degradado cerrar) salen 0 con alerta y degradada`, async () => {
    const bm = { kind: "bitacoraMes", v: 1, mes: "2026-11", d: malas.concat([["2026-11-01", "completa", 31900, 0, 0, 1]]) };
    const e = await prepararDia({ dbExtra: { "bitacora-mes-2026-11": bm } });
    assert.equal(e.preparar.codigo, 0);
    const txt = `Entrada mala en bitacora-mes-2026-11: ${String(JSON.stringify(malas[0])).slice(0, 40)}; se descarta.`;
    assert.ok(leerTrabajo(e.dir, "preparar.json").alertas.includes(txt));
    for (const args of [[], ["--degradado", "cerrar"]]) {
      const r = await cerrar(["--dir", e.dir, ...args], { ahora: () => T_CIERRE(e) });
      assert.equal(r.codigo, 0); assert.equal(r.linea.resumen.minimo, undefined);
      assert.equal(docDe(e.dir, "rutina-estado").estado, "degradada");
      assert.equal(docDe(e.dir, "bitacora-2026-11-02").estado, "degradada");
      assert.ok(docDe(e.dir, "bitacora-2026-11-02").alertas.includes(txt));
      assert.deepEqual(docDe(e.dir, "bitacora-mes-2026-11").d.map(x => x[0]), ["2026-11-01", "2026-11-02"], "la entrada mala no se reescribe");
    }
  });
}

test("H15 · lote, pendiente y operación mal formados: se ignoran con alerta, día degradado, no se reescriben", async () => {
  const s = semilla();
  s["cartera-libro"].lotes.push(["SPY", "x"]); s["cartera-libro"].pend.push(null);
  s["ops-2026-10-30"].ops.push({ id: 7 });
  const e = await prepararDia({ dbExtra: { "cartera-libro": s["cartera-libro"], "ops-2026-10-30": s["ops-2026-10-30"] } });
  assert.equal(e.preparar.codigo, 0); assert.equal(e.cartera.codigo, 0);
  const r = await cerrar(["--dir", e.dir], { ahora: () => T_CIERRE(e) });
  assert.equal(r.codigo, 0);
  const al = docDe(e.dir, "bitacora-2026-11-02").alertas.join("\n");
  assert.match(al, /Lote mal formado en cartera-libro/); assert.match(al, /Pendiente mal formado en cartera-libro/); assert.match(al, /Operación mal formada en ops-2026-10-30/);
  assert.equal(docDe(e.dir, "rutina-estado").estado, "degradada");
  const libro = docDe(e.dir, "cartera-libro");
  assert.equal(libro.lotes.length, 5); assert.equal(libro.pend.length, 0);
  assert.equal(docDe(e.dir, "ops-2026-10-30").ops.length, 5);
});
