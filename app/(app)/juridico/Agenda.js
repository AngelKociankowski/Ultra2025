import { formatCurrency, formatNumber } from '@/lib/utils';
import { nombreMes } from './formato';

/**
 * La agenda de renovaciones: cuántos contratos vencen cada mes de aquí en
 * adelante.
 *
 * Con los datos de hoy, octubre trae 15 vencimientos y marzo del 27 trae 21.
 * Saberlo con meses de anticipación es la diferencia entre renovar a tiempo y
 * enterarse cuando el contrato ya venció —que es exactamente lo que le pasó a
 * los 58 que hoy están vencidos.
 *
 * Los meses vacíos se dibujan igual. Un hueco también es información: ese mes
 * no hay nada que renovar.
 */
export default function Agenda({ agenda }) {
  const tope = Math.max(1, ...agenda.meses.map((m) => m.servicios));

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Agenda de renovaciones</h2>
          <p className="text-xs text-slate-500">
            Cuándo vence cada contrato vigente, mes por mes. Se cuenta desde el mes en curso.
          </p>
        </div>
        {agenda.vencidos.servicios > 0 && (
          <p className="text-xs text-red-400">
            Otros {formatNumber(agenda.vencidos.servicios)} ya vencieron y no caben en una agenda hacia adelante:
            esos se renuevan hoy, no dentro de unos meses.
          </p>
        )}
      </div>

      <div className="flex items-end gap-1 overflow-x-auto pb-1">
        {agenda.meses.map((m, i) => {
          const { mes, anio } = nombreMes(m.mes);
          const alto = m.servicios === 0 ? 3 : Math.max(8, Math.round((m.servicios / tope) * 96));
          // El primer mes es el que corre: los contratos que vencen este mes ya
          // no dan tiempo de mucho, y por eso van en ámbar y no en cian.
          const color = m.servicios === 0 ? 'bg-slate-700/40' : i === 0 ? 'bg-amber-500/70' : i <= 2 ? 'bg-amber-500/40' : 'bg-cyan-500/50';
          return (
            <div key={m.mes} className="flex-1 min-w-[42px] flex flex-col items-center gap-1">
              <span className={`text-[11px] ${m.servicios ? 'text-slate-300' : 'text-slate-600'}`}>
                {m.servicios || ''}
              </span>
              <div
                title={
                  m.servicios
                    ? `${m.servicios} contrato${m.servicios === 1 ? '' : 's'} · ${formatNumber(m.guardias)} guardias · ${formatCurrency(m.monto)}/mes`
                    : 'Ningún vencimiento este mes'
                }
                className={`w-full rounded-t ${color}`}
                style={{ height: `${alto}px` }}
              />
              <span className="text-[10px] text-slate-500 whitespace-nowrap">
                {mes}
                {/* El año solo se repite cuando cambia: repetirlo en los doce
                    meses es ruido, y omitirlo del todo deja la barra ambigua
                    en cuanto la agenda cruza diciembre. */}
                {(mes === 'ene' || i === 0) && <span className="block text-center">{anio.slice(2)}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {agenda.despues > 0 && (
        <p className="text-xs text-slate-500 mt-3">
          Otros {formatNumber(agenda.despues)} vencen más allá de este periodo.
        </p>
      )}
    </section>
  );
}
