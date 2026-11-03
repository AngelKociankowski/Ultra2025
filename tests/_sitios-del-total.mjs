/**
 * El censo de los sitios que escriben `servicios.total_guardias`, leído del
 * código.
 *
 * Existe por la razón que trajo el encargo del cuadre: el estado de fuerza puede
 * cambiar sin que ninguna pantalla lo explique, y eso solo se puede cerrar si se
 * sabe CUÁNTOS sitios mueven ese número. Una lista escrita a mano se queda corta
 * el día que alguien abra el siguiente, y entonces el cuadre dejaría de cerrar
 * sin que nadie supiera por qué —o peor, alguien lo haría cerrar sumándole el
 * residuo a un término—.
 *
 * Así que el censo se deriva del código y se compara contra lo que declara
 * `SITIOS_QUE_MUEVEN_EL_TOTAL` de `lib/cuadre.js`, que es donde está escrito a
 * qué término del cuadre alimenta cada sitio. Una sentencia nueva sin declarar
 * rompe la suite.
 *
 * Va suelto, y no dentro de la prueba, para que el guardián se pueda probar a sí
 * mismo: se le pasan por delante las tres formas de escribir esa columna y se
 * exige que las cace, sin tocar `lib/`. Un guardián que nunca se ha visto fallar
 * no se sabe si vigila.
 *
 * Lo que este censo NO puede ver, dicho para que no se confíe de más: lee texto y
 * no ejecuta nada. Una escritura armada con el nombre de la columna en una
 * variable —`SET ${columna} = ?`— se le escapa, igual que se le escapa un
 * `DELETE FROM servicios`, que saca guardias del total sin escribir la columna.
 * Lo segundo está cubierto por el otro lado: el único `DELETE FROM servicios` del
 * código vive en `deshacerApertura()`, que ya está declarado, y la invariante de
 * la casa —ningún rol tiene permiso de borrar un servicio— lo cierra por arriba.
 */

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = new URL('../', import.meta.url);

/**
 * El código con los comentarios quitados, y la posición de cada trozo de texto
 * entre comillas.
 *
 * Hace falta trocear por cadenas y no buscar sobre el archivo entero porque las
 * sentencias viven dentro de literales y el patrón tiene que poder decir «este
 * UPDATE y este total_guardias están en la MISMA sentencia». Buscando sobre todo
 * el archivo, un UPDATE de una sentencia casaría con la columna de otra.
 *
 * Los comentarios se quitan antes porque en este proyecto están llenos de SQL
 * citado: la cabecera de `normalizarTurnos()` nombra `servicios.total_guardias`
 * en prosa, y contarla sería contar una explicación como si fuera una escritura.
 */
function cadenasDelCodigo(texto) {
  const cadenas = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === '/' && d === '/') {
      while (i < texto.length && texto[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      const arranca = i;
      let dentro = '';
      i += 1;
      while (i < texto.length) {
        if (texto[i] === '\\') {
          dentro += texto.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (texto[i] === cierre) {
          i += 1;
          break;
        }
        dentro += texto[i];
        i += 1;
      }
      cadenas.push({ desde: arranca, texto: dentro });
      continue;
    }
    i += 1;
  }
  return cadenas;
}

/** El código con los comentarios quitados y las cadenas en blanco. */
function soloCodigoSinCadenas(texto) {
  let out = '';
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === '/' && d === '/') {
      while (i < texto.length && texto[i] !== '\n') {
        out += texto[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      out += '  ';
      while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) {
        out += texto[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      out += ' ';
      i += 1;
      while (i < texto.length) {
        if (texto[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        const esElCierre = texto[i] === cierre;
        out += texto[i] === '\n' ? '\n' : ' ';
        i += 1;
        if (esElCierre) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** La función que encierra esa posición: la última declarada antes de ella. */
function funcionQueEncierra(codigo, posicion) {
  const antes = codigo.slice(0, posicion);
  const declaraciones = [...antes.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)];
  return declaraciones.length ? declaraciones[declaraciones.length - 1][1] : '(fuera de toda función)';
}

/**
 * Las tres formas de escribir `servicios.total_guardias`, con el nombre con el
 * que se reporta cada una.
 *
 * Las dos primeras se leen DENTRO de una sentencia SQL; la tercera es la
 * escritura que se arma con las columnas que cambiaron, donde el nombre de la
 * columna no está en el SQL sino en el objeto que lo decide.
 */
const FORMAS = [
  ['un UPDATE de servicios que pone la columna', (sql) => /\bUPDATE\s+servicios\b/i.test(sql) && /\btotal_guardias\s*=/i.test(sql)],
  ['un INSERT de servicios que la trae entre sus columnas', (sql) => /\bINSERT\s+INTO\s+servicios\b/i.test(sql) && /\btotal_guardias\b/i.test(sql)],
];

/** Dónde escribe esa columna un texto de código, como si fuera ese archivo. */
export function escriturasEnTexto(archivo, texto) {
  const out = [];
  const codigo = soloCodigoSinCadenas(texto);
  const linea = (pos) => codigo.slice(0, pos).split('\n').length;

  for (const { desde, texto: sql } of cadenasDelCodigo(texto)) {
    for (const [que, casa] of FORMAS) {
      if (casa(sql)) {
        out.push({ archivo, linea: linea(desde), forma: que, funcion: funcionQueEncierra(codigo, desde) });
        break;
      }
    }
  }
  // La escritura dinámica: `UPDATE servicios SET ${columnas…}` no nombra la
  // columna, así que se persigue el objeto que decide qué columnas se escriben.
  for (const m of codigo.matchAll(/\bsets\.total_guardias\s*=/g)) {
    out.push({
      archivo,
      linea: linea(m.index),
      forma: 'la escritura armada con las columnas que cambiaron',
      funcion: funcionQueEncierra(codigo, m.index),
    });
  }
  return out;
}

/** Todos los archivos de código de la aplicación, sin las pruebas ni los scripts. */
function archivosDeLaAplicacion() {
  const salida = [];
  const recorrer = (dir) => {
    for (const entrada of fs.readdirSync(new URL(dir, RAIZ), { withFileTypes: true })) {
      const relativo = path.posix.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === 'node_modules' || entrada.name === '.next') continue;
        recorrer(`${relativo}/`);
        continue;
      }
      if (/\.(js|mjs)$/.test(entrada.name)) salida.push(relativo);
    }
  };
  recorrer('lib/');
  recorrer('app/');
  recorrer('components/');
  return salida;
}

/**
 * Dónde escribe la aplicación `servicios.total_guardias`, de verdad.
 *
 * Se barre `lib/`, `app/` y `components/` y no solo `lib/servicios.js`: lo que
 * hay que cazar es la escritura que aparezca donde nadie la espera, y buscarla
 * solo donde ya sabemos que está sería un censo que confirma lo que ya se sabe.
 */
export function escriturasDelTotal() {
  return archivosDeLaAplicacion().flatMap((archivo) =>
    escriturasEnTexto(archivo, fs.readFileSync(new URL(archivo, RAIZ), 'utf8'))
  );
}
