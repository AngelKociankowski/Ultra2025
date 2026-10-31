// T16 · RUNBOOK y prompt: cada comando existe y acepta sus opciones; texto literal del plan (§8.1, §8.2)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ } from "./util.mjs";

const RUNBOOK = fs.readFileSync(path.join(RAIZ, "RUNBOOK.md"), "utf8");
const PROMPT = fs.readFileSync(path.join(RAIZ, "PROMPT-TAREA.md"), "utf8");

test("cada `node bin/<x>.mjs` del RUNBOOK existe y acepta las opciones citadas (--help sale con 0)", () => {
  const cmds = [...RUNBOOK.matchAll(/node (bin\/[a-z0-9-]+\.mjs)([^\n`]*)/g)].map(m => [m[1], m[2].trim().split(/\s+/).filter(Boolean)]);
  assert.ok(cmds.length >= 15, `${cmds.length} comandos`);
  const vistos = new Set();
  for (const [archivo, args] of cmds) {
    assert.ok(fs.existsSync(path.join(RAIZ, archivo)), archivo);
    vistos.add(archivo);
    const salida = execFileSync(process.execPath, [archivo, ...args.map(x => (x === "D" ? ".trabajo/no-existe" : x)), "--help"], { cwd: RAIZ, encoding: "utf8", timeout: 20000 });
    assert.match(salida, /^Uso: node bin\//, `${archivo} ${args.join(" ")}`);
  }
  assert.deepEqual([...vistos].sort(), ["bin/00-preparar.mjs", "bin/10-radar.mjs", "bin/20-cartera.mjs", "bin/30-fmp-noticias.mjs", "bin/40-decidir.mjs", "bin/50-ejecutar.mjs", "bin/60-cerrar.mjs", "bin/esperar.mjs"]);
  // una opción que no existe falla (el --help no tapa errores de nombre)
  assert.throws(() => execFileSync(process.execPath, ["bin/20-cartera.mjs", "--dir", "x", "--modo", "y", "--help"], { cwd: RAIZ, stdio: "pipe" }));
});

test("RUNBOOK.md y PROMPT-TAREA.md son el texto literal del plan (§8.1, §8.2)", t => {
  const ruta = process.env.RADAR_PLAN || path.resolve(RAIZ, "../../../.trabajo/ciclo/12-plan-plataforma.md");
  if (!fs.existsSync(ruta)) { t.skip("el plan no está en este clon (va fuera del repo)"); return; }
  const plan = fs.readFileSync(ruta, "utf8");
  const i = plan.indexOf("### 8.1 `RUNBOOK.md`"), a = plan.indexOf("````markdown\n", i) + "````markdown\n".length;
  assert.equal(RUNBOOK, plan.slice(a, plan.indexOf("\n````\n", a)) + "\n");
  const j = plan.indexOf("### 8.2 Prompt"), c = plan.indexOf("```text\n", j) + "```text\n".length;
  assert.equal(PROMPT, plan.slice(c, plan.indexOf("\n```\n", c)) + "\n");
});
