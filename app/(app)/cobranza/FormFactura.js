'use client';

import { useState } from 'react';
import { formatCurrency, hoyLocal } from '@/lib/utils';

const campo =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500';

/**
 * Capturar una factura.
 *
 * Vive aparte porque se usa en los dos lados de la pantalla: al facturar lo que
 * falta del mes y al agregarle otra factura a un servicio que ya tiene una.
 * Tenerlo duplicado habría hecho que cualquier arreglo —el aviso de guardias
 * que no cuadran, por ejemplo— se aplicara en un lado y no en el otro.
 *
 * `inicial` trae lo que se propone; `concepto` se enseña como campo editable
 * solo cuando es una factura adicional, porque ahí es lo único que distingue
 * una de otra en la lista.
 */
export default function FormFactura({
  servicioId,
  periodo,
  plantilla,
  inicial,
  conConcepto = false,
  onListo,
}) {
  const [datos, setDatos] = useState({
    fecha_factura: inicial.fecha || hoyLocal(),
    importe: inicial.importe ? String(inicial.importe) : '',
    guardias: inicial.guardias ? String(inicial.guardias) : '',
    concepto: inicial.concepto || 'Mes completo',
    folio: '',
  });
  const [archivo, setArchivo] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const guardias = Number(datos.guardias);
  const descuadre = plantilla > 0 && datos.guardias !== '' && guardias !== plantilla;

  async function enviar(e) {
    e.preventDefault();
    setOcupado(true);
    try {
      const res = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servicio_id: servicioId, periodo, ...datos }),
      });
      const data = await res.json();
      if (!res.ok) {
        onListo({ tipo: 'error', texto: data.error || 'No se pudo registrar la factura.' });
        return;
      }

      // El PDF va en una segunda llamada, ya con la factura creada. Si falla,
      // la factura no se pierde: se avisa y se puede adjuntar después desde la
      // lista de abajo.
      let aviso = `Factura registrada, vence el ${data.fecha_vencimiento}.`;
      if (archivo) {
        const cuerpo = new FormData();
        cuerpo.append('archivo', archivo);
        const sub = await fetch(`/api/facturas/${data.id}/archivo`, { method: 'POST', body: cuerpo });
        if (sub.ok) aviso += ` Se adjuntó ${archivo.name}.`;
        else {
          const err = await sub.json().catch(() => ({}));
          aviso += ` La factura quedó guardada, pero el archivo no: ${err.error || 'no se pudo subir'}.`;
        }
      }
      onListo({ tipo: 'ok', texto: aviso, exito: true });
    } catch {
      onListo({ tipo: 'error', texto: 'Error de red.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-3 grid sm:grid-cols-4 gap-2 items-start">
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
        <label className="block text-[11px] text-slate-500 mb-0.5">
          Importe
          {inicial.restante > 0 && (
            <span className="text-slate-600"> · falta {formatCurrency(inicial.restante)}</span>
          )}
        </label>
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
        <label className="block text-[11px] text-slate-500 mb-0.5">
          Guardias facturados
          {plantilla > 0 && <span className="text-slate-600"> · en la calle: {plantilla}</span>}
        </label>
        <input
          required
          type="number"
          min="0"
          value={datos.guardias}
          onChange={(e) => setDatos({ ...datos, guardias: e.target.value })}
          className={`${campo} ${descuadre ? 'border-amber-500/60' : ''}`}
        />
        {/* En una factura adicional el aviso sobra: si al cliente se le factura
            por sede, cada papel cubre una parte de la plantilla y decir «faltan
            8» en cada uno sería ruido. */}
        {descuadre && !conConcepto && (
          <p className="text-[11px] text-amber-300/80 mt-0.5">
            {guardias < plantilla ? `${plantilla - guardias} sin cobrar` : `${guardias - plantilla} de más`}
          </p>
        )}
      </div>
      <div>
        <label className="block text-[11px] text-slate-500 mb-0.5">Folio fiscal</label>
        <input
          value={datos.folio}
          onChange={(e) => setDatos({ ...datos, folio: e.target.value })}
          className={campo}
        />
      </div>

      {conConcepto && (
        <div className="sm:col-span-2">
          <label className="block text-[11px] text-slate-500 mb-0.5">
            Concepto <span className="text-slate-600">(para distinguirla de las otras)</span>
          </label>
          <input
            required
            value={datos.concepto}
            onChange={(e) => setDatos({ ...datos, concepto: e.target.value })}
            placeholder="Por ejemplo: Sede norte, Segunda quincena…"
            className={campo}
          />
        </div>
      )}

      <div className={conConcepto ? 'sm:col-span-2' : 'sm:col-span-3'}>
        <label className="block text-[11px] text-slate-500 mb-0.5">
          Factura en PDF o XML <span className="text-slate-600">(opcional, se puede subir después)</span>
        </label>
        <input
          type="file"
          accept=".pdf,.xml,application/pdf,application/xml,text/xml"
          onChange={(e) => setArchivo(e.target.files?.[0] || null)}
          className="text-xs text-slate-400 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-2.5 file:py-1 file:text-white hover:file:bg-slate-600"
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
  );
}
