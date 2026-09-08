import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { anioActual } from './fechas';
import { arrancarAgenda } from './agenda';
import { vigilar } from './vigilante';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');

/**
 * Jornadas y zonas que la operación trabaja y el catálogo no ofrecía.
 *
 * Van escritas aquí, y no importadas de `lib/catalogos.js`, por la misma razón
 * que los niveles de REPSE: la siembra de allá solo corre cuando un tipo no
 * tiene ni una opción, o sea nunca en la base que ya lleva meses en uso. Estas
 * listas son las de la migración; `TURNOS_BASE` sigue siendo la de una
 * instalación nueva, y las dos tienen que decir lo mismo.
 */
const JORNADAS_QUE_FALTABAN = ['48X48', '12X12 L-J', '12X12 V-D', '10X14 L-S', '10X14 L-V'];
const ZONAS_QUE_FALTABAN = ['TOLUCA', 'STAFF', 'CUBRE DESCANSOS'];

/** Espejo de MOTIVOS_BAJA_BASE, por la misma razón de orden de arranque. */
const MOTIVOS_BAJA = [
  'FIN DE CONTRATO',
  'FIN DE SERVICIO O PROYECTO',
  'CIERRE DE INSTALACIÓN O SUCURSAL',
  'CAMBIO DE UBICACIÓN',
  'PRESUPUESTO DEL CLIENTE',
  'NO ACEPTA INCREMENTO DE PRECIO',
  'REDUCCIÓN DE PLANTILLA',
  'FALLAS DE COBERTURA',
  'INCONFORMIDAD CON EL SERVICIO',
  'CAMBIO DE PROVEEDOR O LICITACIÓN',
  'CAMBIO DE ADMINISTRACIÓN',
  'SEGURIDAD ELECTRÓNICA',
  'SEGURIDAD DEL PERSONAL',
  'FALTA DE PAGO',
  'CANCELACIÓN POR ULTRA',
  'OTRO',
];

/**
 * A cuál de los dieciséis motivos corresponde un texto escrito a mano.
 *
 * Las reglas salieron de leer los 125 textos que hay, no de imaginar cómo se
 * escribe una cancelación. Por eso hay faltas de ortografía dentro de los
 * patrones —«Inconcistencias», «LLLAMADA DE EXTORCIÓN»—: están en los datos, y
 * un patrón que solo reconoce la palabra bien escrita deja fuera justo el
 * renglón que se quería rescatar.
 *
 * El orden importa y es de más específico a más general. «No acepta incremento
 * y hay inconformidad con el servicio» cae en el incremento porque es el que
 * decidió la salida; si «inconformidad» fuera antes, se llevaría casos que no
 * le tocan.
 *
 * Lo que no reconoce va a OTRO y conserva su texto. Es deliberado: forzar cada
 * renglón dentro de una de las dieciséis daría un reporte completo y falso, y
 * un motivo inventado pesa igual que uno real a la hora de decidir dónde
 * invertir.
 */
