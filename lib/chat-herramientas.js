/**
 * Las siete herramientas del asistente: su permiso, su esquema y su ejecución.
 *
 * La decisión que gobierna este archivo, y que es contrato del director: cada
 * quien le puede preguntar al asistente exactamente lo que ya puede ver
 * navegando. Cada herramienta declara DE QUÉ PANTALLA ES ESPEJO y hereda el
 * permiso de esa pantalla. No hay una tercera tabla de permisos que mantener, y
 * no se inventa ninguna lista de «qué campo ve cada rol»: esa lista no existe en
 * esta plataforma —los permisos de aquí gobiernan quién escribe y a qué pantalla
 * se entra, no qué valores se ven dentro de una pantalla abierta— y una lista
 * inventada queda más cerrada que las pantallas en unos sitios y más abierta en
 * otros, sin que nadie la actualice cuando una pantalla cambie.
 *
 * La única excepción, con su porqué escrito donde vive: `CAMPOS_POR_PERMISO`.
 * Hay campos cuya casa CON ETIQUETA es una pantalla restringida aunque viajen en
 * el resultado de una pantalla abierta, y el precio por guardia era uno. No es
 * una tabla de roles: es a qué pantalla restringida pertenece un campo, y quién
 * entra a esa pantalla lo sigue decidiendo `PERMISOS`.
 *
 * El permiso se comprueba DOS veces, y la segunda es la que vale:
 *
 *   1. Al armar la petición, `definicionesPara(rol)` solo ofrece las
 *      herramientas cuyo permiso tiene ese rol. Esto es cortesía: que no pida lo
 *      que no puede.
 *   2. Al ejecutar, `ejecutar()` vuelve a comprobar el permiso contra la sesión
 *      antes de leer nada. Esta es la cerradura, y hace falta porque el nombre
 *      de la herramienta llega en la respuesta del servicio externo: tratar ese
 *      nombre como autorización sería confiar en que nadie se equivoque nunca.
 *
 * Ninguna de las siete escribe nada. No hay herramienta que capture, corrija,
 * facture, comente ni marque leído, y no hay ninguna que reciba SQL, nombres de
 * tabla ni nombres de columna: reciben lo que recibe un filtro de pantalla —una
 * zona, un periodo, un texto a buscar— y devuelven lo que esa pantalla pinta.
 * Un asistente que pudiera redactar una consulta habría que auditarlo consulta
 * por consulta para siempre; uno que solo puede llamar a siete funciones
 * conocidas se audita una vez, leyendo siete funciones.
 *
 * Ninguna lista sale de aquí a mano. Todas pasan por `lib/chat-salida.js`, que
 * es el sitio único de lo que sale hacia el modelo y el que pone al lado de cada
 * lista recortada su total de verdad y qué cuenta ese total. Antes cada
 * herramienta recortaba por su cuenta con un `.slice(0, 25)`, y tres de ellas
 * mandaban veinticinco renglones de ochenta sin decirlo: el modelo describía esos
 * veinticinco como si fueran todo. No se tapó sitio por sitio porque es lo que
 * no ha funcionado cuatro vueltas seguidas; se quitó la posibilidad.
 *
 * La agenda de precios no entra en esta vuelta. El precio de un servicio
 * concreto ya sale en `ficha_de_servicio`, que es lo que la gente pregunta, y la
 * agenda completa son 217 renglones que no caben en una respuesta de chat. Queda
 * anotado como lo primero a sumar si alguien lo pide.
 *
 * Y las sumas de un periodo largo son un ARGUMENTO de `movimientos`, no una
 * herramienta número ocho. El dueño preguntó «¿cuántos guardias hemos aperturado
 * contra cuántos hemos perdido?» y el asistente contestó que no podía sumar: su
 * consulta miraba un mes, así que para contestar un año tendría que haber pedido
 * doce meses y sumarlos él. Lo que se le dio no fue permiso para sumar, fue una
 * consulta que suma en la base. Que sea un argumento y no una herramienta nueva
 * tiene tres razones, y ninguna es ahorro de trabajo:
 *
 *   · Es la MISMA pantalla. La barra de arriba de «Aperturas» ya enseña el año
 *     entero con su total —`calendarioDe()`— además del mes abierto. Un rango de
 *     meses sigue siendo el espejo de esa pantalla, así que hereda su permiso
 *     como lo heredaba el mes y no hay un espejo nuevo que justificar.
 *   · Una herramienta aparte dejaría dos sitios que contestan «cuántas altas
 *     hubo», y este proyecto ya sabe cómo acaba eso: basta que una de las dos
 *     cambie de opinión sobre qué columna es «el mes» para que las dos cifras se
 *     contradigan sin que nada avise.
 *   · El mes y el rango son la misma pregunta con un extremo más. Tres pruebas
 *     independientes fijan en siete el inventario de herramientas, y romperlas
 *     para partir una pregunta en dos sería cambiar el contrato por comodidad.
 */

import { puede, PERMISOS } from './rbac';
import { marcaDeLaOficina, mesActual, anioActual } from './fechas';
import { conSuTotal, elTotalAparte, SIN_RECORTE } from './chat-salida';
import {
  kpisEstadoFuerza,
  distribucionPorTurno,
  distribucionPorZona,
  distribucionPorModalidad,
  motivosCancelacion,
  rankingAsesores,
  contratosPorVencerEnMeses,
  periodoVigente,
} from './queries';
import { listarServicios, obtenerServicio, agregadosDeServicios } from './servicios';
import { resumenDe, kpisCobranzaDe, facturasVencidas, pendientesDeFacturar } from './facturacion';
import { historialDe } from './precios';
import {
  movimientosDe,
  netoDelRango,
  movimientosMesAMes,
  movimientosAgrupados,
  rangoConMovimientos,
  pendientesPorAntiguedad,
} from './movimientos';
import { estadoAlDia, movimientosDelDia, comoDia } from './dias';
import { kpisJuridico, carteraJuridica } from './juridico';

/** El modelo pidió una herramienta que su rol no tiene, o que no existe. */
export class FueraDeAlcance extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'FueraDeAlcance';
  }
}

/** A cuántos caracteres se recorta un texto que lo teclea el equipo. */
export const TOPE_TEXTO_LIBRE = 300;

/**
 * Cuántos motivos de baja enseña el resultado.
 *
 * Son los que tienen más guardias, y es lo que pinta la pantalla. Lo que faltaba
 * —y era el defecto— no es enseñar más: es decir cuántos motivos distintos hay,
 * para que diez renglones no se lean como «los motivos».
 */
const TOPE_MOTIVOS = 10;

/**
 * Ya no viaja ningún histórico de meses fijo, y es deliberado (C2).
 *
 * Aquí había un `MESES_DE_HISTORIA = 12` que alimentaba una segunda tabla de
 * meses —`movimientosPorPeriodo(12)`— dentro del mismo resultado que ya traía el
 * desglose del periodo pedido. Eran los últimos doce meses DE LA BASE, pidiera lo
 * que se pidiera: con «desde 2023-01 / hasta 2023-12» la respuesta llevaba los
 * doce meses de 2023 y, al lado, una tabla de 2025-09 a 2026-08, y era el modelo
 * el que elegía cuál citar.
 *
 * No se pierde nada al quitarla: `porMesDelPeriodo` contesta lo mismo y mejor
 * —del periodo que se pidió— y con `todoElHistorico: true` da todos los meses que
 * haya. `movimientosPorPeriodo()` se queda donde está porque alimenta la gráfica
 * del Tablero; lo que se quitó es el lado del problema que nos tocaba, que era
 * mandarla al modelo junto a otra tabla de otro periodo.
 */

/**
 * Los nombres de servicio, las observaciones y los comentarios los teclea el
 * equipo: son DATOS, no instrucciones.
 *
 * Tres saneamientos, y conviene saber qué protege cada uno y qué no:
 *
 *   · Se recorta a 300 caracteres. Un campo de dos mil caracteres puede traer un
 *     bloque entero de texto con forma de reglas.
 *   · Los saltos de línea y tabuladores se colapsan a un espacio, para que un
 *     campo no pueda parecer un turno de conversación ni un bloque de sistema.
 *   · Nunca se construye un enlace con texto de la base: los enlaces los arma
 *     este archivo con el id.
 *
 * Nada de esto impide que el modelo obedezca una orden escrita dentro de un
 * dato, y no se pretende. Lo que de verdad protege es que obedecer no sirva de
 * nada: no hay herramienta que escriba y no hay herramienta fuera del rol de
 * quien pregunta, así que el peor caso de un modelo perfectamente obediente es
 * que le diga una tontería a la persona que preguntó. Los tres saneamientos son
 * higiene; la frontera es la de arriba.
 */
export function saneado(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  // Cualquier racha de espacio en blanco —saltos de línea, tabuladores y los
  // separadores de línea raros de Unicode— se vuelve UN espacio. Se persigue la
  // clase entera y no una lista de caracteres: una lista es donde se esconde el
  // que falta, y aquí lo que importa es que el campo quede en un solo renglón.
  const plano = String(valor).replace(/\s+/g, ' ').trim();
  if (plano.length <= TOPE_TEXTO_LIBRE) return plano;
  return `${plano.slice(0, TOPE_TEXTO_LIBRE)}…`;
}

/**
 * Un objeto con solo las llaves pedidas, con los textos ya saneados.
 *
 * Y la regla que trajo el hallazgo más caro de esta vuelta: PEDIR UN CAMPO QUE EL
 * RENGLÓN NO TIENE SE CAE AQUÍ. No viaja en nulo.
 *
 * Qué pasaba. `faltaPorFacturar` pedía `['id', 'servicio', 'total_guardias',
 * 'importe_factura', 'esquema_facturacion']` y los renglones que produce
 * `pendientesDeFacturar()` se llaman `servicio_id`, `plantilla` e `importe`. Solo
 * `servicio` casaba: las otras cuatro llaves salían en nulo —`saneado(undefined)`
 * es nulo— y nada en el resultado decía que faltaran. Veinticinco renglones con
 * cuatro de cinco campos vacíos hacia el modelo, de servicios cuyo importe la
 * plataforma conoce y la pantalla de Cobranza pinta; y el mismo asistente,
 * preguntado por la ficha del servicio, contestaba los números buenos. Se
 * contradecía solo, y estaba en producción.
 *
 * La causa de raíz no es el nombre mal escrito —eso se corrige en un minuto— es
 * que un nombre mal escrito no dolía. Mientras pedir un campo inexistente
 * devuelva nulo en silencio, esta clase vuelve cada vez que alguien renombre una
 * columna o copie una lista de campos de otro sitio, y no la caza ninguna prueba.
 * Que se caiga aquí la convierte en un error que revienta la suite —que corre las
 * siete consultas— en vez de en veinticinco nulos delante de quien pregunta.
 *
 * Se distinguen dos cosas que NO son la misma, y solo la primera es un defecto:
 *
 *   · el renglón no TIENE la llave → error de programación: se cae.
 *   · el renglón tiene la llave y está vacía → un dato que nadie capturó, que es
 *     legítimo y corriente; sale en nulo como siempre.
 *
 * Se exporta para que la distinción de arriba tenga su propia prueba directa, al
 * lado de la que corre las siete consultas: la regla es de este archivo y aquí no
 * depende de que alguna de las doce listas tenga hoy el campo adecuado para
 * medirla.
 */
