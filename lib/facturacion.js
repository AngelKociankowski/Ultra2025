/**
 * Cobranza: facturas, pagos y saldos.
 *
 * La regla que ordena todo esto es una sola:
 *
 *     el saldo no se captura, se calcula.
 *
 * Finanzas registra dos hechos —«se emitió esta factura» y «entró este pago»—
 * y de ahí salen el pendiente, lo que está por vencer y el adeudo. Un saldo
 * tecleado a mano acabaría contradiciendo a las facturas que lo componen, que
 * es la misma clase de error que un total de guardias peleado con su desglose.
 *
 * Y la que pidió el negocio:
 *
 *     hay adeudo cuando se acaba el plazo del crédito, no cuando se factura.
 *
 * Una factura recién emitida a 30 días no es un adeudo: es una cuenta por
 * cobrar corriente. Se vuelve adeudo el día 31. Sin crédito pactado el plazo es
 * cero, así que vence el mismo día en que se emite.
 *
 * El plazo se cuenta desde la FECHA DE LA FACTURA, no desde que se prestó el
 * servicio. Por eso importa saber cuándo se factura cada cliente —a inicio de
 * mes, por quincenas, a mes vencido— y por eso ese dato se captura desde la
 * apertura.
 */

import { getDb, auditar } from './db';
import { ValidacionError } from './errores';
import { exigirDelCatalogo } from './catalogos';
import { leerImporte, leerFecha, leerSiNo } from './csv';

/**
 * Cuándo se emite la factura de un mes de servicio.
 *
 * Cada esquema sabe calcular sus fechas, y por eso esta lista vive en el código
 * y no en un catálogo que el administrador pueda ampliar: una opción nueva sin
 * su regla de cálculo no sabría decir cuándo vence.
 */
export const ESQUEMAS = {
  INICIO_MES: {
    etiqueta: 'A inicio de mes (anticipado)',
    ayuda: 'Se factura el día 1 del mes que se va a cubrir. El crédito corre desde entonces.',
  },
  QUINCENAL: {
    etiqueta: 'Por quincenas',
    ayuda: 'Dos facturas al mes: el día 1 y el día 16, cada una por la mitad del importe.',
  },
  FIN_MES: {
    etiqueta: 'A fin de mes',
    ayuda: 'Se factura el último día del mes trabajado.',
  },
  MES_VENCIDO: {
    etiqueta: 'Mes vencido',
    ayuda: 'Se factura el día 1 del mes siguiente al trabajado.',
  },
  SIN_CALENDARIO: {
    etiqueta: 'Sin calendario fijo',
    ayuda: 'No hay fecha pactada: la factura se registra a mano cuando se emite.',
  },
};

// ------------------------------------------------------------------- fechas

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (Number(dias) || 0));
  return d.toISOString().slice(0, 10);
}

