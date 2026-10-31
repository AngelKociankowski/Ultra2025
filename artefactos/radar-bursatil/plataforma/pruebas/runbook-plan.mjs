// RUNBOOK.md y PROMPT-TAREA.md salen de 12b §L y §M con un solo cambio, decidido en 00m (1): el código que corre la rutina
// es la etiqueta `rutina-aprobada` de origin (la mueve el director al revisar), no la punta de la rama.
const FETCH_RAMA = 'git fetch origin claude/busy-hawking-0oxy6l; echo "fetch=$?"';
const FETCH_TAG = 'git fetch --force origin "refs/tags/rutina-aprobada:refs/tags/rutina-aprobada"; echo "fetch=$?"';
const REV_RAMA = "C=$(git rev-parse origin/claude/busy-hawking-0oxy6l)", REV_TAG = 'C=$(git rev-parse "rutina-aprobada^{commit}")';
const ETIQUETA = [[FETCH_RAMA, FETCH_TAG], [REV_RAMA, REV_TAG]];
const FALLA_EXPORTAR = "Radar · Falla: no pude preparar el código de la rutina; sin operaciones.";
// N10 (17, desvío N-10 del reporte 16): el rescate de "repo inexistente" y la falta de etiqueta también en el prompt y en el paso 0
export const CAMBIOS_PROMPT = Object.freeze(ETIQUETA.concat([
  ["1. Exporta el código aprobado y prepara la carpeta (en Bash, una línea a la vez):\n",
    "1. Exporta el código aprobado y prepara la carpeta (en Bash, una línea a la vez). Si /home/user/Ultra2025 no existe, antes:\n" +
    '   git init /home/user/Ultra2025 && cd /home/user/Ultra2025 && git remote add origin https://github.com/angelkociankowski/ultra2025 && git fetch --depth=1 origin "refs/tags/rutina-aprobada:refs/tags/rutina-aprobada"\n'],
  ["2. Lee completo /home/user/rutina/actual", "   Si no aparece la línea commit=, no sigas: termina con el mensaje de falla de abajo.\n2. Lee completo /home/user/rutina/actual"],
]));
export const CAMBIOS_RUNBOOK = Object.freeze(ETIQUETA.concat([
  ["git fetch --depth=1 origin claude/busy-hawking-0oxy6l` y repite.", 'git fetch --depth=1 origin "refs/tags/rutina-aprobada:refs/tags/rutina-aprobada"` y repite.'],
  ["sigue con el último `origin/claude/busy-hawking-0oxy6l` conocido y anótalo", "sigue con la última `rutina-aprobada` conocida y anótalo"],
  // N10: sin etiqueta el segundo comando no imprime commit= y `actual` sigue en la exportación anterior
  ["- Node menor que 22 o `PRUEBAS_FALLO`: F11.", "- El segundo comando no imprimió `commit=` (no hay etiqueta `rutina-aprobada`): no corras ningún paso más. Último mensaje (y\n" +
    `  PushNotification): \`${FALLA_EXPORTAR}\`\n- Node menor que 22 o \`PRUEBAS_FALLO\`: F11.`],
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
