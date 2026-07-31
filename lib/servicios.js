/**
 * Capa de acceso al estado de fuerza.
 *
 * Punto único de escritura sobre la tabla `servicios`. Solo expone:
 *   - registrarApertura()    -> crea un servicio (o incrementa uno existente)
 *   - registrarCancelacion() -> da de baja un servicio (o reduce guardias)
 *   - actualizarServicio()   -> edita campos de contrato / finanzas / operativos
 *
 * No existe una función para crear o borrar servicios fuera de esos dos flujos:
 * es la garantía técnica de la regla de negocio.
 */

import { getDb, auditar, siguienteFolio } from './db';
import { filtrarCampos } from './rbac';

const TURNOS_SOPORTADOS = [
  '8X16 L-D', '8X16 L-S', '8X16 L-V',
  '12X12 L-D', '12X12 L-S', '12X12 L-V',
  '10X14', '11X13', '12 HRS', '13X47',
  '12X24', '12X36', '24 HRS', '24X24', '24X48',
];

export { TURNOS_SOPORTADOS };

function sumaTurnos(turnos) {
  return Object.values(turnos || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function mezclarTurnos(base, delta, signo = 1) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(delta || {})) {
    const n = (Number(out[k]) || 0) + signo * (Number(v) || 0);
    if (n > 0) out[k] = n;
    else delete out[k];
  }
  return out;
}

/**
 * Un movimiento parcial sobre un servicio que tiene desglose de turnos también
 * tiene que venir desglosado. Si no, el total se mueve y el desglose se queda
 * como estaba: quedan diciendo cosas distintas y la siguiente disminución —que
 * se captura por turno— trabaja sobre cifras que ya no existen.
 */
function exigirDesglose(servicio, turnos, verbo) {
  const tieneDesglose = Object.keys(JSON.parse(servicio.turnos_json || '{}')).length > 0;
  if (tieneDesglose && sumaTurnos(turnos) <= 0) {
    throw new ValidacionError(
      `Este servicio tiene el desglose por turno capturado, así que indica de qué turnos ${verbo}.`
    );
  }
}

function periodoDe(fecha) {
  if (!fecha) return null;
  return String(fecha).slice(0, 7);
}

// ---------------------------------------------------------------- consultas

