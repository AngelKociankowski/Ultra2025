/**
 * El equipo que se le entrega a un servicio.
 *
 * Son dieciséis renglones de la hoja de aperturas que no vivían en ninguna
 * parte de la plataforma. No son un adorno del formato: un chaleco blindado o
 * una patrulla cambian el costo del servicio y son lo que hay que preparar
 * antes del primer turno. Capturarlos con la apertura es capturarlos cuando se
 * saben; después ya nadie vuelve.
 *
 * Se guardan como un objeto y no como dieciséis columnas porque casi todos van
 * en cero casi siempre: una tabla con dieciséis columnas vacías es más difícil
 * de leer y de mantener que un `{ "Lámparas": 1 }`.
 *
 * Vive aparte de `lib/servicios.js` porque el formulario corre en el navegador.
 */

/** Los renglones de la hoja, en el mismo orden en que vienen ahí. */
export const EQUIPO = [
  { clave: 'chaleco_blindado', etiqueta: 'Chaleco blindado' },
  { clave: 'patrulla', etiqueta: 'Patrulla' },
  { clave: 'telefono_celular', etiqueta: 'Teléfono celular' },
  { clave: 'radio', etiqueta: 'Radio de comunicación' },
  { clave: 'agente_quimico', etiqueta: 'Agente químico' },
  { clave: 'cctv', etiqueta: 'CCTV' },
  { clave: 'fornitura', etiqueta: 'Fornitura' },
  { clave: 'app_mobileo', etiqueta: 'App Mobileo' },
  { clave: 'bicicleta', etiqueta: 'Bicicleta' },
  { clave: 'cuatrimoto', etiqueta: 'Cuatrimoto' },
  { clave: 'lamparas', etiqueta: 'Lámparas' },
  { clave: 'impermeables', etiqueta: 'Impermeables' },
  { clave: 'botas_hule', etiqueta: 'Botas de hule' },
  { clave: 'tolete', etiqueta: 'Tolete' },
  { clave: 'app_residenciales', etiqueta: 'App para residenciales' },
  { clave: 'baston_retractil', etiqueta: 'Bastón retráctil' },
];

const POR_CLAVE = Object.fromEntries(EQUIPO.map((e) => [e.clave, e]));

/**
 * Deja solo los renglones conocidos y con cantidad.
 *
 * Los ceros no se guardan: «no lleva patrulla» y «nadie capturó la patrulla»
 * son lo mismo en la práctica, y guardar dieciséis ceros por servicio llena la
 * base de nada.
 */
export function normalizarEquipo(entrada, juzgarCantidad) {
  /**
   * Cuántos lleva cada renglón NO lo decide esta función: lo contesta quien la
   * llama, con el mismo `exigirDato()` que juzga todo lo demás.
   *
   * Aquí había un `Math.max(0, Math.round(Number(v) || 0))`, que es el mismo
   * lector a mano que se borró de los otros sitios: `'0x10'` eran 16 chalecos,
   * `1e9` entraba sin tope y un negativo se volvía cero en silencio. Es la
   * tercera de las tres estructuras —turnos, partidas, equipo— y `equipo_json`
   * la arrastra cada consulta del expediente del movimiento.
   *
   * Y se recibe como parámetro en vez de importarse porque este archivo lo carga
   * también el formulario del navegador —de aquí salen `EQUIPO` y
   * `listarEquipo()`— y `lib/captura.js` arrastra los catálogos, que arrastran
   * better-sqlite3. La decisión de qué puede valer sigue viviendo en un solo
   * sitio; lo que cambia es quién se lo pregunta.
   */
  if (typeof juzgarCantidad !== 'function') {
    throw new TypeError('normalizarEquipo necesita quién juzgue la cantidad de cada renglón.');
  }
  const out = {};
  for (const [k, v] of Object.entries(entrada || {})) {
    // Por pertenencia real: las claves vienen del cuerpo de la petición, y
    // `!POR_CLAVE['__proto__']` es falso, así que esa entrada se colaba entre
    // los renglones conocidos.
    if (!Object.hasOwn(POR_CLAVE, k)) continue;
    const n = juzgarCantidad(v, POR_CLAVE[k].etiqueta);
    if (n) out[k] = n;
  }
  return out;
}

/** Para pintarlo: [{etiqueta, cantidad}], solo lo que lleva algo. */
export function listarEquipo(json) {
  let datos = json;
  if (typeof json === 'string') {
    try {
      datos = JSON.parse(json || '{}');
    } catch {
      datos = {};
    }
  }
  return EQUIPO.filter((e) => Number(datos?.[e.clave]) > 0).map((e) => ({
    ...e,
    cantidad: Number(datos[e.clave]),
  }));
}
