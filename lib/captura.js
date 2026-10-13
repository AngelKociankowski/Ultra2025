/**
 * Qué puede valer un dato capturado. El único sitio que lo contesta.
 *
 * Esto no existe por orden: existe porque la alternativa ya se probó tres veces
 * y falló tres veces. Cada vez que alguien encontraba que un número raro entraba
 * por una puerta, se endurecía ESA puerta: `numOrNull()` aprendió a no convertir
 * listas, `numeroCapturado()` aprendió a no leer hexadecimales, `TOPE_TEXTO`
 * apareció para los textos del panel del alta. Pero cada arreglo se quedó en su
 * función, así que `'0x10'` seguía entrando como 16 pesos por «Editar», una
 * dirección de 50 000 caracteres se guardaba entera por el mismo camino, y por la
 * corrección formal se podía borrar la razón social de un cliente mandando cadena
 * vacía. No eran cuatro defectos: era que no había un solo sitio que dijera qué
 * puede valer un dato capturado, y mientras no lo hubiera cada campo nuevo nacía
 * con el agujero abierto en las puertas que nadie había mirado.
 *
 * El contrato, y es todo el contrato:
 *
 *     exigirDato(campo, loQueLlegó)  ->  el valor bueno, o un error que dice
 *                                        qué le pasa
 *
 * Quien escribe una columna de `servicios`, `aperturas` o `cancelaciones` pasa
 * por aquí. No hay un camino corto: `registrarApertura()`, `actualizarServicio()`,
 * `registrarCorreccion()`, `completarAlta()`, `registrarCancelacion()` y
 * `corregirApertura()` llaman a esta función y no interpretan nada por su cuenta.
 *
 * Las reglas no se escriben aquí otra vez: se derivan de donde ya viven.
 *
 *   · **El tipo del campo** lo dice `CAMPOS` de `lib/campos.js`, que es lo que la
 *     pantalla usa para dibujar el control. Si la ficha pinta «Precio por
 *     guardia» como `money`, aquí se lee como importe; si pinta «Dirección» como
 *     `text`, se lee como texto. Un campo nuevo no hay que apuntarlo en dos
 *     listas: con decir de qué tipo es, ya se sabe qué puede valer.
 *   · **Los catálogos** los sigue contestando `exigirDelCatalogo()`, que es la
 *     única autoridad sobre qué zonas, asesores o uniformes existen. El nombre
 *     del tipo de catálogo ES el nombre del campo —`zona`, `asesor`, `gerente`,
 *     `supervisor`, `estado_geo`, `tipo_repse`, `uniforme`, `forma_pago`—, así
 *     que la lista de campos de catálogo tampoco se escribe: se cruza `CAMPOS`
 *     con `TIPOS` de `lib/catalogos.js`.
 *   · **Los topes** son los que ya se midieron sobre los datos de verdad, y
 *     están abajo con la medición al lado.
 *
 * Lo único escrito a mano es `FUERA_DE_LA_FICHA`: los datos que se capturan en un
 * movimiento o en una factura y no son columnas editables del servicio, así que
 * `CAMPOS` no tiene por qué conocerlos. Están en un solo sitio, que es el punto.
 *
 * Lo que de aquí NO depende, y conviene saber dónde está: el desglose de turnos
 * (`normalizarTurnos`), el desglose por puesto y sueldo (`lib/partidas.js`), el
 * equipo que se entrega (`lib/equipo.js`) y las autorizaciones (`aut_json`) no son
 * un valor suelto en una columna sino estructuras, y cada una tiene su propio
 * normalizador. Y la importación de archivos (`lib/csv.js`) lee números de una
 * hoja de cálculo, no de una persona: ahí lo correcto es lo contrario, tolerar
 * cómo venga escrito el archivo y dejar el resto en blanco.
 */

