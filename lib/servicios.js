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
import { filtrarCampos, camposCorregibles, CAMPOS_CORREGIBLES } from './rbac';
import { turnosAceptados, exigirDelCatalogo, canonicoDelCatalogo } from './catalogos';
import { yaArranco, noHaArrancado, porArrancar } from './dias';
import { ESQUEMAS } from './facturacion';
import { hoy } from './fechas';
import { registrarCambioManual } from './precios';
import { ValidacionError, PermisoError } from './errores';
import { MODALIDADES } from './modalidades';
import { normalizarEquipo } from './equipo';

export { ValidacionError, PermisoError };

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

export function listarServicios({ estatus, zona, asesor, turno, contrato, facturado, modalidad, q } = {}) {
  const db = getDb();
  const where = [];
  const args = [];
  /**
   * «Activo» quiere decir que está en la calle, no solo que está registrado.
   *
   * Ventas registra la apertura en cuanto cierra y el montaje es días después.
   * Entre las dos cosas el servicio existe, tiene folio y todos lo ven venir,
   * pero no hay nadie parado en esa puerta: sumarlo al estado de fuerza dice
   * que hay gente que todavía no existe.
   *
   * No se esconde, que sería la otra forma de equivocarse: se pide con
   * `POR_ARRANCAR` y la pantalla avisa de cuántos hay.
   */
  if (estatus === 'POR_ARRANCAR') {
    where.push(`estatus = 'ACTIVO' AND ${noHaArrancado()}`);
  } else if (estatus === 'ACTIVO') {
    where.push(`estatus = 'ACTIVO' AND ${yaArranco()}`);
  } else if (estatus) {
    where.push('estatus = ?');
    args.push(estatus);
  }
  if (zona) { where.push('zona = ?'); args.push(zona); }
  if (asesor) { where.push('asesor = ?'); args.push(asesor); }
  // El desglose vive como JSON, así que el filtro busca la llave con comillas
  // —"24 HRS":— y no el texto suelto: si no, «12 HRS» encontraría también a
  // los servicios que tienen 12 guardias en otro turno.
  if (turno) { where.push('turnos_json LIKE ?'); args.push(`%"${turno}":%`); }
  if (MODALIDADES[modalidad]) { where.push('modalidad = ?'); args.push(modalidad); }
  // Los temporales que ya se pasaron de su fecha, que es la lista que de verdad
  // se necesita revisar: cada uno sigue sumando guardias y proponiendo factura
  // después de haber terminado.
  if (modalidad === 'VENCIDA') {
    where.push("modalidad <> 'FIJO' AND fecha_fin_prevista IS NOT NULL AND fecha_fin_prevista <> '' AND fecha_fin_prevista < date('now')");
  }
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
  return db
    .prepare(sql)
    .all(...args)
    .map((r) => ({ ...hidratar(r), por_arrancar: porArrancar(r) }));
}

/**
 * Cuántos servicios están registrados y todavía no arrancan.
 *
 * Se cuenta aparte para poder avisarlo sin tener que traer los renglones: sin
 * el aviso, quien registra una apertura con fecha del 28 no encuentra su
 * servicio en la lista y cree que no se guardó.
 */
