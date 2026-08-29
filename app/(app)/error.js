'use client';

import { useEffect } from 'react';

/**
 * Cuando algo revienta en el navegador.
 *
 * Hasta ahora no había ninguna barrera de este tipo, y el resultado fue una
 * llamada real: la plataforma se veía —los números estaban ahí, dibujados por
 * el servidor— pero el menú no respondía y una gráfica salía como un recuadro
 * vacío. Desde el teléfono eso no se lee como «falló el JavaScript», se lee
 * como «la página está rota» sin más, y no hay por dónde salir.
 *
 * Esto no evita el error: lo hace visible y le da salida. Dos cosas concretas:
 *
 *   · Un mensaje en castellano llano, sin jerga ni códigos, que dice lo único
 *     que le sirve a quien lo lee: que sus datos están a salvo, porque esto
 *     pasó en la pantalla y no en el servidor.
 *   · Un botón que recarga saltándose la caché. La causa más común de que un
 *     navegador se quede con la pantalla a medias es que guardó la página de
 *     una versión anterior y pide archivos que la nueva ya no tiene.
 *
 * Y se registra en la consola, que es lo que permite que alguien lo diagnostique
 * después en vez de adivinar.
 */
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('[ultra] la pantalla falló:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] grid place-items-center px-4">
      <div className="max-w-md w-full bg-slate-800/40 border border-slate-700/60 rounded-2xl p-6 text-center">
        <h1 className="text-lg font-semibold text-white">Esta pantalla no se pudo dibujar</h1>
        <p className="text-sm text-slate-400 mt-2">
          El problema está en cómo se está mostrando la página, no en tus datos: nada de lo que hayas capturado se
          perdió.
        </p>
        <p className="text-sm text-slate-400 mt-2">
          Casi siempre se arregla recargando. Si acabamos de actualizar la plataforma, tu teléfono puede haberse
          quedado con la versión anterior.
        </p>

        <div className="flex flex-wrap gap-2 justify-center mt-5">
          <button
            onClick={() => reset()}
            className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2"
          >
            Intentar de nuevo
          </button>
          <button
            onClick={() => {
              // Recarga saltándose lo que el navegador tenga guardado: se le
              // cambia la dirección para que no pueda servir la copia vieja.
              const url = new URL(window.location.href);
              url.searchParams.set('v', Date.now().toString(36));
              window.location.replace(url.toString());
            }}
            className="text-sm bg-ultra-rojo hover:bg-ultra-rojoOscuro text-ultra-blanco rounded-lg px-3 py-2"
          >
            Recargar desde cero
          </button>
          <a
            href="/"
            className="text-sm border border-slate-600 text-slate-300 hover:bg-slate-700/60 rounded-lg px-3 py-2"
          >
            Ir al tablero
          </a>
        </div>

        {error?.digest && (
          <p className="text-[11px] text-slate-600 mt-4">
            Si vuelve a pasar, dile esto a quien lleva la plataforma: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
