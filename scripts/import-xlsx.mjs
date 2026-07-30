#!/usr/bin/env node
/**
 * Regenera data/seed.json leyendo los dos archivos .xlsx originales.
 *
 * data/seed.json viene con los datos que se pudieron extraer de Google Drive,
 * cuya exportación a texto trunca cada hoja. Con los .xlsx locales se carga el
 * 100% de los renglones.
 *
 *   node scripts/import-xlsx.mjs \
 *     --edo "C:/ruta/Estado de Fuerza Ultra 2026.xlsx" \
 *     --mov "C:/ruta/Aperturas, Cancelaciones, ... 2025- 2026.xlsx"
 *
 * Después:  npm run seed:reset
 */

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

// ------------------------------------------------------------------ argumentos

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const rutaEdo = arg('edo');
const rutaMov = arg('mov');
const salida = arg('out') || path.join(process.cwd(), 'data', 'seed.json');

if (!rutaEdo || !rutaMov) {
  console.error('Faltan rutas. Uso:\n  node scripts/import-xlsx.mjs --edo "<Estado de Fuerza.xlsx>" --mov "<Aperturas y Cancelaciones.xlsx>"');
  process.exit(1);
}
for (const p of [rutaEdo, rutaMov]) {
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

function boolv(v) {
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
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || d.y < 1950 || d.y > 2100) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
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

/** Matriz de la hoja, sin filas vacías al final. */
function matriz(hoja) {
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '', blankrows: true });
}

/** Índice cabecera-normalizada -> primera columna donde aparece. */
function indice(fila) {
  const ix = {};
  fila.forEach((c, i) => {
    const n = norm(c);
    if (n && ix[n] === undefined) ix[n] = i;
  });
  return ix;
}

function val(fila, ix, ...nombres) {
  for (const n of nombres) {
    const i = ix[norm(n)];
    if (i !== undefined && fila[i] !== undefined && fila[i] !== '') return fila[i];
  }
  return '';
}

/** Busca la fila de encabezados dentro de las primeras `max` filas. */
function buscarEncabezado(filas, prueba, max = 15) {
  for (let i = 0; i < Math.min(filas.length, max); i++) {
    const up = filas[i].map(norm);
    if (prueba(up)) return i;
  }
  return -1;
}

// ------------------------------------------------------------ estado de fuerza

const TURNOS_EDO = ['8 HRS', '10X14', '11X13', '12 HRS', '12X24', '12X36', '13X47', '8X16 L-S', '8X16 L-D', '24 HRS', '24X24', '24X48'];

function leerEstadoFuerza(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true });
  const snapshots = {};

  for (const nombreHoja of wb.SheetNames) {
    const m = norm(nombreHoja).match(/([A-Z]+)\s*(\d{4})/);
    if (!m || !MES[m[1]]) continue;
    const periodo = `${m[2]}-${String(MES[m[1]]).padStart(2, '0')}`;

    const filas = matriz(wb.Sheets[nombreHoja]);
    const hi = buscarEncabezado(
      filas,
      (up) => (up.includes('SERVICIO') || up.includes('SERVICIO COMO NOMINA')) && (up.includes('RAZON SOCIAL') || up.includes('ZONA'))
    );
    if (hi < 0) continue;

    const ix = indice(filas[hi]);
    const out = [];
    for (const fila of filas.slice(hi + 1)) {
      const nombre = String(val(fila, ix, 'SERVICIO', 'SERVICIO COMO NOMINA')).trim();
      if (!nombre || ['TOTAL', 'TOTALES', 'SERVICIO', 'SUMA'].includes(norm(nombre))) continue;

      const turnos = {};
      for (const t of TURNOS_EDO) {
        const n = num(val(fila, ix, t));
        if (n) turnos[t] = Math.round(n);
      }
      const total = num(val(fila, ix, 'TOTAL'));

      out.push({
        servicio: nombre,
        razon_social: String(val(fila, ix, 'RAZON SOCIAL', 'RAZÓN SOCIAL')).trim(),
        zona: String(val(fila, ix, 'ZONA')).trim(),
        tipo: String(val(fila, ix, 'TIPO')).trim(),
        supervisor: String(val(fila, ix, 'SUPERVISOR', 'GERENTE')).trim(),
        asesor: String(val(fila, ix, 'ASESOR')).trim(),
        total_guardias: total !== null ? Math.round(total) : Object.values(turnos).reduce((a, b) => a + b, 0),
        turnos,
        guardias_en_factura: intOr(num(val(fila, ix, 'GUARDIAS EN FACTURA'))),
        importe_factura: num(val(fila, ix, 'IMPORTE DE FACTURA')),
        importe_sin_iva: num(val(fila, ix, 'IMPORTE SIN IVA')),
        nomina_total: num(val(fila, ix, 'NOMINA TOTAL SERVICIO')),
        nomina_prestaciones: num(val(fila, ix, 'NOMINA + PRESTACIONES')),
        resultado_servicio: num(val(fila, ix, 'RESULTADO DEL SERVICIO')),
        pct_utilidad: num(val(fila, ix, '% UTILIDAD')),
        utilidad_bruta: num(val(fila, ix, 'UTILIDAD BRUTA')),
        tiene_contrato: boolv(val(fila, ix, '¿CUENTA CON CONTRATO?', 'CUENTA CON CONTRATO')),
        fecha_contrato: fecha(val(fila, ix, 'FECHA DE APERTURA (FIRMA DE CONTRATO)')),
        fecha_vencimiento_contrato: fecha(val(fila, ix, 'FECHA DE VENCIMIENTO DEL CONTRATO')),
        condiciones_comerciales: String(val(fila, ix, 'CONDICIONES COMERCIALES POR CONTRATO')).trim(),
        comentarios_contrato: String(val(fila, ix, 'COMENTARIOS NEGATIVA DEL CONTRATO')).trim(),
        credito_maximo: num(val(fila, ix, 'IMPORTE DE CREDITO MAXIMO')),
        dias_credito: intOr(num(val(fila, ix, 'DIAS DE CREDITO'))),
        importe_pendiente: num(val(fila, ix, 'IMPORTE PENDIENTE DE PAGO')),
        saldo_vencido: num(val(fila, ix, 'SALDO VENCIDO $ VS CREDITO')),
        status_cobranza: String(val(fila, ix, 'STATUS DE COBRANZA')).trim(),
        fecha_pago: fecha(val(fila, ix, 'FECHA DE PAGO')),
        observaciones: String(val(fila, ix, 'OBSERVACIONES APERTURAS / CANCELACIONES / SERV. ESPECIALES', 'OBSERVACIONES')).trim(),
        mes_incremento: String(val(fila, ix, 'MES DE INCREMENTO')).trim(),
        anio_ultimo_incremento: String(val(fila, ix, 'ULTIMO ANO DE INCREMENTO', 'ÚLTIMO AÑO DE INCREMENTO')).trim(),
      });
    }
    if (out.length) snapshots[periodo] = (snapshots[periodo] || []).concat(out);
  }
  return snapshots;
}

