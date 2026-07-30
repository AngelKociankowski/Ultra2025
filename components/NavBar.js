'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const COLOR_ROL = {
  Administrador: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  'Jurídico': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  Finanzas: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Operaciones: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Ventas: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
};

export default function NavBar({ usuario, items, etiquetaRol }) {
  const pathname = usePathname();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  async function salir() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const activo = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            <span className="font-semibold text-white hidden sm:inline">Ultra</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  activo(i.href)
                    ? 'bg-slate-700/70 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <span className="mr-1.5">{i.icono}</span>
                {i.etiqueta}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm text-white leading-tight">{usuario.nombre}</p>
              <span
                className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${
                  COLOR_ROL[etiquetaRol] || 'bg-slate-700 text-slate-300 border-slate-600'
                }`}
              >
                {etiquetaRol}
              </span>
            </div>
            <button
              onClick={salir}
              className="text-sm text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800"
            >
              Salir
            </button>
            <button
              onClick={() => setAbierto((v) => !v)}
              className="md:hidden text-slate-400 hover:text-white px-2"
              aria-label="Menú"
            >
              ☰
            </button>
          </div>
        </div>

        {abierto && (
          <nav className="md:hidden pb-3 flex flex-col gap-1">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setAbierto(false)}
                className={`px-3 py-2 rounded-lg text-sm ${
                  activo(i.href) ? 'bg-slate-700/70 text-white' : 'text-slate-400'
                }`}
              >
                <span className="mr-2">{i.icono}</span>
                {i.etiqueta}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
