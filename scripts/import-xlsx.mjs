#!/usr/bin/env node
/**
 * Regenera data/seed.json leyendo el archivo Estado de Fuerza Ultra .xlsx
 * (y, opcionalmente, el de Aperturas y Cancelaciones).
 *
 *   node scripts/import-xlsx.mjs \
 *     --edo "C:/ruta/Estado de Fuerza Ultra 2026.xlsx" \
 *     [--mov "C:/ruta/Aperturas, Cancelaciones, ... 2025- 2026.xlsx"]
 *
 * Después:  npm run seed:reset
 *
 * ---------------------------------------------------------------------------
 * Cómo está armada cada pestaña del Estado de Fuerza
 * ---------------------------------------------------------------------------
 * Cada hoja mensual trae tres bloques y una tabla de comprobación:
 *
 *   fila 2      ESTADO DE FUERZA <MES> <AÑO>
 *   fila 3      encabezados (ZONA, TIPO, SUPERVISOR, ASESOR, …, TOTAL, …)
 *   ...         renglones del estado de fuerza
 *               subtotal (renglón sin zona, solo el TOTAL)
 *   "APERTURAS <MES> <AÑO>"
 *   ...         servicios abiertos ese mes — TAMBIÉN son estado de fuerza vigente
 *               subtotal
 *   "CANCELADOS REDUCCIONES <MES> <AÑO>"
 *   ...         bajas y reducciones del mes — NO son estado de fuerza
 *               subtotal
 *   ZONA/GUARDIAS y TIPO/GUARDIAS: la suma que la operación da por buena
 *
 * De ahí sale la cifra del mes: bloque principal + aperturas. En julio 2026 son
 * 869 + 11 = 880, que es justo lo que declara la tabla de comprobación de la
 * hoja. Por eso al final se contrasta cada periodo contra su propio resumen.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

/**
 * El build ESM de xlsx no expone readFile ni SSF, solo read(). Se le pasa el
 * buffer y las fechas seriales se convierten a mano (época 1900 de Excel, con
 * el 29-feb-1900 inexistente que la hoja de cálculo sí cuenta).
 */
const leerLibro = (ruta) => XLSX.read(fs.readFileSync(ruta), { type: 'buffer', cellDates: true });

function desdeSerial(n) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ------------------------------------------------------------------ argumentos

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const rutaEdo = arg('edo');
const rutaMov = arg('mov');
const salida = arg('out') || path.join(process.cwd(), 'data', 'seed.json');

