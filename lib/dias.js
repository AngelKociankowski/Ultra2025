/**
 * El estado de fuerza a una fecha, no solo a un mes.
 *
 * Hasta ahora la plataforma sabía contestar dos preguntas: cómo está la
 * operación hoy, y cómo quedó el corte de un mes cerrado. Entre las dos hay un
 * hueco de treinta días, y ahí caen las preguntas que de verdad se hacen: «¿con
 * cuántos elementos amanecimos el 15?», «¿ese servicio ya estaba montado cuando
 * el cliente reclamó?».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Lo que se puede reconstruir y lo que no
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Antes de escribir esto se midió si los datos aguantaban, y la respuesta
 * decide el diseño entero.
 *
 * NO se puede reconstruir replicando movimientos. Sumar todas las aperturas y
 * restar todas las cancelaciones desde el principio da 749 guardias donde la
 * operación tiene 880. Mes a mes la deriva va de 9 a 89 guardias. La razón es
 * que los movimientos y el estado de fuerza vienen de dos archivos distintos
 * que nunca cuadraron entre sí: 310 de las 330 cancelaciones ni siquiera dicen
 * a qué servicio pertenecen. Un contador que arranque de cero y vaya sumando
 * daría un número redondo, con su fecha y todo, y estaría mal por decenas de
 * guardias sin que nada lo advirtiera.
 *
 * SÍ se puede reconstruir por las fechas de cada servicio. `fecha_alta` está
 * capturada en los 217 y `fecha_baja` en todas las bajas, así que QUÉ SERVICIOS
 * estaban en la calle un día es una pregunta que la base contesta exacto. Al 31
 * de julio esto da 217 servicios y 880 guardias, y el corte guardado de julio
 * dice 217 y 880: coinciden.
 *
 * Lo que no es exacto es la PLANTILLA de cada servicio hacia atrás. La columna
 * guarda la de hoy. Si a un servicio le subieron dos elementos la semana
 * pasada, mirar el lunes anterior lo enseñaría con los de hoy. Eso se corrige
 * hasta donde alcanza —los incrementos y reducciones que sí dicen a qué
 * servicio pertenecen se revierten— y lo que no alcanza se dice: cada consulta
 * devuelve cuántos renglones llevan plantilla ajustada y cuántos la de hoy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Hasta dónde llega hacia atrás
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Y hay un límite duro que conviene tener a la vista, porque se descubrió
 * midiendo y no razonando: al 31 de marzo la reconstrucción da 208 servicios y
 * 856 guardias, y el corte guardado de marzo dice 218 y 893. Faltan diez
 * servicios.
 *
 * La razón es que un servicio cancelado hace tiempo no está en la tabla de
 * servicios: los 310 movimientos de cancelación del histórico importado ni
 * siquiera dicen a qué servicio pertenecían, porque esos servicios ya no
 * existían cuando se cargó la hoja. La reconstrucción solo puede enseñar lo que
 * sobrevivió hasta hoy, y cuanto más atrás se mire, más gente falta.
 *
 * Por eso la vista por día no se ofrece más allá del último corte cerrado. En
 * ese tramo —del cierre del último mes hasta hoy— nada ha desaparecido y la
 * reconstrucción cuadra exacto con el corte. Antes de esa fecha, el corte
 * mensual es la respuesta buena y la pantalla manda a él en vez de dibujar un
 * número que se queda corto sin avisar.
 *
 * Un dato incompleto que se presenta como completo es peor que no tenerlo: el
 * primero se usa para tomar decisiones y el segundo manda a buscar la fuente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Dos convenciones, para que no haya un día de diferencia según quién cuente:
 *
 *   · La fecha de alta CUENTA. Un servicio montado el 15 estuvo en la calle
 *     el 15.
 *   · La fecha de baja NO CUENTA. Un servicio cancelado el 20 ya no aparece el
 *     20.
 *
 * Es el intervalo medio abierto de toda la vida, y se elige por una razón
 * práctica: encadenando días así, ninguno se cuenta dos veces ni se queda sin
 * contar. La otra convención —que la baja cuente— también sería defendible,
 * pero entonces el día en que un servicio se cancela y otro se abre en su lugar
 * sumaría los dos.
 *
 * La regla que gobierna todo esto es la misma de siempre en esta plataforma:
 * antes de dar un número, saber de dónde sale; y cuando no se sabe, decirlo en
 * vez de rellenarlo.
 */

