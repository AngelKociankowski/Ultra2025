import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { anioActual } from './fechas';
import { arrancarAgenda } from './agenda';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');

let _db = null;

export function getDb() {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const schema = fs.readFileSync(path.join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  db.exec(schema);
  migrar(db, schema);
  db.pragma('foreign_keys = ON');

  _db = db;

  // La base ya está lista: es el momento de encender el respaldo automático.
  arrancarAgenda();

  return _db;
}

/**
 * Suelta la base. Solo hace falta al restaurar: mientras el proceso tenga el
 * archivo abierto no se puede reemplazar sin dejar la conexión apuntando a algo
 * que ya no existe. Después de esto, el siguiente getDb() la vuelve a abrir —y
 * de paso vuelve a correr el esquema y las migraciones sobre la base restaurada,
 * que es justo lo que se quiere si el respaldo es de una versión anterior.
 */
export function cerrarDb() {
  if (!_db) return;
  try {
    _db.close();
  } finally {
    _db = null;
  }
}

/**
 * Pone al día una base que se creó con una versión anterior del esquema.
 *
 * `CREATE TABLE IF NOT EXISTS` solo sirve para tablas nuevas: a una que ya
 * existe no le agrega columnas ni le cambia una restricción. Sin esto, instalar
 * una versión nueva sobre la base que ya está operando reventaría al primer
 * INSERT que use una columna que allí no existe.
 *
 * Todo lo de aquí es idempotente: correrlo dos veces no hace nada la segunda.
 */
const COLUMNAS_AGREGADAS = [
  ['servicios', 'esquema_facturacion', 'TEXT'],
  ['aperturas', 'esquema_facturacion', 'TEXT'],
  ['aperturas', 'dias_credito', 'INTEGER'],
  ['aperturas', 'credito_maximo', 'REAL'],
  ['facturas', 'carga_inicial', 'INTEGER NOT NULL DEFAULT 0'],
  ['facturas', 'archivo', 'TEXT'],
  ['facturas', 'archivo_nombre', 'TEXT'],
  ['facturas', 'archivo_tipo', 'TEXT'],
  ['facturas', 'archivo_bytes', 'INTEGER'],
  ['servicios', 'contrato_archivo', 'TEXT'],
  ['servicios', 'contrato_archivo_nombre', 'TEXT'],
  ['servicios', 'contrato_archivo_tipo', 'TEXT'],
  ['servicios', 'contrato_archivo_bytes', 'INTEGER'],
  ['servicios', 'contrato_archivo_subido_en', 'TEXT'],
  ['aperturas', 'descartada', 'INTEGER NOT NULL DEFAULT 0'],
  ['aperturas', 'descartada_motivo', 'TEXT'],
  ['aperturas', 'descartada_en', 'TEXT'],
  ['aperturas', 'descartada_por', 'INTEGER'],
  ['servicios', 'suspendido_desde', 'TEXT'],
  ['servicios', 'suspendido_motivo', 'TEXT'],
  ['servicios', 'fecha_fin_prevista', 'TEXT'],
  ['aperturas', 'supervisor', 'TEXT'],
  ['aperturas', 'modalidad', 'TEXT'],
  ['aperturas', 'fecha_fin_prevista', 'TEXT'],
  ['aperturas', 'hora_apertura', 'TEXT'],
  ['aperturas', 'vehiculos_custodia', 'INTEGER'],
  ['aperturas', 'equipo_json', "TEXT NOT NULL DEFAULT '{}'"],
  // `servicios.modalidad` no está aquí: lleva CHECK, y un ALTER TABLE ADD
  // COLUMN no puede traerlo. Entra con la reconstrucción de la tabla, más abajo.
];

function migrar(db, schema) {
  for (const [tabla, columna, tipo] of COLUMNAS_AGREGADAS) {
    const tiene = db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
    if (!tiene) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
  }

  // El mes de aumento venía de los archivos escrito a mano, y por eso hay
  // «febrero» y «Febrero» conviviendo. Para la agenda de aumentos son el mismo
  // mes, así que se dejan todos en minúsculas de una vez: comparar en minúsculas
  // en cada consulta funcionaría igual, pero deja el dato sucio para siempre.
  db.exec("UPDATE servicios SET mes_incremento = LOWER(TRIM(mes_incremento)) WHERE mes_incremento IS NOT NULL AND mes_incremento <> LOWER(TRIM(mes_incremento))");

  // `servicios.estatus` aceptaba dos valores y ahora acepta también SUSPENDIDO.
  // Cambiar un CHECK obliga a rehacer la tabla, y esta es la central: le apuntan
  // aperturas, cancelaciones, facturas, comentarios y precios. Los ids se
  // conservan al copiar, así que esas llaves siguen apuntando a lo mismo; lo que
  // no se puede es dejar las foráneas encendidas mientras la tabla no existe.
  //
  // Todo va en una transacción: o queda la tabla nueva completa, o no cambia
  // nada. Y antes de esto ya corrió el respaldo automático del día.
  //
  // La condición mira varias palabras y no una: cada vez que el CHECK de esta
  // tabla crece hay que rehacerla otra vez, y con un solo centinela la segunda
  // migración pasaba de largo sin avisar. `modalidad` entró después que
  // SUSPENDIDO, y en una base que ya traía SUSPENDIDO la reconstrucción no
  // habría corrido. Se copian las columnas que existían antes; las nuevas se
  // quedan con su DEFAULT, que es justo lo que se quiere.
  const defServicios = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='servicios'").get();
  if (defServicios && !['SUSPENDIDO', 'modalidad'].every((p) => defServicios.sql.includes(p))) {
    const columnas = db
      .prepare('PRAGMA table_info(servicios)')
      .all()
      .map((c) => c.name)
      .join(', ');
    db.pragma('foreign_keys = OFF');
    // Sin esto, el RENAME es una trampa: SQLite moderno «ayuda» reescribiendo
    // las referencias de las demás tablas para que apunten a servicios_previo,
    // y al borrarla quedan trescientas llaves colgando de una tabla que ya no
    // existe. En modo antiguo el RENAME solo renombra, que es lo que se quiere.
    db.pragma('legacy_alter_table = ON');
    db.transaction(() => {
      db.exec('ALTER TABLE servicios RENAME TO servicios_previo');
      for (const i of db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='servicios_previo' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        db.exec(`DROP INDEX IF EXISTS ${i.name}`);
      }
      db.exec(schema);
      db.exec(`INSERT INTO servicios (${columnas}) SELECT ${columnas} FROM servicios_previo`);
      db.exec('DROP TABLE servicios_previo');
    })();
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');

    const rotas = db.pragma('foreign_key_check');
    if (rotas.length) {
      throw new Error(
        `La migración de servicios dejó ${rotas.length} referencias rotas. La base quedó como estaba; revisa antes de seguir.`
      );
    }
  }

  // ---------------------------------------------------------- datos que venían mal
  //
  // Tres arreglos de una vez, sobre movimientos que todavía no se aplican. Los
  // tres vienen de la hoja de aperturas y ninguno se puede resolver «mejorando
  // la captura»: el dato ya está escrito.
  //
  // 1. La zona CENTRO en 2026. La operación dejó de usarla en septiembre de
  //    2024 —el último corte con esa zona es 2024-09— pero la hoja de agosto la
  //    trae en GRANATE POLANCO, GRANATE ANZURES y MUSEO SIMI. Confirmado con
  //    operación: los tres son SUR. Solo se tocan los de 2026 y solo mientras
  //    estén pendientes: los seis de 2023 y 2024 se quedan como están, porque
  //    entonces CENTRO sí existía y reescribirlos sería falsear el histórico.
  db.exec(
    `UPDATE aperturas SET zona = 'SUR'
      WHERE zona = 'CENTRO' AND servicio_id IS NULL AND periodo >= '2026-01'`
  );

  // 2 y 3. El uniforme y el REPSE, en 2026 y nada más.
  //
  //    La hoja escribe «REPSE BÁSICO» y «Repse Basico» donde el nombre interno
  //    es «BÁSICO»: la etiqueta del campo ya dice de qué se habla, y con el
  //    prefijo el valor no coincide con el catálogo, así que cada apertura
  //    salía marcada como si trajera algo desconocido. Lo mismo con «Traje» y
  //    «TRAJE», que son el mismo valor escrito distinto.
  //
  //    Solo 2026. Los años anteriores traen cosas que no se pueden normalizar
  //    sin decidir por alguien —«SI (BASICO)», «SI, BASICO», «SI», «NO», y en
  //    un renglón un «10000» que era de otra columna— y además son el registro
  //    de cómo se capturó entonces. Un corte viejo no se reescribe para que se
  //    vea ordenado.
  const ANIO = "periodo >= '2026-01'";
  db.exec(
    `UPDATE aperturas SET tipo_repse = TRIM(SUBSTR(TRIM(tipo_repse), 6))
      WHERE ${ANIO} AND tipo_repse IS NOT NULL AND UPPER(TRIM(tipo_repse)) LIKE 'REPSE %'`
  );
  for (const col of ['uniforme', 'tipo_repse']) {
    db.exec(
      `UPDATE aperturas SET ${col} = UPPER(TRIM(${col}))
        WHERE ${ANIO} AND ${col} IS NOT NULL AND ${col} <> UPPER(TRIM(${col}))`
    );
  }
  //    Y el acento: SQLite sube a mayúsculas solo el ASCII, así que «Basico» y
  //    «BÁSICO» seguían siendo dos. Los pocos términos con tilde se nombran.
  for (const [sin, con] of [['BASICO', 'BÁSICO'], ['BáSICO', 'BÁSICO']]) {
    db.prepare(`UPDATE aperturas SET tipo_repse = ? WHERE ${ANIO} AND UPPER(TRIM(tipo_repse)) = UPPER(?)`).run(con, sin);
  }

  // `usuarios.rol` aceptaba cinco roles y ahora acepta también al espectador.
  // Misma historia que arriba: cambiar un CHECK obliga a rehacer la tabla. Esta
  // es chica y no la referencia nadie con ON DELETE, pero el orden es el mismo.
  const defUsuarios = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
  if (defUsuarios && !defUsuarios.sql.includes('espectador')) {
    const columnas = db
      .prepare('PRAGMA table_info(usuarios)')
      .all()
      .map((c) => c.name)
      .join(', ');
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    db.transaction(() => {
      db.exec('ALTER TABLE usuarios RENAME TO usuarios_previo');
      db.exec(schema);
      db.exec(`INSERT INTO usuarios (${columnas}) SELECT ${columnas} FROM usuarios_previo`);
      db.exec('DROP TABLE usuarios_previo');
    })();
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }

  // `catalogos` nació aceptando tres tipos y ahora acepta también las formas de
  // pago. SQLite no sabe cambiar un CHECK en su sitio, así que la tabla se
  // rehace y se copia. Se reconstruye desde el mismo schema.sql para no tener
  // el DDL escrito en dos lugares que puedan separarse.
  // Mismo cuidado que en `servicios`: la lista de centinelas crece con el CHECK.
  const def = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalogos'").get();
  if (def && !['puesto', 'uniforme'].every((p) => def.sql.includes(p))) {
    db.transaction(() => {
      db.exec('ALTER TABLE catalogos RENAME TO catalogos_previo');
      // el índice sigue a la tabla al renombrarla y dejaría sin crear el nuevo
      db.exec('DROP INDEX IF EXISTS idx_catalogos_tipo');
      db.exec(schema);
      db.exec(
        `INSERT INTO catalogos (id, tipo, valor, orden, activo, creado_en)
         SELECT id, tipo, valor, orden, activo, creado_en FROM catalogos_previo`
      );
      db.exec('DROP TABLE catalogos_previo');
    })();
  }
}

/** Registra un movimiento en la bitácora. */
export function auditar(db, { usuario, accion, entidad, entidad_id, detalle, cambios }) {
  db.prepare(
    `INSERT INTO bitacora (usuario_id, usuario, rol, accion, entidad, entidad_id, detalle, cambios)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    usuario?.id ?? null,
    usuario?.nombre ?? 'sistema',
    usuario?.rol ?? 'sistema',
    accion,
    entidad,
    entidad_id ?? null,
    detalle ?? null,
    cambios ? JSON.stringify(cambios) : null
  );
}

/** Folio incremental por tipo: AP-2026-0001 / CA-2026-0001 */
export function siguienteFolio(db, tabla, prefijo) {
  const anio = anioActual();
  const like = `${prefijo}-${anio}-%`;
  const row = db.prepare(`SELECT folio FROM ${tabla} WHERE folio LIKE ? ORDER BY folio DESC LIMIT 1`).get(like);
  const n = row ? parseInt(row.folio.split('-')[2], 10) + 1 : 1;
  return `${prefijo}-${anio}-${String(n).padStart(4, '0')}`;
}