export function recorte(fila, llaves) {
  if (!fila || typeof fila !== 'object') {
    throw new Error(
      `Un renglón que sale hacia el modelo no es un objeto, así que no puede traer «${llaves.join('», «')}».`
    );
  }
  // `hasOwnProperty` y no `fila[llave] !== undefined`: lo que se persigue es la
  // llave que no existe, no el valor vacío. Un campo capturado en blanco tiene
  // que poder viajar en nulo, que es lo que de verdad es.
  const faltan = llaves.filter((llave) => !Object.prototype.hasOwnProperty.call(fila, llave));
  if (faltan.length) {
    throw new Error(
      `Un renglón que sale hacia el modelo no trae «${faltan.join('», «')}»; lo que trae es ` +
        `«${Object.keys(fila).join('», «')}». Un campo que el renglón no tiene saldría en nulo y el modelo lo ` +
        'leería como un dato vacío de la plataforma.'
    );
  }
  const out = {};
  for (const llave of llaves) out[llave] = saneado(fila[llave]);
  return out;
}

/**
 * Campos que solo salen hacia el modelo si quien pregunta tiene el permiso de la
 * pantalla donde ese campo se lee CON SU NOMBRE.
 *
 * Por qué existe esto, dicho con el caso que lo trajo. `ficha_de_servicio`
 * declara `permiso: 'ver'` —la ficha de un servicio la abren los seis roles— y
 * entregaba `precio_guardia`. Medido contra la plataforma, con el precio puesto
 * en una cifra distintiva: la etiqueta «Precio por guardia» solo se pinta en la
 * pantalla «Precios» y, dentro de la ficha, en el bloque editable del
 * administrador. A jurídico y a operaciones, que en «Precios» leen «Sin
 * permiso», el chat les contestaba el precio con su nombre. El contrato del
 * asistente es ser espejo de lo que la persona puede ver CON SU NOMBRE, y ahí no
 * lo era.
 *
 * Esto NO es la tabla de «qué campo ve cada rol» que el plan prohíbe inventar. No
 * hay aquí ninguna lista de roles ni ningún permiso nuevo: lo único que se
 * declara es a qué pantalla restringida pertenece un campo, y quién entra a esa
 * pantalla lo sigue decidiendo `PERMISOS` de `lib/rbac.js`, como todo lo demás.
 * La clave es un permiso que ya existe; el guardián comprueba que exista y que
 * el campo sea una columna de verdad de la base.
 *
 * Y lo que esto NO cierra, que es lo importante y hay que decirlo: nadie puede
 * comprobar que esta declaración esté COMPLETA. Un campo nuevo cuya casa con
 * etiqueta sea una pantalla restringida vuelve a cruzar la frontera si nadie lo
 * declara aquí, porque saber de qué pantalla es cada campo pediría leer `app/`
 * con un analizador que adivina —o inventar la tabla que el plan prohíbe—. Lo que
 * sí está cerrado es el mecanismo: el filtro vive en un solo sitio, se aplica a
 * todas las consultas y a todo el resultado por igual, y el guardián lo mide
 * corriendo las siete con los seis roles.
 */
export const CAMPOS_POR_PERMISO = {
  // El precio por guardia y sus dos caras en el historial. `importe_factura`,
  // `importe_anterior` e `importe_nuevo` NO están aquí a propósito: el importe de
  // factura y la tabla «Precio y su historia» los pinta la ficha del servicio con
  // su etiqueta para los seis roles —comprobado leyendo el HTML—, así que ahí el
  // chat sí es espejo y cerrarlo lo dejaría más cerrado que la pantalla.
  precios: ['precio_guardia', 'precio_anterior', 'precio_nuevo'],
};

/** Los campos que esta sesión no puede recibir, por el permiso que le falta. */
function camposVetados(rol) {
  const vetados = new Set();
  for (const [permiso, campos] of Object.entries(CAMPOS_POR_PERMISO)) {
    if (!puede(rol, permiso)) for (const campo of campos) vetados.add(campo);
  }
  return vetados;
}

/**
 * Quita de un resultado, a cualquier profundidad, los campos vetados.
 *
 * Va por nombre de llave y recorre todo —objetos, listas y listas de objetos—
 * porque el mismo campo viaja en dos sitios: suelto en la ficha del servicio y
 * dentro de cada renglón de su historia de precios. Un filtro que solo mirara el
 * primer nivel habría cerrado uno de los dos y habría dejado el otro abierto, que
 * es la forma de arreglo que este proyecto lleva un mes desarmando.
 */
function sinCamposVetados(valor, vetados, quitados) {
  if (Array.isArray(valor)) return valor.map((v) => sinCamposVetados(v, vetados, quitados));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const [llave, v] of Object.entries(valor)) {
      if (vetados.has(llave)) {
        quitados.add(llave);
        continue;
      }
      out[llave] = sinCamposVetados(v, vetados, quitados);
    }
    return out;
  }
  return valor;
}

/**
 * La ficha de un resultado: el hecho que el servidor pone debajo del texto.
 *
 * Regla del recuadro «De dónde salió esto», y es la razón de que exista: todo lo
 * que va dentro lo escribe ESTE archivo. La etiqueta `dato` se escribe aquí
 * entera, sin texto libre de nadie —ni el que elige el servicio externo en los
 * argumentos de una consulta, ni el que teclea el equipo en un campo de la base—.
 * Dentro del recuadro, un valor real y una etiqueta escrita por otro se leen
 * igual, y entonces el recuadro deja de ser la prueba de que el número es real,
 * que es lo único que hace. Lo único variable que se admite es un dato que el
 * servidor ya validó y que no es texto libre: un id entero o una fecha con forma
 * de fecha. Lo vigila `tests/chat-listas-con-total.test.mjs`.
 */
function ficha(pantalla, enlace, dato, valor) {
  return { pantalla, dato, valor: String(valor), enlace, consultado: marcaDeLaOficina() };
}

/**
 * La ficha de una respuesta que no consultó nada.
 *
 * El recuadro «De dónde salió esto» solo existía si se había ejecutado una
 * consulta. Si el servicio externo contesta una cifra SIN pedir ninguna, el canal
 * llevaba el texto y cero fichas, y la pantalla pintaba el párrafo a secas: una
 * cifra inventada, bien escrita, sin nada debajo que la desmienta. Es el formato
 * que mejor disfraza una cifra falsa, y la única defensa que no depende de que el
 * modelo se porte bien no se activaba justo cuando más falta hacía.
 *
 * Así que la respuesta sin consulta también deja ficha, y la ficha dice lo que
 * pasó: que el servidor no leyó ninguna pantalla. No lleva enlace a propósito —no
 * hay pantalla de dónde venga— y la pantalla la pinta sin enlace.
 */
export function fichaSinConsulta() {
  return ficha(
    'Sin consulta',
    null,
    'El asistente no leyó ninguna pantalla para contestar esto',
    'ninguna cifra comprobada'
  );
}

/**
 * Los años que puede llevar un mes del que se pregunta.
 *
 * Un `0000-01` y un `9999-12` pasan el patrón de AAAA-MM y no son meses de los
 * que nadie pueda estar hablando: son el mínimo y el máximo de un campo de cuatro
 * cifras puestos donde va un año.
 *
 * La ventana es absurdamente ancha a propósito, y conviene decir por qué: lo que
 * caza es el imposible y NO el mes sin datos. «¿Cuánto facturamos en mayo de
 * 2022?» tiene que seguir contestándose con mayo de 2022 y un cero, porque la
 * respuesta a un mes vacío es ese cero —y la respuesta a un mes imposible es
 * decir que no existe—. Una ventana estrecha convertiría un mes viejo y vacío en
 * «se contestó el mes en curso», que es cambiar la pregunta, o sea el defecto que
 * esta plataforma lleva meses cerrando.
 */
const ANIO_MINIMO = 1900;
const ANIOS_ADELANTE = 100;

/**
 * Un mes que exista: AAAA-MM, el mes del 01 al 12 y el año de los que puede
 * llevar un mes de verdad. Devuelve el mes o nada.
 *
 * Es la MISMA regla para el mes suelto y para los extremos de un rango, y eso es
 * la mitad de la corrección: antes el extremo de un rango rechazaba `2026-13` con
 * un aviso explícito y el mes suelto lo aceptaba y lo ponía de etiqueta de las
 * cifras. Dos caminos de la misma consulta tratando el mismo texto de dos formas
 * no es una diferencia que se pueda defender, y la que callaba era la peor.
 */
function mesDelCalendario(crudo) {
  // El año sale del grupo del patrón y no de un recorte del texto: en este
  // archivo ningún `.slice(` es inocente —lo vigila el guardián del sitio único,
  // que prefiere el falso positivo— y aquí no hace falta ninguno.
  const casa = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(crudo ?? '').trim());
  if (!casa) return null;
  const anio = Number(casa[1]);
  return anio >= ANIO_MINIMO && anio <= anioActual() + ANIOS_ADELANTE ? casa[0] : null;
}

