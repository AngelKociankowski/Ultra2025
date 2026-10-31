// N10 (17) y 00p §1: el paso 1 del prompt §M (igual al paso 0 del RUNBOOK) en un sandbox git con un origin local (sin red).
// Exporta el commit escrito en APROBADO (40 hex, ancestro de la rama), trae el rescate de "repo inexistente" y no imprime
// commit= si APROBADO falta, no es un sha o no es ancestro de la rama.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ, carpetaTemporal } from "./util.mjs";

const PROMPT = fs.readFileSync(path.join(RAIZ, "PROMPT-TAREA.md"), "utf8");
const RAMA = "claude/busy-hawking-0oxy6l", ARCH = "artefactos/radar-bursatil/plataforma";
const hayGit = (() => { try { execFileSync("git", ["--version"], { stdio: "pipe" }); return true; } catch (e) { return false; } })();
const sh = (cmd, cwd) => { try { return { codigo: 0, salida: execFileSync("bash", ["-c", cmd], { cwd, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: "0" }) }) }; } catch (e) { return { codigo: e.status, salida: String(e.stdout || "") + String(e.stderr || "") }; } };
const G = "git -c user.email=t@t -c user.name=t -c commit.gpgsign=false";

// comandos del paso 1 del prompt con las rutas del sandbox
function comandos(base, origen) {
  const lineas = PROMPT.split("\n").map(l => l.trim()).filter(l => /^(git init|cd \/home\/user\/Ultra2025)/.test(l));
  return lineas.map(l => l.split("/home/user/Ultra2025").join(path.join(base, "Ultra2025")).split("/home/user/rutina").join(path.join(base, "rutina"))
    .split("https://github.com/angelkociankowski/ultra2025").join(origen));
}
// origin con la rama: commit A (código "aprobado"), commit B (APROBADO = contenido dado) y, aparte, una rama sin relación
function origen(base, aprobado) {
  const w = path.join(base, "w"), o = path.join(base, "origen.git");
  const r = sh(`git init -q --bare "${o}" && git init -q "${w}" && cd "${w}" && mkdir -p ${ARCH} && echo A > ${ARCH}/codigo && git add . && ${G} commit -qm A && git rev-parse HEAD`, base);
  const A = r.salida.trim().split("\n").pop();
  const otro = sh(`cd "${w}" && P=$(git symbolic-ref --short HEAD) && git checkout -q --orphan otra && echo X > ${ARCH}/codigo && git add . && ${G} commit -qm X && git rev-parse HEAD && git checkout -q "$P"`, base).salida.trim().split("\n")[0];
  const valor = typeof aprobado === "function" ? aprobado({ A, otro }) : aprobado;
  const conArchivo = valor === null ? "" : `printf '%s\\n' '${valor}' > ${ARCH}/APROBADO && git add . && `;
  sh(`cd "${w}" && echo B > ${ARCH}/codigo && ${conArchivo}${G} commit -qam B && git push -q "${o}" HEAD:refs/heads/${RAMA} otra:refs/heads/otra`, base);
  return { o, A };
}
const correr = (base, o) => { const [rescate, fetch, exportar] = comandos(base, o); sh(rescate, base); sh(fetch, base); return sh(exportar, base); };

test("prompt §M paso 1: rescate con git init (rama completa), fetch y exportación del commit de APROBADO, no de la punta", { skip: !hayGit && "sin git" }, () => {
  const base = carpetaTemporal(), { o, A } = origen(base, ({ A }) => A);
  const [rescate, fetch, exportar] = comandos(base, o);
  assert.match(rescate, /^git init .* && git fetch origin claude\/busy-hawking-0oxy6l$/);
  assert.equal(sh(rescate, base).codigo, 0);
  assert.match(sh(fetch, base).salida, /fetch=0/);
  const r = sh(exportar, base);
  assert.match(r.salida, new RegExp(`commit=${A}`));
  assert.equal(fs.readFileSync(path.join(base, `rutina/actual/${ARCH}/codigo`), "utf8").trim(), "A", "se exporta el commit aprobado, no la punta (B)");
  assert.ok(fs.realpathSync(path.join(base, "rutina/actual")).endsWith(A.slice(0, 12)));
});

for (const [nombre, valor] of [["sin APROBADO", null], ["APROBADO que no es un sha de 40 hex", "abc123"], ["APROBADO con un commit que no es ancestro de la rama", ({ otro }) => otro]]) {
  test(`${nombre}: no aparece commit= y el prompt dice que no se siga`, { skip: !hayGit && "sin git" }, () => {
    const base = carpetaTemporal(), { o } = origen(base, valor);
    assert.ok(!/commit=/.test(correr(base, o).salida));
    assert.ok(!fs.existsSync(path.join(base, "rutina/actual")));
    assert.ok(PROMPT.includes("Si no aparece la línea commit=, no sigas: termina con el mensaje de falla de abajo."));
    assert.ok(PROMPT.includes("Radar · Falla: no pude preparar el código de la rutina; sin operaciones."));
  });
}