function ultimoDiaDe(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

function primerDiaDelSiguiente(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(Date.UTC(anio, mes, 1)).toISOString().slice(0, 10);
}

function exigirPeriodo(periodo) {
  const p = String(periodo || '').trim();
  if (!/^\d{4}-\d{2}$/.test(p)) throw new ValidacionError('El periodo debe venir como AAAA-MM.');
  return p;
}

/**
 * El día en que vence una factura.
 *
 * Se calcula una sola vez, al emitirla, y se guarda. Si mañana al cliente le
 * renegocian el plazo, las facturas ya emitidas conservan el que tenían: esa
 * era la condición cuando se cobró.
 */
export function vencimientoDe(fechaFactura, diasCredito) {
  return sumarDias(fechaFactura, Math.max(0, Number(diasCredito) || 0));
}

/**
 * Qué facturas le tocan a un servicio por un mes, según cómo se le cobra.
 *
 * Devuelve la propuesta —fecha, concepto, importe y vencimiento— sin guardar
 * nada. Es lo que la pantalla enseña antes de que finanzas confirme, y lo que
 * usa la generación del mes.
 */
export function programaDe(servicio, periodo) {
  const p = exigirPeriodo(periodo);
  const esquema = servicio.esquema_facturacion;
  if (!esquema || !ESQUEMAS[esquema] || esquema === 'SIN_CALENDARIO') return [];

  const dias = Math.max(0, Number(servicio.dias_credito) || 0);
  const importeMes = Number(servicio.importe_factura) || 0;

  const partes =
    esquema === 'QUINCENAL'
      ? [
          { fecha: `${p}-01`, concepto: 'Primera quincena', importe: importeMes / 2 },
          { fecha: `${p}-16`, concepto: 'Segunda quincena', importe: importeMes / 2 },
        ]
      : [
          {
            fecha:
              esquema === 'INICIO_MES'
                ? `${p}-01`
                : esquema === 'FIN_MES'
                ? ultimoDiaDe(p)
                : primerDiaDelSiguiente(p),
            concepto: 'Mes completo',
            importe: importeMes,
          },
        ];

  return partes.map((parte) => ({
    ...parte,
    periodo: p,
    dias_credito: dias,
    fecha_vencimiento: vencimientoDe(parte.fecha, dias),
  }));
}

// ---------------------------------------------------------------- consultas

/** El estado de una factura sale de su saldo y de su vencimiento, nunca de un campo. */
function conEstado(f, referencia = hoy()) {
  const saldo = Math.round(((Number(f.importe) || 0) - (Number(f.importe_pagado) || 0)) * 100) / 100;
  let estado;
  if (f.cancelada) estado = 'CANCELADA';
  else if (saldo <= 0) estado = 'PAGADA';
  else if (f.fecha_vencimiento < referencia) estado = 'VENCIDA';
  else estado = 'POR VENCER';
  return {
    ...f,
    cancelada: !!f.cancelada,
    saldo: f.cancelada ? 0 : saldo,
    estado,
    // los días que faltan (positivo) o que lleva vencida (negativo)
    dias: diasEntre(referencia, f.fecha_vencimiento),
    parcial: !f.cancelada && saldo > 0 && (Number(f.importe_pagado) || 0) > 0,
  };
}

function diasEntre(desde, hasta) {
  const a = new Date(`${desde}T00:00:00Z`);
  const b = new Date(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function facturasDeServicio(servicioId) {
  const db = getDb();
  const filas = db
    .prepare('SELECT * FROM facturas WHERE servicio_id = ? ORDER BY fecha_factura DESC, id DESC')
    .all(Number(servicioId))
    .map((f) => conEstado(f));
  const pagos = db
    .prepare(
      `SELECT p.* FROM pagos p JOIN facturas f ON f.id = p.factura_id
        WHERE f.servicio_id = ? ORDER BY p.id DESC`
    )
    .all(Number(servicioId));
  for (const f of filas) f.pagos = pagos.filter((p) => p.factura_id === f.id);
  return filas;
}

/**
 * El estado de cuenta de un servicio.
 *
 * `vencido` es el adeudo de verdad: lo que ya pasó su fecha de vencimiento.
 * `porVencer` es cuenta corriente, todavía dentro del plazo. Sumar los dos y
 * llamarle «adeudo» sería contarle al cliente una deuda que aún no tiene.
 */
export function resumenDe(servicioId) {
  const servicio = getDb()
    .prepare('SELECT credito_maximo, dias_credito, esquema_facturacion FROM servicios WHERE id = ?')
    .get(Number(servicioId));
  const facturas = facturasDeServicio(servicioId).filter((f) => !f.cancelada);

  const emitido = facturas.reduce((a, f) => a + (Number(f.importe) || 0), 0);
  const cobrado = facturas.reduce((a, f) => a + (Number(f.importe_pagado) || 0), 0);
  const vencido = facturas.filter((f) => f.estado === 'VENCIDA').reduce((a, f) => a + f.saldo, 0);
  const porVencer = facturas.filter((f) => f.estado === 'POR VENCER').reduce((a, f) => a + f.saldo, 0);
  const credito = Number(servicio?.credito_maximo) || 0;

  return {
    emitido,
    cobrado,
    pendiente: vencido + porVencer,
    vencido,
    porVencer,
    facturas: facturas.length,
    vencidas: facturas.filter((f) => f.estado === 'VENCIDA').length,
    credito,
    // Cuánto le queda al cliente antes de topar su línea. Sin línea pactada no
    // se inventa una: se devuelve null y la pantalla no muestra semáforo.
    disponible: credito ? credito - (vencido + porVencer) : null,
    excedido: credito ? vencido + porVencer > credito : false,
  };
}

/** Cobranza de toda la cartera, para el tablero. */
export function kpisCobranza() {
  const ref = hoy();
  const fila = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(importe), 0)                                            AS emitido,
         COALESCE(SUM(importe_pagado), 0)                                     AS cobrado,
         COALESCE(SUM(CASE WHEN fecha_vencimiento <  ? THEN importe - importe_pagado ELSE 0 END), 0) AS vencido,
         COALESCE(SUM(CASE WHEN fecha_vencimiento >= ? THEN importe - importe_pagado ELSE 0 END), 0) AS por_vencer,
         SUM(CASE WHEN fecha_vencimiento < ? AND importe > importe_pagado THEN 1 ELSE 0 END)         AS facturas_vencidas,
         COUNT(*)                                                             AS facturas
         FROM facturas WHERE cancelada = 0`
    )
    .get(ref, ref, ref);

  const clientes = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT servicio_id) AS n FROM facturas
        WHERE cancelada = 0 AND importe > importe_pagado AND fecha_vencimiento < ?`
    )
    .get(ref).n;

  return {
    emitido: fila.emitido,
    cobrado: fila.cobrado,
    vencido: Math.max(0, fila.vencido),
    porVencer: Math.max(0, fila.por_vencer),
    pendiente: Math.max(0, fila.vencido) + Math.max(0, fila.por_vencer),
    facturas: fila.facturas,
    facturasVencidas: fila.facturas_vencidas || 0,
    serviciosConAdeudo: clientes || 0,
  };
}

/** Las facturas de un mes, emitidas o canceladas, con el nombre del servicio. */
export function facturasDelPeriodo(periodo) {
  const ref = hoy();
  return getDb()
    .prepare(
      `SELECT f.*, s.servicio, s.zona, s.asesor
         FROM facturas f JOIN servicios s ON s.id = f.servicio_id
        WHERE f.periodo = ?
        ORDER BY s.servicio, f.concepto`
    )
    .all(exigirPeriodo(periodo))
    .map((f) => conEstado(f, ref));
}

/**
 * El año visto mes por mes: qué se facturó y qué falta.
 *
 * Lo que se espera de un mes no depende del mes sino de cómo se cobra cada
 * servicio —uno al mes, o dos si va por quincenas—, salvo por una cosa: un
 * servicio que abrió en agosto no debía nada en marzo. Por eso se mira la fecha
 * de alta; si no, los meses viejos saldrían siempre incompletos y el calendario
 * se volvería un semáforo en rojo que nadie mira.
 */
export function calendarioFacturacion(anio) {
  const db = getDb();
  const a = Number(anio);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new ValidacionError('Año no válido.');

  const servicios = db
    .prepare("SELECT esquema_facturacion, fecha_alta FROM servicios WHERE estatus = 'ACTIVO'")
    .all();

  const emitidas = new Map();
  for (const r of db
    .prepare(
      `SELECT periodo,
              COUNT(*) AS n,
              COALESCE(SUM(importe), 0) AS importe,
              COALESCE(SUM(importe - importe_pagado), 0) AS saldo
         FROM facturas
        WHERE cancelada = 0 AND periodo LIKE ?
        GROUP BY periodo`
    )
    .all(`${a}-%`)) {
    emitidas.set(r.periodo, r);
  }

  const mesActual = hoy().slice(0, 7);

  /**
   * Desde cuándo tiene sentido reclamar un mes.
   *
   * Antes de la primera factura registrada, la plataforma no tiene opinión: no
   * es que falten doscientas facturas de enero, es que enero se llevó fuera.
   * Sin esta línea, el calendario abre con medio año en rojo y deja de servir
   * como semáforo, que es justo para lo que está.
   */
  const primera = db
    .prepare('SELECT MIN(periodo) AS p FROM facturas WHERE cancelada = 0')
    .get().p;
  const desde = primera || mesActual;

  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const periodo = `${a}-${String(m).padStart(2, '0')}`;
    const cierre = ultimoDiaDe(periodo);

    let esperadas = 0;
    for (const s of servicios) {
      if (!s.esquema_facturacion || s.esquema_facturacion === 'SIN_CALENDARIO') continue;
      if (s.fecha_alta && s.fecha_alta > cierre) continue;
      esperadas += s.esquema_facturacion === 'QUINCENAL' ? 2 : 1;
    }

    const e = emitidas.get(periodo) || { n: 0, importe: 0, saldo: 0 };
    const anterior = periodo < desde;
    const faltan = anterior ? 0 : Math.max(0, esperadas - e.n);

    const futuro = periodo > mesActual;

    let estado;
    if (anterior && e.n === 0) estado = 'sin_registro';
    // Un mes que no ha llegado no debe nada: no se pinta como pendiente.
    else if (futuro && e.n === 0) estado = 'vacio';
    else if (e.n === 0 && esperadas === 0) estado = 'vacio';
    else if (faltan === 0 && e.n > 0) estado = 'completo';
    else if (e.n > 0) estado = 'parcial';
    else estado = 'pendiente';

    meses.push({
      periodo,
      mes: m,
      emitidas: e.n,
      importe: e.importe,
      saldo: e.saldo,
      esperadas: anterior ? 0 : esperadas,
      faltan: futuro ? 0 : faltan,
      futuro,
      anterior,
      estado,
    });
  }

  return { anio: a, meses };
}

