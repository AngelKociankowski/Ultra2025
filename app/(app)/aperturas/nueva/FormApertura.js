'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AUTORIZACIONES_APERTURA } from '@/lib/campos';

const TURNOS = [
  '8X16 L-D', '8X16 L-S', '8X16 L-V',
  '12X12 L-D', '12X12 L-S', '12X12 L-V',
  '12X24', '12X36', '24X24', '24X48',
  '10X14', '11X13', '12 HRS', '13X47', '24 HRS',
];

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs text-slate-400 mb-1';

export default function FormApertura({ catalogos, serviciosActivos }) {
  const router = useRouter();
  const [tipo, setTipo] = useState('APERTURA');
  const [f, setF] = useState({
    servicio: '',
    servicio_id: '',
    razon_social: '',
    direccion: '',
    zona: '',
    tipo_servicio: '',
    cluster: '',
    estado_geo: '',
    asesor: '',
    gerente: '',
    fecha: new Date().toISOString().slice(0, 10),
    precio_guardia: '',
    sueldo_base: '',
    bono: '',
    uniforme: '',
    credito_autorizado: false,
    credito_plazo: '',
    forma_pago: '',
    cobro: '',
    tipo_repse: '',
    comentarios: '',
  });
  const [turnos, setTurnos] = useState({});
  const [aut, setAut] = useState({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);

  const total = useMemo(
    () => Object.values(turnos).reduce((a, b) => a + (Number(b) || 0), 0),
    [turnos]
  );

  const esIncremento = tipo === 'INCREMENTO';

  function set(k, v) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function elegirServicioExistente(id) {
    const s = serviciosActivos.find((x) => String(x.id) === String(id));
    setF((prev) => ({
      ...prev,
      servicio_id: id,
      servicio: s?.servicio || '',
      razon_social: s?.razon_social || prev.razon_social,
      zona: s?.zona || prev.zona,
      asesor: s?.asesor || prev.asesor,
    }));
  }

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setOk('');
    if (total <= 0) {
      setError('Captura al menos un guardia en el desglose de turnos.');
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch('/api/aperturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, tipo, turnos, guardias: total, aut }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo registrar la apertura.');
        return;
      }
      setOk(`Apertura ${data.folio} registrada. El servicio ya está en el estado de fuerza.`);
      router.refresh();
      setTimeout(() => router.push(`/estado-fuerza/${data.servicioId}`), 900);
    } catch {
      setError('Error de red.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          {['APERTURA', 'INCREMENTO', 'TEMPORAL'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`text-sm px-3 py-1.5 rounded-lg ${
                tipo === t ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {esIncremento
            ? 'Incremento: suma guardias a un servicio que ya está activo.'
            : 'Apertura / temporal: crea un servicio nuevo en el estado de fuerza.'}
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {esIncremento ? (
            <div className="lg:col-span-2">
              <label className={label}>Servicio activo *</label>
              <select
                required
                value={f.servicio_id}
                onChange={(e) => elegirServicioExistente(e.target.value)}
                className={input}
              >
                <option value="">Selecciona…</option>
                {serviciosActivos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.servicio} — {s.total_guardias} guardias
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="lg:col-span-2">
              <label className={label}>Nombre del servicio *</label>
              <input required value={f.servicio} onChange={(e) => set('servicio', e.target.value)} className={input} />
            </div>
          )}

          <div>
            <label className={label}>Fecha de apertura *</label>
            <input required type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} className={input} />
          </div>

          <div className="lg:col-span-2">
            <label className={label}>Razón social</label>
            <input value={f.razon_social} onChange={(e) => set('razon_social', e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Zona</label>
            <input
              value={f.zona}
              onChange={(e) => set('zona', e.target.value)}
              list="zonas"
              className={input}
            />
            <datalist id="zonas">
              {catalogos.zonas.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>

          <div className="lg:col-span-3">
            <label className={label}>Dirección / ubicación</label>
            <input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Asesor</label>
            <input value={f.asesor} onChange={(e) => set('asesor', e.target.value)} list="asesores" className={input} />
            <datalist id="asesores">
              {catalogos.asesores.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={label}>Gerente a cargo</label>
            <input value={f.gerente} onChange={(e) => set('gerente', e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Tipo de servicio</label>
            <input value={f.tipo_servicio} onChange={(e) => set('tipo_servicio', e.target.value)} list="tipos" className={input} />
            <datalist id="tipos">
              {catalogos.tipos.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={label}>Cluster</label>
            <input value={f.cluster} onChange={(e) => set('cluster', e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Estado (geográfico)</label>
            <input value={f.estado_geo} onChange={(e) => set('estado_geo', e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Tipo de REPSE</label>
            <input value={f.tipo_repse} onChange={(e) => set('tipo_repse', e.target.value)} className={input} />
          </div>
        </div>
      </section>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Desglose de turnos</h2>
          <span className="text-sm text-slate-400">
            Total: <strong className="text-emerald-400">{total}</strong> guardias
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {TURNOS.map((t) => (
            <div key={t}>
              <label className="block text-[11px] text-slate-500 mb-0.5">{t}</label>
              <input
                type="number"
                min="0"
                value={turnos[t] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setTurnos((prev) => {
                    const next = { ...prev };
                    if (v === '' || Number(v) === 0) delete next[t];
                    else next[t] = Number(v);
                    return next;
                  });
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-3">Comercial</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className={label}>Precio por guardia</label>
            <input type="number" step="any" value={f.precio_guardia} onChange={(e) => set('precio_guardia', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Sueldo base</label>
            <input type="number" step="any" value={f.sueldo_base} onChange={(e) => set('sueldo_base', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Bono</label>
            <input type="number" step="any" value={f.bono} onChange={(e) => set('bono', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Tipo de uniforme</label>
            <input value={f.uniforme} onChange={(e) => set('uniforme', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Forma de pago</label>
            <input value={f.forma_pago} onChange={(e) => set('forma_pago', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Cobro</label>
            <input value={f.cobro} onChange={(e) => set('cobro', e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>¿Se autorizó crédito?</label>
            <label className="flex items-center gap-2 text-sm text-slate-200 h-[34px]">
              <input
                type="checkbox"
                checked={f.credito_autorizado}
                onChange={(e) => set('credito_autorizado', e.target.checked)}
                className="w-4 h-4 accent-cyan-500"
              />
              {f.credito_autorizado ? 'Sí' : 'No'}
            </label>
          </div>
          <div>
            <label className={label}>Plazo del crédito</label>
            <input value={f.credito_plazo} onChange={(e) => set('credito_plazo', e.target.value)} className={input} />
          </div>
        </div>
        <div className="mt-3">
          <label className={label}>Comentarios</label>
          <textarea rows={2} value={f.comentarios} onChange={(e) => set('comentarios', e.target.value)} className={input} />
        </div>
      </section>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Autorizaciones</h2>
        <p className="text-xs text-slate-500 mb-3">
          Se guardan junto con la apertura como evidencia de las firmas recabadas.
        </p>
        <div className="flex flex-wrap gap-3">
          {AUTORIZACIONES_APERTURA.map(([clave, etiqueta]) => (
            <label key={clave} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-1.5">
              <input
                type="checkbox"
                checked={!!aut[clave]}
                onChange={(e) => setAut((prev) => ({ ...prev, [clave]: e.target.checked }))}
                className="w-4 h-4 accent-emerald-500"
              />
              {etiqueta}
            </label>
          ))}
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {ok && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
          {ok}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg px-5 py-2.5 font-medium"
      >
        {enviando ? 'Registrando…' : `Registrar ${tipo.toLowerCase()} (${total} guardias)`}
      </button>
    </form>
  );
}