export function listarServicios({ estatus, zona, asesor, contrato, facturado, q } = {}) {
  const db = getDb();
  const where = [];
  const args = [];
  if (estatus) { where.push('estatus = ?'); args.push(estatus); }
  if (zona) { where.push('zona = ?'); args.push(zona); }
  if (asesor) { where.push('asesor = ?'); args.push(asesor); }
  if (contrato === 'si') where.push('tiene_contrato = 1');
  if (contrato === 'no') where.push('tiene_contrato = 0');
  if (facturado === 'si') where.push('facturado = 1');
  if (facturado === 'no') where.push('facturado = 0');
  if (q) {
    where.push('(servicio LIKE ? OR razon_social LIKE ? OR asesor LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sql = `SELECT * FROM servicios ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY estatus, zona, servicio`;
  return db.prepare(sql).all(...args).map(hidratar);
}

export function obtenerServicio(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM servicios WHERE id = ?').get(id);
  if (!row) return null;
  const s = hidratar(row);
  s.aperturas = db.prepare('SELECT * FROM aperturas WHERE servicio_id = ? ORDER BY creado_en').all(id);
  s.cancelaciones = db.prepare('SELECT * FROM cancelaciones WHERE servicio_id = ? ORDER BY creado_en').all(id);
  s.correcciones = listarCorrecciones(id);
  s.bitacora = db
    .prepare("SELECT * FROM bitacora WHERE entidad = 'servicio' AND entidad_id = ? ORDER BY creado_en DESC LIMIT 100")
    .all(id);
  return s;
}

function hidratar(row) {
  return { ...row, turnos: JSON.parse(row.turnos_json || '{}') };
}

export function catalogos() {
  const db = getDb();
  const col = (c) =>
    db.prepare(`SELECT DISTINCT ${c} AS v FROM servicios WHERE ${c} IS NOT NULL AND ${c} <> '' ORDER BY v`)
      .all()
      .map((r) => r.v);
  return { zonas: col('zona'), asesores: col('asesor'), tipos: col('tipo'), supervisores: col('supervisor') };
}

// ------------------------------------------------------------------ apertura

/**
 * Registra una apertura. Es la ÚNICA vía para que un servicio exista en el
 * estado de fuerza.
 *  - tipo APERTURA / TEMPORAL -> crea un servicio nuevo
 *  - tipo INCREMENTO          -> suma guardias a un servicio ACTIVO existente
 */
export function registrarApertura(payload, usuario) {
  const db = getDb();
  const tipo = ['APERTURA', 'INCREMENTO', 'TEMPORAL'].includes(payload.tipo) ? payload.tipo : 'APERTURA';

  // Un incremento se resuelve contra un servicio existente: el nombre lo toma
  // de ahí y no hace falta recapturarlo.
  let servicioIdDestino = null;
  let nombre = String(payload.servicio || '').trim();
  if (tipo === 'INCREMENTO') {
    const id = Number(payload.servicio_id);
    if (!id) throw new ValidacionError('Un incremento requiere el servicio destino.');
    const existente = db.prepare('SELECT * FROM servicios WHERE id = ?').get(id);
    if (!existente) throw new ValidacionError('El servicio destino no existe.');
    if (existente.estatus !== 'ACTIVO') throw new ValidacionError('No se puede incrementar un servicio dado de baja.');
    exigirDesglose(existente, normalizarTurnos(payload.turnos), 'se amplía');
    servicioIdDestino = id;
    nombre = existente.servicio;
  }
  if (!nombre) throw new ValidacionError('El nombre del servicio es obligatorio.');

  // Con desglose de turnos, su suma es la cifra buena: así el total nunca se
  // separa del detalle que se usa para las reducciones.
  const turnos = normalizarTurnos(payload.turnos);
  const sumaDesglose = sumaTurnos(turnos);
  const guardias = sumaDesglose > 0 ? sumaDesglose : Number(payload.guardias) || 0;
  if (guardias <= 0) throw new ValidacionError('La apertura debe incluir al menos un guardia.');

  const fecha = payload.fecha || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    const folio = siguienteFolio(db, 'aperturas', 'AP');
    const info = db
      .prepare(
        `INSERT INTO aperturas
          (folio, tipo, servicio, razon_social, direccion, zona, cluster, estado_geo, asesor, gerente, reporta,
           guardias, turnos_json, fecha, periodo, precio_guardia, sueldo_base, bono, uniforme,
           credito_autorizado, credito_plazo, forma_pago, cobro, tipo_repse, comentarios, aut_json,
           servicio_id, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        folio, tipo, nombre,
        payload.razon_social || null, payload.direccion || null, payload.zona || null,
        payload.cluster || null, payload.estado_geo || null, payload.asesor || null,
        payload.gerente || null, payload.reporta || usuario?.nombre || null,
        guardias, JSON.stringify(turnos), fecha, periodoDe(fecha),
        numOrNull(payload.precio_guardia), numOrNull(payload.sueldo_base), numOrNull(payload.bono),
        payload.uniforme || null,
        payload.credito_autorizado ? 1 : 0, payload.credito_plazo || null,
        payload.forma_pago || null, payload.cobro || null, payload.tipo_repse || null,
        payload.comentarios || null, JSON.stringify(payload.aut || {}),
        servicioIdDestino, usuario?.id ?? null
      );
    const aperturaId = info.lastInsertRowid;

    let servicioId;
    if (tipo === 'INCREMENTO') {
      const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(servicioIdDestino);
      const nuevosTurnos = mezclarTurnos(JSON.parse(s.turnos_json || '{}'), turnos, +1);
      db.prepare(
        `UPDATE servicios
            SET total_guardias = total_guardias + ?, turnos_json = ?, actualizado_en = datetime('now')
          WHERE id = ?`
      ).run(guardias, JSON.stringify(nuevosTurnos), servicioIdDestino);
      servicioId = servicioIdDestino;
    } else {
      const ins = db
        .prepare(
          `INSERT INTO servicios
             (servicio, razon_social, direccion, zona, tipo, cluster, estado_geo, asesor, gerente,
              estatus, total_guardias, turnos_json, precio_guardia, sueldo_base, bono, uniforme,
              tipo_repse, observaciones, forma_pago, cobro, apertura_id, fecha_alta)
           VALUES (?,?,?,?,?,?,?,?,?,'ACTIVO',?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          nombre, payload.razon_social || null, payload.direccion || null, payload.zona || null,
          payload.tipo_servicio || null, payload.cluster || null, payload.estado_geo || null,
          payload.asesor || null, payload.gerente || null,
          guardias, JSON.stringify(turnos),
          numOrNull(payload.precio_guardia), numOrNull(payload.sueldo_base), numOrNull(payload.bono),
          payload.uniforme || null, payload.tipo_repse || null, payload.comentarios || null,
          payload.forma_pago || null, payload.cobro || null,
          aperturaId, fecha
        );
      servicioId = ins.lastInsertRowid;
      db.prepare('UPDATE aperturas SET servicio_id = ? WHERE id = ?').run(servicioId, aperturaId);
    }

    auditar(db, {
      usuario,
      accion: tipo === 'INCREMENTO' ? 'incremento' : 'apertura',
      entidad: 'servicio',
      entidad_id: servicioId,
      detalle: `${folio} — ${nombre} (+${guardias} guardias)`,
    });

    return { folio, aperturaId, servicioId };
  });

  return tx();
}

