'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MOTIVOS_CANCELACION, AUTORIZACIONES_CANCELACION } from '@/lib/campos';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs text-slate-400 mb-1';

/**
 * Los tres movimientos que mueven el número de guardias de un servicio.
 *
 * Están juntos porque son la misma decisión vista desde la oficina —«a este
 * sitio le suben, le bajan o se acaba»— y separarlos en dos pantallas obligaba
 * a saber de antemano si lo que sigue es una apertura o una cancelación.
 * Por debajo cada uno conserva su flujo: la ampliación se registra como
 * incremento en aperturas y las otras dos como cancelación.
 */
const MODOS = {
  AMPLIACION: {
    etiqueta: 'Ampliación',
    signo: '+',
    verbo: 'se agregan',
    permiso: 'apertura',
    acento: 'bg-emerald-600',
    boton: 'bg-emerald-600 hover:bg-emerald-500',
    cifra: 'text-emerald-400',
    ayuda: 'Suma guardias a un servicio que ya existe. Se registra como incremento y lleva folio de apertura.',
  },
  REDUCCION: {
    etiqueta: 'Disminución',
    signo: '−',
    verbo: 'se retiran',
    permiso: 'cancelacion',
    acento: 'bg-amber-600',
    boton: 'bg-amber-600 hover:bg-amber-500',
    cifra: 'text-amber-400',
    ayuda: 'Baja el número de guardias. El servicio sigue activo en el estado de fuerza.',
  },
  CANCELACION: {
    etiqueta: 'Cancelación total',
    signo: '−',
    verbo: 'se retiran',
    permiso: 'cancelacion',
    acento: 'bg-red-600',
    boton: 'bg-red-600 hover:bg-red-500',
    cifra: 'text-red-400',
    ayuda: 'Retira el servicio completo. Queda en estatus BAJA y sale del estado de fuerza.',
  },
};

