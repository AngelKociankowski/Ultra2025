'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const clase =
  'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

export default function Filtros({ valores, catalogos }) {
  const router = useRouter();
  const [f, setF] = useState(valores);

  function aplicar(siguiente) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(siguiente)) if (v) params.set(k, v);
    router.push(`/estado-fuerza?${params.toString()}`);
  }

  function cambiar(k, v) {
    const siguiente = { ...f, [k]: v };
    setF(siguiente);
    if (k !== 'q') aplicar(siguiente);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        aplicar(f);
      }}
      className="flex flex-wrap gap-2 items-center bg-slate-800/30 border border-slate-700/50 rounded-2xl p-3"
    >
      <input
        value={f.q}
        onChange={(e) => cambiar('q', e.target.value)}
        placeholder="Buscar servicio, razón social o asesor…"
        className={`${clase} flex-1 min-w-[220px]`}
      />

      <select value={f.estatus} onChange={(e) => cambiar('estatus', e.target.value)} className={clase}>
        <option value="ACTIVO">Activos</option>
        <option value="BAJA">Bajas</option>
        <option value="">Todos</option>
      </select>

      <select value={f.zona} onChange={(e) => cambiar('zona', e.target.value)} className={clase}>
        <option value="">Todas las zonas</option>
        {catalogos.zonas.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>

      <select value={f.asesor} onChange={(e) => cambiar('asesor', e.target.value)} className={clase}>
        <option value="">Todos los asesores</option>
        {catalogos.asesores.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <select value={f.contrato} onChange={(e) => cambiar('contrato', e.target.value)} className={clase}>
        <option value="">Contrato: todos</option>
        <option value="si">Con contrato</option>
        <option value="no">Sin contrato</option>
      </select>

      <select value={f.facturado} onChange={(e) => cambiar('facturado', e.target.value)} className={clase}>
        <option value="">Factura: todos</option>
        <option value="si">Facturados</option>
        <option value="no">Sin facturar</option>
      </select>

      <button type="submit" className="bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg px-3 py-1.5">
        Buscar
      </button>
    </form>
  );
}
