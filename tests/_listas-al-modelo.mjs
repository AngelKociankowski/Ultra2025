/**
 * El censo de lo que sale hacia el modelo, leído del código.
 *
 * Existe por la misma razón que `_puertas-de-escritura.mjs`: una lista escrita a
 * mano se queda corta el día que alguien abre un sitio más, y nadie se entera
 * hasta que un tester lo mide. Van cuatro vueltas de este ciclo cerrando
 * hallazgos de la misma familia —una consulta recorta su lista y el total de
 * verdad no viaja al lado, así que el modelo describe veinticinco renglones como
 * si fueran todo— y en la última quedaban tres sitios abiertos de doce. Tapar los
 * doce no cierra nada: el que importa es el trece.
 *
 * Así que lo que se vigila no son los sitios, es la posibilidad:
 *
 *   1. Que NADIE recorte a mano. El único que recorta es `lib/chat-salida.js`, y
 *      lo que sale de ahí lleva su total pegado. Un `.slice(0, 5)` nuevo en
 *      cualquier módulo del asistente rompe la suite, aunque esté bien escrito y
 *      aunque la lista sea corta hoy.
 *   2. Que el recuadro «De dónde salió esto» lo escriba el servidor. La etiqueta
 *      de una ficha no se compone con texto libre: ni el que elige el servicio
 *      externo en los argumentos de una consulta, ni el que teclea el equipo en un
 *      campo de la base. Dentro del recuadro, un valor real y una etiqueta escrita
 *      por otro se leen igual.
 *
 * Y lo que este censo NO puede ver, dicho para que no se confíe de más: lee texto
 * y no ejecuta nada, así que no sabe si un total es el total correcto. Eso lo mide
 * la otra mitad del guardián, que corre las siete consultas de verdad y recorre
 * el resultado (`chat-listas-con-total.test.mjs`).
 */

import fs from 'node:fs';
import { soloCodigo } from './_puertas-de-escritura.mjs';

const LIB = new URL('../lib/', import.meta.url);

/** El sitio único que sí recorta. Lo demás pasa por él. */
export const SITIO_UNICO = 'chat-salida.js';

/** Los módulos del asistente, planos en `lib/` y con extensión `.js`. */
export function modulosDelAsistente() {
  return fs
    .readdirSync(LIB)
    .filter((f) => f.startsWith('chat-') && f.endsWith('.js'))
    .sort();
}

/**
 * Las formas de recortar una lista a mano, con el nombre con el que se reporta y
 * con qué ojos hay que leer el código para verla.
 *
 * `slice` es la que se usó doce veces; un `LIMIT` escrito en el módulo y el tope
 * suelto son las otras dos por las que volvería a entrar si solo se persiguiera
 * la primera.
 *
 * Los ojos importan y no es un detalle: `soloCodigo` blanquea el contenido de las
 * cadenas —así un `.slice(` nombrado dentro de un texto no cuenta— pero un `LIMIT`
 * vive justamente dentro de una cadena, la del SQL, así que esa se lee con los
 * comentarios quitados y las cadenas puestas. Perseguir las tres con los mismos
 * ojos dejaba una sin vigilar, y se vio al probar el guardián contra sí mismo.
 *
 * Y un aviso para quien se lo encuentre en rojo sin haber tocado ninguna lista:
 * esto también se queja de un `.slice(` que recorta un TEXTO y no una lista. Es a
 * propósito y es el lado seguro: el guardián no puede saber qué hay dentro de una
 * variable, y preferir el falso positivo es lo que evita la lista que se escapa.
 * La salida no es debilitar la regla —es el camino por el que esto volvería— sino
 * recortar también ese texto en el sitio único, o dejar dicho ahí mismo por qué no.
 */