import { CAMPOS } from './campos';
import { TIPOS as CATALOGOS, exigirDelCatalogo } from './catalogos';
import { exigirEsquema } from './esquemas';
// El tope del texto libre no se decide aquí: es el que la plataforma ya tenía
// para los comentarios de la ficha. Ver TOPE_TEXTO_LIBRE.
import { LARGO_MAXIMO as TOPE_TEXTO_LIBRE } from './comentarios';
import { ValidacionError } from './errores';

/**
 * Topes de cordura. No son reglas de negocio: son el límite donde un número o un
 * texto deja de ser un dato y empieza a ser un error de dedo.
 *
 * Medidos sobre los datos de verdad, no elegidos a ojo. En los 217 servicios y
 * los 516 movimientos importados: el importe de factura más alto es 1,434,122.01,
 * la nómina con prestaciones más alta 957,000 y el precio por guardia más alto
 * 24,000. Diez millones dejan pasar cualquier caso real de esta empresa con
 * holgura y atajan lo que no es un dato: `1e21` entraba tal cual y después salía
 * en una propuesta de factura.
 */
const TOPE_IMPORTE = 10_000_000;

/**
 * Los días de crédito, aparte: `'1,234.56'` se redondeaba a 1235 días, que son
 * tres años y cuatro meses de plazo. El plazo más largo capturado son 21 días.
 */
const TOPE_DIAS_CREDITO = 365;

/**
 * Y las plantillas. El estado de fuerza son 880 guardias repartidos en 217
 * servicios y el más grande tiene 60: diez mil en un solo servicio no es una
 * plantilla, es un dígito de más.
 */
const TOPE_GUARDIAS = 10_000;

/**
 * El tope de los textos de una línea.
 *
 * Medido igual: en los 33 cortes importados la razón social más larga tiene 80
 * caracteres, la dirección más larga 146 y el texto libre más largo de todo el
 * archivo —un motivo de cancelación— 273. Quinientos dejan pasar cualquier caso
 * real con holgura y atajan lo que no es un dato: una dirección de 50 000
 * caracteres entraba entera en la columna, y una vez dentro la arrastra cada
 * consulta que la lee.
 *
 * No se recorta: se avisa. Truncar en silencio deja media dirección guardada
 * como si fuera la buena, que es el fallo silencioso de siempre.
 */
const TOPE_TEXTO = 500;

/*
 * TOPE_TEXTO_LIBRE (2 000) viene de `lib/comentarios.js` y no se decide aquí a
 * propósito: es el único tope de texto libre que la plataforma ya tenía, y no
 * hay ninguna razón para que una observación de la ficha quepa menos que un
 * comentario de la misma ficha. Vale para los campos que la pantalla pinta como
 * `textarea`, donde además los renglones NO se pegan: un párrafo con saltos de
 * línea es como se escribió, y aplastarlo sería cambiar el dato.
 */

/** De qué tipo de control sale cada clase de dato. */
const CLASE_POR_TIPO = {
  money: 'importe',
  number: 'importe',
  int: 'entero',
  text: 'texto',
  textarea: 'textoLibre',
  date: 'fecha',
  bool: 'siNo',
  catalogo: 'catalogo',
  opciones: 'opciones',
};

/**
 * Los datos que se capturan y no son columnas editables de la ficha, así que
 * `CAMPOS` no los conoce: o los escribe el movimiento (apertura y cancelación),
 * o solo se cambian por corrección.
 *
 * `[clase, etiqueta]`. La etiqueta es para que el error diga «Razón social» y no
 * «razon_social»: quien captura no conoce los nombres de las columnas.
 */