export function porArrancarResumen() {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS servicios, COALESCE(SUM(total_guardias), 0) AS guardias,
              MIN(fecha_alta) AS proxima
         FROM servicios WHERE estatus = 'ACTIVO' AND ${noHaArrancado()}`
    )
    .get();
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
    if (existente.estatus === 'SUSPENDIDO') {
      throw new ValidacionError(
        `«${existente.servicio}» está suspendido. Reactívalo antes de ampliarlo: mientras está en pausa sus guardias no cuentan.`
      );
    }
    if (existente.estatus !== 'ACTIVO') throw new ValidacionError('No se puede incrementar un servicio dado de baja.');
    exigirDesglose(existente, normalizarTurnos(payload.turnos), 'se amplía');
    servicioIdDestino = id;
    nombre = existente.servicio;
  }
  if (!nombre) throw new ValidacionError('El nombre del servicio es obligatorio.');

  // Una apertura no puede crear un segundo servicio con un nombre que ya está
  // operando. `aplicarApertura` ya lo impedía; registrar directamente, no, y ese
  // hueco se nota en cuanto alguien manda el formulario dos veces —o vuelve a
  // capturar la misma alta al día siguiente porque no la vio—. El resultado son
  // dos renglones idénticos en el estado de fuerza, con la plantilla contada
  // doble y sin nada que lo explique.
  //
  // Un servicio suspendido también cuenta: sigue existiendo y va a volver.
  if (tipo !== 'INCREMENTO') {
    const gemelo = db
      .prepare("SELECT id, servicio, estatus, total_guardias FROM servicios WHERE estatus <> 'BAJA' AND servicio = ? LIMIT 1")
      .get(nombre);
    if (gemelo) {
      throw new ValidacionError(
        gemelo.estatus === 'SUSPENDIDO'
          ? `«${nombre}» ya existe y está suspendido con ${gemelo.total_guardias} guardias. ` +
            'Reactívalo en lugar de abrir otro con el mismo nombre.'
          : `«${nombre}» ya está activo con ${gemelo.total_guardias} guardias. ` +
            'Si le vas a sumar gente, regístralo como INCREMENTO; si de verdad es otro servicio distinto ' +
            '—otra torre, otro turno, otro domicilio—, dale un nombre que los distinga.'
      );
    }
  }

  // La zona, el asesor y la forma de pago se eligen de una lista; se comprueban
  // aquí para que llegar por la API no sea una forma de volver a la captura
  // libre.
  const zona = exigirDelCatalogo('zona', payload.zona);
  const asesor = exigirDelCatalogo('asesor', payload.asesor);
  const formaPago = exigirDelCatalogo('forma_pago', payload.forma_pago);
  const gerente = exigirDelCatalogo('gerente', payload.gerente);
  const supervisor = exigirDelCatalogo('supervisor', payload.supervisor);
  const estadoGeo = exigirDelCatalogo('estado_geo', payload.estado_geo);
  const tipoRepse = exigirDelCatalogo('tipo_repse', payload.tipo_repse);
  const uniforme = exigirDelCatalogo('uniforme', payload.uniforme);

  // Fijo, temporal o evento. `aperturas.tipo` ya distinguía TEMPORAL, pero esa
  // marca moría con el movimiento: al aplicarse, el servicio quedaba igual que
  // uno permanente y se quedaba en el estado de fuerza para siempre, porque
  // nadie sabía que tenía que salir. Un movimiento TEMPORAL abre un servicio
  // temporal salvo que se diga otra cosa —quien elige «temporal» arriba no
  // debería tener que repetirlo abajo.
  const modalidad = MODALIDADES[payload.modalidad] ? payload.modalidad : tipo === 'TEMPORAL' ? 'TEMPORAL' : 'FIJO';
  const finPrevisto = String(payload.fecha_fin_prevista || '').trim() || null;
  if (modalidad === 'FIJO' && finPrevisto) {
    throw new ValidacionError('Un servicio fijo no lleva fecha de término. Márcalo como temporal o de evento.');
  }
  if (finPrevisto && !/^\d{4}-\d{2}-\d{2}$/.test(finPrevisto)) {
    throw new ValidacionError('La fecha de término debe ir como AAAA-MM-DD.');
  }

  // Condiciones de cobro. El esquema dice cuándo se emite la factura y los días
  // de crédito cuánto tarda en vencer: sin el primero, el plazo no tiene desde
  // cuándo contar.
  const esquema = String(payload.esquema_facturacion || '').trim() || null;
  if (esquema && !ESQUEMAS[esquema]) {
    throw new ValidacionError(`El esquema de facturación «${esquema}» no existe.`);
  }
  const diasCredito = intOrNull(payload.dias_credito);
  if (diasCredito !== null && diasCredito < 0) {
    throw new ValidacionError('Los días de crédito no pueden ser negativos.');
  }

  // Con desglose de turnos, su suma es la cifra buena: así el total nunca se
  // separa del detalle que se usa para las reducciones.
  const turnos = normalizarTurnos(payload.turnos);
  const sumaDesglose = sumaTurnos(turnos);
  const guardias = sumaDesglose > 0 ? sumaDesglose : Number(payload.guardias) || 0;
  if (guardias <= 0) throw new ValidacionError('La apertura debe incluir al menos un guardia.');

  const fecha = payload.fecha || hoy();

  // La hora a la que arranca el servicio, el equipo que se le entrega y los
  // vehículos de custodia. Los tres venían en la hoja de aperturas y no se
  // capturaban en ningún lado: son justo lo que hay que preparar antes del
  // primer turno, y después del alta ya nadie vuelve a llenarlos.
  const hora = /^\d{2}:\d{2}$/.test(String(payload.hora_apertura || '').trim())
    ? String(payload.hora_apertura).trim()
    : null;
  const vehiculos = intOrNull(payload.vehiculos_custodia);
  if (vehiculos !== null && vehiculos < 0) {
    throw new ValidacionError('Los vehículos de custodia no pueden ser negativos.');
  }
  const equipo = normalizarEquipo(payload.equipo);

  const tx = db.transaction(() => {
    const folio = siguienteFolio(db, 'aperturas', 'AP');
    const info = db
      .prepare(
        `INSERT INTO aperturas
          (folio, tipo, servicio, razon_social, direccion, zona, cluster, estado_geo, asesor, gerente,
           supervisor, reporta,
           guardias, turnos_json, fecha, periodo, precio_guardia, sueldo_base, bono, uniforme,
           credito_autorizado, credito_plazo, dias_credito, credito_maximo, esquema_facturacion,
           forma_pago, cobro, tipo_repse, modalidad, fecha_fin_prevista,
           hora_apertura, vehiculos_custodia, equipo_json, comentarios, aut_json,
           servicio_id, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        folio, tipo, nombre,
        payload.razon_social || null, payload.direccion || null, zona,
        payload.cluster || null, estadoGeo, asesor,
        gerente, supervisor, payload.reporta || usuario?.nombre || null,
        guardias, JSON.stringify(turnos), fecha, periodoDe(fecha),
        numOrNull(payload.precio_guardia), numOrNull(payload.sueldo_base), numOrNull(payload.bono),
        uniforme,
        payload.credito_autorizado ? 1 : 0, payload.credito_plazo || null,
        diasCredito, numOrNull(payload.credito_maximo), esquema,
        formaPago, payload.cobro || null, tipoRepse, modalidad, finPrevisto,
        hora, vehiculos, JSON.stringify(equipo),
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
              supervisor, estatus, modalidad, fecha_fin_prevista,
              total_guardias, turnos_json, precio_guardia, sueldo_base, bono, uniforme,
              tipo_repse, observaciones, forma_pago, cobro, esquema_facturacion, dias_credito,
              credito_maximo, apertura_id, fecha_alta)
           VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVO',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          nombre, payload.razon_social || null, payload.direccion || null, zona,
          payload.tipo_servicio || null, payload.cluster || null, estadoGeo,
          asesor, gerente, supervisor, modalidad, finPrevisto,
          guardias, JSON.stringify(turnos),
          numOrNull(payload.precio_guardia), numOrNull(payload.sueldo_base), numOrNull(payload.bono),
          uniforme, tipoRepse, payload.comentarios || null,
          formaPago, payload.cobro || null, esquema, diasCredito, numOrNull(payload.credito_maximo),
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

// ------------------------------------------------- aperturas sin aplicar

/**
 * Una apertura que quedó anotada pero nunca entró al estado de fuerza.
 *
 * Pasa con lo que vino de los archivos viejos: el movimiento se capturó en la
 * hoja de aperturas, pero el servicio nunca apareció en el corte, así que al
 * importar no hubo a quién amarrarlo. La apertura existe, el servicio no, y por
 * eso los guardias «no se suman».
 *
 * Aplicarla es terminar ese trámite: crea el servicio con lo que la propia
 * apertura ya traía capturado. No inventa nada ni pide recapturar.
 */
export function aperturaPendiente(db, id) {
  const ap = db.prepare('SELECT * FROM aperturas WHERE id = ?').get(Number(id));
  if (!ap) throw new ValidacionError('La apertura no existe.');
  if (ap.servicio_id) {
    throw new ValidacionError(`${ap.folio} ya está aplicada: su servicio existe en el estado de fuerza.`);
  }
  if (ap.descartada) {
    throw new ValidacionError(
      `${ap.folio} está descartada: alguien decidió que no se aplicaría. Devuélvela a pendientes si cambió el criterio.`
    );
  }
  return ap;
}

/**
 * Los campos de una apertura que salen de catálogo y se pueden arreglar.
 *
 * Los usan dos caminos: corregir la apertura mientras está pendiente, y
 * corregirla en el momento de aplicarla. La lista vive en un solo lugar para
 * que los dos acepten exactamente lo mismo.
 */
const CATALOGO_DE_APERTURA = {
  zona: 'zona',
  asesor: 'asesor',
  gerente: 'gerente',
  supervisor: 'supervisor',
  estado_geo: 'estado_geo',
  tipo_repse: 'tipo_repse',
  uniforme: 'uniforme',
};

/**
 * Arregla una apertura que se capturó con un dato equivocado y todavía no se
 * aplica.
 *
 * Faltaba, y se notó con las tres aperturas de agosto de 2026 que traen zona
 * «Centro»: la operación dejó de usar esa zona en septiembre de 2024, pero la
 * hoja la trae y la importación fue fiel. Poder corregirlo al aplicar no
 * alcanzaba —la lista de pendientes seguía enseñando «Centro» y el dato malo
 * seguía guardado—, y las únicas salidas eran aplicarla mal o descartarla.
 *
 * Solo sobre pendientes. Una apertura ya aplicada no se toca por aquí: su
 * servicio existe y cambiarle el dato al movimiento sin cambiárselo al servicio
 * partiría los dos. Para esa está la edición de la ficha.
 *
 * No toca guardias, turnos, nombre ni fecha: eso es lo que el movimiento
 * afirma que pasó, y cambiarlo sería reescribir el hecho, no corregir cómo se
 * clasificó.
 */
export function corregirApertura(aperturaId, cambios, usuario) {
  const db = getDb();
  const ap = db.prepare('SELECT * FROM aperturas WHERE id = ?').get(Number(aperturaId));
  if (!ap) throw new ValidacionError('Esa apertura no existe.');
  if (ap.servicio_id) {
    throw new ValidacionError(
      `${ap.folio} ya está aplicada: su servicio existe. Corrige el dato en la ficha del servicio, no en el movimiento.`
    );
  }

  const sets = {};
  const detalle = [];
  for (const [campo, tipo] of Object.entries(CATALOGO_DE_APERTURA)) {
    if (cambios?.[campo] === undefined) continue;
    const v = exigirDelCatalogo(tipo, cambios[campo]);
    if (v === (ap[campo] || null)) continue;
    sets[campo] = v;
    detalle.push(`${campo}: «${ap[campo] || '—'}» → «${v || '—'}»`);
  }

  const columnas = Object.keys(sets);
  if (!columnas.length) return { sinCambios: true, folio: ap.folio };

  db.prepare(`UPDATE aperturas SET ${columnas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...columnas.map((c) => sets[c]), ap.id);

  auditar(db, {
    usuario,
    accion: 'apertura_corregida',
    entidad: 'apertura',
    entidad_id: ap.id,
    detalle: `${ap.folio} — ${ap.servicio}: ${detalle.join(', ')}`,
    cambios: Object.fromEntries(columnas.map((c) => [c, { antes: ap[c], despues: sets[c] }])),
  });

  return { folio: ap.folio, servicio: ap.servicio, cambios: sets };
}

export function aplicarApertura(aperturaId, usuario, correcciones = {}) {
  const db = getDb();
  const ap = aperturaPendiente(db, aperturaId);

  // Lo que la apertura trae capturado y ya no existe como opción.
  //
  // Aplicar copiaba tal cual, a propósito: la apertura ya estaba registrada y
  // esto no es una captura nueva. Pero el costo se vio con las de agosto de
  // 2026: tres traen zona «Centro», que la operación dejó de usar en septiembre
  // de 2024, y aplicarlas metía al estado de fuerza servicios con una zona que
  // no existe. Ahora se puede corregir en el momento de aplicar —con el valor
  // bueno, del catálogo— sin tener que ir a arreglar el archivo.
  const valores = {};
  for (const [campo, tipo] of Object.entries(CATALOGO_DE_APERTURA)) {
    if (correcciones[campo] !== undefined) {
      valores[campo] = exigirDelCatalogo(tipo, correcciones[campo]);
      continue;
    }
    // Si el catálogo reconoce el valor aunque venga escrito distinto —«Traje»
    // donde la lista dice «TRAJE»— se guarda como lo escribe el catálogo. Es la
    // misma cosa, y dejar las dos formas conviviendo es como se llega a tener
    // seis supervisores partidos en doce renglones.
    valores[campo] = canonicoDelCatalogo(tipo, ap[campo]) ?? (ap[campo] || null);
  }

  // El desglose y el total se toman tal como se capturaron. Aquí no se valida
  // contra el catálogo: la apertura ya está registrada y esto no es una captura
  // nueva; si trae una zona que ya no se usa, se copia y el administrador la
  // verá señalada en Catálogos.
  const turnos = {};
  for (const [k, v] of Object.entries(JSON.parse(ap.turnos_json || '{}'))) {
    const n = Number(v) || 0;
    if (n > 0) turnos[String(k).toUpperCase().trim()] = n;
  }
  const suma = sumaTurnos(turnos);
  const guardias = suma > 0 ? suma : Number(ap.guardias) || 0;
  if (guardias <= 0) {
    throw new ValidacionError(
      `${ap.folio} no tiene guardias capturados, así que no hay nada que sumar al estado de fuerza.`
    );
  }

  // Un mismo nombre no puede entrar dos veces: si el servicio ya opera, lo que
  // corresponde es ampliarlo, no abrir uno paralelo que duplique la plantilla.
  // Un servicio suspendido sigue existiendo: si se aplica una apertura con su
  // mismo nombre se acaban teniendo dos, y el día que se reactive el primero la
  // plantilla queda contada dos veces.
  const gemelo = db
    .prepare("SELECT id, servicio, estatus, total_guardias FROM servicios WHERE estatus <> 'BAJA' AND servicio = ? LIMIT 1")
    .get(ap.servicio);

  const tx = db.transaction(() => {
    let servicioId;
    let accion;

    if (gemelo) {
      if (gemelo.estatus === 'SUSPENDIDO') {
        throw new ValidacionError(
          `«${ap.servicio}» existe y está suspendido. Reactívalo en lugar de abrir otro con el mismo nombre.`
        );
      }
      if (ap.tipo !== 'INCREMENTO') {
        throw new ValidacionError(
          `«${ap.servicio}» ya está activo con ${gemelo.total_guardias} guardias. ` +
            `Si ${ap.folio} es una ampliación de ese servicio, regístrala como incremento; ` +
            `si es otro servicio distinto, cámbiale el nombre a la apertura antes de aplicarla.`
        );
      }
      const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(gemelo.id);
      exigirDesglose(s, turnos, 'se amplía');
      db.prepare(
        `UPDATE servicios
            SET total_guardias = total_guardias + ?, turnos_json = ?, actualizado_en = datetime('now')
          WHERE id = ?`
      ).run(guardias, JSON.stringify(mezclarTurnos(JSON.parse(s.turnos_json || '{}'), turnos, +1)), gemelo.id);
      servicioId = gemelo.id;
      accion = 'incremento';
    } else {
      if (ap.tipo === 'INCREMENTO') {
        throw new ValidacionError(
          `${ap.folio} es un incremento de «${ap.servicio}», pero ese servicio no está activo. ` +
            `Aplica primero su apertura, o cámbiale el tipo si en realidad fue un alta.`
        );
      }
      const ins = db
        .prepare(
          `INSERT INTO servicios
             (servicio, razon_social, direccion, zona, cluster, estado_geo, asesor, gerente,
              supervisor, estatus, modalidad, fecha_fin_prevista,
              total_guardias, turnos_json, precio_guardia, sueldo_base, bono, uniforme,
              tipo_repse, observaciones, forma_pago, cobro, esquema_facturacion, dias_credito,
              credito_maximo, apertura_id, fecha_alta)
           VALUES (?,?,?,?,?,?,?,?,?,'ACTIVO',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          ap.servicio, ap.razon_social, ap.direccion, valores.zona, ap.cluster, valores.estado_geo,
          valores.asesor, valores.gerente, valores.supervisor,
          // La modalidad se toma de la apertura, y si no la trae —las que
          // vinieron de los archivos viejos no la tienen— se deduce del tipo de
          // movimiento. Aplicar una apertura TEMPORAL como si fuera fija es
          // justo el olvido que deja servicios de temporada viviendo años en el
          // estado de fuerza.
          MODALIDADES[ap.modalidad] ? ap.modalidad : ap.tipo === 'TEMPORAL' ? 'TEMPORAL' : 'FIJO',
          ap.fecha_fin_prevista || null,
          guardias, JSON.stringify(turnos),
          ap.precio_guardia, ap.sueldo_base, ap.bono, valores.uniforme, valores.tipo_repse, ap.comentarios,
          ap.forma_pago, ap.cobro, ap.esquema_facturacion, ap.dias_credito, ap.credito_maximo,
          ap.id, ap.fecha
        );
      servicioId = ins.lastInsertRowid;
      accion = 'apertura';
    }

    // La corrección se escribe también en el movimiento. Dejarla solo en el
    // servicio partiría el dato en dos: la apertura diría «Centro» y el
    // servicio «SUR», y ninguna de las dos explicaría a la otra.
    const arreglados = Object.keys(CATALOGO_DE_APERTURA).filter((c) => correcciones[c] !== undefined && valores[c] !== (ap[c] || null));
    const sets = ['servicio_id = ?', ...arreglados.map((c) => `${c} = ?`)];
    db.prepare(`UPDATE aperturas SET ${sets.join(', ')} WHERE id = ?`)
      .run(servicioId, ...arreglados.map((c) => valores[c]), ap.id);

    auditar(db, {
      usuario,
      accion,
      entidad: 'servicio',
      entidad_id: servicioId,
      detalle:
        `${ap.folio} — ${ap.servicio} (+${guardias} guardias) aplicada al estado de fuerza` +
        (arreglados.length
          ? ` · se corrigió al aplicar: ${arreglados.map((c) => `${c} «${ap[c] || '—'}» → «${valores[c]}»`).join(', ')}`
          : ''),
    });

    return { folio: ap.folio, aperturaId: ap.id, servicioId, guardias, servicio: ap.servicio, accion };
  });

  return tx();
}