export default function FormMovimiento({ serviciosActivos, opciones, preseleccion, permisos, modoInicial }) {
  const router = useRouter();
  const disponibles = Object.keys(MODOS).filter((m) => permisos.includes(MODOS[m].permiso));

  const [modo, setModo] = useState(
    disponibles.includes(modoInicial) ? modoInicial : disponibles[0] || 'CANCELACION'
  );
  const [servicioId, setServicioId] = useState(preseleccion);
  const [motivo, setMotivo] = useState('');
  const [motivoOtro, setMotivoOtro] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [cxc, setCxc] = useState('');
  const [auditoria, setAuditoria] = useState('');
  const [turnos, setTurnos] = useState({});
  // Los turnos que se añaden a mano se recuerdan aparte de sus cantidades: si
  // dependieran de `turnos`, borrar el número le quitaría el renglón de enfrente
  // a quien apenas lo está capturando.
  const [agregados, setAgregados] = useState([]);
  const [cantidadPlana, setCantidadPlana] = useState('');
  const [aut, setAut] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cfg = MODOS[modo];
  const servicio = serviciosActivos.find((s) => String(s.id) === String(servicioId));
  const turnosServicio = Object.entries(servicio?.turnos || {});
  const conDesglose = turnosServicio.length > 0;
  const esCancelacion = modo === 'CANCELACION';
  const esAmpliacion = modo === 'AMPLIACION';

  // Una ampliación puede traer un turno que el servicio todavía no tenía. Se
  // pinta en la misma rejilla que los demás —y no solo como etiqueta— para que
  // se le pueda poner la cantidad, igual que a los que ya existen.
  const extras = agregados.filter((t) => !(t in (servicio?.turnos || {})));
  const renglones = [...turnosServicio, ...extras.map((t) => [t, null])];
  const porAgregar = (opciones?.turnos || []).filter((t) => !renglones.some(([r]) => r === t));

  const totalDesglose = useMemo(
    () => Object.values(turnos).reduce((a, b) => a + (Number(b) || 0), 0),
    [turnos]
  );
  // Sin desglose capturado el movimiento se puede pedir en número redondo; con
  // desglose la suma de los turnos es la cifra buena, para que las dos nunca
  // digan cosas distintas.
  const total = conDesglose ? totalDesglose : Number(cantidadPlana) || 0;
  const totalEfectivo = esCancelacion ? servicio?.total_guardias || 0 : total;

  function cambiarModo(m) {
    setModo(m);
    setTurnos({});
    setAgregados([]);
    setCantidadPlana('');
    setError('');
    setOk('');
  }

  function fijarTurno(t, valor, maximo) {
    const v = maximo != null ? Math.min(Number(valor) || 0, maximo) : Number(valor) || 0;
    setTurnos((prev) => {
      const next = { ...prev };
      if (!v) delete next[t];
      else next[t] = v;
      return next;
    });
  }

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setOk('');

    if (!servicioId) return setError('Selecciona el servicio.');
    if (!esAmpliacion) {
      const motivoFinal = motivo === 'OTRO' ? motivoOtro.trim() : motivo;
      if (!motivoFinal) return setError('Indica el motivo.');
    }
    if (!esCancelacion && total <= 0) {
      return setError(
        conDesglose
          ? `Captura cuántos guardias ${cfg.verbo} en cada turno.`
          : `Indica cuántos guardias ${cfg.verbo}.`
      );
    }
    if (modo === 'REDUCCION' && servicio && total >= servicio.total_guardias) {
      return setError(
        `Una disminución no puede retirar los ${servicio.total_guardias} guardias del servicio. Usa la cancelación total.`
      );
    }

    setEnviando(true);
    try {
      const res = esAmpliacion
        ? await fetch('/api/aperturas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tipo: 'INCREMENTO',
              servicio_id: Number(servicioId),
              fecha,
              turnos,
              guardias: total,
              comentarios: motivo === 'OTRO' ? motivoOtro.trim() : motivo || null,
              aut,
            }),
          })
        : await fetch('/api/cancelaciones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tipo: modo,
              servicio_id: Number(servicioId),
              motivo: motivo === 'OTRO' ? motivoOtro.trim() : motivo,
              fecha,
              cxc,
              auditoria,
              turnos: esCancelacion ? {} : turnos,
              guardias: totalEfectivo,
              aut,
            }),
          });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo registrar el movimiento.');
        return;
      }
      setOk(
        esCancelacion
          ? `Cancelación ${data.folio} registrada. El servicio salió del estado de fuerza.`
          : `${cfg.etiqueta} ${data.folio} registrada: ${cfg.signo}${total} guardias.`
      );
      router.refresh();
      setTimeout(() => router.push(`/estado-fuerza/${data.servicioId}`), 900);
    } catch {
      setError('Error de red.');
    } finally {
      setEnviando(false);
    }
  }

  if (disponibles.length === 0) {
    return <p className="text-sm text-slate-400">Tu rol no registra movimientos de guardias.</p>;
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          {disponibles.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => cambiarModo(m)}
              className={`text-sm px-3 py-1.5 rounded-lg ${
                modo === m ? `${MODOS[m].acento} text-ultra-blanco` : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {MODOS[m].signo} {MODOS[m].etiqueta}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{cfg.ayuda}</p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label}>Servicio activo *</label>
            <select
              required
              value={servicioId}
              onChange={(e) => {
                setServicioId(e.target.value);
                setTurnos({});
                setAgregados([]);
                setCantidadPlana('');
              }}
              className={input}
            >
              <option value="">Selecciona…</option>
              {serviciosActivos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.servicio} — {s.total_guardias} guardias {s.zona ? `· ${s.zona}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Fecha del movimiento *</label>
            <input required type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Motivo {esAmpliacion ? '' : '*'}</label>
            <select
              required={!esAmpliacion}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={input}
            >
              <option value="">{esAmpliacion ? 'Opcional…' : 'Selecciona…'}</option>
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

          {!esAmpliacion && (
            <>
              <div>
                <label className={label}>CXC al movimiento</label>
                <input type="number" step="any" value={cxc} onChange={(e) => setCxc(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Auditoría / confirmación</label>
                <input value={auditoria} onChange={(e) => setAuditoria(e.target.value)} className={input} />
              </div>
            </>
          )}
        </div>

        {servicio && (
          <div className="bg-slate-900/60 rounded-xl p-3 text-sm">
            <p className="text-slate-300">
              <strong>{servicio.servicio}</strong>
              {servicio.razon_social ? ` — ${servicio.razon_social}` : ''}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">
              {servicio.total_guardias} guardias activos
              {conDesglose && ` · ${turnosServicio.map(([k, v]) => `${k}: ${v}`).join(' · ')}`}
            </p>
            {esCancelacion ? (
              <p className="text-red-300 text-xs mt-2">
                Se retirarán los {servicio.total_guardias} guardias y el servicio quedará en estatus BAJA.
              </p>
            ) : (
              total > 0 && (
                <p className="text-slate-300 text-xs mt-2">
                  Quedará en{' '}
                  <strong className={cfg.cifra}>
                    {esAmpliacion ? servicio.total_guardias + total : servicio.total_guardias - total} guardias
                  </strong>{' '}
                  ({cfg.signo}
                  {total}).
                </p>
              )
            )}
          </div>
        )}
      </section>

      {!esCancelacion && servicio && (
        <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-white">
              Guardias que {cfg.verbo}
            </h2>
            <span className="text-sm text-slate-400">
              Total: <strong className={cfg.cifra}>{total}</strong>
              {modo === 'REDUCCION' && ` de ${servicio.total_guardias}`}
            </span>
          </div>

          {conDesglose ? (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {renglones.map(([t, actuales]) => (
                  <div key={t}>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      {t}{' '}
                      <span className="text-slate-600">
                        {actuales === null
                          ? '(nuevo)'
                          : modo === 'REDUCCION'
                          ? `(máx ${actuales})`
                          : `(hoy ${actuales})`}
                      </span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={modo === 'REDUCCION' ? actuales : undefined}
                      value={turnos[t] ?? ''}
                      onChange={(e) => fijarTurno(t, e.target.value, modo === 'REDUCCION' ? actuales : null)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                ))}
              </div>

              {esAmpliacion && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5" htmlFor="turno-nuevo">
                      Agregar un turno que este servicio no tiene
                    </label>
                    <select
                      id="turno-nuevo"
                      value=""
                      onChange={(e) => {
                        const t = e.target.value;
                        if (!t) return;
                        setAgregados((prev) => (prev.includes(t) ? prev : [...prev, t]));
                        fijarTurno(t, 1, null);
                      }}
                      disabled={porAgregar.length === 0}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                    >
                      <option value="">
                        {porAgregar.length ? 'Selecciona turno…' : 'Ya están todos los del catálogo'}
                      </option>
                      {porAgregar.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="max-w-xs">
              <label className={label}>Cuántos guardias {cfg.verbo} *</label>
              <input
                type="number"
                min="1"
                max={modo === 'REDUCCION' ? servicio.total_guardias - 1 : undefined}
                value={cantidadPlana}
                onChange={(e) => setCantidadPlana(e.target.value)}
                className={input}
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Este servicio no tiene desglose por turno capturado, así que basta la cantidad.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Autorizaciones</h2>
        <p className="text-xs text-slate-500 mb-3">Firmas recabadas para el movimiento.</p>
        <div className="flex flex-wrap gap-3">
          {AUTORIZACIONES_CANCELACION.map(([clave, etiqueta]) => (
            <label
              key={clave}
              className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-1.5"
            >
              <input
                type="checkbox"
                checked={!!aut[clave]}
                onChange={(e) => setAut((prev) => ({ ...prev, [clave]: e.target.checked }))}
                className="w-4 h-4 accent-cyan-500"
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
        className={`${cfg.boton} disabled:opacity-50 text-ultra-blanco rounded-lg px-5 py-2.5 font-medium`}
      >
        {enviando
          ? 'Registrando…'
          : esCancelacion
          ? `Registrar cancelación${servicio ? ` (${servicio.total_guardias} guardias)` : ''}`
          : `Registrar ${cfg.etiqueta.toLowerCase()} (${cfg.signo}${total} guardias)`}
      </button>
    </form>
  );
}