/**
 * Un periodo AAAA-MM y el aviso de qué pasó si lo que vino no era uno.
 *
 * Antes esto validaba con `/^\d{4}-\d{2}$/` y devolvía el texto tal cual, así que
 * un `2026-13`, un `2026-00` o un `0000-01` viajaban como el `periodo` de la
 * respuesta y la ficha los avalaba: «Guardias que entraron y salieron en 0000-01:
 * +0 / −0». El cero era cierto, pero el aviso que salía era «no hubo ningún
 * movimiento en el periodo cubierto», que se lee como un mes real y vacío, y el
 * recuadro que existe para avalar cifras avalaba un mes que no puede existir.
 * Mientras tanto el MISMO texto como extremo de un rango sí se rechazaba con un
 * aviso explícito, y dos caminos de la misma consulta tratando igual el mismo
 * texto no es una diferencia que se pueda defender.
 *
 * Ahora: lo que no es un mes cae en el vigente —que es lo que ya hacía cuando no
 * venía nada, y es la respuesta normal a «¿cuántas altas hubo?» sin mes— y la
 * respuesta lo DICE. El aviso no repite el texto que llegó: ese texto lo elige el
 * servicio externo y un aviso con él dentro sería texto de fuera viajando con
 * cara de hecho del servidor.
 */
function periodoPedido(crudo) {
  const mes = mesDelCalendario(crudo);
  if (mes) return { mes, avisos: [] };
  const vigente = periodoVigente() || mesActual();
  if (!vinoAlgo(crudo)) return { mes: vigente, avisos: [] };
  return {
    mes: vigente,
    avisos: [
      `El mes que se pidió no es un mes que exista —va como AAAA-MM, con el mes del 01 al 12—, así que se ` +
        `contestó ${vigente}.`,
    ],
  };
}

/** Si vino algo escrito, sea entendible o no. */
function vinoAlgo(crudo) {
  return String(crudo ?? '').trim() !== '';
}

/**
 * Si lo que llegó en `todoElHistorico` pide el histórico.
 *
 * Antes era `todoElHistorico === true` a secas, y con un `'sí'` o un `'true'` la
 * respuesta se iba en silencio al mes vigente —hoy cero movimientos— en vez de a
 * los cuarenta y cuatro meses que se pidieron. No mentía, porque `desde`, `hasta`
 * y `mesesCubiertos` decían lo que cubrió, pero era la distancia más grande entre
 * lo que se pidió y lo que se contestó de todos los casos de tipo equivocado que
 * se midieron.
 *
 * El esquema declara `type: 'boolean'` con `strict: true`, así que el servicio
 * externo no debería poder mandar un texto; esto es el cinturón de abajo, por si
 * el `strict` deja de cumplirse al otro lado. Se aceptan las tres formas en que
 * un sí llega escrito y nada más: cualquier otra cosa sigue siendo «no se pidió
 * el histórico», que es lo que ya pasaba.
 */
function pidieronElHistorico(crudo) {
  if (crudo === true) return true;
  return ['sí', 'si', 'true', '1'].includes(String(crudo ?? '').trim().toLowerCase());
}

/** Cuántos meses del calendario abarca un rango, con los dos extremos dentro. */
function mesesEntre(desde, hasta) {
  const [anioA, mesA] = desde.split('-').map(Number);
  const [anioB, mesB] = hasta.split('-').map(Number);
  // En meses absolutos, para no tratar aparte el cruce de año: de diciembre a
  // enero son dos meses, no menos once.
  return anioB * 12 + mesB - (anioA * 12 + mesA) + 1;
}

/**
 * Qué meses cubre de verdad una consulta de movimientos, y qué hubo que corregir
 * de lo que se pidió.
 *
 * Por qué la respuesta tiene que decir esto y no solo las cifras: «este año» y
 * «desde que arrancamos» se contestan con la misma herramienta, y si lo único que
 * vuelve son cuatro números, las dos respuestas se leen igual. El periodo
 * cubierto viaja siempre —también cuando se pidió un mes solo— para que el modelo
 * no tenga que deducirlo de lo que él mismo pidió.
 *
 * Y los avisos existen porque un rango puede venir raro de tres formas, y ninguna
 * de ellas es para reventar: un extremo que no es un mes, el rango al revés, o
 * una base sin un solo movimiento. En los tres casos se contesta lo que se pudo
 * cubrir y se dice qué pasó. Lo que NO se hace nunca es repetir en el aviso el
 * texto que vino de fuera: ese texto lo elige el servicio externo, y un aviso con
 * él dentro sería texto de fuera viajando con cara de hecho del servidor.
 */
function periodoCubierto({ periodo, desde, hasta, todoElHistorico }) {
  const avisos = [];
  const pidioRango = pidieronElHistorico(todoElHistorico) || vinoAlgo(desde) || vinoAlgo(hasta);
  if (!pidioRango) {
    const pedido = periodoPedido(periodo);
    avisos.push(...pedido.avisos);
    return { desde: pedido.mes, hasta: pedido.mes, meses: 1, esUnMes: true, avisos };
  }

  const hay = rangoConMovimientos();
  const primero = mesDelCalendario(hay.primero) || mesActual();
  const ultimo = mesDelCalendario(hay.ultimo) || mesActual();
  if (!hay.primero) {
    avisos.push(
      'No hay ni un movimiento registrado en la plataforma, así que el periodo se quedó en el mes en curso.'
    );
  }

  let d = mesDelCalendario(desde);
  if (!d) {
    if (vinoAlgo(desde)) {
      avisos.push(`El mes de inicio no se entendió —va como AAAA-MM—, así que se arrancó en ${primero}.`);
    }
    d = primero;
  }
  let h = mesDelCalendario(hasta);
  if (!h) {
    if (vinoAlgo(hasta)) {
      avisos.push(`El mes final no se entendió —va como AAAA-MM—, así que se cerró en ${ultimo}.`);
    }
    h = ultimo;
  }
  if (d > h) {
    avisos.push(`El rango venía al revés —de ${d} a ${h}— y se volteó para poder contestarlo.`);
    [d, h] = [h, d];
  }

  return { desde: d, hasta: h, meses: mesesEntre(d, h), esUnMes: d === h, avisos };
}

/**
 * Las siete, en orden fijo.
 *
 * El orden es fijo porque las definiciones van antes del punto de caché: una
 * lista que cambia de orden entre peticiones del mismo rol tira la caché del
 * prefijo sin que nada avise, y la señal sería una factura más alta sin causa
 * visible.
 */
