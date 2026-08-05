/**
 * Catálogos de captura: zonas, asesores y turnos.
 *
 * Punto único de lectura y escritura de la tabla `catalogos`. Los formularios
 * de apertura y de movimiento sacan de aquí lo que ofrecen en sus listas
 * desplegables, y el administrador lo alimenta desde /catalogos.
 *
 * Tres decisiones que conviene tener claras:
 *
 *   1. Una opción que ya se usó no se borra, se desactiva. Borrarla no le
 *      quitaría el dato a los servicios que la traen —el texto vive copiado en
 *      cada renglón— así que solo lograría que el catálogo dejara de explicar
 *      lo que hay en pantalla.
 *
 *   2. Renombrar sí corrige hacia atrás: cambia el valor en los servicios y en
 *      los movimientos, porque un cambio de nombre es casi siempre una falta de
 *      captura y dejarla a medias parte el dato en dos.
 *
 *   3. Nada de esto toca `snapshots`. Un corte cerrado es el respaldo de lo que
 *      se facturó ese mes y no se reescribe, ni para arreglar una falta.
 */

import { getDb, auditar } from './db';
import { ValidacionError } from './errores';

export const TIPOS = {
  zona: {
    etiqueta: 'Zonas',
    singular: 'Zona',
    plural: 'zonas',
    columna: 'zona',
    // el pronombre va aquí para que los avisos no digan «la turno»
    lo: 'la',
    ayuda: 'Las zonas que se pueden elegir al abrir un servicio.',
    ejemplo: 'NORTE',
  },
  asesor: {
    etiqueta: 'Asesores',
    singular: 'Asesor',
    plural: 'asesores',
    columna: 'asesor',
    lo: 'lo',
    ayuda: 'Quién atiende comercialmente el servicio. Un asesor que se va se desactiva; sus servicios conservan su nombre.',
    ejemplo: 'CARLOS LOAIZA',
  },
  turno: {
    etiqueta: 'Turnos',
    singular: 'Turno',
    plural: 'turnos',
    columna: null,
    lo: 'lo',
    ayuda: 'Los turnos del desglose de guardias. Solo se aceptan al capturar los que estén en esta lista.',
    ejemplo: '12X12 L-D',
  },
  forma_pago: {
    etiqueta: 'Formas de pago',
    singular: 'Forma de pago',
    plural: 'formas de pago',
    columna: 'forma_pago',
    lo: 'la',
    ayuda: 'Cómo paga el cliente. Se elige al abrir el servicio y al registrar un pago.',
    ejemplo: 'TRANSFERENCIA',
  },
  puesto: {
    etiqueta: 'Puestos',
    singular: 'Puesto',
    plural: 'puestos',
    columna: null,
    lo: 'lo',
    ayuda:
      'Los puestos que se pueden cotizar dentro de un servicio. Un jefe de servicio no cuesta lo mismo que un guardia raso, y el precio se captura por puesto.',
    ejemplo: 'JEFE DE SERVICIO',
  },
};

/**
 * Turnos con los que arranca el catálogo.
 *
 * Son los que venían escritos a mano en el sistema antes de que existiera esta
 * tabla. A partir del arranque mandan las filas de `catalogos`, no esta lista:
 * si el administrador desactiva uno, deja de ofrecerse aunque siga aquí.
 */
export const TURNOS_BASE = [
  '8X16 L-D', '8X16 L-S', '8X16 L-V',
  '12X12 L-D', '12X12 L-S', '12X12 L-V',
  '10X14', '11X13', '12 HRS', '13X47',
  '12X24', '12X36', '24 HRS', '24X24', '24X48',
];

/**
 * Formas de pago con las que arranca el catálogo.
 *
 * Las hojas no traían ninguna —la columna venía vacía en los 217 servicios—
 * así que aquí no hay nada que rescatar: se siembran las de uso corriente para
 * que el campo sirva desde el primer día, y el administrador ajusta.
 */
export const FORMAS_PAGO_BASE = ['TRANSFERENCIA', 'CHEQUE', 'EFECTIVO', 'DEPÓSITO', 'TARJETA'];

/**
 * Puestos con los que arranca el catálogo.
 *
 * En los archivos no había ninguno: el precio se llevaba como un solo número
 * por servicio, así que no hay nada que rescatar. Se siembran los de uso
 * corriente en la vigilancia para que el campo sirva desde el primer día, y el
 * administrador agrega los suyos —canino, escolta, paramédico— desde Catálogos.
 */
export const PUESTOS_BASE = [
  'GUARDIA',
  'GUARDIA INTRAMUROS',
  'JEFE DE SERVICIO',
  'SUPERVISOR',
  'MONITORISTA',
  'CHOFER',
  'RECEPCIONISTA',
];

