#!/usr/bin/env node
/**
 * Carga data/seed.json (extraído de los dos archivos originales) a la base.
 *
 * El estado de fuerza arranca del corte vigente (meta.periodo_vigente) y cada
 * servicio entra con una APERTURA, respetando la regla del negocio.
 * Las aperturas y cancelaciones históricas se cargan como expediente: el corte
 * vigente ya refleja su resultado neto, así que no se reaplican.
 *
 *   node scripts/seed.mjs           # crea la base si no existe
 *   node scripts/seed.mjs --reset   # borra y reconstruye
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const raiz = process.cwd();
const RESET = process.argv.includes('--reset');
const DB_PATH = process.env.DATABASE_PATH || path.join(raiz, 'data', 'ultra.db');
const SEED_PATH = path.join(raiz, 'data', 'seed.json');

if (RESET) {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('· base anterior eliminada');
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(raiz, 'lib', 'schema.sql'), 'utf8'));

const yaCargado = db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n;
if (yaCargado > 0 && !RESET) {
  console.log(`· la base ya tiene ${yaCargado} servicios; usa --reset para reconstruir`);
  process.exit(0);
}

const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

// ------------------------------------------------------------------ usuarios

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

/**
 * El alta inicial crea UN solo usuario: el primer administrador. Los demás los
 * da de alta él desde Usuarios, con el rol que le corresponda a cada quien.
 *
 * No se siembran cuentas de demostración: una cuenta que nadie dio de alta a
 * propósito es una cuenta que nadie se acuerda de quitar.
 */
const ADMIN_INICIAL = {
  email: (process.env.SEED_ADMIN_EMAIL || 'angelk@corporativoultra.com').trim().toLowerCase(),
  nombre: process.env.SEED_ADMIN_NOMBRE || 'Ángel Kociankowski',
};

const PASSWORD_INICIAL = process.env.SEED_PASSWORD || 'UltraGuardias2026';

db.prepare(
  `INSERT OR IGNORE INTO usuarios (email, nombre, rol, password_hash, debe_cambiar_password)
   VALUES (?, ?, 'admin', ?, 1)`
).run(ADMIN_INICIAL.email, ADMIN_INICIAL.nombre, hashPassword(PASSWORD_INICIAL));

const admin = db.prepare("SELECT id, nombre, rol FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1").get();
console.log(`· administrador inicial: ${ADMIN_INICIAL.email} (contraseña: ${PASSWORD_INICIAL}, se pide cambiarla al entrar)`);

// ------------------------------------------------------- utilidades de carga

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/**
 * Las hojas traen el mismo asesor/zona escrito de varias formas ("ISAI ALVARADO",
 * "ISAÍ ALVARADO", "Humberto Martínez"). Se unifica a MAYÚSCULAS sin acentos para
 * que los rankings y filtros no partan a una persona en tres.
 */
const canonico = (v) => (v ? norm(v) : '');

const periodos = Object.keys(seed.snapshots).sort();

/**
 * El estado de fuerza vigente es el corte del periodo actual, no la unión de
 * todos los cortes: un servicio que dejó de aparecer en la hoja ya no opera,
 * y arrastrarlo desde un corte viejo inflaría la plantilla.
 */
const vigente = seed.meta?.periodo_vigente || periodos[periodos.length - 1];
if (!seed.snapshots[vigente]) {
  console.error(`· no existe el corte ${vigente} en data/seed.json`);
  process.exit(1);
}
/**
 * Cada renglón del corte es un servicio, aunque dos compartan nombre: la hoja
 * repite el sitio cuando tiene bloques de turnos distintos o razones sociales
 * diferentes. Agrupar por nombre perdería esos renglones.
 */
const fichas = seed.snapshots[vigente].map((r) => ({ ...r, periodo: vigente, clave: norm(r.servicio) }));
console.log(`· estado de fuerza vigente: corte ${vigente} (${fichas.length} renglones)`);

/** Primer corte en el que aparece cada servicio: da una fecha de alta real. */
const primerCorte = new Map();
for (const p of periodos) {
  for (const r of seed.snapshots[p]) {
    const k = norm(r.servicio);
    if (!primerCorte.has(k)) primerCorte.set(k, p);
  }
}

const folio = (() => {
  const n = { AP: 0, CA: 0 };
  return (prefijo, anio) => `${prefijo}-${anio}-${String(++n[prefijo]).padStart(4, '0')}`;
})();

const anioDe = (fecha, fallback = '2025') => (fecha ? String(fecha).slice(0, 4) : fallback);

// ------------------------------------------------------------------- carga

const insApertura = db.prepare(
  `INSERT INTO aperturas
     (folio, tipo, servicio, razon_social, direccion, zona, cluster, estado_geo, asesor, gerente, reporta,
      guardias, turnos_json, fecha, periodo, precio_guardia, sueldo_base, bono, uniforme,
      credito_autorizado, credito_plazo, forma_pago, cobro, tipo_repse, comentarios, aut_json,
      carga_inicial, servicio_id, creado_por)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);

const insCancelacion = db.prepare(
  `INSERT INTO cancelaciones
     (folio, tipo, servicio, servicio_id, guardias, turnos_json, fecha, periodo, zona, asesor,
      motivo, reporta, auditoria, cxc, aut_json, creado_por)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);

