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
