/**
 * Qué pasa con el importe mensual cuando se mueve la plantilla de un servicio.
 * Se pregunta; no se calcula.
 *
 * Esto vive en su propio archivo por una razón concreta: lo necesitan las dos
 * orillas. El servidor —`lib/servicios.js`— para exigir la respuesta y
 * escribirla, y el formulario del movimiento, que corre en el navegador, para
 * pintar la pregunta y la referencia. `lib/servicios.js` no se puede importar
 * desde un componente de cliente: arrastra `better-sqlite3` al navegador. Y
 * escribir el cálculo dos veces es cómo la pantalla y el motor acaban diciendo
 * cosas distintas, que es el defecto que medio expediente persigue.
 *
 * El defecto que esto cierra
 * --------------------------
 * Lo reportó operaciones y es de los caros: tres servicios de 2 guardias y
 * $45,356 al mes; a dos de ellos se les aplicó una reducción de un guardia, la
 * plantilla bajó a 1 y **el importe se quedó en $45,356**. Si cobranza factura
 * ese mes, cobra el doble. Lo mismo por el otro lado: un incremento sumaba
 * guardias y dejaba el importe viejo, que cobra de menos.
 *
 * Por qué NO se recalcula en proporción, que es el arreglo obvio
 * --------------------------------------------------------------
 * Porque lo desmienten los datos del propio negocio. Medido sobre los 33 cortes
 * importados (`data/seed.json`), emparejando solo las identidades inequívocas
 * —los cortes repiten el nombre del servicio, así que emparejar por el nombre a
 * secas inventa cambios que nunca pasaron—: de los 87 cambios de plantilla con
 * identidad clara, 72 se pueden medir, y de esos **40 dejaron el importe igual,
 * 25 lo movieron por otra cantidad y solo 7 lo movieron en proporción a los
 * guardias**. El proporcional acertaría una de cada diez veces.
 *
 * Los dos casos que lo explican, los dos reales y los dos de un solo servicio:
 *
 *   · **JAMES WATT** (STERIGENICS) pasó de 10 a 3 guardias de 2025-07 a 2025-08
 *     y volvió de 3 a 10 en 2025-09, con el importe clavado en $189,508.45 las
 *     dos veces. Es un contrato de precio fijo: el importe legítimamente no
 *     cambia aunque la plantilla se mueva a un tercio y vuelva.
 *   · **AD BOSQUES** pasó de 23 a 19 guardias de 2025-06 a 2025-07 —bajó la
 *     plantilla— y su importe SUBIÓ de $401,451.67 a $477,502.40. El
 *     proporcional habría escrito $331,633.99: casi 146 mil pesos menos, y en
 *     la dirección contraria a la que pasó.
 *
 * Escribir el proporcional sería poner un número equivocado con cara de bueno en
 * la mayoría de los casos, que es exactamente lo que este proyecto ya decidió no
 * hacer con el desglose por turno: «un hueco se ve y se llena; un dato viejo con
 * aspecto de bueno se cuela en un reporte».
 *
 * La medición se vuelve a derivar de los datos en cada corrida, en
 * `tests/importe-del-movimiento.test.mjs`, y no se trae escrita a mano: es la
 * lección del 11 contra 15 de la decisión 5-bis. Esa prueba deja clavado además
 * el error de medición que hay que no repetir —`M3`—, porque es el que produjo
 * los dos ejemplos con los que este defecto se reportó y que no resisten
 * mirarlos de cerca: «DOWNTOWN de 4 a 17 guardias» son dos servicios distintos
 * con el mismo nombre, y el renglón de 42 guardias de MIYANA AMENIDADES no se
 * movió ningún mes.
 *
 * Las tres respuestas, y por qué son tres
 * ---------------------------------------
 * La tensión es real: si la pregunta es obligatoria, bloquea registrar una
 * reducción que ya pasó en la calle cuando quien la captura no tiene el contrato
 * a la mano; si es opcional, el importe viejo se queda en silencio y volvemos al
 * defecto. Y la decisión 1 del expediente —un dato accesorio no frena el
 * registro de la realidad— no se aplica tal cual, porque el importe no es
 * accesorio: es el dinero.
 *
 * Se resuelve así: **la pregunta es obligatoria y una de sus respuestas es «no lo
 * sé».** El movimiento nunca se bloquea, porque siempre hay una respuesta
 * disponible; lo que no se puede es no contestar. Y ninguna de las tres deja el
 * número viejo callado.
 */

/**
 * Las tres respuestas. El texto es el que se lee en pantalla, así que la lista y
 * los rótulos no se escriben dos veces.
 */
export const RESPUESTAS_IMPORTE = {
  SIN_CAMBIO: {
    boton: 'No cambia',
    etiqueta: 'El importe mensual no cambia (contrato de precio fijo).',
    /**
     * Es el caso común —de los 72 cambios medibles del histórico, 40 dejaron el
     * importe igual, más que las otras dos respuestas juntas—, y por eso es UNA
     * sola acción y no pide escribir nada.
     */
    ayuda: 'Es lo más común: el contrato pacta un importe al mes y no se mueve con la plantilla.',
  },
  NUEVO: {
    boton: 'Queda en otra cantidad',
    etiqueta: 'El importe mensual queda en otra cantidad.',
    ayuda: 'El que diga el contrato. Es el único número que la plataforma guarda como bueno.',
  },
  SE_DESCONOCE: {
    boton: 'No lo sé ahora',
    etiqueta: 'No se sabe todavía: el importe se queda en blanco por capturar.',
    /**
     * Esta respuesta NO acaba en un hueco silencioso, y de eso depende que sea
     * aceptable: el importe se vacía, y vacío el servicio sale señalado en
     * «Por facturar» con «falta capturarlo» en ámbar —el aviso ya existía— y
     * entra en el recuadro de «Servicios sin facturar» del tablero. Un hueco que
     * cobranza tiene que llenar antes de emitir es mejor que un número que se
     * factura solo.
     */
    ayuda:
      'El importe se queda en blanco y el servicio sale señalado en «Por facturar» como «falta capturarlo». ' +
      'El movimiento se registra igual: lo que pasó en la calle no espera al contrato.',
  },
};

/**
 * El proporcional a los guardias, SOLO como referencia para la pantalla.
 *
 * Nadie guarda lo que devuelve esta función. La pantalla la pinta junto a la
 * pregunta, marcada como estimación de la plataforma y no como dato del
 * contrato, y el servidor no la llama al registrar el movimiento: lo que se
 * escribe es lo que una persona contestó.
 *
 * Por eso tampoco hay un botón que la copie al campo. La diferencia importa: si
 * aceptar la estimación costara un clic igual que confirmar el precio fijo, la
 * respuesta equivocada saldría tan barata como la correcta, y acertaría una de
 * cada diez veces.
 */
export function proporcionalDeReferencia({ importe, guardiasAntes, guardiasDespues }) {
  const i = Number(importe) || 0;
  const a = Number(guardiasAntes) || 0;
  const d = Number(guardiasDespues) || 0;
  if (!(i > 0) || !(a > 0) || !(d > 0)) return null;
  return Math.round(((i * d) / a) * 100) / 100;
}