export const HERRAMIENTAS = [
  {
    nombre: 'resumen_operacion',
    permiso: 'ver',
    pantalla: 'Tablero',
    enlace: '/',
    descripcion:
      'Cuántos servicios activos y cuántos guardias hay ahora mismo, y cómo se reparten por turno, ' +
      'por zona y por modalidad. Úsala para cualquier pregunta de totales de la operación. ' +
      'NO sirve para cobranza ni para un servicio concreto.',
    esquema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    ejecutar() {
      const kpis = kpisEstadoFuerza();
      const turnos = distribucionPorTurno();
      const zonas = distribucionPorZona();
      const modalidad = distribucionPorModalidad();
      /**
       * El ranking de asesores (F3): la única cifra que el Tablero pinta y su
       * propio espejo no traía. Contesta «¿quién atiende más?».
       *
       * Se piden TODOS y recorta el sitio único, como toda lista que sale.
       *
       * Y el cuidado que hay que tener aquí, que está medido: `rankingAsesores()`
       * cuelga `compartidos` —cuántos servicios llevan más de un asesor— como
       * PROPIEDAD DEL ARRAY, no como renglón. `conSuTotal` mapea los renglones y
       * esa propiedad se perdería en silencio, así que se lee ANTES y viaja
       * aparte: es justo lo que explica que la columna pueda sumar más que la
       * operación, y sin ella la cifra parece un error de la plataforma.
       */
      const asesores = rankingAsesores(SIN_RECORTE);
      const asesoresCompartidos = asesores.compartidos;
      const asesoresSinReparto = asesores.sinRepartoCapturado;
      return {
        datos: {
          serviciosActivos: kpis.servicios,
          guardias: kpis.guardias,
          promedioGuardiasPorServicio: kpis.promGuardias,
          serviciosDadosDeBaja: kpis.bajas,
          sinContrato: kpis.sinContrato,
          sinFacturar: kpis.sinFacturar,
          // Del reparto por turno se toma lo que la pantalla enseña, y también
          // cuántos guardias NO lo tienen capturado: sin ese segundo número el
          // reparto parece completo y es el 3% de la operación.
          porTurno: {
            ...conSuTotal(
              'turnos',
              turnos.turnos,
              (t) => recorte(t, ['turno', 'guardias', 'servicios']),
              'turnos distintos con guardias repartidos'
            ),
            guardiasRepartidos: turnos.total,
            serviciosSinDesglose: turnos.sinDesglose,
            guardiasSinDesglose: turnos.guardiasSinDesglose,
          },
          ...conSuTotal(
            'porZona',
            zonas,
            (z) => recorte(z, ['zona', 'servicios', 'guardias']),
            'zonas con servicios activos'
          ),
          ...conSuTotal(
            'porModalidad',
            modalidad.filas,
            (m) => recorte(m, ['modalidad', 'servicios', 'guardias']),
            'modalidades de contratación con servicios activos'
          ),
          ...conSuTotal(
            'porAsesor',
            asesores,
            (a) => recorte(a, ['asesor', 'servicios', 'guardias']),
            'asesores por guardias de los servicios activos de HOY, del que más atiende al que menos, que es ' +
              'lo que pinta el Tablero en «Asesores por guardias». Un servicio compartido cuenta ENTERO para ' +
              'cada asesor, así que la columna puede sumar más que la operación —es como lo pinta el ' +
              'Tablero—; cuántos hay lo dice «asesoresCompartidos», y cuando es cero la columna suma exacto. ' +
              'Cada renglón es un TEXTO distinto del campo «asesor» y no necesariamente una persona: donde ' +
              'el reparto no está capturado —lo dice «asesoresSinRepartoCapturado»— un campo con dos nombres ' +
              'escritos juntos viaja como un renglón, y la misma persona puede salir en varios. Es «quién ' +
              'atiende más», no «quién abrió o perdió»: eso es «porAsesorDelPeriodo» de movimientos'
          ),
          // Cuántos servicios llevan más de un asesor: es lo que explica que la
          // columna de guardias pueda sumar más que la operación. Va como cifra
          // suelta porque se perdería dentro del mapeo de los renglones.
          asesoresCompartidos,
          asesoresCompartidosQueCuenta:
            'servicios activos que llevan más de un asesor; cada uno cuenta entero en los dos, y es la razón ' +
            'de que los guardias de «porAsesor» puedan sumar más que los de la operación. En cero, la columna ' +
            'suma exactamente la operación y no hay ningún doble conteo',
          /**
           * El riesgo que SÍ se materializa hoy, y que el texto de arriba callaba.
           *
           * Medido por el tester: `asesoresCompartidos` es 0 —el reparto no está
           * capturado en ningún servicio— así que la columna suma exactamente la
           * operación y el aviso del doble conteo avisa de algo que no pasa.
           * Mientras tanto lo que sí pasa es lo contrario: al caer a la columna
           * `asesor`, tres de los trece renglones son el mismo señor, porque donde
           * van dos personas los dos nombres están escritos en el mismo campo. El
           * conteo no está inflado por reparto: está PARTIDO por captura, y quien
           * leyera solo el aviso de arriba creería justo lo contrario.
           *
           * Es un defecto de captura que el asistente hereda y que no puede
           * arreglar adivinando dónde parte un nombre. Lo que sí puede es decirlo
           * con una cifra que sale de la base y no de una estimación.
           */
          asesoresSinRepartoCapturado: asesoresSinReparto,
          asesoresSinRepartoCapturadoQueCuenta:
            'servicios activos sin reparto de asesores capturado, en los que se cuenta el texto del campo ' +
            '«asesor» tal como se escribió. En esos, dos personas anotadas en el mismo campo viajan como un ' +
            'solo renglón de «porAsesor» y la misma persona puede aparecer en varios, así que ' +
            '«porAsesorTotal» es el número de textos distintos y no el de personas',
        },
        // El valor de la ficha sale de la consulta, no se escribe a mano aquí:
        // es la lección de las 15 aperturas, y vale igual para un chat.
        ficha: ficha('Tablero', '/', 'Servicios activos · guardias', `${kpis.servicios} · ${kpis.guardias}`),
      };
    },
  },

  {
    nombre: 'buscar_servicio',
    permiso: 'ver',
    pantalla: 'Estado de fuerza',
    enlace: '/estado-fuerza',
    descripcion:
      'Busca servicios por nombre o razón social, igual que la caja de buscar de Estado de fuerza. ' +
      'Devuelve el renglón de cada uno, su id y los agregados del filtro completo (cuántos servicios, ' +
      'cuántos guardias y cuánta facturación), que es el renglón que pinta la pantalla. Por omisión busca ' +
      'solo entre los ACTIVOS; con «estatus» se busca entre los suspendidos, los dados de baja, los que ' +
      'están por arrancar, o entre TODOS. Úsala antes de «ficha_de_servicio» cuando quien pregunta nombra ' +
      'un cliente y no sabes su id, y con «estatus» cuando no aparezca entre los activos.',
    esquema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre del servicio o de la razón social.' },
        zona: { type: 'string', description: 'Zona exacta, si la pregunta la nombra. Opcional.' },
        estatus: {
          type: 'string',
          description:
            'Entre qué servicios buscar: ACTIVO (por omisión, los que están en la calle), SUSPENDIDO, ' +
            'BAJA, POR_ARRANCAR, o TODOS para no filtrar por estatus. Opcional.',
        },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    ejecutar({ texto, zona, estatus }) {
      /**
       * Entre qué servicios se busca (F2).
       *
       * La lista de estatus válidos está CERRADA y escrita aquí: lo que entra en
       * el filtro es uno de estos valores, nunca el texto que llegó de fuera. Un
       * estatus que no se reconozca se trata como el de siempre —los activos— y
       * se dice en `buscadoSoloEntre`, porque un filtro que no se entendió no
       * puede acabar en una búsqueda silenciosamente más ancha.
       *
       * `TODOS` es el único que no filtra por estatus, y es el que arregla el
       * defecto de verdad: hoy un «¿tenemos al cliente tal?» de un servicio
       * suspendido se contestaba «no existe», y un «no» con cara de verdad cuesta
       * lo mismo que una cifra inventada y es más difícil de notar, porque nadie
       * verifica un «no».
       */
      const ESTATUS_VALIDOS = ['ACTIVO', 'SUSPENDIDO', 'BAJA', 'POR_ARRANCAR', 'TODOS'];
      const pedido = String(estatus ?? '').trim().toUpperCase();
      const cual = ESTATUS_VALIDOS.includes(pedido) ? pedido : 'ACTIVO';
      // Los filtros se arman una vez y se pasan a las dos consultas: la lista y
      // sus agregados tienen que ser del MISMO filtro, o el renglón de arriba
      // cuenta otra cosa que la lista de abajo.
      const filtros = { estatus: cual === 'TODOS' ? '' : cual, q: texto || '', zona: zona || '' };
      const filas = listarServicios(filtros);
      /**
       * Los agregados del filtro, sumados por la base sobre el conjunto completo.
       *
       * Es el renglón que la pantalla pinta arriba y que el asistente no tenía.
       * NO se suman los renglones que viajan: viajan veinticinco de los que haya,
       * y sumar esos daría de menos con cara de total. Medido: una búsqueda de
       * toda la cartera son 201 servicios con importe y 19.0 millones al mes.
       */
      const agregados = agregadosDeServicios(filtros);
      // Qué estatus se usó de verdad, escrito por el servidor con el valor de la
      // lista cerrada y nunca con el texto que llegó de fuera.
      const entreQuienes =
        cual === 'TODOS'
          ? 'servicios de cualquier estatus: activos, suspendidos, dados de baja y por arrancar'
          : `servicios con estatus ${cual}`;
      return {
        datos: {
          encontrados: filas.length,
          /**
           * Entre quiénes se buscó DE VERDAD.
           *
           * La pantalla arranca filtrando por activos —hasta aquí es espejo— y
           * DEJA CAMBIARLO. Ahora el asistente también, así que este texto dejó de
           * ser una disculpa y pasó a decir qué filtro se usó: sin él, una
           * búsqueda entre bajas y una entre activos se leen igual.
           */
          buscadoSoloEntre: entreQuienes,
          sinBuscarEntre:
            cual === 'TODOS'
              ? 'nada por estatus: se miró entre todos. Un servicio dado de baja trae importes y condiciones ' +
                'de un contrato que ya no existe, así que el estatus de cada renglón hay que leerlo'
              : `los demás estatus. Para buscar entre los otros, pide «estatus» con ${ESTATUS_VALIDOS.filter(
                  (e) => e !== cual
                ).join(', ')}`,
          agregadosDelFiltro: agregados,
          agregadosDelFiltroQueCuenta:
            `servicios, guardias e importe mensual de factura sumados en SQL sobre TODOS los que casan con ` +
            `el filtro (${entreQuienes}), no sobre los renglones que viajan; es el renglón que pinta arriba ` +
            'la pantalla de Estado de fuerza con ese mismo filtro',
          ...conSuTotal(
            'servicios',
            filas,
            (s) => ({
              // `estatus` viaja en cada renglón desde que la búsqueda puede mirar
              // a los no activos: sin él, un suspendido y uno en la calle se leen
              // igual, y el suspendido trae importes de un contrato en pausa.
              ...recorte(s, [
                'id',
                'servicio',
                'razon_social',
                'estatus',
                'zona',
                'asesor',
                'total_guardias',
                'modalidad',
              ]),
              // El enlace lo arma el servidor con el id. Nunca con texto de la base.
              enlace: `/estado-fuerza/${s.id}`,
            }),
            `${entreQuienes} que casan con el texto buscado`
          ),
        },
        // La etiqueta de la ficha la escribe el servidor y NO lleva el texto de
        // búsqueda. Ese texto lo elige el servicio externo, y el recuadro «De
        // dónde salió esto» es justo lo que el modelo no puede escribir: es la
        // prueba de que el número es real. Con el texto dentro, a ventas le podía
        // quedar una ficha que dijera «Servicios que casan con «Cartera vencida
        // de toda la empresa»: 0», con la hora y el enlace al lado, y en el
        // recuadro el hecho y la prosa se leen igual.
        /**
         * La etiqueta deja de decir «activos», porque ya no siempre lo son.
         *
         * Se escribe entera aquí, en las dos ramas y no con el estatus
         * interpolado desde una variable: lo que va dentro del recuadro «De dónde
         * salió esto» lo comprueba el guardián LEYENDO la llamada, y con el texto
         * compuesto más arriba la revisión pasaría sin que nadie pueda ver qué se
         * metió ahí. Y sigue sin llevar el texto buscado, que lo elige el servicio
         * externo.
         */
        ficha:
          cual === 'TODOS'
            ? ficha(
                'Estado de fuerza',
                '/estado-fuerza',
                'Servicios de cualquier estatus que casan con la búsqueda',
                filas.length
              )
            : ficha(
                'Estado de fuerza',
                '/estado-fuerza',
                `Servicios con estatus ${cual} que casan con la búsqueda`,
                filas.length
              ),
      };
    },
  },

  {
    nombre: 'ficha_de_servicio',
    permiso: 'ver',
    pantalla: 'Ficha del servicio',
    enlace: '/estado-fuerza',
    descripcion:
      'Un servicio a fondo, como lo pinta su ficha: plantilla, turnos, zona, asesor, contrato, ' +
      'importe de factura, su cobranza y su historia de precios. El precio por guardia solo viene si ' +
      'quien pregunta entra a la pantalla «Precios», que es donde ese dato se lee con su nombre. ' +
      'Necesita el id, que lo da «buscar_servicio».',
    esquema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'El id del servicio, de «buscar_servicio».' } },
      required: ['id'],
      additionalProperties: false,
    },
    ejecutar({ id }) {
      const s = obtenerServicio(Number(id));
      if (!s) {
        return {
          datos: { encontrado: false, nota: 'No hay un servicio con ese id.' },
          ficha: ficha('Estado de fuerza', '/estado-fuerza', 'Servicio con id pedido', 'no existe'),
        };
      }
      const cobranza = resumenDe(s.id);
      const precios = historialDe(s.id);
      return {
        datos: {
          encontrado: true,
          ...recorte(s, [
            'id',
            'servicio',
            'razon_social',
            'estatus',
            'zona',
            'asesor',
            'supervisor',
            'gerente',
            'direccion',
            'total_guardias',
            'modalidad',
            'fecha_alta',
            'fecha_fin_prevista',
            'tiene_contrato',
            'fecha_vencimiento_contrato',
            'importe_factura',
            'precio_guardia',
            'esquema_facturacion',
            'dias_credito',
            'observaciones',
            'comentarios_contrato',
            'condiciones_comerciales',
            'status_cobranza',
          ]),
          turnos: s.turnos,
          cobranzaDelServicio: cobranza,
          ...conSuTotal(
            'historiaDePrecios',
            precios,
            (h) =>
              recorte(h, [
                'tipo',
                'porcentaje',
                'vigente_desde',
                'importe_anterior',
                'importe_nuevo',
                'precio_anterior',
                'precio_nuevo',
                'motivo',
              ]),
            'cambios de precio registrados de este servicio'
          ),
          enlace: `/estado-fuerza/${s.id}`,
        },
        // El nombre del servicio NO entra en la etiqueta de la ficha, y el id sí:
        // el nombre lo teclea el equipo y el recuadro «De dónde salió esto» es lo
        // que escribe el servidor y nadie más. El id es un entero de la base y el
        // enlace de al lado lleva a la ficha, donde el nombre se lee en su sitio.
        ficha: ficha(
          'Ficha del servicio',
          `/estado-fuerza/${s.id}`,
          `Guardias del servicio ${s.id}`,
          s.total_guardias
        ),
      };
    },
  },

  {
    nombre: 'movimientos',
    permiso: 'ver',
    pantalla: 'Aperturas y Cancelaciones',
    enlace: '/aperturas',
    descripcion:
      'Las altas y las bajas de un periodo: cuántos movimientos, cuántos guardias entraron y salieron, ' +
      'el neto, los motivos de las cancelaciones y cuántas aperturas quedan sin aplicar. ' +
      'El periodo puede ser UN MES («periodo») o UN RANGO DE MESES («desde» y «hasta», o ' +
      '«todoElHistorico»), y en el rango las cifras vienen ya sumadas por la base de datos: ' +
      'úsala así para «este año», «los últimos seis meses», «de enero a junio» y «desde que arrancamos», ' +
      'en vez de pedir mes por mes y sumar. Sirve para «qué entró», «qué se fue» y «cuánto crecimos».',
    esquema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'Un mes solo, como AAAA-MM. Si no se pide rango ni mes, el mes vigente.' },
        desde: {
          type: 'string',
          description:
            'Primer mes del rango, como AAAA-MM. Con «desde» o «hasta» la respuesta cubre todo el rango ' +
            'y no un mes. Si se omite, arranca en el primer mes con movimientos.',
        },
        hasta: {
          type: 'string',
          description: 'Último mes del rango, como AAAA-MM. Si se omite, cierra en el último mes con movimientos.',
        },
        todoElHistorico: {
          type: 'boolean',
          description:
            'true para «desde que arrancamos»: del primer al último mes con movimientos que haya en la base.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ periodo, desde, hasta, todoElHistorico }) {
      const cubre = periodoCubierto({ periodo, desde, hasta, todoElHistorico });
      const hay = rangoConMovimientos();
      /**
       * La suma la hace la base, en una consulta por concepto.
       *
       * `netoDelRango` cuenta TODO el periodo cubierto —un mes o cuatro años— con
       * un COUNT y un SUM; las listas salen de `movimientosDe`, que es la consulta
       * de la pantalla y trae su propio tope de renglones. Son dos preguntas
       * distintas y el conteo bueno es el primero: contar los renglones de una
       * lista topada da de menos sin avisar, que es exactamente el error que este
       * proyecto lleva cerrando y el que hizo falta cerrar aquí. Sumar doce meses
       * fuera de la base —sea en JavaScript o de cabeza— es la otra forma de lo
       * mismo, y es la que trajo este encargo.
       */
      const neto = netoDelRango(cubre.desde, cubre.hasta);
      const mesAMes = movimientosMesAMes(cubre.desde, cubre.hasta);
      if (neto.alta.movimientos + neto.baja.movimientos === 0) {
        cubre.avisos.push(
          hay.primero
            ? `No hubo ningún movimiento en el periodo cubierto; los que hay van de ${hay.primero} a ${hay.ultimo}.`
            : 'No hubo ningún movimiento en el periodo cubierto.'
        );
      }
      const altas = movimientosDe('aperturas', '', { desdePeriodo: cubre.desde, hastaPeriodo: cubre.hasta })
        .movimientos;
      const bajas = movimientosDe('cancelaciones', '', { desdePeriodo: cubre.desde, hastaPeriodo: cubre.hasta })
        .movimientos;
      // Las pendientes se cuentan con su propia consulta y NO contando los
      // renglones de una lista: `movimientosDe` topa en 400 y un conteo sobre
      // una lista topada da de menos sin que nada avise. Esta además parte el
      // aviso en recientes y arrastre, que es como lo enseña la pantalla.
      const sinAplicar = pendientesPorAntiguedad();
      /**
       * Los motivos de baja: los diez con más guardias, y cuántos hay.
       *
       * La lista de diez es la que enseña la pantalla y se conserva con su forma.
       * Lo que faltaba es el segundo número: en la base hay más motivos que diez,
       * el `total` que viaja dentro es el de las cancelaciones —otra cosa— y los
       * diez renglones no suman ese total. A un modelo al que le pidan «los
       * motivos» eso le hace contestar diez de los que hay sin saberlo.
       */
      const motivos = motivosCancelacion(TOPE_MOTIVOS);
      const motivosQueHay = motivosCancelacion(SIN_RECORTE).motivos.length;
      /**
       * Los motivos DEL PERIODO PEDIDO, que es lo que faltaba (C3).
       *
       * El defecto medido: la lista de siempre es de todos los tiempos, y viajaba
       * dentro de una respuesta rotulada con el periodo. El motivo histórico
       * número uno —«Reducción de servicios por asignación en licitación», 151
       * guardias— no tiene ni un movimiento en 2026, así que «¿por qué nos
       * cancelaron este año?» se contestaba con el motivo de otro año.
       *
       * Se piden TODOS y recorta el sitio único, como toda lista que sale.
       */
      const motivosDelRango = motivosCancelacion(SIN_RECORTE, { desde: cubre.desde, hasta: cubre.hasta });
      /**
       * El desglose por zona y por asesor del rango (F1).
       *
       * La suma la hace SQL sobre el conjunto completo, y por eso cuadra contra
       * `altas`/`bajas` de arriba hasta el último guardia: comparten el corte del
       * mes y el filtro de la carga inicial.
       */
      const porZona = movimientosAgrupados(cubre.desde, cubre.hasta, 'zona');
      const porAsesor = movimientosAgrupados(cubre.desde, cubre.hasta, 'asesor');
      return {
        datos: {
          /**
           * Qué periodo cubrió DE VERDAD, antes que ninguna cifra.
           *
           * Va siempre, también cuando se pidió un mes solo, porque «este año» y
           * «desde que arrancamos» se contestan con esta misma herramienta y sin
           * esto las dos respuestas se leerían igual. `periodo` se queda para el
           * caso de un mes —es como lo pinta la pantalla— y va en nulo cuando el
           * periodo abarca varios: un rango no tiene «el mes», y dejar ahí uno de
           * los dos extremos invitaría a citarlo como si fuera todo.
           */
          periodo: cubre.esUnMes ? cubre.desde : null,
          desde: cubre.desde,
          hasta: cubre.hasta,
          mesesCubiertos: cubre.meses,
          // Los extremos de lo que hay en la base, para que «desde que
          // arrancamos» se pueda reconocer como tal y para que un periodo vacío
          // se pueda explicar en vez de dejarlo en cero y ya.
          hayMovimientosDesde: hay.primero,
          hayMovimientosHasta: hay.ultimo,
          // Un solo texto y no una lista: una lista aquí tendría que viajar con
          // su total, y esto no es una lista de nada, es lo que hay que aclarar.
          avisoDelPeriodo: cubre.avisos.length ? cubre.avisos.join(' ') : null,
          altas: { movimientos: neto.alta.movimientos, guardias: neto.alta.guardias },
          bajas: { movimientos: neto.baja.movimientos, guardias: neto.baja.guardias },
          netoDeGuardias: neto.neto,
          altasContraBajasQueCuenta:
            'altas, bajas y neto de TODO el periodo cubierto, sumados por la base de datos en una consulta ' +
            'por concepto; no hay que sumar ningún renglón para obtenerlos',
          ...conSuTotal(
            'porMesDelPeriodo',
            mesAMes,
            /**
             * Por `recorte` como las otras once listas, y no la fila cruda.
             *
             * Era el único hueco de la regla «todo lo que teclea el equipo va
             * saneado». Hoy esta consulta solo devuelve el mes y seis conteos, así
             * que no viaja texto de nadie y no había nada que colar: no era un
             * agujero, era el sitio por donde el siguiente agujero iba a entrar
             * sin que nada avisara, porque una columna nueva en esa consulta
             * habría salido sin pasar por aquí. Con las llaves escritas, además,
             * una columna nueva se tiene que declarar para viajar.
             */
            (m) =>
              recorte(m, [
                'periodo',
                'movimientosDeAlta',
                'guardiasQueEntraron',
                'movimientosDeBaja',
                'guardiasQueSalieron',
                'neto',
              ]),
            'meses con movimientos dentro del periodo cubierto, del más nuevo al más viejo; es el desglose, ' +
              'y el total del periodo ya viene sumado en «altas», «bajas» y «netoDeGuardias»'
          ),
          aperturasSinAplicar: sinAplicar,
          /**
           * Que las pendientes son de HOY y no del periodo (C2).
           *
           * Es la misma familia que el defecto de los motivos y el de cobranza:
           * una cifra de otro alcance viajando bajo una etiqueta de periodo. Las
           * aperturas sin aplicar son las que están pendientes ahora mismo, vengan
           * del mes que vengan, y un «¿cuántas quedaron sin aplicar en marzo?» se
           * contestaba con las 219 de todos los tiempos.
           */
          aperturasSinAplicarQueCuenta:
            'aperturas que siguen pendientes de aplicar HOY, de cualquier periodo; NO son las del periodo ' +
            `pedido (${cubre.desde} a ${cubre.hasta}), y la partición es entre las recientes y el arrastre ` +
            'de la importación, como la enseña la pantalla',
          motivosDeBaja: {
            ...motivos,
            ...elTotalAparte('motivos', {
              total: motivosQueHay,
              mostrados: motivos.motivos.length,
              queCuenta: 'motivos de baja distintos que hay en la base, contando cada texto una vez',
            }),
          },
          /**
           * La etiqueta del histórico va FUERA de `motivosDeBaja` a propósito.
           *
           * Esa lista conserva exactamente la forma que le da el Tablero —una
           * prueba vigente la mide renglón por renglón— así que no se le mete
           * nada dentro. Lo que se le pone es un rótulo al lado, que es lo que
           * faltaba para poder tener las dos listas en la misma respuesta sin
           * que el modelo elija a ciegas.
           */
          motivosDeBajaQueCuenta:
            'los motivos con más guardias de TODA la base y de todos los tiempos, que es lo que pinta el ' +
            'Tablero; NO son del periodo pedido. Para el periodo va «motivosDelPeriodo»',
          ...conSuTotal(
            'motivosDelPeriodo',
            motivosDelRango.motivos,
            (m) => recorte(m, ['motivo', 'movimientos', 'guardias']),
            `motivos de las bajas del periodo ${cubre.desde} a ${cubre.hasta}, del que más guardias se llevó ` +
              'al que menos; sus guardias suman las bajas del periodo salvo las bajas sin motivo capturado'
          ),
          // Cuántas bajas del periodo no traen motivo. Sin esto, la lista de
          // motivos parece cubrir todas las bajas y no las cubre: el motivo lo
          // trae el archivo de Cancelaciones y buena parte de los movimientos no
          // lo tiene, así que la diferencia tiene nombre en vez de ser un hueco.
          bajasDelPeriodoSinMotivo: motivosDelRango.sin_motivo,
          ...conSuTotal(
            'porZonaDelPeriodo',
            porZona,
            (z) => recorte(z, ['clave', 'altasMovimientos', 'altasGuardias', 'bajasMovimientos', 'bajasGuardias', 'neto']),
            `zonas con movimientos en el periodo ${cubre.desde} a ${cubre.hasta}, de la que más guardias ` +
              'perdió a la que menos; sumadas por la base y cuadran con «altas» y «bajas» de arriba'
          ),
          /**
           * Qué asesor cuenta aquí va DENTRO de su «qué cuenta», no en una clave
           * al lado.
           *
           * Este desglose cuenta EL ASESOR ANOTADO EN EL MOVIMIENTO —es por el que
           * filtra la pantalla de Aperturas—. «Quién atiende más» es otra pregunta
           * y vive en `resumen_operacion` con otro nombre (`porAsesor`), porque
           * mira el reparto de asesores del servicio vivo. Un servicio que lleven
           * dos asesores separa las dos cifras, y un modelo con las dos delante y
           * sin etiqueta elige la que suena mejor.
           *
           * Va dentro del texto de `conSuTotal` porque esa clave ya se llama
           * `porAsesorDelPeriodoQueCuenta`: escribirla aparte la habría sobrescrito
           * y se habría perdido el aviso de cuántos renglones de cuántos viajan.
           */
          ...conSuTotal(
            'porAsesorDelPeriodo',
            porAsesor,
            (a) => recorte(a, ['clave', 'altasMovimientos', 'altasGuardias', 'bajasMovimientos', 'bajasGuardias', 'neto']),
            `asesores con movimientos en el periodo ${cubre.desde} a ${cubre.hasta}, del que más guardias ` +
              'perdió al que menos; sumados por la base y cuadran con «altas» y «bajas» de arriba. Cuenta el ' +
              'asesor anotado en el movimiento: un servicio que lleven dos asesores cuenta por el que quedó ' +
              'en el renglón. Es «quién abrió y quién perdió», no «quién atiende más» —eso es «porAsesor» de ' +
              'resumen_operacion—'
          ),
          // El total de estas dos NO se cuenta sobre la lista: sale de
          // `netoDelRango`, que cuenta todo el periodo cubierto. `movimientosDe`
          // trae su propio límite por dentro, así que contar sus renglones daría
          // de menos sin que nada avisara, que es el defecto que esto cierra. Con
          // un rango de varios años la diferencia deja de ser un detalle: son
          // veinticinco renglones de quinientos.
          ...conSuTotal(
            'ultimasAltas',
            altas,
            (a) => recorte(a, ['folio', 'servicio', 'zona', 'guardias', 'fecha', 'tipo']),
            `movimientos de alta del periodo ${cubre.desde} a ${cubre.hasta}`,
            { total: neto.alta.movimientos }
          ),
          ...conSuTotal(
            'ultimasBajas',
            bajas,
            (c) => recorte(c, ['folio', 'servicio', 'zona', 'guardias', 'fecha', 'motivo']),
            `movimientos de baja del periodo ${cubre.desde} a ${cubre.hasta}`,
            { total: neto.baja.movimientos }
          ),
        },
        /**
         * Dos fichas escritas aparte, y no una con el periodo armado en una
         * variable.
         *
         * Lo que va dentro del recuadro «De dónde salió esto» lo escribe este
         * archivo, y el guardián lo comprueba LEYENDO la llamada: con el texto
         * compuesto en una variable de más arriba, la llamada pasaría la revisión
         * sin que nadie pueda ver qué se metió ahí. Así que el periodo se
         * interpola donde se lee, aunque cueste decir la frase dos veces: un mes
         * se dice «en 2026-10» y un rango «de 2026-01 a 2026-10», porque «de
         * 2026-10 a 2026-10» delante de una persona se lee como un error.
         */
        ficha: cubre.esUnMes
          ? ficha(
              'Aperturas y Cancelaciones',
              '/aperturas',
              `Guardias que entraron y salieron en ${cubre.desde}`,
              `+${neto.alta.guardias} / −${neto.baja.guardias}`
            )
          : ficha(
              'Aperturas y Cancelaciones',
              '/aperturas',
              `Guardias que entraron y salieron de ${cubre.desde} a ${cubre.hasta}`,
              `+${neto.alta.guardias} / −${neto.baja.guardias}`
            ),
      };
    },
  },

  {
    nombre: 'estado_de_un_dia',
    permiso: 'ver',
    pantalla: 'Estado de fuerza al día',
    enlace: '/estado-fuerza',
    descripcion:
      'Cómo amaneció la operación una fecha concreta: cuántos servicios y guardias había, y qué ' +
      'entró y salió ese día. Dice también hasta dónde llega la reconstrucción: si la fecha queda ' +
      'fuera de alcance, el total sale corto y hay que decirlo.',
    esquema: {
      type: 'object',
      properties: { dia: { type: 'string', description: 'La fecha, como AAAA-MM-DD.' } },
      required: ['dia'],
      additionalProperties: false,
    },
    ejecutar({ dia }) {
      const fecha = comoDia(dia);
      if (!fecha) {
        return {
          datos: { entendido: false, nota: 'La fecha no se entiende. Va como AAAA-MM-DD.' },
          ficha: ficha('Estado de fuerza al día', '/estado-fuerza', 'Fecha pedida', 'no se entiende'),
        };
      }
      const { servicios, exactitud, fueraDeAlcance, limite } = estadoAlDia(fecha);
      const guardias = servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);
      // Una sola lectura de los movimientos del día, no dos: lo que entró y lo
      // que salió son dos listas de la MISMA consulta, y pedirla dos veces abre
      // la puerta a que las dos cifras salgan de dos lecturas distintas.
      const delDia = movimientosDelDia(fecha);
      return {
        datos: {
          entendido: true,
          dia: fecha,
          // Estos dos se llaman así y no «servicios» y «guardias» a secas porque
          // son el estado de fuerza DE ESA FECHA —otra pregunta— y uno de ellos
          // puede coincidir por casualidad con el número de altas del día. Una
          // coincidencia así es exactamente cómo un dato equivocado pasa por
          // bueno: el modelo cita el número correcto por accidente, y el día que
          // la coincidencia se rompa nadie se entera.
          serviciosEnLaCalleEseDia: servicios.length,
          guardiasEnLaCalleEseDia: guardias,
          // Va siempre, con o sin problema: quien pregunte por una fecha vieja
          // tiene el mismo derecho a saber que el número se queda corto.
          fueraDeAlcance,
          hastaDondeEsDeFiar: limite,
          /**
           * La palabra de exactitud depende de la fecha, y antes no dependía.
           *
           * `estadoAlDia()` declara `conjunto: 'exacto'` queriendo decir que el
           * conjunto de servicios sale de las FECHAS de cada uno y no de una
           * estimación. Eso es verdad del método y no del resultado: antes del
           * corte más antiguo faltan los servicios que ya estaban cancelados
           * cuando se cargó la hoja, así que las fechas que quedan no describen
           * ese día completo —es justo lo que dice `fueraDeAlcance`—.
           *
           * Medido: `dia: '2023-01-15'` contestaba 1 servicio y 1 guardia de los
           * 217 y 880 que hay, con `fueraDeAlcance: true` y, en el mismo
           * resultado, `exactitud.conjunto: 'exacto'`. Dos etiquetas que se
           * contradicen y el modelo eligiendo: «exacto» gana. En la pantalla eso
           * no pasa porque arriba del número hay una caja ámbar que manda al corte
           * de ese mes; aquí no hay caja, así que la palabra tiene que decirlo.
           *
           * Se compone aquí y no en `lib/dias.js` porque ahí `conjunto` es lo que
           * lee la pantalla por la API y describe el método; lo que esta consulta
           * manda al modelo es una etiqueta sobre la cifra que acompaña, que es
           * otra cosa. Ninguna pantalla pinta esta palabra.
           */
          exactitud: {
            ...exactitud,
            conjunto: fueraDeAlcance
              ? 'corto: la reconstrucción de ese día no incluye los servicios que ya estaban cancelados ' +
                'antes del corte guardado más antiguo, así que el conjunto se queda corto'
              : 'exacto',
          },
          ...conSuTotal(
            'entraronEseDia',
            delDia.entraron,
            (m) => recorte(m, ['folio', 'tipo', 'servicio', 'zona', 'guardias']),
            `movimientos de alta del día ${fecha}`
          ),
          ...conSuTotal(
            'salieronEseDia',
            delDia.salieron,
            (m) => recorte(m, ['folio', 'tipo', 'servicio', 'zona', 'guardias', 'motivo']),
            `movimientos de baja del día ${fecha}`
          ),
        },
        /**
         * Y la ficha, que es lo único del canal que el modelo no puede escribir,
         * dice cuándo la cifra que avala se queda corta.
         *
         * El recuadro «De dónde salió esto» existe para ser la prueba de que el
         * número es real. Dejaba «Guardias el 2023-01-15: 1» sin una palabra, y
         * entonces el recuadro avalaba precisamente la cifra que el propio
         * resultado declaraba incompleta: el único sitio del canal que no se
         * puede falsear quedaba respaldando lo que no debía.
         *
         * Son dos llamadas y no un ternario dentro de la etiqueta porque la
         * etiqueta de una ficha la escribe este archivo entera, y el guardián de
         * `tests/chat-listas-con-total.test.mjs` solo admite dentro de ella un
         * valor que el servidor ya validó —una fecha o un id—, nunca una
         * expresión.
         */
        ficha: fueraDeAlcance
          ? ficha(
              'Estado de fuerza al día',
              `/estado-fuerza?dia=${fecha}`,
              `Guardias el ${fecha} por una reconstrucción que se queda corta; el corte de fiar más antiguo es ${limite}`,
              guardias
            )
          : ficha('Estado de fuerza al día', `/estado-fuerza?dia=${fecha}`, `Guardias el ${fecha}`, guardias),
      };
    },
  },

  {
    nombre: 'contratos',
    permiso: 'ver',
    pantalla: 'Jurídico',
    enlace: '/juridico',
    descripcion:
      'El estado de los contratos: cuántos servicios están sin contrato, vencidos, por vencer y ' +
      'vigentes, con sus guardias y su monto, y la lista de los que hay que atender. ' +
      'Esta pantalla la ve todo el mundo.',
    esquema: {
      type: 'object',
      properties: {
        estado: {
          type: 'string',
          description: 'Un estado concreto para filtrar la lista, si la pregunta lo pide. Opcional.',
        },
        mesesDeHorizonte: {
          type: 'integer',
          description:
            'A cuántos MESES vista mirar los vencimientos, de 1 a 36. Úsalo para «¿qué vence el año que ' +
            'viene?» o «en el siguiente semestre». Si se omite, los próximos 90 días, que es lo que pinta ' +
            'el Tablero.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ estado, mesesDeHorizonte }) {
      const kpis = kpisJuridico();
      const cartera = carteraJuridica({ estado: estado || '' });
      const filas = cartera.filas;
      /**
       * El horizonte en meses (F4).
       *
       * Para quién: jurídico, cuya guía dice que el valor de su pantalla es «saber
       * con meses de anticipación». La pantalla enseña el calendario entero de
       * vencimientos y el asistente solo veía noventa días, así que de los 89
       * contratos que vencen en 2026 y los 77 de 2027 no podía decir ni cuántos
       * son.
       *
       * Lo que llega de fuera se acota a un entero de 1 a 36 antes de usarlo, y lo
       * que no se entiende se trata como «no pidieron nada»: entonces son los
       * mismos 90 días de siempre, que es la cifra que pinta el Tablero y la que
       * el asistente ya contestaba. Tres meses de calendario NO son 90 días —se
       * midió: hoy se diferencian en dos contratos— así que por omisión no se
       * cambia de unidad a cambio de nada.
       */
      const pidieron = Number.isInteger(mesesDeHorizonte) && mesesDeHorizonte >= 1 && mesesDeHorizonte <= 36;
      const agenda = contratosPorVencerEnMeses(pidieron ? mesesDeHorizonte : undefined);
      const renglon = (s) =>
        recorte(s, ['id', 'servicio', 'zona', 'fecha_vencimiento_contrato', 'total_guardias']);
      return {
        datos: {
          /**
           * Hay DOS cuentas de «vencido» en este resultado y no son la misma, así
           * que cada una dice qué cuenta.
           *
           * `porEstado.VENCIDO` cuenta el estado del contrato de cada servicio
           * vivo, como lo clasifica la pantalla de Jurídico. `yaVencidosTotal`
           * cuenta los de la agenda de vencimientos —los que tienen fecha de
           * vencimiento y ya pasó—, que es la cifra que pinta el Tablero. Son dos
           * preguntas parecidas con dos respuestas distintas, y un modelo con los
           * dos números delante y sin etiqueta elige el que suena mejor.
           */
          porEstado: kpis.por,
          porEstadoQueCuenta:
            'servicios vivos por el estado de su contrato (sin contrato, vencido, por vencer, vigente), ' +
            'como los clasifica la pantalla de Jurídico',
          /**
           * `total` y `subtotalDeLaLista` son dos objetos de tres cifras casi
           * iguales en el mismo resultado, y ninguno decía qué contaba.
           *
           * Sin filtro de estado son la misma cantidad por dos caminos, y con
           * filtro no: uno es la cartera entera y el otro lo filtrado. Un modelo
           * con los dos delante y sin etiqueta elige el que suena mejor, y es la
           * misma trampa que los dos «vencidos» de más abajo. Los pesos van
           * redondeados a centavos en `lib/juridico.js` para que, cuando sí sean
           * la misma cantidad, sean el mismo número.
           */
          total: kpis.total,
          totalQueCuenta:
            'servicios, guardias y pesos al mes de TODA la cartera de Jurídico —los servicios vivos—, sin ' +
            'ningún filtro; no depende del horizonte ni del filtro de estado',
          hayQueAtender: kpis.urgente,
          expedienteDigital: kpis.expediente,
          ...conSuTotal(
            'yaVencidos',
            agenda.vencidos,
            renglon,
            'servicios con contrato cuya fecha de vencimiento ya pasó, que es la cifra del Tablero'
          ),
          /**
           * La clave se llama por el horizonte y no «vencenEn90Dias», y el
           * renombre es deliberado.
           *
           * `vencenEn90Dias` con un horizonte de veinticuatro meses sería una
           * etiqueta que miente, y es exactamente la clase de mentira que esta
           * vuelta viene a quitar. Se comprobó antes de renombrar que el prefijo
           * del modelo y las guías no nombran esta clave: la única mención a «90
           * días» que hay en el repositorio está en la guía de jurídico y describe
           * una columna de SU PANTALLA, que no se toca.
           */
          ...conSuTotal(
            'vencenEnElHorizonte',
            agenda.porVencer,
            renglon,
            agenda.horizonteMeses === null
              ? 'servicios con contrato que vence dentro de los próximos 90 días, que es el horizonte de ' +
                `siempre y lo que pinta el Tablero; el corte cae en ${agenda.hasta}`
              : `servicios con contrato que vence dentro de los próximos ${agenda.horizonteMeses} meses; ` +
                `el corte cae en ${agenda.hasta}`
          ),
          // Nulo cuando nadie pidió meses: el horizonte son los 90 días de
          // siempre, y escribir «3» aquí sería redondear el calendario en una
          // etiqueta. `horizonteHasta` dice la fecha exacta en los dos casos, que
          // es lo que no se puede malinterpretar.
          horizonteMeses: agenda.horizonteMeses,
          horizonteHasta: agenda.hasta,
          horizonteQueCuenta:
            agenda.horizonteMeses === null
              ? 'no se pidió horizonte, así que se miraron los próximos 90 días contados desde hoy, que es ' +
                'lo que pinta el Tablero. Para mirar más lejos, pide «mesesDeHorizonte» de 1 a 36'
              : 'se miraron los vencimientos desde hoy hasta «horizonteHasta», que son los meses que se ' +
                'pidieron contados en el calendario. «yaVencidos» no depende del horizonte: ya pasaron',
          subtotalDeLaLista: cartera.subtotal,
          subtotalDeLaListaQueCuenta: estado
            ? 'servicios, guardias y pesos al mes de los servicios que casan con el filtro de estado que se ' +
              'pidió, sumados sobre el conjunto completo y no sobre los renglones que viajan en «lista»'
            : 'servicios, guardias y pesos al mes de los servicios que casan con el filtro, que sin filtro ' +
              'son los mismos de «total»; sumados sobre el conjunto completo y no sobre los renglones que ' +
              'viajan en «lista»',
          ...conSuTotal(
            'lista',
            filas,
            (s) => ({
              ...recorte(s, ['id', 'servicio', 'razon_social', 'zona', 'total_guardias']),
              estado: saneado(s.contrato?.clave),
              enlace: `/estado-fuerza/${s.id}`,
            }),
            estado
              ? 'servicios vivos con el estado de contrato que se pidió en el filtro'
              : 'servicios vivos de la cartera de Jurídico, con cualquier estado de contrato'
          ),
        },
        ficha: ficha(
          'Jurídico',
          '/juridico',
          'Servicios sin contrato o vencido',
          kpis.urgente.servicios
        ),
      };
    },
  },

  {
    /**
     * La única de las siete que NO es de todos.
     *
     * Hereda `editar_finanzas` porque ese es el permiso con el que se entra a la
     * pantalla de Cobranza, y nada más. A espectador, jurídico, operaciones y
     * ventas no se les ofrece, y si el servicio externo la pide de todas formas
     * `ejecutar()` la rechaza antes de leer una sola fila.
     */
    nombre: 'cobranza',
    permiso: 'editar_finanzas',
    pantalla: 'Cobranza',
    enlace: '/cobranza',
    descripcion:
      'La cobranza: lo emitido y lo cobrado DEL MES que se pida («delPeriodo») y, aparte, lo de TODA LA ' +
      'CARTERA sin importar el periodo («deTodaLaCartera»: cartera vencida, por vencer, lo que deben). ' +
      'Para «¿cuánto facturamos en tal mes?» va «delPeriodo»; para «¿cuánto nos deben?» va ' +
      '«deTodaLaCartera». Trae también qué falta por facturar del mes y las facturas vencidas. ' +
      'Es la pantalla de Cobranza y solo la ven el administrador y finanzas.',
    esquema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'El mes a conciliar, como AAAA-MM. Si se omite, el vigente.' },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ periodo }) {
      const pedido = periodoPedido(periodo);
      const mes = pedido.mes;
      /**
       * Dos lecturas y no una, porque son DOS preguntas, y el defecto era
       * contestar la segunda con la etiqueta de la primera.
       *
       * Esto estaba así en producción y es lo peor que encontró esta vuelta,
       * porque toca dinero: el resultado traía `periodo: "2026-10"` arriba y,
       * debajo, lo emitido y lo cobrado de TODO el libro de facturas, porque
       * `kpisCobranza()` no recibía periodo y no podía filtrar. «¿Cuánto
       * facturamos en octubre?» se contestaba con el acumulado histórico
       * rotulado octubre. Nadie verifica una cifra que viene con su mes puesto:
       * se cita en una junta.
       *
       * Las dos se quedan, cada una con su nombre, porque las dos se preguntan:
       * «¿cuánto facturamos este mes?» y «¿cuánto nos deben?», que es lo que la
       * pantalla de Cobranza pinta en la fila de arriba. Lo que no puede seguir
       * es que lleguen revueltas y sin etiqueta, con el modelo eligiendo.
       */
      const delMes = kpisCobranzaDe({ desde: mes, hasta: mes });
      const kpis = kpisCobranzaDe({});
      // Se piden TODAS y recorta el sitio único. Pedirlas ya recortadas dejaba al
      // total contando veinticinco de las que hay, o sea el mismo número corto de
      // antes pero ahora con cara de total, que es peor.
      const vencidas = facturasVencidas(SIN_RECORTE);
      const pendientes = pendientesDeFacturar(mes);
      return {
        datos: {
          periodo: mes,
          /**
           * Si el mes que se pidió no era un mes, la respuesta lo dice.
           *
           * Es el mismo aviso que ya daba `movimientos`, y hace falta aquí por lo
           * mismo: `periodo` es la etiqueta de todas las cifras de abajo y de la
           * ficha, así que un mes imposible puesto ahí convierte el recuadro que
           * avala las cifras en el aval de un periodo que no existe. Un solo texto
           * y no una lista: esto no es una lista de nada, es lo que hay que
           * aclarar.
           */
          avisoDelPeriodo: pedido.avisos.length ? pedido.avisos.join(' ') : null,
          /**
           * Lo del mes pedido, aparte y con su nombre.
           *
           * `facturas` es el conteo de facturas de ese periodo, no una lista, así
           * que no pasa por el sitio único: no hay renglones que recortar.
           */
          delPeriodo: { emitido: delMes.emitido, cobrado: delMes.cobrado, facturas: delMes.facturas },
          delPeriodoQueCuenta:
            `facturas no canceladas con periodo ${mes}; es lo que se emitió y lo que se cobró de ESE mes, ` +
            'y es la respuesta a «¿cuánto facturamos en ese mes?»',
          deTodaLaCartera: {
            emitido: kpis.emitido,
            cobrado: kpis.cobrado,
            carteraVencida: kpis.vencido,
            porVencer: kpis.porVencer,
            pendienteTotal: kpis.pendiente,
            facturasVencidas: kpis.facturasVencidas,
            serviciosConAdeudo: kpis.serviciosConAdeudo,
          },
          deTodaLaCarteraQueCuenta:
            'todo el libro de facturas sin importar el periodo, que es lo que pinta la fila de arriba de la ' +
            `pantalla de Cobranza y la respuesta a «¿cuánto nos deben?»; NO es del periodo ${mes}`,
          ...conSuTotal(
            'facturasVencidasDetalle',
            vencidas,
            (f) => recorte(f, ['folio', 'servicio', 'periodo', 'importe', 'saldo', 'fecha_vencimiento']),
            // Esta lista es el CUARTO sitio con el mismo defecto, y es el que no
            // venía señalado: son las facturas vencidas de todo el libro, de
            // cualquier periodo, viajando dentro de una respuesta rotulada con un
            // mes. Cada renglón trae su `periodo`, así que el defecto no era el
            // dato: era que el total de arriba se podía leer como «las vencidas de
            // ese mes». Dicho, se puede citar sin equivocarse.
            'facturas con saldo cuya fecha de vencimiento ya pasó, de TODO el libro y de cualquier periodo; ' +
              `NO son las del periodo ${mes}, y el periodo de cada una viaja en su renglón`
          ),
          ...conSuTotal(
            'faltaPorFacturar',
            pendientes.porFacturar,
            /**
             * Los campos que esta lista pinta EN SU PANTALLA, con los nombres que
             * el renglón trae de verdad.
             *
             * Aquí estaba el fallo silencioso: se pedían `id`, `total_guardias`,
             * `importe_factura` y `esquema_facturacion`, que son los nombres de
             * las COLUMNAS DEL SERVICIO, y estos renglones no son el servicio: son
             * la propuesta de factura que `pendientesDeFacturar()` arma para esa
             * pantalla, y sus campos se llaman `servicio_id`, `plantilla`,
             * `concepto`, `dias_credito` e `importe`. Los cuatro que no casaban
             * salían en nulo sin que nada avisara. Ahora `recorte` se cae si se
             * vuelve a pedir un campo que el renglón no tiene.
             *
             * El id se renombra a la vista, porque las otras once listas de las
             * siete mandan el id del servicio como `id` y es por ahí por donde el
             * modelo encadena a `ficha_de_servicio`.
             *
             * Lo demás se queda con el nombre del renglón, y no se renombra a
             * `importe_factura` ni a `total_guardias` a propósito: NO son esas
             * cifras. `importe` es lo que la pantalla pinta en la columna «Importe
             * propuesto» de ESA factura, y a un cliente al que se le cobra por sede
             * le toca una parte de su importe mensual; `plantilla` son los guardias
             * que se proponen para ESA factura. Ponerles el nombre de las columnas
             * del servicio sería mandar una fracción con el nombre del total, que es
             * la misma clase de etiqueta que miente. Lo que son lo dice el texto de
             * abajo, que viaja al lado.
             */
            (s) => ({
              id: saneado(s.servicio_id),
              ...recorte(s, ['servicio', 'concepto', 'plantilla', 'dias_credito', 'importe']),
            }),
            `servicios activos HOY que todavía no tienen factura del periodo ${mes}, que es el número que ` +
              'pinta la pantalla de Cobranza. La lista es la de los activos de hoy, no la de los que estaban ' +
              `activos en ${mes}: pedido un mes viejo, salen los de hoy que no tienen factura de ese mes. ` +
              'Cada renglón es UNA factura por registrar —un servicio que se ' +
              'cobra por sedes sale en varias—, «plantilla» son los guardias que propone y «importe» el ' +
              'importe propuesto de esa factura, no el importe mensual del servicio'
          ),
          // Esta cuenta OTRA cosa —servicios sin condiciones de cobro pactadas— y
          // hoy coincide por casualidad con el total de los pendientes. Al lado de
          // una lista corta, un número correcto de otro concepto invita a
          // mezclarlos, así que dice qué cuenta.
          sinCondicionesDeCobro: pendientes.sinCondiciones.length,
          sinCondicionesDeCobroQueCuenta:
            'servicios activos sin condiciones de cobro pactadas HOY, de cualquier periodo; no son los que ' +
            'faltan por facturar y no son del periodo pedido',
          yaFacturadosDelPeriodo: pendientes.facturados,
        },
        ficha: ficha('Cobranza', '/cobranza', 'Cartera vencida', kpis.vencido),
      };
    },
  },
];

