'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * El botón que termina una apertura que quedó a medias.
 *
 * Antes de mandarla avisa lo que va a pasar en números —cuántos guardias se
 * suman— y, si la apertura es vieja, que ese servicio puede llevar tiempo sin
 * operar: aplicarla lo daría de alta hoy como si siguiera vivo.
 */
export default function AplicarApertura({ apertura, vieja }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function aplicar() {
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
      'Si te equivocas se corrige con una cancelación, no se borra.',
    ]
      .filter(Boolean)
      .join('\n');
    if (!confirm(aviso)) return;

    setEnviando(true);
    setError('');
    try {
      const r = await fetch(`/api/aperturas/${apertura.id}/aplicar`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error || 'No se pudo aplicar.');
        return;
      }
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={aplicar}
        disabled={enviando}
        title="Crear el servicio en el estado de fuerza con los datos de esta apertura"
        className="text-xs rounded-lg px-2 py-1 bg-amber-500/15 text-amber-300 border border-amber-500/30
                   hover:bg-amber-500/25 disabled:opacity-50 whitespace-nowrap"
      >
        {enviando ? 'Aplicando…' : 'Pendiente · Aplicar'}
      </button>
      {error && <p className="text-[11px] text-red-400 max-w-[220px]">{error}</p>}
    </div>
  );
}
