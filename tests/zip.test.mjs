/**
 * El armador de ZIP, por dentro.
 *
 * Casi todas las pruebas de esta plataforma van contra el servidor de verdad, y
 * el respaldo ya se prueba así en `respaldos.test.mjs`: se hace, se baja, lo
 * abre el `unzip` del sistema y se restaura. Eso comprueba que sirve.
 *
 * Esto comprueba otra cosa que desde fuera no se ve. El respaldo pasó a
 * escribirse al disco archivo por archivo en lugar de armarse entero en memoria,
 * porque armarlo entero mataba el proceso por falta de memoria en el servidor
 * chico donde corre —y un proceso muerto se ve como un 502 sin explicación—.
 * Ese cambio toca cómo se produce el único archivo del que depende la vuelta
 * atrás, así que hace falta una prueba que diga, sin lugar a dudas, que el
 * camino nuevo escribe EXACTAMENTE el mismo ZIP que el viejo.
 *
 * `lib/zip.js` se copia a un `.mjs` temporal para importarlo. Es el único módulo
 * de `lib/` que no toca la base ni React, así que se puede correr suelto; lo que
 * no se puede es importarlo con su extensión `.js`, porque el proyecto no está
 * marcado como ESM y Node 20 —el que corre en el servidor— lo leería como
 * CommonJS. La copia evita eso sin tener que reacomodar el proyecto entero.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
/** Fija, porque el ZIP guarda la hora y dos corridas no darían lo mismo. */
const FECHA = new Date('2026-01-15T10:20:30');

let zip;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-zip-'));
  const copia = path.join(dir, 'zip.mjs');
  fs.copyFileSync(path.join(RAIZ, 'lib', 'zip.js'), copia);
  zip = await import(`file://${copia}`);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Las tres formas de contenido donde el ZIP se escribe distinto. */
function muestras() {
  return {
    // Texto: se comprime, así que sale con método 8.
    'texto.xml': Buffer.from('<factura>ñ á é — '.repeat(500), 'utf8'),
    // Ya comprimido: `deflate` lo dejaría más grande, así que se guarda tal cual
    // con método 0. Es la rama que nadie prueba nunca.
    'crudo.pdf': randomBytes(256 * 1024),
    // Vacío: cero bytes, y el ZIP tiene que seguir cuadrando.
    'vacio.txt': Buffer.alloc(0),
  };
}

describe('escribir al disco da el mismo ZIP que armarlo en memoria', () => {
  test('byte por byte, con las tres clases de contenido', () => {
    const m = muestras();
    const enDisco = path.join(dir, 'sueltos');
    fs.mkdirSync(enDisco, { recursive: true });

    const porRuta = [];
    const porDatos = [];
    for (const [nombre, datos] of Object.entries(m)) {
      const ruta = path.join(enDisco, nombre);
      fs.writeFileSync(ruta, datos);
      porRuta.push({ nombre, ruta });
      porDatos.push({ nombre, datos });
    }

    const destino = path.join(dir, 'streamed.zip');
    zip.escribirZipAArchivo(destino, porRuta, FECHA);

    const a = fs.readFileSync(destino);
    const b = zip.escribirZip(porDatos, FECHA);
    assert.equal(a.length, b.length, 'los dos ZIP no pesan lo mismo');
    assert.ok(a.equals(b), 'el ZIP escrito al disco no es igual al armado en memoria');
  });

  test('mezclando entradas de disco y de memoria', () => {
    const ruta = path.join(dir, 'suelto.bin');
    fs.writeFileSync(ruta, randomBytes(4096));
    const datos = Buffer.from('un manifiesto que nunca tocó el disco', 'utf8');

    const destino = path.join(dir, 'mezcla.zip');
    zip.escribirZipAArchivo(destino, [{ nombre: 'a.bin', ruta }, { nombre: 'b.json', datos }], FECHA);

    const leidas = zip.leerZip(fs.readFileSync(destino));
    assert.deepEqual(leidas.map((e) => e.nombre), ['a.bin', 'b.json']);
    assert.ok(leidas[0].datos.equals(fs.readFileSync(ruta)));
    assert.ok(leidas[1].datos.equals(datos));
  });
});

