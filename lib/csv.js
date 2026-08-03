/**
 * Lectura de archivos CSV hechos en Excel.
 *
 * No es un parser general: es el que hace falta para que un archivo guardado
 * desde Excel en español entre sin pelear. Eso significa aguantar tres cosas
 * que un parser de manual no contempla:
 *
 *   - El separador cambia según la computadora. Excel en español guarda con
 *     punto y coma; el mismo archivo abierto en otra máquina sale con comas.
 *   - Excel escribe una marca invisible al principio del archivo (BOM) que, si
 *     no se quita, se pega al nombre de la primera columna y ninguna coincide.
 *   - Los importes vienen como los ve el usuario: "$ 1,234.56".
 *
 * Todo lo que se acepta aquí se acepta a propósito. Lo que no se entienda se
 * reporta con su número de renglón, nunca se adivina: en cobranza, una cifra
 * mal leída en silencio es peor que un archivo rechazado.
 */

/** Excel guarda con `;` en español y con `,` en inglés. Se mira el encabezado. */
function detectarSeparador(texto) {
  const primera = texto.split(/\r?\n/)[0] || '';
  const puntoYComa = (primera.match(/;/g) || []).length;
  const comas = (primera.match(/,/g) || []).length;
  return puntoYComa >= comas ? ';' : ',';
}

export function parsearCSV(texto) {
  const limpio = String(texto || '').replace(/^﻿/, '');
  const sep = detectarSeparador(limpio);

  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (entreComillas) {
      if (ch === '"') {
        if (limpio[i + 1] === '"') { campo += '"'; i++; }
        else entreComillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') entreComillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }

  return filas.filter((f) => f.some((c) => String(c).trim() !== ''));
}

/** `Fecha de factura` y `fecha_factura` tienen que llegar a la misma llave. */
function normalizarClave(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Convierte el CSV en objetos, usando el primer renglón como encabezado. */
export function leerCSV(texto) {
  const filas = parsearCSV(texto);
  if (!filas.length) return [];
  const claves = filas[0].map(normalizarClave);
  return filas.slice(1).map((f, i) => {
    const obj = { _fila: i + 2 }; // +2: el encabezado es el renglón 1
    claves.forEach((k, j) => {
      if (k) obj[k] = String(f[j] ?? '').trim();
    });
    return obj;
  });
}

/**
 * Lee un importe como lo escribiría una persona: "$ 1,234.56" o "1.234,56".
 *
 * Cuál de los dos signos es el decimal depende de la computadora que guardó el
 * archivo, así que se decide por posición: el que esté más a la derecha manda.
 * Con uno solo, se mira si le siguen exactamente dos dígitos.
 */
export function leerImporte(v) {
  const bruto = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!bruto) return null;

  const ultimaComa = bruto.lastIndexOf(',');
  const ultimoPunto = bruto.lastIndexOf('.');
  let normal;

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const decimal = ultimaComa > ultimoPunto ? ',' : '.';
    const miles = decimal === ',' ? '.' : ',';
    normal = bruto.split(miles).join('').replace(decimal, '.');
  } else if (ultimaComa >= 0) {
    // una sola coma: es decimal si le siguen dos dígitos ("1234,56"), y
    // separador de miles en cualquier otro caso ("1,234")
    normal = /,\d{2}$/.test(bruto) ? bruto.split(',').join('.') : bruto.split(',').join('');
  } else if (ultimoPunto >= 0) {
    // mismo criterio al revés: "150.000" son ciento cincuenta mil, no 150
    normal = /\.\d{3}$/.test(bruto) ? bruto.split('.').join('') : bruto;
  } else {
    normal = bruto;
  }

  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Acepta 2026-08-01 y también 01/08/2026, que es como lo escribe Excel aquí. */
export function leerFecha(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const local = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (local) {
    const [, d, m, a] = local;
    return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

/** «SI», «Sí», «X», «1», «true» — todas quieren decir lo mismo. */
export function leerSiNo(v) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ['si', 's', 'x', '1', 'true', 'verdadero', 'pagado', 'pagada'].includes(s);
}

// ------------------------------------------------------------------ escritura

const SEPARADOR = ';';
const BOM = '﻿';

function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = String(v).replace(/\r?\n/g, ' ').trim();
  return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Arma un CSV que Excel en español abre sin preguntar nada. */
export function escribirCSV(columnas, filas) {
  const lineas = [
    columnas.map(([, etiqueta]) => celda(etiqueta)).join(SEPARADOR),
    ...filas.map((f) => columnas.map(([clave]) => celda(f[clave])).join(SEPARADOR)),
  ];
  return BOM + lineas.join('\r\n') + '\r\n';
}
