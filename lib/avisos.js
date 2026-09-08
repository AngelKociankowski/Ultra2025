/**
 * Avisos: que una corrección vuelva a quien capturó el dato.
 *
 * Viene de una observación concreta de la operación: «si un usuario detecta un
 * error debería poder corregirlo a través de una opción en donde llegue un
 * aviso a quien originalmente lo cargó y al área que corresponda». El ejemplo
 * que dieron lo explica entero: en un servicio se anexaron dos guardias de
 * incremento con la jornada equivocada —12x12 de lunes a domingo donde iban
 * 12x36 diurno—. Alguien lo corrige, el dato queda bien, y la persona que lo
 * tecleó no se entera nunca. La siguiente vez lo vuelve a capturar igual.
 *
 * La bitácora ya guardaba todo eso. Pero una bitácora hay que ir a mirarla, y
 * nadie la mira por si acaso: es el registro para cuando ya sabes que buscas
 * algo. Esto es lo contrario —las pocas cosas que una persona en concreto tiene
 * que ver—, y por eso lleva destinatario, se marca como leído y se cuenta en el
 * menú.
 *
 * A quién le llega, y por qué a esos dos:
 *
 *   · A quien capturó. Es el único que puede dejar de equivocarse igual, y el
 *     único que sabe si la corrección entendió mal lo que él quiso poner.
 *   · Al área a la que pertenece el dato. Un nombre mal escrito es cosa de
 *     operaciones; una razón social, de jurídico. El área ve el patrón que una
 *     sola persona no ve: tres correcciones de jornada en un mes no son tres
 *     descuidos, son una instrucción que no se dio.
 *
 * Lo que NO hace: mandar correos. Un aviso que sale de la plataforma se vuelve
 * un problema de otro sistema —que si llegó, que si acabó en spam, que si la
 * dirección sigue viva—, y lo que hacía falta es que la información no se
 * pierda, no que suene un teléfono. Vive donde se trabaja.
 */

import { getDb } from './db';

/** Cuántos avisos sin leer tiene alguien. Lo pinta el menú. */
export function sinLeer(usuarioId) {
  if (!usuarioId) return 0;
  return getDb()
    .prepare('SELECT COUNT(*) AS n FROM avisos WHERE usuario_id = ? AND leido_en IS NULL')
    .get(Number(usuarioId)).n;
}

/** Los avisos de alguien, los sin leer primero. */
export function listar(usuarioId, { limite = 60 } = {}) {
  if (!usuarioId) return [];
  return getDb()
    .prepare(
      `SELECT * FROM avisos WHERE usuario_id = ?
        ORDER BY (leido_en IS NULL) DESC, id DESC LIMIT ?`
    )
    .all(Number(usuarioId), limite);
}

/** Marca uno como leído. Solo el destinatario puede: no es de nadie más. */
export function marcarLeido(id, usuarioId) {
  const r = getDb()
    .prepare("UPDATE avisos SET leido_en = datetime('now') WHERE id = ? AND usuario_id = ? AND leido_en IS NULL")
    .run(Number(id), Number(usuarioId));
  return { cambiado: r.changes > 0 };
}

export function marcarTodosLeidos(usuarioId) {
  const r = getDb()
    .prepare("UPDATE avisos SET leido_en = datetime('now') WHERE usuario_id = ? AND leido_en IS NULL")
    .run(Number(usuarioId));
  return { marcados: r.changes };
}

/**
 * Crea los avisos de una corrección.
 *
 * Recibe la base porque se llama DENTRO de la transacción de la corrección: si
 * la corrección se deshace, los avisos se van con ella. Un aviso de algo que no
 * llegó a pasar es peor que ningún aviso.
 *
 * Nunca se avisa a quien hizo la corrección, aunque también sea el que capturó:
 * ya lo sabe, y un buzón que se llena de lo que uno mismo acaba de hacer deja
 * de leerse, que es la única forma de que esto falle.
 */
export function avisarCorreccion(db, { servicio, cambios, motivo, usuario, areas = [] }) {
  const destinatarios = new Map();

  // 1. Quien capturó el servicio: el del alta, y el del último movimiento.
  const capturaron = db
    .prepare(
      `SELECT DISTINCT creado_por AS id FROM (
         SELECT creado_por FROM aperturas WHERE servicio_id = ?
         UNION ALL
         SELECT creado_por FROM cancelaciones WHERE servicio_id = ?
       ) WHERE creado_por IS NOT NULL`
    )
    .all(servicio.id, servicio.id);
  for (const c of capturaron) destinatarios.set(c.id, 'capturó este servicio');

  // 2. El área del dato. Se busca por rol, y solo cuentas activas: avisarle a
  //    alguien que ya no trabaja aquí es dejar el aviso sin dueño.
  if (areas.length) {
    const marcas = areas.map(() => '?').join(',');
    const delArea = db
      .prepare(`SELECT id FROM usuarios WHERE rol IN (${marcas}) AND activo = 1`)
      .all(...areas);
    for (const u of delArea) if (!destinatarios.has(u.id)) destinatarios.set(u.id, 'es el área del dato');
  }

  destinatarios.delete(usuario?.id ?? -1);
  if (!destinatarios.size) return { avisados: 0 };

  const campos = Object.keys(cambios);
  const detalle = campos
    .map((c) => {
      const { antes, despues } = cambios[c];
      return `${ETIQUETAS[c] || c}: «${textoDe(antes)}» → «${textoDe(despues)}»`;
    })
    .join('\n');

  const ins = db.prepare(
    `INSERT INTO avisos (usuario_id, tipo, titulo, cuerpo, entidad, entidad_id, origen_id, origen)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const [id] of destinatarios) {
    ins.run(
      id,
      'correccion',
      `Se corrigió ${servicio.servicio}`,
      `${detalle}\n\nMotivo: ${motivo}`,
      'servicio',
      servicio.id,
      usuario?.id ?? null,
      usuario?.nombre || 'la plataforma'
    );
  }
  return { avisados: destinatarios.size };
}

const ETIQUETAS = {
  servicio: 'Nombre',
  razon_social: 'Razón social',
  total_guardias: 'Guardias',
  turnos: 'Desglose por jornada',
  estatus: 'Estatus',
  fecha_alta: 'Fecha de alta',
};

function textoDe(v) {
  if (v === null || v === undefined || v === '') return 'vacío';
  if (typeof v === 'object') {
    return Object.entries(v)
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ') || 'vacío';
  }
  return String(v);
}