/**
 * Lo que le cuelga a un servicio. Si algo de esto existe, el servicio ya
 * trabajó: sacarlo del estado de fuerza deja de ser «deshacer» y pasa a ser una
 * baja, con su folio y su motivo.
 */
function loQueLeCuelga(db, servicioId) {
  const cuenta = (sql) => db.prepare(sql).get(servicioId).n;
  const razones = [];
  if (cuenta('SELECT COUNT(*) AS n FROM facturas WHERE servicio_id = ?')) razones.push('ya tiene facturas');
  if (cuenta('SELECT COUNT(*) AS n FROM cancelaciones WHERE servicio_id = ?')) razones.push('ya tiene movimientos de baja');
  if (cuenta('SELECT COUNT(*) AS n FROM correcciones WHERE servicio_id = ?')) razones.push('ya se corrigió');
  if (cuenta('SELECT COUNT(*) AS n FROM comentarios WHERE servicio_id = ?')) razones.push('tiene comentarios');
  if (cuenta('SELECT COUNT(*) AS n FROM precios_historial WHERE servicio_id = ?')) razones.push('ya se le movió el precio');
  return razones;
}

/**
 * Deshace una apertura que se aplicó por error.
 *
 * No es una cancelación, y la diferencia no es de forma. Una cancelación dice
 * que el cliente se fue: sale en las gráficas del mes, en el neto contra las
 * aperturas y en el reporte de motivos. Si la apertura se aplicó por
 * equivocación —una vieja de un servicio que ya no opera, un nombre repetido—
 * en la calle no se fue nadie, y registrar una baja sería meter en el histórico
 * un hecho que nunca ocurrió.
 *
 * Es el mismo criterio que las correcciones: cuando el dato nunca fue cierto,
 * se arregla; no se inventa un movimiento que lo compense.
 *
 * Solo alcanza a lo que todavía no ha trabajado. En cuanto el servicio tiene
 * una factura, un comentario o un cambio de precio, ya existió para el resto de
 * la operación y la única salida honesta es la cancelación.
 */
