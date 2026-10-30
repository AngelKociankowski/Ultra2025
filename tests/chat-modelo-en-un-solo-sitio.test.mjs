/**
 * El identificador del modelo vive en UN solo archivo.
 *
 * Por qué es una prueba y no una convención: un identificador de modelo copiado
 * en un comentario, en una prueba o en un documento es la clase de dato que se
 * queda viejo sin que nada falle. El día que se cambie de modelo —que es una
 * decisión del director, no de un despliegue— habría que ir a buscarlo a seis
 * sitios, y el que se olvide va a seguir diciendo el anterior en la cara de
 * quien lea ese archivo.
 *
 * La prueba IMPORTA la constante y recorre el repositorio buscándola. No escribe
 * la cadena en ningún sitio: si la escribiera, sería ella misma el segundo sitio
 * y la afirmación se volvería falsa por existir.
 *
 * El recorrido y las exclusiones son los mismos de `rutas-de-la-maquina.test.mjs`,
 * a propósito: dos recorridos distintos sobre el mismo repositorio acaban
 * cubriendo cosas distintas, y el que cubra menos es el que da el falso verde.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MODELO,
  ESFUERZO,
  MAX_TOKENS,
  PENSAR,
  ESPERA_MS,
  REINTENTOS,
  MAX_VUELTAS,
  chatDisponible,
  cliente,
  SinLlave,
} from '../lib/chat-modelo.js';

const RAIZ = new URL('..', import.meta.url).pathname;

const FUERA = new Set(['node_modules', '.next', '.git', '.ciclo', 'data', 'out', 'coverage', 'docs']);
const REVISABLES = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.yml',
  '.yaml',
  '.sql',
  '.sh',
  '.md',
  '.html',
]);

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

test('el identificador del modelo aparece en exactamente un archivo', () => {
  assert.ok(MODELO.length > 3, 'la constante del modelo está vacía');

  const culpables = archivos(RAIZ).filter((a) => fs.readFileSync(a, 'utf8').includes(MODELO));
  const relativos = culpables.map((a) => path.relative(RAIZ, a)).sort();

  assert.deepEqual(
    relativos,
    ['lib/chat-modelo.js'],
    'el identificador del modelo tiene que estar en un solo sitio, y está en estos: ' + relativos.join(' · ')
  );
});

test('sin llave, el asistente se declara no disponible y el cliente se niega', () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(chatDisponible(), false);
    assert.throws(() => cliente(), SinLlave, 'sin llave, pedir el cliente tiene que fallar y no devolver nada');

    // Y una llave de puros espacios no es una llave: es un despiste de
    // configuración, y tratarla como válida acabaría en un 401 del servicio con
    // cara de falla nuestra.
    process.env.ANTHROPIC_API_KEY = '   ';
    assert.equal(chatDisponible(), false);
  } finally {
    if (antes === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = antes;
  }
});

test('las constantes que gobiernan el costo están puestas y son las acordadas', () => {
  // No se afirma un número de tokens concreto —eso se mide con tráfico real—
  // pero sí que exista un techo y que el esfuerzo arranque bajo, que es lo que
  // el plan deja escrito para poder subirlo midiendo y no por intuición.
  assert.equal(ESFUERZO, 'low');
  assert.ok(Number.isInteger(MAX_TOKENS) && MAX_TOKENS > 0, 'la respuesta tiene que tener techo');

  // Pensar NO se apaga: `{ type: 'disabled' }` devuelve 400 en el modelo
  // contratado. Si alguien lo «arregla», toda pregunta falla.
  assert.equal(PENSAR.type, 'adaptive');

  /**
   * Media espera, y UN reintento.
   *
   * Esto decía `assert.equal(ESPERA_MS, 60_000)` y clavaba el número. Lo que de
   * verdad vigilaba son dos cosas y las dos siguen aquí: que la espera esté en
   * MILISEGUNDOS —poner 60 ahí es una espera de sesenta milésimas, que falla
   * siempre y parece que el servicio está caído— y que el reintento sea uno,
   * porque un chat que reintenta tres veces no es tolerante: tarda tres minutos
   * en decir que no pudo, con la persona mirando la pantalla.
   *
   * El número exacto se bajó a 30 000 porque con 60 000 la espera total medida
   * eran 125 segundos y nadie espera dos minutos frente a una pantalla callada.
   * En vez de clavar el número nuevo se afirma el intervalo que lo hace
   * razonable: ni segundos disfrazados de milisegundos, ni más de medio minuto
   * por intento.
   */
  assert.ok(ESPERA_MS >= 5_000, `la espera son ${ESPERA_MS}: eso parecen segundos, y el paquete cuenta milisegundos`);
  assert.ok(ESPERA_MS <= 30_000, `la espera son ${ESPERA_MS} ms, y con el reintento eso es más de un minuto callado`);
  assert.equal(REINTENTOS, 1);

  // Y el techo de vueltas del ciclo, sin el que una pregunta mal entendida
  // encadena consultas hasta donde aguante.
  assert.equal(MAX_VUELTAS, 3);
});

test('el cliente se arma con esa espera y ese reintento, no con los del paquete', () => {
  const antes = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = 'llave-de-prueba';
    const api = cliente();
    assert.equal(api.timeout, ESPERA_MS, 'el cliente se quedó con la espera por omisión del paquete');
    assert.equal(api.maxRetries, REINTENTOS, 'el cliente reintenta más veces de las acordadas');
    // Y es siempre el mismo: rehacerlo en cada pregunta tira la reutilización
    // de conexiones.
    assert.equal(cliente(), api);
  } finally {
    if (antes === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = antes;
  }
});