const FUERA_DE_LA_FICHA = {
  // Lo que describe el estado de fuerza. La edición corriente lo tiene
  // bloqueado (`CAMPOS_BLOQUEADOS`) y se arregla por corrección.
  servicio: ['texto', 'Nombre del servicio'],
  total_guardias: ['guardias', 'Total de guardias'],
  fecha_alta: ['fecha', 'Fecha de alta'],
  // Del movimiento de apertura.
  guardias: ['guardias', 'Guardias'],
  fecha: ['fecha', 'Fecha del movimiento'],
  /**
   * La hora de apertura es el único dato tolerante, y no es un descuido: es una
   * decisión que este proyecto ya había tomado y que está escrita en una prueba
   * («una hora mal escrita se ignora, no tumba la captura»).
   *
   * El alta se partió en dos tramos justamente para que un dato accesorio no
   * frene el registro de un servicio que ya está operando en la calle —ver la
   * cabecera de `lib/alta.js`—, y la hora a la que se monta el primer turno es
   * de esos: se captura en el movimiento, no describe al cliente ni al dinero, y
   * rechazar el alta entera por ella manda a quien capturó a volver mañana. Lo
   * que sí se respeta es no inventar: una hora que no se entiende no se guarda
   * media, se queda sin capturar.
   */
  hora_apertura: ['horaOpcional', 'Hora de apertura'],
  vehiculos_custodia: ['entero', 'Vehículos de custodia'],
  credito_plazo: ['texto', 'Plazo de crédito'],
  comentarios: ['textoLibre', 'Comentarios'],
  reporta: ['texto', 'Lo reportó'],
  // Del movimiento de cancelación. El motivo sale del catálogo `motivo_baja`, y
  // es el único campo cuyo nombre de columna —`motivo`— no coincide con el de su
  // catálogo: se pide por el nombre del catálogo para no tener que escribir una
  // traducción de nombres que después haya que mantener.
  motivo_baja: ['catalogo', 'Motivo de la baja'],
  cxc: ['importe', 'Cuentas por cobrar al cerrar'],
  motivo_detalle: ['textoLibre', 'Detalle del motivo'],
  auditoria: ['texto', 'Auditoría'],
  // La explicación de una corrección. La etiqueta va en minúscula porque el
  // mensaje habla del campo del formulario y no de un dato del cliente.
  motivo: ['texto', 'motivo'],
  // Del libro de facturas. Es otra tabla y otro módulo, pero un importe
  // capturado es un importe capturado: ahí `Number()` aceptaba `'0x10'` como una
  // factura de 16 pesos y `'7e-3'` como una de un centavo, y en cambio rechazaba
  // `'1,234.56'` y `'$7,000'`, que es lo que una persona teclea de verdad.
  importe: ['importe', 'Importe'],
  concepto: ['texto', 'Concepto'],
  folio: ['texto', 'Folio'],
  fecha_factura: ['fecha', 'Fecha de la factura'],
};

/**
 * Los dos campos donde un número negativo es una respuesta y no un error.
 *
 * Lo dicen los datos: de los 217 servicios, el resultado más bajo es −54,875.76
 * y el porcentaje de utilidad más bajo −75.46. Un servicio puede dar pérdida, y
 * rechazar el signo obligaría a capturar una mentira. En todos los demás
 * —precios, sueldos, importes, plazos, plantillas— un negativo es un error de
 * dedo y tiene su propio mensaje.
 */
const CON_SIGNO = ['resultado_servicio', 'pct_utilidad'];

/** El tope que le toca a cada clase de número. */
const TOPE_POR_CLASE = { importe: TOPE_IMPORTE, entero: TOPE_IMPORTE, guardias: TOPE_GUARDIAS };

/** Y la excepción medida: el plazo de crédito, que se cuenta en días. */
const TOPE_POR_CAMPO = { dias_credito: TOPE_DIAS_CREDITO };

/** Cómo se llama este campo para quien captura. */
function etiquetaDe(campo) {
  return CAMPOS[campo]?.etiqueta || FUERA_DE_LA_FICHA[campo]?.[1] || campo;
}

/** De qué clase es este dato, derivado de cómo lo pinta la ficha. */
function claseDe(campo) {
  const tipo = CAMPOS[campo]?.tipo;
  // Un tipo que `CLASE_POR_TIPO` no conozca se lee como texto: es lo más
  // estrecho que se puede hacer sin inventar una regla.
  if (tipo) return CLASE_POR_TIPO[tipo] || 'texto';
  return FUERA_DE_LA_FICHA[campo]?.[0] || null;
}

