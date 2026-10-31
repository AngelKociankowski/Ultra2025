# Radar Bursátil · plataforma (Fase 1)

Rutina diaria de la **Cartera Radar** en eToro **Demo**: corre el Radar sin navegador (mismo código de la página publicada
`../index.html`), lee la cartera, mide rendimientos, junta noticias fidedignas, decide con reglas fijas, opera solo en Demo
y deja todo en `db` del artefacto. Diseño y contratos: `12-plan-plataforma.md` y su enmienda `12b-enmienda-plataforma.md`
(manda sobre 12 donde lo dice) del ciclo.

- Node 22 o mayor, sin dependencias npm. Toda la red sale por `curl` (`lib/http.mjs`); las llaves las inyecta el secreto de
  red del entorno: ningún archivo de aquí las lee, las pone ni las guarda.
- Solo eToro **Demo**: la ruta Real no existe en el código. `rutina-config.operar = false` (simulación) hasta que el director
  lo active.
- Órdenes (12b §F): `50-ejecutar --armar` crea el reclamo `ejecucion-<hoy>` (sin `ifVersion`), `--enviar` manda a lo más un
  POST por línea con el diario sincronizado a disco antes de cada uno, y `--reanudar` (una vez) nunca reenvía una línea con
  envío. Lo dudoso cuenta como enviado (`incierta`, efectivo provisional) hasta que eToro lo muestre o pasen 3 días hábiles.
- La rutina corre una **exportación** del commit escrito en `APROBADO` (una línea, sha de 40 hex, ancestro de
  `origin/claude/busy-hawking-0oxy6l`; paso 0 del RUNBOOK), nunca el árbol de trabajo ni la punta de la rama. Solo el director
  cambia `APROBADO`, después de revisar (00p §1).

## `db` (12b §D–§E)

- Modo **en línea** (`mcp__claude-artifacts__db_get` / `db_write`): es el único activo. El modo archivo (`ArtifactData`) queda
  desactivado mientras `ACCION_REEMPLAZO` sea `null` en `lib/constantes.mjs` (D7).
- Los scripts no hablan con `db`: `00-preparar` da la lista de lecturas; Claude las copia a `entrada/lecturas.jsonl` y
  `node bin/db.mjs importar` las valida (kind, forma, integridad `h`). Toda escritura sale de `salida/<grupo>/db_write.json`
  (con `ifVersion` en lo leído) y se registra con `node bin/db.mjs registrar` (409, relectura y un reintento).
- Documentos propios (todos con `h`): `rutina-estado`, `rutina-config`, `cartera-libro`, `etoro-mapa`, `bitacora-mes-<mes>`,
  `punto-<f>`, `radar-<f>`, `bitacora-<f>`, `ops-<f>`, `ejecucion-<f>`. La rutina nunca lee ni escribe los de la página
  (`dia-*`, `indice`, `corrida`, `contador-*`, `vivo`, `plan`, `preferencias`); solo lee `feriados-<año>` si
  `feriados-nyse.json` no trae el año.
- `node bin/db.mjs presupuesto --dir <carpeta>`: bytes leídos y escritos en el día (tope 40 000).

## Probar

```
npm test
```

Las pruebas usan transportes falsos, un `db` falso con la semántica medida (versiones, `ifVersion`, 409, ≤ 50 ops), el
generador sintético de la página (`RadarSynth`) y respuestas reales guardadas (`pruebas/fixtures/`, con los identificadores de
cuenta sustituidos). No llaman a FMP ni envían órdenes. `pruebas/h<NN>-*.test.mjs` son los vectores del tester portados.

## Correr la rutina a mano

Sigue `RUNBOOK.md` paso a paso (es lo mismo que hace la tarea programada con `PROMPT-TAREA.md`). La carpeta de trabajo
`.trabajo/<fecha ET>/` (y el enlace `.trabajo/hoy`) es efímera y no va al repositorio.

## Herramientas del director

- `node bin/semilla.mjs --dir <carpeta>`: siembra única (grupo `semilla`: `rutina-config`, `cartera-libro`, `etoro-mapa`,
  `ops-2026-10-30`, `punto-2026-10-30`); se niega si `cartera-libro` existe o no se pudo leer (D2).
- `node bin/db.mjs config --dir <carpeta> --operar true|false --activado <iso>|null`: arma `salida/config/db_write.json` con
  `rutina-config` nuevo (`ifVersion` de la lectura, `h` válido) para activar o apagar las órdenes (T20; 00n). Antes, LEER
  `rutina-config` e `importar` en esa carpeta; después, ESCRIBIR el grupo `config` y `registrar`.
- `node bin/db.mjs revisado --dir <carpeta>`: quita la marca `revisar` de `rutina-estado` (la pone `verificar` cuando lo releído
  tras escribir no quedó como se preparó; mientras exista, la rutina no opera). Antes, LEER `rutina-estado` e `importar`;
  después, ESCRIBIR el grupo `revisado` y `registrar` (00o).
- `node bin/humo-etoro.mjs`: prueba de humo de eToro, solo lecturas (GET).
- `node bin/humo-fmp.mjs`: prueba de humo de FMP (22 llamadas; T00b).
- `compat.json`: huellas de la página con la que se validó el corredor. Republicar la página exige repetir la paridad (T05)
  y actualizar este archivo.
