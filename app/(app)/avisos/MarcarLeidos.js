'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * «Ya los vi todos.»
 *
 * Va en un botón y no marcando cada aviso al abrirlo porque quien entra a esta
 * pantalla ya los leyó: obligarle a tocar quince veces para vaciarla haría que
 * dejara de abrirla, y una bandeja que no se abre es lo mismo que no tenerla.
 *
 * Tampoco se marcan solos al cargar la página: entonces un vistazo de paso
 * borraría el pendiente de algo que había que atender.
 */
export default function MarcarLeidos({ cuantos }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function marcar() {
    setEnviando(true);
    try {
      await fetch('/api/avisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: true }),
      });
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <button
      onClick={marcar}
      disabled={enviando}
      className="text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg px-3 py-2 whitespace-nowrap"
    >
      {enviando ? 'Marcando…' : `Marcar ${cuantos} como leídos`}
    </button>
  );
}
