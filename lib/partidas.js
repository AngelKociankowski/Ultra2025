/**
 * El precio de un servicio, partida por partida.
 *
 * En un servicio los guardias no cuestan lo mismo. Un jefe de servicio cuesta
 * más que un guardia raso; el mismo puesto en 24 horas no vale lo que en
 * 12X12, porque son horas y prestaciones distintas. Con un solo precio por
 * servicio había que promediar, y un promedio no sirve para cotizar, ni para
 * explicarle al cliente su factura, ni para subirle el precio a un puesto sin
 * tocar los demás.
 *
 * Cada partida dice: tantos guardias, de tal puesto, en tal turno, a tal
 * precio. El importe mensual del servicio es la suma.
 *
 * Cómo convive con lo que ya había
 * --------------------------------
 * De los 222 servicios activos, 205 traen su importe mensual capturado a mano
 * y solo 5 traen precio por guardia. Ese importe no se toca: mientras un
 * servicio no tenga partidas, sigue siendo el suyo. En cuanto se captura la
 * primera, el importe pasa a salir de la suma —y desde ahí el número deja de
 * ser un dato suelto para tener una explicación detrás.
 *
 * Las partidas no mueven el estado de fuerza. Cuántos guardias hay lo dicen las
 * aperturas y las cancelaciones, y eso no cambia: si las partidas suman más o
 * menos que la plantilla, se avisa del descuadre en lugar de corregir por
 * cuenta propia una cifra que solo un movimiento puede mover.
 */

import { getDb, auditar } from './db';
import { exigirDelCatalogo, turnosAceptados } from './catalogos';
import { ValidacionError } from './errores';

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

const IVA = 0.16;

function limpiarNumero(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Las partidas de un servicio, con su importe ya calculado. */
export function partidasDe(servicioId) {
  return getDb()
    .prepare('SELECT * FROM partidas_precio WHERE servicio_id = ? ORDER BY orden, id')
    .all(Number(servicioId))
    .map((p) => ({ ...p, importe: redondear(p.cantidad * p.precio_unitario) }));
}

/**
 * El resumen que consume la pantalla: los totales y si cuadran con la plantilla.
 *
 * El descuadre se enseña, no se corrige. Que las partidas sumen ocho guardias y
 * el estado de fuerza diga seis puede significar dos cosas —falta capturar un
 * movimiento, o sobra una partida— y solo quien lleva el servicio sabe cuál.
 */
export function resumenDe(servicio) {
  const partidas = partidasDe(servicio.id);
  const guardias = partidas.reduce((a, p) => a + (p.cantidad || 0), 0);
  const sinIva = redondear(partidas.reduce((a, p) => a + p.importe, 0));

  return {
    partidas,
    hay: partidas.length > 0,
    guardias,
    sinIva,
    conIva: redondear(sinIva * (1 + IVA)),
    // Cuadra contra el total de guardias del servicio, que lo mueven las
    // aperturas y las cancelaciones. Un servicio sin partidas no descuadra:
    // simplemente no se ha capturado su precio a detalle.
    cuadra: partidas.length === 0 || guardias === servicio.total_guardias,
    plantilla: servicio.total_guardias,
  };
}

/** Los servicios que ya tienen su precio desglosado, para no consultarlos uno a uno. */
export function serviciosConPartidas() {
  return new Set(
    getDb()
      .prepare('SELECT DISTINCT servicio_id AS id FROM partidas_precio')
      .all()
      .map((r) => r.id)
  );
}

function normalizar(fila, indice) {
  const puesto = exigirDelCatalogo('puesto', fila.puesto);
  if (!puesto) throw new ValidacionError(`El renglón ${indice + 1} necesita un puesto.`);

  // El turno es opcional —hay servicios que cobran igual sin importar el
  // horario— pero si viene tiene que ser uno de verdad.
  const turno = String(fila.turno || '').toUpperCase().trim() || null;
  if (turno && !turnosAceptados().has(turno)) {
    throw new ValidacionError(`El turno «${turno}» del renglón ${indice + 1} no está en el catálogo.`);
  }

  const cantidad = Math.round(limpiarNumero(fila.cantidad) ?? 0);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new ValidacionError(`El renglón ${indice + 1} necesita cuántos guardias son.`);
  }

  const precio = limpiarNumero(fila.precio_unitario);
  if (precio === null || precio < 0) {
    throw new ValidacionError(`El renglón ${indice + 1} necesita el precio de cada uno.`);
  }

  return {
    puesto,
    turno,
    cantidad,
    precio_unitario: redondear(precio),
    nota: String(fila.nota || '').trim() || null,
    orden: indice,
  };
}

