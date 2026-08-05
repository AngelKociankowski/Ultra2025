/**
 * El aumento anual de precio.
 *
 * Cada servicio tiene pactado un mes en el que se le revisa el precio al
 * cliente, y no es el mismo para todos: unos en febrero, otros en octubre,
 * según cuándo se firmó. En el archivo eso vive en dos columnas —el mes en que
 * toca y el último año en que se hizo— y de ahí sale la única pregunta que
 * importa el primer día de cada mes: **a quién le toca y no se le ha subido**.
 *
 * Cómo se lee el precio en esta plataforma
 * ----------------------------------------
 * El precio del cliente es el **importe mensual de factura**, no el precio por
 * guardia. Eso no es una decisión de diseño, es lo que dicen los datos: 205 de
 * los 222 servicios activos traen importe de factura capturado y solo 5 traen
 * precio por guardia. Así que el importe manda y los demás lo acompañan:
 *
 *   importe_factura  ← el ancla, lo que se le cobra al mes
 *   importe_sin_iva  ← el mismo importe antes de IVA
 *   precio_guardia   ← lo que sale por cada guardia
 *
 * Cuando sube el precio, los tres suben en la misma proporción, y solo los que
 * estaban capturados: a un servicio que nunca tuvo precio por guardia no se le
 * inventa uno al aumentarle el importe.
 *
 * Lo que un aumento NO toca
 * -------------------------
 *  - Las facturas ya emitidas. Cada una guarda su propio importe, así que lo
 *    ya cobrado no se reescribe: subir el precio en agosto no cambia lo que se
 *    facturó en julio, ni el saldo que el cliente debe de entonces.
 *  - El sueldo del guardia. Es costo, no precio, y sube por su propia razón.
 */

import { getDb, auditar } from './db';
import { aplicarFactor } from './partidas';
import { hoy, mesActual } from './fechas';
import { ValidacionError } from './errores';

export const IVA = 0.16;

