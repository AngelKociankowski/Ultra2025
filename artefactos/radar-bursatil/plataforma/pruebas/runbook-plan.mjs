// RUNBOOK.md y PROMPT-TAREA.md salen de 12b §L y §M con un solo cambio, decidido en 00m (1): el código que corre la rutina
// es la etiqueta `rutina-aprobada` de origin (la mueve el director al revisar), no la punta de la rama.
const FETCH_RAMA = 'git fetch origin claude/busy-hawking-0oxy6l; echo "fetch=$?"';
const FETCH_TAG = 'git fetch --force origin "refs/tags/rutina-aprobada:refs/tags/rutina-aprobada"; echo "fetch=$?"';
const REV_RAMA = "C=$(git rev-parse origin/claude/busy-hawking-0oxy6l)", REV_TAG = 'C=$(git rev-parse "rutina-aprobada^{commit}")';
export const CAMBIOS_PROMPT = Object.freeze([[FETCH_RAMA, FETCH_TAG], [REV_RAMA, REV_TAG]]);
export const CAMBIOS_RUNBOOK = Object.freeze(CAMBIOS_PROMPT.concat([
  ["git fetch --depth=1 origin claude/busy-hawking-0oxy6l` y repite.", 'git fetch --depth=1 origin "refs/tags/rutina-aprobada:refs/tags/rutina-aprobada"` y repite.'],
  ["sigue con el último `origin/claude/busy-hawking-0oxy6l` conocido y anótalo", "sigue con la última `rutina-aprobada` conocida y anótalo"],
]));
export function aplicar(texto, cambios) {
  let t = texto;
  for (const [a, b] of cambios) {
    if (t.split(a).length < 2) throw new Error(`no está en el texto del plan: ${a}`);
    t = t.split(a).join(b);
  }
  return t;
}
export function bloqueL(plan) {
  const i = plan.indexOf("## L. `RUNBOOK.md` nuevo"), a = plan.indexOf("````markdown\n", i) + "````markdown\n".length;
  return plan.slice(a, plan.indexOf("\n````\n", a)) + "\n";
}
export function bloqueM(plan) {
  const j = plan.indexOf("## M. Prompt de la tarea programada"), c = plan.indexOf("```text\n", j) + "```text\n".length;
  return plan.slice(c, plan.indexOf("\n```\n", c)) + "\n";
}
