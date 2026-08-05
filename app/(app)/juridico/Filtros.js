'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
// Del módulo puro, no de `lib/juridico`: este componente corre en el navegador
// y de allá se arrastraría SQLite entero.
import { ESTADOS } from '@/lib/contratos';

const clase =
  'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

export default function Filtros({ valores, catalogos }) {
  const router = useRouter();
  const [f, setF] = useState(valores);

  function aplicar(siguiente) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(siguiente)) if (v) params.set(k, v);
    const q = params.toString();
    router.push(q ? `/juridico?${q}` : '/juridico');
  }

  function cambiar(k, v) {
    const siguiente = { ...f, [k]: v };
    setF(siguiente);
    // El texto espera al Enter; lo demás se aplica al soltarlo, que es como se
    // usa un filtro de lista.
    if (k !== 'q') aplicar(siguiente);
  }

  const limpio = { estado: '', zona: '', asesor: '', pdf: '', q: '' };
  const hayFiltro = Object.values(f).some(Boolean);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        aplicar(f);
      }}
      className="flex flex-wrap gap-2 items-center"
    >
      <input
        value={f.q}
        onChange={(e) => cambiar('q', e.target.value)}
        placeholder="Buscar servicio, razón social, asesor o nota…"
        className={`${clase} flex-1 min-w-[240px]`}
      />

      <select
        value={f.estado}
        onChange={(e) => cambiar('estado', e.target.value)}
        className={clase}
        aria-label="Estado del contrato"
      >
        <option value="">Todos los estados</option>
        {Object.entries(ESTADOS).map(([k, e]) => (
          <option key={k} value={k}>
            {e.etiqueta}
          </option>
        ))}
      </select>

      <select value={f.zona} onChange={(e) => cambiar('zona', e.target.value)} className={clase} aria-label="Zona">
        <option value="">Todas las zonas</option>
        {catalogos.zonas.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>

      <select
        value={f.asesor}
        onChange={(e) => cambiar('asesor', e.target.value)}
        className={clase}
        aria-label="Asesor"
      >
        <option value="">Todos los asesores</option>
        {catalogos.asesores.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <select
        value={f.pdf}
        onChange={(e) => cambiar('pdf', e.target.value)}
        className={clase}
        aria-label="Expediente"
      >
        <option value="">Con y sin PDF</option>
        <option value="con">Con el PDF cargado</option>
        <option value="sin">Sin el PDF cargado</option>
      </select>

      {hayFiltro && (
        <button
          type="button"
          onClick={() => {
            setF(limpio);
            aplicar(limpio);
          }}
          className="text-sm text-slate-400 hover:text-white px-2 py-1.5"
        >
          Limpiar
        </button>
      )}
    </form>
  );
}
