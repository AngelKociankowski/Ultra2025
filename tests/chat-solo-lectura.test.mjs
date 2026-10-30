/**
 * El asistente no añade ninguna puerta de escritura.
 *
 * La promesa de este encargo es «solo lee», y en esta casa eso no se afirma: se
 * mide con el censo que `tests/_puertas-de-escritura.mjs` deriva del código. Ese
 * censo lee `lib/*.js` SIN bajar a subdirectorios, y por eso los módulos del
 * chat van planos en `lib/` con extensión `.js`: meterlos en `lib/chat/` los
 * dejaría fuera del censo, que es exactamente lo que no se quiere de un encargo
 * cuya promesa es que no añade ninguna puerta. Si alguien los mueve, estas
 * pruebas dejan de medir nada, así que también se comprueba dónde viven.
 *
 * La tabla del consumo no se agrega a `TABLAS_DE_DATOS` a propósito: no guarda
 * ningún dato capturado por nadie —guarda cuántas preguntas hizo una cuenta hoy
 * y cuántos tokens costaron, y lo escribe el servidor, no un teclado—. Si el
 * director o el tester consideran que aun así es una puerta, la alternativa es un
 * contador en memoria, que se pierde en cada despliegue y no sirve con dos
 * procesos: sería un tope que no topa. Queda dicho aquí para que la decisión se
 * pueda discutir mirando esta prueba.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { censo, nombreLargo, TABLAS_DE_DATOS } from './_puertas-de-escritura.mjs';

const LIB = new URL('../lib/', import.meta.url);

/** Los módulos del asistente, tal como el censo los ve. */
const DEL_CHAT = fs
  .readdirSync(LIB)
  .filter((f) => f.startsWith('chat-') && f.endsWith('.js'))
  .sort();

describe('el censo de las puertas sigue diciendo lo mismo', () => {
  test('las tablas de datos siguen siendo cinco, y el consumo no está entre ellas', () => {
    assert.equal(
      TABLAS_DE_DATOS.length,
      5,
      `el censo vigila ${TABLAS_DE_DATOS.length} tablas de datos capturados y tenían que seguir siendo cinco: ` +
        TABLAS_DE_DATOS.join(', ')
    );
    assert.ok(
      !TABLAS_DE_DATOS.includes('chat_consumo'),
      'la tabla del consumo entró en el censo de los datos capturados, y no guarda nada que nadie teclee'
    );
  });

  test('ningún módulo del asistente aparece entre las puertas', () => {
    const { puertas } = censo();
    const delChat = puertas.filter((p) => p.archivo.startsWith('chat-')).map((p) => nombreLargo(p));
    assert.deepEqual(
      delChat,
      [],
      'estas funciones del asistente escriben en una tabla de datos capturados, y el asistente solo lee: ' +
        delChat.join(' · ')
    );
  });

  test('ningún módulo del asistente alimenta una puerta con su propio lector de números', () => {
    const { alimentan } = censo();
    const culpables = alimentan
      .filter((f) => f.archivo.startsWith('chat-') && f.lectores.length)
      .map((f) => `${nombreLargo(f)} → ${f.lectores.join(', ')}`);
    assert.deepEqual(
      culpables,
      [],
      'estas funciones del asistente podrían poner un valor en una columna y lo leen a su manera: ' +
        culpables.join(' · ')
    );
  });

  test('el censo sí ve los módulos del asistente: si no, estas pruebas no medirían nada', () => {
    /**
     * La comprobación que hace honesta a la de arriba.
     *
     * «Ningún módulo del chat aparece entre las puertas» es verdad trivial si el
     * censo no lee esos archivos. Así que se exige que el censo haya troceado
     * funciones de cada uno de ellos.
     */
    assert.ok(DEL_CHAT.length >= 4, `se esperaban los cuatro módulos del asistente y hay ${DEL_CHAT.length}`);
    const { funciones } = censo();
    const vistos = new Set(funciones.filter((f) => f.archivo.startsWith('chat-')).map((f) => f.archivo));
    assert.deepEqual(
      [...vistos].sort(),
      DEL_CHAT,
      'el censo no está leyendo todos los módulos del asistente: ' +
        `ve ${[...vistos].sort().join(', ')} y en lib/ hay ${DEL_CHAT.join(', ')}`
    );
  });

  test('los módulos del asistente viven planos en lib/, no en una carpeta', () => {
    // No es cosmético: el censo no baja a subdirectorios.
    assert.ok(
      !fs.existsSync(new URL('chat/', LIB)),
      'hay una carpeta lib/chat/: lo que viva ahí queda fuera del censo de las puertas'
    );
    for (const archivo of DEL_CHAT) {
      assert.equal(path.extname(archivo), '.js', `${archivo} no es un .js y el censo solo lee .js`);
    }
  });
});