/** Tablas donde el mismo dato vive copiado y que sí se corrigen al renombrar. */
const MOVIMIENTOS = ['aperturas', 'cancelaciones'];

// --------------------------------------------------------------- arranque

let sembrado = false;

/**
 * Primera carga del catálogo, a partir de lo que ya trae el estado de fuerza.
 *
 * Mira solo `servicios`, nunca los cortes cerrados. Las hojas viejas de 2023 y
 * 2024 traen en la columna de zona números que en realidad eran de otra columna
 * ("21", "35", "8") y asesores que son pedazos de nombre ("GUI", "CSS"). Eso es
 * ruido de una importación vieja y no tiene por qué convertirse en una opción
 * que alguien pueda elegir hoy.
 */
function sembrar(db, tipos) {
  const distintos = (col) =>
    db
      .prepare(
        `SELECT DISTINCT TRIM(${col}) AS v FROM servicios
          WHERE ${col} IS NOT NULL AND TRIM(${col}) <> '' ORDER BY v`
      )
      .all()
      .map((r) => r.v);

  const turnosEnUso = new Set();
  for (const r of db.prepare('SELECT turnos_json FROM servicios').all()) {
    for (const k of Object.keys(JSON.parse(r.turnos_json || '{}'))) {
      turnosEnUso.add(k.toUpperCase().trim());
    }
  }
  const turnos = [
    ...TURNOS_BASE,
    ...[...turnosEnUso].filter((t) => !TURNOS_BASE.includes(t)).sort(),
  ];

  const formas = [...new Set([...distintos('forma_pago'), ...FORMAS_PAGO_BASE])];

  const ins = db.prepare('INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES (?,?,?)');
  db.transaction(() => {
    if (tipos.has('zona')) for (const v of distintos('zona')) ins.run('zona', v, 0);
    if (tipos.has('asesor')) for (const v of distintos('asesor')) ins.run('asesor', v, 0);
    if (tipos.has('forma_pago')) for (const v of formas) ins.run('forma_pago', v, 0);
    if (tipos.has('turno')) turnos.forEach((v, i) => ins.run('turno', v, i));
    if (tipos.has('puesto')) PUESTOS_BASE.forEach((v, i) => ins.run('puesto', v, i));
  })();
}

/**
 * Devuelve la base con el catálogo garantizado.
 *
 * La siembra es por tipo y solo alcanza a los que no tienen ni una opción. Así
 * cubre las dos situaciones: instalar sobre una base que ya traía servicios
 * cargados, y agregar un tipo nuevo —las formas de pago— a una base donde el
 * catálogo ya venía funcionando. Un tipo que el administrador dejó como quiere
 * nunca se vuelve a tocar.
 */
function base() {
  const db = getDb();
  if (!sembrado) {
    const conOpciones = new Set(
      db.prepare('SELECT DISTINCT tipo FROM catalogos').all().map((r) => r.tipo)
    );
    const faltantes = new Set(Object.keys(TIPOS).filter((t) => !conOpciones.has(t)));
    if (faltantes.size) sembrar(db, faltantes);
    sembrado = true;
  }
  return db;
}

// --------------------------------------------------------------- consultas

