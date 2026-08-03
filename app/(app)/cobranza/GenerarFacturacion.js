'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';

/**
 * Emite de una sola vez la facturación del mes.
 *
 * Se puede volver a pulsar sin miedo: salta los servicios que ya tienen su
 * factura de ese periodo. Lo que no puede calcular lo dice en vez de callarlo,
 * porque «salieron 180 facturas de 217 servicios» sin explicación es la clase
 * de cosa que nadie revisa hasta que falta el dinero.
 */
export default function GenerarFacturacion({ periodoSugerido }) {
  const router = useRouter();
  const [periodo, setPeriodo] = useState(periodoSugerido);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function generar(e) {
    e.preventDefault();
    setError('');
    setResultado(null);
    if (!window.confirm(`¿Emitir la facturación de ${periodo} para todos los servicios activos?`)) return;
    setOcupado(true);
    try {
      const res = await fetch('/api/facturas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo generar la facturación.');
        return;
      }
      setResultado(data);
      router.refresh();
    } catch {
      setError('Error de red.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <h2 className="text-base font-semibold text-white">Emitir la facturación del mes</h2>
      <p className="text-xs text-slate-500 mb-3 max-w-3xl">
        A cada servicio activo se le emite la factura que le toca según su esquema: la fecha sale del esquema y el
        vencimiento de sus días de crédito. Los que ya tengan su factura de ese mes se saltan.
      </p>
      <form onSubmit={generar} className="flex flex-wrap gap-2 items-end">
        <div>
          <label htmlFor="periodo" className="block text-xs text-slate-400 mb-1">
            Mes de servicio
          </label>
          <input
            id="periodo"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            placeholder="2026-08"
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500"
          />
        </div>
        <button
          type="submit"
          disabled={ocupado}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
        >
          {ocupado ? 'Emitiendo…' : 'Emitir facturación'}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {resultado && (
        <div className="mt-3 text-sm bg-slate-900/60 rounded-xl p-4 space-y-2">
          <p className="text-emerald-300">
            {resultado.creadas} factura(s) emitida(s) por {formatCurrency(resultado.importe)} para {resultado.periodo}.
          </p>
          {resultado.omitidos.yaFacturados.length > 0 && (
            <p className="text-xs text-slate-500">
              {resultado.omitidos.yaFacturados.length} servicio(s) ya tenían su factura de ese mes.
            </p>
          )}
          {resultado.omitidos.sinEsquema.length > 0 && (
            <p className="text-xs text-amber-300/90">
              {resultado.omitidos.sinEsquema.length} servicio(s) se quedaron fuera porque no tienen capturado cuándo se
              les factura: {resultado.omitidos.sinEsquema.slice(0, 5).join(', ')}
              {resultado.omitidos.sinEsquema.length > 5 && '…'}
            </p>
          )}
          {resultado.omitidos.sinImporte.length > 0 && (
            <p className="text-xs text-amber-300/90">
              {resultado.omitidos.sinImporte.length} servicio(s) no tienen importe de factura capturado:{' '}
              {resultado.omitidos.sinImporte.slice(0, 5).join(', ')}
              {resultado.omitidos.sinImporte.length > 5 && '…'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