/** Las facturas vencidas de toda la cartera, para la pantalla de cobranza. */
export function facturasVencidas(limite = 100) {
  const ref = hoy();
  return getDb()
    .prepare(
      `SELECT f.*, s.servicio, s.razon_social, s.asesor, s.zona
         FROM facturas f JOIN servicios s ON s.id = f.servicio_id
        WHERE f.cancelada = 0 AND f.importe > f.importe_pagado AND f.fecha_vencimiento < ?
        ORDER BY f.fecha_vencimiento
        LIMIT ?`
    )
    .all(ref, limite)
    .map((f) => conEstado(f, ref));
}

// ---------------------------------------------------------------- escritura

/**
 * Copia al servicio lo que dice su cobranza.
 *
 * Los saldos viven calculados en `facturas`; esto solo deja una copia en
 * `servicios` para que el tablero, los filtros y el corte del mes no tengan que
 * recorrer el libro entero en cada pantalla. Se llama después de cada
 * movimiento, así que la copia nunca se queda atrás.
 */
export function recalcular(db, servicioId) {
  const ref = hoy();
  const t = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN fecha_vencimiento <  ? THEN importe - importe_pagado ELSE 0 END), 0) AS vencido,
         COALESCE(SUM(CASE WHEN fecha_vencimiento >= ? THEN importe - importe_pagado ELSE 0 END), 0) AS por_vencer,
         MAX(fecha_pago) AS ultimo_pago,
         COUNT(*) AS n
         FROM facturas WHERE servicio_id = ? AND cancelada = 0`
    )
    .get(ref, ref, Number(servicioId));

  const pendiente = Math.max(0, t.vencido) + Math.max(0, t.por_vencer);
  db.prepare(
    `UPDATE servicios
        SET importe_pendiente = ?, saldo_vencido = ?, fecha_pago = ?,
            facturado = CASE WHEN ? > 0 THEN 1 ELSE facturado END,
            actualizado_en = datetime('now')
      WHERE id = ?`
  ).run(pendiente, Math.max(0, t.vencido), t.ultimo_pago || null, t.n, Number(servicioId));
}

function servicioDe(db, id) {
  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!s) throw new ValidacionError('El servicio no existe.');
  return s;
}

function importeValido(v, que = 'El importe') {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ValidacionError(`${que} debe ser un número mayor que cero.`);
  return Math.round(n * 100) / 100;
}

/**
 * Registra una factura emitida.
 *
 * La fecha de vencimiento no se acepta del cliente aunque la mande: se calcula
 * con los días de crédito, que es lo único que la puede explicar.
 */
export function registrarFactura(payload, usuario) {
  const db = getDb();
  const servicio = servicioDe(db, payload.servicio_id);
  const periodo = exigirPeriodo(payload.periodo);
  const concepto = String(payload.concepto || 'Mes completo').trim() || 'Mes completo';
  const fecha = String(payload.fecha_factura || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidacionError('Indica la fecha de la factura (AAAA-MM-DD).');

  const importe = importeValido(payload.importe, 'El importe de la factura');
  const dias =
    payload.dias_credito !== undefined && payload.dias_credito !== ''
      ? Math.max(0, Math.round(Number(payload.dias_credito) || 0))
      : Math.max(0, Math.round(Number(servicio.dias_credito) || 0));

  const yaEsta = db
    .prepare('SELECT id FROM facturas WHERE servicio_id = ? AND periodo = ? AND concepto = ?')
    .get(servicio.id, periodo, concepto);
  if (yaEsta) {
    throw new ValidacionError(
      `Ya hay una factura de ${concepto.toLowerCase()} para ${periodo} en este servicio. Si la anterior estuvo mal, cancélala antes de volver a emitirla.`
    );
  }

  const vencimiento = vencimientoDe(fecha, dias);

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO facturas
           (servicio_id, periodo, concepto, folio, fecha_factura, dias_credito, fecha_vencimiento,
            importe, forma_pago, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        servicio.id, periodo, concepto, payload.folio || null, fecha, dias, vencimiento,
        importe, payload.forma_pago || servicio.forma_pago || null, usuario?.id ?? null
      );
    recalcular(db, servicio.id);
    auditar(db, {
      usuario,
      accion: 'factura',
      entidad: 'servicio',
      entidad_id: servicio.id,
      detalle: `${servicio.servicio} — factura ${concepto.toLowerCase()} de ${periodo} por ${importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}, vence ${vencimiento}`,
    });
    return { id: info.lastInsertRowid, fecha_vencimiento: vencimiento, dias_credito: dias };
  });

  return tx();
}

/**
 * Qué falta facturar de un mes, servicio por servicio.
 *
 * No emite nada: arma la lista de trabajo. Cada factura se registra una por
 * una, revisada, porque el importe del mes casi nunca es el del mes pasado —hay
 * servicios que subieron guardias, extras, notas de crédito— y una emisión en
 * bloque daría por bueno el mismo número para todos.
 *
 * Lo que sí resuelve es no olvidar a nadie entre doscientos servicios: propone
 * la fecha y el importe que le tocarían a cada uno según cómo se le cobra, y
 * aparta los que ni siquiera se pueden proponer porque les falta capturar
 * cuándo se les factura.
 */
export function pendientesDeFacturar(periodo) {
  const db = getDb();
  const p = exigirPeriodo(periodo);
  const servicios = db.prepare("SELECT * FROM servicios WHERE estatus = 'ACTIVO' ORDER BY servicio").all();
  const existe = db.prepare('SELECT id FROM facturas WHERE servicio_id = ? AND periodo = ? AND concepto = ?');

  const porFacturar = [];
  const sinCondiciones = [];
  let facturados = 0;

  for (const s of servicios) {
    const programa = programaDe(s, p);

    /**
     * Un servicio sin condiciones capturadas también se puede facturar.
     *
     * Antes se apartaba de la lista y no había dónde pulsar, así que para
     * registrar una sola factura había que capturarle primero el esquema. Eso
     * es poner una tarea administrativa delante de un cobro, y el cobro no
     * espera. Entra igual: lo único que no lleva es fecha propuesta, porque no
     * hay de dónde sacarla. Se escribe a mano y ya.
     */
    if (!programa.length) {
      sinCondiciones.push({ id: s.id, servicio: s.servicio, zona: s.zona, asesor: s.asesor });
      if (existe.get(s.id, p, 'Mes completo')) {
        facturados++;
        continue;
      }
      porFacturar.push({
        servicio_id: s.id,
        servicio: s.servicio,
        razon_social: s.razon_social,
        zona: s.zona,
        asesor: s.asesor,
        dias_credito: Math.max(0, Math.round(Number(s.dias_credito) || 0)),
        concepto: 'Mes completo',
        fecha: null,
        fecha_vencimiento: null,
        importe: Math.round((Number(s.importe_factura) || 0) * 100) / 100,
        sinCondiciones: true,
      });
      continue;
    }

    let pendiente = false;
    for (const parte of programa) {
      if (existe.get(s.id, p, parte.concepto)) continue;
      pendiente = true;
      porFacturar.push({
        servicio_id: s.id,
        servicio: s.servicio,
        razon_social: s.razon_social,
        zona: s.zona,
        asesor: s.asesor,
        dias_credito: parte.dias_credito,
        concepto: parte.concepto,
        fecha: parte.fecha,
        fecha_vencimiento: parte.fecha_vencimiento,
        // Propuesta, no cifra buena: sale del importe mensual capturado en la
        // ficha. Si el servicio no lo trae, va en cero y hay que escribirlo.
        importe: Math.round((parte.importe || 0) * 100) / 100,
        sinCondiciones: false,
      });
    }
    if (!pendiente) facturados++;
  }

  return { periodo: p, porFacturar, sinCondiciones, facturados };
}

// ------------------------------------------------------------ puesta al día

/**
 * Aplica las mismas condiciones de cobro a un grupo de servicios.
 *
 * Es configuración, no emisión: no crea ni una factura. Existe porque al
 * arrancar hay doscientos servicios que se cobran casi todos igual, y
 * capturarlo uno por uno son horas de teclear el mismo dato. Las excepciones se
 * ajustan después desde cada ficha, que es donde se ven.
 *
 * `alcance` decide a quiénes alcanza:
 *   'sin_condiciones' — solo a los que aún no tienen esquema (lo normal)
 *   'todos'           — a todos los activos, pisando lo que ya tuvieran
 *   'seleccion'       — a los ids que se manden
 */
export function aplicarCondiciones(payload, usuario) {
  const db = getDb();

  const esquema = String(payload.esquema_facturacion || '').trim();
  if (!ESQUEMAS[esquema]) throw new ValidacionError('Elige cuándo se factura.');

  const dias = Math.max(0, Math.round(Number(payload.dias_credito) || 0));
  const formaPago = exigirDelCatalogo('forma_pago', payload.forma_pago);

  const alcance = payload.alcance || 'sin_condiciones';
  let where = "estatus = 'ACTIVO'";
  let args = [];
  if (alcance === 'sin_condiciones') {
    where += " AND (esquema_facturacion IS NULL OR esquema_facturacion = '')";
  } else if (alcance === 'seleccion') {
    const ids = (payload.ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw new ValidacionError('No seleccionaste ningún servicio.');
    where += ` AND id IN (${ids.map(() => '?').join(',')})`;
    args = ids;
  } else if (alcance !== 'todos') {
    throw new ValidacionError('Alcance no válido.');
  }

  const objetivo = db.prepare(`SELECT id FROM servicios WHERE ${where}`).all(...args);
  if (!objetivo.length) return { aplicados: 0 };

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE servicios
          SET esquema_facturacion = ?, dias_credito = ?,
              forma_pago = COALESCE(?, forma_pago),
              actualizado_en = datetime('now')
        WHERE ${where}`
    ).run(esquema, dias, formaPago, ...args);

    // Una sola entrada en la bitácora y no doscientas: fue un movimiento de
    // configuración, no doscientas decisiones distintas.
    auditar(db, {
      usuario,
      accion: 'condiciones_cobro',
      entidad: 'facturacion',
      entidad_id: null,
      detalle: `${objetivo.length} servicio(s): ${ESQUEMAS[esquema].etiqueta.toLowerCase()}, ${dias} días de crédito${formaPago ? `, ${formaPago}` : ''}`,
    });
  });

  tx();
  return { aplicados: objetivo.length };
}

