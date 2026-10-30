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
import { marcaDeLaOficina, mesActual } from './fechas';
import { conSuTotal, elTotalAparte, SIN_RECORTE } from './chat-salida';
import {
  kpisEstadoFuerza,
  distribucionPorTurno,
  distribucionPorZona,
  distribucionPorModalidad,
  movimientosPorPeriodo,
  motivosCancelacion,
  contratosPorVencer,
  periodoVigente,
} from './queries';
import { listarServicios, obtenerServicio } from './servicios';
import { resumenDe, kpisCobranza, facturasVencidas, pendientesDeFacturar } from './facturacion';
import { historialDe } from './precios';
import {
  movimientosDe,
  netoDelRango,
  movimientosMesAMes,
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

/** Cuántos meses de histórico de movimientos viajan. */
const MESES_DE_HISTORIA = 12;

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

/** Un objeto con solo las llaves pedidas, con los textos ya saneados. */
function recorte(fila, llaves) {
  const out = {};
  for (const llave of llaves) out[llave] = saneado(fila?.[llave]);
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

/** Un periodo AAAA-MM, o el vigente si no vino o no se entiende. */
function periodoPedido(crudo) {
  const texto = String(crudo || '').trim();
  if (/^\d{4}-\d{2}$/.test(texto)) return texto;
  // Sin periodo válido se contesta el vigente, no un error: «¿cuántas altas
  // hubo?» sin mes es la pregunta normal, y el vigente es la respuesta normal.
  return periodoVigente() || mesActual();
}

/**
 * Un mes de los que existen: cuatro cifras de año y un mes del 01 al 12.
 *
 * Es más estricto que el del mes suelto de arriba a propósito. Un «2026-13» como
 * mes suelto se contesta con cero movimientos, que es la verdad de un mes que no
 * existe; como extremo de un rango no vale, porque con él la cuenta de cuántos
 * meses abarca el periodo saldría mal y la respuesta diría que cubrió trece meses
 * de un año. Lo que no se entiende se trata como extremo abierto y se dice.
 */
function mesValido(crudo) {
  const texto = String(crudo ?? '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(texto) ? texto : null;
}

/** Si vino algo escrito, sea entendible o no. */
function vinoAlgo(crudo) {
  return String(crudo ?? '').trim() !== '';
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
  const pidioRango = todoElHistorico === true || vinoAlgo(desde) || vinoAlgo(hasta);
  if (!pidioRango) {
    const mes = periodoPedido(periodo);
    return { desde: mes, hasta: mes, meses: 1, esUnMes: true, avisos };
  }

  const hay = rangoConMovimientos();
  const primero = mesValido(hay.primero) || mesActual();
  const ultimo = mesValido(hay.ultimo) || mesActual();
  if (!hay.primero) {
    avisos.push(
      'No hay ni un movimiento registrado en la plataforma, así que el periodo se quedó en el mes en curso.'
    );
  }

  let d = mesValido(desde);
  if (!d) {
    if (vinoAlgo(desde)) {
      avisos.push(`El mes de inicio no se entendió —va como AAAA-MM—, así que se arrancó en ${primero}.`);
    }
    d = primero;
  }
  let h = mesValido(hasta);
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
      'Devuelve el renglón de cada uno y su id. Úsala antes de «ficha_de_servicio» cuando quien ' +
      'pregunta nombra un cliente y no sabes su id.',
    esquema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre del servicio o de la razón social.' },
        zona: { type: 'string', description: 'Zona exacta, si la pregunta la nombra. Opcional.' },
      },
      required: ['texto'],
      additionalProperties: false,
    },
    ejecutar({ texto, zona }) {
      const filas = listarServicios({ estatus: 'ACTIVO', q: texto || '', zona: zona || '' });
      return {
        datos: {
          encontrados: filas.length,
          /**
           * Que la búsqueda solo miró a los que están en la calle.
           *
           * La pantalla arranca con este mismo filtro —hasta aquí es espejo— pero
           * la pantalla DEJA CAMBIARLO y el asistente no. Sin decirlo, un
           * «¿tenemos al cliente tal?» de un servicio en pausa se contesta «no
           * existe», y un «no» con cara de verdad cuesta lo mismo que una cifra
           * inventada y es más difícil de notar, porque nadie verifica un «no».
           * Dicho, el modelo puede matizar y mandar a la pantalla.
           */
          buscadoSoloEntre: 'servicios con estatus ACTIVO, los que están en la calle',
          sinBuscarEntre:
            'los suspendidos y los dados de baja; esos se ven en «Estado de fuerza» cambiando el filtro ' +
            'de estatus, que el asistente no puede cambiar',
          ...conSuTotal(
            'servicios',
            filas,
            (s) => ({
              ...recorte(s, ['id', 'servicio', 'razon_social', 'zona', 'asesor', 'total_guardias', 'modalidad']),
              // El enlace lo arma el servidor con el id. Nunca con texto de la base.
              enlace: `/estado-fuerza/${s.id}`,
            }),
            'servicios activos que casan con el texto buscado'
          ),
        },
        // La etiqueta de la ficha la escribe el servidor y NO lleva el texto de
        // búsqueda. Ese texto lo elige el servicio externo, y el recuadro «De
        // dónde salió esto» es justo lo que el modelo no puede escribir: es la
        // prueba de que el número es real. Con el texto dentro, a ventas le podía
        // quedar una ficha que dijera «Servicios que casan con «Cartera vencida
        // de toda la empresa»: 0», con la hora y el enlace al lado, y en el
        // recuadro el hecho y la prosa se leen igual.
        ficha: ficha(
          'Estado de fuerza',
          '/estado-fuerza',
          'Servicios activos que casan con la búsqueda',
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
      const historia = movimientosPorPeriodo(MESES_DE_HISTORIA);
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
            (m) => m,
            'meses con movimientos dentro del periodo cubierto, del más nuevo al más viejo; es el desglose, ' +
              'y el total del periodo ya viene sumado en «altas», «bajas» y «netoDeGuardias»'
          ),
          aperturasSinAplicar: sinAplicar,
          ...conSuTotal(
            'porPeriodo',
            historia,
            (p) => p,
            `meses con movimientos, del más viejo al más nuevo, de los últimos ${MESES_DE_HISTORIA} que se piden`
          ),
          motivosDeBaja: {
            ...motivos,
            ...elTotalAparte('motivos', {
              total: motivosQueHay,
              mostrados: motivos.motivos.length,
              queCuenta: 'motivos de baja distintos que hay en la base, contando cada texto una vez',
            }),
          },
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
          exactitud,
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
        ficha: ficha(
          'Estado de fuerza al día',
          `/estado-fuerza?dia=${fecha}`,
          `Guardias el ${fecha}`,
          guardias
        ),
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
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ estado }) {
      const kpis = kpisJuridico();
      const cartera = carteraJuridica({ estado: estado || '' });
      const filas = cartera.filas;
      const agenda = contratosPorVencer(90);
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
          total: kpis.total,
          hayQueAtender: kpis.urgente,
          expedienteDigital: kpis.expediente,
          ...conSuTotal(
            'yaVencidos',
            agenda.vencidos,
            renglon,
            'servicios con contrato cuya fecha de vencimiento ya pasó, que es la cifra del Tablero'
          ),
          ...conSuTotal(
            'vencenEn90Dias',
            agenda.porVencer,
            renglon,
            'servicios con contrato que vence dentro de los próximos 90 días'
          ),
          subtotalDeLaLista: cartera.subtotal,
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
      'La cobranza de toda la cartera: cartera vencida, por vencer, qué falta por facturar del mes y ' +
      'las facturas vencidas. Es la pantalla de Cobranza y solo la ven el administrador y finanzas.',
    esquema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'El mes a conciliar, como AAAA-MM. Si se omite, el vigente.' },
      },
      required: [],
      additionalProperties: false,
    },
    ejecutar({ periodo }) {
      const mes = periodoPedido(periodo);
      const kpis = kpisCobranza();
      // Se piden TODAS y recorta el sitio único. Pedirlas ya recortadas dejaba al
      // total contando veinticinco de las que hay, o sea el mismo número corto de
      // antes pero ahora con cara de total, que es peor.
      const vencidas = facturasVencidas(SIN_RECORTE);
      const pendientes = pendientesDeFacturar(mes);
      return {
        datos: {
          periodo: mes,
          emitido: kpis.emitido,
          cobrado: kpis.cobrado,
          carteraVencida: kpis.vencido,
          porVencer: kpis.porVencer,
          pendienteTotal: kpis.pendiente,
          facturasVencidas: kpis.facturasVencidas,
          serviciosConAdeudo: kpis.serviciosConAdeudo,
          ...conSuTotal(
            'facturasVencidasDetalle',
            vencidas,
            (f) => recorte(f, ['folio', 'servicio', 'periodo', 'importe', 'saldo', 'fecha_vencimiento']),
            'facturas con saldo cuya fecha de vencimiento ya pasó'
          ),
          ...conSuTotal(
            'faltaPorFacturar',
            pendientes.porFacturar,
            (s) => recorte(s, ['id', 'servicio', 'total_guardias', 'importe_factura', 'esquema_facturacion']),
            `servicios activos que todavía no tienen factura del periodo ${mes}, que es el número que ` +
              'pinta la pantalla de Cobranza'
          ),
          // Esta cuenta OTRA cosa —servicios sin condiciones de cobro pactadas— y
          // hoy coincide por casualidad con el total de los pendientes. Al lado de
          // una lista corta, un número correcto de otro concepto invita a
          // mezclarlos, así que dice qué cuenta.
          sinCondicionesDeCobro: pendientes.sinCondiciones.length,
          sinCondicionesDeCobroQueCuenta:
            'servicios activos sin condiciones de cobro pactadas; no son los que faltan por facturar',
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
