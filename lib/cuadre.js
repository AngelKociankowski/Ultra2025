/**
 * El cuadre del estado de fuerza entre dos fechas: de dónde salió cada guardia
 * de diferencia, y qué parte no se puede explicar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * El caso que trajo este archivo
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El dueño tenía 815 guardias en una fecha, dio de alta 26, y el estado de
 * fuerza decía 850. Sobraban nueve y ninguna pantalla los explicaba. La causa no
 * era un error de cuenta: era que **el número puede cambiar sin que ningún
 * movimiento lo cuente**. Auditado sobre el código, los sitios que escriben
 * `servicios.total_guardias` son los que declara `SITIOS_QUE_MUEVEN_EL_TOTAL`, y
 * uno de ellos —`registrarCorreccion()`, el botón «Corregir» de la ficha— no
 * crea ningún movimiento: deja rastro en la tabla `correcciones` y en la
 * bitácora, y en ninguna de las dos pantallas donde cualquiera iría a buscar.
 *
 * Así que para cuadrar de una fecha a otra hay que mirar tres sitios que nada
 * junta: Aperturas, Cancelaciones y las correcciones. Esto los junta y HACE LA
 * RESTA, que es lo que nadie hacía.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * La regla que gobierna este archivo: un cuadre que no cierra lo DICE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Un cuadre que no cierra y se calla es peor que no tener ninguno: sería otra
 * cifra con cara de buena, y de esas esta plataforma lleva meses quitando. Por
 * eso el resultado lleva `residuo` y `cuadra` siempre, y cuando queda residuo se
 * nombran los candidatos medidos que lo pueden explicar. Lo que NO se hace nunca
 * es repartir el residuo entre los términos para que la resta salga redonda.
 *
 * Y el residuo tiene que seguir apareciendo mañana. Hoy son cinco funciones y
 * ocho sentencias las que escriben esa columna; el día que alguien abra la
 * novena, el cuadre tiene que dejar de cerrar y avisar, no ignorarla en
 * silencio. Eso no se consigue con cuidado: lo ata un guardián que lee
 * `lib/servicios.js`, encuentra cada sentencia que escribe la columna y exige
 * que su función esté declarada aquí abajo con el término del cuadre que la
 * cubre (`tests/cuadre-estado-fuerza.test.mjs`). Una sentencia nueva sin
 * declarar rompe la suite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Por qué los extremos son FOTOS y no la reconstrucción por fecha
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `estadoAlDia()` de `lib/dias.js` sabe contestar el estado de fuerza de
 * cualquier día, y aun así no es de donde salen los dos extremos del cuadre. La
 * razón es la misma que trajo el encargo: esa reconstrucción parte del total de
 * HOY y le deshace los movimientos posteriores, así que una corrección de hoy
 * —que dice que el número nunca fue el que decía— cambia también lo que
 * contesta del pasado. Contra un número que se mueve, el término de
 * correcciones no puede cuadrar: la corrección ya está dentro de los dos
 * extremos y la resta la borra.
 *
 * Lo que no se mueve son las fotos: el corte guardado de un mes cerrado
 * (`snapshots`) es la foto con la que se facturó ese mes, y el estado vigente es
 * la verdad de hoy. Entre dos fotos la diferencia es un hecho, y los tres
 * términos tienen algo contra lo que medirse. Así que el cuadre solo se contesta
 * entre fotos, y cuando la fecha que se pidió no tiene una, se dice con qué foto
 * se contestó y de qué fecha es —nunca se inventa una intermedia—.
 *
 * `fotosDelEstadoDeFuerza()` es la lista de las que hay, para poder contestar
 * «entre qué fechas sí se puede» en vez de un «no».
 */

import { getDb } from './db';
import { hoy } from './fechas';
import { comoDia, finDeMes } from './dias';
import { kpisEstadoFuerza, periodosDisponibles, periodoVigente } from './queries';

/**
 * Los sitios del código que escriben `servicios.total_guardias`, y a qué término
 * del cuadre alimenta cada uno.
 *
 * Esta lista no es documentación: es el contrato que el guardián comprueba
 * contra el código. Si mañana una función nueva escribe esa columna y no está
 * aquí, la suite se rompe antes de que nadie pueda preguntarse de dónde salieron
 * unos guardias de más.
 *
 * `rastro` dice dónde se ve ese sitio navegando. Es la columna que importa del
 * hallazgo: seis de los ocho sitios dejan un movimiento visible en Aperturas o
 * en Cancelaciones, y el de la corrección no deja ninguno.
 */
