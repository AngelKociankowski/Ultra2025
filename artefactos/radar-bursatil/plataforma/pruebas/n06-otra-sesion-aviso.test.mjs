// N6 · x05 del tester B5 (17): la sesión que llega a la misma exportación mientras otra corre sale por otra_sesion_viva sin tocar
// la carpeta (ni el aviso.txt de la otra); el RUNBOOK la manda a F4, que trae su propio texto
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { prepararDia, abrirDia, dbInicial, LUNES } from "./escenario.mjs";
import { carpetaTemporal, RAIZ } from "./util.mjs";

const F4 = "Radar · lun 2-nov · Otra sesión está corriendo la rutina de hoy; esta se detuvo.";

test("x05 · B a los 5 y 16 min de A (misma carpeta): otra_sesion_viva con el texto de F4 en la línea; el aviso.txt de A no cambia", async () => {
  const db = dbInicial({}), raiz = carpetaTemporal();
  const A = await prepararDia({ db, raiz });
  const avisoA = path.join(A.dir, "salida/aviso.txt");
  const B1 = await abrirDia({ db, t: LUNES + 5 * 60000, raiz });
  assert.equal(B1.dir, A.dir);
  assert.deepEqual([B1.preparar.codigo, B1.preparar.linea.resumen.motivo, B1.preparar.linea.resumen.aviso, B1.preparar.linea.escribir], [2, "otra_sesion_viva", F4, null]);
  assert.ok(!fs.existsSync(avisoA), "B no deja un aviso en la carpeta de A");
  await cerrar(["--dir", A.dir], { ahora: () => LUNES + 15 * 60000 });
  const deA = fs.readFileSync(avisoA, "utf8");
  const B2 = await abrirDia({ db, t: LUNES + 16 * 60000, raiz });
  assert.equal(B2.preparar.linea.resumen.motivo, "otra_sesion_viva");
  assert.equal(fs.readFileSync(avisoA, "utf8"), deA, "el aviso de A sigue siendo el de A");
});

test("RUNBOOK paso 3: con otra_sesion_viva la sesión va a F4 (no lee aviso.txt)", () => {
  const rb = fs.readFileSync(path.join(RAIZ, "RUNBOOK.md"), "utf8");
  assert.match(rb, /- \*\*Código 2\*\* \(`salir`\): si `resumen\.motivo` es `otra_sesion_viva`, F4 \(no leas `aviso\.txt`/);
  assert.ok(rb.includes("`Radar · <fecha> · Otra sesión está corriendo la rutina de hoy; esta se detuvo.`"));
});
