/**
 * Cuándo se emite la factura de un mes de servicio.
 *
 * Esto vivía dentro de `lib/facturacion.js` y salió a su propio archivo por una
 * razón concreta: `esquema_facturacion` es un campo de lista cerrada igual que
 * la zona o el uniforme, así que `lib/captura.js` —el único sitio que dice qué
 * puede valer un dato capturado— tiene que poder preguntarle. Y `facturacion.js`
 * también escribe datos capturados, así que también tiene que preguntarle a
 * `captura.js`: dejar los esquemas allí dejaba a los dos archivos importándose
 * en círculo, que es la clase de dependencia que funciona hasta el día que
 * cambia el orden en que se evalúan los módulos.
 *
 * `lib/facturacion.js` sigue reexportando las tres cosas, así que las pantallas
 * que piden `ESQUEMAS` a facturación no cambian: lo que saben de los esquemas
 * sigue llegándoles del módulo que las factura.
 */

import { ValidacionError } from './errores';

/**
 * Las cinco formas de facturar.
 *
 * Cada esquema sabe calcular sus fechas, y por eso esta lista vive en el código
 * y no en un catálogo que el administrador pueda ampliar: una opción nueva sin
 * su regla de cálculo no sabría decir cuándo vence.
 */
export const ESQUEMAS = {
  INICIO_MES: {
    etiqueta: 'A inicio de mes (anticipado)',
    ayuda: 'Se factura el día 1 del mes que se va a cubrir. El crédito corre desde entonces.',
  },
  QUINCENAL: {
    etiqueta: 'Por quincenas',
    ayuda: 'Dos facturas al mes: el día 1 y el día 16, cada una por la mitad del importe.',
  },
  FIN_MES: {
    etiqueta: 'A fin de mes',
    ayuda: 'Se factura el último día del mes trabajado.',
  },
  MES_VENCIDO: {
    etiqueta: 'Mes vencido',
    ayuda: 'Se factura el día 1 del mes siguiente al trabajado.',
  },
  SIN_CALENDARIO: {
    etiqueta: 'Sin calendario fijo',
    ayuda: 'No hay fecha pactada: la factura se registra a mano cuando se emite.',
  },
};

/**
 * Los esquemas que existen, como conjunto, y las dos preguntas que se le hacen.
 *
 * Preguntar `ESQUEMAS[valor]` no es lo mismo que preguntar si el esquema
 * existe, y la diferencia costaba facturas. `ESQUEMAS` es un objeto literal, así
 * que hereda lo de `Object.prototype`: `ESQUEMAS['__proto__']`,
 * `['constructor']`, `['toString']`, `['valueOf']`, `['hasOwnProperty']` e
 * `['isPrototypeOf']` son todos truthy, y un guardia escrito como
 * `if (!ESQUEMAS[valor]) throw` los daba por buenos. El valor se guardaba en la
 * columna con un 200, y aguas abajo `programaDe()` —que traía el mismo
 * guardia— tampoco lo rechazaba: no era ninguno de los cinco, caía al último
 * caso y le proponía a cobranza una factura a mes vencido, con fecha de emisión
 * y de vencimiento que nadie eligió y sin un solo aviso.
 *
 * Un `Set` pregunta por pertenencia real, que es la pregunta de verdad. Es el
 * mismo patrón que `exigirDelCatalogo()` usa con los catálogos, y por eso zona,
 * asesor o uniforme sí rechazaban `__proto__` desde el primer día.
 */
const ESQUEMAS_VALIDOS = new Set(Object.keys(ESQUEMAS));

/** ¿Existe de verdad este esquema? Para los caminos que solo consultan. */
export function esEsquema(valor) {
  return ESQUEMAS_VALIDOS.has(String(valor ?? '').trim());
}

/**
 * El esquema normalizado, o un error que diga que no existe.
 *
 * Vacío devuelve null y no es un error: no todos los servicios tienen capturado
 * cómo se les factura, y eso es justo uno de los huecos que el alta deja para
 * después.
 */
export function exigirEsquema(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return null;
  if (!ESQUEMAS_VALIDOS.has(v)) {
    throw new ValidacionError(`El esquema de facturación «${v}» no existe.`);
  }
  return v;
}
