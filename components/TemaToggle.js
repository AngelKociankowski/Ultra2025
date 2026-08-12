'use client';

import { useEffect, useState } from 'react';
import Icono from './Icono';

/**
 * Conmutador día / noche.
 *
 * El tema real lo aplica el script en app/layout.js antes de pintar, para que
 * no haya un parpadeo claro-oscuro al cargar. Aquí solo se lee el atributo que
 * ese script dejó puesto y se cambia al pulsar.
 */
export default function TemaToggle() {
  const [tema, setTema] = useState(null);

  useEffect(() => {
    setTema(document.documentElement.dataset.tema || 'dia');
  }, []);

  function alternar() {
    const nuevo = tema === 'noche' ? 'dia' : 'noche';
    document.documentElement.dataset.tema = nuevo;
    try {
      localStorage.setItem('ultra-tema', nuevo);
    } catch {
      /* modo privado: el tema dura lo que la pestaña */
    }
    setTema(nuevo);
  }

  // Hasta que monta no se sabe el tema; se reserva el espacio para que la
  // barra no salte.
  if (!tema) return <span className="w-8 h-8" aria-hidden />;

  const esNoche = tema === 'noche';
  return (
    <button
      onClick={alternar}
      title={esNoche ? 'Cambiar a modo día' : 'Cambiar a modo noche'}
      aria-label={esNoche ? 'Cambiar a modo día' : 'Cambiar a modo noche'}
      className="w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors"
    >
      <Icono nombre={esNoche ? 'sol' : 'luna'} tamano={18} />
    </button>
  );
}
