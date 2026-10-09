/**
 * Los movimientos del mes: aperturas y cancelaciones, vistas por periodo.
 *
 * Antes las dos pantallas eran una lista de los últimos 400 renglones, sin
 * cortar por nada. Con quinientas aperturas de tres años eso no es una lista,
 * es un archivero volcado en el suelo: para saber qué pasó en agosto había que
 * ir bajando hasta que las fechas cambiaran de mes, y las preguntas que
 * cualquiera hace —cuántas fueron, cuántos guardias, cuánto dinero— no tenían
 * respuesta en ningún lado.
 *
 * El mes es la unidad natural del negocio: así se cierra el estado de fuerza,
 * así se factura y así se reporta. Todo aquí se organiza por mes.
 *
 * El monto, y por qué a veces no hay
 * ----------------------------------
 * Un movimiento no guarda cuánto vale al mes; guarda guardias. El valor se
 * deduce, y hay tres caminos, en este orden:
 *
 *   1. El precio por guardia capturado en el propio movimiento. Es el mejor:
 *      es el precio que se pactó ese día.
 *   2. El importe mensual del servicio, repartido entre sus guardias. Sirve
 *      para los movimientos ya ligados a un servicio.
 *   3. El precio por guardia que traiga la ficha del servicio.
 *
 * Cuando ninguno aplica, el monto es nulo y se dice cuántos renglones quedaron
 * así. Un total que se calla lo que no pudo sumar miente por omisión, y aquí lo
 * que se sabe con certeza es poco: de las 336 cancelaciones del archivo, solo
 * 26 traen el servicio ligado.
 */

import { getDb } from './db';
import { anioActual, mesActual } from './fechas';
import { porArrancar } from './dias';

export const CLASES = {
  aperturas: {
    tabla: 'aperturas',
    ruta: '/aperturas',
    titulo: 'Aperturas',
    signo: 1,
    tipos: ['APERTURA', 'INCREMENTO', 'TEMPORAL'],
    verbo: 'aperturados',
  },
  cancelaciones: {
    tabla: 'cancelaciones',
    ruta: '/cancelaciones',
    titulo: 'Cancelaciones y reducciones',
    signo: -1,
    tipos: ['CANCELACION', 'REDUCCION'],
    verbo: 'retirados',
  },
};

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Cuánto vale al mes este movimiento. Devuelve también de dónde salió la cifra,
 * porque «$40,000 porque así se capturó» y «$40,000 porque lo repartimos entre
 * los guardias del servicio» no son la misma clase de dato.
 */
export function montoDe(f) {
  const guardias = Number(f.guardias) || 0;
  if (guardias <= 0) return { monto: null, origen: null };

  if (Number(f.precio_guardia) > 0) {
    return { monto: redondear(Number(f.precio_guardia) * guardias), origen: 'capturado' };
  }
  if (Number(f.s_importe) > 0) {
    // Si el servicio ya quedó en cero guardias —una cancelación total— el
    // repartidor es el propio movimiento: se llevó el servicio entero.
    const entre = Number(f.s_guardias) > 0 ? Number(f.s_guardias) : guardias;
    return { monto: redondear((Number(f.s_importe) / entre) * guardias), origen: 'del servicio' };
  }
  if (Number(f.s_precio) > 0) {
    return { monto: redondear(Number(f.s_precio) * guardias), origen: 'del servicio' };
  }
  return { monto: null, origen: null };
}

const SELECT = (clase) => `
  SELECT m.*, s.estatus AS estatus_servicio,
         s.importe_factura AS s_importe, s.total_guardias AS s_guardias, s.precio_guardia AS s_precio,
         s.razon_social AS s_razon_social, s.zona AS s_zona, s.asesor AS s_asesor, s.gerente AS s_gerente,
         s.direccion AS s_direccion, s.turnos_json AS s_turnos, s.esquema_facturacion AS s_esquema,
         s.dias_credito AS s_dias_credito, s.forma_pago AS s_forma_pago, s.tiene_contrato AS s_contrato,
         s.importe_pendiente AS s_pendiente, s.saldo_vencido AS s_vencido, s.fecha_alta AS s_alta
    FROM ${CLASES[clase].tabla} m
    LEFT JOIN servicios s ON s.id = m.servicio_id`;

