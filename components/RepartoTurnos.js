import Link from 'next/link';
import { formatNumber } from '@/lib/utils';

/**
 * Cómo está armada una plantilla, no solo de cuántos es.
 *
 * Doce guardias en 24 HRS y doce en 12X12 son la misma cifra y dos operaciones
 * distintas: otra rotación, otra nómina, otros descansos. Por eso el reparto
 * por turno se muestra al lado del total y no escondido dentro de la ficha.
 *
 * Las barras van en proporción al turno más grande, no al total, porque lo que
 * se compara aquí es un turno contra otro.
 */
export default function RepartoTurnos({
  reparto,
  base = '',
  titulo = 'Guardias por turno',
  filtroActivo = '',
  ayuda = '',
  // En una columna estrecha las barras se leen mejor en lista; a lo ancho, en
  // rejilla, porque si no queda medio renglón vacío al lado.
  tira = false,
}) {
  const mayor = reparto.turnos[0]?.guardias || 1;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-white">{titulo}</h2>
        <p className="text-xs text-slate-500 tabular-nums">
          {formatNumber(reparto.total)} guardias en {reparto.turnos.length} modalidades
        </p>
      </div>
      <p className="text-slate-400 text-sm mb-4 max-w-3xl">
        {ayuda || (base ? 'Toca un turno para ver solo esos servicios.' : 'Cómo está repartida la operación.')}
      </p>

      <div className={tira ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2' : 'space-y-2'}>
        {reparto.turnos.map((t) => {
          const activo = filtroActivo === t.turno;
          const contenido = (
            <>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={activo ? 'text-cyan-300 font-medium' : 'text-slate-300'}>{t.turno}</span>
                <span className="text-slate-400 tabular-nums shrink-0">
                  {formatNumber(t.guardias)}
                  <span className="text-slate-600 text-xs ml-1.5">{t.pct}%</span>
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div
                  className={`h-full rounded-full ${activo ? 'bg-cyan-400' : 'bg-cyan-500/60'}`}
                  style={{ width: `${Math.max(2, (t.guardias / mayor) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(t.servicios)} servicio{t.servicios === 1 ? '' : 's'}
              </p>
            </>
          );

          const estilo = tira
            ? `block rounded-xl border px-3 py-2.5 transition-colors ${
                activo ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-800/20'
              }`
            : `block rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                activo ? 'bg-cyan-500/10' : ''
              }`;

          return base ? (
            <Link
              key={t.turno}
              href={activo ? base : `${base}${base.includes('?') ? '&' : '?'}turno=${encodeURIComponent(t.turno)}`}
              aria-current={activo ? 'true' : undefined}
              className={`${estilo} ${activo ? '' : 'hover:border-slate-500 hover:bg-slate-800/60'}`}
            >
              {contenido}
            </Link>
          ) : (
            <div key={t.turno} className={estilo}>
              {contenido}
            </div>
          );
        })}
      </div>

      {reparto.sinDesglose > 0 && (
        <p className="text-xs text-amber-300/80 mt-3 border-t border-slate-700/50 pt-3">
          {reparto.sinDesglose} servicio{reparto.sinDesglose === 1 ? '' : 's'} sin desglose capturado
          {reparto.guardiasSinDesglose > 0 && ` (${formatNumber(reparto.guardiasSinDesglose)} guardias)`}. Sus
          guardias cuentan en el total pero no aparecen en este reparto.
        </p>
      )}
    </section>
  );
}
