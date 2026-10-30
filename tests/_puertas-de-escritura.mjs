/**
 * El censo de los caminos de escritura, leído del código.
 *
 * Esto existe porque la prueba que vigilaba «las 52 puertas» derivaba bien las
 * que medía y aun así se le escaparon las dos que importaban: cubría tres de los
 * siete caminos de escritura —editar, completar y corregir—, y por los otros
 * cuatro entraron los dos bloqueantes de la vuelta pasada. Una lista de puertas
 * escrita a mano se queda corta el día que alguien abre una más, y nadie se
 * entera hasta que un tester lo mide. Así que las puertas no se escriben: se
 * derivan de lo único que no se puede falsear, que es el código que escribe en
 * las columnas.
 *
 * Qué cuenta como puerta
 * ----------------------
 * Una función de `lib/` que escribe en una de las tablas de datos
 * (`INSERT INTO` o `UPDATE` sobre `servicios`, `aperturas`, `cancelaciones`,
 * `facturas`, `partidas_precio`). Nada más: no hace falta saber qué pantalla la
 * llama ni por qué ruta HTTP entra.
 *
 * Y qué cuenta como que alimenta una puerta: cualquier función de `lib/` a la que
 * una puerta llegue por llamadas. Ese segundo censo es el que faltaba. El hueco
 * de la vuelta pasada no estaba en una puerta —`registrarApertura()` sí llamaba a
 * `exigirDato()`— sino en un ayudante suyo: `normalizarTurnos()` no escribe
 * ninguna tabla, así que no era una puerta, pero su `Number(v) || 0` acababa en
 * `servicios.total_guardias`. Igual `limpiarNumero()` de `lib/partidas.js`. Quien
 * mira solo las puertas no ve ninguno de los dos.
 *
 * Cómo se lee el código
 * ---------------------
 * A mano y por texto, sin un analizador de verdad, y conviene saber qué eso
 * implica: el troceo en funciones cuenta llaves saltándose comentarios y cadenas,
 * y el grafo de llamadas es por nombre, así que dos funciones con el mismo nombre
 * en dos archivos se confunden. Un analizador de verdad sería mejor y sería otra
 * dependencia. La elección es consciente y el error que puede cometer es del lado
 * seguro para lo que aquí importa: confundir nombres hace el grafo MÁS grande, o
 * sea más funciones vigiladas, no menos.
 */

import fs from 'node:fs';
import path from 'node:path';

const LIB = new URL('../lib/', import.meta.url);

/** Las tablas donde vive el dato capturado. Si aparece una más, va aquí. */
export const TABLAS_DE_DATOS = ['servicios', 'aperturas', 'cancelaciones', 'facturas', 'partidas_precio'];

const ESCRITURA = new RegExp(`(INSERT\\s+INTO|UPDATE)\\s+(${TABLAS_DE_DATOS.join('|')})\\b`, 'i');

