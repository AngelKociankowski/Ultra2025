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
  const [archivo, setArchivo] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const clave = (f) => `${f.servicio_id}·${f.concepto}`;

  // Buscar sin acentos y sin importar mayúsculas: nadie escribe «BAJÍO» con
  // acento cuando está buscando a las prisas.
  const plano = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const termino = plano(busqueda.trim());
  const visibles = termino
    ? porFacturar.filter((f) =>
        [f.servicio, f.razon_social, f.zona, f.asesor].some((c) => plano(c).includes(termino))
      )
    : porFacturar;

  function abrir(f) {
    if (abierta === clave(f)) return setAbierta(null);
    setAbierta(clave(f));
    setMensaje(null);
    setDatos({
      // Sin condiciones capturadas no hay fecha que proponer, así que se ofrece
      // la de hoy: es un punto de partida, no una suposición sobre el negocio.
      fecha_factura: f.fecha || new Date().toISOString().slice(0, 10),
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

      // El PDF va en una segunda llamada, ya con la factura creada. Si falla,
      // la factura no se pierde: se avisa y se puede adjuntar después desde la
      // lista de abajo.
      let aviso = `${f.servicio}: factura registrada, vence el ${data.fecha_vencimiento}.`;
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

      setMensaje({ tipo: 'ok', texto: aviso });
      setAbierta(null);
      setArchivo(null);
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cliente, zona o asesor…"
              aria-label="Buscar el servicio que quieres facturar"
              className="w-60 bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm" aria-hidden="true">
              🔍
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {termino ? (
              <>
                {visibles.length} de {porFacturar.length} pendientes
              </>
            ) : (
              <>
                {porFacturar.length} pendiente{porFacturar.length === 1 ? '' : 's'} · {facturados} ya facturado
                {facturados === 1 ? '' : 's'}
              </>
            )}
          </p>
        </div>
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
            {visibles.map((f) => (
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
                      <div className="sm:col-span-3">
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
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400">{f.concepto}</td>
                <td className="px-3 py-2 text-slate-400">
                  {f.fecha || <span className="text-amber-300/80 text-xs">la capturas tú</span>}
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {f.fecha_vencimiento || <span className="text-slate-600">—</span>}
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

            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {termino
                    ? `Ningún pendiente de ${periodo} coincide con «${busqueda.trim()}».`
                    : `Ya se facturó todo lo que tocaba de ${periodo}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sinCondiciones.length > 0 && (
        <p className="px-5 py-3 border-t border-slate-700/50 text-xs text-slate-500 max-w-3xl">
          <span className="text-amber-300/90">
            {sinCondiciones.length} de estos servicios no tienen capturado cuándo se les factura.
          </span>{' '}
          Se pueden facturar igual —la fecha la escribes tú al registrarlos—, pero si dejas sus condiciones guardadas
          la plataforma te propone fecha e importe cada mes y puede decirte qué te falta.{' '}
          <Link href="/cobranza/inicio" className="text-cyan-400 hover:underline">
            Capturarlas de una vez
          </Link>
          .
        </p>
      )}
    </section>
  );
}