/**
 * Las herramientas que ese rol puede usar, en el mismo orden fijo.
 *
 * Se deriva de `puede()`, que es el permiso de verdad de la plataforma. No hay
 * una lista de roles escrita aquí: el día que un rol gane o pierda un permiso en
 * `lib/rbac.js`, lo que el asistente le ofrece cambia con él.
 */
export function herramientasPara(rol) {
  return HERRAMIENTAS.filter((h) => puede(rol, h.permiso));
}

/** La forma que pide el servicio externo, con `strict` para que los argumentos lleguen válidos. */
export function definicionesPara(rol) {
  return herramientasPara(rol).map((h) => ({
    name: h.nombre,
    description: `${h.descripcion} Es el espejo de la pantalla «${h.pantalla}» (${h.enlace}).`,
    input_schema: h.esquema,
    strict: true,
  }));
}

/** La declarada con ese nombre, o nada. */
export function herramientaPorNombre(nombre) {
  return HERRAMIENTAS.find((h) => h.nombre === nombre) || null;
}

/**
 * La cerradura: ejecuta una herramienta comprobando otra vez el permiso.
 *
 * El nombre llega en la respuesta del servicio externo, o sea de fuera. Se
 * comprueban tres cosas antes de leer nada, y en este orden:
 *
 *   1. que la herramienta exista;
 *   2. que declare un permiso que de verdad existe en el RBAC —una herramienta
 *      con un permiso mal escrito no se ejecuta «por si acaso»: se rechaza,
 *      porque `puede(rol, 'editar_finanza')` sería falso para todos y el día que
 *      el error fuera al contrario abriría la pantalla a cualquiera;
 *   3. que el rol de la sesión tenga ese permiso.
 *
 * El mensaje del rechazo dice en qué pantalla se ve el dato, porque ese texto
 * acaba delante de la persona y «no tienes permiso» a secas no le dice a quién
 * pedirle.
 */
