'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MOTIVOS_CANCELACION, AUTORIZACIONES_CANCELACION } from '@/lib/campos';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs text-slate-400 mb-1';

export default function FormCancelacion({ serviciosActivos, preseleccion }) {
  const router = useRouter();
  const [tipo, setTipo] = useState('CANCELACION');
  const [servicioId, setServicioId] = useState(preseleccion);
  const [motivo, setMotivo] = useState('');
  const [motivoOtro, setMotivoOtro] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [cxc, setCxc] = useState('');
  const [auditoria, setAuditoria] = useState('');
  const [turnos, setTurnos] = useState({});
  const [aut, setAut] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);

  const servicio = serviciosActivos.find((s) => String(s.id) === String(servicioId));
  const esReduccion = tipo === 'REDUCCION';

  const totalReduccion = useMemo(
    () => Object.values(turnos).reduce((a, b) => a + (Number(b) || 0), 0),
    [turnos]
  );

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setOk('');
    const motivoFinal = motivo === 'OTRO' ? motivoOtro.trim() : motivo;
    if (!servicioId) return setError('Selecciona el servicio.');
    if (!motivoFinal) return setError('Indica el motivo.');
    if (esReduccion && totalReduccion <= 0) {
      return setError('Captura cuántos guardias se retiran en cada turno.');
    }

    setEnviando(true);
    try {
      const res = await fetch('/api/cancelaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          servicio_id: Number(servicioId),
          motivo: motivoFinal,
          fecha,
          cxc,
          auditoria,
          turnos: esReduccion ? turnos : {},
          guardias: esReduccion ? totalReduccion : servicio?.total_guardias,
          aut,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo registrar el movimiento.');
        return;
      }
      setOk(
        tipo === 'CANCELACION'
          ? `Cancelación ${data.folio} registrada. El servicio salió del estado de fuerza.`
          : `Reducción ${data.folio} registrada.`
      );
      router.refresh();
      setTimeout(() => router.push(`/estado-fuerza/${data.servicioId}`), 900);
    } catch {
      setError('Error de red.');
    } finally {
      setEnviando(false);
    }
  }

  const turnosServicio = Object.entries(servicio?.turnos || {});

  return (
    <form onSubmit={enviar} className="space-y-4">
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-3">
        <div className="flex gap-2">
          {[
            ['CANCELACION', 'Cancelación total'],
            ['REDUCCION', 'Reducción de guardias'],
          ].map(([t, etiqueta]) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTipo(t);
                setTurnos({});
              }}
              className={`text-sm px-3 py-1.5 rounded-lg ${
                tipo === t ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label}>Servicio activo *</label>
            <select required value={servicioId} onChange={(e) => { setServicioId(e.target.value); setTurnos({}); }} className={input}>
              <option value="">Selecciona…</option>
              {serviciosActivos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.servicio} — {s.total_guardias} guardias {s.zona ? `· ${s.zona}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Fecha de retiro *</label>
            <input required type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Motivo *</label>
            <select required value={motivo} onChange={(e) => setMotivo(e.target.value)} className={input}>
              <option value="">Selecciona…</option>
              {MOTIVOS_CANCELACION.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {motivo === 'OTRO' && (
            <div className="sm:col-span-2">
              <label className={label}>Especifica el motivo *</label>
              <input required value={motivoOtro} onChange={(e) => setMotivoOtro(e.target.value)} className={input} />
            </div>
          )}

          <div>
            <label className={label}>CXC a la cancelación</label>
            <input type="number" step="any" value={cxc} onChange={(e) => setCxc(e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Auditoría / confirmación</label>
            <input value={auditoria} onChange={(e) => setAuditoria(e.target.value)} className={input} />
          </div>
        </div>

        {servicio && (
          <div className="bg-slate-900/60 rounded-xl p-3 text-sm">
            <p className="text-slate-300">
              <strong>{servicio.servicio}</strong>
              {servicio.razon_social ? ` — ${servicio.razon_social}` : ''}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">
              {servicio.total_guardias} guardias activos
              {turnosServicio.length > 0 && ` · ${turnosServicio.map(([k, v]) => `${k}: ${v}`).join(' · ')}`}
            </p>
            {!esReduccion && (
              <p className="text-red-300 text-xs mt-2">
                Se retirarán los {servicio.total_guardias} guardias y el servicio quedará en estatus BAJA.
              </p>
            )}
          </div>
        )}
      </section>

      {esReduccion && servicio && (
        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-white">Guardias a retirar por turno</h2>
            <span className="text-sm text-slate-400">
              Total: <strong className="text-red-400">{totalReduccion}</strong> de {servicio.total_guardias}
            </span>
          </div>
          {turnosServicio.length === 0 ? (
            <p className="text-sm text-slate-500">
              Este servicio no tiene desglose de turnos capturado; registra una cancelación total.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {turnosServicio.map(([t, disponibles]) => (
                <div key={t}>
                  <label className="block text-[11px] text-slate-500 mb-0.5">
                    {t} <span className="text-slate-600">(máx {disponibles})</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={disponibles}
                    value={turnos[t] ?? ''}
                    onChange={(e) => {
                      const v = Math.min(Number(e.target.value) || 0, disponibles);
                      setTurnos((prev) => {
                        const next = { ...prev };
                        if (!v) delete next[t];
                        else next[t] = v;
                        return next;
                      });
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Autorizaciones</h2>
        <p className="text-xs text-slate-500 mb-3">Firmas recabadas para el retiro del servicio.</p>
        <div className="flex flex-wrap gap-3">
          {AUTORIZACIONES_CANCELACION.map(([clave, etiqueta]) => (
            <label key={clave} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-1.5">
              <input
                type="checkbox"
                checked={!!aut[clave]}
                onChange={(e) => setAut((prev) => ({ ...prev, [clave]: e.target.checked }))}
                className="w-4 h-4 accent-red-500"
              />
              {etiqueta}
            </label>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
      {ok && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">{ok}</p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg px-5 py-2.5 font-medium"
      >
        {enviando
          ? 'Registrando…'
          : esReduccion
          ? `Registrar reducción (${totalReduccion} guardias)`
          : `Registrar cancelación${servicio ? ` (${servicio.total_guardias} guardias)` : ''}`}
      </button>
    </form>
  );
}
