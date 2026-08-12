'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNumber } from '@/lib/utils';
import Icono from '@/components/Icono';

/**
 * Poner el servicio en pausa, o devolverlo a la operación.
 *
 * La diferencia con cancelar no es de forma. Una cancelación afirma que el
 * cliente se fue: sale en las gráficas de bajas del mes, en el neto contra las
 * aperturas y en el reporte de motivos. Suspender dice que paró y va a volver,
 * y eso no es una baja: el servicio conserva su plantilla, su precio y su
 * contrato, y lo único que cambia es que deja de contar mientras tanto.
 */
export default function Suspension({ servicio, puedeMover }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const suspendido = servicio.estatus === 'SUSPENDIDO';
  if (servicio.estatus === 'BAJA') return null;

  async function llamar(metodo, cuerpo) {
    setEnviando(true);
    setError('');
    try {
      const r = await fetch(`/api/servicios/${servicio.id}/suspension`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo.');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  function suspender() {
    const motivo = prompt(
      `Suspender ${servicio.servicio}\n\n` +
        `Sus ${servicio.total_guardias} guardias dejan de contar en el estado de fuerza, y no se le va a proponer ` +
        'facturar ni entra a la revisión anual de precios. Conserva su plantilla, su precio y su contrato.\n\n' +
        'Esto NO es una cancelación: no aparece como baja del mes. Si el cliente ya no vuelve, registra una ' +
        'cancelación en su lugar.\n\n¿Por qué se suspende?'
    );
    if (motivo === null) return;
    llamar('POST', { motivo });
  }

  function reactivar() {
    if (
      !confirm(
        `Reactivar ${servicio.servicio}\n\n` +
          `Vuelve al estado de fuerza con sus ${servicio.total_guardias} guardias, tal como estaba.\n\n¿Seguimos?`
      )
    ) {
      return;
    }
    llamar('DELETE', {});
  }

  return (
    <section
      className={`rounded-2xl border p-5 ${
        suspendido ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800/30 border-slate-700/50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-base font-semibold ${suspendido ? 'text-amber-300' : 'text-white'}`}>
            {suspendido ? 'Servicio suspendido' : 'Pausar el servicio'}
          </h2>
          {suspendido ? (
            <p className="text-xs text-amber-400 max-w-2xl mt-0.5">
              En pausa desde <strong>{servicio.suspendido_desde}</strong>. Sus{' '}
              {formatNumber(servicio.total_guardias)} guardias no cuentan en el estado de fuerza y no se le está
              facturando. La plantilla, el precio y el contrato siguen como estaban.
              {servicio.suspendido_motivo && (
                <span className="block mt-1 text-amber-300">«{servicio.suspendido_motivo}»</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
              Cuando el cliente para el servicio y va a volver. Deja de contar en el estado de fuerza sin registrar
              una baja, porque en la calle nadie se fue: el servicio conserva todo y se reactiva cuando regresa.
            </p>
          )}
        </div>
        {puedeMover && (
          <button
            type="button"
            onClick={suspendido ? reactivar : suspender}
            disabled={enviando}
            className={`text-sm rounded-lg px-3 py-2 whitespace-nowrap disabled:opacity-50 ${
              suspendido
                ? 'bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco'
                : 'bg-slate-700 hover:bg-slate-600 text-white'
            }`}
          >
            {enviando ? 'Un momento…' : suspendido ? <><Icono nombre="reanudar" className="mr-1.5 -mt-0.5" />Reactivar el servicio</> : <><Icono nombre="pausa" className="mr-1.5 -mt-0.5" />Suspender</>}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
    </section>
  );
}
