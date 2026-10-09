/**
 * Qué le falta a un servicio para poder operarlo y para poder cobrarlo.
 *
 * Esto sale de una auditoría de la pantalla de alta. El formulario pedía unos
 * setenta controles de una sola caída y solo dos eran obligatorios, así que
 * quien cerraba un servicio en la calle se sentaba a capturar con una lista en
 * la mano: si le faltaba un dato que ni siquiera hacía falta —el estado, el
 * uniforme, los días de crédito—, dejaba el alta a medias y volvía al día
 * siguiente. El servicio ya estaba operando y en la plataforma no existía.
 *
 * La respuesta no es pedir menos datos: todos se necesitan tarde o temprano. Es
 * separar lo que hace falta para ABRIR de lo que hace falta para OPERAR y para
 * COBRAR, y dejar dicho qué queda pendiente en vez de que el hueco se descubra
 * tres meses después, cuando cobranza no puede facturar.
 *
 * Tres reglas que explican la forma de este archivo:
 *
 *   1. **No escribe nada.** Es un módulo de lectura: dice qué falta. Llenar los
 *      huecos es `completarAlta()` en `lib/servicios.js`, que sigue siendo el
 *      punto único de escritura sobre `servicios`. Partirlo así no es manía de
 *      orden: la garantía de que un servicio solo nace por apertura y solo sale
 *      por cancelación es que haya un solo archivo que escriba esa tabla.
 *
 *   2. **No se guarda en una columna.** «Le falta capturar algo» se deriva de
 *      los propios datos cada vez que se pregunta. Una columna tendría que
 *      mantenerse al día desde los cinco sitios que tocan un servicio, y el día
 *      que uno se olvidara diría que falta algo que ya está —que es exactamente
 *      lo que le pasó a quien revisó la plataforma con lista en mano y reportó
 *      como faltantes cosas que sí estaban capturadas.
 *
 *   3. **No es una alarma.** El sello vive en la ficha del servicio y como
 *      filtro del estado de fuerza, y en ninguna otra parte. En los 217
 *      servicios de la carga inicial el REPSE está vacío en los 217 y el precio
 *      por guardia en los 217: un contador de «incompletos» en el tablero
 *      nacería en 217, no habría forma de llevarlo a cero, y en dos semanas
 *      nadie lo mira. Es el mismo error que el aviso permanente de aperturas
 *      sin aplicar, que llevaba meses diciendo 219 y había enseñado a la
 *      operación a pasar por encima de los avisos ámbar.
 */

import { CAMPOS } from './campos';

/**
 * Los campos que el motor ya exige para abrir.
 *
 * Nombre, fecha y guardias los exige `registrarApertura()`; zona y asesor son
 * la decisión que se tomó al partir el alta en dos, y la razón es que son los
 * dos datos por los que filtra y agrupa casi toda la plataforma: un servicio
 * sin zona ni asesor no le aparece a nadie en sus reportes, así que «lo capturo
 * después» equivale a que el servicio no exista.
 *
 * Esta lista solo documenta. La validación sigue viviendo en `servicios.js`,
 * que es quien escribe, y el `required` del formulario es lo que impide que un
 * alta nueva salga sin ellos. Tener la lista aquí es para que la pantalla y
 * este módulo no se contradigan cuando alguien cambie de opinión.
 */
export const MINIMO_PARA_ABRIR = ['servicio', 'fecha', 'guardias', 'zona', 'asesor'];

/** Lo que hace falta para operarlo: quién lo cubre y dónde. */
export const PARA_OPERAR = ['direccion', 'supervisor', 'gerente', 'estado_geo', 'uniforme', 'tipo_repse'];

/** Lo que hace falta para cobrarlo. */
export const PARA_COBRAR = ['razon_social', 'precio_guardia', 'esquema_facturacion', 'forma_pago', 'dias_credito'];

/**
 * Qué cuenta como «falta».
 *
 * Nulo, vacío o sin venir. Un cero capturado NO falta, y esa distinción es el
 * detalle que hace útil a todo lo demás: `precio_guardia = 0` y `dias_credito =
 * 0` son respuestas —hay servicios de cortesía y clientes que pagan de
 * contado—, y contarlas como huecos mandaría a alguien a «completar» un dato
 * que ya está contestado. Es la misma razón por la que la columna de REPSE del
 * estado de fuerza tiene tres estados y no dos: «sin capturar» no es «no».
 */
const falta = (v) => v === null || v === undefined || v === '';

const conEtiqueta = (campos, servicio) =>
  campos
    .filter((c) => falta(servicio?.[c]))
    .map((c) => ({ campo: c, etiqueta: CAMPOS[c]?.etiqueta || c }));

/**
 * Qué le falta a este servicio, agrupado por para qué hace falta.
 *
 * Agrupado y no en una lista plana porque las dos listas se atienden en momentos
 * distintos y por personas distintas: «para operarlo» lo llena operaciones
 * antes del primer turno, «para cobrarlo» lo llena ventas o cobranza antes de la
 * primera factura. Un montón de doce campos revueltos no le dice a nadie qué le
 * toca a él.
 *
 * Las etiquetas salen de `CAMPOS` de `lib/campos.js` y no se escriben otra vez:
 * dos listas de rótulos para los mismos campos acaban diciendo cosas distintas
 * en la ficha y en el formulario.
 *
 * `tiene_contrato`, `facturado`, la nómina y la utilidad quedan deliberadamente
 * fuera. No son captura del alta: son estado que cambia solo con el tiempo —se
 * firma un contrato, se emite una factura, se cierra una nómina—, y pedirlos
 * aquí marcaría como «incompleto» a un servicio que nació ayer y todavía no ha
 * tenido su primer mes.
 *
 * @param {object} servicio fila hidratada de `servicios`
 * @returns {{ operar: Array<{campo:string, etiqueta:string}>,
 *             cobrar:  Array<{campo:string, etiqueta:string}>,
 *             total: number }}
 */
export function loQueFalta(servicio) {
  const operar = conEtiqueta(PARA_OPERAR, servicio);
  const cobrar = conEtiqueta(PARA_COBRAR, servicio);
  return { operar, cobrar, total: operar.length + cobrar.length };
}

/**
 * Los campos que `completarAlta()` acepta.
 *
 * Es una lista cerrada, y eso es la mitad del permiso. Completar el alta lo
 * pueden hacer ventas y operaciones —si solo pudiera el administrador,
 * «complétalo cuando lo tengas» significaría «pídele al administrador que lo
 * complete», y entonces no se completa—, así que lo que los contiene no es el
 * rol sino el alcance: estos campos, y solo de vacío a valor.
 *
 * Lleva también `zona` y `asesor`, que son del mínimo para abrir. No es una
 * contradicción: el contrato de `POST /api/aperturas` no cambió, así que una
 * apertura que llegue por la API sin zona ni asesor se sigue registrando, y los
 * 217 servicios de la carga inicial tampoco pasaron por el formulario nuevo. Si
 * alguno quedó sin ellos, esta es la vía de arreglarlo sin pedir una edición de
 * datos operativos, que es permiso de administrador.
 *
 * `zona` y `asesor` no se reportan en `loQueFalta()` a propósito: el formulario
 * los exige, así que señalarlos en la ficha acusaría de un hueco que la vía
 * normal de alta ya no deja abrir.
 */
export const CAMPOS_COMPLETABLES = [...PARA_OPERAR, ...PARA_COBRAR, 'zona', 'asesor'];
