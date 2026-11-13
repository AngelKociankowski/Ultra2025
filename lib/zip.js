/**
 * Un ZIP escrito y leído a mano, sin instalar nada.
 *
 * El respaldo tiene que ser UN archivo que el administrador pueda bajar a su
 * computadora, guardar en un USB y abrir con doble clic en Windows sin ninguna
 * herramienta especial. Eso es un ZIP, y el formato —cabecera por archivo,
 * directorio al final— cabe en este archivo.
 *
 * Se hace así a propósito, en lugar de agregar una librería: el respaldo es lo
 * último que uno quiere que deje de funcionar porque una dependencia cambió de
 * versión o desapareció. Aquí no hay nada que se pueda romper solo.
 *
 * Sin ZIP64: un respaldo de esta plataforma pesa megabytes, no gigabytes, y si
 * algún día se acercara al límite es mejor que avise que producir un archivo
 * que ningún programa pueda abrir.
 */

import zlib from 'node:zlib';
import fs from 'node:fs';

const LIMITE = 3 * 1024 * 1024 * 1024; // el formato sin ZIP64 aguanta 4 GB

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** La fecha en el formato de MS-DOS que el ZIP lleva arrastrando desde 1989. */
function fechaDos(d) {
  const hora = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const dia = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { hora, dia };
}

/**
 * @param {{nombre: string, datos: Buffer, fecha?: Date}[]} entradas
 * @returns {Buffer} el .zip completo
 */
export function escribirZip(entradas, fechaPorOmision = new Date()) {
  const locales = [];
  const central = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(String(e.nombre).replace(/\\/g, '/'), 'utf8');
    const datos = Buffer.isBuffer(e.datos) ? e.datos : Buffer.from(e.datos);
    const suma = crc32(datos);

    // Se comprime, salvo que comprimir salga peor: un PDF ya viene comprimido y
    // volver a pasarlo por deflate solo lo engorda.
    const apretado = zlib.deflateRawSync(datos, { level: 6 });
    const comprime = apretado.length < datos.length;
    const cuerpo = comprime ? apretado : datos;
    const metodo = comprime ? 8 : 0;

    const { hora, dia } = fechaDos(e.fecha || fechaPorOmision);

    const local = Buffer.alloc(30 + nombre.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0, 6); // banderas
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28); // extra
    nombre.copy(local, 30);

    const dir = Buffer.alloc(46 + nombre.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // versión de quien lo escribió
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(metodo, 10);
    dir.writeUInt16LE(hora, 12);
    dir.writeUInt16LE(dia, 14);
    dir.writeUInt32LE(suma, 16);
    dir.writeUInt32LE(cuerpo.length, 20);
    dir.writeUInt32LE(datos.length, 24);
    dir.writeUInt16LE(nombre.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comentario
    dir.writeUInt16LE(0, 34); // disco
    dir.writeUInt16LE(0, 36); // atributos internos
    dir.writeUInt32LE(0, 38); // atributos externos
    dir.writeUInt32LE(offset, 42);
    nombre.copy(dir, 46);

    locales.push(local, cuerpo);
    central.push(dir);
    offset += local.length + cuerpo.length;
    if (offset > LIMITE) throw new Error('El respaldo pasa de 3 GB y este formato no lo soporta.');
  }

  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(offset, 16);
  fin.writeUInt16LE(0, 20);

  return Buffer.concat([...locales, directorio, fin]);
}


/**
 * Escribe TODOS los bytes en el descriptor, o lanza.
 *
 * `fs.writeSync` no promete escribirlo todo: devuelve cuántos bytes escribió, y
 * cuando el disco se llena a media escritura lo normal no es que lance sino que
 * escriba los que cupieron y devuelva ese número, menor que el pedido. El
 * `ENOSPC` llega en la SIGUIENTE llamada. Quien llama una sola vez y no mira lo
 * devuelto se queda con un archivo cortado y ninguna queja.
 *
 * No es teoría: se vio probando contra un disco lleno de verdad. Subir un PDF
 * de 200 KB a un disco al que le quedaban 64 KB contestó «guardado», anotó 200
 * KB en la ficha y dejó en el disco un PDF de 64 KB. Las pruebas con el disco
 * simulado no lo veían porque ahí la escritura nunca empieza.
 *
 * Se insiste hasta terminar, que es lo que hace `fs.writeFileSync` por dentro.
 * Y si una llamada no escribe nada sin lanzar —no debería pasar, pero un bucle
 * que confía en eso es un bucle infinito— se lanza el mismo `ENOSPC` que daría
 * el sistema, para que se traduzca al mismo mensaje.
 *
 * `escribir` solo se cambia en las pruebas, para provocar la escritura corta.
 *
 * Vive en este archivo, y no en `lib/disco.js` que es quien la reparte, porque
 * este no importa nada del resto de la plataforma —así se prueba suelto, copiado
 * a una carpeta vacía— y tiene que seguir así.
 */
