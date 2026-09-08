import { formatNumber } from '@/lib/utils';

/**
 * Cuántos guardias hay de mañana, de noche y mixtos.
 *
 * Es la pregunta que la plataforma no sabía contestar: sabía la jornada —el
 * patrón de días— pero no a qué hora se cubre, y son dos cosas distintas. Una
 * plantilla de 12X36 puede ser toda diurna o mitad y mitad, y lo que cuesta
 * cubrir la noche no es lo que cuesta cubrir la mañana.
 *
 * Lo que más importa de este panel es lo que dice cuando todavía no sabe nada.
 * Este dato se empezó a pedir con 217 servicios ya capturados, así que durante
 * un buen rato lo normal será que casi todo esté sin repartir. Un panel que
 * enseñara solo lo capturado daría porcentajes impecables sobre el 3% de la
 * operación, y quien lo lea creería estar viendo el total —que es la manera más
 * silenciosa que tiene un tablero de mentir—. Por eso los porcentajes van sobre
 * la plantilla entera y lo que falta se dice con su número.
 */
export default function TurnosDelDia({ datos }) {
  const { turnos, conDetalle, sinDetalle, total } = datos;
  const mayor = Math.max(1, ...turnos.map((t) => t.guardias));

  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">Guardias por turno</h2>
        <span className="text-xs text-slate-500">matutino · nocturno · mixto</span>
      </div>

      {conDetalle === 0 ? (
        <div className="text-sm text-slate-400">
          <p>Todavía no se ha capturado el turno de ningún servicio.</p>
          <p className="text-slate-500 text-xs mt-1.5">
            Se captura al abrir un servicio o al ampliarlo, debajo del desglose por jornada. Los{' '}
            {formatNumber(total)} guardias que ya están registrados no lo traen, porque el dato se
            empezó a pedir después.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {turnos.map((t) => (
              <li key={t.turno}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-300">{t.turno}</span>
                  <span className="text-slate-400">
                    {formatNumber(t.guardias)} <span className="text-slate-600">· {t.pct}%</span>
                  </span>
                </div>
                <div className="h-1.5 bg-slate-700/40 rounded-full mt-1 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500/70 rounded-full"
                    style={{ width: `${(t.guardias / mayor) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {sinDetalle > 0 && (
            <p className="text-xs text-slate-500 mt-3 border-t border-slate-700/50 pt-2.5">
              Faltan <strong className="text-slate-400">{formatNumber(sinDetalle)}</strong> de{' '}
              {formatNumber(total)} guardias por capturar el turno. Los porcentajes de arriba están
              calculados sobre el total, así que suman menos de 100 a propósito.
            </p>
          )}
        </>
      )}
    </div>
  );
}
