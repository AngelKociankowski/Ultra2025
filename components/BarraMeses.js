import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/utils';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * El año de movimientos, mes por mes.
 *
 * Es el mismo gesto que hace cualquiera con un archivero: primero se escoge el
 * mes y luego se mira lo que hay dentro. Cada casilla ya dice cuántos
 * movimientos y cuántos guardias trae, así que la mitad de las preguntas se
 * contestan sin abrir nada.
 *
 * Los meses vacíos se ven apagados pero se pueden abrir: que un mes no tenga
 * movimientos es en sí una respuesta.
 */
export default function BarraMeses({ ruta, calendario, seleccionado, anios = [], tono = 'emerald' }) {
  const { anio, meses, total } = calendario;
  const color = tono === 'red' ? 'text-red-300' : 'text-emerald-300';
  const activo =
    tono === 'red' ? 'border-red-500/50 bg-red-500/15' : 'border-emerald-500/50 bg-emerald-500/15';

  const conArgs = (p) => `${ruta}?periodo=${p}`;
  const anioAnterior = anio - 1;
  const anioSiguiente = anio + 1;
  const hay = (a) => anios.includes(a);

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Movimientos de {anio}</h2>
          <p className="text-xs text-slate-500">
            {formatNumber(total.movimientos)} en el año · {formatNumber(total.guardias)} guardias
            {total.monto > 0 && ` · ${formatCurrency(total.monto)} al mes`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={conArgs(`${anioAnterior}-01`)}
            className={`text-sm px-2.5 py-1.5 rounded-lg hover:bg-slate-700/40 ${
              hay(anioAnterior) ? 'text-slate-400 hover:text-white' : 'text-slate-600'
            }`}
            aria-label={`Año ${anioAnterior}`}
          >
            ‹
          </Link>
          <span className="text-lg font-semibold text-white tabular-nums px-1">{anio}</span>
          <Link
            href={conArgs(`${anioSiguiente}-01`)}
            className={`text-sm px-2.5 py-1.5 rounded-lg hover:bg-slate-700/40 ${
              hay(anioSiguiente) ? 'text-slate-400 hover:text-white' : 'text-slate-600'
            }`}
            aria-label={`Año ${anioSiguiente}`}
          >
            ›
          </Link>
          <Link
            href={`${ruta}?periodo=todo`}
            className={`ml-2 text-xs rounded-lg px-3 py-2 ${
              seleccionado === 'todo'
                ? 'bg-slate-600 text-white'
                : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Todo el histórico
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {meses.map((m) => {
          const esta = m.periodo === seleccionado;
          const vacio = m.movimientos === 0;
          return (
            <Link
              key={m.periodo}
              href={conArgs(m.periodo)}
              className={`rounded-xl border p-2.5 transition-colors ${
                esta ? activo : vacio ? 'border-slate-700/60 bg-slate-800/20 hover:bg-slate-800/40' : 'border-slate-700/60 bg-slate-800/40 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-xs font-medium ${esta ? 'text-white' : 'text-slate-400'}`}>
                  {MESES[m.mes - 1]}
                </span>
                <span className={`text-sm font-bold tabular-nums ${vacio ? 'text-slate-600' : color}`}>
                  {m.movimientos || '—'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {m.guardias ? `${formatNumber(m.guardias)} guardias` : m.futuro ? 'aún no' : 'sin movimientos'}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
