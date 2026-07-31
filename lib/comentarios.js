import { getDb, auditar } from './db';
import { ValidacionError, PermisoError } from './servicios';

/**
 * Comentarios sobre un servicio.
 *
 * Son notas del equipo, no datos del estado de fuerza: cualquier rol puede
 * escribirlas porque no cambian ni un guardia ni una factura. Lo que sí importa
 * es que quede firmado quién las escribió, así que no se editan —una nota
 * corregida a posteriori deja de ser un registro de lo que se dijo—. Se pueden
 * borrar, pero solo por su autor o por un administrador, y la baja queda en la
 * bitácora.
 */

const LARGO_MAXIMO = 2000;

/** ¿Existe ese servicio? Un id que no es número tampoco. */
export function existeServicio(servicioId) {
  const id = Number(servicioId);
  if (!Number.isInteger(id) || id <= 0) return false;
  return Boolean(getDb().prepare('SELECT 1 FROM servicios WHERE id = ?').get(id));
}

export function listarComentarios(servicioId) {
  return getDb()
    .prepare(
      `SELECT id, servicio_id, usuario_id, usuario, rol, texto, creado_en
         FROM comentarios WHERE servicio_id = ? ORDER BY id DESC`
    )
    .all(Number(servicioId));
}

/** Cuántos comentarios tiene cada servicio, para la tabla del estado de fuerza. */
export function conteoComentarios() {
  const filas = getDb()
    .prepare('SELECT servicio_id, COUNT(*) AS n FROM comentarios GROUP BY servicio_id')
    .all();
  return new Map(filas.map((f) => [f.servicio_id, f.n]));
}

export function agregarComentario(servicioId, texto, usuario) {
  const db = getDb();
  const id = Number(servicioId);

  const servicio = db.prepare('SELECT id, servicio FROM servicios WHERE id = ?').get(id);
  if (!servicio) throw new ValidacionError('El servicio no existe.');

  const limpio = String(texto ?? '').trim();
  if (!limpio) throw new ValidacionError('El comentario no puede ir vacío.');
  if (limpio.length > LARGO_MAXIMO) {
    throw new ValidacionError(`El comentario no puede pasar de ${LARGO_MAXIMO} caracteres.`);
  }

  const info = db
    .prepare(
      `INSERT INTO comentarios (servicio_id, usuario_id, usuario, rol, texto)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, usuario.id, usuario.nombre, usuario.rol, limpio);

  return db
    .prepare('SELECT id, servicio_id, usuario_id, usuario, rol, texto, creado_en FROM comentarios WHERE id = ?')
    .get(info.lastInsertRowid);
}

export function eliminarComentario(comentarioId, usuario) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM comentarios WHERE id = ?').get(Number(comentarioId));
  if (!c) throw new ValidacionError('El comentario no existe.');

  const esAutor = c.usuario_id === usuario.id;
  if (!esAutor && usuario.rol !== 'admin') {
    throw new PermisoError('Solo quien escribió el comentario, o un administrador, puede borrarlo.');
  }

  db.prepare('DELETE FROM comentarios WHERE id = ?').run(c.id);

  auditar(db, {
    usuario,
    accion: 'borrar_comentario',
    entidad: 'servicio',
    entidad_id: c.servicio_id,
    detalle: `Borró un comentario de ${c.usuario}: “${c.texto.slice(0, 80)}”`,
  });

  return { ok: true };
}