/** Lo que los formularios de captura ofrecen hoy. */
export function opciones() {
  const db = base();
  const de = (tipo) =>
    db
      .prepare('SELECT valor FROM catalogos WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
      .all(tipo)
      .map((r) => r.valor);
  return {
    zonas: de('zona'),
    asesores: de('asesor'),
    turnos: de('turno'),
    formasPago: de('forma_pago'),
    puestos: de('puesto'),
  };
}

/**
 * Turnos que el servidor acepta en un desglose, incluidos los desactivados.
 *
 * Desactivar un turno quita la casilla de las capturas nuevas, pero los
 * servicios que ya lo traen siguen moviéndose: una disminución sobre ellos
 * tiene que poder nombrarlo.
 */
export function turnosAceptados() {
  return new Set(
    base()
      .prepare("SELECT valor FROM catalogos WHERE tipo = 'turno'")
      .all()
      .map((r) => r.valor)
  );
}

/**
 * Comprueba que un valor venga del catálogo y lo devuelve normalizado.
 *
 * Vale también si la opción está desactivada: desactivar es dejar de ofrecerla
 * para adelante, no invalidar lo que los servicios ya traen. Vacío se acepta
 * —no todos los servicios tienen asesor— y devuelve null.
 *
 * Esta comprobación vive en el servidor a propósito. La lista desplegable
 * arregla la captura por pantalla, pero mientras la API siguiera aceptando
 * cualquier texto, el catálogo sería una sugerencia y no una regla.
 */
export function exigirDelCatalogo(tipo, valor) {
  const v = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (!v) return null;
  const conocidos = new Set(
    base().prepare('SELECT valor FROM catalogos WHERE tipo = ?').all(tipo).map((r) => r.valor)
  );
  if (!conocidos.has(v)) {
    throw new ValidacionError(
      `«${v}» no está en el catálogo de ${TIPOS[tipo].plural}. Un administrador lo da de alta en Catálogos.`
    );
  }
  return v;
}

/** Cuántos servicios traen capturado cada valor de un tipo. */
function usosPorValor(db, tipo) {
  const cuenta = new Map();
  if (tipo === 'turno') {
    for (const r of db.prepare('SELECT turnos_json FROM servicios').all()) {
      for (const k of Object.keys(JSON.parse(r.turnos_json || '{}'))) {
        cuenta.set(k, (cuenta.get(k) || 0) + 1);
      }
    }
    return cuenta;
  }
  const col = TIPOS[tipo].columna;
  const filas = db
    .prepare(
      `SELECT TRIM(${col}) AS v, COUNT(*) AS n FROM servicios
        WHERE ${col} IS NOT NULL AND TRIM(${col}) <> '' GROUP BY TRIM(${col})`
    )
    .all();
  for (const f of filas) cuenta.set(f.v, f.n);
  return cuenta;
}

/**
 * El catálogo completo para la pantalla del administrador.
 *
 * Junto a cada opción va cuántos servicios la usan —es lo que decide si se
 * puede borrar o solo desactivar— y aparte los valores que están capturados en
 * algún servicio pero no existen como opción. Esos huérfanos son los que dejó
 * la captura libre de antes: se ven para poder adoptarlos o corregirlos, no
 * para que sigan creciendo.
 */
export function listarParaAdmin() {
  const db = base();
  const out = {};
  for (const tipo of Object.keys(TIPOS)) {
    const usos = usosPorValor(db, tipo);
    const filas = db
      .prepare('SELECT * FROM catalogos WHERE tipo = ? ORDER BY orden, valor')
      .all(tipo)
      .map((r) => ({ ...r, activo: !!r.activo, usos: usos.get(r.valor) || 0 }));
    const conocidos = new Set(filas.map((f) => f.valor));
    const huerfanos = [...usos.entries()]
      .filter(([v]) => !conocidos.has(v))
      .map(([valor, usos]) => ({ valor, usos }))
      .sort((a, b) => b.usos - a.usos || a.valor.localeCompare(b.valor));
    out[tipo] = { opciones: filas, huerfanos };
  }
  return out;
}

// --------------------------------------------------------------- escritura

function exigirTipo(tipo) {
  if (!TIPOS[tipo]) throw new ValidacionError('Ese catálogo no existe.');
  return TIPOS[tipo];
}

function obtener(db, id) {
  const fila = db.prepare('SELECT * FROM catalogos WHERE id = ?').get(Number(id));
  if (!fila) throw new ValidacionError('Esa opción del catálogo ya no existe.');
  return fila;
}

/**
 * Deja el valor como se va a guardar.
 *
 * Los espacios de más y las mayúsculas de los turnos se normalizan aquí y no en
 * la pantalla: si dependiera del formulario, la misma opción entraría distinta
 * según por dónde se capturó, que es justo lo que este catálogo viene a evitar.
 */
function normalizarValor(tipo, valor) {
  let v = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (tipo === 'turno') v = v.toUpperCase();
  if (v.length < 2) throw new ValidacionError(`Escribe ${TIPOS[tipo].singular.toLowerCase()} (al menos 2 caracteres).`);
  if (v.length > 60) throw new ValidacionError('El nombre no puede pasar de 60 caracteres.');
  return v;
}

export function crear(tipo, valor, usuario) {
  const db = base();
  exigirTipo(tipo);
  const v = normalizarValor(tipo, valor);

  const existente = db.prepare('SELECT * FROM catalogos WHERE tipo = ? AND valor = ?').get(tipo, v);
  if (existente) {
    throw new ValidacionError(
      existente.activo
        ? `«${v}» ya está en el catálogo.`
        : `«${v}» ya existe pero está desactivado. Actívalo en la lista.`
    );
  }

  // Los turnos se acomodan al final para respetar el orden en que se leen;
  // zonas y asesores salen por nombre, así que no llevan posición.
  const orden =
    tipo === 'turno'
      ? db.prepare("SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM catalogos WHERE tipo = 'turno'").get().n
      : 0;

  const info = db.prepare('INSERT INTO catalogos (tipo, valor, orden) VALUES (?,?,?)').run(tipo, v, orden);
  auditar(db, {
    usuario,
    accion: 'catalogo_alta',
    entidad: 'catalogo',
    entidad_id: info.lastInsertRowid,
    detalle: `${TIPOS[tipo].singular}: ${v}`,
  });
  return { id: info.lastInsertRowid, tipo, valor: v };
}

function renombrarColumna(db, col, antes, despues) {
  const servicios = db
    .prepare(`UPDATE servicios SET ${col} = ?, actualizado_en = datetime('now') WHERE TRIM(${col}) = ?`)
    .run(despues, antes).changes;
  let movimientos = 0;
  for (const t of MOVIMIENTOS) {
    movimientos += db.prepare(`UPDATE ${t} SET ${col} = ? WHERE TRIM(${col}) = ?`).run(despues, antes).changes;
  }
  return { servicios, movimientos };
}

/**
 * Renombra un turno dentro del desglose, que vive como llave dentro del JSON.
 *
 * Si el servicio ya traía el turno destino, los dos eran el mismo escrito de
 * dos maneras —que es justo el motivo de renombrar— así que se suman en uno.
 * El total de guardias no se toca: la suma del desglose no cambia.
 */
function renombrarTurno(db, antes, despues) {
  const mover = (tabla, sello) => {
    let n = 0;
    const upd = db.prepare(
      `UPDATE ${tabla} SET turnos_json = ?${sello ? ", actualizado_en = datetime('now')" : ''} WHERE id = ?`
    );
    for (const f of db.prepare(`SELECT id, turnos_json FROM ${tabla}`).all()) {
      const t = JSON.parse(f.turnos_json || '{}');
      if (!(antes in t)) continue;
      t[despues] = (Number(t[despues]) || 0) + (Number(t[antes]) || 0);
      delete t[antes];
      upd.run(JSON.stringify(t), f.id);
      n++;
    }
    return n;
  };
  const servicios = mover('servicios', true);
  let movimientos = 0;
  for (const t of MOVIMIENTOS) movimientos += mover(t, false);
  return { servicios, movimientos };
}

export function renombrar(id, valor, usuario) {
  const db = base();
  const fila = obtener(db, id);
  const v = normalizarValor(fila.tipo, valor);
  if (v === fila.valor) return { sinCambios: true, valor: v };

  if (db.prepare('SELECT 1 FROM catalogos WHERE tipo = ? AND valor = ? AND id <> ?').get(fila.tipo, v, fila.id)) {
    throw new ValidacionError(`«${v}» ya está en el catálogo. Si quieres unirlos, mueve los servicios uno por uno.`);
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE catalogos SET valor = ? WHERE id = ?').run(v, fila.id);
    const tocados =
      fila.tipo === 'turno'
        ? renombrarTurno(db, fila.valor, v)
        : renombrarColumna(db, TIPOS[fila.tipo].columna, fila.valor, v);

    auditar(db, {
      usuario,
      accion: 'catalogo_renombrar',
      entidad: 'catalogo',
      entidad_id: fila.id,
      detalle: `${TIPOS[fila.tipo].singular}: «${fila.valor}» → «${v}» (${tocados.servicios} servicios, ${tocados.movimientos} movimientos)`,
      cambios: { valor: { antes: fila.valor, despues: v } },
    });
    return tocados;
  });

  return { valor: v, antes: fila.valor, ...tx() };
}

