/**
 * La cartera vista desde jurídico.
 *
 * El estado de fuerza contesta «cuántos guardias hay». Cobranza contesta «quién
 * debe». Faltaba la pregunta de jurídico, que es otra: **con qué papel está
 * operando cada servicio**. Hasta ahora esa respuesta estaba repartida en la
 * ficha de cada uno de los 223 servicios vivos, de modo que para saber cuántos
 * contratos están vencidos había que abrirlos uno por uno.
 *
 * Los datos reales al escribir esto —y son la razón de que esta pantalla exista
 * y de la forma que tiene:
 *
 *   · 76 servicios operan sin contrato, y facturan $8.1 M al mes.
 *   · 58 contratos ya vencieron. Son 331 guardias en la calle.
 *   · 51 servicios vivos no tienen fecha de vencimiento capturada: de esos ni
 *     siquiera se sabe si están vencidos.
 *   · 0 contratos tienen el PDF cargado. El archivero digital está vacío.
 *
 * Un servicio sin contrato no es una falta administrativa: es la empresa
 * poniendo gente en un domicilio ajeno sin nada firmado que diga bajo qué
 * condiciones. Por eso los números de arriba de la pantalla no son cuentas de
 * expedientes sino guardias y pesos —lo que de verdad está expuesto.
 */

import { getDb } from './db';
import { hoy } from './fechas';

import { ESTADOS, DIAS_AVISO, PESO, estadoDeContrato, vacio } from './contratos';

// Se reexportan para que la pantalla no tenga que saber en cuál de los dos
// módulos vive cada cosa: pide todo lo de jurídico a `lib/juridico`.
export { ESTADOS, DIAS_AVISO, estadoDeContrato };

const CAMPOS = `id, servicio, razon_social, zona, asesor, gerente, estatus, total_guardias,
                importe_factura, precio_guardia, dias_credito, fecha_alta,
                tiene_contrato, fecha_contrato, fecha_vencimiento_contrato,
                condiciones_comerciales, comentarios_contrato,
                contrato_archivo, contrato_archivo_nombre, contrato_archivo_bytes,
                contrato_archivo_subido_en`;

/**
 * Los servicios que le importan a jurídico: los que están operando.
 *
 * Incluye los suspendidos a propósito. Un servicio en pausa conserva su
 * contrato y va a volver; si su vigencia caduca mientras está parado, al
 * reactivarlo arranca sin papel. Las bajas sí quedan fuera: un contrato de un
 * cliente que se fue ya no hay que renovarlo.
 */
function vivos(db) {
  return db.prepare(`SELECT ${CAMPOS} FROM servicios WHERE estatus <> 'BAJA' ORDER BY servicio`).all();
}

const monto = (s) => Number(s.importe_factura || 0);

/**
 * Los números de arriba, por estado de contrato.
 *
 * Cada casilla trae servicios, guardias y pesos. Decir «58 contratos vencidos»
 * no mueve a nadie; decir «58 contratos vencidos, 331 guardias, $7.1 M al mes»
 * dice de qué tamaño es el problema.
 */
export function kpisJuridico() {
  const filas = vivos(getDb());
  const referencia = hoy();

  const base = () => ({ servicios: 0, guardias: 0, monto: 0 });
  const por = Object.fromEntries(Object.keys(ESTADOS).map((k) => [k, base()]));
  const total = base();
  let conPdf = 0;
  let conContrato = 0;

  for (const s of filas) {
    const { clave } = estadoDeContrato(s, referencia);
    for (const acc of [por[clave], total]) {
      acc.servicios += 1;
      acc.guardias += Number(s.total_guardias || 0);
      acc.monto += monto(s);
    }
    if (s.tiene_contrato) conContrato += 1;
    if (s.contrato_archivo) conPdf += 1;
  }

  return {
    por,
    total,
    // El expediente digital: de los que dicen tener contrato, de cuántos se
    // puede enseñar el papel sin ir al archivero.
    expediente: { conPdf, conContrato },
    // Lo que hay que atender ya: sin contrato o vencido. Es la suma que se
    // pone en grande porque es la única que exige acción esta semana.
    urgente: {
      servicios: por.SIN_CONTRATO.servicios + por.VENCIDO.servicios,
      guardias: por.SIN_CONTRATO.guardias + por.VENCIDO.guardias,
      monto: por.SIN_CONTRATO.monto + por.VENCIDO.monto,
    },
  };
}