export function deshacerApertura(aperturaId, { motivo } = {}, usuario) {
  const db = getDb();
  const ap = db.prepare('SELECT * FROM aperturas WHERE id = ?').get(Number(aperturaId));
  if (!ap) throw new ValidacionError('La apertura no existe.');
  if (!ap.servicio_id) throw new ValidacionError(`${ap.folio} no está aplicada: no hay nada que deshacer.`);

  const razon = String(motivo || '').trim();
  if (razon.length < 5) {
    throw new ValidacionError('Escribe por qué se deshace: qué se aplicó mal. Queda en la bitácora.');
  }

  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(ap.servicio_id);
  if (!s) throw new ValidacionError('El servicio de esa apertura ya no existe.');

  const cuelga = loQueLeCuelga(db, s.id);
  if (cuelga.length) {
    throw new ValidacionError(
      `«${s.servicio}» ${cuelga.join(', ')}, así que ya operó de verdad. ` +
        'Para sacarlo del estado de fuerza registra una cancelación, que deja folio y motivo.'
    );
  }

  // Movimientos posteriores sobre el mismo servicio: deshacer este dejaría los
  // de después apuntando a un servicio que ya no cuadra.
  const posteriores = db
    .prepare('SELECT COUNT(*) AS n FROM aperturas WHERE servicio_id = ? AND id > ?')
    .get(s.id, ap.id).n;
  if (posteriores) {
    throw new ValidacionError(
      `«${s.servicio}» tiene movimientos posteriores a ${ap.folio}. Deshaz primero los más recientes.`
    );
  }

  const turnos = JSON.parse(ap.turnos_json || '{}');
  const guardias = sumaTurnos(turnos) || Number(ap.guardias) || 0;

  const tx = db.transaction(() => {
    let borrado = false;

    // Se desliga ANTES de tocar el servicio: mientras la apertura le apunte,
    // la llave foránea no deja borrarlo.
    db.prepare('UPDATE aperturas SET servicio_id = NULL WHERE id = ?').run(ap.id);

    if (s.apertura_id === ap.id) {
      // Esta apertura fue la que creó el servicio: sin ella el servicio no
      // debió existir nunca, así que se va entero. No es una excepción a la
      // regla de que los servicios no se borran: es que este nunca fue uno.
      db.prepare('DELETE FROM servicios WHERE id = ?').run(s.id);
      borrado = true;
    } else {
      // Fue una ampliación: se devuelven los guardias que sumó.
      if (guardias > s.total_guardias) {
        throw new ValidacionError(
          `${ap.folio} sumó ${guardias} guardias y el servicio hoy tiene ${s.total_guardias}. ` +
            'Los números ya no cuadran para deshacerlo; corrígelo desde la ficha.'
        );
      }
      db.prepare(
        `UPDATE servicios
            SET total_guardias = total_guardias - ?, turnos_json = ?, actualizado_en = datetime('now')
          WHERE id = ?`
      ).run(guardias, JSON.stringify(mezclarTurnos(JSON.parse(s.turnos_json || '{}'), turnos, -1)), s.id);
    }

    auditar(db, {
      usuario,
      accion: 'apertura_deshecha',
      entidad: 'servicio',
      entidad_id: borrado ? null : s.id,
      detalle:
        `${ap.folio} — ${s.servicio} (−${guardias} guardias) ` +
        `${borrado ? 'se quitó del estado de fuerza' : 'se revirtió la ampliación'} · ${razon}`,
    });

    return { folio: ap.folio, servicio: s.servicio, guardias, servicioBorrado: borrado };
  });

  return tx();
}