/**
 * Qué catálogo manda en este campo.
 *
 * No hay lista: el nombre del tipo de catálogo ES el nombre del campo. Los ocho
 * campos de catálogo de la ficha —zona, asesor, gerente, supervisor, estado_geo,
 * tipo_repse, uniforme, forma_pago— son exactamente los ocho tipos de `TIPOS`
 * que además son columnas. El esquema de facturación es el único de lista cerrada
 * que no vive en la tabla `catalogos`, y lo contesta `exigirEsquema()`.
 */
function catalogoDe(campo) {
  if (Object.hasOwn(CATALOGOS, campo)) return campo;
  return null;
}

// Un número sin separadores: 42 · 9500.50 · 0 · .5 · -3 (el negativo se rechaza
// más abajo, con su propio mensaje, salvo en los campos CON_SIGNO).
const NUMERO_PLANO = /^-?(\d+(\.\d*)?|\.\d+)$/;
// Y uno con separadores de miles bien puestos: 1,234.56 · 7,000. Se comprueban
// los grupos en vez de borrar las comas y ver qué queda, porque borrarlas hacía
// que «1,2,3» acabara siendo 123: un número mal escrito reinterpretado en
// silencio, que es el mismo defecto por el que existe todo este archivo.
const NUMERO_CON_MILES = /^-?\d{1,3}(,\d{3})+(\.\d*)?$/;

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SOLO_HORA = /^\d{2}:\d{2}$/;

/**
 * Un número capturado a mano.
 *
 * `Number()` entiende mucho más de lo que una persona teclea, y lo entiende
 * callado: `'0x10'` acababa en 16 pesos y `'7e-3'` en 0.007, las dos con un 200 y
 * contadas como dato capturado. Nadie teclea un hexadecimal en «precio por
 * guardia»; quien escribe eso se equivocó de campo o de pantalla, y hay que
 * decírselo. Lo que sí se acepta porque sí se teclea: separadores de miles, el
 * signo de pesos, el de porcentaje, espacios de más, decimales con punto, el cero
 * y el negativo donde el negativo es una respuesta.
 *
 * Un número que llegó como número no pasa por ahí: ya es uno, no hay nada que
 * interpretar, y es el camino por el que entra `1e21` desde JSON —que se ataja
 * con el tope, que es lo que de verdad le pasa—.
 */
function numeroCapturado(campo, crudo, { entero, tope, conSigno }) {
  const etiqueta = etiquetaDe(campo);
  const texto = String(crudo).trim();
  let n;
  if (typeof crudo === 'number') {
    n = crudo;
  } else {
    const limpio = texto.replace(/[$%\s]/g, '');
    if (NUMERO_CON_MILES.test(limpio)) n = Number(limpio.replace(/,/g, ''));
    else if (NUMERO_PLANO.test(limpio)) n = Number(limpio);
    else throw new ValidacionError(`«${etiqueta}»: «${texto}» no es un número. No se guardó nada de este lote.`);
  }
  if (!Number.isFinite(n)) {
    throw new ValidacionError(`«${etiqueta}»: «${texto}» no es un número. No se guardó nada de este lote.`);
  }
  if (n < 0 && !conSigno) {
    throw new ValidacionError(`«${etiqueta}» no puede ser negativo: tiene que ser un número mayor o igual a cero.`);
  }
  if (Math.abs(n) > tope) {
    throw new ValidacionError(
      `«${etiqueta}» no puede pasar de ${tope.toLocaleString('es-MX')}. Llegó ${texto}: revisa si se colaron dígitos.`
    );
  }
  return entero ? Math.round(n) : n;
}

/** Un texto con su tope, avisando en vez de recortar. */
function textoConTope(etiqueta, texto, tope) {
  if (texto.length <= tope) return texto;
  throw new ValidacionError(
    `«${etiqueta}» llegó con ${texto.length.toLocaleString('es-MX')} caracteres y el tope son ` +
      `${tope}. No se recorta en silencio: revisa si se pegó un texto de más.`
  );
}

