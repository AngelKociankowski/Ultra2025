/**
 * El freno del respaldo automático.
 *
 * `revisar()` está envuelto en un `try`, pero hay una falla que ningún `try`
 * atrapa: quedarse sin memoria. El sistema mata el proceso y no corre nada más.
 * El proveedor levanta otro, alguien entra, treinta segundos después la agenda
 * vuelve a mirar, ve que sigue sin haber respaldo de hoy, lo intenta otra vez —y
 * vuelve a morir—. Eso pasó de verdad: cuatro caídas en treinta y cinco minutos
 * en la bitácora del proveedor, todas con el mismo mensaje de falta de memoria.
 *
 * El freno es una marca en el disco, escrita ANTES de intentarlo justamente
 * porque tiene que sobrevivir a la muerte del proceso. Aquí se comprueba que la
 * decisión que toma con esa marca es la correcta, que es lo que separa «un
 * respaldo que falló» de «la plataforma inservible».
 *
 * Se copia `lib/agenda.js` a un `.mjs` temporal para importarlo: sus dependencias
 * pesadas se cargan con `import()` dentro de la función, así que las piezas de
 * arriba se pueden correr sueltas. Lo que no se puede es importarlo con su
 * extensión `.js`, porque el proyecto no está marcado como ESM y Node 20 —el que
 * corre en el servidor— lo leería como CommonJS.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');

let agenda;
let dir;
let antes;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-agenda-'));
  antes = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, 'ultra.db');

  const copia = path.join(dir, 'agenda.mjs');
  fs.copyFileSync(path.join(RAIZ, 'lib', 'agenda.js'), copia);
  agenda = await import(`file://${copia}`);
});

after(() => {
  if (antes === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = antes;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Deja la marca con la antigüedad que se quiera, en horas. */
function marcar(horas) {
  const ruta = agenda.rutaMarca();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, 'intento');
  if (horas) {
    const cuando = new Date(Date.now() - horas * 3600 * 1000);
    fs.utimesSync(ruta, cuando, cuando);
  }
  return ruta;
}

describe('el freno contra el bucle de caídas', () => {
  test('sin marca, adelante: el camino normal no se estorba', () => {
    fs.rmSync(agenda.rutaMarca(), { force: true });
    assert.equal(agenda.intentoReciente(), null);
  });

  test('con una marca recién puesta, no se reintenta', () => {
    marcar(0);
    const cuando = agenda.intentoReciente();
    assert.notEqual(cuando, null, 'un intento que no terminó tiene que frenar al siguiente');
    assert.ok(Math.abs(Date.now() - cuando) < 60000, 'y decir cuándo fue');
  });

  test('a las dos horas sigue frenado: un reinicio rápido no lo salta', () => {
    // Este es el caso que importa. El proveedor levanta el servidor enseguida y
    // la agenda mira a los treinta segundos: sin el freno, ahí volvía a morir.
    marcar(2);
    assert.notEqual(agenda.intentoReciente(), null);
  });

  test('pasadas las horas de espera, se vuelve a intentar solo', () => {
    marcar(7);
    assert.equal(agenda.intentoReciente(), null, 'el freno no puede quedarse puesto para siempre');
  });

  test('la marca vive junto a la base, no en el código', () => {
    // Va en el disco persistente del servidor: si viviera con el código, un
    // despliegue la borraría y el freno no serviría de nada.
    const ruta = agenda.rutaMarca();
    assert.equal(path.dirname(path.dirname(ruta)), dir);
    assert.equal(path.basename(ruta), '.intento');
  });
});