export function ejecutar(nombre, args, usuario) {
  const herramienta = herramientaPorNombre(nombre);
  if (!herramienta) {
    throw new FueraDeAlcance(`El asistente no tiene ninguna consulta llamada «${saneado(nombre)}».`);
  }
  if (!Object.hasOwn(PERMISOS, usuario?.rol || '')) {
    throw new FueraDeAlcance('La sesión no trae un rol conocido.');
  }
  const existeElPermiso = Object.values(PERMISOS).some((lista) => lista.includes(herramienta.permiso));
  if (!existeElPermiso) {
    throw new FueraDeAlcance(
      `La consulta «${herramienta.nombre}» declara un permiso que no existe en la plataforma.`
    );
  }
  if (!puede(usuario.rol, herramienta.permiso)) {
    throw new FueraDeAlcance(
      `Tu rol no entra a la pantalla «${herramienta.pantalla}», así que el asistente tampoco te puede ` +
        'contestar de ahí. Ese dato lo tienen el administrador y finanzas.'
    );
  }
  const resultado = herramienta.ejecutar(args || {}, usuario);

  /**
   * La cerradura, también campo por campo.
   *
   * Se filtra aquí y no dentro de cada herramienta por la misma razón por la que
   * el permiso se comprueba aquí: un sitio único que no se puede saltar. Si cada
   * consulta se acordara de filtrar lo suyo, la que se olvidara sería la que
   * nadie mira.
   */
  const vetados = camposVetados(usuario.rol);
  if (vetados.size === 0) return resultado;

  const quitados = new Set();
  const datos = sinCamposVetados(resultado.datos, vetados, quitados);
  return {
    ...resultado,
    datos: quitados.size
      ? {
          ...datos,
          // Se dice que falta algo, en vez de callarlo: así el asistente puede
          // contestar «ese dato se ve en esa pantalla y tu rol no entra», que es
          // lo que haría una persona, en vez de dar por hecho que no existe.
          noSaleTodo:
            'Hay campos de este resultado que no se entregan porque se leen con su nombre en una ' +
            'pantalla a la que tu rol no entra —el precio por guardia se lee en «Precios»—. Dilo así si ' +
            'viene al caso, y no lo estimes por otro camino.',
        }
      : datos,
  };
}

/**
 * Cómo viaja un resultado hacia el servicio externo.
 *
 * Va etiquetado con su fuente y su hora, y como JSON: así un campo de texto no
 * puede parecer un turno de conversación. Es parte del contrato y no estilo.
 */
export function serializar({ datos, ficha: f }) {
  return JSON.stringify({ fuente: f.pantalla, consultado: f.consultado, datos });
}