/**
 * La cartera filtrada, con su estado ya resuelto y su propio subtotal.
 *
 * El subtotal se calcula sobre lo filtrado, no sobre todo: si jurídico filtra
 * por una zona, quiere saber cuánto pesa esa zona, no la empresa entera.
 */
export function carteraJuridica({ estado = '', zona = '', asesor = '', pdf = '', q = '' } = {}) {
  const referencia = hoy();
  const texto = String(q || '').trim().toLowerCase();

  let filas = vivos(getDb()).map((s) => ({ ...s, contrato: estadoDeContrato(s, referencia) }));

  if (estado) filas = filas.filter((s) => s.contrato.clave === estado);
  if (zona) filas = filas.filter((s) => s.zona === zona);
  if (asesor) filas = filas.filter((s) => s.asesor === asesor);
  if (pdf === 'con') filas = filas.filter((s) => Boolean(s.contrato_archivo));
  if (pdf === 'sin') filas = filas.filter((s) => !s.contrato_archivo);
  if (texto) {
    filas = filas.filter((s) =>
      [s.servicio, s.razon_social, s.asesor, s.comentarios_contrato, s.condiciones_comerciales]
        .some((v) => String(v || '').toLowerCase().includes(texto))
    );
  }

  // Primero lo que quema. Dentro de cada grupo, por fecha: el más vencido y el
  // más próximo a vencer arriba, que es el orden en que se trabaja.
  filas.sort((a, b) => {
    const d = PESO[a.contrato.clave] - PESO[b.contrato.clave];
    if (d !== 0) return d;
    if (a.contrato.vence && b.contrato.vence) return a.contrato.vence.localeCompare(b.contrato.vence);
    return String(a.servicio).localeCompare(String(b.servicio), 'es');
  });

  return {
    filas,
    subtotal: {
      servicios: filas.length,
      guardias: filas.reduce((t, s) => t + Number(s.total_guardias || 0), 0),
      monto: filas.reduce((t, s) => t + monto(s), 0),
    },
  };
}

/**
 * Cuántos contratos vencen cada mes, de aquí en adelante.
 *
 * Es la agenda de renovaciones. Con las fechas de hoy, octubre trae 15 y marzo
 * del 27 trae 21: saberlo con meses de anticipación es la diferencia entre
 * renovar y volver a operar vencido.
 */
export function calendarioVencimientos({ meses = 18 } = {}) {
  const referencia = hoy();
  const filas = vivos(getDb()).filter((s) => s.tiene_contrato && !vacio(s.fecha_vencimiento_contrato));

  const cuenta = new Map();
  for (const s of filas) {
    const mes = String(s.fecha_vencimiento_contrato).slice(0, 7);
    const actual = cuenta.get(mes) || { mes, servicios: 0, guardias: 0, monto: 0 };
    actual.servicios += 1;
    actual.guardias += Number(s.total_guardias || 0);
    actual.monto += monto(s);
    cuenta.set(mes, actual);
  }

  // Los meses se generan corridos aunque estén vacíos: un hueco en la agenda es
  // información —ese mes no hay nada que renovar— y una barra que se salta un
  // mes engaña sobre el ritmo.
  const inicio = referencia.slice(0, 7);
  const salida = [];
  let [anio, mes] = inicio.split('-').map(Number);
  for (let i = 0; i < meses; i++) {
    const clave = `${anio}-${String(mes).padStart(2, '0')}`;
    salida.push(cuenta.get(clave) || { mes: clave, servicios: 0, guardias: 0, monto: 0 });
    cuenta.delete(clave);
    if (++mes > 12) {
      mes = 1;
      anio += 1;
    }
  }

  // Lo que ya venció no cabe en una agenda hacia adelante, pero tampoco se
  // puede perder: se devuelve aparte para poder decirlo.
  const atrasado = [...cuenta.values()].filter((m) => m.mes < inicio);
  return {
    meses: salida,
    vencidos: {
      servicios: atrasado.reduce((t, m) => t + m.servicios, 0),
      guardias: atrasado.reduce((t, m) => t + m.guardias, 0),
      monto: atrasado.reduce((t, m) => t + m.monto, 0),
    },
    // Lo que queda más allá de la ventana, para no dar a entender que no hay nada.
    despues: [...cuenta.values()].filter((m) => m.mes >= inicio).reduce((t, m) => t + m.servicios, 0),
  };
}