export const SITIOS_QUE_MUEVEN_EL_TOTAL = [
  {
    funcion: 'registrarApertura',
    sentencias: 2,
    termino: 'altas',
    rastro: 'un renglón en Aperturas',
    // Dos sentencias: el INSERT del servicio que nace y el UPDATE que suma los
    // guardias de un incremento al servicio que ya existía.
  },
  {
    funcion: 'aplicarApertura',
    sentencias: 2,
    termino: 'altas',
    rastro: 'un renglón en Aperturas',
  },
  {
    funcion: 'deshacerApertura',
    sentencias: 1,
    termino: 'altas',
    // Deshacer devuelve la apertura a la cola (`servicio_id = NULL`) o borra el
    // servicio que nunca debió existir, así que el término de altas deja de
    // contarla en el mismo acto en que se restan sus guardias: el cuadre sigue
    // cerrando sin un término propio.
    rastro: 'la apertura vuelve a la cola de Aperturas',
  },
  {
    funcion: 'registrarCancelacion',
    sentencias: 2,
    termino: 'bajas',
    rastro: 'un renglón en Cancelaciones',
    // Dos sentencias: la cancelación total deja el servicio en cero y en BAJA, y
    // la reducción le resta los guardias que se retiran.
  },
  {
    funcion: 'registrarCorreccion',
    sentencias: 1,
    termino: 'correcciones',
    // EL SÉPTIMO SITIO, que es el que trajo este encargo: no crea ningún
    // movimiento. El rastro está en la tabla `correcciones` y en la bitácora, y
    // en ninguna pantalla de movimientos.
    rastro: 'la tabla de correcciones y la Bitácora; NINGÚN movimiento',
  },
];

/** Los tres términos con los que se explica una diferencia, y de dónde sale cada uno. */
export const TERMINOS_DEL_CUADRE = ['altas', 'bajas', 'correcciones'];

/**
 * Las fechas a las que hay una foto del estado de fuerza que no se mueve.
 *
 * Los cortes guardados, del más nuevo al más viejo, y hoy. Se ofrece entera para
 * que quien pregunte por una fecha sin foto pueda recibir un «entre estas sí» en
 * lugar de un «no se puede».
 */
export function fotosDelEstadoDeFuerza() {
  const cortes = periodosDisponibles(periodoVigente())
    .filter((p) => !p.vigente)
    .map((p) => ({ fecha: finDeMes(p.periodo), fuente: `corte guardado de ${p.periodo}`, periodo: p.periodo }));
  return [{ fecha: hoy(), fuente: 'estado de fuerza vigente', periodo: null }, ...cortes];
}

/**
 * La foto del estado de fuerza que contesta por esa fecha, con la fecha que de
 * verdad tiene.
 *
 * De hoy en adelante, el estado vigente: es la verdad de ahora y no hay nada
 * después. Hacia atrás, el corte cerrado más reciente que no pase de la fecha
 * pedida. Si no hay ninguno —una fecha anterior al primer corte— devuelve nada,
 * y quien llama lo dice en vez de dar un número.
 *
 * El número de hoy sale de `kpisEstadoFuerza()` y no de un SELECT escrito aquí:
 * es el mismo que pinta el Tablero y la pantalla de Estado de fuerza, y el
 * asistente tiene que cuadrar con su pantalla espejo. Dos consultas parecidas
 * para el mismo número es como se llega a dos números.
 */
export function fotoDelEstadoDeFuerzaA(fecha) {
  const d = comoDia(fecha);
  if (!d) return null;
  if (d >= hoy()) {
    const kpis = kpisEstadoFuerza();
    return {
      fecha: hoy(),
      fuente: 'estado de fuerza vigente',
      servicios: kpis.servicios,
      guardias: kpis.guardias,
      congelada: false,
    };
  }
  const corte = fotosDelEstadoDeFuerza().find((f) => f.periodo && f.fecha <= d);
  if (!corte) return null;
  const r = getDb()
    .prepare(
      'SELECT COUNT(*) AS servicios, COALESCE(SUM(total_guardias), 0) AS guardias FROM snapshots WHERE periodo = ?'
    )
    .get(corte.periodo);
  return {
    fecha: corte.fecha,
    fuente: corte.fuente,
    servicios: r.servicios,
    guardias: r.guardias,
    // Un corte es una foto guardada: no se recalcula y por eso sirve de extremo.
    congelada: true,
  };
}

