import { getDb } from './db';

/** KPIs del estado de fuerza vigente. */
export function kpisEstadoFuerza() {
  const db = getDb();
  const act = db
    .prepare(
      `SELECT COUNT(*) AS servicios,
              COALESCE(SUM(total_guardias), 0) AS guardias,
              COALESCE(SUM(importe_factura), 0) AS facturacion,
              SUM(CASE WHEN tiene_contrato = 1 THEN 1 ELSE 0 END) AS con_contrato,
              SUM(CASE WHEN facturado = 1 THEN 1 ELSE 0 END) AS facturados,
              COALESCE(SUM(importe_pendiente), 0) AS pendiente,
              COALESCE(SUM(saldo_vencido), 0) AS vencido
         FROM servicios WHERE estatus = 'ACTIVO'`
    )
    .get();
  const bajas = db.prepare("SELECT COUNT(*) AS n FROM servicios WHERE estatus = 'BAJA'").get().n;

  const venciendo = db
    .prepare(
      `SELECT COUNT(*) AS n FROM servicios
        WHERE estatus = 'ACTIVO' AND fecha_vencimiento_contrato IS NOT NULL
          AND fecha_vencimiento_contrato BETWEEN date('now') AND date('now', '+60 day')`
    )
    .get().n;

  const vencidos = db
    .prepare(
      `SELECT COUNT(*) AS n FROM servicios
        WHERE estatus = 'ACTIVO' AND fecha_vencimiento_contrato IS NOT NULL
          AND fecha_vencimiento_contrato < date('now')`
    )
    .get().n;

  return {
    servicios: act.servicios,
    guardias: act.guardias,
    facturacion: act.facturacion,
    conContrato: act.con_contrato || 0,
    sinContrato: act.servicios - (act.con_contrato || 0),
    facturados: act.facturados || 0,
    sinFacturar: act.servicios - (act.facturados || 0),
    pendiente: act.pendiente,
    vencido: act.vencido,
    bajas,
    contratosPorVencer: venciendo,
    contratosVencidos: vencidos,
    promGuardias: act.servicios ? (act.guardias / act.servicios).toFixed(1) : '0',
  };
}

/** Aperturas vs cancelaciones agrupadas por periodo. */
export function movimientosPorPeriodo(limite = 18) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT periodo,
              SUM(CASE WHEN origen = 'A' THEN guardias ELSE 0 END) AS guardias_apertura,
              SUM(CASE WHEN origen = 'C' THEN guardias ELSE 0 END) AS guardias_cancelacion,
              SUM(CASE WHEN origen = 'A' THEN 1 ELSE 0 END) AS n_aperturas,
              SUM(CASE WHEN origen = 'C' THEN 1 ELSE 0 END) AS n_cancelaciones
         FROM (
           SELECT periodo, guardias, 'A' AS origen FROM aperturas
            WHERE periodo IS NOT NULL AND carga_inicial = 0
           UNION ALL
           SELECT periodo, guardias, 'C' AS origen FROM cancelaciones WHERE periodo IS NOT NULL
         )
        GROUP BY periodo
        ORDER BY periodo DESC
        LIMIT ?`
    )
    .all(limite);
  return rows
    .reverse()
    .map((r) => ({ ...r, neto: r.guardias_apertura - r.guardias_cancelacion }));
}

/**
 * Motivos de cancelación más frecuentes.
 *
 * El motivo viene del archivo de Aperturas y Cancelaciones, no de la hoja del
 * Estado de Fuerza, así que buena parte de los movimientos no lo trae. Ese
 * grupo se deja fuera del ranking —si no, se lo come entero— y se devuelve
 * aparte para poder decir cuánta cobertura hay.
 */
export function motivosCancelacion(limite = 10) {
  const db = getDb();
  const motivos = db
    .prepare(
      `SELECT TRIM(motivo) AS motivo,
              COUNT(*) AS movimientos,
              COALESCE(SUM(guardias), 0) AS guardias
         FROM cancelaciones
        WHERE motivo IS NOT NULL AND TRIM(motivo) <> ''
        GROUP BY TRIM(motivo)
        ORDER BY guardias DESC
        LIMIT ?`
    )
    .all(limite);
  const cobertura = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN motivo IS NULL OR TRIM(motivo) = '' THEN 1 ELSE 0 END) AS sin_motivo
         FROM cancelaciones`
    )
    .get();
  return { motivos, ...cobertura };
}