/** Los renglones de la plantilla de carga, ya propuestos donde se puede. */
export function plantillaDeCarga(periodo) {
  const db = getDb();
  const p = exigirPeriodo(periodo);
  const servicios = db.prepare("SELECT * FROM servicios WHERE estatus = 'ACTIVO' ORDER BY servicio").all();

  const filas = [];
  for (const s of servicios) {
    const programa = programaDe(s, p);
    if (programa.length) {
      for (const parte of programa) {
        filas.push({
          id: s.id,
          servicio: s.servicio,
          periodo: p,
          concepto: parte.concepto,
          fecha_factura: parte.fecha,
          dias_credito: parte.dias_credito,
          importe: parte.importe || '',
          folio: '',
          pagado: '',
          fecha_pago: '',
        });
      }
    } else {
      filas.push({
        id: s.id,
        servicio: s.servicio,
        periodo: p,
        concepto: 'Mes completo',
        fecha_factura: '',
        dias_credito: s.dias_credito ?? '',
        importe: s.importe_factura ?? '',
        folio: '',
        pagado: '',
        fecha_pago: '',
      });
    }
  }
  return filas;
}

/**
 * Carga facturas que ya existían antes de la plataforma.
 *
 * Es la única vía por la que entra una factura que aquí no se emitió, y se
 * marca como tal. Cuenta igual para el saldo —el cliente debe lo mismo— pero
 * queda distinguible: una cosa es lo que la plataforma vio suceder y otra lo
 * que le contaron que ya había pasado.
 *
 * Con `simular` revisa el archivo entero y no guarda nada. Esa pasada en seco
 * es el punto: en cobranza conviene ver los errores antes de meter doscientos
 * renglones, no después.
 */
