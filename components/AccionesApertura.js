'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Lo que se puede hacer con una apertura desde la lista.
 *
 * Son tres botones y responden a tres situaciones distintas, que antes se
 * confundían en una sola:
 *
 *   - **Aplicar**: la apertura está anotada y su servicio nunca se creó.
 *   - **Deshacer**: se aplicó y no debía. Quita el servicio del estado de
 *     fuerza sin inventar una cancelación, porque en la calle no se fue nadie.
 *   - **Descartar**: no se va a aplicar nunca. Sale de la cola de pendientes
 *     sin borrarse del histórico.
 *
 * La diferencia entre deshacer y cancelar no es de forma. Una cancelación dice
 * que el cliente se fue: aparece en las gráficas del mes, en el neto contra las
 * aperturas y en el reporte de motivos. Deshacer dice que la captura estuvo
 * mal, y eso no es un movimiento del negocio.
 */
export default function AccionesApertura({ apertura, vieja, aplicada, descartada }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');

  async function llamar(ruta, opciones = {}) {
    setOcupado(ruta);
    setError('');
    try {
      const r = await fetch(`/api/aperturas/${apertura.id}/${ruta}`, {
        method: opciones.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(opciones.cuerpo ? { body: JSON.stringify(opciones.cuerpo) } : {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo.');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setOcupado('');
    }
  }

  function aplicar() {
    const aviso = [
      `Aplicar ${apertura.folio} — ${apertura.servicio}`,
      '',
      `Se suma${apertura.guardias === 1 ? '' : 'n'} ${apertura.guardias} guardia${
        apertura.guardias === 1 ? '' : 's'
      } al estado de fuerza.`,
      vieja
        ? `\nOjo: esta apertura es de ${apertura.fecha || apertura.periodo}. Si el servicio ya no opera, no la apliques: quedaría activo y contando guardias.`
        : '',
      '',
      'Si te equivocas, el botón Deshacer lo revierte mientras el servicio no haya facturado.',
    ]
      .filter(Boolean)
      .join('\n');
    if (confirm(aviso)) llamar('aplicar');
  }

  function deshacer() {
    const motivo = prompt(
      `Deshacer ${apertura.folio} — ${apertura.servicio}\n\n` +
        'El servicio sale del estado de fuerza y la apertura vuelve a quedar pendiente. ' +
        'NO se registra una cancelación: esto es para lo que se aplicó por error, no para un cliente que se fue.\n\n' +
        '¿Por qué se deshace?'
    );
    if (motivo === null) return;
    llamar('deshacer', { cuerpo: { motivo } });
  }

  function descartar() {
    const motivo = prompt(
      `Descartar ${apertura.folio} — ${apertura.servicio}\n\n` +
        'Deja de contar como pendiente. La apertura no se borra: sigue en el histórico, marcada como que no se aplicará.\n\n' +
        '¿Por qué no se va a aplicar?'
    );
    if (motivo === null) return;
    llamar('descartar', { cuerpo: { motivo } });
  }

  const boton = 'text-xs rounded-lg px-2 py-1 border disabled:opacity-50 whitespace-nowrap';

  return (
    <span className="space-y-1 inline-block" onClick={(e) => e.stopPropagation()}>
      <span className="flex flex-wrap gap-1">
        {aplicada ? (
          <button
            type="button"
            onClick={deshacer}
            disabled={!!ocupado}
            title="Quitarlo del estado de fuerza sin registrar una cancelación"
            className={`${boton} bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700`}
          >
            {ocupado === 'deshacer' ? 'Deshaciendo…' : '↩ Deshacer'}
          </button>
        ) : descartada ? (
          <button
            type="button"
            onClick={() => llamar('descartar', { method: 'DELETE' })}
            disabled={!!ocupado}
            title="Devolverla a la cola de pendientes"
            className={`${boton} bg-slate-700/40 text-slate-400 border-slate-700 hover:bg-slate-700/70`}
          >
            {ocupado === 'descartar' ? 'Devolviendo…' : 'Devolver a pendientes'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={aplicar}
              disabled={!!ocupado}
              title="Crear el servicio en el estado de fuerza con los datos de esta apertura"
              className={`${boton} bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25`}
            >
              {ocupado === 'aplicar' ? 'Aplicando…' : 'Aplicar'}
            </button>
            <button
              type="button"
              onClick={descartar}
              disabled={!!ocupado}
              title="No se va a aplicar: sale de la cola de pendientes"
              className={`${boton} bg-transparent text-slate-500 border-slate-700/60 hover:text-slate-300`}
            >
              Descartar
            </button>
          </>
        )}
      </span>
      {error && <span className="block text-[11px] text-red-400 max-w-[220px]">{error}</span>}
    </span>
  );
}