describe('solo lectura, leído del código del asistente', () => {
  test('ninguna escritura SQL en los módulos del asistente, salvo su propio contador', () => {
    const permitida = /chat_consumo/;
    const culpables = [];
    for (const archivo of DEL_CHAT) {
      const texto = fs.readFileSync(new URL(archivo, LIB), 'utf8');
      for (const linea of texto.split('\n')) {
        // Un comentario que EXPLICA la escritura del contador no es una
        // escritura. Se saltan, igual que hace el censo.
        if (/^\s*(\*|\/\/|\/\*)/.test(linea)) continue;
        if (!/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(linea)) continue;
        if (permitida.test(linea)) continue;
        // `ON CONFLICT … DO UPDATE SET` es parte del INSERT del contador.
        if (/DO UPDATE SET/i.test(linea)) continue;
        culpables.push(`${archivo}: ${linea.trim().slice(0, 90)}`);
      }
    }
    assert.deepEqual(culpables, [], `el asistente escribe donde no debe: ${culpables.join(' · ')}`);
  });

  test('el asistente no importa ninguna función que escriba', () => {
    /**
     * Las siete herramientas reusan las consultas que alimentan las pantallas, y
     * esos módulos traen también las funciones que escriben. Lo que se vigila es
     * que ninguna de ESAS entre por un `import`: una herramienta que escriba
     * sería un cambio del contrato del director, no un detalle.
     */
    const queEscriben = [
      'registrarApertura',
      'registrarCancelacion',
      'registrarCorreccion',
      'actualizarServicio',
      'completarAlta',
      'registrarFactura',
      'registrarPago',
      'corregirFactura',
      'cargarFacturas',
      'aplicarApertura',
      'corregirApertura',
      'descartarApertura',
      'suspenderServicio',
      'reactivarServicio',
      'adjuntarContrato',
      'aplicarCondiciones',
      'aplicarFactor',
    ];
    const culpables = [];
    for (const archivo of DEL_CHAT) {
      const texto = fs.readFileSync(new URL(archivo, LIB), 'utf8');
      // Solo los renglones de import: nombrarlas en un comentario —como hace esta
      // misma prueba— no es importarlas.
      const imports = texto.split('\n').filter((l) => /^\s*import\b/.test(l) || /^\s{2}[\w,\s]+$/.test(l));
      for (const nombre of queEscriben) {
        if (imports.some((l) => new RegExp(`\\b${nombre}\\b`).test(l))) culpables.push(`${archivo} → ${nombre}`);
      }
    }
    assert.deepEqual(culpables, [], `el asistente importa funciones que escriben: ${culpables.join(' · ')}`);
  });

  test('la tabla del consumo existe en el esquema y se crea si no está', () => {
    const esquema = fs.readFileSync(new URL('schema.sql', LIB), 'utf8');
    assert.match(esquema, /CREATE TABLE IF NOT EXISTS chat_consumo/);
    // Con `IF NOT EXISTS` no hace falta migración: getDb() corre el esquema en
    // cada arranque. Una base que ya vive se encuentra la tabla al reiniciar.
    assert.match(esquema, /UNIQUE \(usuario_id, dia\)/);
  });
});