/**
 * Marca una apertura como que nunca se va a aplicar.
 *
 * De las que quedaron sueltas, la mayoría son de 2023 y describen servicios que
 * hace tiempo no operan: aplicarlas sería inflar el estado de fuerza y no
 * aplicarlas deja un pendiente que nunca baja. Descartarlas es decir «esta ya
 * se revisó y no va», que es una respuesta y no un olvido.
 *
 * No se borra nada: la apertura se anotó en su día y eso es parte del
 * histórico. Solo deja de contarse como pendiente, y se puede devolver a la
 * cola cuando haga falta.
 */
export function descartarApertura(aperturaId, { motivo } = {}, usuario) {
  const db = getDb();
  const ap = db.prepare('SELECT * FROM aperturas WHERE id = ?').get(Number(aperturaId));
  if (!ap) throw new ValidacionError('La apertura no existe.');
  if (ap.servicio_id) {
    throw new ValidacionError(
      `${ap.folio} está aplicada y su servicio existe. Deshazla primero si se aplicó por error.`
    );
  }
  if (ap.descartada) throw new ValidacionError(`${ap.folio} ya estaba descartada.`);

  const razon = String(motivo || '').trim();
  if (razon.length < 5) throw new ValidacionError('Escribe por qué no se va a aplicar. Queda registrado.');

  db.prepare(
    `UPDATE aperturas SET descartada = 1, descartada_motivo = ?, descartada_en = ?, descartada_por = ?
      WHERE id = ?`
  ).run(razon, hoy(), usuario?.id ?? null, ap.id);

  auditar(db, {
    usuario,
    accion: 'apertura_descartada',
    entidad: 'apertura',
    entidad_id: ap.id,
    detalle: `${ap.folio} — ${ap.servicio}: no se aplicará · ${razon}`,
  });

  return { folio: ap.folio, servicio: ap.servicio };
}

