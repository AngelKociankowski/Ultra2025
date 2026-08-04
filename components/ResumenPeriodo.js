import { formatCurrency, formatNumber } from '@/lib/utils';

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const enPalabras = (p) => (p ? `${MESES[Number(p.slice(5, 7))]} de ${p.slice(0, 4)}` : 'todo el histórico');

function Cifra({ titulo, valor, sub, tono = 'slate' }) {
  const color = {
    slate: 'text-slate-200',
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    cyan: 'text-cyan-400',
    amber: 'text-amber-400',
  }[tono];
  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-bold ${color}`}>{valor}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * El mes en cifras, antes de la tabla.
 *
 * Las tres preguntas que se hacen sobre un mes —cuántos movimientos, cuántos
 * guardias, cuánto dinero— estaban sin responder en ningún lado: había que
 * contar renglones a ojo. Aquí van arriba, y el desglose por tipo debajo,
 * porque una apertura nueva y una ampliación de un cliente que ya se tenía no
 * significan lo mismo aunque sumen igual.
 */
export default function ResumenPeriodo({ clase, periodo, resumen, extra = null }) {
  const esApertura = clase === 'aperturas';
  const tono = esApertura ? 'emerald' : 'red';
  const tipos = Object.entries(resumen.porTipo).filter(([, v]) => v.movimientos > 0);

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Cifra
          titulo={`Movimientos en ${enPalabras(periodo)}`}
          valor={formatNumber(resumen.movimientos)}
          sub={`${formatNumber(resumen.servicios)} servicio${resumen.servicios === 1 ? '' : 's'} distintos`}
        />
        <Cifra
          titulo={esApertura ? 'Guardias aperturados' : 'Guardias retirados'}
          valor={`${esApertura ? '+' : '−'}${formatNumber(resumen.guardias)}`}
          tono={tono}
        />
        <Cifra
          titulo={esApertura ? 'Valor mensual que entra' : 'Valor mensual que se va'}
          valor={formatCurrency(resumen.monto)}
          sub={resumen.sinMonto > 0 ? `${formatNumber(resumen.sinMonto)} sin precio para calcular` : 'de lo capturado'}
          tono={tono}
        />
        {esApertura ? (
          <Cifra
            titulo="Turnos que se abrieron"
            valor={resumen.turnos.length ? resumen.turnos[0][0] : '—'}
            sub={
              resumen.turnos.length
                ? resumen.turnos
                    .slice(0, 3)
                    .map(([t, n]) => `${t}: ${n}`)
                    .join(' · ')
                : 'sin desglose capturado'
            }
            tono="cyan"
          />
        ) : (
          <Cifra
            titulo="Por cobrar al cerrar"
            valor={formatCurrency(resumen.cxc)}
            sub="lo que quedó pendiente en esas bajas"
            tono={resumen.cxc > 0 ? 'amber' : 'slate'}
          />
        )}
      </div>

      {(tipos.length > 0 || extra) && (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {tipos.map(([t, v]) => (
            <span key={t} className="text-slate-400">
              <strong className="text-slate-200">{t}</strong> · {formatNumber(v.movimientos)} mov ·{' '}
              {formatNumber(v.guardias)} guardias
              {v.monto > 0 && ` · ${formatCurrency(v.monto)}`}
            </span>
          ))}
          {resumen.zonas.length > 0 && (
            <span className="text-slate-500 text-xs">
              Zonas: {resumen.zonas.map(([z, n]) => `${z} (${n})`).join(' · ')}
            </span>
          )}
          {extra && <span className="text-slate-400 w-full lg:w-auto">{extra}</span>}
        </div>
      )}
    </section>
  );
}