if (!rutaEdo) {
  console.error('Falta la ruta del Estado de Fuerza. Uso:\n  node scripts/import-xlsx.mjs --edo "<Estado de Fuerza.xlsx>" [--mov "<Aperturas y Cancelaciones.xlsx>"]');
  process.exit(1);
}
for (const p of [rutaEdo, rutaMov].filter(Boolean)) {
  if (!fs.existsSync(p)) {
    console.error(`No existe el archivo: ${p}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------ utilidades

const MES = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7,
  AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12,
};

const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,%\s]/g, '');
  if (!s || ['-', 'TRUE', 'FALSE'].includes(s.toUpperCase()) || s.startsWith('#')) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const intOr = (n) => (n === null ? null : Math.round(n));

function boolv(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = norm(v);
  if (s === 'TRUE' || s === 'SI' || s === 'SÍ') return 1;
  if (s === 'FALSE' || s === 'NO') return 0;
  return null;
}

/** Fechas: serial de Excel, Date, dd/mm/yyyy o dd/mes/yyyy. */
function fecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Los seriales chicos son horas (0.29 = 7:00 am), no fechas.
    if (v < 1000) return null;
    const d = desdeSerial(v);
    if (!d || d.getUTCFullYear() < 1950 || d.getUTCFullYear() > 2100) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, d, mo, y0] = m;
    const y = y0.length === 2 ? `20${y0}` : y0;
    if (+y < 1950 || +y > 2100) return null;
    return `${y}-${String(+mo).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\/([^/]+)\/(\d{4})$/);
  if (m && MES[norm(m[2])]) {
    return `${m[3]}-${String(MES[norm(m[2])]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/** Matriz de la hoja conservando posiciones (las columnas vacías importan). */
function matriz(hoja) {
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null, blankrows: true });
}

// ------------------------------------------------------------ estado de fuerza

/** Turnos tal como los titula la hoja; el nombre normalizado es la llave. */
const TURNOS = ['10X14', '11X13', '12 HRS', '13X47', '8X16 L-S', '8X16 L-D', '24 HRS', '12X24', '12X36', '24X24', '24X48', '8 HRS'];

/** Los turnos del archivo de movimientos se titulan distinto que los del corte. */
const TURNOS_MOV = ['8X16 L-D', '8X16 L-S', '8X16 L-V', '12X12 L-D', '12X12 L-S', '12X12 L-V', '12X24', '12X36', '24X24', '24X48', '12X12', 'OTROS'];

/**
 * Mapa columna -> índice. Se queda con la primera aparición porque varias hojas
 * repiten el título "FACTURA" en tres columnas distintas.
 */
function indice(fila) {
  const ix = {};
  fila.forEach((c, i) => {
    const n = norm(c);
    if (n && ix[n] === undefined) ix[n] = i;
  });
  return ix;
}

const pick = (ix, ...nombres) => {
  for (const n of nombres) {
    const i = ix[norm(n)];
    if (i !== undefined) return i;
  }
  return -1;
};

const celda = (fila, i) => (i >= 0 && fila[i] !== undefined && fila[i] !== null ? fila[i] : '');
const texto = (fila, i) => String(celda(fila, i)).trim();

/**
 * Ubica la columna del nombre del servicio. Unas hojas la titulan
 * "SERVICIO COMO NOMINA", otras la dejan sin título y una la titula "MIANBAO";
 * lo estable es que va inmediatamente antes de RAZON SOCIAL.
 */
function columnaServicio(ix, cabecera) {
  const directa = pick(ix, 'SERVICIO COMO NOMINA', 'SERVICIO', 'NOMBRE DEL SERVICIO');
  if (directa >= 0) return directa;
  const razon = pick(ix, 'RAZON SOCIAL');
  if (razon > 0) return razon - 1;
  return cabecera.findIndex((c) => norm(c) === 'ZONA') + 4;
}

const ES_APERTURAS = /^APERTURAS\b/;
const ES_CANCELADOS = /^(CANCELAD|REDUCCION|BAJAS)/;
const ES_TOTAL = /^(TOTAL|TOTALES|SUMA|EDO DE FUERZA|ESTADO DE FUERZA|GRAN TOTAL)/;

/**
 * Título de sección en cualquier columna del renglón.
 *
 * Solo aplica a renglones sin datos: las observaciones de un servicio dicen
 * cosas como "Reducción 1/7/26" o "cancelación 3/7/26", que si no se filtran
 * se leen como el encabezado de la sección y se comen el renglón.
 */
function seccionDe(fila) {
  for (const c of fila) {
    const n = norm(c);
    if (!n || n.length < 6) continue;
    if (ES_APERTURAS.test(n)) return 'APERTURA';
    if (ES_CANCELADOS.test(n)) return 'CANCELACION';
  }
  return null;
}

/** Tabla de comprobación al pie: ZONA/GUARDIAS y TIPO/GUARDIAS. */
function resumenDeclarado(filas, desde) {
  const out = { total: null, zonas: {}, tipos: {} };
  let modo = null;
  for (let i = desde; i < filas.length; i++) {
    const f = filas[i] || [];
    for (let c = 0; c < f.length - 1; c++) {
      const a = norm(f[c]);
      const b = f[c + 1];
      if (!a) continue;
      if (a === 'ZONA' && norm(b) === 'GUARDIAS') { modo = 'zonas'; break; }
      if (a === 'TIPO' && norm(b) === 'GUARDIAS') { modo = 'tipos'; break; }
      const n = num(b);
      if (n === null || !modo) continue;
      if (a === 'TOTAL') out.total = Math.round(n);
      else out[modo][a] = Math.round(n);
      break;
    }
  }
  return out;
}

function leerHoja(hoja, nombreHoja) {
  const filas = matriz(hoja);

  // periodo: primero el título de la hoja, luego el nombre de la pestaña
  let periodo = null;
  for (let i = 0; i < Math.min(filas.length, 6); i++) {
    for (const c of filas[i] || []) {
      const m = norm(c).match(/ESTADO DE FUERZA\s+([A-Z]+)\s*(\d{4})/);
      if (m && MES[m[1]]) { periodo = `${m[2]}-${String(MES[m[1]]).padStart(2, '0')}`; break; }
    }
    if (periodo) break;
  }
  if (!periodo) {
    const m = norm(nombreHoja).match(/([A-Z]+)\s*(\d{4})/);
    if (m && MES[m[1]]) periodo = `${m[2]}-${String(MES[m[1]]).padStart(2, '0')}`;
  }
  if (!periodo) return null;

  // encabezados: el renglón que trae ZONA y TOTAL
  let hi = -1;
  for (let i = 0; i < Math.min(filas.length, 12); i++) {
    const up = (filas[i] || []).map(norm);
    if (up.includes('ZONA') && up.includes('TOTAL')) { hi = i; break; }
  }
  if (hi < 0) return null;

  const cab = filas[hi];
  const ix = indice(cab);
  const cServicio = columnaServicio(ix, cab);
  const cZona = pick(ix, 'ZONA');
  const cTotal = pick(ix, 'TOTAL');
  if (cZona < 0 || cTotal < 0) return null;

  const cols = {
    razon: pick(ix, 'RAZON SOCIAL'),
    tipo: pick(ix, 'TIPO'),
    supervisor: pick(ix, 'SUPERVISOR', 'GERENTE'),
    asesor: pick(ix, 'ASESOR'),
    guardiasFactura: pick(ix, 'GUARDIAS EN FACTURA'),
    // Las hojas de 2023-2024 titulan la facturación del mes de otra forma.
    importeFactura: pick(ix, 'IMPORTE DE FACTURA', 'CANTIDAD MENSUAL FACTURADA', 'MONTO TOTAL'),
    importeSinIva: pick(ix, 'IMPORTE SIN IVA'),
    nominaTotal: pick(ix, 'NOMINA TOTAL SERVICIO'),
    nominaPrest: pick(ix, 'NOMINA + PRESTACIONES'),
    resultado: pick(ix, 'RESULTADO DEL SERVICIO', 'DIFERENCIA'),
    pctUtilidad: pick(ix, '% UTILIDAD'),
    utilidadBruta: pick(ix, 'UTILIDAD BRUTA'),
    contrato: pick(ix, '¿CUENTA CON CONTRATO?', 'CUENTA CON CONTRATO'),
    fContrato: pick(ix, 'FECHA DE APERTURA (FIRMA DE CONTRATO)', 'FECHA DE APERTURA'),
    fVence: pick(ix, 'FECHA DE VENCIMIENTO DEL CONTRATO'),
    condiciones: pick(ix, 'CONDICIONES COMERCIALES POR CONTRATO', 'CONDICIONES COMERCIALES EN CONTRATO', 'CONDICIONES COMERCIALES'),
    comentarios: pick(ix, 'COMENTARIOS NEGATIVA DEL CONTRATO'),
    creditoMax: pick(ix, 'IMPORTE DE CREDITO MAXIMO'),
    diasCredito: pick(ix, 'DIAS DE CREDITO'),
    pendiente: pick(ix, 'IMPORTE PENDIENTE DE PAGO'),
    saldoVencido: pick(ix, 'SALDO VENCIDO $ VS CREDITO'),
    cobranza: pick(ix, 'STATUS DE COBRANZA'),
    fPago: pick(ix, 'FECHA DE PAGO', 'DIA DE PAGO'),
    observaciones: pick(ix, 'OBSERVACIONES APERTURAS / CANCELACIONES / SERV. ESPECIALES', 'OBSERVACIONES'),
    mesIncremento: pick(ix, 'MES DE INCREMENTO'),
    anioIncremento: pick(ix, 'ULTIMO ANO DE INCREMENTO'),
    facturaMensual: pick(ix, 'FACTURA MENSUAL', 'NUMERO DE FACTURA MENSUAL'),
  };
  const colsTurno = TURNOS.map((t) => [t, pick(ix, t)]).filter(([, i]) => i >= 0);

  const bloques = { EDO: [], APERTURA: [], CANCELACION: [] };
  const subtotales = { EDO: null, APERTURA: null, CANCELACION: null };
  let seccion = 'EDO';
  let finBloques = filas.length;

  for (let i = hi + 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    const up = fila.map(norm);

    // la tabla de comprobación cierra los bloques
    if (up.some((c, j) => c === 'ZONA' && norm(fila[j + 1]) === 'GUARDIAS')) { finBloques = i; break; }

    const zona = texto(fila, cZona);
    const total = num(celda(fila, cTotal));
    const nombre = texto(fila, cServicio) || texto(fila, cols.razon);
    // Un renglón real trae nombre y número de guardias; los títulos de sección y
    // los subtotales fallan una de las dos cosas. Aparte hay subtotales con
    // etiqueta ("EDO DE FUERZA FACTURABLE"), que sí traen nombre y cifra pero
    // ninguna de las columnas que identifican a un servicio.
    const esDato = Boolean(nombre) && total !== null && !ES_TOTAL.test(norm(nombre));

    if (!esDato) {
      const sec = seccionDe(fila);
      if (sec) { seccion = sec; continue; }
      // renglón de subtotal: trae el TOTAL pero ni zona ni nombre
      if (!zona && !nombre && total !== null && subtotales[seccion] === null) {
        subtotales[seccion] = Math.round(total);
      }
      continue;
    }

    const turnos = {};
    for (const [t, ci] of colsTurno) {
      const n = num(celda(fila, ci));
      if (n) turnos[norm(t)] = Math.round(n);
    }

    bloques[seccion].push({
      servicio: nombre,
      razon_social: texto(fila, cols.razon),
      zona,
      tipo: texto(fila, cols.tipo),
      supervisor: texto(fila, cols.supervisor),
      asesor: texto(fila, cols.asesor),
      total_guardias: Math.round(total),
      turnos,
      guardias_en_factura: intOr(num(celda(fila, cols.guardiasFactura))),
      importe_factura: redondear(num(celda(fila, cols.importeFactura))),
      importe_sin_iva: redondear(num(celda(fila, cols.importeSinIva))),
      nomina_total: redondear(num(celda(fila, cols.nominaTotal))),
      nomina_prestaciones: redondear(num(celda(fila, cols.nominaPrest))),
      resultado_servicio: redondear(num(celda(fila, cols.resultado))),
      pct_utilidad: porcentaje(num(celda(fila, cols.pctUtilidad))),
      utilidad_bruta: redondear(num(celda(fila, cols.utilidadBruta))),
      tiene_contrato: boolv(celda(fila, cols.contrato)),
      fecha_contrato: fecha(celda(fila, cols.fContrato)),
      fecha_vencimiento_contrato: fecha(celda(fila, cols.fVence)),
      condiciones_comerciales: texto(fila, cols.condiciones),
      comentarios_contrato: texto(fila, cols.comentarios),
      credito_maximo: redondear(num(celda(fila, cols.creditoMax))),
      dias_credito: intOr(num(celda(fila, cols.diasCredito))),
      importe_pendiente: redondear(num(celda(fila, cols.pendiente))),
      saldo_vencido: redondear(num(celda(fila, cols.saldoVencido))),
      status_cobranza: texto(fila, cols.cobranza),
      fecha_pago: fecha(celda(fila, cols.fPago)),
      observaciones: texto(fila, cols.observaciones),
      factura_mensual: texto(fila, cols.facturaMensual),
      mes_incremento: texto(fila, cols.mesIncremento),
      anio_ultimo_incremento: texto(fila, cols.anioIncremento),
    });
  }

  return {
    periodo,
    hoja: nombreHoja,
    // El estado de fuerza del mes son los dos bloques: la plantilla que venía
    // arrastrando más lo que se abrió durante el mes.
    snapshot: bloques.EDO.concat(bloques.APERTURA),
    aperturas: bloques.APERTURA,
    cancelaciones: bloques.CANCELACION,
    subtotales,
    declarado: resumenDeclarado(filas, finBloques),
  };
}

const redondear = (n) => (n === null ? null : Math.round(n * 100) / 100);
/** "% Utilidad" viene como fracción (0.1625) en unas hojas y como 16.25 en otras. */
const porcentaje = (n) => (n === null ? null : Math.round((Math.abs(n) <= 1 ? n * 100 : n) * 100) / 100);

/** Fecha de un movimiento a partir del texto de OBSERVACIONES ("Inicia 4 de julio"). */
const DIA_MES = /(\d{1,2})\s*(?:DE\s+)?([A-Z]+)/;
function fechaDeObservacion(obs, periodo) {
  const n = norm(obs);
  const iso = fecha((n.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1]);
  if (iso) return iso;
  const m = n.match(DIA_MES);
  const [anio, mesPeriodo] = periodo.split('-');
  if (m && MES[m[2]]) {
    const mes = MES[m[2]];
    // "Inicia 20 de diciembre" en la hoja de enero se refiere al año anterior
    const y = mes > Number(mesPeriodo) + 6 ? Number(anio) - 1 : Number(anio);
    return `${y}-${String(mes).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  return `${periodo}-01`;
}

function tipoApertura(obs) {
  const n = norm(obs);
  if (/INCREMENT/.test(n)) return 'INCREMENTO';
  if (/TEMPORAL|EVENTO|ESPECIAL/.test(n)) return 'TEMPORAL';
  return 'APERTURA';
}

function tipoCancelacion(obs) {
  return /REDUC/.test(norm(obs)) ? 'REDUCCION' : 'CANCELACION';
}

function leerEstadoFuerza(ruta) {
  const wb = leerLibro(ruta);
  const hojas = [];
  for (const nombre of wb.SheetNames) {
    const r = leerHoja(wb.Sheets[nombre], nombre);
    if (r && r.snapshot.length) hojas.push(r);
  }
  /**
   * Varias pestañas describen el mismo mes (EneroG y Enero2025, FebreroG y
   * Febrero2025). Gana la que traiga la facturación capturada: `Enero2025`
   * tiene más renglones pero solo 2 con importe, mientras que `EneroG` trae 158
   * —y este archivo lo usa contabilidad. A igualdad, gana la que más renglones
   * tenga.
   */
  const conImporte = (h) => h.snapshot.filter((r) => r.importe_factura).length;
  const porPeriodo = new Map();
  for (const h of hojas) {
    const prev = porPeriodo.get(h.periodo);
    if (!prev) { porPeriodo.set(h.periodo, h); continue; }
    const [a, b] = [conImporte(h), conImporte(prev)];
    if (a > b || (a === b && h.snapshot.length > prev.snapshot.length)) porPeriodo.set(h.periodo, h);
  }
  return [...porPeriodo.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
}

// ---------------------------------------------------- aperturas/cancelaciones

/**
 * Los movimientos salen de los bloques APERTURAS / CANCELADOS de cada hoja
 * mensual, que es el registro completo. El archivo de Aperturas y Cancelaciones
 * —cuando se pasa con --mov— solo agrega detalle (motivo, autorizaciones,
 * precios) sobre el mismo evento; no genera renglones nuevos en la serie.
 */
function movimientosDeHojas(hojas) {
  const aperturas = [];
  const cancelaciones = [];
  for (const h of hojas) {
    for (const r of h.aperturas) {
      aperturas.push({
        servicio: r.servicio,
        guardias: r.total_guardias,
        fecha: fechaDeObservacion(r.observaciones, h.periodo),
        periodo: h.periodo,
        tipo: tipoApertura(r.observaciones),
        zona: r.zona,
        asesor: r.asesor,
        gerente: r.supervisor,
        razon_social: r.razon_social,
        comentarios: r.observaciones,
        turnos: r.turnos,
        origen: 'estado_fuerza',
      });
    }
    for (const r of h.cancelaciones) {
      cancelaciones.push({
        servicio: r.servicio,
        guardias: r.total_guardias,
        fecha: fechaDeObservacion(r.observaciones, h.periodo),
        periodo: h.periodo,
        tipo: tipoCancelacion(r.observaciones),
        zona: r.zona,
        asesor: r.asesor,
        motivo: '',
        comentarios: r.observaciones,
        turnos: r.turnos,
        origen: 'estado_fuerza',
      });
    }
  }
  return { aperturas, cancelaciones };
}

/**
 * Detalle guardado en un seed anterior, con la misma forma que devuelve
 * leerDetalleMovimientos. Sirve cuando se reimporta solo el Estado de Fuerza:
 * el motivo de cancelación y las autorizaciones vienen del archivo de
 * movimientos y no hay por qué perderlos al regenerar los cortes.
 */
const CAMPOS_DETALLE = [
  'motivo', 'reporta', 'auditoria', 'cxc', 'subtipo', 'aut', 'direccion', 'cluster', 'estado_geo',
  'precio_guardia', 'precio_total', 'sueldo_base', 'bono', 'uniforme', 'credito_autorizado',
  'credito_plazo', 'cobro', 'forma_pago', 'tipo_repse', 'gerente',
];

function detalleDesdeSeed(ruta) {
  if (!fs.existsSync(ruta)) return null;
  let previo;
  try {
    previo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
  const porClave = new Map();
  const porNombre = new Map();
  let filasLeidas = 0;

  const cargar = (lista, clase) => {
    for (const m of lista || []) {
      const n = norm(m.servicio);
      if (!n) continue;
      const extra = { clase, fecha_registro: m.fecha || null };
      for (const c of CAMPOS_DETALLE) {
        if (m[c] !== undefined && m[c] !== null && m[c] !== '') extra[c] = m[c];
      }
      if (Object.keys(extra).length <= 2) continue;
      filasLeidas++;
      if (m.periodo) porClave.set(`${clase}|${n}|${m.periodo}`, extra);
      if (!porNombre.has(`${clase}|${n}`)) porNombre.set(`${clase}|${n}`, []);
      porNombre.get(`${clase}|${n}`).push(extra);
    }
  };
  cargar(previo.aperturas, 'APERTURA');
  cargar(previo.cancelaciones, 'CANCELACION');
  return filasLeidas ? { porClave, porNombre, filasLeidas } : null;
}

/**
 * Lee el archivo de Aperturas y Cancelaciones, que es el registro operativo:
 * una hoja por mes y por clase, con folio de quien reporta, motivo de la baja,
 * precios pactados y la cadena de autorizaciones.
 *
 * El periodo NO se saca del nombre de la pestaña —la mitad se llaman "Hoja 49"—
 * sino de la fecha del propio renglón. Cada movimiento se indexa por
 * servicio + periodo, y también por servicio a secas para poder emparejar
 * cuando el corte del Estado de Fuerza fecha el movimiento en un mes vecino.
 */
function leerDetalleMovimientos(ruta) {
  const wb = leerLibro(ruta);
  const porClave = new Map();   // servicio|periodo -> detalle
  const porNombre = new Map();  // servicio -> [detalle...]
  let filasLeidas = 0;

  for (const nombreHoja of wb.SheetNames) {
    const filas = matriz(wb.Sheets[nombreHoja]);
    let hi = -1;
    for (let i = 0; i < Math.min(filas.length, 15); i++) {
      if ((filas[i] || []).map(norm).includes('NOMBRE DE SERVICIO')) { hi = i; break; }
    }
    if (hi < 0) continue;

    const ix = indice(filas[hi]);
    const esCancelacion = pick(ix, 'GUARDIAS CANCELADOS') >= 0;
    const clase = esCancelacion ? 'CANCELACION' : 'APERTURA';
    const cNombre = pick(ix, 'NOMBRE DE SERVICIO');
    const cFecha = esCancelacion
      ? pick(ix, 'FECHA DE CANCELACION (RETIRO DE SERVICIO)', 'FECHA DE CANCELACION')
      : pick(ix, 'FECHA DE APERTURA/FORMAL', 'FECHA DE APERTURA');
    // Las hojas de 2023 titulan la cifra "GUARDIAS VENDIDOS"; las de 2024 en
    // adelante, "TOTAL".
    const cGuardias = esCancelacion
      ? pick(ix, 'GUARDIAS CANCELADOS')
      : pick(ix, 'TOTAL', 'GUARDIAS VENDIDOS');
    const cZona = pick(ix, 'ZONA');
    const cAsesor = pick(ix, 'ASESOR A CARGO', 'ASESOR');
    const colsTurnoMov = TURNOS_MOV.map((t) => [t, pick(ix, t)]).filter(([, i]) => i >= 0);

    for (const fila of filas.slice(hi + 1)) {
      const nombre = texto(fila, cNombre);
      if (!nombre || norm(nombre) === 'NOMBRE DE SERVICIO') continue;

      const f = fecha(celda(fila, cFecha));
      const turnosMov = {};
      for (const [t, ci] of colsTurnoMov) {
        const v = num(celda(fila, ci));
        if (v) turnosMov[norm(t)] = Math.round(v);
      }
      const comunes = {
        guardias: intOr(num(celda(fila, cGuardias))) ?? 0,
        zona: texto(fila, cZona),
        asesor: texto(fila, cAsesor),
        turnos: turnosMov,
      };
      const extra = esCancelacion
        ? {
            clase,
            fecha_registro: f,
            ...comunes,
            motivo: texto(fila, pick(ix, 'MOTIVO')),
            reporta: texto(fila, pick(ix, 'REPORTA')),
            auditoria: texto(fila, pick(ix, 'AUDITORIA')),
            cxc: num(celda(fila, pick(ix, 'CXC A LA CANCELACION'))),
            subtipo: texto(fila, pick(ix, 'REDUCCION/CANCELACION')),
            aut: {
              ventas: boolv(celda(fila, pick(ix, 'AUTORIZACION: VENTAS DIRECCION'))),
              cxc: boolv(celda(fila, pick(ix, 'AUTORIZACION: CXC'))),
              operacion: boolv(celda(fila, pick(ix, 'AUTORIZACION: OPERACION (DIRECCION)'))),
              sistemas: boolv(celda(fila, pick(ix, 'AUTORIZACION: SISTEMAS /TELEFONOS DEVUELTOS, COMENTARIOS'))),
              juridico: boolv(celda(fila, pick(ix, 'AUTORIZACION JURIDICO'))),
              contraloria: boolv(celda(fila, pick(ix, 'AUTORIZACION: CONTRALORIA'))),
            },
          }
        : {
            clase,
            fecha_registro: f,
            ...comunes,
            direccion: texto(fila, pick(ix, 'DIRECCION/UBICACION DE SERV.')),
            subtipo: texto(fila, pick(ix, 'APERTURA/INCREMENTO/TEMPORAL')),
            reporta: texto(fila, pick(ix, 'REPORTA')),
            cluster: texto(fila, pick(ix, 'CLUSTER')),
            estado_geo: texto(fila, pick(ix, 'ESTADO (GEOGRAFICO)')),
            precio_guardia: num(celda(fila, pick(ix, 'PRECIO POR GUARDIA BASICO', 'PRECIO POR GUARDIA'))),
            precio_total: num(celda(fila, pick(ix, 'PRECIOS SIN IVA/ANEXAR COTIZACION SUBIR', 'PRECIOS SIN IVA/ANEXAR COTIZACION'))),
            sueldo_base: num(celda(fila, pick(ix, 'SUELDO ELEMENTO BASE'))),
            bono: num(celda(fila, pick(ix, 'BONO'))),
            uniforme: texto(fila, pick(ix, 'TIPO DE UNIFORME')),
            credito_autorizado: boolv(celda(fila, pick(ix, '¿SE AUTORIZO CREDITO?'))),
            credito_plazo: texto(fila, pick(ix, '¿CUANTO TIEMPO?')),
            cobro: texto(fila, pick(ix, 'COBRO (TRANSFERENCIA, EFECTIVO, ETC)', 'COBRO')),
            forma_pago: texto(fila, pick(ix, 'FORMA DE PAGO')),
            tipo_repse: texto(fila, pick(ix, 'TIPO DE REPSE', 'ENVIO DE INFORMACION REPSE')),
            gerente: texto(fila, pick(ix, 'GERENTE A CARGO')),
            comentarios: texto(fila, pick(ix, 'COMENTARIOS')),
            aut: {
              ventas: boolv(celda(fila, pick(ix, 'VENTAS (DIRECCION)'))),
              cxc: boolv(celda(fila, pick(ix, 'CXC'))),
              operacion: boolv(celda(fila, pick(ix, 'OPERACION (DIRECCION)'))),
              capacitacion: boolv(celda(fila, pick(ix, 'CAPACITACION'))),
              sistemas: boolv(celda(fila, pick(ix, 'SISTEMAS'))),
              juridico: boolv(celda(fila, pick(ix, 'JURIDICO'))),
              contraloria: boolv(celda(fila, pick(ix, 'CONTRALORIA'))),
            },
          };

      // se limpian los vacíos para que no pisen datos buenos al fusionar
      for (const [k, v] of Object.entries(extra)) {
        if (v === '' || v === null || v === undefined) delete extra[k];
      }

      filasLeidas++;
      const n = norm(nombre);
      if (f) porClave.set(`${clase}|${n}|${f.slice(0, 7)}`, extra);
      if (!porNombre.has(`${clase}|${n}`)) porNombre.set(`${clase}|${n}`, []);
      porNombre.get(`${clase}|${n}`).push(extra);
    }
  }
  return { porClave, porNombre, filasLeidas };
}

/**
 * Llave difusa: los dos archivos escriben el mismo sitio distinto
 * ("MACRO CEDIS ALPURA" contra "ALPURA (MACRO CEDIS) TEPOZOTLAN",
 * "JETVAN MEXICO TACUBA" contra "JETVAN TACUBA"). Se comparan conjuntos de
 * palabras: coinciden si todas las palabras significativas del nombre más
 * corto están en el más largo.
 */
const VACIAS = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'SA', 'CV', 'SAPI', 'II', 'I']);

function palabras(nombre) {
  return new Set(
    norm(nombre)
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(' ')
      .filter((p) => p.length > 1 && !VACIAS.has(p))
  );
}

function parecidos(a, b) {
  const [corto, largo] = a.size <= b.size ? [a, b] : [b, a];
  if (!corto.size) return false;
  let comunes = 0;
  for (const p of corto) if (largo.has(p)) comunes++;
  return comunes === corto.size && comunes >= 1;
}

/** Meses de distancia entre dos periodos YYYY-MM. */
function distanciaMeses(a, b) {
  if (!a || !b) return 99;
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return Math.abs((ay - by) * 12 + (am - bm));
}

/**
 * Pega el detalle del registro operativo sobre la serie que salió del Estado
 * de Fuerza. Primero por servicio + periodo exacto; si no, el registro del
 * mismo servicio más cercano en el tiempo, aceptando hasta un mes de
 * diferencia —el corte fecha el movimiento cuando lo refleja la plantilla, no
 * siempre el día que se firmó.
 */
function enriquecer(movs, detalle, clase) {
  if (!detalle) return { exactos: 0, cercanos: 0, difusos: 0, sobrantes: [] };
  let exactos = 0;
  let cercanos = 0;
  let difusos = 0;
  const usados = new Set();

  const cercano = (candidatos, periodo, tolerancia) =>
    candidatos
      .filter((c) => !usados.has(c) && distanciaMeses(c.fecha_registro?.slice(0, 7), periodo) <= tolerancia)
      .sort(
        (a, b) =>
          distanciaMeses(a.fecha_registro?.slice(0, 7), periodo) -
          distanciaMeses(b.fecha_registro?.slice(0, 7), periodo)
      )[0];

  // Índice difuso: solo los de esta clase, con sus palabras precalculadas.
  const difuso = [];
  for (const [k, lista] of detalle.porNombre) {
    if (!k.startsWith(clase + '|')) continue;
    difuso.push({ pal: palabras(k.slice(clase.length + 1)), lista });
  }

  for (const m of movs) {
    const n = norm(m.servicio);
    let extra = detalle.porClave.get(`${clase}|${n}|${m.periodo}`);
    if (extra && !usados.has(extra)) {
      exactos++;
    } else {
      extra = cercano(detalle.porNombre.get(`${clase}|${n}`) || [], m.periodo, 1);
      if (extra) {
        cercanos++;
      } else {
        const pm = palabras(m.servicio);
        for (const d of difuso) {
          if (!parecidos(pm, d.pal)) continue;
          extra = cercano(d.lista, m.periodo, 1);
          if (extra) { difusos++; break; }
        }
      }
    }
    if (!extra) continue;
    usados.add(extra);
    // El corte manda en guardias, zona, asesor y turnos: es lo que cuadra con
    // la plantilla. Del registro operativo solo entra lo que el corte no tiene.
    const { clase: _c, fecha_registro, guardias, zona, asesor, turnos, ...campos } = extra;
    Object.assign(m, campos, { origen: 'estado_fuerza+movimientos' });
  }

  // Lo que el registro operativo tiene y el corte no reflejó.
  const sobrantes = [];
  for (const [k, lista] of detalle.porNombre) {
    if (!k.startsWith(clase + '|')) continue;
    const servicio = k.slice(clase.length + 1);
    for (const d of lista) if (!usados.has(d)) sobrantes.push({ servicio, ...d });
  }
  return { exactos, cercanos, difusos, sobrantes };
}

/**
 * Los renglones del registro operativo que no encontraron pareja se agregan
 * SOLO en los meses donde el Estado de Fuerza no aporta ningún movimiento
 * —enero a septiembre de 2023, y agosto de 2026, que son posteriores o
 * anteriores a los cortes disponibles—. En un mes que el corte sí cubre no se
 * agregan: no hay forma de saber si son el mismo evento escrito distinto, y
 * duplicarlos inflaría la serie.
 */
function rellenarHuecos(serie, sobrantes, clase) {
  const cubiertos = new Set(serie.map((m) => m.periodo));
  const nuevos = [];
  for (const s of sobrantes) {
    const periodo = s.fecha_registro?.slice(0, 7);
    if (!periodo || cubiertos.has(periodo)) continue;
    const { clase: _c, fecha_registro, servicio, subtipo, ...campos } = s;
    nuevos.push({
      servicio,
      fecha: fecha_registro,
      periodo,
      tipo: clase === 'APERTURA' ? tipoApertura(subtipo) : tipoCancelacion(subtipo),
      guardias: 0,
      zona: '',
      asesor: '',
      turnos: {},
      ...campos,
      origen: 'movimientos',
    });
  }
  serie.push(...nuevos);
  return nuevos.length;
}

// ---------------------------------------------------------------------- main

console.log('· leyendo Estado de Fuerza…');
const hojas = leerEstadoFuerza(rutaEdo);
if (!hojas.length) {
  console.error('No se detectó ninguna hoja de Estado de Fuerza con encabezados reconocibles.');
  process.exit(1);
}

const { aperturas, cancelaciones } = movimientosDeHojas(hojas);

let detalle = null;
if (rutaMov) {
  console.log('· leyendo Aperturas y Cancelaciones (detalle)…');
  detalle = leerDetalleMovimientos(rutaMov);
} else {
  detalle = detalleDesdeSeed(salida);
  if (detalle) console.log('· reusando el detalle de movimientos del seed anterior…');
}
if (detalle) {
  const a = enriquecer(aperturas, detalle, 'APERTURA');
  const c = enriquecer(cancelaciones, detalle, 'CANCELACION');
  const relA = rellenarHuecos(aperturas, a.sobrantes, 'APERTURA');
  const relC = rellenarHuecos(cancelaciones, c.sobrantes, 'CANCELACION');
  const fmt = (r, total) => `${r.exactos + r.cercanos + r.difusos}/${total} (${r.exactos} exactas, ${r.cercanos} mes vecino, ${r.difusos} por nombre parecido)`;
  console.log(
    `  ${detalle.filasLeidas} renglones de detalle leídos\n` +
      `  aperturas emparejadas    ${fmt(a, aperturas.length - relA)}\n` +
      `  cancelaciones emparejadas ${fmt(c, cancelaciones.length - relC)}\n` +
      `  + ${relA} aperturas y ${relC} cancelaciones agregadas en meses sin corte`
  );
}

const snapshots = {};
for (const h of hojas) snapshots[h.periodo] = h.snapshot;
const periodos = hojas.map((h) => h.periodo);
const vigente = periodos[periodos.length - 1];

const seed = {
  meta: {
    origen: [path.basename(rutaEdo), rutaMov ? path.basename(rutaMov) : null].filter(Boolean),
    periodo_vigente: vigente,
    periodos_snapshot: periodos,
    importado_desde_xlsx: true,
    nota: 'Cada corte mensual es bloque principal + bloque de aperturas del mes; los movimientos salen de los bloques APERTURAS / CANCELADOS de la misma hoja.',
  },
  snapshots,
  aperturas,
  cancelaciones,
};

fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(seed, null, 1));

// ------------------------------------------------------------- comprobación

console.log('\nperiodo   servicios  guardias   declarado   ✓');
let discrepancias = 0;
for (const h of hojas) {
  const guardias = h.snapshot.reduce((a, r) => a + r.total_guardias, 0);
  const dec = h.declarado.total;
  const ok = dec === null ? '·' : guardias === dec ? '✓' : '✗';
  if (ok === '✗') discrepancias++;
  console.log(
    `${h.periodo}   ${String(h.snapshot.length).padStart(6)}   ${String(guardias).padStart(7)}   ${String(dec ?? '—').padStart(9)}   ${ok}`
  );
}

const kVigente = hojas[hojas.length - 1];
console.log(`\n· ${periodos.length} periodos · ${kVigente.snapshot.length} servicios vigentes en ${vigente}`);
console.log(`· ${aperturas.length} aperturas · ${cancelaciones.length} cancelaciones`);
if (discrepancias) {
  console.log(
    `· ⚠ ${discrepancias} periodo(s) no cuadran contra el resumen de su hoja.\n` +
      '  Suele ser el rango de la fórmula: varias hojas suman con un SUM que se\n' +
      '  quedó corto al agregar renglones al final (en julio 2026, la facturación\n' +
      '  suma W4:W204 con datos hasta W216). Aquí se suman todos los renglones.'
  );
}
console.log(`\nEscrito ${salida}\nAhora corre:  npm run seed:reset`);
