// N10 · 17 (tester B5): el prompt §M trae el rescate de "repo inexistente" y se detiene si no aparece commit= (etiqueta borrada);
// los comandos del prompt se corren en un sandbox con un origin local (sin red)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { RAIZ, carpetaTemporal } from "./util.mjs";

const PROMPT = fs.readFileSync(path.join(RAIZ, "PROMPT-TAREA.md"), "utf8");
const hayGit = (() => { try { execFileSync("git", ["--version"], { stdio: "pipe" }); return true; } catch (e) { return false; } })();
const sh = (cmd, cwd) => { try { return { codigo: 0, salida: execFileSync("bash", ["-c", cmd], { cwd, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: "0" }) }) }; } catch (e) { return { codigo: e.status, salida: String(e.stdout || "") + String(e.stderr || "") }; } };

// comandos del paso 1 del prompt con las rutas del sandbox
function comandos(base, origen) {
  const lineas = PROMPT.split("\n").map(l => l.trim()).filter(l => /^(git init|cd \/home\/user\/Ultra2025)/.test(l));
  return lineas.map(l => l.split("/home/user/Ultra2025").join(path.join(base, "Ultra2025")).split("/home/user/rutina").join(path.join(base, "rutina"))
    .split("https://github.com/angelkociankowski/ultra2025").join(origen));
}
function origenConEtiqueta(base, etiqueta = true) {
  const w = path.join(base, "w"), o = path.join(base, "origen.git");
  sh(`git init -q --bare "${o}" && git init -q "${w}" && cd "${w}" && git config user.email t@t && git config user.name t && mkdir -p artefactos/radar-bursatil/plataforma && echo x > artefactos/radar-bursatil/plataforma/a && git add . && git -c commit.gpgsign=false commit -qm a && git remote add origin "${o}" && git push -q origin HEAD:refs/heads/main`, base);
  if (etiqueta) sh(`cd "${w}" && git -c tag.gpgsign=false tag rutina-aprobada && git push -q origin refs/tags/rutina-aprobada`, base);
  return o;
}

test("prompt §M paso 1: rescate con git init cuando no hay repo, y la línea commit= que lo confirma", { skip: !hayGit && "sin git" }, () => {
  const base = carpetaTemporal(), origen = origenConEtiqueta(base);
  const [rescate, fetch, exportar] = comandos(base, origen);
  assert.match(rescate, /^git init /); assert.match(fetch, /git fetch --force origin "refs\/tags\/rutina-aprobada/); assert.match(exportar, /echo "commit=\$C"$/);
  assert.equal(sh(rescate, base).codigo, 0);
  assert.match(sh(fetch, base).salida, /fetch=0/);
  const r = sh(exportar, base);
  assert.match(r.salida, /commit=[0-9a-f]{40}/);
  assert.ok(fs.existsSync(path.join(base, "rutina/actual/artefactos/radar-bursatil/plataforma/a")));
});

test("sin la etiqueta rutina-aprobada no aparece commit= y el prompt dice que no se siga", { skip: !hayGit && "sin git" }, () => {
  const base = carpetaTemporal(), origen = origenConEtiqueta(base, false);
  const [rescate, fetch, exportar] = comandos(base, origen);
  sh(rescate, base); sh(fetch, base);
  assert.ok(!/commit=/.test(sh(exportar, base).salida));
  assert.ok(PROMPT.includes("Si no aparece la línea commit=, no sigas: termina con el mensaje de falla de abajo."));
  assert.ok(PROMPT.includes("Radar · Falla: no pude preparar el código de la rutina; sin operaciones."));
});
