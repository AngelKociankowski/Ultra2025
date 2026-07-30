'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

function valorInicial(servicio, campo) {
  const v = servicio[campo.nombre];
  if (campo.tipo === 'bool') return !!v;
  return v ?? '';
}

export default function EditorServicio({ servicio, grupos, rol }) {
  const router = useRouter();
  const [grupoActivo, setGrupoActivo] = useState(grupos[0]?.clave);
  const [valores, setValores] = useState(() => {
    const out = {};
    for (const g of grupos) for (const c of g.campos) out[c.nombre] = valorInicial(servicio, c);
    return out;
  });
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const grupo = grupos.find((g) => g.clave === grupoActivo) || grupos[0];

  async function guardar(e) {
    e.preventDefault();
    setEstado(null);
    setGuardando(true);
    const payload = {};
    for (const c of grupo.campos) payload[c.nombre] = valores[c.nombre];
    try {
      const res = await fetch(`/api/servicios/${servicio.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setEstado({ tipo: 'error', mensaje: data.error || 'No se pudo guardar.' });
        return;
      }
      if (data.sinCambios) {
        setEstado({ tipo: 'info', mensaje: 'No hubo cambios que guardar.' });
      } else {
        const n = Object.keys(data.cambios || {}).length;
        setEstado({ tipo: 'ok', mensaje: `${n} campo${n === 1 ? '' : 's'} actualizado${n === 1 ? '' : 's'}.` });
        router.refresh();
      }
    } catch {
      setEstado({ tipo: 'error', mensaje: 'Error de red.' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Editar</h2>
          <p className="text-xs text-slate-500">
            Rol {rol} — el nombre del servicio, el estatus y el total de guardias solo cambian con aperturas y
            cancelaciones.
          </p>
        </div>
        {grupos.length > 1 && (
          <div className="flex gap-1">
            {grupos.map((g) => (
              <button
                key={g.clave}
                type="button"
                onClick={() => {
                  setGrupoActivo(g.clave);
                  setEstado(null);
                }}
                className={`text-xs px-2.5 py-1.5 rounded-lg ${
                  g.clave === grupoActivo ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {g.etiqueta}
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={guardar} className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {grupo.campos.map((c) => (
            <div key={c.nombre} className={c.tipo === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
              <label htmlFor={c.nombre} className="block text-xs text-slate-400 mb-1">
                {c.etiqueta}
              </label>

              {c.tipo === 'bool' ? (
                <label className="flex items-center gap-2 text-sm text-slate-200 h-[34px]">
                  <input
                    id={c.nombre}
                    type="checkbox"
                    checked={!!valores[c.nombre]}
                    onChange={(e) => setValores((v) => ({ ...v, [c.nombre]: e.target.checked }))}
                    className="w-4 h-4 accent-cyan-500"
                  />
                  {valores[c.nombre] ? 'Sí' : 'No'}
                </label>
              ) : c.tipo === 'textarea' ? (
                <textarea
                  id={c.nombre}
                  rows={2}
                  value={valores[c.nombre]}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nombre]: e.target.value }))}
                  className={input}
                />
              ) : (
                <input
                  id={c.nombre}
                  type={c.tipo === 'date' ? 'date' : ['money', 'number', 'int'].includes(c.tipo) ? 'number' : 'text'}
                  step={c.tipo === 'int' ? '1' : c.tipo === 'text' ? undefined : 'any'}
                  value={valores[c.nombre]}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nombre]: e.target.value }))}
                  className={input}
                />
              )}
            </div>
          ))}
        </div>

        {estado && (
          <p
            className={`text-sm rounded-lg px-3 py-2 border ${
              estado.tipo === 'ok'
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                : estado.tipo === 'error'
                ? 'text-red-300 bg-red-500/10 border-red-500/30'
                : 'text-slate-300 bg-slate-700/30 border-slate-600/40'
            }`}
          >
            {estado.mensaje}
          </p>
        )}

        <button
          type="submit"
          disabled={guardando}
          className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-2"
        >
          {guardando ? 'Guardando…' : `Guardar ${grupo.etiqueta.toLowerCase()}`}
        </button>
      </form>
    </section>
  );
}
