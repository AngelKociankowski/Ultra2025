import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import ArchivoFactura from '@/components/ArchivoFactura';

const TONO = {
  PAGADA: 'bg-emerald-500/20 text-emerald-300',
  'POR VENCER': 'bg-cyan-500/20 text-cyan-300',
  VENCIDA: 'bg-red-500/20 text-red-300',
  CANCELADA: 'bg-slate-600/40 text-slate-400',
};

/**
 * Lo que ya se facturó de un mes.
 *
 * Va junto a la lista de lo que falta porque las dos contestan la misma
 * pregunta desde lados opuestos, y tenerlas separadas obligaba a recordar de
 * memoria qué se había emitido para saber si un pendiente era real.
 */
export default function Emitidas({ periodo, facturas, puedeSubir }) {
  const vivas = facturas.filter((f) => !f.cancelada);
  const total = vivas.reduce((a, f) => a + f.importe, 0);
  const cobrado = vivas.reduce((a, f) => a + (Number(f.importe_pagado) || 0), 0);

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">Ya facturado — {periodo}</h2>
          <p className="text-xs text-slate-500">
            Lo emitido de ese mes de servicio, sin importar cuándo se cobre.
          </p>
        </div>
        <p className="text-xs text-slate-500 tabular-nums">
          {vivas.length} factura{vivas.length === 1 ? '' : 's'} · {formatCurrency(total)} ·{' '}
          <span className="text-emerald-400">{formatCurrency(cobrado)} cobrado</span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-slate-900/60">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Servicio</th>
              <th className="text-left px-3 py-3">Concepto</th>
              <th className="text-left px-3 py-3">Emitida</th>
              <th className="text-left px-3 py-3">Vence</th>
              <th className="text-right px-3 py-3">Importe</th>
              <th className="text-right px-3 py-3">Saldo</th>
              <th className="text-center px-3 py-3">Estado</th>
              <th className="text-left px-4 py-3">Factura</th>
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id} className="border-t border-slate-800/70">
                <td className="px-4 py-2">
                  <Link href={`/estado-fuerza/${f.servicio_id}`} className="text-slate-200 hover:text-cyan-400">
                    {f.servicio}
                  </Link>
                  <span className="block text-[11px] text-slate-500">
                    {[f.zona, f.asesor].filter(Boolean).join(' · ') || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {f.concepto}
                  {f.carga_inicial ? (
                    <span
                      title="Venía de antes de la plataforma; entró por la carga inicial."
                      className="block text-[11px] text-slate-600"
                    >
                      carga inicial
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-400 tabular-nums">{f.fecha_factura}</td>
                <td className="px-3 py-2 text-slate-400 tabular-nums">
                  {f.fecha_vencimiento}
                  {f.estado === 'VENCIDA' && (
                    <span className="block text-[11px] text-red-400">{Math.abs(f.dias)} días de atraso</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{formatCurrency(f.importe)}</td>
                <td className="px-3 py-2 text-right text-slate-200 tabular-nums">
                  {f.saldo ? formatCurrency(f.saldo) : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${TONO[f.estado]}`}>{f.estado}</span>
                  {f.parcial && <span className="block text-[11px] text-slate-500">pago parcial</span>}
                </td>
                <td className="px-4 py-2">
                  <ArchivoFactura factura={f} puedeSubir={puedeSubir} />
                </td>
              </tr>
            ))}

            {facturas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Todavía no se ha emitido ninguna factura de {periodo}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