const REGLAS_MOTIVO = [
  [/extorsi[oó]n|extorci[oó]n|caja fuerte/i, 'SEGURIDAD DEL PERSONAL'],
  [/seguridad electr[oó]nica/i, 'SEGURIDAD ELECTRÓNICA'],
  [/licitaci[oó]n|propia seguridad|proveedor de seguridad|arrendador les proporcionar|hacer el cambio/i, 'CAMBIO DE PROVEEDOR O LICITACIÓN'],
  [/cambio de administraci[oó]n|cond[oó]minos/i, 'CAMBIO DE ADMINISTRACIÓN'],
  [/incremento|aumento de precio|12 mil/i, 'NO ACEPTA INCREMENTO DE PRECIO'],
  [/falta de pago|demora en pagos|retraso por parte del cliente en pagos/i, 'FALTA DE PAGO'],
  [/cobertura|cubrir plantila|cubrieron nunca las vacantes|rotaci[oó]n en plantilla/i, 'FALLAS DE COBERTURA'],
  [/inconformidad|inconcistencia|inconsistencia|mal servicio|fallas operativas|mal perfil|mejora de perfil|actitud del guardia|deficiencia en servicio|atenci[oó]n al cliente|seguimiento a consignas|temas operativos|incumplimiento con informaci[oó]n|cambio de consignas/i, 'INCONFORMIDAD CON EL SERVICIO'],
  [/cancelacion por parte de ultra|cliente problem[aá]tico/i, 'CANCELACIÓN POR ULTRA'],
  [/presupuesto|falta de recursos|liquidez|disminuci[oó]n de operaci[oó]n/i, 'PRESUPUESTO DEL CLIENTE'],
  [/cambio de ubicaci[oó]n|cambio de instalaci[oó]n|cambia de ubicaci[oó]n|se monta en/i, 'CAMBIO DE UBICACIÓN'],
  [/cierre (?:de )?(?:sucursal|instalaci|presupuesto)|cierre sucursal|deja de operar|suspenden actividades|desalojo|renta de instal|retirar el servicio|actividad laboral/i, 'CIERRE DE INSTALACIÓN O SUCURSAL'],
  [/reducci[oó]n|se reduce|modificaci[oó]n de cobertura|cambio de turnos en plantilla|quitar esa sucursal|retir(?:o de (?:esa |servicio)|ar servicio)/i, 'REDUCCIÓN DE PLANTILLA'],
  [/contrato|renovaci[oó]n|renueva/i, 'FIN DE CONTRATO'],
  [/fin de|finaliza|t[eé]rmino|termino|termina|conclusi[oó]n|temporada|proyecto|remodelaci[oó]n|suspension de trabajos|servicio temporal/i, 'FIN DE SERVICIO O PROYECTO'],
];