const intOr = (n) => (n === null ? null : Math.round(n));

// ---------------------------------------------------- aperturas/cancelaciones

function leerMovimientos(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true });
  const aperturas = [];
  const cancelaciones = [];

  for (const nombreHoja of wb.SheetNames) {
    const filas = matriz(wb.Sheets[nombreHoja]);

    // periodo sugerido por el nombre de la pestaña (ej. "ENERO 2026")
    const mh = norm(nombreHoja).match(/([A-Z]+)\s*(\d{2,4})/);
    let periodoHoja = null;
    if (mh && MES[mh[1]]) {
      const y = mh[2].length === 2 ? `20${mh[2]}` : mh[2];
      periodoHoja = `${y}-${String(MES[mh[1]]).padStart(2, '0')}`;
    }

    const hi = buscarEncabezado(filas, (up) => up.includes('NOMBRE DE SERVICIO'));
    if (hi < 0) continue;
    const up = filas[hi].map(norm);
    const esCancelacion = up.includes('GUARDIAS CANCELADOS');
    const esApertura = up.includes('APERTURA/INCREMENTO/TEMPORAL') || up.includes('GUARDIAS VENDIDOS') || up.includes('TOTAL');
    if (!esCancelacion && !esApertura) continue;

    const ix = indice(filas[hi]);

    for (const fila of filas.slice(hi + 1)) {
      const nombre = String(val(fila, ix, 'NOMBRE DE SERVICIO')).trim();
      if (!nombre || norm(nombre) === 'NOMBRE DE SERVICIO') continue;

      if (esCancelacion) {
        const f = fecha(val(fila, ix, 'FECHA DE CANCELACION (RETIRO DE SERVICIO)'));
        const sub = norm(val(fila, ix, 'REDUCCION/CANCELACION'));
        const turnos = {};
        for (const t of ['24X24', '12X12', '12X24', '12X36', 'OTROS']) {
          const n = num(val(fila, ix, t));
          if (n) turnos[t] = Math.round(n);
        }
        cancelaciones.push({
          servicio: nombre,
          guardias: intOr(num(val(fila, ix, 'GUARDIAS CANCELADOS'))) ?? 0,
          fecha: f,
          periodo: f ? f.slice(0, 7) : periodoHoja,
          zona: String(val(fila, ix, 'ZONA')).trim(),
          asesor: String(val(fila, ix, 'ASESOR A CARGO')).trim(),
          motivo: String(val(fila, ix, 'MOTIVO')).trim(),
          tipo: sub.includes('REDUC') ? 'REDUCCION' : 'CANCELACION',
          reporta: String(val(fila, ix, 'REPORTA')).trim(),
          auditoria: String(val(fila, ix, 'AUDITORIA', 'AUDITORÍA')).trim(),
          cxc: num(val(fila, ix, 'CXC A LA CANCELACION')),
          turnos,
          aut: {
            ventas: boolv(val(fila, ix, 'AUTORIZACION: VENTAS DIRECCION')),
            cxc: boolv(val(fila, ix, 'AUTORIZACION: CXC')),
            operacion: boolv(val(fila, ix, 'AUTORIZACION: OPERACION (DIRECCION)')),
            sistemas: boolv(val(fila, ix, 'AUTORIZACION: SISTEMAS /TELEFONOS DEVUELTOS, COMENTARIOS')),
            juridico: boolv(val(fila, ix, 'AUTORIZACION JURIDICO')),
            contraloria: boolv(val(fila, ix, 'AUTORIZACION: CONTRALORIA')),
          },
        });
      } else {
        const f = fecha(val(fila, ix, 'FECHA DE APERTURA/FORMAL', 'FECHA DE APERTURA'));
        const sub = norm(val(fila, ix, 'APERTURA/INCREMENTO/TEMPORAL'));
        const turnos = {};
        for (const t of ['8X16 L-D', '8X16 L-S', '8X16 L-V', '12X12 L-D', '12X12 L-S', '12X12 L-V', '12X24', '12X36', '24X24', '24X48']) {
          const n = num(val(fila, ix, t));
          if (n) turnos[t] = Math.round(n);
        }
        aperturas.push({
          servicio: nombre,
          guardias: intOr(num(val(fila, ix, 'TOTAL', 'GUARDIAS VENDIDOS'))) ?? 0,
          fecha: f,
          periodo: f ? f.slice(0, 7) : periodoHoja,
          tipo: sub.includes('INCREM') ? 'INCREMENTO' : sub.includes('TEMPOR') ? 'TEMPORAL' : 'APERTURA',
          direccion: String(val(fila, ix, 'DIRECCION/UBICACION DE SERV.')).trim(),
          asesor: String(val(fila, ix, 'ASESOR', 'ASESOR A CARGO')).trim(),
          gerente: String(val(fila, ix, 'GERENTE A CARGO')).trim(),
          zona: String(val(fila, ix, 'ZONA')).trim(),
          cluster: String(val(fila, ix, 'CLUSTER')).trim(),
          reporta: String(val(fila, ix, 'REPORTA')).trim(),
          estado_geo: String(val(fila, ix, 'ESTADO (GEOGRAFICO)')).trim(),
          precio_guardia: num(val(fila, ix, 'PRECIO POR GUARDIA BASICO', 'PRECIO POR GUARDIA')),
          sueldo_base: num(val(fila, ix, 'SUELDO ELEMENTO BASE')),
          bono: num(val(fila, ix, 'BONO')),
          uniforme: String(val(fila, ix, 'TIPO DE UNIFORME')).trim(),
          credito_autorizado: boolv(val(fila, ix, '¿SE AUTORIZO CREDITO?')),
          credito_plazo: String(val(fila, ix, '¿CUANTO TIEMPO?')).trim(),
          forma_pago: String(val(fila, ix, 'FORMA DE PAGO')).trim(),
          cobro: String(val(fila, ix, 'COBRO (TRANSFERENCIA, EFECTIVO, ETC)')).trim(),
          tipo_repse: String(val(fila, ix, 'TIPO DE REPSE')).trim(),
          comentarios: String(val(fila, ix, 'COMENTARIOS')).trim(),
          turnos,
          aut: {
            ventas: boolv(val(fila, ix, 'VENTAS (DIRECCION)')),
            cxc: boolv(val(fila, ix, 'CXC')),
            operacion: boolv(val(fila, ix, 'OPERACION (DIRECCION)')),
            capacitacion: boolv(val(fila, ix, 'CAPACITACION')),
            sistemas: boolv(val(fila, ix, 'SISTEMAS')),
            juridico: boolv(val(fila, ix, 'JURIDICO')),
            contraloria: boolv(val(fila, ix, 'CONTRALORIA')),
          },
        });
      }
    }
  }
  return { aperturas, cancelaciones };
}

