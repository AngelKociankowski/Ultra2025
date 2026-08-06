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
  rol           TEXT NOT NULL CHECK (rol IN ('admin','juridico','finanzas','operaciones','ventas','espectador')),
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
  -- ACTIVO     opera y cuenta en el estado de fuerza
  -- SUSPENDIDO existe, conserva su plantilla y su historia, pero no cuenta:
  --            el cliente paró el servicio y va a volver, o quedó en pausa.
  --            No es una baja, y por eso no lleva folio de cancelación ni
  --            aparece en las gráficas de bajas del mes.
  -- BAJA       se fue. Solo se llega aquí por una cancelación.
  estatus                    TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estatus IN ('ACTIVO','SUSPENDIDO','BAJA')),

  -- Si el servicio nació para quedarse o para terminar.
  --
  -- `aperturas.tipo` ya distinguía TEMPORAL desde el principio, pero esa marca
  -- se quedaba en el movimiento: una vez aplicado, el servicio temporal era
  -- indistinguible de uno fijo y se quedaba en el estado de fuerza para
  -- siempre, porque nadie sabía que tenía que salir. Aquí es donde esa
  -- diferencia sobrevive al movimiento que la creó.
  --
  -- FIJO     el que se contrata sin fecha de término
  -- TEMPORAL el que se abre por un periodo acordado y tiene que salir al final
  -- EVENTO   el de unos días: una feria, una asamblea, una mudanza
  modalidad                  TEXT NOT NULL DEFAULT 'FIJO' CHECK (modalidad IN ('FIJO','TEMPORAL','EVENTO')),
  -- Hasta cuándo se comprometió. Solo tiene sentido en los que no son fijos, y
  -- es lo que permite avisar antes de que se pase la fecha en lugar de
  -- descubrirlo al cuadrar la facturación tres meses después.
  fecha_fin_prevista         TEXT,
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
  forma_pago                 TEXT,
  cobro                      TEXT,
  credito_maximo             REAL,
  dias_credito               INTEGER,

  -- Cuándo se emite la factura del mes. De aquí sale la fecha de la factura y,
  -- con los días de crédito, la de vencimiento: el plazo no corre desde que se
  -- presta el servicio, sino desde que se factura.
  esquema_facturacion        TEXT,

  -- Estas tres las calcula el libro de facturas, no se capturan. Viven aquí
  -- copiadas para que el tablero, los filtros y el corte del mes no tengan que
  -- recorrer la cobranza entera cada vez que alguien abre una pantalla.
  fecha_pago                 TEXT,
  importe_pendiente          REAL,
  saldo_vencido              REAL,

  -- bloque JURIDICO (editable por juridico y admin)
  tiene_contrato             INTEGER NOT NULL DEFAULT 0,
  fecha_contrato             TEXT,
  fecha_vencimiento_contrato TEXT,
  condiciones_comerciales    TEXT,
  comentarios_contrato       TEXT,
  -- El PDF del contrato firmado. Vive en el disco junto a la base, igual que
  -- los CFDI: aquí solo queda el nombre con el que se guardó. «Sí tiene
  -- contrato» sin poder enseñarlo obliga a ir a buscarlo a un cajón, que es
  -- justo lo que esta plataforma existe para evitar.
  contrato_archivo           TEXT,
  contrato_archivo_nombre    TEXT,
  contrato_archivo_tipo      TEXT,
  contrato_archivo_bytes     INTEGER,
  contrato_archivo_subido_en TEXT,

  -- trazabilidad
  apertura_id                INTEGER REFERENCES aperturas(id),
  cancelacion_id             INTEGER REFERENCES cancelaciones(id),
  fecha_alta                 TEXT,
  fecha_baja                 TEXT,
  -- Desde cuándo está en pausa y por qué. Se limpian al reactivarlo.
  suspendido_desde           TEXT,
  suspendido_motivo          TEXT,
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
  supervisor         TEXT,
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
  credito_plazo      TEXT,               -- texto libre de las hojas viejas
  dias_credito       INTEGER,            -- el plazo capturado en la plataforma
  credito_maximo     REAL,
  esquema_facturacion TEXT,
  forma_pago         TEXT,
  cobro              TEXT,
  tipo_repse         TEXT,
  -- La modalidad con la que se abrió y hasta cuándo se comprometió. Viajan con
  -- el movimiento, no solo con el servicio: una apertura registrada hoy y
  -- aplicada en tres semanas tiene que seguir sabiendo que era temporal.
  modalidad          TEXT,
  fecha_fin_prevista TEXT,
  -- A qué hora arranca el servicio. Va en la hoja de aperturas y no se
  -- capturaba en ningún lado: para operación es el dato con el que se cita al
  -- personal el primer día.
  hora_apertura      TEXT,
  -- Los vehículos de custodia son su propia línea en la hoja: no son un turno
  -- —no llevan guardias— pero sí cuestan y hay que asignarlos.
  vehiculos_custodia INTEGER,
  -- Lo que se le entrega al servicio: chaleco, radio, lámparas, botas… Son
  -- dieciséis renglones en la hoja y se guardan como un objeto para no
  -- convertir la tabla en dieciséis columnas que casi siempre van en cero.
  equipo_json        TEXT NOT NULL DEFAULT '{}',
  comentarios        TEXT,
  aut_json           TEXT NOT NULL DEFAULT '{}',
  -- 1 = alta técnica de la carga inicial del Estado de Fuerza, no un movimiento
  -- real del mes; se excluye de las gráficas de aperturas vs cancelaciones.
  carga_inicial      INTEGER NOT NULL DEFAULT 0,
  -- 1 = anotada pero decidida a no aplicarse nunca: el servicio ya no opera, se
  -- capturó por error o quedó sin efecto. No se borra —el movimiento se anotó y
  -- eso es parte del histórico— pero deja de contarse como pendiente.
  descartada         INTEGER NOT NULL DEFAULT 0,
  descartada_motivo  TEXT,
  descartada_en      TEXT,
  descartada_por     INTEGER REFERENCES usuarios(id),
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

