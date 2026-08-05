/**
 * Qué estado tiene el contrato de un servicio.
 *
 * Está separado de `lib/juridico.js` a propósito y no por gusto de ordenar: los
 * filtros de la pantalla corren en el navegador y necesitan la lista de
 * estados. Si la sacaran del módulo que consulta la base, el navegador
 * arrastraría SQLite con ella —y el build ni siquiera termina—. Aquí no se
 * toca la base: se clasifica lo que ya se leyó.
 */

import { hoy } from './fechas';

/**
 * Los estados posibles, en el orden en que importan.
 *
 * Va de lo que exige acción hoy a lo que ya está resuelto, y ese orden es el de
 * la pantalla y el de la tabla.
 */
export const ESTADOS = {
  SIN_CONTRATO: {
    etiqueta: 'Sin contrato',
    tono: 'red',
    explicacion: 'Opera sin contrato firmado. No hay papel que respalde el servicio.',
  },
  VENCIDO: {
    etiqueta: 'Vencido',
    tono: 'red',
    explicacion: 'La vigencia terminó y el servicio sigue operando. Toca renovar.',
  },
  POR_VENCER: {
    etiqueta: 'Por vencer',
    tono: 'amber',
    explicacion: 'Vence dentro de los próximos 90 días. Es el momento de moverlo.',
  },
  SIN_FECHA: {
    etiqueta: 'Sin vigencia',
    tono: 'slate',
    explicacion: 'Dice tener contrato pero no se capturó hasta cuándo vale. No se puede saber si está vigente.',
  },
  VIGENTE: {
    etiqueta: 'Vigente',
    tono: 'emerald',
    explicacion: 'Contrato firmado y dentro de su vigencia.',
  },
};

/** El aviso previo con el que trabaja jurídico. Un trimestre. */
export const DIAS_AVISO = 90;

/** El orden en que se atiende la cartera: primero lo que quema. */
export const PESO = { SIN_CONTRATO: 0, VENCIDO: 1, POR_VENCER: 2, SIN_FECHA: 3, VIGENTE: 4 };

export const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

/** Días entre dos fechas AAAA-MM-DD. Negativo si la segunda ya pasó. */
function diasHasta(fecha, desde) {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${fecha}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * En qué estado está el contrato de un servicio.
 *
 * Se calcula, no se guarda. Un contrato vence solo con que pase el tiempo: si
 * el estado viviera en una columna, hoy diría «vigente» en 58 renglones que ya
 * caducaron y nadie se enteraría hasta volver a tocarlos.
 */
export function estadoDeContrato(s, referencia = hoy()) {
  const vence = vacio(s.fecha_vencimiento_contrato) ? null : String(s.fecha_vencimiento_contrato).slice(0, 10);
  const dias = vence ? diasHasta(vence, referencia) : null;

  let clave;
  if (!s.tiene_contrato) clave = 'SIN_CONTRATO';
  else if (!vence) clave = 'SIN_FECHA';
  else if (dias < 0) clave = 'VENCIDO';
  else if (dias <= DIAS_AVISO) clave = 'POR_VENCER';
  else clave = 'VIGENTE';

  return { clave, ...ESTADOS[clave], vence, dias };
}