/**
 * Las altas técnicas de la carga inicial no son movimientos del mes: son el
 * apunte contable de que un servicio ya existía cuando la plataforma arrancó.
 * Contarlas como aperturas de enero de 2026 inflaría ese mes con doscientas
 * altas que en la calle no pasaron.
 */
const SIN_CARGA = (clase) => (clase === 'aperturas' ? 'm.carga_inicial = 0' : '1=1');

function hidratar(f) {
  const { monto, origen } = montoDe(f);
  return {
    ...f,
    turnos: JSON.parse(f.turnos_json || '{}'),
    turnosServicio: f.s_turnos ? JSON.parse(f.s_turnos) : null,
    monto,
    origenMonto: origen,
    // Si el servicio que salió de esta apertura todavía no arranca. El
    // expediente decía «ACTIVO · 7 guardias» de un servicio con alta del 28,
    // que es justo lo que hacía creer que ya estaba contando.
    por_arrancar: porArrancar({ fecha_alta: f.s_alta }),
  };
}

/** Los años que tienen algo, para no ofrecer navegar a la nada. */
export function aniosCon(clase) {
  const filas = getDb()
    .prepare(
      `SELECT DISTINCT substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 4) AS anio
         FROM ${CLASES[clase].tabla} m WHERE ${SIN_CARGA(clase)} ORDER BY anio DESC`
    )
    .all()
    .map((r) => Number(r.anio))
    .filter((n) => n >= 2000 && n <= 2100);
  return filas.length ? filas : [anioActual()];
}

/** El año entero, mes por mes, para la barra de arriba. */
export function calendarioDe(clase, anio) {
  const db = getDb();
  const a = Number(anio) || anioActual();
  const filas = db
    .prepare(
      `${SELECT(clase)}
        WHERE ${SIN_CARGA(clase)} AND substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 4) = ?`
    )
    .all(String(a))
    .map(hidratar);

  const meses = Array.from({ length: 12 }, (_, i) => {
    const periodo = `${a}-${String(i + 1).padStart(2, '0')}`;
    const suyas = filas.filter((f) => (f.periodo || f.fecha || '').slice(0, 7) === periodo);
    return {
      mes: i + 1,
      periodo,
      movimientos: suyas.length,
      guardias: suyas.reduce((x, f) => x + (f.guardias || 0), 0),
      monto: redondear(suyas.reduce((x, f) => x + (f.monto || 0), 0)),
      futuro: periodo > mesActual(),
    };
  });

  return {
    anio: a,
    meses,
    total: {
      movimientos: filas.length,
      guardias: filas.reduce((x, f) => x + (f.guardias || 0), 0),
      monto: redondear(filas.reduce((x, f) => x + (f.monto || 0), 0)),
    },
  };
}

/**
 * Los movimientos de un mes, con todo lo que se capturó de cada uno.
 *
 * Con `periodo` vacío devuelve el histórico completo, que es la vista vieja:
 * sigue estando para cuando alguien busca un folio y no recuerda de qué mes era.
 */
