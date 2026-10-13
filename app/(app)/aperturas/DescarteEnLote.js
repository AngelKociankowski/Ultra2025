'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNumber } from '@/lib/utils';
import TablaMovimientos from '@/components/TablaMovimientos';

/**
 * Cerrar de un golpe el arrastre de aperturas que no se van a aplicar.
 *
 * Es la salida al problema que tenía el aviso de Aperturas encendido en 219 para
 * siempre: la mayoría de esas aperturas vinieron de la importación y describen
 * servicios que hace años no operan. Aplicarlas crearía doscientos servicios
 * que no están en la calle; descartarlas de una en una son doscientos clics con
 * el motivo tecleado doscientas veces, que es lo mismo que no tener la salida.
 *
 * Tres cosas que lo hacen reversible y responsable, y ninguna es decorativa:
 *
 *   · El motivo se escribe una vez y queda en todas, igual que si se hubieran
 *     descartado a mano. Sin él el servidor responde 400.
 *   · El botón dice el número exacto, y hay una confirmación con ese número
 *     antes de mandar. Técnicamente cada una se devuelve a la cola con
 *     «Devolver a pendientes», pero devolver doscientas a mano no es una salida:
 *     la protección real es no equivocarse al mandar.
 *   · No se ofrece «descartar todas» sin haber filtrado antes. Esta barra solo
 *     aparece en la cola de las viejas, que es la que ya está acotada a lo que
 *     el corte dejó del otro lado.
 */
export default function DescarteEnLote({ movimientos, opciones, tope }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [motivo, setMotivo] = useState('');
  const [estado, setEstado] = useState(null);
  const [enviando, setEnviando] = useState(false);

  // Solo las que de verdad se pueden descartar: una ya aplicada o ya descartada
  // la rechazaría el servidor, y ofrecerla haría que el lote reportara fallidas
  // que la propia pantalla provocó.
  const descartables = movimientos.filter((m) => !m.servicio_id && !m.descartada);
  const visibles = descartables.slice(0, tope);

  function alternar(id) {
    setEstado(null);
    setMarcadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function todas() {
    setEstado(null);
    setMarcadas(marcadas.size === visibles.length ? new Set() : new Set(visibles.map((m) => m.id)));
  }

  async function descartar() {
    const ids = [...marcadas];
    if (!ids.length) {
      setEstado({ tipo: 'error', texto: 'No hay ninguna apertura marcada.' });
      return;
    }
    if (motivo.trim().length < 5) {
      setEstado({ tipo: 'error', texto: 'Escribe por qué no se van a aplicar. El mismo motivo queda en todas.' });
      return;
    }
    if (
      !window.confirm(
        `Se van a descartar ${ids.length} apertura${ids.length === 1 ? '' : 's'}. ` +
          'Salen de la cuenta de pendientes y no se borran del histórico: cada una se puede devolver a la cola. ¿Seguimos?'
      )
    ) {
      return;
    }

    setEnviando(true);
    setEstado(null);
    try {
      const res = await fetch('/api/aperturas/descartar-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, motivo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEstado({ tipo: 'error', texto: data.error || 'No se pudo descartar el lote.' });
        return;
      }
      const fallidas = data.fallidas || [];
      setEstado({
        tipo: fallidas.length ? 'parcial' : 'ok',
        texto:
          `${formatNumber(data.descartadas)} descartada${data.descartadas === 1 ? '' : 's'}.` +
          (fallidas.length
            ? ` ${fallidas.length} se quedó fuera: ${fallidas.map((f) => `#${f.id} ${f.error}`).join(' · ')}`
            : ''),
      });
      setMarcadas(new Set());
      setMotivo('');
      router.refresh();
    } catch {
      setEstado({ tipo: 'error', texto: 'Error de red.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Cerrar el arrastre de una vez</h2>
            <p className="text-xs text-slate-500 max-w-3xl mt-0.5">
              Descartar no borra nada: la apertura se anotó en su día y eso es parte del histórico. Solo deja de
              contarse como pendiente, y cada una se puede devolver a la cola si alguna resulta buena.
            </p>
          </div>
          <button
            type="button"
            onClick={todas}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
          >
            {marcadas.size === visibles.length && visibles.length > 0
              ? 'Quitar la selección'
              : `Seleccionar las ${formatNumber(visibles.length)} visibles`}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <label htmlFor="motivo-lote" className="block text-xs text-slate-400 mb-1">
              Por qué no se van a aplicar (queda en todas)
            </label>
            <input
              id="motivo-lote"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="La importación trajo movimientos de servicios que ya no operan."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={descartar}
            disabled={enviando || marcadas.size === 0}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-ultra-blanco text-sm rounded-lg px-4 py-2 whitespace-nowrap"
          >
            {enviando
              ? 'Descartando…'
              : `Descartar ${formatNumber(marcadas.size)} apertura${marcadas.size === 1 ? '' : 's'}`}
          </button>
        </div>

        {descartables.length > tope && (
          <p className="text-xs text-slate-500">
            Un lote admite hasta {formatNumber(tope)} de una llamada, y aquí hay {formatNumber(descartables.length)}.
            «Seleccionar las visibles» marca las primeras {formatNumber(tope)}; las demás quedan para un segundo lote.
          </p>
        )}

        {estado && (
          <p
            className={`text-sm rounded-lg px-3 py-2 border ${
              estado.tipo === 'ok'
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                : estado.tipo === 'parcial'
                  ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                  : 'text-red-300 bg-red-500/10 border-red-500/30'
            }`}
          >
            {estado.texto}
          </p>
        )}
      </div>

      <TablaMovimientos
        clase="aperturas"
        movimientos={movimientos}
        puedeAplicar
        opciones={opciones}
        seleccion={{ marcadas, alternar }}
      />
    </div>
  );
}
