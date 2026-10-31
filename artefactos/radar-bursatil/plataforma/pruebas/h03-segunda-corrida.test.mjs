// H03 · A1.2 portado (12b §F.3): una 2.ª corrida de --enviar sobre la misma carpeta se niega sin POST
import test from "node:test";
import assert from "node:assert/strict";
import { ejecutar, montar, armarYReclamar, etoroGuion, reloj, posts, sinEspera, COMPRA } from "./ejecucion.mjs";

test("A1.2 · 50-ejecutar --enviar dos veces → la 2.ª sale 3 ya_ejecutado y no hay POST nuevos", async () => {
  const { dir } = montar({ plan: COMPRA }), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  const op = { transporteEToro: t, ahora, dormir: sinEspera };
  await armarYReclamar(dir, op);
  await ejecutar(["--dir", dir, "--enviar"], op);
  const n1 = posts(t).length;
  const r2 = await ejecutar(["--dir", dir, "--enviar"], op);
  assert.deepEqual([r2.codigo, r2.linea.accion, posts(t).length], [3, "ya_ejecutado", n1]);
  assert.equal(n1, 1);
  assert.equal(t.pf.clientPortfolio.positions.filter(x => x.instrumentID === 3006).length, 1);
});