describe('lo que sale se puede volver a abrir', () => {
  test('lo lee el propio lector, con todo y verificación de CRC', () => {
    const m = muestras();
    const destino = path.join(dir, 'ida-y-vuelta.zip');
    zip.escribirZipAArchivo(
      destino,
      Object.entries(m).map(([nombre, datos]) => ({ nombre, datos })),
      FECHA
    );

    for (const e of zip.leerZip(fs.readFileSync(destino))) {
      assert.ok(e.datos.equals(m[e.nombre]), `«${e.nombre}» no volvió igual`);
    }
  });

  test('lo da por bueno el unzip del sistema, que es el que lo va a abrir', () => {
    const destino = path.join(dir, 'para-unzip.zip');
    const m = muestras();
    zip.escribirZipAArchivo(
      destino,
      Object.entries(m).map(([nombre, datos]) => ({ nombre, datos })),
      FECHA
    );

    // `-t` revisa el CRC de cada entrada: si alguna cabecera estuviera mal
    // escrita, aquí truena.
    execFileSync('unzip', ['-t', destino]);
    const dentro = execFileSync('unzip', ['-Z1', destino]).toString().trim().split('\n');
    assert.deepEqual(dentro.sort(), Object.keys(m).sort());

    const salida = execFileSync('unzip', ['-p', destino, 'crudo.pdf'], { maxBuffer: 8 * 1024 * 1024 });
    assert.ok(salida.equals(m['crudo.pdf']), 'el PDF que saca unzip no es el que se metió');
  });

  test('las carpetas dentro del ZIP se respetan', () => {
    const destino = path.join(dir, 'carpetas.zip');
    zip.escribirZipAArchivo(destino, [
      { nombre: 'ultra.db', datos: Buffer.from('base') },
      { nombre: 'archivos/factura-1.pdf', datos: Buffer.from('pdf') },
    ], FECHA);
    const dentro = zip.leerZip(fs.readFileSync(destino)).map((e) => e.nombre);
    assert.deepEqual(dentro, ['ultra.db', 'archivos/factura-1.pdf']);
  });
});

describe('lo que no debe pasar', () => {
  test('si un archivo desaparece a media escritura, avisa y no deja un ZIP a medias', () => {
    const ruta = path.join(dir, 'se-va.bin');
    fs.writeFileSync(ruta, Buffer.from('aquí estoy'));
    const destino = path.join(dir, 'roto.zip');

    fs.rmSync(ruta, { force: true });
    assert.throws(
      () => zip.escribirZipAArchivo(destino, [{ nombre: 'se-va.bin', ruta }], FECHA),
      /ENOENT/,
      'tiene que fallar en voz alta, no escribir un respaldo incompleto'
    );
    // Y el archivo a medias no puede pasar por un respaldo bueno: no tiene
    // directorio, así que el lector lo rechaza.
    assert.throws(() => zip.leerZip(fs.readFileSync(destino)), /no es un ZIP válido/);
  });
});

/**
 * El motivo de todo esto, medido.
 *
 * Se compara el pico de memoria de los dos caminos con contenido de un tamaño
 * parecido al de un respaldo completo real. El umbral es holgado a propósito
 * —la memoria de un proceso de Node no es determinista y esto corre en máquinas
 * distintas—, pero un descuido que volviera a juntarlo todo en memoria haría
 * subir el pico varias veces y esta prueba lo cazaría.
 */
describe('la memoria', () => {
  test('escribir al disco no carga todo el contenido a la vez', () => {
    const grande = path.join(dir, 'grandes');
    fs.mkdirSync(grande, { recursive: true });
    const entradas = [];
    const TROZO = 4 * 1024 * 1024;
    const CUANTOS = 12; // 48 MB en total
    for (let i = 0; i < CUANTOS; i++) {
      const ruta = path.join(grande, `a${i}.pdf`);
      fs.writeFileSync(ruta, randomBytes(TROZO));
      entradas.push({ nombre: `archivos/a${i}.pdf`, ruta });
    }

    const antes = process.memoryUsage().rss;
    zip.escribirZipAArchivo(path.join(dir, 'grande.zip'), entradas, FECHA);
    const subio = process.memoryUsage().rss - antes;
    const total = TROZO * CUANTOS;

    assert.ok(
      subio < total / 2,
      `el pico subió ${Math.round(subio / 1024 / 1024)} MB para ${Math.round(total / 1024 / 1024)} MB de contenido: ` +
        'se está cargando de más'
    );
  });
});
