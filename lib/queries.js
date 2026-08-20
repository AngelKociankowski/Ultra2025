import { getDb } from './db';
import { mesActual } from './fechas';
import { yaArranco } from './dias';

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
         FROM servicios WHERE estatus = 'ACTIVO' AND ${yaArranco()}`
    )
    .get();
  const bajas = db.prepare("SELECT COUNT(*) AS n FROM servicios WHERE estatus = 'BAJA'").get().n;

  const venciendo = db
    .prepare(
      `SELECT COUNT(*) AS n FROM servicios
        WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND fecha_vencimiento_contrato IS NOT NULL
          AND fecha_vencimiento_contrato BETWEEN date('now') AND date('now', '+60 day')`
    )
    .get().n;

  const vencidos = db
    .prepare(
      `SELECT COUNT(*) AS n FROM servicios
        WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND fecha_vencimiento_contrato IS NOT NULL
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
         FROM servicios WHERE estatus = 'ACTIVO' AND ${yaArranco()}
        GROUP BY zona ORDER BY guardias DESC`
    )
    .all();
}

/**
 * Cómo se reparten los guardias por modalidad de horario.
 *
 * El total de una plantilla no dice cómo está armada: doce guardias en 24 HRS y
 * doce en 12X12 son la misma cifra y dos operaciones distintas —otra rotación,
 * otra nómina, otro descanso—. Ese detalle vive en el desglose de cada servicio
 * y hasta ahora no se sumaba en ningún lado.
 *
 * Se cuenta en JavaScript y no en SQL porque el desglose está guardado como
 * JSON: recorrer doscientos renglones cuesta menos que armar la consulta que
 * SQLite necesitaría para desarmarlo.
 */
export function distribucionPorTurno({ estatus = 'ACTIVO' } = {}) {
  return repartoDeTurnos(
    getDb().prepare(`SELECT id, servicio, turnos_json, total_guardias FROM servicios
        WHERE estatus = ? AND ${yaArranco()}`).all(estatus)
  );
}

/**
 * El mismo reparto sobre una lista ya cargada.
 *
 * La pantalla del estado de fuerza necesita el reparto de lo que está viendo
 * —con sus filtros puestos—, y volver a consultarlo sería preguntar dos veces
 * por lo mismo.
 */
export function repartoDeTurnos(filas) {
  const porTurno = new Map();
  let desglosados = 0;
  let sinDesglose = 0;
  let guardiasSinDesglose = 0;
  let totalPlantilla = 0;
  const descuadrados = [];

  for (const f of filas) {
    const turnos = JSON.parse(f.turnos_json || '{}');
    const claves = Object.keys(turnos);
    totalPlantilla += Number(f.total_guardias) || 0;
    if (!claves.length) {
      sinDesglose++;
      guardiasSinDesglose += f.total_guardias || 0;
      continue;
    }
    desglosados++;
    let suma = 0;
    for (const [turno, n] of Object.entries(turnos)) {
      const acumulado = porTurno.get(turno) || { turno, guardias: 0, servicios: 0 };
      acumulado.guardias += Number(n) || 0;
      acumulado.servicios += 1;
      porTurno.set(turno, acumulado);
      suma += Number(n) || 0;
    }
    // Un servicio cuyo desglose no suma su propia plantilla rompe la gráfica sin
    // que se note: las barras salen bien dibujadas y el total de abajo ya no es
    // el del estado de fuerza. Hoy son tres —los PROQUIGAMA, que traen el mismo
    // desglose de nueve copiado en los tres— y hacen que el reparto sume 937
    // donde la plantilla dice 919.
    if (suma !== (Number(f.total_guardias) || 0)) {
      descuadrados.push({
        id: f.id ?? null,
        servicio: f.servicio ?? null,
        plantilla: Number(f.total_guardias) || 0,
        desglose: suma,
      });
    }
  }

  const turnos = [...porTurno.values()].sort((a, b) => b.guardias - a.guardias);
  const total = turnos.reduce((a, t) => a + t.guardias, 0);
  return {
    turnos: turnos.map((t) => ({ ...t, pct: total ? Math.round((t.guardias / total) * 1000) / 10 : 0 })),
    total,
    desglosados,
    sinDesglose,
    guardiasSinDesglose,
    // Lo que dice el estado de fuerza, para poder contrastarlo contra `total`.
    totalPlantilla,
    descuadrados,
    diferencia: total + guardiasSinDesglose - totalPlantilla,
  };
}

/**
 * Fijos, temporales y de evento: cuántos hay y cuánto pesan.
 *
 * Sirve para dos cosas distintas y las dos importan. Para facturación, porque
 * un temporal no se cobra igual ni indefinidamente. Y para operación, porque un
 * temporal cuya fecha ya pasó sigue apareciendo en el estado de fuerza —con sus
 * guardias contados y su factura propuesta— hasta que alguien lo saca.
 */
export function distribucionPorModalidad() {
  const db = getDb();
  const filas = db
    .prepare(
      `SELECT modalidad,
              COUNT(*) AS servicios,
              COALESCE(SUM(total_guardias), 0) AS guardias,
              COALESCE(SUM(importe_factura), 0) AS facturacion
         FROM servicios WHERE estatus = 'ACTIVO' AND ${yaArranco()} GROUP BY modalidad`
    )
    .all();

  // Los que ya se pasaron de su fecha. No es un aviso menor: cada uno es un
  // servicio que se sigue contando y facturando después de haber terminado.
  const vencidos = db
    .prepare(
      `SELECT id, servicio, zona, asesor, modalidad, total_guardias, importe_factura, fecha_fin_prevista
         FROM servicios
        WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND modalidad <> 'FIJO'
          AND fecha_fin_prevista IS NOT NULL AND fecha_fin_prevista <> ''
          AND fecha_fin_prevista < date('now')
        ORDER BY fecha_fin_prevista`
    )
    .all();

  // Y los que no tienen fecha: no se puede avisar de lo que nadie capturó.
  const sinFecha = db
    .prepare(
      `SELECT COUNT(*) AS n FROM servicios
        WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND modalidad <> 'FIJO'
          AND (fecha_fin_prevista IS NULL OR fecha_fin_prevista = '')`
    )
    .get().n;

  return { filas, vencidos, sinFecha };
}

/** Top asesores por guardias activos. */
export function rankingAsesores(limite = 12) {
  return getDb()
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(asesor), ''), 'SIN ASESOR') AS asesor,
              COUNT(*) AS servicios,
              COALESCE(SUM(total_guardias), 0) AS guardias,
              COALESCE(SUM(importe_factura), 0) AS facturacion
         FROM servicios WHERE estatus = 'ACTIVO' AND ${yaArranco()}
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
                 WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND fecha_vencimiento_contrato IS NOT NULL`;
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
        WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND (facturado = 0 OR importe_factura IS NULL)
        ORDER BY total_guardias DESC LIMIT ?`
    )
    .all(limite);
}

/**
 * Los últimos movimientos, por la fecha en que ocurrieron.
 *
 * Antes se ordenaban por `creado_en`, que es cuándo alguien los tecleó. No es
 * lo mismo: un movimiento del mes pasado capturado esta mañana se ponía encima
 * de uno de ayer, y la lista dejaba de leerse como una línea de tiempo de la
 * operación para leerse como una de la captura. Manda la fecha del movimiento;
 * `creado_en` solo desempata dentro del mismo día.
 */
export function ultimosMovimientos(limite = 15) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM (
         SELECT folio, 'APERTURA' AS clase, tipo, servicio, guardias, fecha, creado_en FROM aperturas
         UNION ALL
         SELECT folio, 'CANCELACION' AS clase, tipo, servicio, guardias, fecha, creado_en FROM cancelaciones
       ) ORDER BY fecha DESC, creado_en DESC LIMIT ?`
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
         FROM servicios WHERE estatus = 'ACTIVO' AND ${yaArranco()} ORDER BY servicio`
    )
    .all()
    .map((r) => ({ ...r, turnos: JSON.parse(r.turnos_json || '{}') }));
}

// ------------------------------------------------------------ cortes mensuales

/**
 * Periodos disponibles para consulta, del más reciente al más viejo.
 *
 * El corte vigente también está en `snapshots` —es la foto con la que arrancó
 * el mes— pero en pantalla se sirve desde `servicios`, que es lo que cambia con
 * aperturas y cancelaciones. Por eso se marca cuál es.
 */
export function periodosDisponibles(vigente) {
  return getDb()
    .prepare(
      `SELECT periodo,
              COUNT(*) AS servicios,
              COALESCE(SUM(total_guardias), 0) AS guardias,
              COALESCE(SUM(importe_factura), 0) AS facturacion
         FROM snapshots
        GROUP BY periodo
        ORDER BY periodo DESC`
    )
    .all()
    .map((p) => ({ ...p, vigente: p.periodo === vigente }));
}

/**
 * El mes que está corriendo.
 *
 * Lo dice el calendario, no el último corte que se importó. Antes salía de
 * `MAX(periodo)` en snapshots, y por eso al llegar agosto la pantalla seguía
 * anunciando «julio · en curso»: julio era el último corte que había. Los
 * cortes cerrados son historia; el mes vivo es el de hoy.
 */
export function periodoVigente() {
  return mesActual();
}

/** El último corte cerrado que hay en la base, que es otra cosa. */
export function ultimoCorte() {
  return getDb().prepare('SELECT MAX(periodo) AS p FROM snapshots').get().p;
}

/** Renglones de un corte cerrado, con los mismos filtros que el estado vigente. */
export function serviciosDeCorte(periodo, { zona = '', asesor = '', turno = '', contrato = '', facturado = '', q = '' } = {}) {
  const where = ['periodo = ?'];
  const args = [periodo];
  if (zona) { where.push('zona = ?'); args.push(zona); }
  if (asesor) { where.push('asesor = ?'); args.push(asesor); }
  if (turno) { where.push('turnos_json LIKE ?'); args.push(`%"${turno}":%`); }
  if (contrato === 'si') where.push('tiene_contrato = 1');
  if (contrato === 'no') where.push('(tiene_contrato IS NULL OR tiene_contrato = 0)');
  if (facturado === 'si') where.push('importe_factura IS NOT NULL AND importe_factura > 0');
  if (facturado === 'no') where.push('(importe_factura IS NULL OR importe_factura = 0)');
  if (q) {
    where.push('(servicio LIKE ? OR razon_social LIKE ? OR asesor LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  return getDb()
    .prepare(`SELECT * FROM snapshots WHERE ${where.join(' AND ')} ORDER BY servicio`)
    .all(...args)
    // El corte guarda el desglose igual que el mes vivo; se abre aquí para que
    // la pantalla no tenga que saber de dónde vino cada renglón.
    .map((r) => ({ ...r, turnos: JSON.parse(r.turnos_json || '{}') }));
}

/** Catálogos de un corte, para que los filtros ofrezcan lo que ese mes tenía. */
export function catalogosDeCorte(periodo) {
  const db = getDb();
  const col = (c) =>
    db
      .prepare(`SELECT DISTINCT ${c} AS v FROM snapshots WHERE periodo = ? AND ${c} IS NOT NULL AND ${c} <> '' ORDER BY v`)
      .all(periodo)
      .map((r) => r.v);
  return { zonas: col('zona'), asesores: col('asesor'), tipos: col('tipo') };
}

/** Cómo cambió un corte contra el mes anterior: lo que pregunta facturación. */
export function comparativoCorte(periodo) {
  const db = getDb();
  const previo = db
    .prepare('SELECT MAX(periodo) AS p FROM snapshots WHERE periodo < ?')
    .get(periodo).p;
  if (!previo) return null;
  const resumen = (p) =>
    db
      .prepare(
        `SELECT COUNT(*) AS servicios,
                COALESCE(SUM(total_guardias), 0) AS guardias,
                COALESCE(SUM(importe_factura), 0) AS facturacion
           FROM snapshots WHERE periodo = ?`
      )
      .get(p);
  const a = resumen(periodo);
  const b = resumen(previo);
  return {
    previo,
    servicios: a.servicios - b.servicios,
    guardias: a.guardias - b.guardias,
    facturacion: a.facturacion - b.facturacion,
  };
}