export function escribirTodo(fd, datos, escribir = fs.writeSync) {
  let hechos = 0;
  while (hechos < datos.length) {
    const n = escribir(fd, datos, hechos, datos.length - hechos);
    if (!(n > 0)) {
      const err = new Error('ENOSPC: no space left on device, write');
      err.code = 'ENOSPC';
      throw err;
    }
    hechos += n;
  }
  return hechos;
}

/**
 * El mismo ZIP, pero escrito al disco entrada por entrada.
 *
 * `escribirZip` arma todo en memoria: junta los datos de cada archivo, sus
 * versiones comprimidas y al final concatena las tres cosas en un solo Buffer.
 * Para un puñado de kilobytes da igual. Para un respaldo completo —la base más
 * todos los PDF de contratos y facturas— el pico es como tres veces el
 * contenido, y ese respaldo lo dispara sola la plataforma cada día, sin que
 * nadie esté mirando.
 *
 * En un servidor de 512 MB eso termina en una sola cosa: el sistema mata el
 * proceso. No es una excepción que se pueda atrapar —no hay `catch` que valga
 * contra quedarse sin memoria— así que el servidor simplemente desaparece y
 * quien estuviera navegando recibe un 502 del portero, sin nada en la bitácora
 * que lo explique.
 *
 * Aquí se procesa un archivo a la vez y se escribe en cuanto está listo. El pico
 * pasa de «la suma de todo, por tres» a «el archivo más grande, por dos».
 * Medido con 160 MB de adjuntos: 410 MB de pico armándolo en memoria contra 94
 * MB escribiéndolo. En una máquina de 512 MB, donde además está corriendo la
 * aplicación, esa es exactamente la diferencia entre un respaldo y una caída.
 *
 * El .zip que sale es byte por byte el mismo que produce `escribirZip` —hay una
 * prueba que lo compara—, así que esto no cambia el formato: cambia solo por
 * dónde pasa el contenido.
 *
 * Las entradas pueden traer `datos` (un Buffer, para lo que ya se tiene en
 * memoria) o `ruta` (un archivo del disco, que se lee solo cuando le toca).
 *
 * OJO con lo que pasa si se corta: `destino` se queda en el disco, a medias y
 * sin directorio —que en un ZIP va al final—. Esta función no lo borra; quien
 * la llama tiene que darle un nombre provisional y hacerse cargo. `crear()`, en
 * `lib/respaldos.js`, lo hace así, y ahí está contado por qué importa tanto.
 */