/**
 * Las correcciones de una ventana de fechas, con cuánto movieron el número.
 *
 * Solo las que movieron la plantilla. Una corrección de razón social guarda
 * `guardias_antes` y `guardias_despues` iguales —el registro apunta cómo estaba
 * el servicio, no solo lo que cambió— y contarla aquí haría parecer que una
 * corrección de nombre mueve el estado de fuerza.
 *
 * La ventana es medio abierta por el mismo lado que todo lo demás de este
 * archivo: `desde` no cuenta y `hasta` sí. Así dos ventanas encadenadas no
 * cuentan ninguna corrección dos veces ni se dejan ninguna.
 */
export function correccionesDelRango(desde, hasta, limite = 1000) {
  return getDb()
    .prepare(
      `SELECT id, servicio_id, servicio, motivo, usuario, creado_en,
              guardias_antes, guardias_despues,
              guardias_despues - guardias_antes AS diferencia
         FROM correcciones
        WHERE guardias_despues <> guardias_antes
          AND date(creado_en) > ? AND date(creado_en) <= ?
        ORDER BY creado_en DESC, id DESC
        LIMIT ?`
    )
    .all(String(desde), String(hasta), limite);
}

/** Cuántos movimientos y cuántos guardias, con el nombre con el que viajan. */
function conteoYGuardias(fila) {
  return { movimientos: fila?.movimientos || 0, guardias: fila?.guardias || 0 };
}

/**
 * Lo mismo cuando lo que se cuenta son servicios y no movimientos.
 *
 * Va aparte y no con un nombre de clave genérico porque la cifra acaba delante
 * de un modelo que la va a citar: «movimientos: 2» de unos servicios suspendidos
 * se lee como dos movimientos que no existen.
 */
function conteoDeServicios(fila) {
  return { servicios: fila?.servicios || 0, guardias: fila?.guardias || 0 };
}

/**
 * El cuadre: la diferencia entre dos fotos, explicada por altas, bajas y
 * correcciones, y lo que sobre.
 *
 * Toda la aritmética la hace la base: un `COUNT` y un `SUM` por término sobre el
 * conjunto completo. Aquí no se suma ningún renglón de ninguna lista —contar una
 * lista topada da de menos sin que nada avise— y no se suma nada de cabeza.
 */
