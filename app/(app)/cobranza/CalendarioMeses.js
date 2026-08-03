import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * El año de facturación de un vistazo.
 *
 * Antes había que escribir el mes a mano para saber qué tenía. Un calendario
 * dice lo mismo sin teclear nada y contesta la pregunta que de verdad se hace
 * en cobranza —«¿de qué mes me falta facturar?»— sin tener que ir mes por mes
 * a averiguarlo.
 *
 * El color no es decoración: verde es que no falta ninguna, ámbar que va a
 * medias, rojo que no se ha emitido nada de un mes que ya pasó. Los meses que
 * todavía no llegan se ven apagados, porque no deberle nada al futuro no es un
 * pendiente.
 */

const TONO = {
  completo: 'border-emerald-500/40 bg-emerald-500/10',
  parcial: 'border-amber-500/40 bg-amber-500/10',
  pendiente: 'border-red-500/40 bg-red-500/10',
  vacio: 'border-slate-700/60 bg-slate-800/20',
  sin_registro: 'border-slate-700/60 bg-slate-800/20',
};

const TEXTO = {
  completo: 'text-emerald-300',
  parcial: 'text-amber-300',
  pendiente: 'text-red-300',
  vacio: 'text-slate-500',
  sin_registro: 'text-slate-600',
};

export default function CalendarioMeses({ calendario, seleccionado }) {
  const { anio, meses } = calendario;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Calendario de facturación</h2>
          <p className="text-xs text-slate-500">
            Elige el mes que quieres trabajar. El color dice si ya está facturado, si va a medias o si no se ha
            emitido nada.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/cobranza?periodo=${anio - 1}-01`}
            className="text-sm text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-700/40"
            aria-label={`Año ${anio - 1}`}
          >
            ‹
          </Link>
          <span className="text-lg font-semibold text-white tabular-nums px-1">{anio}</span>
          <Link
            href={`/cobranza?periodo=${anio + 1}-01`}
            className="text-sm text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-700/40"
            aria-label={`Año ${anio + 1}`}
          >
            ›
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {meses.map((m) => {
          const activo = m.periodo === seleccionado;
          return (
            <Link
              key={m.periodo}
              href={`/cobranza?periodo=${m.periodo}`}
              aria-current={activo ? 'true' : undefined}
              className={`rounded-xl border px-3 py-2.5 transition-colors ${TONO[m.estado]} ${
                activo ? 'ring-2 ring-cyan-500' : 'hover:border-slate-500'
              } ${m.futuro || m.estado === 'sin_registro' ? 'opacity-60' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className={`text-sm font-medium ${activo ? 'text-white' : 'text-slate-300'}`}>
                  {MESES[m.mes - 1]}
                </span>
                <span className={`text-[11px] tabular-nums ${TEXTO[m.estado]}`}>
                  {m.estado === 'sin_registro' ? '' : `${m.emitidas}/${m.esperadas}`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 tabular-nums truncate">
                {m.emitidas > 0
                  ? formatCurrency(m.importe)
                  : m.futuro
                  ? 'por venir'
                  : m.estado === 'sin_registro'
                  ? 'sin registro'
                  : '—'}
              </p>
              {m.faltan > 0 && !m.futuro && (
                <p className={`text-[11px] ${TEXTO[m.estado]}`}>faltan {m.faltan}</p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/60 mr-1.5" />
          facturado completo
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-amber-500/60 mr-1.5" />a medias
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-red-500/60 mr-1.5" />
          sin emitir
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-slate-600/60 mr-1.5" />
          anterior a la primera factura registrada
        </span>
        <span className="text-slate-600">emitidas / esperadas</span>
      </div>
    </section>
  );
}
