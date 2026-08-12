'use client';

import Link from 'next/link';
import Icono from './Icono';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoConNombre } from './Logo';
import TemaToggle from './TemaToggle';

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
  const [admin, setAdmin] = useState(false);

  async function salir() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const activo = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  /**
   * Las pestañas de todos los días van sueltas; las de administrar —bitácora,
   * catálogos, usuarios, respaldos— se juntan bajo un botón.
   *
   * Con las nueve del administrador en fila, en una laptop de 1366 la barra ya
   * no alcanzaba y la última pestaña se cortaba a la mitad. Y una pestaña que
   * no se ve es una pestaña que no existe.
   *
   * Si a un rol le tocan cero o una de las de administrar, no se le arma el
   * botón: un menú desplegable para un solo renglón estorba más de lo que
   * ordena.
   */
  const agrupables = items.filter((i) => i.grupo === 'admin');
  const conGrupo = agrupables.length > 1;
  const sueltos = conGrupo ? items.filter((i) => i.grupo !== 'admin') : items;
  const enGrupo = conGrupo ? agrupables : [];
  const grupoActivo = enGrupo.some((i) => activo(i.href));

  return (
    <header className="border-b border-slate-700/70 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14 gap-3">
          <Link href="/" className="shrink-0">
            <LogoConNombre size={30} />
          </Link>

          {/* El menú completo pasa a botón a partir de lg: con las pestañas del
              administrador, en pantallas medianas los nombres se partían en dos
              renglones y la barra crecía. */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {sueltos.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  activo(i.href)
                    ? 'bg-ultra-rojo text-ultra-blanco font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/40'
                }`}
              >
                {/* Los iconos son adorno: en la franja donde la barra va justa
                    se quitan antes que cortar una pestaña. Aparecen hasta 2xl y
                    no en xl: con la pestaña de jurídico, en 1280 los iconos y el
                    nombre de la cuenta volvían los dos a la vez y la barra se
                    pasaba 65 px. */}
                <Icono nombre={i.icono} className="mr-1.5 hidden 2xl:inline -mt-0.5" />
                {i.etiqueta}
              </Link>
            ))}

            {conGrupo && (
              <div className="relative" onMouseLeave={() => setAdmin(false)}>
                <button
                  type="button"
                  onClick={() => setAdmin((v) => !v)}
                  onMouseEnter={() => setAdmin(true)}
                  aria-expanded={admin}
                  className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    grupoActivo
                      ? 'bg-ultra-rojo text-ultra-blanco font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/40'
                  }`}
                >
                  <Icono nombre="engrane" className="mr-1.5 hidden 2xl:inline -mt-0.5" />
                  Administrar
                  <span className="ml-1 text-[10px]">▾</span>
                </button>
                {/* Se queda en el documento y solo se esconde: así el menú
                    existe para quien navega con el teclado o con un lector. */}
                <div
                  className={`absolute right-0 mt-1 min-w-[190px] rounded-xl border border-slate-700/70 bg-slate-900 shadow-xl p-1 z-30 ${
                    admin ? 'block' : 'hidden'
                  }`}
                >
                  {enGrupo.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      onClick={() => setAdmin(false)}
                      className={`block px-3 py-2 rounded-lg text-sm whitespace-nowrap ${
                        activo(i.href) ? 'bg-slate-700/70 text-white' : 'text-slate-300 hover:bg-slate-700/40'
                      }`}
                    >
                      <Icono nombre={i.icono} className="mr-2 -mt-0.5" />
                      {i.etiqueta}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <TemaToggle />
            {/* El nombre lleva a la cuenta propia: ahí se cambia la contraseña.
                Entre lg y 2xl se quita: es la franja donde el menú completo ya
                está desplegado pero la pantalla todavía no da para las dos
                cosas, y las pestañas importan más que saber cómo te llamas. */}
            <Link
              href="/cuenta"
              title="Mi cuenta"
              className="text-right hidden sm:block lg:hidden 2xl:block rounded-lg px-2 py-1 hover:bg-slate-700/40 transition-colors"
            >
              <p className="text-sm text-white leading-tight whitespace-nowrap hidden 2xl:block">{usuario.nombre}</p>
              <span
                className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${
                  COLOR_ROL[etiquetaRol] || 'bg-slate-700 text-slate-300 border-slate-600'
                }`}
              >
                {etiquetaRol}
              </span>
            </Link>
            <button
              onClick={salir}
              className="text-sm text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800"
            >
              Salir
            </button>
            <button
              onClick={() => setAbierto((v) => !v)}
              className="lg:hidden text-slate-400 hover:text-white px-2"
              aria-label="Menú"
            >
              <Icono nombre="menu" tamano={20} />
            </button>
          </div>
        </div>

        {abierto && (
          <nav className="lg:hidden pb-3 flex flex-col gap-1">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setAbierto(false)}
                className={`px-3 py-2 rounded-lg text-sm ${
                  activo(i.href) ? 'bg-slate-700/70 text-white' : 'text-slate-400'
                }`}
              >
                <Icono nombre={i.icono} className="mr-2 -mt-0.5" />
                {i.etiqueta}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