/** La devuelve a la cola de pendientes. */
export function reactivarApertura(aperturaId, usuario) {
  const db = getDb();
  const ap = db.prepare('SELECT * FROM aperturas WHERE id = ?').get(Number(aperturaId));
  if (!ap) throw new ValidacionError('La apertura no existe.');
  if (!ap.descartada) throw new ValidacionError(`${ap.folio} no está descartada.`);

  db.prepare(
    'UPDATE aperturas SET descartada = 0, descartada_motivo = NULL, descartada_en = NULL, descartada_por = NULL WHERE id = ?'
  ).run(ap.id);

  auditar(db, {
    usuario,
    accion: 'apertura_descartada',
    entidad: 'apertura',
    entidad_id: ap.id,
    detalle: `${ap.folio} — ${ap.servicio}: vuelve a la cola de pendientes`,
  });

  return { folio: ap.folio };
}


// ------------------------------------------------------- pausa del servicio

/**
 * Suspende un servicio: sigue existiendo, deja de contar.
 *
 * Hay una situación que no tenía dónde caber. El cliente para el servicio —una
 * obra que se detuvo, una temporada baja, un contrato en renegociación— y va a
 * volver. Registrar una cancelación sería mentir: diría que el cliente se fue,
 * saldría en las gráficas de bajas del mes, en el neto contra las aperturas y
 * en el reporte de motivos. Y dejarlo activo también miente, porque estaría
 * sumando guardias que hoy no están en la calle.
 *
 * Suspendido es la tercera respuesta: el servicio conserva su plantilla, su
 * precio, su contrato y su historia, pero no cuenta en el estado de fuerza
 * vigente, no se le propone facturar y no entra a la revisión anual de precios.
 * Cuando el cliente regresa, se reactiva tal como estaba.
 *
 * No es una puerta trasera a la cancelación: un suspendido no desaparece, sale
 * en su propia lista y el tablero dice cuántos hay. Si el cliente al final no
 * vuelve, entonces sí toca cancelar, con su folio y su motivo.
 */
