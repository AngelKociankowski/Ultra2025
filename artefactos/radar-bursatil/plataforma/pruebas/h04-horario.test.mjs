// H04 · A1.4 portado (12b §F.2.1, §F.3.2): mercado y ventana antes de armar y antes de cada POST
import test from "node:test";
import assert from "node:assert/strict";
import { ejecutar, montar, armarYReclamar, etoroGuion, reloj, posts, sinEspera, resDe, PLAN, COMPRA } from "./ejecucion.mjs";

test("A1.4 · plan decidido 15:29 ET y ejecutado 16:40 ET → --armar nada, 0 POST, no_enviada: fuera de horario", async () => {
  const { dir } = montar({ plan: COMPRA }), ahora = reloj("2026-11-04T21:40:00Z"), t = etoroGuion({ reloj: ahora });
  const r = await ejecutar(["--dir", dir, "--armar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.deepEqual([r.codigo, r.linea.accion], [0, "nada"]);
  assert.equal(t.llamadas.length, 0);
  assert.deepEqual(resDe(dir).map(x => [x.est, x.err]), [["no_enviada", "fuera de horario"]]);
});

test("la ventana se cierra entre el 1.er y el 2.º POST → 1 POST; el resto no_enviada: fuera de horario", async () => {
  const { dir } = montar({ plan: [PLAN[0], PLAN[2]] }), ahora = reloj("2026-11-04T20:28:00Z"); // 15:28 ET; ventana hasta 15:30
  const t = etoroGuion({ reloj: ahora, antesDePost: () => ahora.saltar(3 * 60000) });
  await armarYReclamar(dir, { transporteEToro: t, ahora, dormir: sinEspera });
  await ejecutar(["--dir", dir, "--enviar"], { transporteEToro: t, ahora, dormir: sinEspera });
  assert.equal(posts(t).length, 1);
  assert.deepEqual(resDe(dir).map(x => [x.est, x.err]), [["ejecutada", null], ["no_enviada", "fuera de horario"]]);
});
