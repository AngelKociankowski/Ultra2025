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
  gerente: {
    etiqueta: 'Gerentes',
    singular: 'Gerente',
    plural: 'gerentes',
    columna: 'gerente',
    lo: 'lo',
    ayuda: 'El gerente a cargo del servicio. Se capturaba como texto libre y por eso venía vacío en los 223 servicios: sin una lista de dónde elegir, el campo no se llena.',
    ejemplo: 'ALBERTO MILLA',
  },
  supervisor: {
    etiqueta: 'Supervisores',
    singular: 'Supervisor',
    plural: 'supervisores',
    columna: 'supervisor',
    lo: 'lo',
    ayuda: 'Quién supervisa el servicio en campo. Escribirlo a mano partió a seis personas en dos: «JUAN JAIR TREJO» y «JUAN JAIR TREJO TREJO» son el mismo supervisor con dos cuentas de servicios.',
    ejemplo: 'OCTAVIO ESPARZA DAVILA',
  },
  estado_geo: {
    etiqueta: 'Estados',
    singular: 'Estado',
    plural: 'estados',
    columna: 'estado_geo',
    lo: 'lo',
    ayuda: 'El estado de la República donde se presta el servicio, en abreviatura.',
    ejemplo: 'CDMX',
  },
  tipo_repse: {
    etiqueta: 'Tipos de REPSE',
    singular: 'Tipo de REPSE',
    plural: 'tipos de REPSE',
    columna: 'tipo_repse',
    lo: 'lo',
    ayuda: 'Bajo qué figura del REPSE se presta el servicio. Es dato para la autoridad, así que conviene que sea siempre el mismo texto.',
    ejemplo: 'VIGILANCIA',
  },
  uniforme: {
    etiqueta: 'Uniformes',
    singular: 'Uniforme',
    plural: 'uniformes',
    columna: 'uniforme',
    lo: 'lo',
    ayuda: 'El uniforme que se le da al servicio. Cambia el costo de la dotación, y hasta ahora no se capturaba en ninguno.',
    ejemplo: 'INDUSTRIAL',
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
 * No son inventados: son las seis columnas de precio que ya trae la hoja de
 * aperturas —«Precio por guardia Básico», «ODS», «JT», «Bilingüe», «JS» y
 * «monitorista»—. La primera versión de esta lista se sacó de lo que se usa en
 * la vigilancia en general, y al revisar la hoja resultó que la empresa ya
 * tenía la suya: si no coinciden, el desglose de precio de la plataforma y el
 * del archivo no se pueden comparar.
 *
 * JT es jefe de turno y JS jefe de servicio; van escritos completos porque en
 * una lista desplegable dos siglas de dos letras se confunden.
 */
export const PUESTOS_BASE = [
  'GUARDIA BÁSICO',
  'GUARDIA ODS',
  'GUARDIA BILINGÜE',
  'JEFE DE TURNO',
  'JEFE DE SERVICIO',
  'MONITORISTA',
];


/**
 * Con qué arrancan los catálogos que antes eran texto libre.
 *
 * Cinco columnas de `servicios` —gerente, supervisor, estado, tipo de REPSE y
 * uniforme— se capturaban escribiendo. Cuatro de ellas están vacías en los 223
 * servicios: sin una lista de dónde elegir, el campo simplemente no se llena.
 * La quinta, supervisor, sí tiene datos y enseña el otro final del mismo
 * problema —seis personas partidas en dos por escribir a veces el apellido
 * materno—, así que se siembra con lo que ya hay y se limpia fusionando.
 *
 * Los estados van en abreviatura porque así los nombra la operación. No son
 * códigos IATA —esos son de aeropuertos— sino las abreviaturas de uso corriente.
 */
export const ESTADOS_BASE = ['CDMX', 'EDOMEX', 'HGO', 'MOR'];

/**
 * Las figuras del REPSE, los uniformes y los gerentes: los de la hoja.
 *
 * La primera versión de estas listas se sacó de lo que se usa en el ramo en
 * general —«VIGILANCIA», «SEGURIDAD PRIVADA», «INDUSTRIAL», «TÁCTICO»— y
 * estaba equivocada de arriba abajo. Van los nombres internos de la empresa,
 * tal cual: el REPSE por nivel —básico, plus, plus +, sin REPSE— y el uniforme
 * institucional o traje. Sin el prefijo «REPSE» delante de cada nivel: la
 * etiqueta del campo ya dice de qué se está hablando, y repetirlo en cada
 * opción es como llamarle «zona NORTE» a la zona norte.
 *
 * Sembrar opciones que nadie usa es peor que no sembrar ninguna: la lista se
 * llena de ruido y la gente acaba pidiendo que le agreguen la suya.
 */
export const REPSE_BASE = ['BÁSICO', 'PLUS', 'PLUS +', 'NO REQUIERE REPSE'];

export const UNIFORMES_BASE = ['COMANDO', 'TRAJE'];

/**
 * Uniformes que ya no se ofrecen pero siguen explicando lo capturado.
 *
 * Hoy la operación usa dos: comando y traje. En el histórico hay otros cinco
 * —«Institucional» sale en 41 movimientos, «Institucional y Traje» en 4, y
 * quedan un par de camuflajes y un «Otro»—. Borrarlos no le quitaría el dato a esos
 * movimientos, solo lograría que el catálogo dejara de explicar lo que hay en
 * pantalla; ofrecerlos sería invitar a seguir usándolos.
 *
 * Entran desactivados: no aparecen al capturar y sí al leer.
 */
export const UNIFORMES_RETIRADOS = ['INSTITUCIONAL', 'INSTITUCIONAL Y TRAJE', 'CAMUFLAJE GRIS', 'CAMUFLAJE ROJO', 'OTRO'];

/** Los dos gerentes que firman las aperturas de 2026. */
export const GERENTES_BASE = ['CARLOS AVALOS', 'JOSÉ R. PEÑA'];

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
    // Gerente y supervisor salen de lo que ya está capturado —incluidos los
    // duplicados, que es donde se ven y desde donde se fusionan—. Los otros
    // tres estaban vacíos en los 223 servicios, así que arrancan con una lista
    // de uso corriente que el administrador ajusta a la suya.
    if (tipos.has('gerente')) {
      for (const v of new Set([...distintos('gerente'), ...GERENTES_BASE])) ins.run('gerente', v, 0);
    }
    if (tipos.has('supervisor')) for (const v of distintos('supervisor')) ins.run('supervisor', v, 0);
    if (tipos.has('estado_geo')) {
      for (const v of new Set([...distintos('estado_geo'), ...ESTADOS_BASE])) ins.run('estado_geo', v, 0);
    }
    if (tipos.has('tipo_repse')) {
      for (const v of new Set([...distintos('tipo_repse'), ...REPSE_BASE])) ins.run('tipo_repse', v, 0);
    }
    if (tipos.has('uniforme')) {
      for (const v of new Set([...distintos('uniforme'), ...UNIFORMES_BASE])) ins.run('uniforme', v, 0);
      const retirado = db.prepare('INSERT OR IGNORE INTO catalogos (tipo, valor, orden, activo) VALUES (?,?,0,0)');
      for (const v of UNIFORMES_RETIRADOS) retirado.run('uniforme', v);
    }
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
  const todos = (tipo) =>
    db.prepare('SELECT valor FROM catalogos WHERE tipo = ? ORDER BY orden, valor').all(tipo).map((r) => r.valor);
  return {
    zonas: de('zona'),
    asesores: de('asesor'),
    turnos: de('turno'),
    formasPago: de('forma_pago'),
    puestos: de('puesto'),
    gerentes: de('gerente'),
    supervisores: de('supervisor'),
    estados: de('estado_geo'),
    tiposRepse: de('tipo_repse'),
    uniformes: de('uniforme'),
    // Todo lo que el catálogo conoce, incluido lo desactivado. Es distinto de
    // lo de arriba y la diferencia importa: un valor retirado no se ofrece al
    // capturar, pero tampoco es un desconocido del que haya que avisar. Sin
    // esta lista, desactivar «Institucional» marcaría como error las cuarenta y
    // un aperturas que lo traen.
    conocidos: {
      zonas: todos('zona'),
      asesores: todos('asesor'),
      gerentes: todos('gerente'),
      supervisores: todos('supervisor'),
      estados: todos('estado_geo'),
      tiposRepse: todos('tipo_repse'),
      uniformes: todos('uniforme'),
    },
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

const sinAcentos = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/**
 * La forma en que el catálogo escribe ese valor, si lo reconoce.
 *
 * Sirve para no confundir dos problemas distintos. Las hojas traen «Traje»
 * donde el catálogo dice «TRAJE»: es el mismo valor con otra mayúscula, y
 * marcarlo como desconocido llenaría la pantalla de avisos que no son errores.
 * En cambio «Centro» no se parece a ninguna zona viva, y ahí sí hay algo que
 * decidir.
 *
 * Devuelve null cuando de verdad no lo conoce.
 */
export function canonicoDelCatalogo(tipo, valor) {
  const v = sinAcentos(valor);
  if (!v) return null;
  const fila = base()
    .prepare('SELECT valor FROM catalogos WHERE tipo = ?')
    .all(tipo)
    .find((r) => sinAcentos(r.valor) === v);
  return fila ? fila.valor : null;
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

/** Si esa tabla guarda esa columna. Se consulta, no se supone. */
function tieneColumna(db, tabla, col) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === col);
}

/**
 * Repinta un valor en todas las tablas donde vive copiado.
 *
 * La lista de tablas no es la misma para cada catálogo, y suponerlo costaba un
 * 500: `cancelaciones` guarda zona y asesor, pero no gerente, supervisor,
 * estado, REPSE ni uniforme —una cancelación no tiene por qué repetir la ficha
 * entera del servicio—. Renombrar o fusionar cualquiera de esos cinco reventaba
 * contra una columna que no existe.
 */
function renombrarColumna(db, col, antes, despues) {
  const servicios = db
    .prepare(`UPDATE servicios SET ${col} = ?, actualizado_en = datetime('now') WHERE TRIM(${col}) = ?`)
    .run(despues, antes).changes;
  let movimientos = 0;
  for (const t of MOVIMIENTOS) {
    if (!tieneColumna(db, t, col)) continue;
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
    throw new ValidacionError(
      `«${v}» ya está en el catálogo. Si son la misma persona escrita de dos maneras, únelos con el botón de fusionar.`
    );
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

/**
 * Une dos opciones que siempre fueron la misma.
 *
 * Es lo que faltaba, y se nota en los datos: «JUAN JAIR TREJO» tiene 1 servicio
 * y «JUAN JAIR TREJO TREJO» tiene 26. Son el mismo supervisor, escrito una vez
 * sin el apellido materno. Lo mismo con Alejandro Baltierra, Enrique García,
 * José Luis Torres y Octavio Esparza: seis personas partidas en doce renglones,
 * de modo que cualquier cuenta por supervisor sale mal.
 *
 * Renombrar no servía: si el destino ya existe, la restricción de únicos lo
 * rechaza, y por eso el mensaje decía «muévelos uno por uno». Fusionar hace lo
 * que ahí se pedía a mano —repinta los servicios y los movimientos con el
 * nombre bueno— y luego borra la entrada sobrante, que ya no le queda a nadie.
 *
 * Deliberadamente NO toca `snapshots`: un corte cerrado es el respaldo de lo
 * que se facturó ese mes, con los nombres que tenía ese mes. Corregir el
 * presente no es reescribir el pasado.
 */
export function fusionar(id, haciaId, usuario) {
  const db = base();
  const origen = obtener(db, id);
  const destino = obtener(db, haciaId);

  if (origen.id === destino.id) throw new ValidacionError('Es la misma opción: no hay nada que fusionar.');
  if (origen.tipo !== destino.tipo) {
    throw new ValidacionError('Solo se pueden fusionar dos opciones del mismo catálogo.');
  }

  const tx = db.transaction(() => {
    const tocados =
      origen.tipo === 'turno'
        ? renombrarTurno(db, origen.valor, destino.valor)
        : renombrarColumna(db, TIPOS[origen.tipo].columna, origen.valor, destino.valor);

    db.prepare('DELETE FROM catalogos WHERE id = ?').run(origen.id);

    auditar(db, {
      usuario,
      accion: 'catalogo_fusionar',
      entidad: 'catalogo',
      entidad_id: destino.id,
      detalle: `${TIPOS[origen.tipo].singular}: «${origen.valor}» se unió a «${destino.valor}» (${tocados.servicios} servicios, ${tocados.movimientos} movimientos)`,
      cambios: { valor: { antes: origen.valor, despues: destino.valor } },
    });
    return tocados;
  });

  return { origen: origen.valor, destino: destino.valor, ...tx() };
}

/**
 * Adopta un valor que está capturado en los servicios pero no es opción.
 *
 * Son los huérfanos que dejó la captura libre. Hasta ahora se veían en la
 * pantalla del administrador y no se podía hacer nada con ellos más que
 * escribirlos de nuevo a mano y esperar no equivocarse en una letra.
 */
export function adoptar(tipo, valor, usuario) {
  const db = base();
  exigirTipo(tipo);
  const v = normalizarValor(tipo, valor);
  const usos = usosPorValor(db, tipo).get(v) || 0;
  if (!usos) {
    throw new ValidacionError(`«${v}» no está capturado en ningún servicio. Si lo quieres como opción, agrégalo.`);
  }
  return crear(tipo, v, usuario);
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
