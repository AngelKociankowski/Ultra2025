/**
 * El cliente del servicio externo del asistente, y sus constantes.
 *
 * Este archivo es la única puerta por la que entra el paquete del servicio. Lo
 * importan la ruta del chat y los otros tres módulos `chat-*`, y nadie más: así
 * un fallo de aquí —paquete, llave, servicio caído— no puede tumbar el Tablero
 * ni el Estado de fuerza, que es lo que hay que garantizar porque hoy en
 * producción NO hay llave puesta y ese es el estado normal.
 *
 * Reglas duras, por orden de lo que cuesta si se rompen:
 *
 *   1. El identificador del modelo se escribe UNA sola vez en todo el
 *      repositorio: aquí abajo, como el valor de `MODELO`. No va en ningún
 *      comentario, prueba, documento, guía ni mensaje. Lo vigila
 *      `tests/chat-modelo-en-un-solo-sitio.test.mjs`, que IMPORTA la constante y
 *      recorre el repositorio buscándola — así la prueba tampoco la filtra.
 *   2. La llave se lee de `process.env.ANTHROPIC_API_KEY` y de ningún otro
 *      sitio. No se registra, no se devuelve, no viaja al navegador.
 *      `chatDisponible()` contesta si está puesta, nada más.
 *   3. Pensar va en modo adaptativo. Apagarlo con `{ type: 'disabled' }`
 *      devuelve 400 en el modelo contratado; si algún día hubiera que apagarlo,
 *      la forma que ese modelo acepta es `{ type: 'between_tools' }`, y solo con
 *      esfuerzo `high` o menos. Queda escrito porque es la clase de cosa que
 *      alguien va a «arreglar» sin saber, y el síntoma sería un 400 en toda
 *      pregunta.
 *   4. La herramienta no se fuerza. `tool_choice` en `any` o en `tool` devuelve
 *      400 en este modelo. Se usa `auto` más una instrucción que nombra qué
 *      herramienta usar, y `strict: true` en cada herramienta para que los
 *      argumentos lleguen válidos.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * El modelo contratado. El director lo eligió sabiendo el costo.
 *
 * No se lee de una variable de entorno a propósito: cambiarlo cambia el precio
 * y el comportamiento, y eso es una decisión del director, no de un despliegue.
 */
export const MODELO = 'claude-sonnet-5-5';

/**
 * El escalón de esfuerzo, en una sola constante para poder medirlo.
 *
 * Arranca bajo porque la tarea no es difícil: elegir entre siete herramientas,
 * leer un resultado y escribirlo en español llano. Si se queda corto —se
 * equivoca de herramienta o contesta pobre— se sube un escalón y se mide con
 * tráfico real. No se puede medir sin llave, así que queda como tarea del dueño.
 */
export const ESFUERZO = 'low';

/** Techo de la respuesta. Un chat que escribe tres páginas no se lee. */
export const MAX_TOKENS = 1500;

/** Pensar en modo adaptativo: el modelo decide cuándo y cuánto. */
export const PENSAR = { type: 'adaptive' };

/**
 * Lo que se espera al servicio antes de rendirse, en milisegundos.
 *
 * Eran 60 000, y con el reintento eso daban unos 125 segundos antes de que la
 * persona viera el aviso de que no se pudo: la espera configurada por los dos
 * intentos, más el descanso que el paquete mete entre ellos. Nadie espera dos
 * minutos frente a una pantalla callada, y menos cuando la mitad útil de esta
 * pantalla —la guía— ya está debajo sin esperar nada.
 *
 * Con 30 000 el peor caso baja a 60,5 segundos, medidos contra un servidor que
 * acepta la conexión y no contesta nunca: 2,02 veces la espera. Lo que se arriesga
 * es cortar una respuesta lenta legítima; el techo de la respuesta está en 1 500
 * tokens, así que una que tarde más de medio minuto en empezar a llegar ya es
 * señal de que el servicio va mal.
 *
 * Lo que queda de ese minuto es el segundo intento, no la espera: quitar el
 * reintento lo dejaría en unos 31 segundos, y eso es cambiar cuántas preguntas se
 * pierden por un fallo pasajero. Esa es una decisión del director y no se toma
 * aquí.
 */
export const ESPERA_MS = 30_000;

/**
 * Un reintento y no tres.
 *
 * Un chat que reintenta tres veces no es tolerante: es un chat que tarda tres
 * minutos en decir que no pudo, con la persona mirando la pantalla.
 */
export const REINTENTOS = 1;

/** Cuántas vueltas de herramienta aguanta una pregunta antes de cortarse. */
export const MAX_VUELTAS = 3;

/** Falta la llave del servicio. No es un error del usuario: es configuración. */
export class SinLlave extends Error {
  constructor(mensaje = 'El asistente no está configurado en este servidor.') {
    super(mensaje);
    this.name = 'SinLlave';
  }
}

/**
 * ¿Está puesta la llave?
 *
 * Devuelve un sí o un no y NUNCA la llave. Es lo único que la pantalla y la
 * barra de pestañas necesitan saber, y lo que se les da: si devolviera la llave
 * —o su largo, o sus primeras letras— acabaría viajando al navegador el día que
 * alguien la pase como propiedad de un componente sin pensarlo.
 */
export function chatDisponible() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim().length > 0;
}

/**
 * La instancia del cliente. Lanza `SinLlave` si no hay llave.
 *
 * Se crea una por proceso: el cliente no guarda estado de conversación y
 * rehacerlo en cada pregunta tira la reutilización de conexiones.
 */
let instancia = null;

export function cliente() {
  if (!chatDisponible()) throw new SinLlave();
  if (!instancia) {
    instancia = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // El SDK los cuenta en milisegundos, no en segundos.
      timeout: ESPERA_MS,
      maxRetries: REINTENTOS,
    });
  }
  return instancia;
}
