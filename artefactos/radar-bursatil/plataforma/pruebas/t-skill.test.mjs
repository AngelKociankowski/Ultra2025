// W9 (12c §E) · Skill del proyecto "radar": el texto literal de 12c §E queda en plataforma/skill/radar/SKILL.md (viaja con la
// exportación). Su lugar de uso es .claude/skills/radar/SKILL.md en la raíz del repo: si ya está ahí, debe ser idéntico.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./util.mjs";
import { AYUDA } from "../bin/radar.mjs";
import { bloqueDe } from "./runbook-plan.mjs";

const SKILL = fs.readFileSync(path.join(RAIZ, "skill/radar/SKILL.md"), "utf8");
const EN_REPO = path.resolve(RAIZ, "../../../.claude/skills/radar/SKILL.md");

test("frontmatter con name: radar; cada `node bin/radar.mjs <comando>` existe en la ayuda; las dos URL de §E", () => {
  const fm = SKILL.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, "frontmatter");
  assert.match(fm[1], /^name: radar$/m); assert.match(fm[1], /^description: .+/m);
  const comandos = new Set(AYUDA.split("\n").filter(l => /^ {2}[a-z]/.test(l)).map(l => l.trim().split(/\s+/)[0]));
  const citados = [...SKILL.matchAll(/node bin\/radar\.mjs ([a-z]+)/g)].map(m => m[1]);
  assert.ok(citados.length >= 6);
  for (const c of citados) assert.ok(comandos.has(c), c);
  assert.deepEqual([...new Set(SKILL.match(/https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+/g))].sort(),
    ["https://claude.ai/artifact/FkRDmR1kpgQTQq7t1eLodw", "https://claude.ai/artifact/GiHN8dtAUzxpDoDSQYdU8s"]);
});

test("el texto es 12c §E literal; la copia de .claude/skills/radar/ (si existe) es idéntica", t => {
  const rutaC = process.env.RADAR_PLAN_12C || path.resolve(RAIZ, "../../../.trabajo/ciclo/12c-enmienda-radar-reportes.md");
  if (fs.existsSync(rutaC)) assert.equal(SKILL, bloqueDe(fs.readFileSync(rutaC, "utf8"), "## E. Skill del proyecto") + "\n");
  if (!fs.existsSync(EN_REPO)) { t.diagnostic("la skill aún no está en .claude/skills/radar/ (la pone el director)"); return; }
  assert.equal(fs.readFileSync(EN_REPO, "utf8"), SKILL);
});