export function cuadreDelEstadoDeFuerza(desde, hasta) {
  const db = getDb();
  /**
   * Lo que hubo que aclarar, en UN texto y no en una lista.
   *
   * No es por estilo: toda lista que sale hacia el modelo tiene que viajar con su
   * total y con qué cuenta ese total —lo exige el sitio único de
   * `lib/chat-salida.js` y lo vigila su guardián— y esto no es una lista de nada,
   * es lo que hay que aclarar. Es la misma decisión que `avisoDelPeriodo` de la
   * consulta de movimientos.
   */
  const avisos = [];
  const conAviso = (resto) => ({ ...resto, aviso: avisos.length ? avisos.join(' ') : null });

  const pedidoDesde = comoDia(desde);
  const pedidoHasta = comoDia(hasta);
  if (!pedidoDesde || !pedidoHasta) {
    return conAviso({
      sePuede: false,
      porQueNo:
        'El cuadre va entre dos fechas con forma de fecha (AAAA-MM-DD). Las fechas a las que hay una foto ' +
        'del estado de fuerza vienen en «fotosDelEstadoDeFuerza».',
    });
  }

  // Al revés no revienta: se voltea y se dice. Preguntar «de hoy al mes pasado»
  // es una forma normal de preguntarlo y contestar ceros sería contestar otra
  // pregunta.
  let a = pedidoDesde;
  let b = pedidoHasta;
  if (a > b) {
    avisos.push(`El rango venía al revés —de ${a} a ${b}— y se volteó para poder contestarlo.`);
    [a, b] = [b, a];
  }

  const inicio = fotoDelEstadoDeFuerzaA(a);
  const final = fotoDelEstadoDeFuerzaA(b);
  if (!inicio || !final) {
    return conAviso({
      sePuede: false,
      porQueNo:
        'No hay ninguna foto del estado de fuerza a esa fecha ni antes de ella: los cortes guardados ' +
        'empiezan después. Sin una foto que no se mueva no hay contra qué cuadrar, y un número ' +
        'reconstruido cambia cuando se corrige el pasado.',
    });
  }
  if (inicio.fecha !== a) {
    avisos.push(
      `No hay foto del estado de fuerza al ${a}, así que el cuadre arranca en la más cercana que no se ` +
        `mueve: el ${inicio.fecha} (${inicio.fuente}).`
    );
  }
  if (final.fecha !== b) {
    avisos.push(
      `No hay foto del estado de fuerza al ${b}, así que el cuadre cierra en la más cercana que no se ` +
        `mueve: el ${final.fecha} (${final.fuente}).`
    );
  }
  if (inicio.fecha === final.fecha) {
    avisos.push(
      'Las dos fechas caen en la misma foto, así que no hay diferencia que explicar. Pide dos fechas que ' +
        'tengan fotos distintas.'
    );
  }

  // La ventana real es la de las FOTOS, no la de las fechas pedidas: contra la
  // foto del 31 hay que contar lo que se movió DESPUÉS del 31, o el cuadre
  // arrastraría movimientos que la foto ya traía dentro.
  const v = [inicio.fecha, final.fecha];

  /**
   * Las altas y las bajas, con el mismo corte con el que las cuenta su pantalla.
   *
   * `carga_inicial = 0` porque las altas técnicas de la importación no son
   * movimientos: son el apunte de que el servicio ya existía cuando la
   * plataforma arrancó, y no escribieron la columna en esta ventana. Es el mismo
   * filtro que usa `netoDelRango()` para la pantalla de Aperturas, para que el
   * cuadre y el desglose de movimientos no cuenten cosas distintas.
   *
   * `servicio_id IS NOT NULL` porque lo que mueve el estado de fuerza es el
   * movimiento APLICADO. Una apertura registrada y pendiente está en la pantalla
   * y no está en el número; es un candidato del residuo y se mide abajo con su
   * nombre, en vez de meterse aquí y descuadrar el cuadre.
   */
  const altas = conteoYGuardias(
    db
      .prepare(
        `SELECT COUNT(*) AS movimientos, COALESCE(SUM(guardias), 0) AS guardias
           FROM aperturas
          WHERE carga_inicial = 0 AND descartada = 0 AND servicio_id IS NOT NULL
            AND fecha > ? AND fecha <= ?`
      )
      .get(...v)
  );
  const bajas = conteoYGuardias(
    db
      .prepare(
        `SELECT COUNT(*) AS movimientos, COALESCE(SUM(guardias), 0) AS guardias
           FROM cancelaciones
          WHERE servicio_id IS NOT NULL AND fecha > ? AND fecha <= ?`
      )
      .get(...v)
  );

  /**
   * Las correcciones, y la parte de ellas que YA está dentro de las altas.
   *
   * Hace falta distinguirlas y conviene explicar por qué, porque es el detalle
   * que haría que el cuadre no cerrara nunca. Una corrección dice que el número
   * nunca fue cierto, así que `registrarCorreccion()` también reescribe la copia
   * de los guardias que vive en el movimiento, cuando ese movimiento decía
   * exactamente lo que decía la ficha (`alinearGuardiasDelMovimiento`). Si el
   * movimiento reescrito cae DENTRO de la ventana, el término de altas ya trae
   * la cifra corregida: sumar además la corrección contaría lo mismo dos veces.
   *
   * Esa reescritura deja su propio renglón en la bitácora con el antes y el
   * después, así que la parte absorbida no se estima: se lee de ahí, y la resta
   * la hace SQL. Es el sitio donde este cuadre necesita la bitácora, y es la
   * razón por la que vive detrás del permiso de esa pantalla.
   */
  const corr = db
    .prepare(
      `SELECT COUNT(*) AS movimientos, COALESCE(SUM(guardias_despues - guardias_antes), 0) AS guardias
         FROM correcciones
        WHERE guardias_despues <> guardias_antes AND date(creado_en) > ? AND date(creado_en) <= ?`
    )
    .get(...v);
  const absorbido = db
    .prepare(
      `SELECT COALESCE(SUM(json_extract(b.cambios, '$.guardias.despues')
                          - json_extract(b.cambios, '$.guardias.antes')), 0) AS guardias
         FROM bitacora b
         JOIN aperturas a ON a.id = b.entidad_id
        WHERE b.accion = 'guardias_movimiento' AND b.entidad = 'apertura'
          AND a.carga_inicial = 0 AND a.descartada = 0 AND a.servicio_id IS NOT NULL
          AND a.fecha > ? AND a.fecha <= ?
          AND date(b.creado_en) > ? AND date(b.creado_en) <= ?`
    )
    .get(...v, ...v).guardias;
  const correcciones = {
    cuantas: corr.movimientos,
    guardias: corr.guardias,
    guardiasYaDentroDeLasAltas: absorbido,
    guardiasPropios: corr.guardias - absorbido,
  };

  const diferenciaDeGuardias = final.guardias - inicio.guardias;
  const sumaDeLoExplicado = altas.guardias - bajas.guardias + correcciones.guardiasPropios;
  const residuo = diferenciaDeGuardias - sumaDeLoExplicado;

  /**
   * Los candidatos del residuo, medidos, cada uno con su nombre.
   *
   * No son el residuo: son las cosas que sabemos que lo producen, contadas en la
   * misma ventana, para que «sobran nueve guardias» se pueda convertir en «sobran
   * nueve y hay dos aperturas pendientes de aplicar por siete». Lo que quede
   * después de mirarlas es lo que de verdad no tiene explicación, y eso es lo que
   * `residuo` dice sin adornos.
   */
  const pistas = {
    altasRegistradasSinAplicar: conteoYGuardias(
      db
        .prepare(
          `SELECT COUNT(*) AS movimientos, COALESCE(SUM(guardias), 0) AS guardias
             FROM aperturas
            WHERE carga_inicial = 0 AND descartada = 0 AND servicio_id IS NULL
              AND fecha > ? AND fecha <= ?`
        )
        .get(...v)
    ),
    bajasSinServicioLigado: conteoYGuardias(
      db
        .prepare(
          `SELECT COUNT(*) AS movimientos, COALESCE(SUM(guardias), 0) AS guardias
             FROM cancelaciones
            WHERE servicio_id IS NULL AND fecha > ? AND fecha <= ?`
        )
        .get(...v)
    ),
    // Una pausa saca los guardias del total y no escribe la columna ni deja
    // movimiento: es la misma familia que la corrección y el cuarto candidato
    // del residuo. No tiene término propio porque `suspenderServicio()` no
    // escribe `total_guardias` —no está en el censo— y darle uno sería declarar
    // un término que ningún sitio del código alimenta.
    serviciosSuspendidosEnLaVentana: conteoDeServicios(
      db
        .prepare(
          `SELECT COUNT(*) AS servicios, COALESCE(SUM(total_guardias), 0) AS guardias
             FROM servicios
            WHERE estatus = 'SUSPENDIDO' AND suspendido_desde > ? AND suspendido_desde <= ?`
        )
        .get(...v)
    ),
    /**
     * Las altas cuya fecha ya no es la de su movimiento.
     *
     * `fecha_alta` es de los seis campos que una corrección puede tocar, y
     * moverla saca o mete el servicio de la ventana sin que ningún movimiento
     * cambie: el término de altas cuenta por la fecha del movimiento y la foto
     * cuenta por la fecha de alta, así que las dos se separan. No escribe
     * `total_guardias` —no está en el censo, y no debe estarlo— pero mueve el
     * número igual, así que se mide aquí con su nombre.
     */
    altasCuyaFechaDeAltaSeCorrigio: conteoYGuardias(
      db
        .prepare(
          `SELECT COUNT(*) AS movimientos, COALESCE(SUM(a.guardias), 0) AS guardias
             FROM servicios s
             JOIN aperturas a ON a.id = s.apertura_id
            WHERE a.carga_inicial = 0 AND a.fecha <> s.fecha_alta
              AND ((a.fecha > ? AND a.fecha <= ?) OR (s.fecha_alta > ? AND s.fecha_alta <= ?))`
        )
        .get(...v, ...v)
    ),
  };

  return conAviso({
    sePuede: true,
    pedido: { desde: pedidoDesde, hasta: pedidoHasta },
    alInicio: inicio,
    alFinal: final,
    diferenciaDeGuardias,
    altas,
    bajas,
    correcciones,
    sumaDeLoExplicado,
    residuo,
    cuadra: residuo === 0,
    pistasDelResiduo: pistas,
  });
}