/**
 * Cómo se puede llamar cada columna en el archivo.
 *
 * El encabezado lo escribe una persona en Excel y no tiene por qué adivinar el
 * nombre interno: «Fecha de factura», «Fecha factura» y «fecha» quieren decir
 * lo mismo. Aceptarlas todas cuesta esta tabla y evita que un archivo bien
 * hecho se rechace por una preposición.
 */
const COLUMNAS_ACEPTADAS = {
  id: ['id', 'servicio_id', 'id_servicio'],
  servicio: ['servicio', 'nombre', 'nombre_del_servicio', 'cliente'],
  periodo: ['periodo', 'mes', 'mes_de_servicio', 'periodo_de_servicio'],
  concepto: ['concepto', 'descripcion'],
  fecha_factura: ['fecha_factura', 'fecha_de_factura', 'fecha_de_la_factura', 'fecha', 'emision', 'fecha_de_emision'],
  dias_credito: ['dias_credito', 'dias_de_credito', 'credito', 'plazo'],
  importe: ['importe', 'monto', 'total', 'importe_de_factura'],
  folio: ['folio', 'folio_fiscal', 'uuid', 'factura'],
  pagado: ['pagado', 'pagada', 'ya_se_pago', 'esta_pagada', 'cobrada'],
  fecha_pago: ['fecha_pago', 'fecha_de_pago', 'fecha_del_pago'],
};