export function suspenderServicio(id, { motivo, desde } = {}, usuario) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!s) throw new ValidacionError('El servicio no existe.');
  if (s.estatus === 'BAJA') {
    throw new ValidacionError(`«${s.servicio}» ya está dado de baja: no hay nada que suspender.`);
  }
  if (s.estatus === 'SUSPENDIDO') throw new ValidacionError(`«${s.servicio}» ya está suspendido.`);

  const razon = String(motivo || '').trim();
  if (razon.length < 5) {
    throw new ValidacionError('Escribe por qué se suspende. Queda registrado y es lo que se lee al reactivarlo.');
  }
  const fecha = desde || hoy();

  db.prepare(
    `UPDATE servicios
        SET estatus = 'SUSPENDIDO', suspendido_desde = ?, suspendido_motivo = ?, actualizado_en = datetime('now')
      WHERE id = ?`
  ).run(fecha, razon, s.id);

  auditar(db, {
    usuario,
    accion: 'suspension',
    entidad: 'servicio',
    entidad_id: s.id,
    detalle: `${s.servicio} — suspendido desde ${fecha} (${s.total_guardias} guardias dejan de contar) · ${razon}`,
    cambios: { estatus: { antes: s.estatus, despues: 'SUSPENDIDO' } },
  });

  return { servicio: s.servicio, guardias: s.total_guardias, desde: fecha };
}

/** Lo devuelve a la operación, con la plantilla que tenía. */
export function reactivarServicio(id, { motivo } = {}, usuario) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!s) throw new ValidacionError('El servicio no existe.');
  if (s.estatus === 'BAJA') {
    throw new ValidacionError(
      `«${s.servicio}» está dado de baja, no suspendido. Para volver a operarlo se registra una apertura.`
    );
  }
  if (s.estatus !== 'SUSPENDIDO') throw new ValidacionError(`«${s.servicio}» no está suspendido.`);

  db.prepare(
    `UPDATE servicios
        SET estatus = 'ACTIVO', suspendido_desde = NULL, suspendido_motivo = NULL, actualizado_en = datetime('now')
      WHERE id = ?`
  ).run(s.id);

  auditar(db, {
    usuario,
    accion: 'suspension',
    entidad: 'servicio',
    entidad_id: s.id,
    detalle:
      `${s.servicio} — vuelve a operar con ${s.total_guardias} guardias` +
      `${s.suspendido_desde ? ` (estuvo en pausa desde ${s.suspendido_desde})` : ''}` +
      `${String(motivo || '').trim() ? ` · ${String(motivo).trim()}` : ''}`,
    cambios: { estatus: { antes: 'SUSPENDIDO', despues: 'ACTIVO' } },
  });

  return { servicio: s.servicio, guardias: s.total_guardias };
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

  const fecha = payload.fecha || hoy();

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

// -------------------------------------------------------- archivo del contrato

/**
 * Guarda —o quita— el PDF del contrato firmado.
 *
 * «Sí tiene contrato» es un dato que no sirve de mucho si para verlo hay que ir
 * a buscarlo a un cajón. Con el papel aquí, la respuesta y su prueba viven en
 * el mismo renglón.
 *
 * Subir el contrato marca el servicio como que sí lo tiene: nadie sube un
 * contrato de un cliente que no tiene contrato, y dejar la casilla en «no»
 * mientras el PDF está adentro es la clase de contradicción que después nadie
 * entiende.
 */
export function adjuntarContrato(id, datos, usuario) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!s) throw new ValidacionError('El servicio no existe.');

  const anterior = s.contrato_archivo;
  db.prepare(
    `UPDATE servicios
        SET contrato_archivo = ?, contrato_archivo_nombre = ?, contrato_archivo_tipo = ?,
            contrato_archivo_bytes = ?, contrato_archivo_subido_en = ?,
            tiene_contrato = 1, actualizado_en = datetime('now')
      WHERE id = ?`
  ).run(datos.archivo, datos.archivo_nombre, datos.archivo_tipo, datos.archivo_bytes, hoy(), Number(id));

  auditar(db, {
    usuario,
    accion: 'contrato_archivo',
    entidad: 'servicio',
    entidad_id: Number(id),
    detalle: `${s.servicio} — se subió el contrato «${datos.archivo_nombre}»`,
  });

  return { servicio: s.servicio, anterior };
}

export function quitarContrato(id, usuario) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!s) throw new ValidacionError('El servicio no existe.');
  if (!s.contrato_archivo) throw new ValidacionError('Este servicio no tiene contrato adjunto.');

  // Se quita el papel, no el hecho: que el contrato exista lo dice la casilla,
  // y borrar el archivo no lo cancela.
  db.prepare(
    `UPDATE servicios
        SET contrato_archivo = NULL, contrato_archivo_nombre = NULL, contrato_archivo_tipo = NULL,
            contrato_archivo_bytes = NULL, contrato_archivo_subido_en = NULL,
            actualizado_en = datetime('now')
      WHERE id = ?`
  ).run(Number(id));

  auditar(db, {
    usuario,
    accion: 'contrato_archivo',
    entidad: 'servicio',
    entidad_id: Number(id),
    detalle: `${s.servicio} — se quitó el contrato «${s.contrato_archivo_nombre}»`,
  });

  return { archivo: s.contrato_archivo };
}

// ------------------------------------------------------------- correcciones

const ETIQUETA_CAMPO = {
  servicio: 'nombre del servicio',
  razon_social: 'razón social',
  total_guardias: 'total de guardias',
  turnos: 'desglose de turnos',
  estatus: 'estatus',
  fecha_alta: 'fecha de alta',
};

