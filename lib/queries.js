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
              -- Los mismos dos huecos, contados en guardias. Se preguntó cuál
              -- de las dos cosas contaban esos recuadros, y la respuesta útil
              -- es que cuenten las dos: veinte servicios sin contrato no pesan
              -- lo mismo si son veinte porterías de un guardia que si uno de
              -- ellos es un CEDIS de sesenta.
              COALESCE(SUM(CASE WHEN tiene_contrato = 1 THEN 0 ELSE total_guardias END), 0) AS guardias_sin_contrato,
              COALESCE(SUM(CASE WHEN facturado = 1 THEN 0 ELSE total_guardias END), 0) AS guardias_sin_facturar,
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
    guardiasSinContrato: act.guardias_sin_contrato || 0,
    facturados: act.facturados || 0,
    sinFacturar: act.servicios - (act.facturados || 0),
    guardiasSinFacturar: act.guardias_sin_facturar || 0,
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
 *
 * El rango de periodos es opcional y entró por un defecto medido: esta lista es
 * de TODOS LOS TIEMPOS, y el asistente la mandaba dentro de una respuesta
 * rotulada con el periodo que se había pedido. El motivo número uno histórico no
 * tiene ni un movimiento en 2026, así que «¿por qué nos cancelaron este año?» se
 * contestaba con el motivo de otro año. Sin rango devuelve EXACTAMENTE lo de
 * antes, con la misma firma posicional, porque esa lista es la que pinta el
 * Tablero y esa pantalla no se toca.
 */