function acomodarColumnas(fila) {
  const out = { _fila: fila._fila };
  for (const [clave, nombres] of Object.entries(COLUMNAS_ACEPTADAS)) {
    for (const nombre of nombres) {
      if (fila[nombre] !== undefined && String(fila[nombre]).trim() !== '') {
        out[clave] = fila[nombre];
        break;
      }
    }
  }
  return out;
}

export function cargarFacturas(filasCrudas, usuario, { simular = false } = {}) {
  const db = getDb();
  if (!Array.isArray(filasCrudas) || !filasCrudas.length) {
    throw new ValidacionError('El archivo no trae ningún renglón.');
  }
  const filas = filasCrudas.map(acomodarColumnas);

  const activos = db.prepare("SELECT id, servicio, dias_credito, forma_pago FROM servicios").all();
  const porId = new Map(activos.map((s) => [s.id, s]));
  const porNombre = new Map();
  for (const s of activos) {
    const clave = s.servicio.trim().toUpperCase();
    porNombre.set(clave, porNombre.has(clave) ? 'ambiguo' : s);
  }

  const yaExiste = db.prepare('SELECT id FROM facturas WHERE servicio_id = ? AND periodo = ? AND concepto = ?');
  const insertar = db.prepare(
    `INSERT INTO facturas
       (servicio_id, periodo, concepto, folio, fecha_factura, dias_credito, fecha_vencimiento,
        importe, importe_pagado, fecha_pago, forma_pago, carga_inicial, creado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`
  );

  const errores = [];
  const listas = [];
  const tocados = new Set();
  const vistas = new Set();

  for (const fila of filas) {
    const renglon = fila._fila || filas.indexOf(fila) + 2;
    const falla = (motivo) => errores.push({ fila: renglon, servicio: fila.servicio || '', motivo });

    // --- a qué servicio se le carga
    let servicio = null;
    if (fila.id) servicio = porId.get(Number(fila.id)) || null;
    if (!servicio && fila.servicio) {
      const hallado = porNombre.get(String(fila.servicio).trim().toUpperCase());
      if (hallado === 'ambiguo') {
        falla('Hay más de un servicio con ese nombre. Deja la columna «id» que trae la plantilla.');
        continue;
      }
      servicio = hallado || null;
    }
    if (!servicio) { falla('No se encontró ese servicio en el estado de fuerza.'); continue; }

    // --- periodo, concepto y fecha
    const periodo = String(fila.periodo || '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodo)) { falla('El periodo debe venir como AAAA-MM.'); continue; }

    const concepto = String(fila.concepto || 'Mes completo').trim() || 'Mes completo';
    const fecha = leerFecha(fila.fecha_factura);
    if (!fecha) { falla('Falta la fecha de la factura o no se entiende.'); continue; }

    const importe = leerImporte(fila.importe);
    if (!(importe > 0)) { falla('El importe tiene que ser un número mayor que cero.'); continue; }

    // --- duplicados: contra la base y contra el propio archivo
    const clave = `${servicio.id}·${periodo}·${concepto}`;
    if (vistas.has(clave)) { falla('Ese servicio, periodo y concepto vienen repetidos en el archivo.'); continue; }
    if (yaExiste.get(servicio.id, periodo, concepto)) {
      falla('Ya hay una factura registrada para ese servicio, periodo y concepto.');
      continue;
    }
    vistas.add(clave);

    const dias =
      fila.dias_credito !== undefined && String(fila.dias_credito).trim() !== ''
        ? Math.max(0, Math.round(Number(fila.dias_credito) || 0))
        : Math.max(0, Math.round(Number(servicio.dias_credito) || 0));

    const pagada = leerSiNo(fila.pagado);
    const fechaPago = pagada ? leerFecha(fila.fecha_pago) || fecha : null;
    if (fechaPago && fechaPago < fecha) {
      falla('La fecha de pago es anterior a la de la factura.');
      continue;
    }

    listas.push({
      servicio_id: servicio.id,
      servicio: servicio.servicio,
      periodo,
      concepto,
      folio: String(fila.folio || '').trim() || null,
      fecha_factura: fecha,
      dias_credito: dias,
      fecha_vencimiento: vencimientoDe(fecha, dias),
      importe,
      importe_pagado: pagada ? importe : 0,
      fecha_pago: fechaPago,
      forma_pago: servicio.forma_pago || null,
    });
    tocados.add(servicio.id);
  }

  const resumen = {
    renglones: filas.length,
    listas: listas.length,
    errores,
    importe: Math.round(listas.reduce((a, f) => a + f.importe, 0) * 100) / 100,
    pagadas: listas.filter((f) => f.importe_pagado > 0).length,
    porCobrar:
      Math.round(listas.reduce((a, f) => a + (f.importe - f.importe_pagado), 0) * 100) / 100,
  };

  if (simular || !listas.length) return { ...resumen, simulacion: true, cargadas: 0 };

  db.transaction(() => {
    for (const f of listas) {
      insertar.run(
        f.servicio_id, f.periodo, f.concepto, f.folio, f.fecha_factura, f.dias_credito,
        f.fecha_vencimiento, f.importe, f.importe_pagado, f.fecha_pago, f.forma_pago,
        usuario?.id ?? null
      );
    }
    for (const id of tocados) recalcular(db, id);
    auditar(db, {
      usuario,
      accion: 'carga_cobranza',
      entidad: 'facturacion',
      entidad_id: null,
      detalle: `Carga inicial: ${listas.length} factura(s) por ${resumen.importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} en ${tocados.size} servicio(s)`,
    });
  })();

  return { ...resumen, simulacion: false, cargadas: listas.length, servicios: tocados.size };
}

/**
 * Registra un pago contra una factura.
 *
 * Acepta pagos parciales —el cliente que abona la mitad es cosa de todos los
 * días— y no deja cobrar de más: el importe se topa al saldo, porque un cobro
 * mayor que la factura no es un pago, es otro asunto que aquí no se representa.
 */
export function registrarPago(payload, usuario) {
  const db = getDb();
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(Number(payload.factura_id));
  if (!factura) throw new ValidacionError('Esa factura no existe.');
  if (factura.cancelada) throw new ValidacionError('Esa factura está cancelada: no admite pagos.');

  const saldo = Math.round(((Number(factura.importe) || 0) - (Number(factura.importe_pagado) || 0)) * 100) / 100;
  if (saldo <= 0) throw new ValidacionError('Esa factura ya está pagada.');

  const importe = payload.importe === undefined || payload.importe === '' ? saldo : importeValido(payload.importe, 'El pago');
  if (importe > saldo) {
    throw new ValidacionError(
      `El pago (${importe}) es mayor que el saldo de la factura (${saldo}). Registra el saldo exacto o revisa la factura.`
    );
  }

  const fecha = String(payload.fecha || hoy()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidacionError('Indica la fecha del pago (AAAA-MM-DD).');
  if (fecha < factura.fecha_factura) {
    throw new ValidacionError('El pago no puede ser anterior a la fecha de la factura.');
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO pagos (factura_id, fecha, importe, forma_pago, referencia, usuario_id, usuario)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      factura.id, fecha, importe,
      payload.forma_pago || factura.forma_pago || null,
      payload.referencia || null,
      usuario?.id ?? null, usuario?.nombre || 'sistema'
    );

    db.prepare(
      `UPDATE facturas
          SET importe_pagado = importe_pagado + ?, fecha_pago = ?,
              forma_pago = COALESCE(?, forma_pago)
        WHERE id = ?`
    ).run(importe, fecha, payload.forma_pago || null, factura.id);

    recalcular(db, factura.servicio_id);

    const servicio = db.prepare('SELECT servicio FROM servicios WHERE id = ?').get(factura.servicio_id);
    const restante = Math.round((saldo - importe) * 100) / 100;
    auditar(db, {
      usuario,
      accion: 'pago',
      entidad: 'servicio',
      entidad_id: factura.servicio_id,
      detalle: `${servicio?.servicio || ''} — pago de ${importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} a la factura de ${factura.concepto.toLowerCase()} ${factura.periodo}${restante > 0 ? ` (quedan ${restante})` : ' (saldada)'}`,
    });

    return { pagado: importe, saldo: restante, saldada: restante <= 0 };
  });

  return tx();
}