/**
 * Capturas que se contradicen a sí mismas.
 *
 * No se corrigen solas y no se esconden. Son 35 renglones donde el dato dice
 * dos cosas a la vez, y jurídico es quien sabe cuál de las dos es la buena:
 *
 *   · 30 servicios marcados «sin contrato» que traen fechas de contrato. O el
 *     contrato existe y falta la palomita, o las fechas son de un contrato que
 *     ya no está vigente.
 *   · 5 marcados «con contrato» sin fecha de firma, sin vigencia y sin PDF.
 *     La palomita no está respaldada por nada.
 */
export function inconsistencias() {
  const filas = vivos(getDb());

  const dicenQueNo = filas.filter(
    (s) => !s.tiene_contrato && (!vacio(s.fecha_contrato) || !vacio(s.fecha_vencimiento_contrato))
  );
  const dicenQueSi = filas.filter(
    (s) =>
      s.tiene_contrato &&
      vacio(s.fecha_contrato) &&
      vacio(s.fecha_vencimiento_contrato) &&
      !s.contrato_archivo
  );

  return {
    dicenQueNo,
    dicenQueSi,
    total: dicenQueNo.length + dicenQueSi.length,
  };
}

/** Las zonas y asesores que existen entre los servicios vivos, para los filtros. */
export function catalogosJuridicos() {
  const db = getDb();
  const lista = (campo) =>
    db
      .prepare(`SELECT DISTINCT ${campo} v FROM servicios WHERE estatus <> 'BAJA' AND ${campo} IS NOT NULL AND ${campo} <> '' ORDER BY ${campo}`)
      .all()
      .map((r) => r.v);
  return { zonas: lista('zona'), asesores: lista('asesor') };
}

/** Columnas del CSV que se lleva jurídico a una junta o a un despacho externo. */
export const COLUMNAS_CSV = [
  ['servicio', 'Servicio'],
  ['razon_social', 'Razón social'],
  ['zona', 'Zona'],
  ['asesor', 'Asesor'],
  ['estatus', 'Estatus'],
  ['total_guardias', 'Guardias'],
  ['importe_factura', 'Importe mensual'],
  ['estado_contrato', 'Estado del contrato'],
  ['tiene_contrato', '¿Tiene contrato?'],
  ['fecha_contrato', 'Firma'],
  ['fecha_vencimiento_contrato', 'Vence'],
  ['dias', 'Días para vencer'],
  ['condiciones_comerciales', 'Condiciones comerciales'],
  ['comentarios_contrato', 'Comentarios de jurídico'],
  ['pdf', '¿PDF cargado?'],
];

/** Aplana una fila de la cartera a las columnas del CSV. */
export function filaParaCSV(s) {
  return {
    ...s,
    estado_contrato: s.contrato.etiqueta,
    tiene_contrato: s.tiene_contrato ? 'Sí' : 'No',
    dias: s.contrato.dias === null ? '' : s.contrato.dias,
    pdf: s.contrato_archivo ? 'Sí' : 'No',
  };
}
