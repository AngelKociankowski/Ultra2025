// T16 / K10 · RUNBOOK y prompt: texto literal de 12b §L y §M (con los cambios registrados en runbook-plan.mjs; paso 0 de 00p §1) y cada `node bin/…` citado existe y
// acepta sus opciones
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ } from "./util.mjs";
import { CAMBIOS_RUNBOOK, CAMBIOS_PROMPT, LEER_APROBADO, aplicar, bloqueL, bloqueM } from "./runbook-plan.mjs";

const RUNBOOK = fs.readFileSync(path.join(RAIZ, "RUNBOOK.md"), "utf8");
const PROMPT = fs.readFileSync(path.join(RAIZ, "PROMPT-TAREA.md"), "utf8");
// valores de ejemplo para los marcadores del RUNBOOK
const MARCAS = { "<archivo|en_linea>": "en_linea", "<radar.accion de D/trabajo/preparar.json>": "correr", "<paso>": "cerrar" };

function comandos(texto) {
  const out = [];
  for (const m of texto.matchAll(/node (bin\/[a-z0-9-]+\.mjs[^\n`]*)/g)) for (const parte of m[1].split("&&")) out.push(parte.trim().replace(/^node /, ""));
  return [...new Set(out)];
}

test("cada `node bin/<x>.mjs` del RUNBOOK existe y acepta las opciones citadas (--help sale con 0)", () => {
  const cmds = comandos(RUNBOOK);
  // --reanudar se cita como opción en lugar de --enviar (paso 8.4)
  if (/con `--reanudar` en lugar de `--enviar`/.test(RUNBOOK)) cmds.push("bin/50-ejecutar.mjs --dir .trabajo/hoy --reanudar");
  assert.ok(cmds.length >= 17, `${cmds.length} comandos`);
  const vistos = new Set();
  for (const c of cmds) {
    let txt = c;
    for (const [k, v] of Object.entries(MARCAS)) txt = txt.split(k).join(v);
    const [archivo, ...args] = txt.split(/\s+/);
    assert.ok(fs.existsSync(path.join(RAIZ, archivo)), archivo);
    vistos.add(archivo);
    const salida = execFileSync(process.execPath, [archivo, ...args.map(x => (x === ".trabajo/hoy" ? ".trabajo/no-existe" : x)), "--help"], { cwd: RAIZ, encoding: "utf8", timeout: 20000 });
    assert.match(salida, /^Uso: node bin\//, c);
  }
  assert.deepEqual([...vistos].sort(), ["bin/00-preparar.mjs", "bin/10-radar.mjs", "bin/20-cartera.mjs", "bin/30-fmp-noticias.mjs", "bin/40-decidir.mjs", "bin/50-ejecutar.mjs", "bin/60-cerrar.mjs", "bin/db.mjs", "bin/esperar.mjs"]);
  // una opción que no existe falla (el --help no tapa errores de nombre)
  assert.throws(() => execFileSync(process.execPath, ["bin/20-cartera.mjs", "--dir", "x", "--modo", "y", "--help"], { cwd: RAIZ, stdio: "pipe" }));
});

test("RUNBOOK.md y PROMPT-TAREA.md = 12b §L y §M literales salvo los cambios registrados (paso 0 con APROBADO, 00p §1)", t => {
  const ruta = process.env.RADAR_PLAN || path.resolve(RAIZ, "../../../.trabajo/ciclo/12b-enmienda-plataforma.md");
  if (!fs.existsSync(ruta)) { t.skip("12b no está en este clon (va fuera del repo)"); return; }
  const plan = fs.readFileSync(ruta, "utf8");
  assert.equal(RUNBOOK, aplicar(bloqueL(plan), CAMBIOS_RUNBOOK));
  assert.equal(PROMPT, aplicar(bloqueM(plan), CAMBIOS_PROMPT));
});

test("el paso 0 y el prompt exportan el commit de APROBADO (40 hex, ancestro de la rama), nunca la punta ni una etiqueta", () => {
  for (const txt of [RUNBOOK, PROMPT]) {
    assert.ok(!/rutina-aprobada|refs\/tags/.test(txt));
    assert.ok(!txt.includes("C=$(git rev-parse origin/claude/busy-hawking-0oxy6l)"), "la punta de la rama no se exporta");
    assert.ok(txt.includes('cd /home/user/Ultra2025 && git fetch origin claude/busy-hawking-0oxy6l; echo "fetch=$?"'));
    assert.ok(txt.includes(`cd /home/user/Ultra2025 && ${LEER_APROBADO}/home/user/rutina/\${C:0:12}`));
    assert.ok(!/--depth=1/.test(txt), "el rescate trae la rama completa (merge-base y git archive necesitan el commit aprobado)");
  }
  assert.match(RUNBOOK, /npm test > \.npm-test\.txt 2>&1 && touch \.probado/);
});
