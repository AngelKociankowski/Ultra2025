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
  /**
   * La versión de una sola banda, para cuando este panel no es la pantalla
   * sino la antesala de otra.
   *
   * En el estado de fuerza el reparto ocupaba cuatrocientos píxeles antes de
   * que empezara la tabla: ocho tarjetas con su barra, su porcentaje y su
   * conteo de servicios. La tabla —que es a lo que se entra— quedaba debajo del
   * pliegue, así que cada visita empezaba con un desplazamiento.
   *
   * Aquí va la misma información en chips: el turno, sus guardias y su
   * porcentaje, con una línea fina debajo que conserva la comparación de un
   * turno contra otro. Se pierden los conteos de servicios por turno, que
   * siguen a un clic de distancia porque cada chip filtra la tabla.
   */
  compacto = false,
}) {
  const mayor = reparto.turnos[0]?.guardias || 1;

  return (
    <section className={`bg-slate-800/30 border border-slate-700/50 rounded-2xl ${compacto ? 'p-3' : 'p-5'}`}>
      {compacto ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
          <h2 className="text-sm font-semibold text-white">{titulo}</h2>
          <p className="text-xs text-slate-500 tabular-nums">
            {formatNumber(reparto.total)} guardias en {reparto.turnos.length} modalidades ·{' '}
            {base ? 'toca uno para ver solo esos servicios' : 'cómo está repartida la operación'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h2 className="text-lg font-semibold text-white">{titulo}</h2>
            <p className="text-xs text-slate-500 tabular-nums">
              {formatNumber(reparto.total)} guardias en {reparto.turnos.length} modalidades
            </p>
          </div>
          <p className="text-slate-400 text-sm mb-4 max-w-3xl">
            {ayuda || (base ? 'Toca un turno para ver solo esos servicios.' : 'Cómo está repartida la operación.')}
          </p>
        </>
      )}

      {compacto ? (
        <div className="flex flex-wrap gap-1.5">
          {reparto.turnos.map((t) => {
            const activo = filtroActivo === t.turno;
            const chip = (
              <>
                <span className="flex items-baseline gap-1.5">
                  <span className={activo ? 'text-cyan-300 font-medium' : 'text-slate-300'}>{t.turno}</span>
                  <span className="tabular-nums text-slate-400">{formatNumber(t.guardias)}</span>
                  <span className="tabular-nums text-slate-600 text-[11px]">{t.pct}%</span>
                </span>
                <span className="block h-0.5 rounded-full bg-slate-700/70 mt-1 overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${activo ? 'bg-cyan-400' : 'bg-cyan-500/50'}`}
                    style={{ width: `${Math.max(4, (t.guardias / mayor) * 100)}%` }}
                  />
                </span>
              </>
            );
            const estilo = `rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
              activo
                ? 'border-cyan-500/60 bg-cyan-500/10'
                : 'border-slate-700/60 hover:border-slate-500 hover:bg-slate-800/50'
            }`;
            return base ? (
              <Link
                key={t.turno}
                href={activo ? base : `${base}${base.includes('?') ? '&' : '?'}turno=${encodeURIComponent(t.turno)}`}
                aria-current={activo ? 'true' : undefined}
                title={`${formatNumber(t.servicios)} servicio${t.servicios === 1 ? '' : 's'}`}
                className={estilo}
              >
                {chip}
              </Link>
            ) : (
              <span key={t.turno} className={estilo}>
                {chip}
              </span>
            );
          })}
        </div>
      ) : (
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
      )}

      {reparto.sinDesglose > 0 && (
        <p className="text-xs text-amber-300/80 mt-3 border-t border-slate-700/50 pt-3">
          {reparto.sinDesglose} servicio{reparto.sinDesglose === 1 ? '' : 's'} sin desglose capturado
          {reparto.guardiasSinDesglose > 0 && ` (${formatNumber(reparto.guardiasSinDesglose)} guardias)`}. Sus
          guardias cuentan en el total pero no aparecen en este reparto.
        </p>
      )}

      {/* Cuando el desglose no cuadra con la plantilla, decirlo importa más que
          la gráfica. Las barras salen bien dibujadas de todos modos —cada una
          suma lo suyo— y el número de abajo deja de ser el del estado de fuerza
          sin que nada lo anuncie. Un reparto que no suma el total es un reparto
          en el que no se puede confiar, y callarlo lo vuelve peor que no
          tenerlo. */}
      {reparto.descuadrados?.length > 0 && (
        <div className="text-xs mt-3 border-t border-slate-700/50 pt-3">
          <p className="text-red-400">
            Este reparto suma <strong>{formatNumber(reparto.total + reparto.guardiasSinDesglose)}</strong> guardias
            y el estado de fuerza dice <strong>{formatNumber(reparto.totalPlantilla)}</strong>.
          </p>
          <p className="text-slate-500 mt-1">
            {reparto.descuadrados.length} servicio{reparto.descuadrados.length === 1 ? '' : 's'} con el desglose
            descuadrado. Mientras no se corrijan, los porcentajes de arriba están repartiendo guardias que la
            plantilla no tiene:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {reparto.descuadrados.slice(0, 6).map((d) => (
              <li key={d.id ?? d.servicio} className="flex justify-between gap-3 text-slate-400">
                {d.id ? (
                  <Link href={`/estado-fuerza/${d.id}`} className="hover:text-white hover:underline truncate">
                    {d.servicio}
                  </Link>
                ) : (
                  <span className="truncate">{d.servicio}</span>
                )}
                <span className="whitespace-nowrap text-slate-500">
                  plantilla {d.plantilla} · desglose {d.desglose}
                </span>
              </li>
            ))}
          </ul>
          {reparto.descuadrados.length > 6 && (
            <p className="text-slate-600 mt-1">y {reparto.descuadrados.length - 6} más.</p>
          )}
        </div>
      )}
    </section>
  );
}
