import { getDb, auditar } from './db';
/**
 * Los errores, de donde viven y no de `lib/servicios.js`.
 *
 * `servicios.js` los reexporta y era de ahí de donde se tomaban, y eso cerraba
 * un círculo: `captura → comentarios → servicios → captura`. Es el mismo círculo
 * que se rompió sacando los esquemas a `lib/esquemas.js`, solo movido de sitio:
 * no falla hoy porque ninguno de los tres lee el valor importado en el cuerpo del
 * módulo, y es la clase de dependencia que funciona hasta el día que cambia el
 * orden en que se evalúan los módulos. `lib/errores.js` no importa nada, así que
 * por aquí ya no hay círculo que cerrar.
 */
import { ValidacionError, PermisoError } from './errores';

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

/**
 * Lo más largo que puede ser un comentario.
 *
 * Se exporta porque es el único tope de texto libre que la plataforma tenía
 * cuando se unificó la captura, y `lib/captura.js` lo reusa para los campos que
 * la ficha pinta como párrafo —observaciones, comentarios del contrato, el
 * detalle de un motivo—: no hay razón para que una observación de la ficha quepa
 * menos que un comentario de la misma ficha, y dos topes distintos para la misma
 * clase de texto acabarían separándose.
 */
export const LARGO_MAXIMO = 2000;

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