/**
 * Arregla un servicio mal capturado.
 *
 * El administrador corrige lo que describe el estado de fuerza. Jurídico solo
 * la razón social, que es el nombre legal del cliente —el del contrato y el de
 * la factura—: de 217 servicios activos, 193 la traen distinta de su nombre
 * corto, y quien sabe cuál es la buena es quien lleva el contrato.
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

  // Corregir no es un permiso de todo o nada. El administrador arregla lo que
  // describe el estado de fuerza; jurídico entra solo por la razón social, que
  // es el nombre legal del cliente. Un campo fuera del alcance del rol no se
  // ignora en silencio: se rechaza, porque callarlo haría creer que se guardó.
  const puedeCorregir = new Set(camposCorregibles(usuario?.rol));
  if (puedeCorregir.size === 0) {
    throw new PermisoError('Tu rol no puede corregir la captura de un servicio.');
  }
  const fuera = CAMPOS_CORREGIBLES.filter((c) => payload[c] !== undefined && !puedeCorregir.has(c));
  if (fuera.length) {
    throw new PermisoError(
      `Tu rol (${usuario.rol}) solo puede corregir: ${[...puedeCorregir].join(', ')}. ` +
        `No puede tocar: ${fuera.join(', ')}.`
    );
  }

  const actual = db.prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));
  if (!actual) throw new ValidacionError('El servicio no existe.');

  const motivo = String(payload.motivo || '').trim();
  if (motivo.length < 5) {
    throw new ValidacionError('Escribe el motivo de la corrección: qué estaba mal capturado.');
  }

  const cambios = {};
  const sets = {};

  // --- razón social
  // El nombre legal del cliente: el del contrato y el de la factura. Se puede
  // dejar vacía —hay tres servicios que no la traen— pero no se inventa.
  if (payload.razon_social !== undefined) {
    const rs = String(payload.razon_social ?? '').trim().replace(/\s+/g, ' ') || null;
    if ((rs || '') !== (actual.razon_social || '')) {
      cambios.razon_social = { antes: actual.razon_social, despues: rs };
      sets.razon_social = rs;
    }
  }

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

  // Zona y asesor se comprueban solo cuando cambian: un servicio antiguo puede
  // traer un valor que ya no está en el catálogo, y guardar cualquier otro
  // campo suyo no tiene por qué obligar a arreglarlo primero.
  for (const campo of ['zona', 'asesor', 'forma_pago', 'gerente', 'supervisor', 'estado_geo', 'tipo_repse', 'uniforme']) {
    if (!cambios[campo]) continue;
    limpio[campo] = exigirDelCatalogo(campo, limpio[campo]);
    cambios[campo].despues = limpio[campo];
  }
  if (cambios.esquema_facturacion && limpio.esquema_facturacion && !ESQUEMAS[limpio.esquema_facturacion]) {
    throw new ValidacionError(`El esquema de facturación «${limpio.esquema_facturacion}» no existe.`);
  }

  // La modalidad y su fecha se validan juntas y contra lo que va a quedar, no
  // contra lo que se mandó: quitar la fecha y dejar TEMPORAL, o poner FIJO sin
  // borrar la fecha, son dos formas de dejar el servicio diciendo dos cosas.
  if (cambios.modalidad || cambios.fecha_fin_prevista) {
    const modalidad = 'modalidad' in limpio ? limpio.modalidad : actual.modalidad;
    const fin = ('fecha_fin_prevista' in limpio ? limpio.fecha_fin_prevista : actual.fecha_fin_prevista) || null;
    if (!MODALIDADES[modalidad]) throw new ValidacionError(`La modalidad «${modalidad}» no existe.`);
    if (modalidad === 'FIJO' && fin) {
      throw new ValidacionError('Un servicio fijo no lleva fecha de término. Quita la fecha o cámbialo a temporal.');
    }
    if (fin && !/^\d{4}-\d{2}-\d{2}$/.test(fin)) {
      throw new ValidacionError('La fecha de término debe ir como AAAA-MM-DD.');
    }
  }
  if (Object.keys(cambios).length === 0) return { sinCambios: true, rechazados };

  const sets = Object.keys(limpio).map((k) => `${k} = ?`);
  db.prepare(
    `UPDATE servicios SET ${sets.join(', ')}, actualizado_en = datetime('now') WHERE id = ?`
  ).run(...Object.values(limpio), id);

  // Un precio también cambia por aquí, editando la ficha. Se anota en el mismo
  // historial que los aumentos anuales: si vive en dos listas distintas, quien
  // pregunte «¿por qué este cliente paga esto?» va a encontrar solo la mitad.
  registrarCambioManual(db, Number(id), actual, limpio, usuario);

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

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

/**
 * Deja el desglose listo para guardar y rechaza los turnos que no existen.
 *
 * Antes los turnos desconocidos se tiraban en silencio: la apertura se
 * guardaba, el desglose salía incompleto y el total no cuadraba con la suma sin
 * que nadie se enterara. Ahora el catálogo manda y lo que no está en él se
 * contesta con un error, que es lo único que le da al capturista la
 * oportunidad de arreglarlo.
 */
function normalizarTurnos(turnos) {
  const aceptados = turnosAceptados();
  const out = {};
  for (const [k, v] of Object.entries(turnos || {})) {
    const clave = k.toUpperCase().trim();
    const n = Number(v) || 0;
    if (n <= 0) continue;
    if (!aceptados.has(clave)) {
      throw new ValidacionError(
        `El turno «${clave}» no está en el catálogo. Un administrador lo da de alta en Catálogos.`
      );
    }
    out[clave] = n;
  }
  return out;
}
