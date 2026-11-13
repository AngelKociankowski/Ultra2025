/**
 * Un respaldo al que el sistema operativo le corta la escritura a la mitad.
 *
 * No es una prueba: es el proceso que `respaldos-poda.test.mjs` lanza aparte, con
 * un tope al tamaño de archivo puesto desde fuera (`ulimit -f`). Con ese tope,
 * el `write` que pasa del límite lo rechaza el núcleo —`EFBIG`—, igual que un
 * disco lleno rechaza el suyo con `ENOSPC`: una escritura de verdad que se corta
 * de verdad, a media escritura del .zip, sin simular nada dentro del código.
 *
 * Va en un proceso aparte porque el tope es del proceso entero y no se puede
 * quitar: puesto en el de las pruebas, les cortaría también a ellas.
 *
 * Por qué `ulimit` y no un disco lleno: llenar un disco de verdad pide montar
 * uno chico, y eso pide ser administrador de la máquina, que el CI no es. Esto
 * corre con cualquier usuario. Lo que NO prueba es el código de error exacto
 * —`EFBIG` en vez de `ENOSPC`—; eso lo cubre aparte la traducción del error, con
 * un `ENOSPC` sacado de `/dev/full`.
 *
 * Imprime una sola línea de JSON con lo que quedó.
 */

import { register } from 'node:module';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
process.env.DATABASE_PATH = path.join(dir, 'prueba.db');

register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
const respaldos = await import(new URL('../lib/respaldos.js', import.meta.url).href);
const { getDb } = await import(new URL('../lib/db.js', import.meta.url).href);
getDb();

const archivos = path.join(dir, 'archivos');
fs.mkdirSync(archivos, { recursive: true });
const sobra = () => 1e12; // sitio de sobra: aquí lo que falla es la escritura, no la cuenta

// 1. Uno bueno, chico, que cabe bajo el tope. Es el que tiene que sobrevivir.
fs.writeFileSync(path.join(archivos, 'chico.pdf'), randomBytes(64 * 1024));
const bueno = respaldos.crear({ motivo: 'manual', medir: sobra });

// 2. Adjuntos que no se comprimen y que, juntos, pasan del tope: el .zip del
//    segundo respaldo se corta a media escritura.
for (let i = 0; i < 4; i += 1) fs.writeFileSync(path.join(archivos, `grande-${i}.pdf`), randomBytes(3 * 1024 * 1024));

let fallo = null;
try {
  respaldos.crear({ motivo: 'automatico', conArchivos: true, medir: sobra });
} catch (err) {
  fallo = { code: err.code || null, message: err.message };
}

const e = respaldos.estado({ medir: sobra });
process.stdout.write(
  `\nRESULTADO ${JSON.stringify({
    bueno: bueno.nombre,
    fallo,
    lista: respaldos.listar().map((r) => ({ nombre: r.nombre, bien: r.bien })),
    enLaCarpeta: fs.readdirSync(path.join(dir, 'respaldos')),
    ultimoCompleto: e.ultimoCompleto?.nombre || null,
  })}\n`
);
process.exit(0);
