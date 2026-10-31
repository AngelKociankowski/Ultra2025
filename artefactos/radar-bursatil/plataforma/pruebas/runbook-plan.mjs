// RUNBOOK.md y PROMPT-TAREA.md salen de 12b §L y §M con los cambios de abajo. Paso 0 (00p §1, reemplaza la etiqueta de 00m §1):
// el código que corre la rutina es el commit escrito en `artefactos/radar-bursatil/plataforma/APROBADO` de la rama (40 hex,
// ancestro de la rama); solo el director cambia ese archivo.
const REV_RAMA = "C=$(git rev-parse origin/claude/busy-hawking-0oxy6l) && X=";
export const LEER_APROBADO = "C=$(git show origin/claude/busy-hawking-0oxy6l:artefactos/radar-bursatil/plataforma/APROBADO | tr -d '[:space:]') && " +
  "echo \"$C\" | grep -Eqx '[0-9a-f]{40}' && git merge-base --is-ancestor \"$C\" origin/claude/busy-hawking-0oxy6l && X=";
const APROBADO = [[REV_RAMA, LEER_APROBADO]];
const FALLA_EXPORTAR = "Radar · Falla: no pude preparar el código de la rutina; sin operaciones.";
// el rescate trae la rama completa: merge-base y git archive necesitan el commit aprobado, que puede no ser la punta
const RESCATE = "git init /home/user/Ultra2025 && cd /home/user/Ultra2025 && git remote add origin https://github.com/angelkociankowski/ultra2025 && git fetch origin claude/busy-hawking-0oxy6l";
// N10 (17, desvío N-10 del reporte 16): el rescate de "repo inexistente" y la falta de commit= también en el prompt y en el paso 0
export const CAMBIOS_PROMPT = Object.freeze(APROBADO.concat([
  ["1. Exporta el código aprobado y prepara la carpeta (en Bash, una línea a la vez):\n",
    "1. Exporta el código aprobado y prepara la carpeta (en Bash, una línea a la vez). Si /home/user/Ultra2025 no existe, antes:\n" + `   ${RESCATE}\n`],
  ["2. Lee completo /home/user/rutina/actual", "   Si no aparece la línea commit=, no sigas: termina con el mensaje de falla de abajo.\n2. Lee completo /home/user/rutina/actual"],
]));
export const CAMBIOS_RUNBOOK = Object.freeze(APROBADO.concat([
  ["git fetch --depth=1 origin claude/busy-hawking-0oxy6l` y repite.", "git fetch origin claude/busy-hawking-0oxy6l` y repite."],
  // N10 / 00p: sin APROBADO válido el segundo comando no imprime commit= y `actual` sigue en la exportación anterior
  ["- Node menor que 22 o `PRUEBAS_FALLO`: F11.", "- El segundo comando no imprimió `commit=` (falta `APROBADO`, su sha no tiene 40 hex o no es ancestro de la rama): no corras\n" +
    `  ningún paso más. Último mensaje (y PushNotification): \`${FALLA_EXPORTAR}\`\n- Node menor que 22 o \`PRUEBAS_FALLO\`: F11.`],
  // N-5b (00o): lectura posterior a escribir (rutina-estado, cartera-libro y, si hubo envíos, ejecucion-<hoy>) y marca de revisión
  ["`D/trabajo/verificar.json` (es `rutina-estado`) y corre:", "`D/trabajo/verificar.json` (`rutina-estado`, `cartera-libro` y, si hubo envíos, `ejecucion-<hoy>`) y corre:"],
  ["node bin/db.mjs presupuesto --dir .trabajo/hoy\n```\n\n### 10. Avisar",
    "node bin/db.mjs presupuesto --dir .trabajo/hoy\n```\nSi `verificar` responde `accion: \"marcar\"` (lo releído no quedó como se preparó), haz ESCRIBIR del grupo `revision`: marca\n" +
    "el día para que el siguiente no opere hasta que el director lo revise (`aviso.txt` ya trae la falla).\n\n### 10. Avisar"],
  // N6: la sesión que sale por otra_sesion_viva no lee aviso.txt (en la misma exportación es el de la otra sesión)
  ["- **Código 2** (`salir`): si la línea trae `escribir`, haz ESCRIBIR del grupo `ahora`. Luego ve al paso 10. Fin.",
    "- **Código 2** (`salir`): si `resumen.motivo` es `otra_sesion_viva`, F4 (no leas `aviso.txt`: puede ser de la otra sesión). Si\n" +
    "  no, si la línea trae `escribir`, haz ESCRIBIR del grupo `ahora`. Luego ve al paso 10. Fin."],
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
