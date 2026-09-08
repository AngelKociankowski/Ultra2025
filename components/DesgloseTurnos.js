'use client';

/**
 * A qué hora se cubre cada jornada.
 *
 * La plataforma preguntaba la jornada —12X36, 24 HRS, 8X16 L-V— y le llamaba
 * «turno». Al revisar el sistema la operación pidió lo que faltaba: «faltan los
 * turnos, que deben de ser Matutino, Nocturno y Mixto». Son dos preguntas
 * distintas y hacen falta las dos: la jornada dice el patrón de días, el turno
 * dice la hora, y lo que cuesta cubrir la noche no es lo que cuesta cubrir la
 * mañana.
 *
 * Tres decisiones de forma que hacen que esto se use:
 *
 *   1. Solo aparecen las jornadas que ya tienen guardias. Ofrecer el reparto de
 *      las veinte llenaría la pantalla de casillas vacías y volvería invisible
 *      la que sí importa.
 *
 *   2. Es opcional, y se dice. Hay 217 servicios capturados sin este dato:
 *      exigirlo convertiría cualquier alta en una discusión sobre algo que
 *      quizá quien captura no sabe en ese momento. Media jornada sin repartir
 *      es mejor que un reparto inventado.
 *
 *   3. Cuando se empieza a llenar, avisa si no cuadra —y lo avisa aquí, no al
 *      guardar—. Un servicio cuya jornada dice ocho y cuyo reparto suma seis
 *      afirma dos plantillas distintas, y esa es exactamente la clase de dato
 *      que hace que el reparto del tablero deje de coincidir con el estado de
 *      fuerza sin que nada lo anuncie.
 */
export default function DesgloseTurnos({ turnos, detalle, setDetalle, turnosDia }) {
  const jornadas = Object.keys(turnos).filter((j) => Number(turnos[j]) > 0);
  if (!jornadas.length || !turnosDia.length) return null;

  const sumaDe = (j) =>
    Object.values(detalle[j] || {}).reduce((a, b) => a + (Number(b) || 0), 0);

  function fijar(jornada, turno, valor) {
    const n = Math.max(0, Number(valor) || 0);
    setDetalle((prev) => {
      const next = { ...prev };
      const reparto = { ...(next[jornada] || {}) };
      if (!n) delete reparto[turno];
      else reparto[turno] = n;
      if (Object.keys(reparto).length) next[jornada] = reparto;
      else delete next[jornada];
      return next;
    });
  }

  return (
    <div className="mt-4 border-t border-slate-700/50 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-slate-200">Turno de cada jornada</h3>
        <span className="text-[11px] text-slate-500">
          Opcional. Si lo sabes, di cuántos son de mañana, de noche o mixtos.
        </span>
      </div>

      <div className="space-y-2">
        {jornadas.map((j) => {
          const suma = sumaDe(j);
          const meta = Number(turnos[j]) || 0;
          const cuadra = suma === 0 || suma === meta;
          return (
            <div
              key={j}
              className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 border ${
                cuadra ? 'bg-slate-900/40 border-slate-700/50' : 'bg-red-500/5 border-red-700/50'
              }`}
            >
              <span className="text-xs text-slate-300 w-24 shrink-0">
                {j} <span className="text-slate-500">({meta})</span>
              </span>
              {turnosDia.map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">{t.slice(0, 3)}</span>
                  <input
                    type="number"
                    min="0"
                    max={meta}
                    value={detalle[j]?.[t] ?? ''}
                    onChange={(e) => fijar(j, t, e.target.value)}
                    className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
                  />
                </label>
              ))}
              {!cuadra && (
                <span className="text-[11px] text-red-400">
                  suma {suma}, la jornada dice {meta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
