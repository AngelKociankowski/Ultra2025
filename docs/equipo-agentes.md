# Equipo de construcción

Cuatro agentes que trabajan en cadena: plan → construcción → auditoría → reporte de dirección.

| Agente | Modelo | Qué hace |
|---|---|---|
| `arquitecto` | Opus | Interroga lo bloqueante, después entrega `PLAN.md` ejecutable |
| `coder` | Sonnet | Ejecuta el plan tarea por tarea contra los contratos |
| `tester` | Sonnet | Ataca lo construido hasta romperlo |
| `manager` | Opus | Verifica a los tres y reporta solo lo que requiere tu decisión |

Sirven igual para software (scripts, integraciones, automatizaciones) que para entregables de negocio (análisis, propuestas, metodologías).

## Uso

Los llamas por nombre en lenguaje natural:

```
Usa el arquitecto para planear un sistema que consolide los reportes
de incidencia de las rondas y saque un tablero semanal.

Corre el coder sobre las tareas 1 a 4 del plan.

Pásale el tester a lo que acaba de entregar el coder.

Manager: dame el estado real y qué necesito decidir.
```

## Flujo

```
Idea
 └─> arquitecto ──> hasta 6 preguntas bloqueantes
                ──> PLAN.md (contratos + tareas + criterios de aceptación)
      │
      ├─> coder  ──> implementa + registro de desvíos
      │      ↕  (máx. 2 rondas de discusión)
      ├─> tester ──> hallazgos con severidad y reproducción
      │
      └─> manager ──> una página: estado real, key issues, riesgo
                                      │
                                      └─> decides tú
```

## Reglas que los gobiernan

**El arquitecto pregunta antes de planear.** Máximo 6 preguntas bloqueantes, en un solo bloque, con opciones y recomendación. En ejecución desatendida asume el default conservador y marca cada suposición dentro del plan.

**El coder no rediseña.** Si el plan está mal, se detiene y lo reporta como desvío. Solo corrige errores triviales, y los anota. Esto evita descubrir al final que construyó otra cosa.

**El tester no arregla.** Encontrar y arreglar en la misma cabeza produce ceguera. Prueba contra el criterio de aceptación del plan, no contra lo que el coder declara. Un reporte sin hallazgos debe demostrar qué se atacó.

**Los desacuerdos tienen tope.** Dos rondas entre coder y tester. Sin acuerdo, escala al manager y el proyecto sigue.

**El manager filtra con una regla:** ¿es decisión que solo el director puede tomar (alcance, presupuesto, riesgo, prioridad, exposición ante cliente)? Si no, la resuelve el equipo y no se sube.

## Ajustes

Los archivos viven en `agents/`. Para cambiar el modelo de un agente, edita `model:` (`opus`, `sonnet`, `haiku` o `inherit`). Para cambiar permisos, edita `tools:`; borra la línea completa para que herede todas las herramientas disponibles.
