/** @type {import('tailwindcss').Config} */

/**
 * La paleta no trae valores fijos: cada tono apunta a una variable CSS que
 * globals.css redefine según el tema (día u noche). Así las clases que ya
 * estaban escritas —bg-slate-800, text-white, text-emerald-400— cambian solas
 * al alternar el tema, sin tener que duplicarlas con la variante `dark:`.
 *
 * El formato `rgb(var(--x) / <alpha-value>)` es lo que permite que sigan
 * funcionando las opacidades tipo bg-slate-800/50.
 */
const v = (nombre) => `rgb(var(--${nombre}) / <alpha-value>)`;

const escala = (prefijo, tonos) =>
  Object.fromEntries(tonos.map((t) => [t, v(`${prefijo}-${t}`)]));

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Neutros: la superficie y el texto
        slate: escala('s', [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        white: v('c-blanco'),

        // Acentos con significado en la app
        emerald: escala('e', [300, 400, 500, 600]),   // aperturas / positivo
        red: escala('r', [300, 400, 500, 600]),       // cancelaciones / negativo
        amber: escala('a', [300, 400, 500, 600]),     // por vencer / alerta
        cyan: escala('c', [300, 400, 500, 600]),      // enlaces / informativo
        violet: escala('v', [300, 400, 500, 600]),
        blue: escala('b', [300, 400, 500, 600]),

        // Identidad Ultra, tomada del currículum corporativo
        ultra: {
          // Blanco literal, para texto sobre el rojo: `white` sí depende del
          // tema y en modo día se vuelve casi negro.
          blanco: '#FFFFFF',
          rojo: '#E7342B',
          rojoOscuro: '#C3261E',
          negro: '#100C08',
          carbon: '#1D1D1B',
          gris: '#CDCCCC',
        },
      },
    },
  },
  plugins: [],
};
