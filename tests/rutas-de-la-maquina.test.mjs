/**
 * Ninguna ruta de la máquina de quien escribió el código entra al repositorio.
 *
 * El defecto que origina esta prueba fue barato de arreglar y caro de
 * encontrar. Una prueba importaba un módulo por su ruta absoluta —el
 * directorio del contenedor donde se escribió—, en vez de derivarla de la suya.
 * Aquí pasaba, porque ese directorio existe. En el CI el repositorio vive en
 * otro sitio, así que el módulo no se encontraba y la suite quedaba roja.
 *
 * Lo caro fue que el síntoma no decía nada: la suite entera en verde en local
 * —cinco corridas, clon limpio, instalación limpia, el mismo Node— y roja en el
 * corredor, con el log detallado fuera de alcance. Se descartaron la versión de
 * Node, la memoria, los núcleos, la zona horaria y la variable CI antes de dar
 * con una línea.
 *
 * Es además la clase de error que se copia: la siguiente prueba que necesite
 * cargar un módulo a mano se escribe mirando a la de al lado.
 *
 * Lo que se vigila son las raíces que pertenecen a una máquina y no a un
 * proyecto. Una ruta como `/usr/bin/env` es del sistema y legítima; `/home/...`
 * y los directorios de trabajo de un agente son de quien pasó por aquí.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;

/** Directorios que existen en la máquina de alguien, no en el proyecto. */
const DE_ALGUIEN = [
  '/home/user/',
  '/home/runner/',
  '/Users/',
  '/root/.claude',
  '/tmp/claude-',
  '/opt/pw-browsers',
  'C:\\Users\\',
];

/** Lo que no se revisa: ni se escribe a mano ni viaja al CI. */
const FUERA = new Set(['node_modules', '.next', '.git', '.ciclo', 'data', 'out', 'coverage']);
const REVISABLES = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.yml', '.yaml', '.sql', '.sh']);

function archivos(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (FUERA.has(e.name)) continue;
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(completo));
    else if (REVISABLES.has(path.extname(e.name))) out.push(completo);
  }
  return out;
}

test('ninguna ruta de una máquina concreta entra al repositorio', () => {
  const culpables = [];
  for (const archivo of archivos(RAIZ)) {
    // La propia lista de arriba nombra esas rutas; sería su único falso positivo.
    if (archivo.endsWith('rutas-de-la-maquina.test.mjs')) continue;
    const lineas = fs.readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      for (const raiz of DE_ALGUIEN) {
        if (linea.includes(raiz)) {
          culpables.push(`${path.relative(RAIZ, archivo)}:${i + 1} → ${linea.trim().slice(0, 110)}`);
        }
      }
    });
  }

  assert.deepEqual(
    culpables,
    [],
    'Estas líneas llevan la ruta de una máquina concreta. Funcionan donde se escribieron y ' +
      'fallan en cualquier otro sitio, incluido el CI:\n  ' + culpables.join('\n  ') +
      '\nDerívala de `import.meta.url` si es un archivo del proyecto, o léela de una variable ' +
      'de entorno si es algo instalado en la máquina.'
  );
});
