'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs text-slate-400 mb-1';

const ETIQUETAS = {
  servicio: 'Nombre',
  total_guardias: 'Total de guardias',
  turnos: 'Turnos',
  estatus: 'Estatus',
  fecha_alta: 'Fecha de alta',
};

/**
 * Corrección de captura. Solo la ve el admin.
 *
 * Va cerrada por omisión: no es una pantalla de trabajo diario, es la salida de
 * emergencia para cuando el dato nació mal. Lo normal —que a un servicio le
 * suban o le bajen guardias— se registra como movimiento, y el aviso de arriba
 * lo dice para que nadie use esto por comodidad.
 */
export default function CorreccionServicio({ servicio, correcciones }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(servicio.servicio);
  const [totalGuardias, setTotalGuardias] = useState(String(servicio.total_guardias ?? ''));
  const [fechaAlta, setFechaAlta] = useState(servicio.fecha_alta || '');
  const [reactivar, setReactivar] = useState(false);
  const [turnos, setTurnos] = useState(() => ({ ...(servicio.turnos || {}) }));
  const [nuevoTurno, setNuevoTurno] = useState('');
  const [motivo, setMotivo] = useState('');
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const conDesglose = Object.keys(servicio.turnos || {}).length > 0;
  const sumaTurnos = useMemo(
    () => Object.values(turnos).reduce((a, b) => a + (Number(b) || 0), 0),
    [turnos]
  );
  // Con desglose el total lo manda la suma, igual que en el resto del sistema:
  // así el campo no se puede quedar contradiciendo a los turnos.
  const totalFinal = sumaTurnos > 0 ? sumaTurnos : Number(totalGuardias) || 0;

  function fijarTurno(t, valor) {
    const v = Math.max(0, Number(valor) || 0);
    setTurnos((prev) => {
      const next = { ...prev };
      if (!v) delete next[t];
      else next[t] = v;
      return next;
    });
  }

  async function enviar(e) {
    e.preventDefault();
    setEstado(null);
    if (motivo.trim().length < 5) {
      return setEstado({ tipo: 'error', mensaje: 'Escribe el motivo: qué estaba mal capturado.' });
    }
    setGuardando(true);
    try {
      const cuerpo = {
        motivo: motivo.trim(),
        servicio: nombre,
        total_guardias: totalFinal,
        fecha_alta: fechaAlta,
      };
      if (conDesglose || sumaTurnos > 0) cuerpo.turnos = turnos;
      if (reactivar && servicio.estatus === 'BAJA') cuerpo.estatus = 'ACTIVO';

      const res = await fetch(`/api/servicios/${servicio.id}/correccion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setEstado({ tipo: 'error', mensaje: data.error || 'No se pudo corregir.' });
        return;
      }
      if (data.sinCambios) {
        setEstado({ tipo: 'info', mensaje: 'No hubo nada que corregir.' });
        return;
      }
      const campos = Object.keys(data.cambios || {}).map((c) => ETIQUETAS[c] || c);
      setEstado({ tipo: 'ok', mensaje: `Corregido: ${campos.join(', ')}.` });
      setMotivo('');
      router.refresh();
    } catch {
      setEstado({ tipo: 'error', mensaje: 'Error de red.' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section id="correccion" className="bg-slate-800/30 border border-amber-600/30 rounded-2xl p-5 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Corregir captura</h2>
          <p className="text-xs text-slate-500 max-w-xl">
            Para arreglar un dato que se capturó mal. Si a este servicio de verdad le subieron o le bajaron guardias,
            eso es un movimiento, no una corrección.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="text-xs bg-amber-600/80 hover:bg-amber-500 text-ultra-blanco rounded-lg px-3 py-1.5"
        >
          {abierto ? 'Cerrar' : '🛠 Corregir'}
        </button>
      </div>

      {abierto && (
        <form onSubmit={enviar} className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className={label}>Nombre del servicio</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Fecha de alta</label>
              <input type="date" value={fechaAlta} onChange={(e) => setFechaAlta(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>
                Total de guardias {sumaTurnos > 0 && <span className="text-slate-600">(lo fija el desglose)</span>}
              </label>
              <input
                type="number"
                min="0"
                value={sumaTurnos > 0 ? sumaTurnos : totalGuardias}
                onChange={(e) => setTotalGuardias(e.target.value)}
                disabled={sumaTurnos > 0}
                className={`${input} disabled:opacity-60`}
              />
            </div>
          </div>

          {(conDesglose || Object.keys(turnos).length > 0) && (
            <div>
              <p className="text-xs text-slate-400 mb-1.5">Desglose por turno</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {Object.entries(turnos).map(([t, v]) => (
                  <div key={t}>
                    <label className="block text-[11px] text-slate-500 mb-0.5">{t}</label>
                    <input
                      type="number"
                      min="0"
                      value={v}
                      onChange={(e) => fijarTurno(t, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <input
                  value={nuevoTurno}
                  onChange={(e) => setNuevoTurno(e.target.value.toUpperCase())}
                  placeholder="12X12 L-D"
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const t = nuevoTurno.trim();
                    if (t && !(t in turnos)) fijarTurno(t, 1);
                    setNuevoTurno('');
                  }}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5"
                >
                  Añadir turno
                </button>
              </div>
            </div>
          )}

          {servicio.estatus === 'BAJA' && (
            <label className="flex items-start gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-2">
              <input
                type="checkbox"
                checked={reactivar}
                onChange={(e) => setReactivar(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-emerald-500"
              />
              <span>
                Reactivar el servicio
                <span className="block text-xs text-slate-500">
                  Solo si la cancelación fue un error: vuelve a ACTIVO con los guardias que indiques arriba.
                </span>
              </span>
            </label>
          )}

          <div>
            <label className={label}>Motivo de la corrección *</label>
            <textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: se capturaron 12 guardias en vez de 21 al dar de alta el servicio."
              className={input}
            />
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
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
          >
            {guardando ? 'Corrigiendo…' : 'Guardar corrección'}
          </button>
        </form>
      )}

      {correcciones.length > 0 && (
        <div className="mt-4 border-t border-slate-700/50 pt-3">
          <p className="text-xs text-slate-400 mb-2">Correcciones hechas a este servicio</p>
          <ul className="space-y-2 text-sm">
            {correcciones.map((c) => (
              <li key={c.id} className="border-b border-slate-800/60 pb-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-300">{c.motivo}</span>
                  <span className="text-xs text-slate-500 shrink-0">{c.creado_en}</span>
                </div>
                <p className="text-xs text-slate-500">
                  {c.usuario} ·{' '}
                  {Object.entries(c.cambios)
                    .map(([campo, v]) => `${ETIQUETAS[campo] || campo}: ${v.antes ?? '—'} → ${v.despues ?? '—'}`)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