// -------------------------------------------------------------- cancelación

/**
 * Registra una cancelación. Es la ÚNICA vía para sacar un servicio del estado
 * de fuerza.
 *  - tipo CANCELACION -> estatus BAJA, guardias a 0
 *  - tipo REDUCCION   -> resta guardias, el servicio sigue ACTIVO
 */
export function registrarCancelacion(payload, usuario) {
  const db = getDb();
  const tipo = payload.tipo === 'REDUCCION' ? 'REDUCCION' : 'CANCELACION';
  const servicioId = Number(payload.servicio_id);
  if (!servicioId) throw new ValidacionError('Selecciona el servicio a cancelar.');

  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(servicioId);
  if (!s) throw new ValidacionError('El servicio no existe.');
  if (s.estatus === 'BAJA') throw new ValidacionError('El servicio ya está dado de baja.');
  if (!payload.motivo) throw new ValidacionError('El motivo es obligatorio.');

  const turnos = normalizarTurnos(payload.turnos);
  let guardias = Number(payload.guardias) || sumaTurnos(turnos);
  if (tipo === 'CANCELACION') {
    guardias = s.total_guardias; // una cancelación retira el servicio completo
  } else {
    exigirDesglose(s, turnos, 'se retiran');
    if (guardias <= 0) throw new ValidacionError('La reducción debe indicar cuántos guardias se retiran.');
    if (guardias >= s.total_guardias) {
      throw new ValidacionError(
        `Una reducción no puede retirar los ${s.total_guardias} guardias del servicio. Registra una cancelación.`
      );
    }
  }

  const fecha = payload.fecha || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    const folio = siguienteFolio(db, 'cancelaciones', 'CA');
    const info = db
      .prepare(
        `INSERT INTO cancelaciones
           (folio, tipo, servicio, servicio_id, guardias, turnos_json, fecha, periodo, zona, asesor,
            motivo, reporta, auditoria, cxc, aut_json, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        folio, tipo, s.servicio, servicioId, guardias, JSON.stringify(turnos),
        fecha, periodoDe(fecha), payload.zona || s.zona, payload.asesor || s.asesor,
        payload.motivo, payload.reporta || usuario?.nombre || null, payload.auditoria || null,
        numOrNull(payload.cxc), JSON.stringify(payload.aut || {}), usuario?.id ?? null
      );
    const cancelacionId = info.lastInsertRowid;

    if (tipo === 'CANCELACION') {
      db.prepare(
        `UPDATE servicios
            SET estatus = 'BAJA', total_guardias = 0, turnos_json = '{}',
                cancelacion_id = ?, fecha_baja = ?, actualizado_en = datetime('now')
          WHERE id = ?`
      ).run(cancelacionId, fecha, servicioId);
    } else {
      const nuevosTurnos = mezclarTurnos(JSON.parse(s.turnos_json || '{}'), turnos, -1);
      db.prepare(
        `UPDATE servicios
            SET total_guardias = total_guardias - ?, turnos_json = ?, actualizado_en = datetime('now')
          WHERE id = ?`
      ).run(guardias, JSON.stringify(nuevosTurnos), servicioId);
    }

    auditar(db, {
      usuario,
      accion: tipo === 'REDUCCION' ? 'reduccion' : 'cancelacion',
      entidad: 'servicio',
      entidad_id: servicioId,
      detalle: `${folio} — ${s.servicio} (-${guardias} guardias) · ${payload.motivo}`,
    });

    return { folio, cancelacionId, servicioId };
  });

  return tx();
}

// ------------------------------------------------------------- correcciones

const ETIQUETA_CAMPO = {
  servicio: 'nombre del servicio',
  total_guardias: 'total de guardias',
  turnos: 'desglose de turnos',
  estatus: 'estatus',
  fecha_alta: 'fecha de alta',
};

/**
 * Arregla un servicio mal capturado. Solo admin.
 *
 * No es un movimiento: no crea apertura ni cancelación, y por lo tanto no
 * aparece en las gráficas del mes ni altera los cortes de facturación ya
 * cerrados. Es exactamente lo que debe pasar cuando el dato nunca fue cierto:
 * si tecleamos 12 donde iban 21, en la calle no llegaron nueve guardias, así
 * que registrar una ampliación de nueve sería mentir en el histórico.
 *
 * Dos reglas que no se negocian:
 *  - Exige un motivo escrito. Una corrección sin explicación es indistinguible
 *    de un cambio arbitrario cuando alguien la revise dentro de seis meses.
 *  - Puede reactivar un servicio (BAJA -> ACTIVO) pero nunca darlo de baja.
 *    Reactivar arregla una cancelación equivocada, que no tiene otra vía;
 *    dar de baja sí la tiene —la cancelación— y dejarlo aquí sería una puerta
 *    trasera para sacar servicios del estado de fuerza sin folio ni motivo.
 */
export function registrarCorreccion(id, payload, usuario) {
  const db = getDb();
  if (usuario?.rol !== 'admin') {
    throw new PermisoError('Solo un administrador puede corregir un servicio.');
  }

  const actual = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!actual) throw new ValidacionError('El servicio no existe.');

  const motivo = String(payload.motivo || '').trim();
  if (motivo.length < 5) {
    throw new ValidacionError('Escribe el motivo de la corrección: qué estaba mal capturado.');
  }

  const cambios = {};
  const sets = {};

  // --- nombre
  if (payload.servicio !== undefined) {
    const nombre = String(payload.servicio).trim();
    if (!nombre) throw new ValidacionError('El nombre del servicio no puede quedar vacío.');
    if (nombre !== actual.servicio) {
      cambios.servicio = { antes: actual.servicio, despues: nombre };
      sets.servicio = nombre;
    }
  }

  // --- estatus
  let estatus = actual.estatus;
  if (payload.estatus !== undefined && payload.estatus !== actual.estatus) {
    const pedido = String(payload.estatus).toUpperCase();
    if (!['ACTIVO', 'BAJA'].includes(pedido)) throw new ValidacionError('Estatus no válido.');
    if (pedido === 'BAJA') {
      throw new ValidacionError(
        'Una corrección no da de baja un servicio. Para sacarlo del estado de fuerza registra una cancelación, ' +
          'que deja folio y motivo.'
      );
    }
    estatus = pedido;
    cambios.estatus = { antes: actual.estatus, despues: pedido };
    sets.estatus = pedido;
    // La baja anterior deja de ser cierta: si sigue apuntando a la cancelación
    // el servicio aparecería activo y cancelado a la vez.
    sets.cancelacion_id = null;
    sets.fecha_baja = null;
  }

  // --- guardias y turnos
  // Cuando viene desglose manda el desglose: es de donde salen las reducciones,
  // y si el total no cuadra con él la siguiente disminución trabaja con basura.
  const turnosActuales = JSON.parse(actual.turnos_json || '{}');
  let turnos = turnosActuales;
  let total = actual.total_guardias;

  if (payload.turnos !== undefined) {
    turnos = normalizarTurnos(payload.turnos);
  }
  if (payload.total_guardias !== undefined) {
    const n = intOrNull(payload.total_guardias);
    if (n === null || n < 0) throw new ValidacionError('El total de guardias debe ser un número mayor o igual a cero.');
    total = n;
  }
  const sumaDesglose = sumaTurnos(turnos);
  if (sumaDesglose > 0) {
    if (payload.total_guardias !== undefined && total !== sumaDesglose) {
      throw new ValidacionError(
        `El desglose de turnos suma ${sumaDesglose} y el total dice ${total}. Deben coincidir.`
      );
    }
    total = sumaDesglose;
  }
  if (estatus === 'ACTIVO' && total <= 0) {
    throw new ValidacionError('Un servicio activo no puede quedar en cero guardias. Registra una cancelación.');
  }

  if (total !== actual.total_guardias) {
    cambios.total_guardias = { antes: actual.total_guardias, despues: total };
    sets.total_guardias = total;
  }
  const turnosJson = JSON.stringify(turnos);
  if (turnosJson !== (actual.turnos_json || '{}')) {
    cambios.turnos = { antes: actual.turnos_json || '{}', despues: turnosJson };
    sets.turnos_json = turnosJson;
  }

  // --- fecha de alta
  if (payload.fecha_alta !== undefined) {
    const f = String(payload.fecha_alta).trim() || null;
    if (f !== (actual.fecha_alta || null)) {
      cambios.fecha_alta = { antes: actual.fecha_alta, despues: f };
      sets.fecha_alta = f;
    }
  }

  if (Object.keys(cambios).length === 0) return { sinCambios: true };

  const tx = db.transaction(() => {
    const columnas = Object.keys(sets);
    db.prepare(
      `UPDATE servicios SET ${columnas.map((c) => `${c} = ?`).join(', ')}, actualizado_en = datetime('now')
        WHERE id = ?`
    ).run(...columnas.map((c) => sets[c]), actual.id);

    const info = db
      .prepare(
        `INSERT INTO correcciones
           (servicio_id, servicio, motivo, cambios, guardias_antes, guardias_despues, usuario_id, usuario)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        actual.id, actual.servicio, motivo, JSON.stringify(cambios),
        actual.total_guardias, total, usuario.id ?? null, usuario.nombre
      );

    const detalle = Object.keys(cambios).map((c) => ETIQUETA_CAMPO[c] || c).join(', ');
    auditar(db, {
      usuario,
      accion: 'correccion',
      entidad: 'servicio',
      entidad_id: actual.id,
      detalle: `${actual.servicio} — corrigió ${detalle} · ${motivo}`,
      cambios,
    });

    return { correccionId: info.lastInsertRowid, cambios };
  });

  return tx();
}