-- ------------------------------------------------------------------ facturas
-- El libro de cobranza: una fila por factura emitida.
--
-- Antes la cobranza vivía en tres campos sueltos del servicio (importe
-- pendiente, saldo vencido, ¿ya se pagó?). Eso alcanza para una foto, no para
-- un saldo: si a un cliente se le facturan tres meses y paga uno, un campo solo
-- no sabe cuál quedó a deber ni desde cuándo. Y un saldo tecleado a mano puede
-- contradecir a las facturas, que es la misma clase de error que el total de
-- guardias contra su desglose.
--
-- Por eso el saldo no se captura: se calcula. Finanzas registra la factura y
-- registra el pago; pendiente, vencido y por vencer salen de aquí.
--
-- La fecha de vencimiento se guarda calculada (fecha de factura + días de
-- crédito) y no se recalcula después: si mañana al servicio le cambian el
-- plazo, las facturas ya emitidas conservan el que tenían cuando se emitieron.
-- Esa es la condición que se pactó para ese cobro.
CREATE TABLE IF NOT EXISTS facturas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id       INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  periodo           TEXT NOT NULL,              -- mes de servicio que cubre (YYYY-MM)
  concepto          TEXT NOT NULL DEFAULT 'Mes completo',
  folio             TEXT,                       -- el folio fiscal, si ya se tiene
  fecha_factura     TEXT NOT NULL,
  dias_credito      INTEGER NOT NULL DEFAULT 0,
  fecha_vencimiento TEXT NOT NULL,
  importe           REAL NOT NULL,
  importe_pagado    REAL NOT NULL DEFAULT 0,
  fecha_pago        TEXT,                       -- la del último pago recibido
  forma_pago        TEXT,
  referencia        TEXT,

  -- Una factura mal registrada no se borra: se cancela con motivo y deja de
  -- contar para el saldo. Borrarla haría desaparecer el renglón que explica
  -- por qué el saldo era otro la semana pasada.
  cancelada         INTEGER NOT NULL DEFAULT 0,
  motivo_cancelacion TEXT,
  cancelada_por     TEXT,
  cancelada_en      TEXT,

  -- 1 = venía de antes de la plataforma y entró por la carga inicial, no se
  -- emitió aquí. Cuenta igual para el saldo —el cliente debe lo mismo— pero
  -- conviene poder distinguirla: es lo que separa lo que la plataforma vio
  -- suceder de lo que le contaron que ya había pasado.
  carga_inicial     INTEGER NOT NULL DEFAULT 0,

  -- El PDF (o el XML del CFDI) de la factura, guardado en el disco junto a la
  -- base. En la tabla solo va el nombre con el que se guardó y el que traía el
  -- archivo, para poder devolverlo llamándose como el usuario lo conoce.
  archivo           TEXT,
  archivo_nombre    TEXT,
  archivo_tipo      TEXT,
  archivo_bytes     INTEGER,

  creado_por        INTEGER REFERENCES usuarios(id),
  creado_en         TEXT NOT NULL DEFAULT (datetime('now')),

  -- Evita facturar dos veces el mismo tramo del mismo mes, que es justo lo que
  -- pasaría si alguien vuelve a pulsar «generar la facturación del mes».
  UNIQUE (servicio_id, periodo, concepto)
);

CREATE INDEX IF NOT EXISTS idx_facturas_servicio ON facturas(servicio_id, fecha_factura DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_periodo  ON facturas(periodo);
-- Las dos preguntas de cobranza —qué está vencido y qué está por vencer— se
-- resuelven con este índice sin recorrer el libro entero.
CREATE INDEX IF NOT EXISTS idx_facturas_saldo    ON facturas(cancelada, fecha_vencimiento);

CREATE TABLE IF NOT EXISTS pagos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id  INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  fecha       TEXT NOT NULL,
  importe     REAL NOT NULL,
  forma_pago  TEXT,
  referencia  TEXT,
  usuario_id  INTEGER REFERENCES usuarios(id),
  usuario     TEXT NOT NULL,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id, id DESC);