/**
 * De qué clase es lo que llegó, cuando no es ni texto ni número.
 *
 * Un arreglo, un objeto o un sí/no no son una respuesta a «¿cuál es la razón
 * social?» ni a «¿cuánto cuesta el guardia?». Convertirlos no es ser tolerante
 * con la entrada, es inventar el dato: `String({a:1})` dejaba «[object Object]»
 * guardado como razón social y `numOrNull([])` dejaba un precio por guardia de
 * cero —que la plataforma lee como servicio de cortesía—, las dos con un 200. Y
 * después el campo ya tenía valor, así que el dato de verdad ya no entraba: el
 * hueco quedaba cerrado para siempre.
 */
function loQueNoEsUnDato(crudo) {
  if (Array.isArray(crudo)) return 'una lista';
  if (typeof crudo === 'boolean') return 'un sí/no';
  if (typeof crudo === 'object') return 'un objeto';
  if (typeof crudo === 'string' || typeof crudo === 'number') return null;
  return `un valor de tipo ${typeof crudo}`;
}

/**
 * Lo que de verdad se va a escribir en una columna, o un error que dice qué le
 * pasa a lo que llegó.
 *
 * Devuelve `null` cuando no llegó nada que escribir —vacío, nulo, o puros
 * espacios—, que no es un error: los formularios mandan el cuerpo entero y la
 * mayoría de sus campos viajan vacíos. Quien llama decide qué significa ese nulo:
 * al llenar un hueco significa «no lo tocó» y al corregir significa «llegó en
 * blanco», que es `exigirDatoCorregido()`.
 *
 * `actual` es lo que la columna dice hoy, y existe por una razón medida: un
 * servicio antiguo puede traer una zona que el catálogo ya retiró, y guardar
 * cualquier otro campo suyo no puede obligar a arreglarla primero. Un valor que
 * no cambia no se vuelve a juzgar; lo que se juzga es lo que entra nuevo.
 *
 * @param {string} campo  nombre de la columna
 * @param {*} crudo       lo que llegó de fuera
 * @param {{actual?: *}} [opciones]
 * @throws {ValidacionError}
 */
