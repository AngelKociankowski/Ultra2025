// N9 · x09 del tester B5 (17): 50-ejecutar no arma ni envía si rutina-config (tal como llegó de db) no tiene operar activado,
// aunque plan-ordenes.json y decisiones.json se hayan reescrito con simulacion:false y huella coherente
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { shaArchivo } from "../bin/40-decidir.mjs";
import { escribirTrabajo, leerTrabajo } from "../lib/archivos.mjs";
import { prepararDia, OUT30, LUNES, copia } from "./escenario.mjs";
import { ejecutar, etoroGuion, reloj, posts, sinEspera, montar, reclamar } from "./ejecucion.mjs";
import { leerSalida, agregarLecturas } from "./util.mjs";
import { semilla } from "../lib/libro.mjs";
import { conH } from "../lib/db.mjs";

const outXle = () => { const o = copia(OUT30); Object.assign(o.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 }); return o; };

test("x09 (a) · simulación: --armar nada; --enviar y --reanudar se niegan; 0 POST", async () => {
  const e = await prepararDia({ out: outXle() }); // semilla: operar:false
  const ahora = reloj(new Date(LUNES + 11 * 60000).toISOString()), t = etoroGuion({ reloj: ahora }), op = { transporteEToro: t, ahora, dormir: sinEspera };
  const a = await ejecutar(["--dir", e.dir, "--armar"], op), b = await ejecutar(["--dir", e.dir, "--enviar"], op), c = await ejecutar(["--dir", e.dir, "--reanudar"], op);
  assert.deepEqual([a.linea.accion, b.codigo, c.codigo, posts(t).length], ["nada", 3, 3, 0]);
});

test("x09 (b) · plan y decisiones reescritos con simulacion:false y operar:false en db → --armar nada, 0 POST", async () => {
  const e = await prepararDia({ out: outXle() });
  const plan = leerTrabajo(e.dir, "plan-ordenes.json"); plan.simulacion = false; escribirTrabajo(e.dir, "plan-ordenes.json", plan);
  const dec = leerTrabajo(e.dir, "decisiones.json"); dec.simulacion = false; dec.planSha = shaArchivo(path.join(e.dir, "trabajo/plan-ordenes.json")); escribirTrabajo(e.dir, "decisiones.json", dec);
  // también preparar.json reescrito con operar:true: manda rutina-config de db
  const prep = leerTrabajo(e.dir, "preparar.json"); prep.config = Object.assign({}, prep.config, { operar: true, activadoEl: "2026-11-01T15:00:00Z" }); escribirTrabajo(e.dir, "preparar.json", prep);
  const ahora = reloj(new Date(LUNES + 11 * 60000).toISOString()), t = etoroGuion({ reloj: ahora }), op = { transporteEToro: t, ahora, dormir: sinEspera };
  const a = await ejecutar(["--dir", e.dir, "--armar"], op);
  assert.deepEqual([a.linea.accion, a.linea.resumen.motivo], ["nada", "rutina-config.operar no está activado"]);
  assert.ok(leerSalida(e.dir, "trabajo/ejecucion.json").res.every(r => r.est === "no_enviada"));
  assert.equal((await ejecutar(["--dir", e.dir, "--enviar"], op)).codigo, 3);
  assert.equal(posts(t).length, 0);
});

test("x09 (c) · rutina-config de db con operar:false aunque ya exista un reclamo: --enviar se niega, 0 POST", async () => {
  const m = montar(), ahora = reloj(), t = etoroGuion({ reloj: ahora }), op = { transporteEToro: t, ahora, dormir: sinEspera };
  assert.equal((await ejecutar(["--dir", m.dir, "--armar"], op)).linea.accion, "armado");
  reclamar(m.dir);
  // la copia de rutina-config de db dice operar:false (p. ej. el director la apagó y la sesión la volvió a leer)
  agregarLecturas(m.dir, [{ id: "rutina-config", exists: true, version: 9, data: conH(semilla()["rutina-config"]) }]);
  const r = await ejecutar(["--dir", m.dir, "--enviar"], op);
  assert.deepEqual([r.codigo, r.linea.accion], [3, "incompleto"]);
  assert.equal(posts(t).length, 0);
});
