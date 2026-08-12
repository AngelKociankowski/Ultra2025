/**
 * Los iconos de la plataforma.
 *
 * Antes eran emoji. Se cambiaron por una razón que no es de gusto:
 *
 *   · Un emoji lo dibuja el sistema operativo, no la aplicación. El mismo
 *     «📄» sale plano en Windows, con relieve en Mac y en otro estilo en
 *     Android, así que la pantalla se ve distinta según quién la abra y no hay
 *     forma de alinearlos entre sí.
 *   · No heredan el color del texto. Por eso el «➕» del botón verde salía
 *     dibujado en otro verde, y el «⚠️» amarillo chillaba encima de un aviso
 *     que ya era ámbar.
 *   · El lector de pantalla los lee por su nombre Unicode —«página con curva»,
 *     «cara con vapor»— en medio de la frase del botón.
 *
 * Estos son SVG de trazo, heredan `currentColor` y el tamaño de su renglón, y
 * van marcados como decorativos: el texto del botón es el que manda. Ninguno
 * sustituye a una palabra, solo la acompaña, que es la única forma en que un
 * icono ayuda de verdad —cuál significa qué se aprende con el uso, y mientras
 * tanto la palabra ya lo dijo—.
 */

/**
 * El trazo de cada uno, en una caja de 24.
 *
 * Se dibujan sobre la misma rejilla y con el mismo grosor a propósito: un juego
 * de iconos se lee como juego cuando comparten peso, y se ve improvisado en
 * cuanto uno viene más grueso o más detallado que los demás.
 */
const TRAZOS = {
  // --- navegación
  tablero: 'M3 13.5h5v7H3zM9.5 3.5h5v17h-5zM16 9h5v11.5h-5z',
  escudo: 'M12 3.2 4.8 6v5.4c0 4.4 3 8.2 7.2 9.4 4.2-1.2 7.2-5 7.2-9.4V6z',
  alta: 'M12 5v14M5 12h14',
  baja: 'M5 12h14',
  dinero: 'M3 6.5h18v11H3zM12 14.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4M6.2 9.4h.01M17.8 14.6h.01',
  balanza: 'M12 4v16M7 20h10M6 7h12M6 7 3.2 13.2h5.6zM18 7l-2.8 6.2h5.6M3.2 13.2a2.8 2.8 0 0 0 5.6 0M15.2 13.2a2.8 2.8 0 0 0 5.6 0',
  etiqueta: 'M4 4h7.2l8.4 8.4-7.2 7.2L4 11.2zM8.2 8.2h.01',
  bitacora: 'M5 4h11l3 3v13H5zM8.5 9.5h7M8.5 13h7M8.5 16.5h4',
  catalogos: 'M3 7.5h6.5l1.5 2H21v9.5H3zM3 7.5V5h5l1.5 2',
  usuarios: 'M9.2 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M3.5 19.5c0-3.1 2.6-5.3 5.7-5.3s5.7 2.2 5.7 5.3M16.4 5.6a3 3 0 0 1 0 5.8M17.8 14.6c1.7.6 2.9 2.1 2.9 4.1',
  respaldo: 'M5 4h11l3 3v13H5zM8.5 4v5h6V4M8.5 20v-6h7v6',

  // --- objetos del negocio
  edificio: 'M4 20.5V4.5h10v16M14 10.5h6v10M7 8h1.5M10.5 8H12M7 11.5h1.5M10.5 11.5H12M7 15h1.5M10.5 15H12M16.5 14h1.5M16.5 17.5h1.5',
  guardia: 'M12 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8M5 20.5c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2',
  documento: 'M6 3.5h8L18.5 8v12.5H6zM14 3.5V8h4.5M9 12.5h6M9 16h4',
  factura: 'M5.5 3.5h13v17l-2.2-1.4-2.1 1.4-2.2-1.4-2.1 1.4-2.2-1.4-2.2 1.4zM9 8h6M9 11.5h6M9 15h3.5',
  contrato: 'M6 3.5h8L18.5 8v12.5H6zM14 3.5V8h4.5M9 15.5c1.4-2.4 2.3-2.4 3 0 .7 2.4 1.6 2.4 3 0',

  // --- acciones
  buscar: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6M15.8 15.8 20 20',
  descargar: 'M12 3.8v10.4M7.8 10.2 12 14.4l4.2-4.2M4.5 17.5v2.7h15v-2.7',
  subir: 'M12 20.2V9.8M7.8 14 12 9.8l4.2 4.2M4.5 6.5V3.8h15v2.7',
  adjunto: 'M18.5 11.3 12 17.8a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.3',
  comentario: 'M4 5h16v10.5H9.5L5.5 19v-3.5H4z',
  corregir: 'M14.5 6.5a3.9 3.9 0 0 0 5.1 5.1l-8 8a2.2 2.2 0 0 1-3.1-3.1l8-8a3.9 3.9 0 0 0-2-2',
  editar: 'M16.2 4.3 19.7 7.8 8.4 19.1l-4.3.8.8-4.3zM14 6.5l3.5 3.5',
  pausa: 'M9.5 5.5v13M14.5 5.5v13',
  reanudar: 'M7.5 4.8v14.4L19.5 12z',
  engrane:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M19.4 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1v.2a1.8 1.8 0 1 1-3.6 0V20a1.5 1.5 0 0 0-2.5-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.5H4a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.5l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.5-1V4a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.5 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1 2.5h.2a1.8 1.8 0 1 1 0 3.6H20a1.5 1.5 0 0 0-1.4.9z',
  movimiento: 'M7.5 3.8v16.4M4.2 7.1 7.5 3.8l3.3 3.3M16.5 20.2V3.8M13.2 16.9l3.3 3.3 3.3-3.3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  cerrar: 'M6.5 6.5l11 11M17.5 6.5l-11 11',

  // --- estados
  alerta: 'M12 4.2 2.8 20h18.4zM12 10v4.4M12 17.2h.01',
  check: 'M4.5 12.5 9.5 17.5 19.5 7',

  // --- tema
  sol: 'M12 16.4a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8M12 2.5v2.2M12 19.3v2.2M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6',
  luna: 'M20.4 13.6A8.5 8.5 0 1 1 10.4 3.6a6.6 6.6 0 0 0 10 10z',
};

/**
 * Un icono.
 *
 * `nombre` es la única forma de pedirlo: un juego cerrado obliga a decidir de
 * una vez cuál representa cada cosa, y evita que la misma acción salga con dos
 * dibujos en dos pantallas.
 *
 * Es decorativo por definición. Si algún día hiciera falta uno que cargue el
 * significado él solo —un botón sin texto—, lo que hay que poner es un
 * `aria-label` en el botón, no quitarle el `aria-hidden` a esto.
 */
export default function Icono({ nombre, className = '', tamano = 16 }) {
  const d = TRAZOS[nombre];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamano}
      height={tamano}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`inline-block shrink-0 ${className}`}
    >
      <path d={d} />
    </svg>
  );
}

/** Los nombres válidos, para no escribirlos de memoria. */
export const ICONOS = Object.keys(TRAZOS);
