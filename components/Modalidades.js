import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { MODALIDADES } from '@/lib/modalidades';

const TONO = {
  slate: { texto: 'text-slate-300', barra: 'bg-slate-500/60' },
  cyan: { texto: 'text-cyan-300', barra: 'bg-cyan-500/70' },
  violet: { texto: 'text-violet-300', barra: 'bg-violet-500/70' },
};

/**
 * Fijos, temporales y de evento.
 *
 * La distinción existía en el movimiento de apertura y se perdía al aplicarlo:
 * el servicio temporal quedaba idéntico a uno permanente. Aquí es donde se ve
 * —y sobre todo, donde se ve el que ya pasó su fecha y sigue contando.
 *
 * Un temporal vencido no es una etiqueta mal puesta: es un servicio que se
 * sigue sumando al estado de fuerza, al que se le sigue proponiendo factura y
 * que entra a la revisión anual de precios, después de haber terminado.
 */
export default function Modalidades({ datos }) {
  const porClave = Object.fromEntries(datos.filas.map((f) => [f.modalidad, f]));
  const total = datos.filas.reduce((a, f) => a + f.servicios, 0) || 1;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-white">Fijos y temporales</h2>
      </div>
      <p className="text-slate-400 text-sm mb-4">Qué parte de la operación tiene fecha de término.</p>

      <div className="space-y-2">
        {Object.entries(MODALIDADES).map(([clave, m]) => {
          const d = porClave[clave] || { servicios: 0, guardias: 0, facturacion: 0 };
          const tono = TONO[m.tono] || TONO.slate;
          return (
            <Link
              key={clave}
              href={`/estado-fuerza?modalidad=${clave}`}
              className="block rounded-lg px-2 py-1.5 -mx-2 hover:bg-slate-800/60 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={tono.texto}>{m.etiqueta}</span>
                <span className="text-slate-400 tabular-nums shrink-0">
                  {formatNumber(d.servicios)}
                  <span className="text-slate-600 text-xs ml-1.5">
                    {formatNumber(d.guardias)} guardias
                  </span>
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div
                  className={`h-full rounded-full ${tono.barra}`}
                  style={{ width: `${Math.max(2, (d.servicios / total) * 100)}%` }}
                />
              </div>
              {d.facturacion > 0 && (
                <p className="text-[11px] text-slate-500 mt-0.5">{formatCurrency(d.facturacion)}/mes</p>
              )}
            </Link>
          );
        })}
      </div>

      {datos.vencidos.length > 0 && (
        <div className="text-xs mt-3 border-t border-slate-700/50 pt-3">
          <p className="text-red-400">
            {formatNumber(datos.vencidos.length)} ya pasaron su fecha de término y siguen contando.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {datos.vencidos.slice(0, 5).map((s) => (
              <li key={s.id} className="flex justify-between gap-3 text-slate-400">
                <Link href={`/estado-fuerza/${s.id}`} className="hover:text-white hover:underline truncate">
                  {s.servicio}
                </Link>
                <span className="whitespace-nowrap text-slate-500">terminó {s.fecha_fin_prevista}</span>
              </li>
            ))}
          </ul>
          {datos.vencidos.length > 5 && (
            <p className="text-slate-600 mt-1">y {datos.vencidos.length - 5} más.</p>
          )}
        </div>
      )}

      {/* Antes de esta revisión no había dónde decirlo, así que todo lo que ya
          estaba quedó como fijo. Callarlo haría creer que la operación no tiene
          ningún temporal, cuando lo que pasa es que nadie ha podido marcarlos. */}
      {datos.filas.every((f) => f.modalidad === 'FIJO') && (
        <p className="text-xs text-slate-500 mt-3 border-t border-slate-700/50 pt-3">
          Todos los servicios están como fijos porque hasta ahora no había dónde marcar lo contrario. Los que abras
          como temporales de aquí en adelante entran solos; los que ya estaban se marcan desde su ficha.
        </p>
      )}

      {datos.sinFecha > 0 && (
        <p className="text-xs text-amber-300/80 mt-3 border-t border-slate-700/50 pt-3">
          {formatNumber(datos.sinFecha)} servicio{datos.sinFecha === 1 ? '' : 's'} no {datos.sinFecha === 1 ? 'es' : 'son'} fijo
          {datos.sinFecha === 1 ? '' : 's'} pero no {datos.sinFecha === 1 ? 'tiene' : 'tienen'} fecha de término
          capturada. De {datos.sinFecha === 1 ? 'ese' : 'esos'} no se puede avisar nada.
        </p>
      )}
    </section>
  );
}
