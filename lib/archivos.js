/**
 * Archivos adjuntos: el PDF de la factura y, si se tiene, su XML.
 *
 * Se guardan en el disco, junto a la base, y no dentro de ella. Meter binarios
 * en SQLite hace que cada respaldo y cada consulta arrastren megabytes que
 * nadie estaba pidiendo; en el disco son archivos sueltos que se copian y se
 * revisan con las herramientas de siempre.
 *
 * Tres reglas que no se negocian, porque un adjunto es la vía más corta para
 * meterle a un servidor algo que no debería:
 *
 *   1. El nombre con el que se guarda lo inventa la plataforma. El que trae el
 *      archivo se conserva aparte, solo para devolvérselo así al descargarlo.
 *      Un nombre de archivo del usuario nunca toca el sistema de archivos.
 *   2. Solo entran PDF y XML, que es lo que compone un CFDI.
 *   3. Se sirven siempre como descarga y nunca como página, para que un archivo
 *      con HTML dentro no pueda ejecutarse en la sesión de quien lo abre.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ValidacionError } from './errores';

/** Junto a la base: en el despliegue las dos viven en el disco persistente. */
function carpeta() {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');
  const dir = path.join(path.dirname(dbPath), 'archivos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const LIMITE_BYTES = 10 * 1024 * 1024;

const PERMITIDOS = {
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

function extensionDe(archivo, acepta) {
  const porTipo = PERMITIDOS[archivo.type];
  if (porTipo && acepta.includes(porTipo)) return porTipo;
  // Algunos navegadores mandan el tipo vacío; entonces manda la extensión.
  const ext = path.extname(archivo.name || '').toLowerCase().replace('.', '');
  if (acepta.includes(ext)) return ext;
  throw new ValidacionError(
    acepta.length === 1 && acepta[0] === 'pdf'
      ? 'El contrato se sube en PDF.'
      : 'Solo se aceptan archivos PDF o XML (el CFDI y su representación impresa).'
  );
}

/** Guarda el archivo y devuelve con qué quedó registrado en la factura. */
export async function guardar(archivo, prefijo, { acepta = ['pdf', 'xml'] } = {}) {
  if (!archivo || typeof archivo.arrayBuffer !== 'function') {
    throw new ValidacionError('No llegó ningún archivo.');
  }
  if (!archivo.size) throw new ValidacionError('El archivo está vacío.');
  if (archivo.size > LIMITE_BYTES) {
    throw new ValidacionError(`El archivo pasa de ${Math.round(LIMITE_BYTES / 1024 / 1024)} MB.`);
  }

  const ext = extensionDe(archivo, acepta);
  const nombre = `${prefijo}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const datos = Buffer.from(await archivo.arrayBuffer());
  fs.writeFileSync(path.join(carpeta(), nombre), datos);

  return {
    archivo: nombre,
    // Se recorta y se limpia solo para mostrarlo y para el nombre de descarga;
    // nunca se usa para escribir en el disco.
    archivo_nombre: String(archivo.name || `${prefijo}.${ext}`).replace(/[\r\n"]/g, '').slice(0, 120),
    archivo_tipo: ext === 'pdf' ? 'application/pdf' : 'application/xml',
    archivo_bytes: datos.length,
  };
}

/** Lee un archivo ya guardado. `nombre` viene de la base, nunca de la petición. */
export function leer(nombre) {
  if (!nombre || !/^[a-zA-Z0-9._-]+$/.test(nombre)) throw new ValidacionError('Archivo no válido.');
  const ruta = path.join(carpeta(), nombre);
  if (!fs.existsSync(ruta)) return null;
  return fs.readFileSync(ruta);
}

export function borrar(nombre) {
  if (!nombre || !/^[a-zA-Z0-9._-]+$/.test(nombre)) return;
  const ruta = path.join(carpeta(), nombre);
  if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
}