export function listarCorrecciones(servicioId) {
  return getDb()
    .prepare('SELECT * FROM correcciones WHERE servicio_id = ? ORDER BY id DESC')
    .all(Number(servicioId))
    .map((c) => ({ ...c, cambios: JSON.parse(c.cambios || '{}') }));
}

// ------------------------------------------------- edición por campos (RBAC)

/**
 * Actualiza campos de un servicio respetando los permisos del rol.
 * Nunca toca estatus, nombre ni total de guardias.
 */
export function actualizarServicio(id, payload, usuario) {
  const db = getDb();
  const actual = db.prepare('SELECT * FROM servicios WHERE id = ?').get(id);
  if (!actual) throw new ValidacionError('El servicio no existe.');

  const { datos, rechazados } = filtrarCampos(usuario.rol, payload);
  if (Object.keys(datos).length === 0) {
    throw new PermisoError(
      rechazados.length
        ? `Tu rol (${usuario.rol}) no puede modificar: ${rechazados.join(', ')}.`
        : 'No se enviaron campos para actualizar.'
    );
  }

  // normaliza tipos
  const limpio = {};
  for (const [k, v] of Object.entries(datos)) {
    if (['tiene_contrato', 'facturado'].includes(k)) limpio[k] = v ? 1 : 0;
    else if (['guardias_en_factura', 'dias_credito'].includes(k)) limpio[k] = intOrNull(v);
    else if (
      [
        'importe_factura', 'importe_sin_iva', 'nomina_total', 'nomina_prestaciones',
        'resultado_servicio', 'pct_utilidad', 'utilidad_bruta', 'credito_maximo',
        'importe_pendiente', 'saldo_vencido', 'precio_guardia', 'sueldo_base', 'bono',
      ].includes(k)
    ) limpio[k] = numOrNull(v);
    else limpio[k] = v === '' ? null : v;
  }

  const cambios = {};
  for (const [k, v] of Object.entries(limpio)) {
    if (String(actual[k] ?? '') !== String(v ?? '')) cambios[k] = { antes: actual[k], despues: v };
  }
  if (Object.keys(cambios).length === 0) return { sinCambios: true, rechazados };

  const sets = Object.keys(limpio).map((k) => `${k} = ?`);
  db.prepare(
    `UPDATE servicios SET ${sets.join(', ')}, actualizado_en = datetime('now') WHERE id = ?`
  ).run(...Object.values(limpio), id);

  auditar(db, {
    usuario,
    accion: 'editar',
    entidad: 'servicio',
    entidad_id: Number(id),
    detalle: `${actual.servicio} — ${Object.keys(cambios).join(', ')}`,
    cambios,
  });

  return { cambios, rechazados };
}

// ------------------------------------------------------------------ helpers

export class ValidacionError extends Error {}
export class PermisoError extends Error {}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

function normalizarTurnos(turnos) {
  const out = {};
  for (const [k, v] of Object.entries(turnos || {})) {
    const clave = k.toUpperCase().trim();
    const n = Number(v) || 0;
    if (n > 0 && TURNOS_SOPORTADOS.includes(clave)) out[clave] = n;
  }
  return out;
}