/**
 * Adjunta el PDF (o el XML) a una factura ya registrada.
 *
 * Va aparte de registrarla porque el papel no siempre llega al mismo tiempo: se
 * emite la factura, se manda a timbrar y el archivo aparece después. Obligar a
 * tenerlo desde el principio significaría no registrar el cobro hasta que
 * llegue el PDF, y el saldo no puede esperar a un archivo.
 */
export function adjuntarArchivo(id, datos, usuario) {
  const db = getDb();
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(Number(id));
  if (!factura) throw new ValidacionError('Esa factura no existe.');

  const anterior = factura.archivo;
  db.prepare(
    `UPDATE facturas SET archivo = ?, archivo_nombre = ?, archivo_tipo = ?, archivo_bytes = ?
      WHERE id = ?`
  ).run(datos.archivo, datos.archivo_nombre, datos.archivo_tipo, datos.archivo_bytes, factura.id);

  const servicio = db.prepare('SELECT servicio FROM servicios WHERE id = ?').get(factura.servicio_id);
  auditar(db, {
    usuario,
    accion: 'factura_archivo',
    entidad: 'servicio',
    entidad_id: factura.servicio_id,
    detalle: `${servicio?.servicio || ''} — se adjuntó ${datos.archivo_nombre} a la factura de ${factura.concepto.toLowerCase()} ${factura.periodo}`,
  });

  return { archivo_nombre: datos.archivo_nombre, reemplazo: anterior || null };
}

