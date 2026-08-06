'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MODALIDADES } from '@/lib/modalidades';

const clase =
  'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaPeriodo = (p) => {
  const [a, m] = String(p).split('-');
  return `${MESES[Number(m)]} ${a}`;
};

export default function Filtros({ valores, catalogos, periodos = [], vigente }) {
  const router = useRouter();
  const [f, setF] = useState(valores);

  function aplicar(siguiente) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(siguiente)) if (v) params.set(k, v);
    router.push(`/estado-fuerza?${params.toString()}`);
  }

  function cambiar(k, v) {
    const siguiente = { ...f, [k]: v };
    // Al saltar de mes se sueltan los filtros que ese corte quizá no tiene:
    // una zona o un asesor de hoy pueden no existir en un corte de 2023.
    if (k === 'periodo') {
      siguiente.zona = '';
      siguiente.asesor = '';
    }
    setF(siguiente);
    if (k !== 'q') aplicar(siguiente);
  }

  const enCorte = Boolean(f.periodo);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        aplicar(f);
      }}
      className="flex flex-wrap gap-2 items-center bg-slate-800/30 border border-slate-700/50 rounded-2xl p-3"
    >
      {periodos.length > 0 && (
        <select
          value={f.periodo}
          onChange={(e) => cambiar('periodo', e.target.value)}
          className={`${clase} font-medium`}
          aria-label="Mes"
        >
          <option value="">{etiquetaPeriodo(vigente)} · en curso</option>
          {periodos
            .filter((p) => p.periodo !== vigente)
            .map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {etiquetaPeriodo(p.periodo)} · {p.guardias} guardias
              </option>
            ))}
        </select>
      )}

      <input
        value={f.q}
        onChange={(e) => cambiar('q', e.target.value)}
        placeholder="Buscar servicio, razón social o asesor…"
        className={`${clase} flex-1 min-w-[220px]`}
      />

      {/* Los cortes cerrados no guardaron la modalidad: es un dato que nació
          después que ellos, y ofrecerlo ahí devolvería siempre cero. */}
      {!enCorte && (
        <select
          value={f.modalidad}
          onChange={(e) => cambiar('modalidad', e.target.value)}
          className={clase}
          aria-label="Modalidad"
        >
          <option value="">Fijos y temporales</option>
          {Object.entries(MODALIDADES).map(([k, m]) => (
            <option key={k} value={k}>
              {m.etiqueta}
            </option>
          ))}
          <option value="VENCIDA">Temporales ya vencidos</option>
        </select>
      )}

      {/* Un corte cerrado solo guarda lo que operaba ese mes: no hay bajas que filtrar. */}
      {!enCorte && (
        <select value={f.estatus} onChange={(e) => cambiar('estatus', e.target.value)} className={clase}>
          <option value="ACTIVO">Activos</option>
          <option value="SUSPENDIDO">Suspendidos</option>
          <option value="BAJA">Bajas</option>
          <option value="">Todos</option>
        </select>
      )}

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

      {catalogos.turnos?.length > 0 && (
        <select value={f.turno} onChange={(e) => cambiar('turno', e.target.value)} className={clase}>
          <option value="">Todos los turnos</option>
          {catalogos.turnos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

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