import { getDb } from './db';

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El último día del mes de esa fecha. */
function finDeMes(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/**
 * Desde cuándo la reconstrucción por día es de fiar.
 *
 * Es el cierre del último corte guardado. De ahí para acá no ha desaparecido
 * ningún servicio de la tabla, así que las fechas de alta y baja explican todo
 * lo que pasó. Más atrás faltan los servicios que se cancelaron antes de que se
 * cargara la hoja, y el número se queda corto sin que nada lo advierta.
 */
export function desdeCuando() {
  const ultimo = getDb().prepare('SELECT MAX(periodo) p FROM snapshots').get()?.p;
  return ultimo ? finDeMes(ultimo) : null;
}

/** La fecha, validada. Devuelve null si no lo es. */
export function comoDia(v) {
  const d = String(v || '').trim();
  if (!ES_FECHA.test(d)) return null;
  // Una fecha con forma correcta pero imposible —2026-02-31— se cuela por el
  // patrón y luego compara mal en SQL.
  const [a, m, dd] = d.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, dd));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== dd) return null;
  return d;
}

/**
 * Cuánto hay que corregirle la plantilla a cada servicio para verla a esa
 * fecha.
 *
 * Solo cuentan los movimientos que dicen a qué servicio pertenecen. Los otros
 * —la mayoría del histórico importado— no se pueden atribuir a nadie, y
 * repartirlos a ojo sería inventar. Se quedan fuera y su ausencia se reporta.
 *
 * La apertura que dio origen al servicio no estorba: su fecha es la misma
 * `fecha_alta` con la que el servicio entró, así que nunca es posterior al día
 * que se está mirando.
 */
function ajustesDePlantilla(db, dia) {
  const ajuste = new Map();
  const suma = (id, n) => ajuste.set(id, (ajuste.get(id) || 0) + n);

  // Lo que subió después de ese día todavía no estaba: se resta.
  for (const r of db
    .prepare(
      `SELECT servicio_id, SUM(guardias) g FROM aperturas
        WHERE servicio_id IS NOT NULL AND descartada = 0 AND fecha > ?
        GROUP BY servicio_id`
    )
    .all(dia)) {
    suma(r.servicio_id, -(Number(r.g) || 0));
  }

  // Lo que bajó después de ese día todavía estaba: se devuelve.
  for (const r of db
    .prepare(
      `SELECT servicio_id, SUM(guardias) g FROM cancelaciones
        WHERE servicio_id IS NOT NULL AND tipo = 'REDUCCION' AND fecha > ?
        GROUP BY servicio_id`
    )
    .all(dia)) {
    suma(r.servicio_id, Number(r.g) || 0);
  }

  return ajuste;
}

/**
 * El estado de fuerza tal como estaba al cierre de `dia`.
 *
 * Los filtros son los mismos que los del mes vigente para que la pantalla no
 * tenga que saber de dónde vino cada renglón.
 */
export function estadoAlDia(dia, filtros = {}) {
  const d = comoDia(dia);
  if (!d) throw new Error('La fecha debe ir como AAAA-MM-DD.');
  const db = getDb();

  const where = [
    'fecha_alta <= ?',
    // La baja no cuenta: el día que un servicio se cancela ya no aparece. Ver
    // arriba por qué el intervalo va medio abierto.
    "(estatus <> 'BAJA' OR fecha_baja IS NULL OR fecha_baja > ?)",
    // Una pausa que empezó después de ese día no había empezado.
    '(suspendido_desde IS NULL OR suspendido_desde > ?)',
  ];
  const args = [d, d, d];

  if (filtros.zona) { where.push('zona = ?'); args.push(filtros.zona); }
  if (filtros.asesor) { where.push('asesor = ?'); args.push(filtros.asesor); }
  if (filtros.turno) { where.push('turnos_json LIKE ?'); args.push(`%"${filtros.turno}":%`); }
  if (filtros.contrato === 'si') where.push('tiene_contrato = 1');
  if (filtros.contrato === 'no') where.push('(tiene_contrato IS NULL OR tiene_contrato = 0)');
  if (filtros.facturado === 'si') where.push('importe_factura IS NOT NULL AND importe_factura > 0');
  if (filtros.facturado === 'no') where.push('(importe_factura IS NULL OR importe_factura = 0)');
  if (filtros.q) {
    where.push('(servicio LIKE ? OR razon_social LIKE ? OR asesor LIKE ?)');
    const like = `%${filtros.q}%`;
    args.push(like, like, like);
  }

  const filas = db
    .prepare(`SELECT * FROM servicios WHERE ${where.join(' AND ')} ORDER BY servicio`)
    .all(...args);

  const ajuste = ajustesDePlantilla(db, d);
  let ajustados = 0;

  const servicios = filas.map((s) => {
    const delta = ajuste.get(s.id) || 0;
    if (delta) ajustados++;
    // Nunca por debajo de cero: un movimiento mal capturado no debe producir
    // una plantilla negativa, que además no querría decir nada.
    const total = Math.max(0, (Number(s.total_guardias) || 0) + delta);
    return {
      ...s,
      total_guardias: total,
      turnos: JSON.parse(s.turnos_json || '{}'),
      // Para poder señalar el renglón en la pantalla y explicar por qué su
      // número no es el que se ve en el mes en curso.
      plantilla_ajustada: delta ? delta : null,
      plantilla_hoy: Number(s.total_guardias) || 0,
    };
  });

  const limite = desdeCuando();

  return {
    dia: d,
    servicios,
    // Fuera de alcance no quiere decir «no hay datos»: quiere decir que los que
    // hay se quedan cortos y hay una fuente mejor, que es el corte de ese mes.
    fueraDeAlcance: Boolean(limite && d < limite),
    limite,
    exactitud: {
      // El conjunto sale de las fechas de cada servicio, que están completas.
      conjunto: 'exacto',
      ajustados,
      sinAjustar: servicios.length - ajustados,
      // Una pausa que ya se levantó borra su fecha de inicio al reactivarse, así
      // que un día dentro de esa pausa enseña el servicio como si hubiera estado
      // operando. No se puede saber de otra forma y conviene decirlo.
      pausasBorradas: db
        .prepare("SELECT COUNT(*) n FROM servicios WHERE estatus = 'ACTIVO' AND suspendido_motivo IS NOT NULL")
        .get().n,
    },
  };
}

