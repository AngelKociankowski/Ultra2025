'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
const label = 'block text-xs text-slate-400 mb-1';

const TONO = {
  PAGADA: 'bg-emerald-500/20 text-emerald-300',
  'POR VENCER': 'bg-cyan-500/20 text-cyan-300',
  VENCIDA: 'bg-red-500/20 text-red-300',
  CANCELADA: 'bg-slate-600/40 text-slate-400',
};

function Cifra({ etiqueta, valor, tono = 'text-slate-200', nota }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{etiqueta}</p>
      <p className={`text-lg font-semibold ${tono}`}>{formatCurrency(valor || 0)}</p>
      {nota && <p className="text-[11px] text-slate-500">{nota}</p>}
    </div>
  );
}

/**
 * Estado de cuenta del servicio.
 *
 * La distinción que gobierna la pantalla es entre lo que está POR VENCER y lo
 * que está VENCIDO. Los dos son dinero que el cliente no ha pagado, pero solo
 * el segundo es un adeudo: al primero todavía le corre el plazo que se le
 * concedió. Juntarlos bajo una sola cifra sería cobrarle antes de tiempo.
 */
export default function Cobranza({ servicio, facturas, resumen, programa, puedeFacturar, puedeCancelar, periodo }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(null); // 'factura' | id de la factura a pagar
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const sugerida = programa[0];
  const [nueva, setNueva] = useState(() => ({
    periodo,
    concepto: sugerida?.concepto || 'Mes completo',
    fecha_factura: sugerida?.fecha || new Date().toISOString().slice(0, 10),
    importe: sugerida?.importe ? String(Math.round(sugerida.importe * 100) / 100) : '',
    folio: '',
  }));
  const [pago, setPago] = useState({ fecha: new Date().toISOString().slice(0, 10), importe: '', referencia: '' });

  async function llamar(metodo, cuerpo, ruta = '/api/facturas') {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(ruta, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo completar la operación.' });
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de red.' });
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function emitir(e) {
    e.preventDefault();
    const data = await llamar('POST', { servicio_id: servicio.id, ...nueva });
    if (data) {
      setMensaje({
        tipo: 'ok',
        texto: `Factura registrada. Vence el ${data.fecha_vencimiento}${
          data.dias_credito ? ` (${data.dias_credito} días de crédito)` : ' (sin crédito pactado)'
        }.`,
      });
      setAbierto(null);
    }
  }

  async function pagar(e, factura) {
    e.preventDefault();
    const data = await llamar('PATCH', { id: factura.id, pago });
    if (data) {
      setMensaje({
        tipo: 'ok',
        texto: data.saldada
          ? 'Pago registrado: la factura queda saldada.'
          : `Pago registrado. Quedan ${formatCurrency(data.saldo)} de esa factura.`,
      });
      setAbierto(null);
      setPago({ fecha: new Date().toISOString().slice(0, 10), importe: '', referencia: '' });
    }
  }

  async function cancelar(factura) {
    const motivo = window.prompt(
      `¿Por qué se cancela la factura de ${factura.concepto.toLowerCase()} ${factura.periodo}?\n\nQueda registrada como cancelada, con el motivo, y deja de contar para el saldo.`
    );
    if (!motivo) return;
    const data = await llamar('PATCH', { id: factura.id, cancelar: motivo });
    if (data) setMensaje({ tipo: 'ok', texto: 'Factura cancelada: ya no cuenta para el saldo.' });
  }

  const sinCondiciones = !servicio.esquema_facturacion;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Cobranza</h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            {servicio.esquema_facturacion
              ? `Se factura ${(servicio.esquema_facturacion || '').toLowerCase().replace(/_/g, ' ')} · ${
                  servicio.dias_credito ? `${servicio.dias_credito} días de crédito` : 'sin crédito pactado'
                }${servicio.forma_pago ? ` · ${servicio.forma_pago}` : ''}`
              : 'Este servicio no tiene condiciones de cobro capturadas: falta decir cuándo se factura.'}
          </p>
        </div>
        {puedeFacturar && (
          <button
            type="button"
            onClick={() => setAbierto(abierto === 'factura' ? null : 'factura')}
            className="text-xs bg-emerald-600/80 hover:bg-emerald-500 text-ultra-blanco rounded-lg px-3 py-1.5"
          >
            {abierto === 'factura' ? 'Cerrar' : '🧾 Registrar factura'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 bg-slate-900/50 rounded-xl p-4">
        <Cifra etiqueta="Facturado" valor={resumen.emitido} nota={`${resumen.facturas} factura(s)`} />
        <Cifra etiqueta="Cobrado" valor={resumen.cobrado} tono="text-emerald-400" />
        <Cifra etiqueta="Por vencer" valor={resumen.porVencer} tono="text-cyan-400" nota="dentro del plazo" />
        <Cifra
          etiqueta="Vencido"
          valor={resumen.vencido}
          tono={resumen.vencido > 0 ? 'text-red-400' : 'text-slate-300'}
          nota={resumen.vencidas ? `${resumen.vencidas} factura(s)` : 'sin adeudo'}
        />
        {resumen.credito ? (
          <Cifra
            etiqueta="Crédito disponible"
            valor={resumen.disponible}
            tono={resumen.excedido ? 'text-red-400' : 'text-slate-200'}
            nota={resumen.excedido ? `excede la línea de ${formatCurrency(resumen.credito)}` : `línea ${formatCurrency(resumen.credito)}`}
          />
        ) : (
          <div>
            <p className="text-xs text-slate-500">Crédito disponible</p>
            <p className="text-sm text-slate-500 mt-1">Sin línea pactada</p>
          </div>
        )}
      </div>

      {mensaje && (
        <p
          className={`text-sm rounded-lg px-3 py-2 border ${
            mensaje.tipo === 'ok'
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              : 'text-red-300 bg-red-500/10 border-red-500/30'
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      {abierto === 'factura' && puedeFacturar && (
        <form onSubmit={emitir} className="bg-slate-900/50 rounded-xl p-4 space-y-3">
          {sinCondiciones && (
            <p className="text-xs text-amber-300/90">
              Este servicio no tiene esquema de facturación, así que la fecha no viene propuesta: captúrala a mano o
              guarda primero las condiciones de cobro en «Editar».
            </p>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className={label}>Mes que cubre</label>
              <input
                required
                value={nueva.periodo}
                onChange={(e) => setNueva({ ...nueva, periodo: e.target.value })}
                placeholder="2026-08"
                className={input}
              />
            </div>
            <div>
              <label className={label}>Concepto</label>
              <select
                value={nueva.concepto}
                onChange={(e) => {
                  const p = programa.find((x) => x.concepto === e.target.value);
                  setNueva((prev) => ({
                    ...prev,
                    concepto: e.target.value,
                    fecha_factura: p?.fecha || prev.fecha_factura,
                    importe: p?.importe ? String(Math.round(p.importe * 100) / 100) : prev.importe,
                  }));
                }}
                className={input}
              >
                {['Mes completo', 'Primera quincena', 'Segunda quincena', 'Extraordinaria'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Fecha de la factura</label>
              <input
                required
                type="date"
                value={nueva.fecha_factura}
                onChange={(e) => setNueva({ ...nueva, fecha_factura: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Importe</label>
              <input
                required
                type="number"
                step="any"
                min="0"
                value={nueva.importe}
                onChange={(e) => setNueva({ ...nueva, importe: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Folio fiscal (opcional)</label>
              <input value={nueva.folio} onChange={(e) => setNueva({ ...nueva, folio: e.target.value })} className={input} />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {servicio.dias_credito
              ? `Vencerá ${servicio.dias_credito} días después de la fecha de la factura.`
              : 'Sin días de crédito capturados, vence el mismo día en que se emite.'}
          </p>
          <button
            type="submit"
            disabled={ocupado}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
          >
            {ocupado ? 'Registrando…' : 'Registrar factura'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-slate-400 text-xs border-b border-slate-700">
              <th className="text-left pb-2 pr-3">Periodo</th>
              <th className="text-left pb-2 px-2">Emitida</th>
              <th className="text-left pb-2 px-2">Vence</th>
              <th className="text-right pb-2 px-2">Importe</th>
              <th className="text-right pb-2 px-2">Pagado</th>
              <th className="text-right pb-2 px-2">Saldo</th>
              <th className="text-center pb-2 px-2">Estado</th>
              <th className="text-right pb-2 pl-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id} className="border-b border-slate-800/60 align-top">
                <td className="py-2 pr-3">
                  <span className="text-slate-200">{f.periodo}</span>
                  <span className="block text-[11px] text-slate-500">{f.concepto}</span>
                </td>
                <td className="px-2 py-2 text-slate-400">{f.fecha_factura}</td>
                <td className="px-2 py-2 text-slate-400">
                  {f.fecha_vencimiento}
                  {f.estado === 'VENCIDA' && (
                    <span className="block text-[11px] text-red-400">{Math.abs(f.dias)} días de atraso</span>
                  )}
                  {f.estado === 'POR VENCER' && (
                    <span className="block text-[11px] text-slate-500">
                      {f.dias === 0 ? 'vence hoy' : `en ${f.dias} días`}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-slate-300">{formatCurrency(f.importe)}</td>
                <td className="px-2 py-2 text-right text-slate-400">
                  {f.importe_pagado ? formatCurrency(f.importe_pagado) : '—'}
                </td>
                <td className="px-2 py-2 text-right text-slate-200">{f.saldo ? formatCurrency(f.saldo) : '—'}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${TONO[f.estado]}`}>{f.estado}</span>
                  {f.parcial && <span className="block text-[11px] text-slate-500">pago parcial</span>}
                  {f.cancelada && (
                    <span className="block text-[11px] text-slate-500 max-w-[160px]">{f.motivo_cancelacion}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {puedeFacturar && f.saldo > 0 && (
                    <button
                      onClick={() => setAbierto(abierto === f.id ? null : f.id)}
                      disabled={ocupado}
                      className="text-xs text-cyan-400 hover:underline disabled:opacity-40"
                    >
                      Registrar pago
                    </button>
                  )}
                  {puedeCancelar && !f.cancelada && !f.importe_pagado && (
                    <button
                      onClick={() => cancelar(f)}
                      disabled={ocupado}
                      className="text-xs text-slate-500 hover:underline hover:text-red-400 ml-2 disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {facturas.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-500">
                  Todavía no se le ha facturado nada a este servicio por la plataforma.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {typeof abierto === 'number' && puedeFacturar && (
        <form
          onSubmit={(e) => pagar(e, facturas.find((f) => f.id === abierto))}
          className="bg-slate-900/50 rounded-xl p-4 space-y-3"
        >
          <p className="text-sm text-slate-300">
            Pago a la factura de{' '}
            <strong>
              {facturas.find((f) => f.id === abierto)?.concepto.toLowerCase()}{' '}
              {facturas.find((f) => f.id === abierto)?.periodo}
            </strong>{' '}
            — saldo {formatCurrency(facturas.find((f) => f.id === abierto)?.saldo || 0)}
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className={label}>Fecha del pago</label>
              <input
                required
                type="date"
                value={pago.fecha}
                onChange={(e) => setPago({ ...pago, fecha: e.target.value })}
                className={input}
              />
            </div>
            <div>
              <label className={label}>Importe</label>
              <input
                type="number"
                step="any"
                min="0"
                value={pago.importe}
                onChange={(e) => setPago({ ...pago, importe: e.target.value })}
                placeholder={String(facturas.find((f) => f.id === abierto)?.saldo || '')}
                className={input}
              />
              <p className="text-[11px] text-slate-500 mt-1">Déjalo vacío si liquida el saldo completo.</p>
            </div>
            <div>
              <label className={label}>Referencia</label>
              <input
                value={pago.referencia}
                onChange={(e) => setPago({ ...pago, referencia: e.target.value })}
                className={input}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={ocupado}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
          >
            {ocupado ? 'Registrando…' : 'Registrar pago'}
          </button>
        </form>
      )}
    </section>
  );
}
