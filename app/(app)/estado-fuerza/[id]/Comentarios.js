'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Hilo de notas sobre un servicio. Cualquiera con sesión puede escribir; borrar
 * solo el autor o un administrador, y el servidor lo vuelve a comprobar.
 */
export default function Comentarios({ servicioId, iniciales, usuarioId, esAdmin, puedeComentar = true }) {
  const router = useRouter();
  const [comentarios, setComentarios] = useState(iniciales);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const MAXIMO = 2000;
  const restantes = MAXIMO - texto.length;

  async function enviar(e) {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio) return;
    setOcupado(true);
    setError('');
    try {
      const r = await fetch(`/api/servicios/${servicioId}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: limpio }),
      });
      const datos = await r.json();
      if (!r.ok) {
        setError(datos.error || 'No se pudo guardar el comentario.');
        return;
      }
      setComentarios([datos.comentario, ...comentarios]);
      setTexto('');
      router.refresh();
    } catch {
      setError('Error de red. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function borrar(c) {
    if (!window.confirm('¿Borrar este comentario? No se puede deshacer.')) return;
    setOcupado(true);
    setError('');
    try {
      const r = await fetch(`/api/comentarios/${c.id}`, { method: 'DELETE' });
      const datos = await r.json();
      if (!r.ok) {
        setError(datos.error || 'No se pudo borrar el comentario.');
        return;
      }
      setComentarios(comentarios.filter((x) => x.id !== c.id));
      router.refresh();
    } catch {
      setError('Error de red. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section id="comentarios" className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 scroll-mt-20">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-white">Comentarios</h2>
        <span className="text-xs text-slate-500">
          {comentarios.length === 0
            ? 'ninguno todavía'
            : `${comentarios.length} ${comentarios.length === 1 ? 'nota' : 'notas'}`}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Lo que no cabe en un campo: acuerdos con el cliente, pendientes, avisos para el turno que sigue.
      </p>

      {/* Un espectador lee las notas y no escribe ninguna: dejar el formulario
          a la vista para que el servidor lo rechace después sería prometer algo
          que no se puede hacer. */}
      {!puedeComentar && (
        <p className="text-xs text-slate-500 mb-4">Tu rol consulta los comentarios, no los escribe.</p>
      )}

      {puedeComentar && (
      <form onSubmit={enviar} className="space-y-2 mb-4">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, MAXIMO))}
          rows={3}
          placeholder="Escribe una nota sobre este servicio…"
          aria-label="Nuevo comentario"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 resize-y"
        />
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${restantes < 100 ? 'text-amber-400' : 'text-slate-500'}`}>
            {restantes < 100 ? `${restantes} caracteres restantes` : 'Queda firmado con tu nombre y la fecha.'}
          </span>
          <button
            type="submit"
            disabled={ocupado || !texto.trim()}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-ultra-blanco text-sm rounded-lg px-4 py-1.5"
          >
            Comentar
          </button>
        </div>
      </form>
      )}

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <ul className="space-y-3 max-h-96 overflow-y-auto">
        {comentarios.map((c) => (
          <li key={c.id} className="border-b border-slate-800/60 pb-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-slate-300 whitespace-pre-wrap break-words flex-1">{c.texto}</p>
              {(c.usuario_id === usuarioId || esAdmin) && (
                <button
                  onClick={() => borrar(c)}
                  disabled={ocupado}
                  className="text-xs text-slate-500 hover:text-red-400 shrink-0 disabled:opacity-40"
                  title="Borrar comentario"
                >
                  Borrar
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {c.usuario} · {c.rol} · {c.creado_en}
            </p>
          </li>
        ))}
        {comentarios.length === 0 && (
          <li className="text-sm text-slate-500">Todavía nadie ha dejado una nota sobre este servicio.</li>
        )}
      </ul>
    </section>
  );
}