export function facturaPorId(id) {
  return getDb().prepare('SELECT * FROM facturas WHERE id = ?').get(Number(id)) || null;
}

/**
 * Cancela una factura mal registrada.
 *
 * No la borra: la deja marcada con su motivo y fuera del saldo. Borrarla haría
 * desaparecer el renglón que explica por qué la cuenta decía otra cosa la
 * semana pasada, y la cobranza es justo donde eso no se puede permitir.
 */
export function cancelarFactura(id, motivo, usuario) {
  const db = getDb();
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(Number(id));
  if (!factura) throw new ValidacionError('Esa factura no existe.');
  if (factura.cancelada) throw new ValidacionError('Esa factura ya estaba cancelada.');
  if ((Number(factura.importe_pagado) || 0) > 0) {
    throw new ValidacionError(
      'Esa factura ya tiene pagos registrados. Cancelarla dejaría el dinero cobrado sin nada que lo respalde.'
    );
  }
  const razon = String(motivo || '').trim();
  if (razon.length < 5) throw new ValidacionError('Escribe el motivo de la cancelación.');

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE facturas
          SET cancelada = 1, motivo_cancelacion = ?, cancelada_por = ?, cancelada_en = datetime('now')
        WHERE id = ?`
    ).run(razon, usuario?.nombre || 'sistema', factura.id);
    recalcular(db, factura.servicio_id);

    const servicio = db.prepare('SELECT servicio FROM servicios WHERE id = ?').get(factura.servicio_id);
    auditar(db, {
      usuario,
      accion: 'factura_cancelada',
      entidad: 'servicio',
      entidad_id: factura.servicio_id,
      detalle: `${servicio?.servicio || ''} — se canceló la factura de ${factura.concepto.toLowerCase()} ${factura.periodo} · ${razon}`,
    });
  });

  tx();
  return { cancelada: true };
}
