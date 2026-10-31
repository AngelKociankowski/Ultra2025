// H22 · A10.1 portado (12b §F.6): las cuatro barreras con un db falso compartido; el cierre de la posición sale una sola vez
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as preparar } from "../bin/00-preparar.mjs";
import { semilla } from "../lib/libro.mjs";
import { prepararDia, abrirDia, dbInicial, OUT30, LUNES, copia } from "./escenario.mjs";
import { ejecutar, etoroGuion, reloj, posts, sinEspera } from "./ejecucion.mjs";
import { carpetaTemporal } from "./util.mjs";

const out = () => { const o = copia(OUT30); Object.assign(o.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 }); return o; };
const dbOperar = () => dbInicial({ "rutina-config": Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) });

test("A10.1 · B 30 s después → otra_sesion_viva (0 POST); con latido viejo B toma el día y su pre-ejecucion da 409 → ya_hubo_envio; 1 POST en total", async () => {
  const db = dbOperar(), raiz = carpetaTemporal();
  const A = await prepararDia({ db, out: out(), raiz });
  assert.equal(A.decidir.linea.accion, "ejecutar");
  const ahora = reloj(new Date(LUNES + 11 * 60000).toISOString()), et = etoroGuion({ reloj: ahora });
  const op = { transporteEToro: et, ahora, dormir: sinEspera };
  assert.equal((await ejecutar(["--dir", A.dir, "--armar"], op)).linea.accion, "armado");
  assert.equal(A.S.escribir("pre-ejecucion").accion, "listo");
  // barrera 1 · otra sesión 30 s después, en otro contenedor y en la misma exportación (no pisa la carpeta de A)
  const B = await abrirDia({ db, t: LUNES + 30000 });
  assert.deepEqual([B.preparar.codigo, B.preparar.linea.resumen.motivo], [2, "otra_sesion_viva"]);
  const prepA = fs.readFileSync(path.join(A.dir, "trabajo/preparar.json"), "utf8");
  const misma = await abrirDia({ db, t: LUNES + 30000, raiz });
  assert.equal(misma.dir, A.dir); assert.equal(misma.preparar.linea.resumen.motivo, "otra_sesion_viva");
  assert.equal(fs.readFileSync(path.join(A.dir, "trabajo/preparar.json"), "utf8"), prepA, "la sesión que sale no pisa los archivos de la viva");
  assert.equal(posts(et).length, 0);
  const rA = await ejecutar(["--dir", A.dir, "--enviar"], op);
  assert.equal(rA.codigo, 0); assert.equal(posts(et).length, 1);
  // barreras 2–4 · C llega con el latido de A viejo (31 min): toma el día, decide lo mismo y su reclamo de envío choca
  const C = await prepararDia({ db, out: out(), t: LUNES + 31 * 60000 });
  assert.equal(C.preparar.linea.accion, "recuperar"); assert.equal(C.decidir.linea.accion, "ejecutar");
  const opC = { transporteEToro: et, ahora: reloj(new Date(LUNES + 42 * 60000).toISOString()), dormir: sinEspera };
  assert.equal((await ejecutar(["--dir", C.dir, "--armar"], opC)).linea.accion, "armado");
  assert.equal(C.S.escribir("pre-ejecucion").accion, "ya_hubo_envio");
  const rC = await ejecutar(["--dir", C.dir, "--enviar"], opC);
  assert.deepEqual([rC.codigo, rC.linea.accion], [3, "ya_ejecutado"]);
  assert.equal(posts(et).filter(p => p.url.endsWith("/positions/2600000005")).length, 1);
  assert.equal(posts(et).length, 1);
});