/** Quien pregunta por el sitio único, lo hace por uno de estos dos nombres. */
const SITIO_UNICO = /\bexigirDato(?:Corregido)?\s*\(/;

/**
 * Los lectores de números hechos a mano, en las dos formas con las que la basura
 * volvió a entrar las cuatro vueltas.
 *
 * Y lo que NO se persigue, porque importa igual: un `Number(f.importe) || 0` que
 * lee una columna para sumarla o pintarla es correcto y está por todas partes.
 * Perseguirlo obligaría a nombrar quince excepciones, y una lista de quince
 * excepciones es donde se esconde la decimosexta. Lo que se persigue es convertir
 * lo que viene de fuera, y eso tiene dos formas reconocibles:
 *
 *   1. `Number(String(x)…)` y los `replace` de `$`, comas o espacios antes de
 *      convertir: la firma exacta de `numOrNull()` y de `limpiarNumero()`, que es
 *      por donde el desglose por puesto escribía dinero con su propio lector.
 *   2. `parseInt` / `parseFloat`.
 *
 * La tercera forma —un `Number(v) || 0` sobre un valor sacado de una estructura
 * capturada, que es lo que hacía `normalizarTurnos()`— no se reconoce por su
 * texto sino por de dónde sale ese `v`: la contesta `valoresCapturados()`.
 */
const LECTORES_A_MANO = [
  ['Number(String(…))', /Number\(\s*String\(/],
  ['replace de $ , o espacios antes de convertir', /replace\(\s*\/\[[^\]]*[$,][^\]]*\]/],
  ['parseInt / parseFloat', /\bparse(Int|Float)\s*\(/],
];

/**
 * Los valores que salen de desarmar una estructura que llegó de fuera, y que se
 * convierten a número sin preguntar.
 *
 * Esta es la pregunta que faltaba, y es la que habría cazado el segundo
 * bloqueante. `normalizarTurnos()` no escribía ninguna tabla —no era una
 * puerta—, pero recorría `Object.entries(turnos)` de su propio parámetro y hacía
 * `Number(v) || 0` con cada valor, y de ahí salían `servicios.total_guardias` y
 * `aperturas.guardias`. Lo mismo el desglose por turno, el equipo y las
 * autorizaciones: las cuatro estructuras tenían la misma forma y el mismo lector.
 *
 * Qué se considera «de fuera»: los parámetros de la función, y lo que se saca de
 * ellos recorriéndolos —si `detalle` llegó de fuera, el `reparto` de
 * `Object.entries(detalle)` también, y el valor de `Object.entries(reparto)`
 * también—. Se va propagando hasta que no haya más.
 */
function valoresCapturados(cuerpoCodigo) {
  const firma = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/.exec(cuerpoCodigo);
  const parametros = (firma?.[1] || '')
    .split(',')
    .map((p) => /([A-Za-z_$][\w$]*)/.exec(p.trim())?.[1])
    .filter(Boolean);
  const sucios = new Set(parametros);

  // `for (const [a, b] of Object.entries(X))` — y también `Object.values(X)`.
  const recorridos = [...cuerpoCodigo.matchAll(/\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*of\s*Object\.entries\(\s*([\w$]+)/g)];
  let creció = true;
  while (creció) {
    creció = false;
    for (const [, llave, valor, fuente] of recorridos) {
      if (!sucios.has(fuente)) continue;
      for (const nuevo of [llave, valor]) {
        if (!sucios.has(nuevo)) { sucios.add(nuevo); creció = true; }
      }
    }
  }

  /**
   * Y cuáles de ellos se convierten a número a mano. El parámetro en sí no
   * cuenta: `Number(id)` para buscar una fila es correcto y está en media
   * plataforma, y lo que aquí se persigue es el valor de DENTRO de la estructura
   * —el que acaba en una columna—, que es lo que `normalizarTurnos()` convertía.
   */
  for (const p of parametros) sucios.delete(p);
  return [...sucios].filter((nombre) =>
    new RegExp(`(?:Number|parseInt|parseFloat)\\(\\s*${nombre}\\b`).test(cuerpoCodigo)
  );
}

/**
 * El código sin comentarios ni contenido de cadenas, para contar llaves.
 *
 * Se exporta porque el guardián de las listas que salen hacia el modelo
 * (`_listas-al-modelo.mjs`) necesita leer el código con los mismos ojos: un
 * recorte a mano nombrado dentro de un comentario que lo explica no es un recorte
 * a mano, y una lista de dos lectores distintos del mismo código es donde se
 * esconde la diferencia que nadie miró.
 */
export function soloCodigo(texto) {
  let out = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && texto[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      // Los saltos de línea se conservan: el troceo cuenta líneas y un
      // comentario de bloque de veinte renglones las correría todas.
      while (i < n && !(texto[i] === '*' && texto[i + 1] === '/')) {
        if (texto[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      out += ' ';
      i += 1;
      while (i < n) {
        if (texto[i] === '\\') { i += 2; continue; }
        if (texto[i] === cierre) { i += 1; break; }
        // Las llaves de `${…}` dentro de una plantilla cuentan como código, pero
        // para la profundidad se compensan solas: se blanquean las dos.
        out += texto[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Trocea un archivo en sus funciones de primer nivel. */
function funcionesDe(archivo, texto) {
  const codigo = soloCodigo(texto);
  const lineas = texto.split('\n');
  const lineasCodigo = codigo.split('\n');
  const out = [];

  for (let i = 0; i < lineas.length; i += 1) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(lineasCodigo[i]);
    if (!m) continue;
    let profundidad = 0;
    let abrio = false;
    let j = i;
    for (; j < lineas.length; j += 1) {
      for (const ch of lineasCodigo[j]) {
        if (ch === '{') { profundidad += 1; abrio = true; } else if (ch === '}') profundidad -= 1;
      }
      if (abrio && profundidad <= 0) break;
    }
    out.push({
      nombre: m[1],
      archivo,
      linea: i + 1,
      cuerpo: lineas.slice(i, j + 1).join('\n'),
      cuerpoCodigo: lineasCodigo.slice(i, j + 1).join('\n'),
    });
  }
  return out;
}

/** Todas las funciones de primer nivel de `lib/`, con su cuerpo. */
export function funcionesDeLib() {
  const archivos = fs.readdirSync(LIB).filter((f) => f.endsWith('.js')).sort();
  return archivos.flatMap((f) => funcionesDe(f, fs.readFileSync(new URL(f, LIB), 'utf8')));
}

/**
 * El censo: qué escribe cada tabla, qué pregunta por el sitio único y a quién
 * llega una puerta por llamadas.
 */
export function censo() {
  const funciones = funcionesDeLib();
  const porNombre = new Map();
  for (const f of funciones) {
    // Con un nombre repetido en dos archivos se guardan los dos: el grafo queda
    // más grande, que es el lado seguro.
    if (!porNombre.has(f.nombre)) porNombre.set(f.nombre, []);
    porNombre.get(f.nombre).push(f);
  }

  const llamadasDe = (f) => {
    const salida = new Set();
    for (const nombre of porNombre.keys()) {
      if (nombre === f.nombre) continue;
      if (new RegExp(`\\b${nombre}\\s*\\(`).test(f.cuerpoCodigo)) salida.add(nombre);
    }
    return salida;
  };
  const llamadas = new Map(funciones.map((f) => [f, llamadasDe(f)]));

  const puertas = funciones.filter((f) => ESCRITURA.test(f.cuerpo));

  /** Lo que una puerta alcanza por llamadas: donde puede nacer lo que escribe. */
  const alcanzadas = new Set();
  const bajar = (f) => {
    for (const nombre of llamadas.get(f) || []) {
      for (const g of porNombre.get(nombre) || []) {
        if (alcanzadas.has(g)) continue;
        alcanzadas.add(g);
        bajar(g);
      }
    }
  };
  for (const p of puertas) { alcanzadas.add(p); bajar(p); }

  /** ¿Esta función pregunta por el sitio único, ella o algo a lo que llame? */
  const preguntaPorElSitio = (f, vistos = new Set()) => {
    if (SITIO_UNICO.test(f.cuerpo)) return true;
    vistos.add(f);
    for (const nombre of llamadas.get(f) || []) {
      for (const g of porNombre.get(nombre) || []) {
        if (!vistos.has(g) && preguntaPorElSitio(g, vistos)) return true;
      }
    }
    return false;
  };

  const lectoresAMano = (f) => [
    ...LECTORES_A_MANO.filter(([, patron]) => patron.test(f.cuerpoCodigo)).map(([que]) => que),
    ...valoresCapturados(f.cuerpoCodigo).map((v) => `convierte «${v}», que sale de una estructura capturada`),
  ];

  return {
    funciones,
    puertas: puertas.map((p) => ({ ...p, pasaPorElSitio: preguntaPorElSitio(p) })),
    // Las que pueden poner un valor en una columna: las puertas y todo lo que
    // alcanzan.
    alimentan: [...alcanzadas].map((f) => ({ ...f, lectores: lectoresAMano(f) })),
  };
}

/** `archivo:función` — como se nombra una puerta en los mensajes. */
export const nombreLargo = (f) => `${path.basename(f.archivo)}:${f.nombre}`;