export function motivosCancelacion(limite = 10, { desde = '', hasta = '' } = {}) {
  const db = getDb();
  /**
   * El mes de una cancelación, cortado igual que en `lib/movimientos.js`.
   *
   * `COALESCE(periodo, fecha, creado_en)` y no `periodo` a secas: el archivo de
   * la importación trae movimientos con fecha y sin periodo, y compararlos por
   * una columna que viene nula los dejaría fuera de los dos lados de cualquier
   * corte, o sea desaparecidos. Y tiene que ser el MISMO corte que el de las
   * bajas del periodo: con dos cortes distintos, los motivos y el total de bajas
   * dejarían de cuadrar y nadie se enteraría hasta que alguien sumara la columna
   * a mano.
   */
  const MES = 'substr(COALESCE(periodo, fecha, creado_en), 1, 7)';
  // El filtro se arma con los extremos que de verdad vinieron: comparar contra
  // una cadena vacía dejaría fuera todas las cancelaciones, que es la forma
  // callada de que una lista conteste cero.
  const where = ['1=1'];
  const rango = [];
  if (desde) {
    where.push(`${MES} >= ?`);
    rango.push(String(desde));
  }
  if (hasta) {
    where.push(`${MES} <= ?`);
    rango.push(String(hasta));
  }
  const filtro = where.join(' AND ');

  const motivos = db
    .prepare(
      `SELECT TRIM(motivo) AS motivo,
              COUNT(*) AS movimientos,
              COALESCE(SUM(guardias), 0) AS guardias
         FROM cancelaciones
        WHERE ${filtro} AND motivo IS NOT NULL AND TRIM(motivo) <> ''
        GROUP BY TRIM(motivo)
        ORDER BY guardias DESC
        LIMIT ?`
    )
    .all(...rango, limite);
  const cobertura = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN motivo IS NULL OR TRIM(motivo) = '' THEN 1 ELSE 0 END) AS sin_motivo
         FROM cancelaciones
        WHERE ${filtro}`
    )
    .get(...rango);
  // El resultado NO estrena claves: sin rango tiene que salir byte por byte lo
  // de antes, porque esta misma lista viaja al modelo con la forma que le da el
  // Tablero y una prueba vigente la mide. Los extremos ya los sabe quien llamó,
  // que es el único que los puede rotular.
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
 * Cuántos guardias hay en cada turno del día: matutino, nocturno, mixto.
 *
 * Es la pregunta que la plataforma no sabía contestar. Sabía la jornada —el
 * patrón de días— pero no a qué hora se cubre, y son dos cosas distintas: lo
 * que cuesta cubrir la noche no es lo que cuesta cubrir la mañana, y una
 * plantilla de 12X36 puede ser toda diurna o mitad y mitad.
 *
 * Devuelve aparte cuántos guardias todavía no lo tienen capturado, y no es un
 * detalle: este dato se empezó a pedir con 217 servicios ya dentro, así que al
 * principio lo normal es que casi todo esté sin capturar. Un reporte que
 * enseñara solo los repartidos daría porcentajes preciosos sobre el 3% de la
 * operación, y quien lo lea creería estar viendo el total.
 */
export function distribucionPorTurnoDia({ estatus = 'ACTIVO' } = {}) {
  const filas = getDb()
    .prepare(
      `SELECT total_guardias, turnos_detalle_json FROM servicios
        WHERE estatus = ? AND ${yaArranco()}`
    )
    .all(estatus);

  const porTurno = new Map();
  let conDetalle = 0;
  let sinDetalle = 0;

  for (const f of filas) {
    const detalle = JSON.parse(f.turnos_detalle_json || '{}');
    let repartidos = 0;
    for (const reparto of Object.values(detalle)) {
      for (const [turno, n] of Object.entries(reparto || {})) {
        const v = Number(n) || 0;
        porTurno.set(turno, (porTurno.get(turno) || 0) + v);
        repartidos += v;
      }
    }
    conDetalle += repartidos;
    sinDetalle += Math.max(0, (Number(f.total_guardias) || 0) - repartidos);
  }

  const turnos = [...porTurno.entries()]
    .map(([turno, guardias]) => ({ turno, guardias }))
    .sort((a, b) => b.guardias - a.guardias);

  return {
    turnos: turnos.map((t) => ({
      ...t,
      // El porcentaje va sobre la plantilla entera, no sobre lo capturado: así
      // se lee «de todos los guardias, esto es lo que sabemos que es nocturno»,
      // que es lo cierto, y no un 50% que en realidad son cuatro personas.
      pct: conDetalle + sinDetalle ? Math.round((t.guardias / (conDetalle + sinDetalle)) * 1000) / 10 : 0,
    })),
    conDetalle,
    sinDetalle,
    total: conDetalle + sinDetalle,
  };
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
  // Se cuenta en JavaScript y no con un GROUP BY porque un servicio puede
  // llevarlo más de un asesor, y la lista vive como JSON. Agrupar por la columna
  // `asesor` contaría solo al primero: el segundo desaparecería del ranking
  // aunque atienda el servicio igual que el otro.
  //
  // Cada asesor se lleva el servicio entero, no una fracción. Repartir los
  // guardias entre los dos daría números que no suman la operación y que nadie
  // podría cuadrar contra el estado de fuerza; y la pregunta que contesta este
  // panel es «de qué tamaño es lo que atiende cada quien», no «cuánto le toca».
  // Por eso la suma de la columna puede pasar del total, y se dice abajo.
  const filas = getDb()
    .prepare(
      `SELECT asesor, asesores_json, total_guardias, importe_factura
         FROM servicios WHERE estatus = 'ACTIVO' AND ${yaArranco()}`
    )
    .all();

  const por = new Map();
  let compartidos = 0;
  let sinRepartoCapturado = 0;
  for (const f of filas) {
    let lista = [];
    try {
      lista = JSON.parse(f.asesores_json || '[]');
    } catch {
      lista = [];
    }
    /**
     * Cuando el reparto no está capturado se cae a la columna `asesor`, y hay que
     * contar cuántas veces pasa.
     *
     * Medido: `asesores_json` está vacío en los 217 servicios, así que SIEMPRE se
     * cae aquí, y entonces cada texto distinto de esa columna cuenta como un
     * asesor. Tres de los trece «asesores» de hoy son el mismo señor —«ARMANDO
     * LOPEZ», «ARMANDO LOPEZ MAURICIO VALENZUELA» y «MAURICIO
     * VALENZUELA/ARMANDO LOPEZ»— porque donde van dos personas alguien escribió
     * los dos nombres en el mismo campo. No se puede partir ese texto sin
     * adivinar, y adivinar nombres de personas es peor que contarlos de más. Lo
     * que sí se puede es decir cuántos renglones salen de ahí, para que quien lea
     * «13 asesores» sepa que son 13 textos y no 13 personas.
     */
    if (!lista.length) {
      sinRepartoCapturado++;
      lista = [String(f.asesor || '').trim() || 'SIN ASESOR'];
    }
    if (lista.length > 1) compartidos++;

    for (const nombre of lista) {
      const clave = nombre || 'SIN ASESOR';
      const acc = por.get(clave) || { asesor: clave, servicios: 0, guardias: 0, facturacion: 0 };
      acc.servicios += 1;
      acc.guardias += Number(f.total_guardias) || 0;
      acc.facturacion += Number(f.importe_factura) || 0;
      por.set(clave, acc);
    }
  }

  const orden = [...por.values()].sort((a, b) => b.guardias - a.guardias).slice(0, limite);
  // `compartidos` viaja con el resultado para que la pantalla pueda decir por
  // qué las cifras no suman el total, en vez de dejar que parezca un error.
  orden.compartidos = compartidos;
  // Y `sinRepartoCapturado` para poder decir lo que de verdad pasa hoy, que es lo
  // contrario: no hay doble conteo porque no hay reparto capturado, y por eso un
  // renglón puede ser más de una persona.
  orden.sinRepartoCapturado = sinRepartoCapturado;
  return orden;
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

/**
 * Lo mismo, con el horizonte dicho en MESES cuando se pide.
 *
 * Para quién: jurídico. Su guía dice que el valor de su pantalla es «saber con
 * meses de anticipación», y la pantalla enseña el calendario entero de
 * vencimientos; el asistente solo veía noventa días, así que de los contratos
 * que vencen el año que viene no podía decir ni cuántos son.
 *
 * Se pide en meses y no en días porque es como se pregunta —«¿qué vence en el
 * siguiente semestre?»— y porque un mes de calendario no son treinta días: con
 * `'+N month'` lo cuenta SQLite y el borde cae donde lo esperaría quien pregunta.
 *
 * SIN ARGUMENTO son los MISMOS 90 DÍAS de siempre, y no «tres meses», porque no
 * son lo mismo y se midió: hoy `+90 day` cierra el 2027-01-29 y `+3 month` el
 * 2027-01-31, y en ese hueco de dos días caen dos contratos. Poner tres meses
 * por omisión habría cambiado en silencio la respuesta que el asistente ya daba
 * —y la cifra que pinta el Tablero— por un redondeo de calendario. Así que el
 * caso de siempre sale idéntico al de siempre, y los meses solo mandan cuando
 * alguien los pide.
 *
 * El horizonte se acota entre 1 y 36 aquí dentro, y no solo en el esquema de la
 * consulta del asistente: lo que valida el esquema es lo que llega de fuera, y
 * una función que confía en que su único llamador validó es la que revienta
 * cuando aparece el segundo.
 */
export function contratosPorVencerEnMeses(meses) {
  const pidieronMeses = meses !== undefined && meses !== null && String(meses).trim() !== '';
  const n = pidieronMeses ? Math.min(36, Math.max(1, Math.trunc(Number(meses) || 3))) : null;
  const db = getDb();
  const base = `SELECT id, servicio, razon_social, zona, asesor, fecha_vencimiento_contrato, total_guardias
                  FROM servicios
                 WHERE estatus = 'ACTIVO' AND ${yaArranco()} AND fecha_vencimiento_contrato IS NOT NULL`;
  /**
   * El corte se calcula UNA vez y la consulta de abajo filtra con esa misma
   * fecha, así que la que viaja de vuelta no puede separarse de la que se usó.
   * Quien llama la necesita para poder decir hasta dónde miró.
   *
   * Y el corte de los meses va acotado al último día de su mes, que es la
   * corrección de un defecto de borde que midió el tester. `date('now','+1
   * month')` un día 29, 30 o 31 desborda y SQLite lo normaliza: pedido el 31 de
   * octubre, «+1 month» es el 31 de noviembre, que no existe, y sale el 1 de
   * diciembre. Entonces «lo que vence dentro de 1 mes» abarca hasta el primero
   * del mes siguiente al siguiente, y el texto de al lado —que dice «dentro de los
   * próximos 1 meses»— es falso para el contrato que caiga ahí. Hoy no hay
   * ninguno en ese hueco, así que ninguna cifra está mal ahora mismo; es
   * exactamente la clase de redondeo de calendario que esta consulta se escribió
   * para no hacer en silencio.
   *
   * El tope es el último día del mes de destino: el primer día del mes que sigue
   * al de destino, menos un día. Un día 15 no lo alcanza nunca y sale el 15 de su
   * mes, como siempre.
   */
  const hasta =
    n === null
      ? db.prepare(`SELECT date('now', '+90 day') AS hasta`).get().hasta
      : db
          .prepare(
            `SELECT MIN(date('now', '+' || ? || ' month'),
                        date('now', 'start of month', '+' || ? || ' month', '-1 day')) AS hasta`
          )
          .get(n, n + 1).hasta;
  return {
    vencidos: db
      .prepare(`${base} AND fecha_vencimiento_contrato < date('now') ORDER BY fecha_vencimiento_contrato DESC`)
      .all(),
    porVencer: db
      .prepare(
        `${base} AND fecha_vencimiento_contrato >= date('now')
                AND fecha_vencimiento_contrato <= ?
          ORDER BY fecha_vencimiento_contrato`
      )
      .all(hasta),
    // En nulo cuando nadie pidió meses: el horizonte son los 90 días de siempre,
    // y escribir «3» ahí sería la clase de etiqueta aproximada que esta vuelta
    // viene a quitar.
    horizonteMeses: n,
    hasta,
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
      // `servicio_id` viaja para que el nombre del renglón pueda ser un enlace a
      // su ficha. Viene nulo en las aperturas que nunca se aplicaron y en 310 de
      // las 330 cancelaciones del archivo, que no traen el servicio ligado: ahí
      // el nombre se queda como texto, que es la verdad —no hay ficha a la que
      // ir, y un enlace a la nada es peor que no ofrecer ninguno.
      `SELECT * FROM (
         SELECT folio, 'APERTURA' AS clase, tipo, servicio, servicio_id, guardias, fecha, creado_en FROM aperturas
         UNION ALL
         SELECT folio, 'CANCELACION' AS clase, tipo, servicio, servicio_id, guardias, fecha, creado_en FROM cancelaciones
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
      // El importe mensual viaja con el servicio porque el formulario del
      // movimiento tiene que enseñar el que hay hoy y avisar de que no cambia
      // solo. Antes no lo traía, y por eso quien registraba una reducción no
      // tenía enfrente el número que se iba a quedar mintiendo.
      `SELECT id, servicio, razon_social, zona, asesor, total_guardias, turnos_json,
              importe_factura
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
