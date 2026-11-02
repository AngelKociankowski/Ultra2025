// T16 / K10 · RUNBOOK y prompt: texto literal de 12b §L y §M (con los cambios registrados en runbook-plan.mjs; paso 0 de 00p §1) y cada `node bin/…` citado existe y
// acepta sus opciones
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ } from "./util.mjs";
import { lectura } from "../lib/db.mjs";
import { CAMBIOS_RUNBOOK, LEER_APROBADO, FALLA_PUSH_DB, aplicar, bloqueL, cambios12c, bloqueH, CAMBIOS_DIRECTOR, F7_DIRECTOR } from "./runbook-plan.mjs";

const RUNBOOK = fs.readFileSync(path.join(RAIZ, "RUNBOOK.md"), "utf8");
const PROMPT = fs.readFileSync(path.join(RAIZ, "PROMPT-TAREA.md"), "utf8");
// valores de ejemplo para los marcadores del RUNBOOK
const MARCAS = { "<archivo|en_linea>": "en_linea", "<paso>": "cerrar", "<las que cargaron, separadas por comas, o ninguna>": "artifactdata,artifact,push" };

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
  assert.deepEqual([...vistos].sort(), ["bin/00-preparar.mjs", "bin/10-radar.mjs", "bin/20-cartera.mjs", "bin/30-fmp-noticias.mjs", "bin/40-decidir.mjs", "bin/50-ejecutar.mjs", "bin/60-cerrar.mjs", "bin/70-reporte.mjs", "bin/db.mjs", "bin/esperar.mjs"]);
  // W6: los comandos nuevos de 12c están y aceptan sus opciones
  for (const c of ["bin/10-radar.mjs --dir .trabajo/hoy --modo pagina", "bin/10-radar.mjs --dir .trabajo/hoy --modo correr", "bin/70-reporte.mjs --dir .trabajo/hoy --fase lista",
    "bin/70-reporte.mjs --dir .trabajo/hoy --fase armar", "bin/70-reporte.mjs --dir .trabajo/hoy --fase escribir", "bin/70-reporte.mjs --dir .trabajo/hoy --fase registrar"]) assert.ok(cmds.includes(c), c);
  assert.ok(cmds.some(c => c.includes("bin/00-preparar.mjs --fase lista --modo <archivo|en_linea> --herramientas")));
  // una opción que no existe falla (el --help no tapa errores de nombre)
  assert.throws(() => execFileSync(process.execPath, ["bin/20-cartera.mjs", "--dir", "x", "--modo", "y", "--help"], { cwd: RAIZ, stdio: "pipe" }));
});

test("RUNBOOK.md = 12b §L + cambios registrados + 12c §G literales (v2.1.0); PROMPT-TAREA.md = 12c §H literal", t => {
  const ruta = process.env.RADAR_PLAN || path.resolve(RAIZ, "../../../.trabajo/ciclo/12b-enmienda-plataforma.md");
  const rutaC = process.env.RADAR_PLAN_12C || path.resolve(RAIZ, "../../../.trabajo/ciclo/12c-enmienda-radar-reportes.md");
  if (!fs.existsSync(ruta) || !fs.existsSync(rutaC)) { t.skip("12b/12c no están en este clon (van fuera del repo)"); return; }
  const plan = fs.readFileSync(ruta, "utf8"), planC = fs.readFileSync(rutaC, "utf8");
  assert.equal(RUNBOOK, aplicar(aplicar(aplicar(bloqueL(plan), CAMBIOS_RUNBOOK), cambios12c(planC)), CAMBIOS_DIRECTOR));
  assert.equal(PROMPT, bloqueH(planC));
  assert.match(RUNBOOK, /^Versión 2\.1\.0\./m);
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

test("D7 · el RUNBOOK lee y escribe en modo archivo con lo que arma el código (texto guardado, línea exacta, batch, identidad)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-t16-"));
  const L = lectura("cartera-libro", { dirAbs: dir });
  assert.deepEqual(Object.keys(L.archivo).sort(), ["args", "herramienta", "linea", "texto"]);
  assert.equal(L.archivo.herramienta, "ArtifactData");
  for (const t of ["`D/<archivo.texto>`", "`archivo.linea`", "`out_dir`", "`accion: \"identidad\"`", "`D/salida/G/artifactdata.json`", "`D/salida/G/resultado.txt`", "`artifactdata-reintento.json`",
    "`db batch write failed (version_mismatch): …`), guarda el texto del error igual", "(`.txt`, también si es un error)"]) assert.ok(RUNBOOK.includes(t), t);
  assert.ok(!/sin_db|"version":<la versión que dice el texto>/.test(RUNBOOK), "sin restos del modo archivo desactivado ni de versiones copiadas a mano");
  assert.match(fs.readFileSync(path.join(RAIZ, "bin/db.mjs"), "utf8"), /"identidad"/);
});

test("D7 · paso 10: por PushNotification va aviso-push.txt (≤ 200); el último mensaje es el aviso completo; todo push fijo cabe", () => {
  const p10 = RUNBOOK.slice(RUNBOOK.indexOf("### 10. Avisar"), RUNBOOK.indexOf("## F."));
  for (const t of ["`D/salida/aviso.txt` (el aviso completo)", "`D/salida/aviso-push.txt` (una sola línea de ≤ 200 caracteres)", "`PushNotification` con la línea de push, tal cual",
    "Tu último mensaje es el aviso completo", `\`${FALLA_PUSH_DB}\``]) assert.ok(p10.includes(t), t);
  assert.match(PROMPT, /último mensaje es exactamente el aviso completo[\s\S]*por PushNotification va\s+la línea corta/);
  assert.match(fs.readFileSync(path.join(RAIZ, "lib/archivos.mjs"), "utf8"), /"aviso-push\.txt"/);
  // mensajes fijos que van por push (RUNBOOK y prompt), con los marcadores en su valor más largo
  const largo = { "<fecha>": "2026-11-25", "<día>": "mié", "<d-mes>": "25-nov", "<paso>": "30-fmp-noticias", "<commit corto>": "0123456789ab" };
  const fijos = [...RUNBOOK.matchAll(/`(Radar · [^`]+)`/g), ...PROMPT.matchAll(/^(Radar · .+)$/gm)].map(m => m[1]);
  assert.ok(fijos.length >= 6, String(fijos.length));
  for (const f of fijos) {
    let x = f;
    for (const [k, v] of Object.entries(largo)) x = x.split(k).join(v);
    assert.ok(!/<[^>]+>/.test(x), `marcador sin valor: ${f}`);
    assert.ok(x.length <= 200 && !x.includes("\n"), `${x.length}: ${x}`);
  }
});

test("W-5 (director): F7 manda a la página cuando 10-radar trae siguiente: \"pagina\" y si no, sin Radar", () => {
  const f7 = RUNBOOK.split("\n").filter(l => l.startsWith("- **F7 "));
  assert.deepEqual(f7, [F7_DIRECTOR]);
  assert.equal(F7_DIRECTOR, "- **F7 · La página cambió** (`10-radar` con motivo `pagina_cambio`): el Radar no corre por su cuenta hoy. Si la respuesta trae `siguiente: \"pagina\"`, sigue el paso 4 en modo `pagina`; si no, sigue sin Radar.");
  assert.ok(!RUNBOOK.includes("`pagina_cambio`): sigue sin Radar."));
  // y es lo que hace el código: con la página incompatible, correr deja siguiente: "pagina" (W2 criterio 6)
  assert.match(fs.readFileSync(path.join(RAIZ, "bin/10-radar.mjs"), "utf8"), /m === "pagina_cambio"/);
});
