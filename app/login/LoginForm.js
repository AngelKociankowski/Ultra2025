'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, destino: params.get('destino') || '/' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No fue posible iniciar sesión.');
        return;
      }
      // Recarga completa a propósito: el shell de la aplicación se arma en el
      // servidor según el rol y el estado de la contraseña.
      window.location.assign(data.destino || '/');
    } catch {
      setError('Error de red. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 space-y-4"
    >
      <div>
        <label htmlFor="email" className="block text-sm text-slate-400 mb-1">
          Correo
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm text-slate-400 mb-1">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={cargando}
        className="w-full bg-ultra-rojo hover:bg-ultra-rojoOscuro disabled:opacity-50 text-ultra-blanco font-medium rounded-lg px-4 py-2 transition-colors"
      >
        {cargando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