export function alternar(id, activo, usuario) {
  const db = base();
  const fila = obtener(db, id);
  const nuevo = activo ? 1 : 0;
  if (nuevo === fila.activo) return { sinCambios: true };

  db.prepare('UPDATE catalogos SET activo = ? WHERE id = ?').run(nuevo, fila.id);
  auditar(db, {
    usuario,
    accion: nuevo ? 'catalogo_activar' : 'catalogo_desactivar',
    entidad: 'catalogo',
    entidad_id: fila.id,
    detalle: `${TIPOS[fila.tipo].singular}: ${fila.valor}`,
  });
  return { valor: fila.valor, activo: !!nuevo };
}

export function eliminar(id, usuario) {
  const db = base();
  const fila = obtener(db, id);
  const usos = usosPorValor(db, fila.tipo).get(fila.valor) || 0;
  if (usos > 0) {
    const lo = TIPOS[fila.tipo].lo;
    throw new ValidacionError(
      `No se puede borrar «${fila.valor}»: ${usos} servicio${usos === 1 ? '' : 's'} ${lo} ${
        usos === 1 ? 'trae' : 'traen'
      } capturad${lo === 'la' ? 'a' : 'o'}. Desactíva${lo} para que deje de ofrecerse sin tocar esos servicios.`
    );
  }

  db.prepare('DELETE FROM catalogos WHERE id = ?').run(fila.id);
  auditar(db, {
    usuario,
    accion: 'catalogo_baja',
    entidad: 'catalogo',
    entidad_id: fila.id,
    detalle: `${TIPOS[fila.tipo].singular}: ${fila.valor}`,
  });
  return { valor: fila.valor };
}