export function movimientosDe(
  clase,
  periodo,
  { zona = '', asesor = '', tipo = '', q = '', sinAplicar = false, descartadas = false, desdePeriodo = '', hastaPeriodo = '' } = {}
) {
  const db = getDb();
  const where = [SIN_CARGA(clase)];
  const args = [];

  if (periodo) {
    where.push("substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 7) = ?");
    args.push(periodo);
  }
  /**
   * Un rango de meses, además del mes exacto.
   *
   * Hacía falta para poder partir las aperturas sin aplicar entre las que
   * todavía se pueden atender y el arrastre de la importación. Se compara sobre
   * la misma expresión que el filtro de mes —`COALESCE(periodo, fecha,
   * creado_en)`— y no sobre `periodo` a secas: hay movimientos del archivo que
   * traen fecha y no periodo, y compararlos por una columna que viene nula los
   * dejaría fuera de los dos lados del corte, o sea desaparecidos.
   *
   * Las claves son 'AAAA-MM' y la comparación es de texto, que para ese formato
   * ordena igual que una fecha.
   */
  if (/^\d{4}-\d{2}$/.test(desdePeriodo)) {
    where.push('substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 7) >= ?');
    args.push(desdePeriodo);
  }
  if (/^\d{4}-\d{2}$/.test(hastaPeriodo)) {
    where.push('substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 7) <= ?');
    args.push(hastaPeriodo);
  }
  if (zona) { where.push('m.zona = ?'); args.push(zona); }
  if (asesor) { where.push('m.asesor = ?'); args.push(asesor); }
  if (tipo) { where.push('m.tipo = ?'); args.push(tipo); }
  // Pendiente = sin servicio y sin descartar. Una descartada ya se revisó y se
  // decidió que no va; seguir contándola como pendiente sería no dejar nunca
  // que la lista llegue a cero.
  if (sinAplicar) where.push('m.servicio_id IS NULL AND m.descartada = 0');
  if (descartadas) where.push('m.descartada = 1');
  if (q) {
    where.push('(m.servicio LIKE ? OR m.folio LIKE ? OR m.razon_social LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const filas = db
    .prepare(
      `${SELECT(clase)} WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(m.fecha, m.creado_en) DESC, m.id DESC
        LIMIT ${periodo ? 500 : 400}`
    )
    .all(...args)
    .map(hidratar);

  return { movimientos: filas, resumen: resumirlos(clase, filas) };
}

function resumirlos(clase, filas) {
  const porTipo = {};
  for (const t of CLASES[clase].tipos) porTipo[t] = { movimientos: 0, guardias: 0, monto: 0 };

  let guardias = 0;
  let monto = 0;
  let sinMonto = 0;
  let cxc = 0;
  const turnos = {};
  const zonas = {};

  for (const f of filas) {
    const t = porTipo[f.tipo] || (porTipo[f.tipo] = { movimientos: 0, guardias: 0, monto: 0 });
    t.movimientos++;
    t.guardias += f.guardias || 0;
    t.monto += f.monto || 0;

    guardias += f.guardias || 0;
    if (f.monto === null) sinMonto++;
    else monto += f.monto;
    cxc += Number(f.cxc) || 0;

    for (const [k, v] of Object.entries(f.turnos)) turnos[k] = (turnos[k] || 0) + (Number(v) || 0);
    const z = f.zona || f.s_zona || 'Sin zona';
    zonas[z] = (zonas[z] || 0) + (f.guardias || 0);
  }

  for (const t of Object.values(porTipo)) t.monto = redondear(t.monto);

  return {
    movimientos: filas.length,
    guardias,
    monto: redondear(monto),
    sinMonto,
    cxc: redondear(cxc),
    porTipo,
    turnos: Object.entries(turnos).sort((a, b) => b[1] - a[1]),
    zonas: Object.entries(zonas).sort((a, b) => b[1] - a[1]).slice(0, 6),
    servicios: new Set(filas.map((f) => f.servicio_id || f.servicio)).size,
  };
}

/**
 * Meses hacia atrás que cuentan como «reciente».
 *
 * Ventana móvil y no «año en curso» a propósito: con el año en curso, el 1 de
 * enero el aviso se vacía de golpe y los pendientes que seguían vivos el 31 de
 * diciembre pasan al cajón de lo viejo sin que nadie haya decidido nada.
 */
export const MESES_RECIENTE = 12;

/** Un mes 'AAAA-MM' corrido n meses hacia atrás. */
function mesMenos(mes, n) {
  const [anio, m] = String(mes).split('-').map(Number);
  // Se cuenta en meses absolutos para no tener que tratar aparte el cruce de
  // año: diciembre menos un mes no es «mes 0 del mismo año».
  const total = anio * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Las aperturas sin aplicar, partidas por antigüedad.
 *
 * Esto sale del hallazgo más incómodo de la auditoría. El aviso de la pantalla
 * de Aperturas llevaba meses diciendo «219 aperturas sin aplicar · 875 guardias
 * que no están sumando», en una caja ámbar, arriba de todo. Nunca bajaba, y no
 * podía bajar: las 219 son todas de la importación inicial —`registrarApertura()`
 * siempre crea o amplía un servicio, así que la plataforma no puede generar una
 * apertura pendiente nueva— y las de 2023 a 2025 describen servicios que hace
 * tiempo no operan. Aplicarlas inventaría doscientos servicios que no están en
 * la calle; no aplicarlas dejaba el aviso encendido para siempre.
 *
 * El costo de eso no es el aviso: es que enseñó a la operación a pasar por
 * encima de los avisos ámbar. Un número que no se puede llevar a cero no es un
 * pendiente, es decoración, y conviviendo con él los avisos que sí piden algo
 * se leen igual de poco.
 *
 * Así que la cuenta de arriba pasa a ser solo lo que todavía se puede atender,
 * y el arrastre se dice una vez, en gris y sin caja de alarma, con su enlace
 * para quien quiera revisarlo.
 *
 * @returns {{ recientes: {n:number, guardias:number, desde:string|null},
 *             viejas:    {n:number, guardias:number, desde:string|null, hasta:string|null},
 *             total:     {n:number, guardias:number},
 *             corte: string }}   corte = 'AAAA-MM', el último mes que cuenta como viejo
 */
export function pendientesPorAntiguedad() {
  const corte = mesMenos(mesActual(), MESES_RECIENTE);
  const mes = 'substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 7)';

  const lado = (comparador) =>
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(m.guardias), 0) AS guardias,
                MIN(${mes}) AS primero, MAX(${mes}) AS ultimo
           FROM aperturas m
          WHERE ${SIN_CARGA('aperturas')} AND m.servicio_id IS NULL AND m.descartada = 0
            AND ${mes} ${comparador} ?`
      )
      .get(corte);

  const recientes = lado('>');
  const viejas = lado('<=');

  return {
    /*
     * `desde` y `hasta` son los extremos reales de cada lado, no el corte.
     * Hacen falta los dos del lado viejo porque la línea de la pantalla dice
     * «otras N aperturas de 2023 a 2025», y esos dos años tienen que salir de
     * los datos: escritos a mano quedarían congelados el día que alguien
     * descarte las más viejas, y entonces la línea mentiría sobre lo que queda.
     */
    recientes: { n: recientes.n, guardias: recientes.guardias, desde: recientes.primero || null },
    viejas: {
      n: viejas.n,
      guardias: viejas.guardias,
      desde: viejas.primero || null,
      hasta: viejas.ultimo || null,
    },
    total: { n: recientes.n + viejas.n, guardias: recientes.guardias + viejas.guardias },
    corte,
  };
}

/**
 * Las opciones de `movimientosDe()` que corresponden a cada lado del corte.
 *
 * Existe para que el límite se calcule en un solo sitio. Si la pantalla
 * compusiera el rango por su cuenta, el aviso contaría con un corte y la lista
 * a la que enlaza traería otro —basta un mes de diferencia—, y quien diera clic
 * en «15 aperturas sin aplicar» vería dieciséis renglones. Es el mismo criterio
 * por el que el filtro de «le falta capturar» del estado de fuerza usa la
 * función de `lib/alta.js` en vez de un WHERE escrito a mano.
 *
 * `todas` existe para quien venga de un enlace viejo o quiera el total: lo que
 * se deja de contar en el aviso sigue estando alcanzable.
 */
export function filtroDePendientes(cual) {
  const corte = mesMenos(mesActual(), MESES_RECIENTE);
  if (cual === 'viejas') return { sinAplicar: true, hastaPeriodo: corte };
  if (cual === 'todas') return { sinAplicar: true };
  return { sinAplicar: true, desdePeriodo: mesMenos(corte, -1) };
}

/**
 * Lo que entró y lo que salió el mismo mes. Cada pantalla enseña su lado, pero
 * el número que de verdad se pregunta en la junta es el neto: si en agosto se
 * abrieron 64 guardias y se cancelaron 18, la fuerza creció 46.
 */
export function netoDelPeriodo(periodo) {
  const db = getDb();
  const uno = (clase) => {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(m.guardias), 0) AS g
           FROM ${CLASES[clase].tabla} m
          WHERE ${SIN_CARGA(clase)} AND substr(COALESCE(m.periodo, m.fecha, m.creado_en), 1, 7) = ?`
      )
      .get(periodo);
    return { movimientos: r.n, guardias: r.g };
  };
  const alta = uno('aperturas');
  const baja = uno('cancelaciones');
  return { alta, baja, neto: alta.guardias - baja.guardias };
}
