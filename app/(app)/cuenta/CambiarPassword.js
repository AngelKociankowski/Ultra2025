'use client';

import { useState } from 'react';

const campo =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500';

export default function CambiarPassword() {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    if (nueva !== repetir) {
      setEstado({ tipo: 'error', texto: 'La confirmación no coincide con la contraseña nueva.' });
      return;
    }
    setCargando(true);
    setEstado(null);
    const r = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual, nueva }),
    });
    const datos = await r.json().catch(() => ({}));
    setCargando(false);
    if (r.ok) {
      setEstado({ tipo: 'ok', texto: 'Contraseña actualizada. Se cerraron tus demás sesiones.' });
      setActual('');
      setNueva('');
      setRepetir('');
    } else {
      setEstado({ tipo: 'error', texto: datos.error || 'No se pudo cambiar la contraseña.' });
    }
  }

  return (
    <form onSubmit={enviar} className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-3 max-w-md">
      <div>
        <label htmlFor="actual" className="block text-xs text-slate-400 mb-1">
          Contraseña actual
        </label>
        <input
          id="actual"
          type="password"
          autoComplete="current-password"
          required
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          className={campo}
        />
      </div>

      <div>
        <label htmlFor="nueva" className="block text-xs text-slate-400 mb-1">
          Contraseña nueva <span className="text-slate-500">(mínimo 8 caracteres)</span>
        </label>
        <input
          id="nueva"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          className={campo}
        />
      </div>

      <div>
        <label htmlFor="repetir" className="block text-xs text-slate-400 mb-1">
          Repite la contraseña nueva
        </label>
        <input
          id="repetir"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          className={campo}
        />
      </div>

      {estado && (
        <p
          className={`text-sm rounded-lg px-3 py-2 border ${
            estado.tipo === 'ok'
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              : 'text-red-300 bg-red-500/10 border-red-500/30'
          }`}
        >
          {estado.texto}
        </p>
      )}

      <button
        type="submit"
        disabled={cargando}
        className="bg-ultra-rojo hover:bg-ultra-rojoOscuro disabled:opacity-50 text-ultra-blanco font-medium rounded-lg px-4 py-2 transition-colors"
      >
        {cargando ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}
