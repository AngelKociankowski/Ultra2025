# Radar Bursátil · plataforma (Fase 1)

Rutina diaria de la **Cartera Radar** en eToro **Demo**: corre el Radar sin navegador (mismo código de la página publicada
`../index.html`), lee la cartera, mide rendimientos, junta noticias fidedignas, decide con reglas fijas, opera solo en Demo
y deja todo en `db` del artefacto. Diseño y contratos: `12-plan-plataforma.md` del ciclo.

- Node 22 o mayor, sin dependencias npm. Toda la red sale por `curl` (`lib/http.mjs`); las llaves las inyecta el secreto de
  red del entorno: ningún archivo de aquí las lee, las pone ni las guarda.
- Solo eToro **Demo**: la ruta Real no existe en el código. `rutina-config.operar = false` (simulación) hasta que el director
  lo active.

## Probar

```
npm test
```

Las pruebas usan transportes falsos, el generador sintético de la página (`RadarSynth`) y respuestas reales guardadas
(`pruebas/fixtures/`). No llaman a FMP ni envían órdenes.

## Correr la rutina a mano

Sigue `RUNBOOK.md` paso a paso (es lo mismo que hace la tarea programada con `PROMPT-TAREA.md`). La carpeta de trabajo
`.trabajo/<fecha ET>/` es efímera y no va al repositorio.

## Herramientas del director

- `node bin/semilla.mjs --dir <carpeta>`: siembra única de los documentos de la Cartera Radar (T18).
- `node bin/humo-etoro.mjs`: prueba de humo de eToro, solo lecturas (GET).
- `node bin/humo-fmp.mjs`: prueba de humo de FMP (22 llamadas; T00b).
- `compat.json`: huellas de la página con la que se validó el corredor. Republicar la página exige repetir la paridad (T05)
  y actualizar este archivo.
