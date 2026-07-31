-- Ultra Seguridad Privada — Plataforma de Guardias
-- Regla de negocio central:
--   Un servicio SOLO entra al estado de fuerza mediante una APERTURA
--   y SOLO sale mediante una CANCELACION. No hay alta/baja manual.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('admin','juridico','finanzas','operaciones','ventas')),
  password_hash TEXT NOT NULL,
  activo        INTEGER NOT NULL DEFAULT 1,

  -- La contraseña la pone quien da de alta al usuario, así que nace prestada.
  -- Con esta bandera en 1 la aplicación lleva a "Mi cuenta" y no deja pasar a
  -- otra pantalla hasta que la persona ponga una suya.
  debe_cambiar_password INTEGER NOT NULL DEFAULT 0,

  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- servicios
-- El estado de fuerza. Filas creadas exclusivamente por el flujo de apertura.
CREATE TABLE IF NOT EXISTS servicios (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio                   TEXT NOT NULL,
  razon_social               TEXT,
  direccion                  TEXT,
  zona                       TEXT,
  tipo                       TEXT,
  cluster                    TEXT,
  estado_geo                 TEXT,
  supervisor                 TEXT,
  asesor                     TEXT,
  gerente                    TEXT,

  -- estado de fuerza
  estatus                    TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estatus IN ('ACTIVO','BAJA')),
  total_guardias             INTEGER NOT NULL DEFAULT 0,
  turnos_json                TEXT NOT NULL DEFAULT '{}',
  precio_guardia             REAL,
  sueldo_base                REAL,
  bono                       REAL,
  uniforme                   TEXT,
  tipo_repse                 TEXT,
  observaciones              TEXT,
  mes_incremento             TEXT,
  anio_ultimo_incremento     TEXT,

  -- bloque FINANZAS (editable por finanzas y admin)
  guardias_en_factura        INTEGER,
  importe_factura            REAL,
  importe_sin_iva            REAL,
  nomina_total               REAL,
  nomina_prestaciones        REAL,
  resultado_servicio         REAL,
  pct_utilidad               REAL,
  utilidad_bruta             REAL,
  facturado                  INTEGER NOT NULL DEFAULT 0,
  status_cobranza            TEXT,
  fecha_pago                 TEXT,
  forma_pago                 TEXT,
  cobro                      TEXT,
  credito_maximo             REAL,
  dias_credito               INTEGER,
  importe_pendiente          REAL,
  saldo_vencido              REAL,

  -- bloque JURIDICO (editable por juridico y admin)
  tiene_contrato             INTEGER NOT NULL DEFAULT 0,
  fecha_contrato             TEXT,
  fecha_vencimiento_contrato TEXT,
  condiciones_comerciales    TEXT,
  comentarios_contrato       TEXT,

  -- trazabilidad
  apertura_id                INTEGER REFERENCES aperturas(id),
  cancelacion_id             INTEGER REFERENCES cancelaciones(id),
  fecha_alta                 TEXT,
  fecha_baja                 TEXT,
  creado_en                  TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compuesto a propósito: la pantalla siempre filtra por estatus y ordena por
-- nombre, así el índice resuelve las dos cosas y no hace falta ordenar aparte.
CREATE INDEX IF NOT EXISTS idx_servicios_estatus ON servicios(estatus, servicio);
CREATE INDEX IF NOT EXISTS idx_servicios_zona    ON servicios(zona);
CREATE INDEX IF NOT EXISTS idx_servicios_asesor  ON servicios(asesor);
CREATE INDEX IF NOT EXISTS idx_servicios_nombre  ON servicios(servicio);