-- ------------------------------------------------------------------ catálogos
-- Las listas de las que se elige al capturar: zonas, asesores y turnos.
--
-- Antes eran texto libre con autocompletado, y el autocompletado solo sugiere:
-- no impide escribir. Así fue como el mismo asesor acabó capturado de tres
-- maneras y como una zona nació con una falta que ya nadie corrigió. Cuando eso
-- pasa, el tablero los cuenta como cosas distintas y el reparto por zona deja
-- de cuadrar.
--
-- Ahora la captura elige de esta tabla y solo el administrador la alimenta.
--
-- Las opciones que ya se usaron no se borran: se desactivan. Dejan de ofrecerse
-- en capturas nuevas sin cambiarle el dato a los servicios que ya las traen ni
-- a los cortes cerrados, que son el respaldo de facturación.
CREATE TABLE IF NOT EXISTS catalogos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo      TEXT NOT NULL CHECK (tipo IN ('zona','asesor','turno','forma_pago','puesto','gerente','supervisor','estado_geo','tipo_repse','uniforme')),
  valor     TEXT NOT NULL,
  -- Los turnos se ordenan como los lee la operación (8X16, 12X12, 24X48…), no
  -- alfabéticamente. Zonas y asesores se quedan en 0 y salen por nombre.
  orden     INTEGER NOT NULL DEFAULT 0,
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tipo, valor)
);

CREATE INDEX IF NOT EXISTS idx_catalogos_tipo ON catalogos(tipo, activo, orden, valor);

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

-- ---------------------------------------------------- historial de precios
-- Cada año se le sube el precio al cliente, y no a todos en el mismo mes: cada
-- servicio trae el suyo (`servicios.mes_incremento`) desde que se contrató.
--
-- Aquí queda el rastro de cada movimiento de precio: de cuánto a cuánto, desde
-- qué mes aplica, con qué criterio y quién lo hizo. Sin esto, dentro de un año
-- la única respuesta a «¿por qué este cliente paga esto?» sería el importe que
-- quedó en la ficha, que no explica nada.
--
-- El precio vigente sigue viviendo en `servicios` —es lo que se consulta mil
-- veces al día—; esta tabla es la memoria, no la fuente.
CREATE TABLE IF NOT EXISTS precios_historial (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id       INTEGER NOT NULL REFERENCES servicios(id),
  -- PORCENTAJE / MONTO / IMPORTE: cómo se pidió el cambio.
  -- MANUAL: alguien editó el importe desde la ficha del servicio.
  tipo              TEXT NOT NULL CHECK (tipo IN ('PORCENTAJE','MONTO','IMPORTE','MANUAL')),
  porcentaje        REAL,               -- el % efectivo, calculado siempre
  vigente_desde     TEXT,               -- AAAA-MM a partir del cual se cobra así
  motivo            TEXT,
  -- agrupa los renglones de una misma aplicación masiva
  lote              TEXT,
  importe_anterior  REAL,
  importe_nuevo     REAL,
  sin_iva_anterior  REAL,
  sin_iva_nuevo     REAL,
  precio_anterior   REAL,
  precio_nuevo      REAL,
  usuario_id        INTEGER REFERENCES usuarios(id),
  usuario           TEXT,
  creado_en         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_precios_servicio ON precios_historial(servicio_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_precios_lote ON precios_historial(lote);


-- ------------------------------------------------- precio por puesto y turno
-- En un servicio los guardias no cuestan lo mismo. Un jefe de servicio cuesta
-- más que un guardia raso, y el mismo puesto en 24 horas no vale lo que en
-- 12X12: son horas distintas y prestaciones distintas.
--
-- Un solo `servicios.precio_guardia` obligaba a promediar, y un promedio no
-- sirve para cotizar, ni para explicarle al cliente su factura, ni para subir
-- el precio de un puesto sin tocar los demás.
--
-- Cada renglón es una partida: tantos guardias de tal puesto en tal turno, a
-- tal precio. El importe mensual del servicio es la suma de sus partidas.
CREATE TABLE IF NOT EXISTS partidas_precio (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id     INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  puesto          TEXT NOT NULL,
  -- El turno es opcional: hay servicios que cobran igual sin importar el
  -- horario, y obligar a partirlos sería inventar un detalle que no existe.
  turno           TEXT,
  cantidad        INTEGER NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL DEFAULT 0,
  nota            TEXT,
  orden           INTEGER NOT NULL DEFAULT 0,
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_partidas_servicio ON partidas_precio(servicio_id, orden, id);
