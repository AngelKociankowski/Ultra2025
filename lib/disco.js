/**
 * El disco: cuánto hay, cuánto queda, y cómo escribir en él sin dejar basura.
 *
 * Existe por un defecto que tardó semanas en verse. La base, los adjuntos y los
 * respaldos comparten un solo disco de un giga, y nada en la plataforma miraba
 * cuánto quedaba. Se llenó, y lo único que la plataforma supo decir —al pedir
 * un respaldo primero, al subir el PDF de un contrato diez días después— fue
 * «Error interno del servidor».
 *
 * Tres cosas viven aquí, y las tres son la misma idea —que el disco lleno deje
 * de ser una sorpresa—:
 *
 *   1. Medir (`espacio`, `ocupacion`): para enseñarlo y para decidir.
 *   2. Comprobar antes de escribir (`exigirEspacio`): negarse con un mensaje
 *      claro es mejor que empezar a escribir y fallar a la mitad.
 *   3. Escribir sin dejar medias tintas (`escribirEntero`): un archivo o queda
 *      completo o no queda.
 *
 * No importa nada de la base a propósito: lo usa `lib/archivos.js`, que tampoco
 * la toca, y así se puede probar suelto.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SinEspacioError } from './errores';
import { escribirTodo } from './zip';

// Se reexporta: quien escribe en el disco lo busca aquí, junto a lo demás. Está
// definida en `lib/zip.js` porque ese archivo no puede importar nada.
export { escribirTodo };

const MB = 1024 * 1024;

/** Para decirle un tamaño a una persona. */
export function enMB(bytes) {
  const mb = bytes / MB;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * La reserva: megabytes que ni una subida ni un respaldo pueden comerse.
 *
 * El disco no es solo de los archivos. La base crece con cada captura y, antes
 * de consolidar, escribe sus cambios en un diario aparte que puede pesar varios
 * megabytes. Si un PDF se lleva el último hueco, lo que deja de funcionar ya no
 * es subir PDF: es capturar una apertura, guardar un comentario o iniciar
 * sesión, porque todo eso escribe en la base. La reserva es el sitio que se le
 * guarda a la base para que un disco apretado no tumbe la operación entera.
 *
 * Se lee con el mismo criterio que los topes del asistente (`CHAT_TOPE_*`): un
 * valor que no se entiende cae en la omisión en vez de quedar en `NaN`, porque
 * una reserva `NaN` no reserva nada —toda comparación con ella es falsa—. Aquí
 * el cero sí vale: es «sin reserva», y quien lo ponga sabe lo que hace.
 */
function megasDeEntorno(crudo, omision) {
  // Vacía es «no la pusieron», no «cero»: `Number('')` da 0, y una variable
  // que alguien dejó en blanco en el panel del proveedor quitaría la reserva
  // sin que nadie lo hubiera decidido.
  if (crudo === undefined || String(crudo).trim() === '') return omision;
  const n = Number(crudo);
  return Number.isFinite(n) && n >= 0 ? n : omision;
}

export const RESERVA_BYTES = megasDeEntorno(process.env.DISCO_RESERVA_MB, 50) * MB;

/** La carpeta del disco persistente: donde está la base, y junto a ella todo lo demás. */
export function carpetaDatos() {
  const base = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');
  return path.dirname(base);
}

/**
 * Cuánto mide el disco y cuánto le queda, en bytes.
 *
 * `libre` es lo que puede usar el proceso (`bavail`), no lo que el sistema de
 * archivos tiene sin ocupar (`bfree`): la diferencia son los bloques que se
 * guardan para el superusuario, y contar con ellos sería prometer un espacio en
 * el que una escritura va a fallar.
 *
 * Devuelve `null` si el sistema no sabe contestar. No se inventa un número: sin
 * medida no se comprueba antes, y si de verdad no hay sitio la escritura falla
 * con `ENOSPC`, que también se traduce a un mensaje claro.
 */
export function espacio(dir = carpetaDatos()) {
  try {
    const s = fs.statfsSync(dir);
    return { total: s.blocks * s.bsize, libre: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/**
 * Se niega a seguir si escribir `bytes` dejaría el disco por debajo de la
 * reserva. `que` nombra lo que se quería guardar, para el mensaje.
 *
 * El mensaje dice las tres cosas que hacen falta —qué pasó, que no se guardó
 * nada y qué hacer— porque quien lo lee casi nunca es quien puede arreglarlo:
 * es jurídico subiendo un contrato, y lo que necesita es saber que no es su
 * archivo y a quién avisarle.
 */
export function exigirEspacio(bytes, que, { libre = espacio()?.libre } = {}) {
  if (libre === undefined || libre === null) return;
  if (libre - bytes >= RESERVA_BYTES) return;
  throw new SinEspacioError(
    `No hay espacio en el disco del servidor para guardar ${que}: pesa ${enMB(bytes)} y quedan ${enMB(libre)} libres` +
      (RESERVA_BYTES ? `, de los que ${enMB(RESERVA_BYTES)} se reservan para que la base pueda seguir guardando` : '') +
      '. No se guardó nada. No es un problema de tu archivo. Avísale al administrador: en la pantalla de ' +
      'Respaldos se ve qué está ocupando el disco y desde ahí se libera espacio. Después vuelve a intentarlo.'
  );
}

/** Con qué empieza (después del punto) un archivo que todavía no es de nadie. */
export const PREFIJO_PROVISIONAL = 'escribiendo-';

/**
 * Escribe un archivo de modo que solo exista si quedó completo.
 *
 * `fs.writeFileSync(destino)` crea el archivo con su nombre definitivo y luego
 * lo va llenando. Si la escritura se corta —el disco se llena, el proceso
 * muere— queda un archivo con nombre de bueno y contenido a medias: un PDF
 * truncado que la plataforma ofrece para descargar como si sirviera.
 *
 * Aquí se escribe con un nombre provisional en la MISMA carpeta y se renombra al
 * final. Renombrar dentro de un mismo sistema de archivos es atómico: o el
 * destino tiene el archivo entero, o no existe. Antes de renombrar se fuerza a
 * que los datos lleguen al disco (`fsync`), porque un renombrado que sobrevive a
 * un corte de luz apuntando a datos que no llegaron a escribirse es otra forma
 * de archivo a medias.
 *
 * El provisional empieza con punto: ni la lista de respaldos ni el respaldo de
 * los adjuntos se llevan archivos ocultos, así que uno que quedara huérfano de
 * un proceso que murió no pasa por adjunto de nadie.
 */
export function escribirEntero(destino, datos) {
  const provisional = path.join(
    path.dirname(destino),
    `.${PREFIJO_PROVISIONAL}${process.pid}-${Date.now()}-${path.basename(destino)}`
  );
  let fd = null;
  try {
    fd = fs.openSync(provisional, 'wx');
    escribirTodo(fd, datos);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(provisional, destino);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ya da igual: lo que importa es el error original */
      }
    }
    fs.rmSync(provisional, { force: true });
    throw err;
  }
}

/** Cuánto pesan, sumados, los archivos de una carpeta (sin bajar a subcarpetas). */
function pesoDe(dir, filtro = () => true) {
  let bytes = 0;
  let cuantos = 0;
  let nombres;
  try {
    nombres = fs.readdirSync(dir);
  } catch {
    return { bytes, cuantos };
  }
  for (const nombre of nombres) {
    if (!filtro(nombre)) continue;
    try {
      const st = fs.statSync(path.join(dir, nombre));
      if (!st.isFile()) continue;
      bytes += st.size;
      cuantos += 1;
    } catch {
      /* se borró entre listar y medir: no cuenta */
    }
  }
  return { bytes, cuantos };
}

/**
 * Qué ocupa el disco, para enseñarlo.
 *
 * Las tres cosas que la plataforma pone ahí —la base, los adjuntos y los
 * respaldos— y un cuarto renglón, «lo demás», que es lo que el disco tiene
 * ocupado y no es ninguna de las tres: lo que el sistema de archivos se guarda
 * para sí y, si los hubiera, restos de escrituras que no terminaron. Va aparte
 * para que los cuatro renglones sumen lo ocupado; si se escondiera, la cuenta no
 * cuadraría y nadie sabría contra qué número creerle a la pantalla.
 *
 * `null` si el disco no se puede medir: la pantalla lo dice en vez de pintar
 * ceros que parecerían un disco vacío.
 */
export function ocupacion() {
  const dir = carpetaDatos();
  const medida = espacio(dir);
  if (!medida) return null;

  const nombreBase = path.basename(process.env.DATABASE_PATH || 'ultra.db');
  const base = pesoDe(dir, (n) => n === nombreBase || n === `${nombreBase}-wal` || n === `${nombreBase}-shm`);
  const adjuntos = pesoDe(path.join(dir, 'archivos'), (n) => !n.startsWith('.'));
  const respaldos = pesoDe(path.join(dir, 'respaldos'));
  const ocupado = medida.total - medida.libre;

  return {
    total: medida.total,
    libre: medida.libre,
    ocupado,
    base: base.bytes,
    adjuntos: adjuntos.bytes,
    cuantosAdjuntos: adjuntos.cuantos,
    respaldos: respaldos.bytes,
    otros: Math.max(0, ocupado - base.bytes - adjuntos.bytes - respaldos.bytes),
    reserva: RESERVA_BYTES,
  };
}
