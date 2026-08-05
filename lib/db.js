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

  // `catalogos` nació aceptando tres tipos y ahora acepta también las formas de
  // pago. SQLite no sabe cambiar un CHECK en su sitio, así que la tabla se
  // rehace y se copia. Se reconstruye desde el mismo schema.sql para no tener
  // el DDL escrito en dos lugares que puedan separarse.
  const def = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalogos'").get();
  if (def && !def.sql.includes('forma_pago')) {
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