// ---------------------------------------------------------------------- main

console.log('· leyendo Estado de Fuerza…');
const snapshots = leerEstadoFuerza(rutaEdo);
console.log('· leyendo Aperturas y Cancelaciones…');
const { aperturas, cancelaciones } = leerMovimientos(rutaMov);

const periodos = Object.keys(snapshots).sort();
if (!periodos.length) {
  console.error('No se detectó ninguna hoja de Estado de Fuerza con encabezados reconocibles.');
  process.exit(1);
}

const seed = {
  meta: {
    origen: [path.basename(rutaMov), path.basename(rutaEdo)],
    periodo_vigente: periodos[periodos.length - 1],
    periodos_snapshot: periodos,
    importado_desde_xlsx: true,
  },
  snapshots,
  aperturas,
  cancelaciones,
};

fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(seed, null, 1));

const totalRenglones = periodos.reduce((a, p) => a + snapshots[p].length, 0);
const servicios = new Set(periodos.flatMap((p) => snapshots[p].map((r) => norm(r.servicio))));

console.log(`\n· ${periodos.length} periodos, ${totalRenglones} renglones de estado de fuerza`);
console.log(`· ${servicios.size} servicios distintos`);
console.log(`· ${aperturas.length} aperturas · ${cancelaciones.length} cancelaciones`);
console.log(`· periodo vigente: ${seed.meta.periodo_vigente}`);
console.log(`\nEscrito ${salida}\nAhora corre:  npm run seed:reset`);
