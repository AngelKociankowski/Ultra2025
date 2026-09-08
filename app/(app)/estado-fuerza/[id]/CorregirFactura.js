'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils';

/**
 * Arreglar lo que se capturó mal en una factura ya registrada.
 *
 * Cobranza lo reportó así: «el importe no es el correcto, pero no me deja
 * mover». Era literal — no había ninguna vía— y lo que parecía servir era peor
 * que nada: mandar el importe corregido caía en el registro de pagos, de modo
 * que la plataforma entendía «me pagaron esto» cuando le estaban diciendo «esto
 * está mal escrito».
 *
 * Lo que quedaba era cancelar y volver a emitir, y no es lo mismo: deja en el
 * expediente una factura cancelada que nunca lo estuvo, mientras el papel que el
 * cliente tiene en la mano sigue siendo el de siempre. Cancelar es para la
 * factura que no debió existir; esto es para el número que se escribió mal.
 *
 * Pide motivo por la misma razón que la corrección de un servicio: dentro de
 * seis meses, un importe cambiado sin explicación no se distingue de un ajuste
 * para cuadrar algo. Y aquí se trata de dinero.
 */
export default function CorregirFactura({ factura, onListo, onCancelar }) {
  const [f, setF] = useState({
    importe: String(factura.importe ?? ''),
    guardias: factura.guardias === null || factura.guardias === undefined ? '' : String(factura.guardias),
    folio: factura.folio || '',
    fecha_factura: factura.fecha_factura || '',
    periodo: factura.periodo || '',
    concepto: factura.concepto || '',
    motivo: '',
  });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  const pagado = Number(factura.importe_pagado) || 0;
  const quedaCorto = pagado > 0 && Number(f.importe) < pagado;

  async function enviar(e) {
    e.preventDefault();
    setError('');
    if (f.motivo.trim().length < 5) {
      return setError('Escribe el motivo: qué estaba mal capturado.');
    }
    setEnviando(true);
    try {
      const r = await fetch('/api/facturas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: factura.id,
          correccion: {
            motivo: f.motivo.trim(),
            importe: Number(f.importe),
            guardias: f.guardias === '' ? null : Number(f.guardias),
            folio: f.folio,
            fecha_factura: f.fecha_factura,
            periodo: f.periodo,
            concepto: f.concepto,
          },
        }),
      });
      const data = await r.json();
      if (!r.ok) return setError(data.error || 'No se pudo corregir.');
      onListo(data.sinCambios ? 'No había nada distinto que corregir.' : 'Factura corregida.');
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const input =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';
  const label = 'block text-xs text-slate-400 mb-1';

  return (
    <form onSubmit={enviar} className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-white">
          Corregir la factura de {factura.concepto.toLowerCase()} {factura.periodo}
        </h3>
        <button type="button" onClick={onCancelar} className="text-xs text-slate-500 hover:text-white">
          Cerrar
        </button>
      </div>

      <p className="text-[11px] text-slate-500">
        Esto arregla lo que se escribió mal. Si la factura no debió existir, lo que va es cancelarla.
      </p>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className={label}>Importe</label>
          <input type="number" step="any" min="0" value={f.importe} onChange={(e) => set('importe', e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Guardias facturados</label>
          <input type="number" min="0" value={f.guardias} onChange={(e) => set('guardias', e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Folio fiscal</label>
          <input value={f.folio} onChange={(e) => set('folio', e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Mes que cubre</label>
          <input value={f.periodo} onChange={(e) => set('periodo', e.target.value)} placeholder="2026-08" className={input} />
        </div>
        <div>
          <label className={label}>Concepto</label>
          <select value={f.concepto} onChange={(e) => set('concepto', e.target.value)} className={input}>
            {['Mes completo', 'Primera quincena', 'Segunda quincena', 'Extraordinaria'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Fecha de la factura</label>
          <input type="date" value={f.fecha_factura} onChange={(e) => set('fecha_factura', e.target.value)} className={input} />
          <p className="text-[11px] text-slate-600 mt-0.5">
            El vencimiento se recalcula con los {factura.dias_credito || 0} días de crédito que ya tenía.
          </p>
        </div>
      </div>

      {/* Se avisa aquí y no al guardar: quien está escribiendo el número tiene
          que saber en ese momento que va a chocar con lo ya cobrado. */}
      {quedaCorto && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Esta factura ya tiene {formatCurrency(pagado)} cobrados. Si la dejas por debajo de esa cifra, el saldo
          quedaría a favor del cliente y no se va a poder guardar.
        </p>
      )}

      <div>
        <label className={label}>Motivo de la corrección *</label>
        <input
          required
          value={f.motivo}
          onChange={(e) => set('motivo', e.target.value)}
          placeholder="Qué estaba mal capturado"
          className={input}
        />
      </div>

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
      >
        {enviando ? 'Guardando…' : 'Guardar la corrección'}
      </button>
    </form>
  );
}