export function escribirZipAArchivo(destino, entradas, fechaPorOmision = new Date()) {
  const fd = fs.openSync(destino, 'w');
  const central = [];
  let offset = 0;

  try {
    for (const e of entradas) {
      const nombre = Buffer.from(String(e.nombre).replace(/\\/g, '/'), 'utf8');
      // Solo aquí entra el archivo a memoria, y sale de ella al terminar la
      // vuelta: es lo que mantiene el pico acotado.
      const datos = e.datos !== undefined
        ? (Buffer.isBuffer(e.datos) ? e.datos : Buffer.from(e.datos))
        : fs.readFileSync(e.ruta);
      const suma = crc32(datos);

      const apretado = zlib.deflateRawSync(datos, { level: 6 });
      const comprime = apretado.length < datos.length;
      const cuerpo = comprime ? apretado : datos;
      const metodo = comprime ? 8 : 0;

      const { hora, dia } = fechaDos(e.fecha || fechaPorOmision);

      const local = Buffer.alloc(30 + nombre.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(metodo, 8);
      local.writeUInt16LE(hora, 10);
      local.writeUInt16LE(dia, 12);
      local.writeUInt32LE(suma, 14);
      local.writeUInt32LE(cuerpo.length, 18);
      local.writeUInt32LE(datos.length, 22);
      local.writeUInt16LE(nombre.length, 26);
      local.writeUInt16LE(0, 28);
      nombre.copy(local, 30);

      const dir = Buffer.alloc(46 + nombre.length);
      dir.writeUInt32LE(0x02014b50, 0);
      dir.writeUInt16LE(20, 4);
      dir.writeUInt16LE(20, 6);
      dir.writeUInt16LE(0, 8);
      dir.writeUInt16LE(metodo, 10);
      dir.writeUInt16LE(hora, 12);
      dir.writeUInt16LE(dia, 14);
      dir.writeUInt32LE(suma, 16);
      dir.writeUInt32LE(cuerpo.length, 20);
      dir.writeUInt32LE(datos.length, 24);
      dir.writeUInt16LE(nombre.length, 28);
      dir.writeUInt16LE(0, 30);
      dir.writeUInt16LE(0, 32);
      dir.writeUInt16LE(0, 34);
      dir.writeUInt16LE(0, 36);
      dir.writeUInt32LE(0, 38);
      dir.writeUInt32LE(offset, 42);
      nombre.copy(dir, 46);

      // `escribirTodo` y no `fs.writeSync`: una escritura corta por disco lleno
      // no lanza, y aquí tiene que morir con su `ENOSPC` y no seguir.
      escribirTodo(fd, local);
      escribirTodo(fd, cuerpo);
      central.push(dir);
      offset += local.length + cuerpo.length;
      if (offset > LIMITE) throw new Error('El respaldo pasa de 3 GB y este formato no lo soporta.');
    }

    const directorio = Buffer.concat(central);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(0, 4);
    fin.writeUInt16LE(0, 6);
    fin.writeUInt16LE(entradas.length, 8);
    fin.writeUInt16LE(entradas.length, 10);
    fin.writeUInt32LE(directorio.length, 12);
    fin.writeUInt32LE(offset, 16);
    fin.writeUInt16LE(0, 20);

    escribirTodo(fd, directorio);
    escribirTodo(fd, fin);
    // Que llegue al disco antes de darlo por escrito: quien llama lo va a
    // renombrar a su nombre definitivo creyendo que está completo.
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  return offset;
}

const FIRMA_FIN = 0x06054b50;
const FIRMA_DIRECTORIO = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/** Lee exactamente `largo` bytes desde `posicion`, o dice que el archivo no los tiene. */
function leerTramo(fd, posicion, largo) {
  const buf = Buffer.alloc(largo);
  const leidos = largo ? fs.readSync(fd, buf, 0, largo, posicion) : 0;
  if (leidos !== largo) throw new Error('El archivo está cortado: termina antes de lo que su directorio dice.');
  return buf;
}

/**
 * El directorio de un ZIP que está en el disco, sin leer su contenido.
 *
 * Solo entiende los ZIP que escribe este archivo: sin comentario al final y sin
 * ZIP64. Es deliberado. Esto no existe para abrir cualquier ZIP —para eso está
 * `leerZip`, que lo hace con el archivo en memoria— sino para contestar una
 * pregunta sobre los nuestros: ¿este respaldo quedó entero?
 */
function leerDirectorio(fd, tamano) {
  if (tamano < 22) throw new Error('El archivo es demasiado corto para ser un ZIP.');
  const fin = leerTramo(fd, tamano - 22, 22);
  if (fin.readUInt32LE(0) !== FIRMA_FIN) {
    throw new Error('El archivo no termina como un ZIP: le falta el directorio, que va al final.');
  }
  const cuantos = fin.readUInt16LE(10);
  const largo = fin.readUInt32LE(12);
  const donde = fin.readUInt32LE(16);
  if (donde + largo + 22 !== tamano) {
    throw new Error('El directorio del ZIP no cuadra con el tamaño del archivo.');
  }

  const dir = leerTramo(fd, donde, largo);
  const entradas = [];
  let p = 0;
  for (let n = 0; n < cuantos; n++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== FIRMA_DIRECTORIO) {
      throw new Error('El ZIP está dañado: el directorio no cuadra.');
    }
    const largoNombre = dir.readUInt16LE(p + 28);
    entradas.push({
      metodo: dir.readUInt16LE(p + 10),
      suma: dir.readUInt32LE(p + 16),
      comprimido: dir.readUInt32LE(p + 20),
      original: dir.readUInt32LE(p + 24),
      local: dir.readUInt32LE(p + 42),
      nombre: dir.toString('utf8', p + 46, p + 46 + largoNombre),
    });
    p += 46 + largoNombre + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
  }
  return { entradas, inicioDelDirectorio: donde };
}

/**
 * ¿Este ZIP del disco está entero? La revisión rápida: mira el final.
 *
 * Un ZIP lleva su directorio al final, así que uno cuya escritura se cortó no
 * lo tiene, y eso se ve leyendo unos cuantos bytes sin abrir el contenido.
 * Cuesta lo mismo para un respaldo de 1 MB que para uno de 200, y por eso se
 * puede hacer cada vez que se pinta la lista.
 *
 * Lo que NO detecta es un archivo con el tamaño correcto y el contenido
 * alterado. Para eso está `verificarZip`, que sí lo lee todo.
 *
 * @returns {string[]|null} los nombres de lo que trae, o `null` si no está entero
 */
export function revisarZip(ruta) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    return leerDirectorio(fd, fs.fstatSync(fd).size).entradas.map((e) => e.nombre);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Comprueba un ZIP del disco entero, archivo por archivo: que cada uno esté
 * donde el directorio dice, que se descomprima y que su suma de verificación
 * coincida con la que se anotó al escribirlo.
 *
 * Es lo que separa «se escribió» de «se puede restaurar», y se corre sobre un
 * respaldo nuevo antes de darle su nombre definitivo y, sobre todo, antes de
 * borrar ninguno viejo: lo viejo solo se suelta cuando lo nuevo está probado.
 *
 * Lee un archivo a la vez, igual que `escribirZipAArchivo` y por la misma
 * razón: la memoria que pide no puede depender de cuánto pese el respaldo.
 *
 * Lanza un error que dice qué no cuadró. Si no lanza, el ZIP está bien.
 *
 * @returns {string[]} los nombres de lo que trae
 */
export function verificarZip(ruta) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const { entradas, inicioDelDirectorio } = leerDirectorio(fd, fs.fstatSync(fd).size);
    for (const e of entradas) {
      const cabecera = leerTramo(fd, e.local, 30);
      if (cabecera.readUInt32LE(0) !== FIRMA_LOCAL) {
        throw new Error(`El ZIP está dañado: no se encuentra «${e.nombre}».`);
      }
      const inicio = e.local + 30 + cabecera.readUInt16LE(26) + cabecera.readUInt16LE(28);
      if (inicio + e.comprimido > inicioDelDirectorio) {
        throw new Error(`El ZIP está dañado: «${e.nombre}» se sale de su sitio.`);
      }
      const crudo = leerTramo(fd, inicio, e.comprimido);
      let datos;
      if (e.metodo === 0) datos = crudo;
      else if (e.metodo === 8) datos = zlib.inflateRawSync(crudo);
      else throw new Error(`«${e.nombre}» usa una compresión que no se reconoce.`);
      if (datos.length !== e.original || crc32(datos) !== e.suma) {
        throw new Error(`«${e.nombre}» viene dañado: no coincide con lo que el respaldo dice que debería ser.`);
      }
    }
    return entradas.map((e) => e.nombre);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Abre un ZIP y devuelve sus archivos. Se usa al restaurar, y por eso valida:
 * un archivo corrupto tiene que morir aquí, con un mensaje claro, y no a la
 * mitad de reemplazar la base que está operando.
 */
export function leerZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('El archivo no es un ZIP válido.');

  // El directorio va al final, después de un comentario de largo variable.
  let fin = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un ZIP válido (no tiene directorio).');

  const cuantos = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = [];

  for (let n = 0; n < cuantos; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('El ZIP está dañado: el directorio no cuadra.');
    }
    const metodo = buf.readUInt16LE(p + 10);
    const suma = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20);
    const original = buf.readUInt32LE(p + 24);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const donde = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);
    p += 46 + largoNombre + largoExtra + largoComentario;

    if (donde + 30 > buf.length || buf.readUInt32LE(donde) !== 0x04034b50) {
      throw new Error(`El ZIP está dañado: no se encuentra «${nombre}».`);
    }
    const inicio = donde + 30 + buf.readUInt16LE(donde + 26) + buf.readUInt16LE(donde + 28);
    const crudo = buf.subarray(inicio, inicio + comprimido);

    let datos;
    if (metodo === 0) datos = Buffer.from(crudo);
    else if (metodo === 8) datos = zlib.inflateRawSync(crudo);
    else throw new Error(`«${nombre}» usa una compresión que no se reconoce.`);

    if (datos.length !== original || crc32(datos) !== suma) {
      throw new Error(`«${nombre}» viene dañado: no coincide con lo que el respaldo dice que debería ser.`);
    }
    salida.push({ nombre, datos });
  }

  return salida;
}
