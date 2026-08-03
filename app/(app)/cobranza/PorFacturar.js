'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';

const campo =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500';

/**
 * Lo que falta facturar del mes, servicio por servicio.
 *
 * Cada factura se emite por separado y revisada: la plataforma propone la fecha
 * y el importe que le tocarían según cómo se le cobra a ese cliente, pero quien
 * factura confirma o corrige antes de guardar. El importe del mes casi nunca es
 * el del mes pasado —guardias que subieron, extras, servicios que arrancaron a
 * media quincena— y emitir en bloque daría por bueno el mismo número para
 * todos.
 *
 * Lo que sí hace la lista es que no se olvide nadie entre doscientos servicios.
 */
export default function PorFacturar({ periodo, porFacturar, sinCondiciones, facturados }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(null);
  const [datos, setDatos] = useState({ fecha_factura: '', importe: '', folio: '' });
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const clave = (f) => `${f.servicio_id}·${f.concepto}`;

  function abrir(f) {
    if (abierta === clave(f)) return setAbierta(null);
    setAbierta(clave(f));
    setMensaje(null);
    setDatos({
      fecha_factura: f.fecha,
      importe: f.importe ? String(f.importe) : '',
      folio: '',
    });
  }

  async function emitir(e, f) {
    e.preventDefault();
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servicio_id: f.servicio_id,
          periodo,
          concepto: f.concepto,
          ...datos,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo registrar la factura.' });
        return;
      }
      setMensaje({
        tipo: 'ok',
        texto: `${f.servicio}: factura registrada, vence el ${data.fecha_vencimiento}.`,
      });
      setAbierta(null);
      router.refresh();
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de red.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">Por facturar — {periodo}</h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            Cada factura se registra por separado. La fecha y el importe vienen propuestos según cómo se le cobra a
            ese cliente; revísalos antes de guardar.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {porFacturar.length} pendiente{porFacturar.length === 1 ? '' : 's'} · {facturados} ya facturado
          {facturados === 1 ? '' : 's'}
          {sinCondiciones.length > 0 && (
            <span className="text-amber-300/90"> · {sinCondiciones.length} sin condiciones</span>
          )}
        </p>
      </div>

      {mensaje && (
        <p
          className={`mx-5 mt-3 text-sm rounded-lg px-3 py-2 border ${
            mensaje.tipo === 'ok'
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              : 'text-red-300 bg-red-500/10 border-red-500/30'
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-slate-900/60">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Servicio</th>
              <th className="text-left px-3 py-3">Concepto</th>
              <th className="text-left px-3 py-3">Se factura</th>
              <th className="text-left px-3 py-3">Vencería</th>
              <th className="text-right px-3 py-3">Importe propuesto</th>
              <th className="text-right px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody>
            {porFacturar.map((f) => (
              <tr key={clave(f)} className="border-t border-slate-800/70 align-top">
                <td className="px-4 py-2">
                  <Link href={`/estado-fuerza/${f.servicio_id}`} className="text-slate-200 hover:text-cyan-400">
                    {f.servicio}
                  </Link>
                  <span className="block text-[11px] text-slate-500">
                    {[f.zona, f.asesor].filter(Boolean).join(' · ') || '—'}
                  </span>

                  {abierta === clave(f) && (
                    <form onSubmit={(e) => emitir(e, f)} className="mt-3 grid sm:grid-cols-4 gap-2 items-end">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">Fecha</label>
                        <input
                          required
                          type="date"
                          value={datos.fecha_factura}
                          onChange={(e) => setDatos({ ...datos, fecha_factura: e.target.value })}
                          className={campo}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">Importe</label>
                        <input
                          required
                          type="number"
                          step="any"
                          min="0"
                          value={datos.importe}
                          onChange={(e) => setDatos({ ...datos, importe: e.target.value })}
                          className={campo}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">Folio fiscal</label>
                        <input
                          value={datos.folio}
                          onChange={(e) => setDatos({ ...datos, folio: e.target.value })}
                          className={campo}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={ocupado}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-3 py-1.5"
                      >
                        {ocupado ? 'Guardando…' : 'Guardar factura'}
                      </button>
                    </form>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400">{f.concepto}</td>
                <td className="px-3 py-2 text-slate-400">{f.fecha}</td>
                <td className="px-3 py-2 text-slate-400">
                  {f.fecha_vencimiento}
                  <span className="block text-[11px] text-slate-500">
                    {f.dias_credito ? `${f.dias_credito} días de crédito` : 'sin crédito'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-slate-300">
                  {f.importe ? (
                    formatCurrency(f.importe)
                  ) : (
                    <span className="text-amber-300/90 text-xs">falta capturarlo</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => abrir(f)}
                    className="text-xs bg-emerald-600/80 hover:bg-emerald-500 text-ultra-blanco rounded-lg px-3 py-1.5"
                  >
                    {abierta === clave(f) ? 'Cerrar' : '🧾 Facturar'}
                  </button>
                </td>
              </tr>
            ))}

            {/* Dos vacíos que no significan lo mismo: uno es «ya está todo
                facturado» y el otro es «no se puede ni proponer nada». Decirle
                al segundo que no queda nada por facturar sería mentirle a
                quien tiene doscientos servicios sin cobrar. */}
            {porFacturar.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  {sinCondiciones.length > 0 && facturados === 0 ? (
                    <>
                      <p className="text-amber-300/90">
                        Todavía no se puede proponer nada para {periodo}.
                      </p>
                      <p className="text-slate-500 text-xs mt-1 max-w-xl mx-auto">
                        A los {sinCondiciones.length} servicios activos les falta capturar cuándo se les factura y
                        con cuántos días de crédito. Sin eso no hay fecha de emisión ni de vencimiento que calcular.
                        Están listados abajo.
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-500">
                      Ya se facturó todo lo que tocaba de {periodo}
                      {sinCondiciones.length > 0 && `, salvo los ${sinCondiciones.length} servicios de abajo`}.
                    </p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sinCondiciones.length > 0 && (
        <div className="px-5 py-4 border-t border-slate-700/50">
          <p className="text-sm text-amber-300/90">
            {sinCondiciones.length} servicio{sinCondiciones.length === 1 ? '' : 's'} sin fecha de facturación
          </p>
          <p className="text-xs text-slate-500 mb-2 max-w-2xl">
            No se les puede proponer nada porque les falta capturar cuándo se les factura. Puedes hacerlo a todos de
            una vez desde{' '}
            <Link href="/cobranza/inicio" className="text-cyan-400 hover:underline">
              Puesta al día
            </Link>
            , o uno por uno desde su ficha, en «Editar».
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sinCondiciones.slice(0, 40).map((s) => (
              <Link
                key={s.id}
                href={`/estado-fuerza/${s.id}`}
                className="text-xs bg-slate-900/70 hover:bg-slate-700 text-slate-300 rounded-lg px-2 py-1"
              >
                {s.servicio}
              </Link>
            ))}
            {sinCondiciones.length > 40 && (
              <span className="text-xs text-slate-500 px-2 py-1">y {sinCondiciones.length - 40} más</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