/**
 * Qué se movió ese día.
 *
 * Es la parte exacta de todo esto: la fecha de un movimiento es un dato
 * capturado, no una deducción. Sirve para explicar el salto entre un día y el
 * anterior sin tener que compararlos renglón por renglón.
 */
export function movimientosDelDia(dia) {
  const d = comoDia(dia);
  if (!d) return { entraron: [], salieron: [] };
  const db = getDb();
  return {
    entraron: db
      .prepare(
        `SELECT folio, tipo, servicio, guardias, zona, servicio_id FROM aperturas
          WHERE fecha = ? AND descartada = 0 ORDER BY servicio`
      )
      .all(d),
    salieron: db
      .prepare(
        `SELECT folio, tipo, servicio, guardias, zona, motivo, servicio_id FROM cancelaciones
          WHERE fecha = ? ORDER BY servicio`
      )
      .all(d),
  };
}

/**
 * La comprobación contra el corte del mes, cuando la hay.
 *
 * Es lo que convierte un número reconstruido en un número con respaldo. Si al
 * mirar el último día de un mes cerrado la reconstrucción da lo mismo que el
 * corte que se guardó ese mes, el método está bien para ese tramo; si da otra
 * cosa, la pantalla lo dice en vez de presentar la cifra como si nada.
 *
 * Solo se compara contra el ÚLTIMO día del mes, que es la foto que el corte
 * guardó. Compararlo contra el día 12 no probaría nada: el corte no dice cómo
 * estaba la operación a media quincena.
 */
export function contrasteConCorte(dia, guardiasReconstruidas, serviciosReconstruidos) {
  const d = comoDia(dia);
  if (!d) return null;
  const db = getDb();

  const periodo = d.slice(0, 7);
  const ultimoDelMes = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  if (d !== ultimoDelMes) return null;

  const corte = db
    .prepare('SELECT COUNT(*) servicios, SUM(total_guardias) guardias FROM snapshots WHERE periodo = ?')
    .get(periodo);
  if (!corte || !corte.servicios) return null;

  return {
    periodo,
    servicios: corte.servicios,
    guardias: corte.guardias || 0,
    difServicios: serviciosReconstruidos - corte.servicios,
    difGuardias: guardiasReconstruidas - (corte.guardias || 0),
  };
}

/**
 * Los días con movimiento en un mes, para poder saltar a ellos.
 *
 * Un calendario de treinta y un casillas donde solo cuatro tienen algo obliga a
 * probar día por día. Esto dice cuáles valen la pena.
 */
export function diasConMovimiento(periodo) {
  const p = String(periodo || '');
  if (!/^\d{4}-\d{2}$/.test(p)) return [];
  return getDb()
    .prepare(
      `SELECT fecha,
              SUM(CASE WHEN o = 'A' THEN guardias ELSE 0 END) entraron,
              SUM(CASE WHEN o = 'C' THEN guardias ELSE 0 END) salieron
         FROM (
           SELECT fecha, guardias, 'A' o FROM aperturas WHERE periodo = ? AND descartada = 0
           UNION ALL
           SELECT fecha, guardias, 'C' o FROM cancelaciones WHERE periodo = ?
         )
        GROUP BY fecha ORDER BY fecha`
    )
    .all(p, p);
}