export function exigirDato(campo, crudo, { actual } = {}) {
  const clase = claseDe(campo);
  if (!clase) {
    // Un campo que no está en ninguna de las dos listas no se escribe. Pasaría
    // solo si alguien añade una columna y se olvida de decir qué puede valer, y
    // callarlo sería guardar un dato que nadie juzgó.
    throw new ValidacionError(`«${campo}» no es un dato que se capture por aquí.`);
  }

  /**
   * El sí/no es la única clase donde «no llegó nada» no existe: una casilla sin
   * marcar es un «no», y es lo que la columna guarda por omisión. Se juzga la
   * forma —una lista no es una respuesta a un sí/no— y nada más.
   */
  if (clase === 'siNo') {
    const noEsDato = loQueNoEsUnDato(crudo);
    if (noEsDato && typeof crudo !== 'boolean') {
      throw new ValidacionError(`«${etiquetaDe(campo)}» se contesta sí o no, y llegó ${noEsDato}.`);
    }
    return crudo ? 1 : 0;
  }

  if (crudo === null || crudo === undefined) return null;

  const noEsDato = loQueNoEsUnDato(crudo);
  if (noEsDato) {
    throw new ValidacionError(`«${etiquetaDe(campo)}» se captura como texto o número, y llegó ${noEsDato}.`);
  }
  if (typeof crudo === 'number' && !Number.isFinite(crudo)) {
    throw new ValidacionError(`«${etiquetaDe(campo)}» tiene que ser un número y llegó ${crudo}.`);
  }

  // Lo que no cambia no se vuelve a juzgar. Se compara sobre el texto porque la
  // columna devuelve números y el formulario manda cadenas.
  const plano = String(crudo).trim();
  if (!plano) return null;
  if (actual !== null && actual !== undefined && actual !== '' && plano === String(actual)) return actual;

  const etiqueta = etiquetaDe(campo);

  switch (clase) {
    case 'catalogo': {
      const catalogo = catalogoDe(campo);
      if (catalogo) return exigirDelCatalogo(catalogo, crudo);
      if (campo === 'esquema_facturacion') return exigirEsquema(crudo);
      // Un campo pintado como catálogo cuyo catálogo no existe no se guarda a la
      // buena de Dios: se dice, porque es un error nuestro y no de quien captura.
      throw new ValidacionError(`«${etiqueta}» sale de una lista que la plataforma no tiene configurada.`);
    }
    case 'opciones': {
      const permitidas = CAMPOS[campo]?.opciones || [];
      const v = plano.toUpperCase();
      if (!permitidas.includes(v)) {
        throw new ValidacionError(`«${etiqueta}» solo puede ser ${permitidas.join(', ')}. Llegó «${plano}».`);
      }
      return v;
    }
    case 'importe':
    case 'entero':
    case 'guardias':
      return numeroCapturado(campo, crudo, {
        entero: clase !== 'importe',
        tope: TOPE_POR_CAMPO[campo] ?? TOPE_POR_CLASE[clase],
        conSigno: CON_SIGNO.includes(campo),
      });
    case 'fecha': {
      if (!SOLO_FECHA.test(plano)) {
        throw new ValidacionError(`«${etiqueta}» se escribe como AAAA-MM-DD. Llegó «${plano}».`);
      }
      // Y tiene que existir: `new Date('2026-02-31')` no falla, rueda al 3 de
      // marzo, y entonces la columna diría un día que nadie escribió.
      const d = new Date(`${plano}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== plano) {
        throw new ValidacionError(`«${etiqueta}»: el día ${plano} no existe en el calendario.`);
      }
      return plano;
    }
    case 'horaOpcional': {
      // Ver el comentario de `hora_apertura`: lo que no es una hora no se
      // guarda, y tampoco tumba el movimiento.
      if (!SOLO_HORA.test(plano)) return null;
      const [h, m] = plano.split(':').map(Number);
      return h > 23 || m > 59 ? null : plano;
    }
    case 'textoLibre':
      // Un párrafo se guarda como se escribió: los saltos de línea son parte del
      // dato y pegarlos sería cambiarlo.
      return textoConTope(etiqueta, String(crudo).replace(/[ \t]+$/gm, '').trim(), TOPE_TEXTO_LIBRE) || null;
    default:
      // Texto de una línea: los espacios de más se pegan, porque «SA  DE  CV» y
      // «SA DE CV» son el mismo cliente escrito dos veces, y así se llega a
      // tener el mismo nombre legal en dos renglones distintos.
      return textoConTope(etiqueta, plano.replace(/\s+/g, ' '), TOPE_TEXTO) || null;
  }
}

/**
 * El valor nuevo de un dato que YA está escrito y se va a cambiar.
 *
 * La diferencia con `exigirDato()` es una sola y es la que faltaba: aquí el
 * blanco no es «no lo tocó», es un error. Una corrección cambia el dato; no lo
 * borra. Por el carril del mismo día esta regla ya estaba, y por el carril de la
 * corrección formal no: `razon_social: ''` dejaba en nulo el nombre legal con el
 * que se le factura a un cliente, con un 200 y sin que nadie lo pidiera. Para
 * quitar un dato escrito hace falta una edición, que tiene sus permisos.
 */
export function exigirDatoCorregido(campo, crudo, { actual } = {}) {
  const valor = exigirDato(campo, crudo, { actual });
  if (valor === null) {
    throw new ValidacionError(
      `«${etiquetaDe(campo)}» llegó en blanco: una corrección cambia el dato, no lo borra. ` +
        'Para quitarlo hace falta una edición.'
    );
  }
  return valor;
}