function clasificarMotivo(texto) {
  const t = String(texto || '');
  for (const [re, motivo] of REGLAS_MOTIVO) if (re.test(t)) return motivo;
  return 'OTRO';
}

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
  // Y antes el vigilante, que no cambia lo que hace el servidor: solo deja
  // escrito en la bitácora qué pasó y cuánta memoria había si el proceso se
  // muere o si alguien pide el cierre. Va aquí porque es el punto por el que
  // pasa todo lo que toca la base —o sea todo el servidor— y esta aplicación no
  // tiene un arranque propio donde ponerlo.
  vigilar();
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
  ['facturas', 'guardias', 'INTEGER'],
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
  ['cancelaciones', 'motivo_detalle', 'TEXT'],
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
  // Tres arreglos de una vez. Los tres vienen de la hoja de aperturas y ninguno
  // se puede resolver «mejorando la captura»: el dato ya está escrito.
  //
  // 1. La zona CENTRO en 2026. La operación dejó de usarla en septiembre de
  //    2024 —el último corte con esa zona es 2024-09— pero la hoja de agosto la
  //    trae en GRANATE POLANCO, GRANATE ANZURES y MUSEO SIMI. Confirmado con
  //    operación: los tres son SUR. Solo se tocan los de 2026: los seis de 2023
  //    y 2024 se quedan como están, porque entonces CENTRO sí existía y
  //    reescribirlos sería falsear el histórico.
  //
  //    Y se arregla en los dos lados. La primera versión de esto solo tocaba las
  //    aperturas PENDIENTES, y falló por donde tenía que fallar: en cuanto se
  //    aplicaron, el servicio nació con «Centro» y ahí se quedó, porque el
  //    movimiento ya tenía servicio_id y quedaba fuera del filtro. Un arreglo
  //    que solo alcanza al dato mientras nadie lo usa no es un arreglo.
  db.exec(`UPDATE aperturas SET zona = 'SUR' WHERE zona = 'CENTRO' AND periodo >= '2026-01'`);

  //    En `servicios` no hay fecha de periodo, así que el corte es la fecha de
  //    alta. No hay riesgo de pasarse: hoy ningún servicio vivo usa CENTRO
  //    —solo NORTE, SUR y ALPURA—, de modo que los únicos con esa zona son los
  //    que nacieron de estas aperturas.
  db.exec(
    `UPDATE servicios SET zona = 'SUR', actualizado_en = datetime('now')
      WHERE zona = 'CENTRO' AND fecha_alta >= '2026-01-01'`
  );

  // 2. El REPSE, escrito de quince maneras y preguntado con más detalle del que
  //    hacía falta.
  //
  //    Aquí sí se toca todo el histórico, y la diferencia con el punto anterior
  //    es la que importa: CENTRO era otra cosa —una zona que existía y dejó de
  //    existir—, mientras que «SI (BASICO)», «Repse Basico», «Básico» y «REPSE
  //    BÁSICO» son el MISMO dato escrito mal cuatro veces. Uniformar la
  //    ortografía no reescribe ningún hecho; dejarla partida sí impide contar.
  //
  //    El campo arrancó pidiendo el nivel —básico, plus, plus +, no requiere—
  //    porque así viene en la hoja. Se cambió a la pregunta que de verdad se
  //    usa: si el servicio tiene REPSE o no. El nivel se sigue leyendo bien
  //    desde el archivo original; lo que no se sostenía era pedirlo cada vez en
  //    la captura para que después nadie lo consultara.
  //
  //    Queda fuera «0», que es de verdad ambiguo: no se sabe si quiso decir «no»
  //    o si es basura de una columna corrida. Se queda como está y la plataforma
  //    lo marca fuera de catálogo para que alguien lo decida. «SI» sí se
  //    resuelve ahora: antes no se sabía QUÉ nivel era, pero para la pregunta
  //    nueva basta con que diga que sí.
  const REPSE = [
    [/^(?:REPSE\s+)?B[ÁA]SICO$/i, 'SÍ'],
    [/^SI[\s,(]+B[ÁA]SICO\)?$/i, 'SÍ'],
    [/^(?:REPSE\s+)?PLUS\s*\+?$/i, 'SÍ'],
    [/^SI[\s,(]+PLUS\)?$/i, 'SÍ'],
    [/^S[ÍI]$/i, 'SÍ'],
    [/^(?:SIN\s+REPSE|NO(?:\s+REQUIERE(?:\s+REPSE)?)?)$/i, 'NO'],
  ];
  for (const tabla of ['aperturas', 'servicios']) {
    const set = db.prepare(`UPDATE ${tabla} SET tipo_repse = ? WHERE id = ?`);
    for (const f of db.prepare(`SELECT id, tipo_repse FROM ${tabla} WHERE tipo_repse IS NOT NULL`).all()) {
      const v = String(f.tipo_repse).replace(/\s+/g, ' ').trim();
      const nuevo = REPSE.find(([re]) => re.test(v));
      if (nuevo && nuevo[1] !== f.tipo_repse) set.run(nuevo[1], f.id);
    }
  }

  //    Y el catálogo. Las dos respuestas se dan de alta y los cuatro niveles se
  //    desactivan en vez de borrarse: así dejan de ofrecerse al capturar y
  //    siguen explicando cualquier renglón viejo que todavía los traiga.
  //
  //    Son las dos únicas respuestas y no es una lista que crezca. Por eso esto
  //    no mira lo ya capturado, a diferencia de la siembra de zona o supervisor:
  //    ahí el catálogo se arma con lo que la operación viene usando; aquí la
  //    pregunta tiene respuesta cerrada, y un valor que no sea uno de los dos no
  //    es una opción que faltaba sino un dato mal escrito.
  //
  //    Estados son tres, no dos: sí, no, y sin capturar. El vacío sale en ámbar
  //    en el estado de fuerza; decir «no» de un servicio que nadie ha revisado
  //    sería inventar una respuesta.
  //
  //    Todo esto va aquí y no en la siembra normal del catálogo por una razón de
  //    orden: aquella solo corre cuando el tipo no tiene ni una opción, y para
  //    entonces la primera línea de abajo ya lo dejó con dos. Ponerlo allá
  //    dejaba los niveles retirados fuera de toda base nueva.
  db.exec(`INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES ('tipo_repse','SÍ',0),('tipo_repse','NO',1)`);
  const nivel = db.prepare(`INSERT OR IGNORE INTO catalogos (tipo, valor, orden, activo) VALUES ('tipo_repse',?,0,0)`);
  for (const v of ['BÁSICO', 'PLUS', 'PLUS +', 'NO REQUIERE REPSE']) nivel.run(v);
  db.exec(`UPDATE catalogos SET activo = 0 WHERE tipo = 'tipo_repse' AND valor NOT IN ('SÍ','NO')`);

  // 2.b Las jornadas que faltaban, y las zonas nuevas.
  //
  //     Vienen de una revisión de la operación: la lista de jornadas estaba
  //     incompleta —faltan siete de las que sí se trabajan— y a las zonas les
  //     faltan Toluca, Staff y Cubre descansos.
  //
  //     Va aquí y no en la siembra del catálogo por la misma razón que el REPSE:
  //     aquella solo corre cuando el tipo no tiene NI UNA opción, así que en una
  //     base que ya lleva meses operando no volvería a pasar nunca y estos
  //     valores no llegarían jamás a donde hacen falta, que es justo el
  //     servidor que ya está en uso.
  //
  //     `INSERT OR IGNORE` es lo que lo hace repetible: lo que ya está se queda
  //     como está —incluso si el administrador lo desactivó a propósito— y solo
  //     entra lo que falta.
  //
  //     Y solo se toca un tipo que YA tenga opciones. Esa condición no es un
  //     detalle: sin ella, esto le mete tres zonas a una base recién instalada,
  //     la siembra ve que el tipo «ya tiene opciones» y se salta las suyas, y la
  //     instalación arranca con tres zonas en vez de las de la operación. Pasó
  //     al escribir esto. En una base nueva no hace falta nada de esto, porque
  //     las listas de `lib/catalogos.js` ya traen estos valores.
  const cuantas = db.prepare('SELECT COUNT(*) AS n FROM catalogos WHERE tipo = ?');
  const yaTiene = (tipo) => cuantas.get(tipo).n > 0;

  if (yaTiene('turno')) {
    const jornada = db.prepare(`INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES ('turno',?,?)`);
    for (const [i, v] of JORNADAS_QUE_FALTABAN.entries()) jornada.run(v, 100 + i);
  }
  if (yaTiene('zona')) {
    const zonaNueva = db.prepare(`INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES ('zona',?,0)`);
    for (const v of ZONAS_QUE_FALTABAN) zonaNueva.run(v);
  }

  // 2.c Los motivos de cancelación, de texto libre a lista.
  //
  //     Se escribían a mano y salieron 125 textos distintos para 330
  //     cancelaciones, más 127 sin motivo. «FIN DE SERVICIO», «FIN DE
  //     CONTRATO», «TERMINO DE SERVICIO» y «CIERRE DE SERVICIO» son el mismo
  //     hecho escrito de cuatro formas: separados en cuatro renglones de un
  //     guion bajo no se pueden sumar, y sumarlos es exactamente para lo que
  //     sirve preguntar el motivo.
  //
  //     Lo escrito NO se tira. Se mueve entero a `motivo_detalle` —ahí vive lo
  //     que ninguna lista puede prever: que el pago quedaba para el viernes, que
  //     la ubicación tenía problemas fiscales— y en `motivo` queda la respuesta
  //     de la lista. Tirar el texto para «dejarlo limpio» sería cambiar dato por
  //     orden, y el dato no se puede recuperar.
  //
  //     Lo que no se reconoce va a OTRO, con su texto intacto al lado. Es la
  //     respuesta honesta: marcar a ojo lo que no encaja en ninguna de las
  //     dieciséis sería inventarle una razón a una pérdida real.
  //
  //     Antes que nada, el CHECK de `catalogos.tipo`, que enumera los tipos
  //     permitidos y no conocía este. Cambiar un CHECK obliga a rehacer la
  //     tabla; saltárselo no da un error visible, que es lo peor que podía
  //     pasar: las siembras usan `INSERT OR IGNORE`, así que cada fila del tipo
  //     nuevo se descartaba en silencio. El catálogo quedaba vacío y la captura
  //     rechazaba todos los motivos por «no están en el catálogo», sin nada en
  //     ningún lado que explicara el porqué. Costó una tarde encontrarlo.
  const defCatalogos = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalogos'").get();
  if (defCatalogos && !defCatalogos.sql.includes('motivo_baja')) {
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    const columnas = db
      .prepare('PRAGMA table_info(catalogos)')
      .all()
      .map((c) => c.name)
      .join(', ');
    db.transaction(() => {
      db.exec('ALTER TABLE catalogos RENAME TO catalogos_previo');
      // El esquema entero: todo lo demás lleva IF NOT EXISTS, así que lo único
      // que crea es la tabla que se acaba de renombrar.
      db.exec(schema);
      db.exec(`INSERT INTO catalogos (${columnas}) SELECT ${columnas} FROM catalogos_previo`);
      db.exec('DROP TABLE catalogos_previo');
    })();
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
    const mal = db.pragma('foreign_key_check');
    if (mal.length) throw new Error(`La reconstrucción de catálogos dejó referencias rotas: ${JSON.stringify(mal)}`);
  }

  if (db.prepare(`SELECT COUNT(*) AS n FROM catalogos WHERE tipo = 'motivo_baja'`).get().n === 0) {
    const m = db.prepare(`INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES ('motivo_baja',?,?)`);
    MOTIVOS_BAJA.forEach((v, i) => m.run(v, i));
  }

  const porClasificar = db
    .prepare(`SELECT id, motivo FROM cancelaciones
               WHERE TRIM(COALESCE(motivo,'')) <> '' AND motivo_detalle IS NULL
                 AND motivo NOT IN (SELECT valor FROM catalogos WHERE tipo = 'motivo_baja')`)
    .all();
  if (porClasificar.length) {
    const guardar = db.prepare('UPDATE cancelaciones SET motivo = ?, motivo_detalle = ? WHERE id = ?');
    db.transaction(() => {
      for (const c of porClasificar) guardar.run(clasificarMotivo(c.motivo), c.motivo, c.id);
    })();
  }

  // 3. El uniforme, en la caja del catálogo. «Traje» y «TRAJE» son el mismo
  //    valor; dejar las dos formas conviviendo es como se llega a tener seis
  //    supervisores partidos en doce renglones. UPPER de SQLite solo sube el
  //    ASCII, así que va por JavaScript.
  const uni = db.prepare('UPDATE aperturas SET uniforme = ? WHERE id = ?');
  for (const f of db.prepare('SELECT id, uniforme FROM aperturas WHERE uniforme IS NOT NULL').all()) {
    const v = String(f.uniforme).replace(/\s+/g, ' ').trim().toUpperCase();
    if (v && v !== f.uniforme) uni.run(v, f.id);
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

  /**
   * `facturas` traía UNIQUE (servicio_id, periodo, concepto), y eso impedía el
   * caso real: clientes a los que se les factura por sede o por centro de
   * costos y reciben dos, tres o cuatro facturas del mismo mes de servicio. La
   * primera cerraba el mes y las demás rebotaban con un error del motor.
   *
   * Quitar una restricción de tabla obliga a rehacerla, igual que un CHECK.
   * Aquí hay un cuidado extra que no tenían las de arriba: `pagos` referencia
   * `facturas(id)` con ON DELETE CASCADE, así que el DROP de la tabla vieja va
   * con las llaves apagadas —si no, se llevaría los pagos por delante— y al
   * final se comprueba que no quedó ninguna referencia colgando.
   */
  const defFacturas = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='facturas'").get();
  if (defFacturas && defFacturas.sql.includes('UNIQUE (servicio_id, periodo, concepto)')) {
    const columnas = db
      .prepare('PRAGMA table_info(facturas)')
      .all()
      .map((c) => c.name)
      .join(', ');
    const antes = db.prepare('SELECT COUNT(*) n FROM facturas').get().n;
    const pagosAntes = db.prepare('SELECT COUNT(*) n FROM pagos').get().n;

    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    db.transaction(() => {
      db.exec('ALTER TABLE facturas RENAME TO facturas_previo');
      for (const i of db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='facturas_previo' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        db.exec(`DROP INDEX IF EXISTS ${i.name}`);
      }
      db.exec(schema);
      db.exec(`INSERT INTO facturas (${columnas}) SELECT ${columnas} FROM facturas_previo`);
      db.exec('DROP TABLE facturas_previo');
    })();
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');

    const despues = db.prepare('SELECT COUNT(*) n FROM facturas').get().n;
    const pagosDespues = db.prepare('SELECT COUNT(*) n FROM pagos').get().n;
    const rotas = db.pragma('foreign_key_check');
    if (despues !== antes || pagosDespues !== pagosAntes || rotas.length) {
      throw new Error(
        `La migración de facturas no cuadró: ${antes}→${despues} facturas, ${pagosAntes}→${pagosDespues} pagos, ` +
          `${rotas.length} referencias rotas. Revisa antes de seguir.`
      );
    }
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