/**
 * Reemplaza el desglose completo del servicio.
 *
 * Se guarda entero de una vez y no renglón por renglón: la pantalla es una
 * tabla que se edita como un todo, y guardar por partes dejaría estados
 * intermedios donde el importe del servicio no corresponde a nada.
 *
 * Al guardar, el importe mensual del servicio se recalcula desde la suma. Es la
 * única forma de que la factura, el tablero y la cartera vencida hablen del
 * mismo número que el detalle que se acaba de capturar.
 */
export function guardarPartidas(servicioId, filas, usuario) {
  const db = getDb();
  const id = Number(servicioId);
  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(id);
  if (!s) throw new ValidacionError('El servicio no existe.');

  const lista = (Array.isArray(filas) ? filas : [])
    // Un renglón en blanco no es un error: es el que quedó al agregar y no
    // llenar. Se ignora en silencio.
    .filter((f) => f && (f.puesto || f.cantidad || f.precio_unitario))
    .map(normalizar);

  // Dos renglones del mismo puesto y turno son el mismo concepto partido en
  // dos: suman igual, pero al leer la cotización parecen cosas distintas.
  const vistos = new Set();
  for (const p of lista) {
    const llave = `${p.puesto}|${p.turno || ''}`;
    if (vistos.has(llave)) {
      throw new ValidacionError(
        `«${p.puesto}${p.turno ? ` en ${p.turno}` : ''}» está capturado dos veces. Júntalo en un solo renglón.`
      );
    }
    vistos.add(llave);
  }

  const sinIva = redondear(lista.reduce((a, p) => a + p.cantidad * p.precio_unitario, 0));
  const antes = partidasDe(id);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM partidas_precio WHERE servicio_id = ?').run(id);
    const ins = db.prepare(
      `INSERT INTO partidas_precio (servicio_id, puesto, turno, cantidad, precio_unitario, nota, orden)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const p of lista) ins.run(id, p.puesto, p.turno, p.cantidad, p.precio_unitario, p.nota, p.orden);

    if (lista.length) {
      // El importe del servicio pasa a salir del desglose. El de factura lleva
      // IVA porque así se captura en la ficha y así se cobra.
      db.prepare(
        `UPDATE servicios
            SET importe_sin_iva = ?, importe_factura = ?, actualizado_en = datetime('now')
          WHERE id = ?`
      ).run(sinIva, redondear(sinIva * (1 + IVA)), id);
    }

    auditar(db, {
      usuario,
      accion: 'precio_partidas',
      entidad: 'servicio',
      entidad_id: id,
      detalle: lista.length
        ? `${s.servicio} — ${lista.length} renglón${lista.length === 1 ? '' : 'es'} de precio, ` +
          `${lista.reduce((a, p) => a + p.cantidad, 0)} guardias`
        : `${s.servicio} — se quitó el desglose de precio`,
      cambios: {
        partidas: {
          antes: antes.map((p) => `${p.puesto}${p.turno ? ` ${p.turno}` : ''} ×${p.cantidad} @ ${p.precio_unitario}`),
          despues: lista.map((p) => `${p.puesto}${p.turno ? ` ${p.turno}` : ''} ×${p.cantidad} @ ${p.precio_unitario}`),
        },
      },
    });
  });
  tx();

  return { ...resumenDe(db.prepare('SELECT * FROM servicios WHERE id = ?').get(id)), guardadas: lista.length };
}

/**
 * Sube el precio de las partidas en la misma proporción que el servicio.
 *
 * Lo usa el aumento anual: si el importe del servicio sube 5 %, cada renglón
 * sube 5 %. De otro modo el detalle quedaría diciendo una cosa y el total otra,
 * y el detalle es el que se le enseña al cliente.
 */
export function aplicarFactor(db, servicioId, factor) {
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  const filas = db.prepare('SELECT id, precio_unitario FROM partidas_precio WHERE servicio_id = ?').all(servicioId);
  const upd = db.prepare("UPDATE partidas_precio SET precio_unitario = ?, actualizado_en = datetime('now') WHERE id = ?");
  for (const f of filas) upd.run(redondear(f.precio_unitario * factor), f.id);
  return filas.length;
}

/** Cuántas partidas hay en toda la operación, para saber si ya se usa. */
export function cuantasPartidas() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM partidas_precio').get().n;
}