const RECORTES_A_MANO = [
  ['un slice a mano', /\.slice\s*\(/, 'codigo'],
  ['un LIMIT escrito en el módulo', /\bLIMIT\b/, 'cadenas'],
  ['el tope de renglones usado fuera del sitio único', /\bTOPE_RENGLONES\b/, 'codigo'],
];

/**
 * Qué módulos tienen que pasar por el sitio único, derivado del código.
 *
 * Son los que arman lo que sale hacia el modelo: el que declara las herramientas
 * y cualquiera que importe el sitio único. Los otros dos módulos del asistente
 * —el contador del tope y el cliente del servicio— no arman ninguna lista para el
 * modelo, y perseguirlos obligaba a nombrar excepciones: el contador recorta una
 * FECHA con `hoy().slice(0, 7)`, que no tiene nada que ver con esto, y una lista
 * de excepciones es donde se esconde la que sí importaba.
 *
 * Si mañana alguien arma herramientas en un módulo nuevo que no importe el sitio
 * único, este censo no lo ve — y lo caza el otro camino del guardián, el que
 * corre las consultas y mira si cada lista que sale lleva su total. Por eso son
 * dos y no uno.
 */
export function modulosQueMandanDatos() {
  return modulosDelAsistente().filter((archivo) => {
    if (archivo === SITIO_UNICO) return false;
    const fuente = fs.readFileSync(new URL(archivo, LIB), 'utf8');
    return /export const HERRAMIENTAS/.test(fuente) || /from '\.\/chat-salida'/.test(fuente);
  });
}

/**
 * Dónde recorta a mano un texto de código, como si fuera ese archivo.
 *
 * Va suelto para que el guardián se pueda probar a sí mismo: se le pasan por
 * delante las formas de recortar a mano y se exige que las cace, sin tocar
 * `lib/`. Un guardián que nunca se ha visto fallar no se sabe si vigila.
 */
export function recortesEnTexto(archivo, texto) {
  if (archivo === SITIO_UNICO) return [];
  const vistas = { codigo: soloCodigo(texto).split('\n'), cadenas: sinComentarios(texto).split('\n') };
  const out = [];
  for (const [que, patron, vista] of RECORTES_A_MANO) {
    vistas[vista].forEach((linea, i) => {
      if (patron.test(linea)) out.push(`${archivo}:${i + 1} → ${que}`);
    });
  }
  return out;
}

/**
 * Dónde se recorta una lista a mano, fuera del sitio único.
 *
 * Devuelve `archivo:línea → qué forma`, que es lo que hace falta para arreglarlo
 * sin buscarlo.
 */
export function recortesAMano() {
  return modulosQueMandanDatos().flatMap((archivo) =>
    recortesEnTexto(archivo, fs.readFileSync(new URL(archivo, LIB), 'utf8'))
  );
}

/**
 * El código sin comentarios, pero CON el contenido de las cadenas.
 *
 * Para los recortes a mano sirve `soloCodigo`, que blanquea también las cadenas.
 * Para la etiqueta de una ficha no sirve: lo que hay que leer es justo lo que va
 * dentro del texto —`${saneado(texto)}`—, y blanqueado no se ve. Así que aquí se
 * quitan los comentarios y nada más, con cuidado de no confundir un `//` que vive
 * dentro de una cadena con el principio de un comentario.
 */
function sinComentarios(texto) {
  let out = '';
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
      while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) {
        if (texto[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      out += c;
      i += 1;
      while (i < texto.length) {
        if (texto[i] === '\\') {
          out += texto.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += texto[i];
        if (texto[i] === cierre) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Los argumentos de cada llamada a `ficha(...)` del código del asistente.
 *
 * Se trocea contando paréntesis y comas de primer nivel, saltándose las cadenas
 * enteras: así una coma dentro de un texto no parte un argumento. Los comentarios
 * ya no están, así que un `ficha(` nombrado en uno de ellos —y los hay— no cuenta.
 */
export function llamadasAFicha(entradas) {
  const out = [];
  for (const [archivo, fuente] of entradas) {
    const codigo = sinComentarios(fuente);
    const marca = /(?<![\w$.])ficha\s*\(/g;
    let m;
    while ((m = marca.exec(codigo))) {
      let i = m.index + m[0].length;
      let profundidad = 1;
      let actual = '';
      const partes = [];
      while (i < codigo.length && profundidad > 0) {
        const c = codigo[i];
        if (c === '"' || c === "'" || c === '`') {
          // La cadena entera se copia tal cual: lo que importa de ella es su
          // contenido, y ninguna coma de dentro parte un argumento.
          const cierre = c;
          actual += c;
          i += 1;
          while (i < codigo.length) {
            if (codigo[i] === '\\') {
              actual += codigo.slice(i, i + 2);
              i += 2;
              continue;
            }
            actual += codigo[i];
            if (codigo[i] === cierre) {
              i += 1;
              break;
            }
            i += 1;
          }
          continue;
        }
        if (c === '(' || c === '[' || c === '{') profundidad += 1;
        if (c === ')' || c === ']' || c === '}') profundidad -= 1;
        if (profundidad === 0) break;
        if (c === ',' && profundidad === 1) {
          partes.push(actual.trim());
          actual = '';
        } else {
          actual += c;
        }
        i += 1;
      }
      partes.push(actual.trim());
      const linea = codigo.slice(0, m.index).split('\n').length;
      out.push({ archivo, linea, argumentos: partes });
    }
  }
  return out;
}

/**
 * Las fichas cuya etiqueta se compone con texto libre de alguien que no es el
 * servidor.
 *
 * El `dato` es el tercer argumento. Se persiguen dos cosas: que pase por
 * `saneado(...)` —que es la firma de «esto lo escribió una persona o el servicio
 * externo»— y que interpole algo que no sea un identificador simple. Un
 * `${s.id}` o un `${fecha}` son valores que el servidor ya validó; un
 * `${saneado(texto)}` es el texto de búsqueda que eligió el modelo.
 */
export function fichasEnTexto(archivo, texto) {
  const out = [];
  for (const { linea, argumentos } of llamadasAFicha([[archivo, texto]])) {
    // pantalla, enlace, dato, valor: si no vienen los cuatro, es otra cosa.
    if (argumentos.length < 4) continue;
    const dato = argumentos[2];
    if (/\bsaneado\s*\(/.test(dato)) {
      out.push(`${archivo}:${linea} → la etiqueta de la ficha pasa por saneado(): es texto de fuera`);
      continue;
    }
    for (const trozo of dato.matchAll(/\$\{([^}]*)\}/g)) {
      const expresion = trozo[1].trim();
      if (!/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(expresion)) {
        out.push(`${archivo}:${linea} → la etiqueta de la ficha compone «${expresion}»`);
      }
    }
  }
  return out;
}

/** Las fichas de los módulos del asistente que no escribe el servidor. */
export function fichasConTextoDeFuera() {
  return modulosDelAsistente().flatMap((archivo) =>
    fichasEnTexto(archivo, fs.readFileSync(new URL(archivo, LIB), 'utf8'))
  );
}
