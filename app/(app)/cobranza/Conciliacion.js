import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/utils';

const TONO = {
  guardias_de_menos: 'text-red-300',
  importe_de_menos: 'text-red-300',
  guardias_de_mas: 'text-amber-300',
  importe_de_mas: 'text-amber-300',
};

/**
 * Lo que se facturó contra lo que está en la calle.
 *
 * Es la comparación que ningún total hace por sí solo, y por eso hacía falta.
 * La suma de las facturas cuadra consigo misma y la plantilla del estado de
 * fuerza también: cada una es coherente por dentro, y las dos pueden estar
 * diciendo cosas distintas sin que nada chille.
 *
 * Las dos direcciones importan, pero no igual. Facturar de menos es dinero que
 * se está regalando todos los meses y que nadie va a reclamar; facturar de más
 * es una factura que el cliente va a rebotar, y eso se descubre solo. Por eso
 * lo primero va en rojo y lo segundo en ámbar.
 */
export default function Conciliacion({ datos, periodo }) {
  const { hallazgos, resumen } = datos;
  if (!resumen.servicios) return null;

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/50">
        <h2 className="text-base font-semibold text-white">Lo facturado contra lo que está en la calle</h2>
        <p className="text-xs text-slate-500 max-w-3xl">
          Cada factura de {periodo} comparada con la plantilla del servicio y con el importe acordado en su ficha.
          Una factura por 8 guardias en un servicio de 10 son dos elementos que se ponen todos los días y no se
          cobran, y eso no aparece en ningún total.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-700/40">
        <Dato titulo="Cuadran" valor={formatNumber(resumen.cuadran)} de={resumen.servicios} tono="emerald" />
        <Dato
          titulo="Guardias sin cobrar"
          valor={formatNumber(resumen.guardiasDeMenos)}
          sub={resumen.dineroDeMenos > 0 ? `≈ ${formatCurrency(resumen.dineroDeMenos)} al mes` : null}
          tono={resumen.guardiasDeMenos > 0 ? 'red' : 'slate'}
        />
        <Dato
          titulo="Guardias de más"
          valor={formatNumber(resumen.guardiasDeMas)}
          sub={resumen.dineroDeMas > 0 ? `${formatCurrency(resumen.dineroDeMas)} por encima` : null}
          tono={resumen.guardiasDeMas > 0 ? 'amber' : 'slate'}
        />
        <Dato
          titulo="Sin con qué comparar"
          valor={formatNumber(resumen.sinGuardias + resumen.sinPrecio)}
          sub="falta capturar guardias o precio"
          tono="slate"
        />
      </div>

      {hallazgos.length === 0 ? (
        <p className="px-5 py-6 text-sm text-emerald-400/80 text-center">
          Todas las facturas de {periodo} coinciden con la plantilla y el precio de su servicio.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Servicio</th>
                <th className="text-right px-3 py-3">Guardias</th>
                <th className="text-right px-3 py-3">Importe</th>
                <th className="text-left px-4 py-3">Qué no cuadra</th>
              </tr>
            </thead>
            <tbody>
              {hallazgos.map((h) => (
                <tr key={h.servicio_id} className="border-t border-slate-800/70">
                  <td className="px-4 py-2">
                    <Link href={`/estado-fuerza/${h.servicio_id}`} className="text-slate-200 hover:text-cyan-400">
                      {h.servicio}
                    </Link>
                    <span className="block text-[11px] text-slate-500">
                      {[h.zona, h.asesor].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <span className={h.difGuardias ? 'text-white' : 'text-slate-400'}>
                      {h.guardias === null ? '—' : h.guardias}
                    </span>
                    <span className="block text-[11px] text-slate-500">de {h.plantilla} en la calle</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <span className="text-slate-300">{formatCurrency(h.facturado)}</span>
                    <span className="block text-[11px] text-slate-500">
                      {h.contratado ? `de ${formatCurrency(h.contratado)}` : 'sin precio en la ficha'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {h.problemas.map((p, i) => (
                      <p key={i} className={`text-xs ${TONO[p.clase] || 'text-slate-400'}`}>
                        {p.texto}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Dato({ titulo, valor, sub, de, tono }) {
  const color = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    slate: 'text-slate-300',
  }[tono];
  return (
    <div className="bg-slate-800/40 px-4 py-3">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-bold ${color}`}>
        {valor}
        {de !== undefined && <span className="text-sm text-slate-500 font-normal"> de {formatNumber(de)}</span>}
      </p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