/** Distribución del estado de fuerza activo por zona. */
export function distribucionPorZona() {
  return getDb()
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(zona), ''), 'SIN ZONA') AS zona,
              COUNT(*) AS servicios,
              COALESCE(SUM(total_guardias), 0) AS guardias,
              COALESCE(SUM(importe_factura), 0) AS facturacion
         FROM servicios WHERE estatus = 'ACTIVO'
        GROUP BY zona ORDER BY guardias DESC`
    )
    .all();
}

/** Top asesores por guardias activos. */
export function rankingAsesores(limite = 12) {
  return getDb()
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(asesor), ''), 'SIN ASESOR') AS asesor,
              COUNT(*) AS servicios,
              COALESCE(SUM(total_guardias), 0) AS guardias,
              COALESCE(SUM(importe_factura), 0) AS facturacion
         FROM servicios WHERE estatus = 'ACTIVO'
        GROUP BY asesor ORDER BY guardias DESC LIMIT ?`
    )
    .all(limite);
}

/**
 * Contratos de servicios activos separados en dos grupos: los que ya vencieron
 * y los que vencen dentro de los próximos N días.
 */
export function contratosPorVencer(dias = 90) {
  const db = getDb();
  const base = `SELECT id, servicio, razon_social, zona, asesor, fecha_vencimiento_contrato, total_guardias
                  FROM servicios
                 WHERE estatus = 'ACTIVO' AND fecha_vencimiento_contrato IS NOT NULL`;
  return {
    vencidos: db
      .prepare(`${base} AND fecha_vencimiento_contrato < date('now') ORDER BY fecha_vencimiento_contrato DESC`)
      .all(),
    porVencer: db
      .prepare(
        `${base} AND fecha_vencimiento_contrato >= date('now')
                AND fecha_vencimiento_contrato <= date('now', '+' || ? || ' day')
          ORDER BY fecha_vencimiento_contrato`
      )
      .all(dias),
  };
}

/** Servicios activos sin factura registrada. */
export function servicioSinFacturar(limite = 25) {
  return getDb()
    .prepare(
      `SELECT id, servicio, razon_social, zona, asesor, total_guardias, guardias_en_factura
         FROM servicios
        WHERE estatus = 'ACTIVO' AND (facturado = 0 OR importe_factura IS NULL)
        ORDER BY total_guardias DESC LIMIT ?`
    )
    .all(limite);
}

export function ultimosMovimientos(limite = 15) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM (
         SELECT folio, 'APERTURA' AS clase, tipo, servicio, guardias, fecha, creado_en FROM aperturas
         UNION ALL
         SELECT folio, 'CANCELACION' AS clase, tipo, servicio, guardias, fecha, creado_en FROM cancelaciones
       ) ORDER BY creado_en DESC, fecha DESC LIMIT ?`
    )
    .all(limite);
}

export function listarBitacora({ limite = 200 } = {}) {
  return getDb()
    .prepare('SELECT * FROM bitacora ORDER BY creado_en DESC, id DESC LIMIT ?')
    .all(limite);
}

export function serviciosActivosParaSelect() {
  return getDb()
    .prepare(
      `SELECT id, servicio, razon_social, zona, asesor, total_guardias, turnos_json
         FROM servicios WHERE estatus = 'ACTIVO' ORDER BY servicio`
    )
    .all()
    .map((r) => ({ ...r, turnos: JSON.parse(r.turnos_json || '{}') }));
}