const insServicio = db.prepare(
  `INSERT INTO servicios
     (servicio, razon_social, direccion, zona, tipo, cluster, estado_geo, supervisor, asesor, gerente,
      estatus, total_guardias, turnos_json, precio_guardia, sueldo_base, bono, uniforme, tipo_repse,
      observaciones, mes_incremento, anio_ultimo_incremento,
      guardias_en_factura, importe_factura, importe_sin_iva, nomina_total, nomina_prestaciones,
      resultado_servicio, pct_utilidad, utilidad_bruta, facturado, status_cobranza, fecha_pago,
      forma_pago, cobro, credito_maximo, dias_credito, importe_pendiente, saldo_vencido,
      tiene_contrato, fecha_contrato, fecha_vencimiento_contrato, condiciones_comerciales, comentarios_contrato,
      apertura_id, fecha_alta)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);

const insBitacora = db.prepare(
  `INSERT INTO bitacora (usuario_id, usuario, rol, accion, entidad, entidad_id, detalle, creado_en)
   VALUES (?,?,?,?,?,?,?,?)`
);

const CAMPOS_SNAPSHOT = [
  'servicio', 'razon_social', 'zona', 'tipo', 'supervisor', 'asesor', 'total_guardias', 'turnos_json',
  'guardias_en_factura', 'importe_factura', 'importe_sin_iva', 'factura_mensual', 'nomina_total',
  'nomina_prestaciones', 'resultado_servicio', 'pct_utilidad', 'utilidad_bruta', 'status_cobranza',
  'fecha_pago', 'importe_pendiente', 'saldo_vencido', 'credito_maximo', 'dias_credito',
  'tiene_contrato', 'fecha_contrato', 'fecha_vencimiento_contrato', 'condiciones_comerciales',
  'observaciones',
];

const insSnapshot = db.prepare(
  `INSERT INTO snapshots (periodo, ${CAMPOS_SNAPSHOT.join(', ')})
   VALUES (?, ${CAMPOS_SNAPSHOT.map(() => '?').join(', ')})`
);

/** Un renglón del corte, con los mismos nombres de campo que usa `servicios`. */
function filaSnapshot(periodo, r) {
  return [
    periodo,
    ...CAMPOS_SNAPSHOT.map((c) => {
      if (c === 'turnos_json') return JSON.stringify(r.turnos || {});
      if (c === 'zona' || c === 'asesor' || c === 'tipo' || c === 'supervisor') return canonico(r[c]) || null;
      if (c === 'tiene_contrato') return r.tiene_contrato === 1 ? 1 : 0;
      const v = r[c];
      return v === undefined || v === '' ? null : v;
    }),
  ];
}

const cargar = db.transaction(() => {
  // 1) cortes históricos, para el análisis por periodo
  let nSnap = 0;
  for (const periodo of periodos) {
    for (const r of seed.snapshots[periodo]) {
      insSnapshot.run(...filaSnapshot(periodo, r));
      nSnap++;
    }
  }

  // 2) una apertura por servicio conocido -> crea la fila del estado de fuerza
  const idPorServicio = new Map();
  for (const ficha of fichas) {
    const clave = ficha.clave;
    const turnos = ficha.turnos && Object.keys(ficha.turnos).length ? ficha.turnos : {};
    const guardias = ficha.total_guardias ?? 0;
    /**
     * Alta = el primer corte mensual en el que aparece el servicio. La firma
     * del contrato solo sirve para adelantarla: si es anterior, el servicio ya
     * existía antes del corte más viejo que tenemos; si es posterior, es que el
     * contrato se formalizó con el servicio ya operando —hay renglones con
     * firma en 2026-12— y tomarla como alta pondría la apertura en el futuro.
     */
    const primerAparicion = `${primerCorte.get(clave) || ficha.periodo}-01`;
    const fechaAlta =
      ficha.fecha_contrato && ficha.fecha_contrato < primerAparicion
        ? ficha.fecha_contrato
        : primerAparicion;

    const ap = insApertura.run(
      folio('AP', anioDe(fechaAlta)), 'APERTURA', ficha.servicio,
      ficha.razon_social || null, null, canonico(ficha.zona) || null, null, null,
      canonico(ficha.asesor) || null, canonico(ficha.supervisor) || null, 'CARGA INICIAL',
      guardias, JSON.stringify(turnos), fechaAlta, String(fechaAlta).slice(0, 7),
      null, null, null, null, 0, null, null, null, null,
      'Alta por carga inicial del Estado de Fuerza', '{}', 1, null, admin.id
    );

    const sv = insServicio.run(
      ficha.servicio, ficha.razon_social || null, null, canonico(ficha.zona) || null, canonico(ficha.tipo) || null,
      null, null, canonico(ficha.supervisor) || null, canonico(ficha.asesor) || null, null,
      'ACTIVO', guardias, JSON.stringify(turnos),
      null, null, null, null, null,
      ficha.observaciones || null, ficha.mes_incremento || null, ficha.anio_ultimo_incremento || null,
      ficha.guardias_en_factura ?? null, ficha.importe_factura ?? null, ficha.importe_sin_iva ?? null,
      ficha.nomina_total ?? null, ficha.nomina_prestaciones ?? null, ficha.resultado_servicio ?? null,
      ficha.pct_utilidad ?? null, ficha.utilidad_bruta ?? null,
      ficha.importe_factura ? 1 : 0, ficha.status_cobranza || null, ficha.fecha_pago || null,
      null, null,
      ficha.credito_maximo ?? null, ficha.dias_credito ?? null, ficha.importe_pendiente ?? null,
      ficha.saldo_vencido ?? null,
      ficha.tiene_contrato ? 1 : 0, ficha.fecha_contrato || null, ficha.fecha_vencimiento_contrato || null,
      ficha.condiciones_comerciales || null, ficha.comentarios_contrato || null,
      ap.lastInsertRowid, fechaAlta
    );

    const servicioId = sv.lastInsertRowid;
    db.prepare('UPDATE aperturas SET servicio_id = ? WHERE id = ?').run(servicioId, ap.lastInsertRowid);
    if (!idPorServicio.has(clave)) idPorServicio.set(clave, servicioId);
    insBitacora.run(admin.id, admin.nombre, admin.rol, 'apertura', 'servicio', servicioId,
      `Carga inicial — ${ficha.servicio} (${guardias} guardias)`, `${fechaAlta} 00:00:00`);
  }

  // 3) aperturas e incrementos históricos del archivo de movimientos
  let nAper = 0;
  for (const a of seed.aperturas) {
    const clave = norm(a.servicio);
    const destino = idPorServicio.get(clave) ?? null;
    insApertura.run(
      folio('AP', anioDe(a.fecha, (a.periodo || '2025').slice(0, 4))),
      destino ? 'INCREMENTO' : 'APERTURA',
      a.servicio, null, a.direccion || null, canonico(a.zona) || null, a.cluster || null, a.estado_geo || null,
      canonico(a.asesor) || null, canonico(a.gerente) || null, a.reporta || null,
      a.guardias || 0, JSON.stringify(a.turnos || {}), a.fecha || null, a.periodo || null,
      a.precio_guardia ?? null, a.sueldo_base ?? null, a.bono ?? null, a.uniforme || null,
      a.credito_autorizado ? 1 : 0, a.credito_plazo || null, a.forma_pago || null, a.cobro || null,
      a.tipo_repse || null, a.comentarios || null, JSON.stringify(a.aut || {}),
      0, destino, admin.id
    );
    nAper++;
  }

  // 4) cancelaciones y reducciones históricas: quedan como expediente, no mutan
  //    el estado de fuerza. El corte vigente ya refleja su resultado neto —un
  //    servicio cancelado en 2025 que sigue en la hoja de julio fue reabierto—,
  //    así que reaplicarlas daría de baja servicios que hoy operan.
  const ordenadas = [...seed.cancelaciones].sort((x, y) =>
    String(x.fecha || x.periodo || '').localeCompare(String(y.fecha || y.periodo || ''))
  );
  let nCanc = 0;
  const bajas = 0;
  for (const c of ordenadas) {
    const clave = norm(c.servicio);
    const servicioId = idPorServicio.get(clave) ?? null;
    const info = insCancelacion.run(
      folio('CA', anioDe(c.fecha, (c.periodo || '2025').slice(0, 4))),
      c.tipo === 'REDUCCION' ? 'REDUCCION' : 'CANCELACION',
      c.servicio, servicioId, c.guardias || 0, JSON.stringify(c.turnos || {}),
      c.fecha || null, c.periodo || null, canonico(c.zona) || null, canonico(c.asesor) || null,
      c.motivo || null, c.reporta || null, c.auditoria || null, c.cxc ?? null,
      JSON.stringify(c.aut || {}), admin.id
    );
    nCanc++;

    if (!servicioId) continue;
    insBitacora.run(admin.id, admin.nombre, admin.rol,
      c.tipo === 'REDUCCION' ? 'reduccion' : 'cancelacion', 'servicio', servicioId,
      `Histórico — ${c.servicio} (-${c.guardias || 0} guardias) · ${c.motivo || 'sin motivo'}`,
      `${c.fecha || '2025-01-01'} 00:00:00`);
  }

  return { nSnap, nServicios: fichas.length, nAper, nCanc, bajas };
});

const r = cargar();

const activos = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_guardias),0) AS g FROM servicios WHERE estatus='ACTIVO'").get();

console.log(`· ${r.nSnap} renglones de cortes mensuales (${periodos.length} periodos)`);
console.log(`· ${r.nServicios} servicios creados vía apertura`);
console.log(`· ${r.nAper} aperturas/incrementos históricos`);
console.log(`· ${r.nCanc} cancelaciones/reducciones históricas (${r.bajas} bajas aplicadas)`);
console.log(`· estado de fuerza vigente: ${activos.n} servicios activos, ${activos.g} guardias`);
console.log(`\nBase lista en ${DB_PATH}`);