-- ---------------------------------------------------------------- aperturas
CREATE TABLE IF NOT EXISTS aperturas (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  folio              TEXT NOT NULL UNIQUE,
  tipo               TEXT NOT NULL DEFAULT 'APERTURA' CHECK (tipo IN ('APERTURA','INCREMENTO','TEMPORAL')),
  servicio           TEXT NOT NULL,
  razon_social       TEXT,
  direccion          TEXT,
  zona               TEXT,
  cluster            TEXT,
  estado_geo         TEXT,
  asesor             TEXT,
  gerente            TEXT,
  reporta            TEXT,
  guardias           INTEGER NOT NULL DEFAULT 0,
  turnos_json        TEXT NOT NULL DEFAULT '{}',
  fecha              TEXT,
  periodo            TEXT,
  precio_guardia     REAL,
  sueldo_base        REAL,
  bono               REAL,
  uniforme           TEXT,
  credito_autorizado INTEGER,
  credito_plazo      TEXT,
  forma_pago         TEXT,
  cobro              TEXT,
  tipo_repse         TEXT,
  comentarios        TEXT,
  aut_json           TEXT NOT NULL DEFAULT '{}',
  -- 1 = alta técnica de la carga inicial del Estado de Fuerza, no un movimiento
  -- real del mes; se excluye de las gráficas de aperturas vs cancelaciones.
  carga_inicial      INTEGER NOT NULL DEFAULT 0,
  -- servicio_id destino: nuevo servicio (APERTURA) o existente (INCREMENTO)
  servicio_id        INTEGER REFERENCES servicios(id),
  creado_por         INTEGER REFERENCES usuarios(id),
  creado_en          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aperturas_periodo ON aperturas(periodo);
CREATE INDEX IF NOT EXISTS idx_aperturas_fecha   ON aperturas(fecha);

-- ------------------------------------------------------------- cancelaciones
CREATE TABLE IF NOT EXISTS cancelaciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  folio           TEXT NOT NULL UNIQUE,
  tipo            TEXT NOT NULL DEFAULT 'CANCELACION' CHECK (tipo IN ('CANCELACION','REDUCCION')),
  servicio        TEXT NOT NULL,
  servicio_id     INTEGER REFERENCES servicios(id),
  guardias        INTEGER NOT NULL DEFAULT 0,
  turnos_json     TEXT NOT NULL DEFAULT '{}',
  fecha           TEXT,
  periodo         TEXT,
  zona            TEXT,
  asesor          TEXT,
  motivo          TEXT,
  reporta         TEXT,
  auditoria       TEXT,
  cxc             REAL,
  aut_json        TEXT NOT NULL DEFAULT '{}',
  creado_por      INTEGER REFERENCES usuarios(id),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cancelaciones_periodo ON cancelaciones(periodo);
CREATE INDEX IF NOT EXISTS idx_cancelaciones_fecha   ON cancelaciones(fecha);

-- ----------------------------------------------------------------- bitacora
CREATE TABLE IF NOT EXISTS bitacora (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER REFERENCES usuarios(id),
  usuario     TEXT,
  rol         TEXT,
  accion      TEXT NOT NULL,
  entidad     TEXT NOT NULL,
  entidad_id  INTEGER,
  detalle     TEXT,
  cambios     TEXT,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bitacora_creado  ON bitacora(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_bitacora_entidad ON bitacora(entidad, entidad_id);

-- ------------------------------------------------------------------ sesiones
CREATE TABLE IF NOT EXISTS sesiones (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  expira_en  TEXT NOT NULL,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------- cortes mensuales (cierres)
-- Foto del Estado de Fuerza tal como quedó cada mes, importada del archivo.
-- Es el respaldo de facturación: un corte cerrado no se toca, ni siquiera el
-- admin, porque contra él se cobró. El mes vigente NO vive aquí: ese es la
-- tabla `servicios`, que sí cambia con aperturas y cancelaciones.
--
-- Sin UNIQUE(periodo, servicio) a propósito: la hoja repite un sitio cuando
-- tiene bloques de turnos o razones sociales distintas, y con la restricción
-- se perdían esos renglones en silencio.
CREATE TABLE IF NOT EXISTS snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  periodo        TEXT NOT NULL,
  servicio       TEXT NOT NULL,
  razon_social   TEXT,
  zona           TEXT,
  tipo           TEXT,
  supervisor     TEXT,
  asesor         TEXT,
  total_guardias INTEGER,
  turnos_json    TEXT NOT NULL DEFAULT '{}',

  -- facturación y cobranza del mes
  guardias_en_factura INTEGER,
  importe_factura     REAL,
  importe_sin_iva     REAL,
  factura_mensual     TEXT,
  nomina_total        REAL,
  nomina_prestaciones REAL,
  resultado_servicio  REAL,
  pct_utilidad        REAL,
  utilidad_bruta      REAL,
  status_cobranza     TEXT,
  fecha_pago          TEXT,
  importe_pendiente   REAL,
  saldo_vencido       REAL,
  credito_maximo      REAL,
  dias_credito        INTEGER,

  -- contrato vigente en ese corte
  tiene_contrato             INTEGER,
  fecha_contrato             TEXT,
  fecha_vencimiento_contrato TEXT,
  condiciones_comerciales    TEXT,

  observaciones  TEXT
);

-- Mismo motivo: un corte se pide entero y ordenado por servicio.
CREATE INDEX IF NOT EXISTS idx_snapshots_periodo ON snapshots(periodo, servicio);
CREATE INDEX IF NOT EXISTS idx_snapshots_servicio ON snapshots(servicio);

-- ------------------------------------------------------------- correcciones
-- La única vía por la que el estado de fuerza cambia sin un movimiento real.
--
-- Un alta o una baja de guardias se registra como apertura o cancelación: eso
-- describe algo que pasó en la calle. Una corrección es otra cosa: el dato
-- estaba mal capturado desde el principio —el nombre trae una falta, alguien
-- tecleó 12 en vez de 21, se canceló el servicio equivocado—. Meterlo como
-- movimiento inventaría altas y bajas que nunca ocurrieron y ensuciaría las
-- gráficas del mes y los cortes de facturación.
--
-- Por eso existe esta tabla y por eso solo el admin la alimenta: cada
-- corrección exige un motivo escrito y guarda el antes y el después campo por
-- campo, para que quede claro que fue un arreglo de captura y no un movimiento.
CREATE TABLE IF NOT EXISTS correcciones (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id      INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  servicio         TEXT NOT NULL,
  motivo           TEXT NOT NULL,
  cambios          TEXT NOT NULL,
  guardias_antes   INTEGER,
  guardias_despues INTEGER,
  usuario_id       INTEGER REFERENCES usuarios(id),
  usuario          TEXT NOT NULL,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_correcciones_servicio ON correcciones(servicio_id, id DESC);

-- ------------------------------------------------------- comentarios por servicio
-- Notas que el equipo se deja sobre un servicio: lo que no cabe en un campo.
-- Cualquier rol puede escribir —una nota no cambia el estado de fuerza— y
-- queda firmada con quién la escribió y cuándo.
--
-- El nombre y el rol se guardan copiados a propósito: si mañana esa persona
-- cambia de puesto o se da de baja, la nota debe seguir diciendo quién era
-- cuando la escribió.
CREATE TABLE IF NOT EXISTS comentarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  usuario_id  INTEGER REFERENCES usuarios(id),
  usuario     TEXT NOT NULL,
  rol         TEXT NOT NULL,
  texto       TEXT NOT NULL,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comentarios_servicio ON comentarios(servicio_id, id DESC);
