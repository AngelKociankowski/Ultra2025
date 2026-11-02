// RUNBOOK.md y PROMPT-TAREA.md salen de 12b §L y §M con los cambios de abajo. Paso 0 (00p §1, reemplaza la etiqueta de 00m §1):
// el código que corre la rutina es el commit escrito en `artefactos/radar-bursatil/plataforma/APROBADO` de la rama (40 hex,
// ancestro de la rama); solo el director cambia ese archivo.
const REV_RAMA = "C=$(git rev-parse origin/claude/busy-hawking-0oxy6l) && X=";
export const LEER_APROBADO = "C=$(git show origin/claude/busy-hawking-0oxy6l:artefactos/radar-bursatil/plataforma/APROBADO | tr -d '[:space:]') && " +
  "echo \"$C\" | grep -Eqx '[0-9a-f]{40}' && git merge-base --is-ancestor \"$C\" origin/claude/busy-hawking-0oxy6l && X=";
const APROBADO = [[REV_RAMA, LEER_APROBADO]];
const FALLA_EXPORTAR = "Radar · Falla: no pude preparar el código de la rutina; sin operaciones.";
export const FALLA_PUSH_DB = "Radar · <día> <d-mes> · Falla: no se guardó en db; detalle en el chat.";
// el rescate trae la rama completa: merge-base y git archive necesitan el commit aprobado, que puede no ser la punta
const RESCATE = "git init /home/user/Ultra2025 && cd /home/user/Ultra2025 && git remote add origin https://github.com/angelkociankowski/ultra2025 && git fetch origin claude/busy-hawking-0oxy6l";
// N10 (17, desvío N-10 del reporte 16): el rescate de "repo inexistente" y la falta de commit= también en el prompt y en el paso 0
export const CAMBIOS_PROMPT = Object.freeze(APROBADO.concat([
  ["1. Exporta el código aprobado y prepara la carpeta (en Bash, una línea a la vez):\n",
    "1. Exporta el código aprobado y prepara la carpeta (en Bash, una línea a la vez). Si /home/user/Ultra2025 no existe, antes:\n" + `   ${RESCATE}\n`],
  ["2. Lee completo /home/user/rutina/actual", "   Si no aparece la línea commit=, no sigas: termina con el mensaje de falla de abajo.\n2. Lee completo /home/user/rutina/actual"],
  // D7 (00q §3): por push va la línea corta; el último mensaje es el aviso completo
  ["4. Tu último mensaje es exactamente el aviso que indica el RUNBOOK (también por PushNotification), sin nada antes ni después.",
    "4. Tu último mensaje es exactamente el aviso completo que indica el RUNBOOK, sin nada antes ni después; por PushNotification va\n" +
    "   la línea corta que indica el RUNBOOK (paso 10)."],
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
  // D7 (00q §1): modo archivo activo con los formatos medidos de ArtifactData; la sesión guarda el texto de cada respuesta y no
  // copia datos ni versiones (importar los saca del texto y del archivo de out_dir)
  ["  - *archivo*: herramienta `ArtifactData`.", "  - *archivo*: herramienta `ArtifactData` (acciones `get` y `batch`)."],
  ["   - *archivo*, existe: `{\"id\":\"<id>\",\"exists\":true,\"version\":<la versión que dice el texto>,\"archivo\":\"entrada/archivo/data/users/me/<id>.json\"}`\n" +
    "   - no existe: `{\"id\":\"<id>\",\"exists\":false}`\n   - error (tras un reintento a los pocos segundos):",
    "   - *en_linea*, no existe: `{\"id\":\"<id>\",\"exists\":false}`\n" +
    "   - *archivo* (exista o no, aunque el texto sea un error): primero guarda el texto completo de la respuesta, tal cual, en el\n" +
    "     archivo nuevo `D/<archivo.texto>`; después agrega la línea `archivo.linea` del elemento, copiada exacta. No copies datos\n" +
    "     ni versiones: `importar` los saca de ese texto y del archivo que `ArtifactData` dejó en `out_dir`.\n" +
    "   - error sin respuesta (tras un reintento a los pocos segundos):"],
  ["3. Al terminar la lista: `node bin/db.mjs importar --dir .trabajo/hoy`.",
    "3. Al terminar la lista: `node bin/db.mjs importar --dir .trabajo/hoy`. Si responde `accion: \"identidad\"` (en modo archivo, un\n" +
    "   texto dice que `me` resolvió a otro usuario): F9."],
  // D7-4: un batch rechazado no regresa texto normal sino un error de la herramienta; su texto se guarda igual
  ["guarda el texto de la respuesta\n   en `D/salida/G/resultado.txt`.", "guarda el texto completo de\n   la respuesta, tal cual, en `D/salida/G/resultado.txt`. Si la herramienta responde con un error (por ejemplo\n" +
    "   `db batch write failed (version_mismatch): …`), guarda el texto del error igual, tal cual, en ese mismo archivo."],
  ["guarda la respuesta en `resultado-reintento.json`\n   (`.txt`) y corre", "guarda la respuesta en `resultado-reintento.json`\n   (`.txt`, también si es un error) y corre"],
  ["Si cargó: modo **archivo** (si el paso 2 responde `sin_db`, F9).", "Si cargó: modo **archivo**."],
  ["(En modo archivo, la primera lectura debe decir que `me` resolvió a `u_Np_5cFP3Ho2rFiXosc9ZPw`; si dice otro id, F9.)",
    "(En modo archivo, cada texto de `ArtifactData` debe decir que `me` resolvió a `u_Np_5cFP3Ho2rFiXosc9ZPw`: `importar` lo comprueba.)"],
  // D7 (00q §3): PushNotification pide una línea de ≤ 200 caracteres; el aviso completo va en el chat
  ["- **PushNotification** para el aviso final.", "- **PushNotification** para la línea corta del aviso (`aviso-push.txt`, ≤ 200 caracteres); el aviso completo va en el chat."],
  ["(`aviso.txt` ya trae la falla).", "(`aviso.txt` y `aviso-push.txt` ya traen la falla)."],
  ["Lee `D/salida/aviso.txt`. Si `verificar` falló o una escritura no se pudo hacer, agrega al final una línea\n" +
    "`Falla: no se guardó en db: <ids>`; si el paso 0 no pudo hacer `fetch`, agrega `Aviso: código de <commit corto> (sin fetch)`.\n" +
    "Llama a `PushNotification` con ese texto (si pide título: `Radar · <día> <d-mes>`). Tu último mensaje es ese mismo texto, sin\n" +
    "nada antes ni después.",
    "Lee `D/salida/aviso.txt` (el aviso completo) y `D/salida/aviso-push.txt` (una sola línea de ≤ 200 caracteres). Si `verificar`\n" +
    "falló o una escritura no se pudo hacer, agrega al final del aviso una línea `Falla: no se guardó en db: <ids>` y usa como línea\n" +
    `de push \`${FALLA_PUSH_DB}\`; si el paso 0 no pudo hacer \`fetch\`, agrega al aviso\n` +
    "`Aviso: código de <commit corto> (sin fetch)`. Llama a `PushNotification` con la línea de push, tal cual (si pide título:\n" +
    "`Radar · <día> <d-mes>`). Tu último mensaje es el aviso completo, sin nada antes ni después."],
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
