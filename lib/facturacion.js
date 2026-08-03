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
    if (!programa.length) {
      sinCondiciones.push({ id: s.id, servicio: s.servicio, zona: s.zona, asesor: s.asesor });
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
      });
    }
    if (!pendiente) facturados++;
  }

  return { periodo: p, porFacturar, sinCondiciones, facturados };
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