export const MESES = [
  '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Cómo se pidió el cambio. El % efectivo se calcula siempre, venga como venga. */
export const TIPOS = {
  PORCENTAJE: { etiqueta: 'Porcentaje', ayuda: 'Sube el precio de cada servicio en ese porcentaje.' },
  MONTO: { etiqueta: 'Monto fijo', ayuda: 'Le suma esa cantidad al importe mensual de cada servicio.' },
  IMPORTE: { etiqueta: 'Importe nuevo', ayuda: 'Deja el importe mensual en esa cantidad exacta.' },
};

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Reconoce el mes venga como venga escrito. Los archivos traen «Febrero»,
 * «febrero», a veces con espacios; y alguna vez el número.
 */
export function numeroDeMes(texto) {
  const t = String(texto ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  const sinAcentos = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const i = MESES.findIndex((m) => m && m.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === sinAcentos);
  return i > 0 ? i : null;
}

export function nombreDeMes(n) {
  return MESES[Number(n)] || null;
}

/**
 * ¿A este servicio le toca aumento?
 *
 *   vencido      — su mes ya pasó y sigue con el precio del año pasado
 *   este_mes     — le toca ahora
 *   proximo      — le toca más adelante este año
 *   al_corriente — ya se le subió este año
 *   sin_fecha    — nunca se anotó en qué mes se le revisa
 */
export function estadoDeAumento(servicio, referencia = hoy()) {
  const anioHoy = Number(referencia.slice(0, 4));
  const mesHoy = Number(referencia.slice(5, 7));
  const anio = Number(servicio.anio_ultimo_incremento) || null;
  const mes = numeroDeMes(servicio.mes_incremento);

  if (anio && anio >= anioHoy) return 'al_corriente';
  if (!mes) return 'sin_fecha';
  if (mes < mesHoy) return 'vencido';
  if (mes === mesHoy) return 'este_mes';
  return 'proximo';
}

export const ETIQUETA_ESTADO = {
  vencido: 'Se le pasó',
  este_mes: 'Le toca este mes',
  proximo: 'Más adelante',
  al_corriente: 'Ya subió este año',
  sin_fecha: 'Sin mes anotado',
};

/** El importe del que se parte: el de factura y, si no hay, el precio unitario. */
function anclaDe(s) {
  const importe = Number(s.importe_factura) || 0;
  if (importe > 0) return { campo: 'importe_factura', valor: importe };
  const precio = Number(s.precio_guardia) || 0;
  if (precio > 0) return { campo: 'precio_guardia', valor: precio };
  return null;
}

/**
 * Qué quedaría en la ficha si se aplicara este ajuste. Aritmética pura: la
 * pantalla la usa para enseñar la vista previa y el servidor la vuelve a correr
 * al aplicar, sin creerle al navegador.
 */
export function calcular(servicio, ajuste) {
  const { tipo, valor } = ajuste;
  const n = Number(valor);
  if (!TIPOS[tipo]) throw new ValidacionError('Tipo de ajuste desconocido.');
  if (!Number.isFinite(n)) throw new ValidacionError('Escribe cuánto sube el precio.');

  const ancla = anclaDe(servicio);
  if (!ancla) {
    return { aplicable: false, razon: 'No tiene precio capturado, así que no hay de dónde partir.' };
  }

  let factor;
  if (tipo === 'PORCENTAJE') {
    if (n <= -100) throw new ValidacionError('Un descuento no puede ser del 100 % o más.');
    factor = 1 + n / 100;
  } else if (tipo === 'MONTO') {
    factor = (ancla.valor + n) / ancla.valor;
  } else {
    if (n <= 0) throw new ValidacionError('El importe nuevo tiene que ser mayor que cero.');
    factor = n / ancla.valor;
  }

  const nuevo = redondear(ancla.valor * factor);
  if (nuevo <= 0) {
    return { aplicable: false, razon: 'El resultado dejaría el precio en cero o en negativo.' };
  }

  // Solo se mueve lo que ya estaba capturado: al servicio que nunca tuvo precio
  // por guardia no se le inventa uno de paso.
  const mover = (v) => (Number(v) > 0 ? redondear(Number(v) * factor) : null);

  return {
    aplicable: true,
    factor,
    porcentaje: redondear((factor - 1) * 100),
    ancla: ancla.campo,
    importe: { antes: Number(servicio.importe_factura) || null, despues: mover(servicio.importe_factura) },
    sinIva: { antes: Number(servicio.importe_sin_iva) || null, despues: mover(servicio.importe_sin_iva) },
    precio: { antes: Number(servicio.precio_guardia) || null, despues: mover(servicio.precio_guardia) },
    diferencia: redondear(nuevo - ancla.valor),
  };
}

// ------------------------------------------------------------------- agenda

const CAMPOS = `id, servicio, razon_social, zona, asesor, total_guardias, guardias_en_factura,
                precio_guardia, importe_factura, importe_sin_iva, mes_incremento, anio_ultimo_incremento`;

/**
 * La lista de trabajo: los servicios activos con su precio, cuándo les toca
 * revisión y cuándo fue la última.
 */
export function agenda({ estado = '', zona = '', asesor = '', q = '' } = {}) {
  const db = getDb();
  const where = ["estatus = 'ACTIVO'"];
  const args = [];
  if (zona) { where.push('zona = ?'); args.push(zona); }
  if (asesor) { where.push('asesor = ?'); args.push(asesor); }
  if (q) {
    where.push('(servicio LIKE ? OR razon_social LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }

  const referencia = hoy();
  const filas = db
    .prepare(`SELECT ${CAMPOS} FROM servicios WHERE ${where.join(' AND ')} ORDER BY servicio`)
    .all(...args)
    .map((s) => ({
      ...s,
      mes: numeroDeMes(s.mes_incremento),
      mesTexto: nombreDeMes(numeroDeMes(s.mes_incremento)),
      estado: estadoDeAumento(s, referencia),
      ultimoCambio: ultimoCambioDe(db, s.id),
    }));

  const resumen = { vencido: 0, este_mes: 0, proximo: 0, al_corriente: 0, sin_fecha: 0, importePendiente: 0 };
  for (const f of filas) {
    resumen[f.estado]++;
    if (f.estado === 'vencido' || f.estado === 'este_mes') {
      resumen.importePendiente += Number(f.importe_factura) || 0;
    }
  }
  resumen.facturacionMensual = filas.reduce((a, f) => a + (Number(f.importe_factura) || 0), 0);
  resumen.sinPrecio = filas.filter((f) => !anclaDe(f)).length;

  return {
    servicios: estado ? filas.filter((f) => f.estado === estado) : filas,
    resumen,
    referencia,
  };
}

function ultimoCambioDe(db, servicioId) {
  return (
    db
      .prepare(
        `SELECT tipo, porcentaje, vigente_desde, importe_anterior, importe_nuevo, usuario, creado_en
           FROM precios_historial WHERE servicio_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(servicioId) || null
  );
}

export function historialDe(servicioId) {
  return getDb()
    .prepare('SELECT * FROM precios_historial WHERE servicio_id = ? ORDER BY id DESC LIMIT 60')
    .all(Number(servicioId));
}

export function historialReciente(limite = 60) {
  return getDb()
    .prepare(
      `SELECT h.*, s.servicio, s.zona, s.asesor
         FROM precios_historial h JOIN servicios s ON s.id = h.servicio_id
        ORDER BY h.id DESC LIMIT ?`
    )
    .all(Number(limite) || 60);
}

// ------------------------------------------------------------------ aplicar

function exigirVigencia(v) {
  const s = String(v || '').trim() || mesActual();
  if (!/^\d{4}-\d{2}$/.test(s)) throw new ValidacionError('La vigencia se escribe como AAAA-MM.');
  const mes = Number(s.slice(5, 7));
  if (mes < 1 || mes > 12) throw new ValidacionError('Ese mes no existe.');
  return s;
}

/**
 * Sube (o baja) el precio de uno o de muchos servicios.
 *
 * Con `simular` hace todas las cuentas y no guarda nada: es la vista previa,
 * y sirve para que nadie mande un aumento a ciento y pico de clientes sin ver
 * antes en cuánto queda cada uno.
 *
 * El aumento se aplica al precio que está en la ficha hoy. Si el mismo servicio
 * se aumenta dos veces por error, la segunda parte del precio ya subido —igual
 * que en la vida real—, y el historial deja los dos movimientos a la vista.
 */
export function aplicar({ ids, ajuste, vigencia, motivo, fijarMes = false, simular = false }, usuario) {
  const db = getDb();
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!lista.length) throw new ValidacionError('Escoge al menos un servicio.');

  const desde = exigirVigencia(vigencia);
  const razon = String(motivo || '').trim();
  if (!simular && razon.length < 4) {
    throw new ValidacionError('Escribe el motivo del cambio: revisión anual, renegociación, lo que sea.');
  }
  if (!simular && ajuste?.tipo === 'IMPORTE' && lista.length > 1) {
    throw new ValidacionError(
      'Un importe fijo se le pone a un servicio a la vez: el mismo importe para varios clientes casi nunca es lo que se quiso.'
    );
  }

  const servicios = db
    .prepare(`SELECT ${CAMPOS}, estatus FROM servicios WHERE id IN (${lista.map(() => '?').join(',')})`)
    .all(...lista);

  const anio = desde.slice(0, 4);
  const mesVigencia = nombreDeMes(Number(desde.slice(5, 7)));

  const filas = [];
  const saltados = [];
  for (const s of servicios) {
    if (s.estatus !== 'ACTIVO') {
      saltados.push({ servicio: s.servicio, razon: 'Está dado de baja.' });
      continue;
    }
    const r = calcular(s, ajuste);
    if (!r.aplicable) {
      saltados.push({ servicio: s.servicio, razon: r.razon });
      continue;
    }
    filas.push({ s, r });
  }

  const totales = filas.reduce(
    (a, { r }) => ({
      antes: a.antes + (r.importe.antes || r.precio.antes || 0),
      despues: a.despues + (r.importe.despues || r.precio.despues || 0),
    }),
    { antes: 0, despues: 0 }
  );

  const previa = {
    vigencia: desde,
    aplicables: filas.length,
    saltados,
    totalAntes: redondear(totales.antes),
    totalDespues: redondear(totales.despues),
    diferencia: redondear(totales.despues - totales.antes),
    detalle: filas.map(({ s, r }) => ({
      id: s.id,
      servicio: s.servicio,
      zona: s.zona,
      porcentaje: r.porcentaje,
      importeAntes: r.importe.antes,
      importeDespues: r.importe.despues,
      precioAntes: r.precio.antes,
      precioDespues: r.precio.despues,
      diferencia: r.diferencia,
    })),
  };

  if (simular) return { simulacion: true, ...previa };
  if (!filas.length) {
    throw new ValidacionError(
      'Ninguno de los servicios escogidos se puede aumentar. ' +
        (saltados[0] ? saltados[0].razon : '')
    );
  }

  const lote = `PR-${desde}-${Date.now().toString(36).toUpperCase()}`;

  const tx = db.transaction(() => {
    for (const { s, r } of filas) {
      const sets = ['anio_ultimo_incremento = ?'];
      const args = [anio];
      if (r.importe.despues !== null) { sets.push('importe_factura = ?'); args.push(r.importe.despues); }
      if (r.sinIva.despues !== null) { sets.push('importe_sin_iva = ?'); args.push(r.sinIva.despues); }
      if (r.precio.despues !== null) { sets.push('precio_guardia = ?'); args.push(r.precio.despues); }
      // El mes pactado es del contrato, no de cuándo se ejecutó el aumento: solo
      // se escribe si no había ninguno, o si quien aplica pide fijarlo.
      if (fijarMes || !numeroDeMes(s.mes_incremento)) {
        sets.push('mes_incremento = ?');
        args.push(mesVigencia);
      }
      db.prepare(`UPDATE servicios SET ${sets.join(', ')}, actualizado_en = datetime('now') WHERE id = ?`)
        .run(...args, s.id);

      // El desglose por puesto sube en la misma proporción. Si no, el detalle
      // que se le enseña al cliente diría una cosa y el total otra.
      aplicarFactor(db, s.id, r.factor);

      db.prepare(
        `INSERT INTO precios_historial
           (servicio_id, tipo, porcentaje, vigente_desde, motivo, lote,
            importe_anterior, importe_nuevo, sin_iva_anterior, sin_iva_nuevo,
            precio_anterior, precio_nuevo, usuario_id, usuario)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        s.id, ajuste.tipo, r.porcentaje, desde, razon, lote,
        r.importe.antes, r.importe.despues, r.sinIva.antes, r.sinIva.despues,
        r.precio.antes, r.precio.despues, usuario?.id ?? null, usuario?.nombre ?? null
      );

      auditar(db, {
        usuario,
        accion: 'precio',
        entidad: 'servicio',
        entidad_id: s.id,
        detalle: `${s.servicio} — ${r.porcentaje > 0 ? '+' : ''}${r.porcentaje}% desde ${desde} · ${razon}`,
        cambios: {
          importe_factura: { antes: r.importe.antes, despues: r.importe.despues },
          precio_guardia: { antes: r.precio.antes, despues: r.precio.despues },
        },
      });
    }
  });
  tx();

  return { lote, ...previa };
}

/**
 * El otro camino por el que un precio cambia: alguien edita el importe a mano
 * en la ficha del servicio.
 *
 * Se registra en el mismo historial —como MANUAL— para que la respuesta a «¿por
 * qué este cliente paga esto?» sea una sola lista y no dos. Un cambio de precio
 * que no aparece en el historial de precios es un cambio que nadie va a
 * encontrar cuando lo busque.
 */
export function registrarCambioManual(db, servicioId, antes, despues, usuario) {
  const campos = ['importe_factura', 'importe_sin_iva', 'precio_guardia'];
  if (!campos.some((c) => despues[c] !== undefined && Number(antes[c] || 0) !== Number(despues[c] || 0))) return;

  const val = (o, c) => (o[c] === undefined || o[c] === null || o[c] === '' ? null : Number(o[c]));
  const importeAntes = val(antes, 'importe_factura');
  const importeDespues = despues.importe_factura === undefined ? importeAntes : val(despues, 'importe_factura');
  const pct =
    importeAntes && importeDespues ? redondear(((importeDespues - importeAntes) / importeAntes) * 100) : null;

  db.prepare(
    `INSERT INTO precios_historial
       (servicio_id, tipo, porcentaje, vigente_desde, motivo,
        importe_anterior, importe_nuevo, sin_iva_anterior, sin_iva_nuevo,
        precio_anterior, precio_nuevo, usuario_id, usuario)
     VALUES (?, 'MANUAL', ?, ?, ?, ?,?,?,?,?,?,?,?)`
  ).run(
    servicioId,
    pct,
    mesActual(),
    'Editado desde la ficha del servicio',
    importeAntes,
    importeDespues,
    val(antes, 'importe_sin_iva'),
    despues.importe_sin_iva === undefined ? val(antes, 'importe_sin_iva') : val(despues, 'importe_sin_iva'),
    val(antes, 'precio_guardia'),
    despues.precio_guardia === undefined ? val(antes, 'precio_guardia') : val(despues, 'precio_guardia'),
    usuario?.id ?? null,
    usuario?.nombre ?? null
  );
}
