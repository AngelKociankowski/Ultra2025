'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/**
 * Recharts pinta con atributos SVG, no con clases, así que no hereda el tema
 * por CSS: hay que darle colores concretos y volver a pintarlos cuando cambia
 * el atributo data-tema del documento.
 */
const PALETA = {
  dia: {
    rejilla: '#dfe3e8',
    eje: '#5c626a',
    texto: '#3d4249',
    fondoTooltip: '#ffffff',
    bordeTooltip: '#cdd1d8',
    apertura: '#0a8a64',
    cancelacion: '#e7342b',
    neto: '#0c7489',
  },
  noche: {
    rejilla: '#24314a',
    eje: '#64748b',
    texto: '#cbd5e1',
    fondoTooltip: '#0f172a',
    bordeTooltip: '#334155',
    apertura: '#10b981',
    cancelacion: '#e7342b',
    neto: '#22d3ee',
  },
};

function useTema() {
  const [tema, setTema] = useState('dia');
  useEffect(() => {
    const raiz = document.documentElement;
    const leer = () => setTema(raiz.dataset.tema === 'noche' ? 'noche' : 'dia');
    leer();
    const obs = new MutationObserver(leer);
    obs.observe(raiz, { attributes: true, attributeFilter: ['data-tema'] });
    return () => obs.disconnect();
  }, []);
  return tema;
}

/**
 * ¿La gráfica llegó a pintarse?
 *
 * Se comprueba mirando el documento, no confiando en que Recharts avise: un
 * momento después de montar, si en el contenedor no hay ni un `<svg>`, es que
 * no se dibujó. La causa da igual —el contenedor midió cero, la librería no
 * cargó— porque la respuesta es la misma: enseñar los números en texto en vez
 * de dejar un hueco.
 */
function useSePinto(ref) {
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const caja = ref.current;
      if (!caja) return;
      const svg = caja.querySelector('svg');
      // Sin svg, o con uno sin ancho: las dos cosas se ven igual de vacías.
      setFallo(!svg || svg.getBoundingClientRect().width < 2);
    }, 600);
    return () => clearTimeout(t);
  }, [ref]);
  return fallo;
}

export default function MovimientosChart({ datos }) {
  const c = PALETA[useTema()];
  const caja = useRef(null);
  const fallo = useSePinto(caja);

  if (!datos?.length) {
    return <p className="text-slate-500 text-sm py-8 text-center">Sin movimientos registrados.</p>;
  }

  const data = datos.map((d) => ({
    periodo: d.periodo,
    Aperturas: d.guardias_apertura,
    Cancelaciones: -d.guardias_cancelacion,
    Neto: d.neto,
  }));

  /**
   * Si la gráfica no logra dibujarse, el recuadro no se queda vacío.
   *
   * Recharts necesita medir el ancho de su contenedor antes de pintar. Cuando
   * algo se lo impide —o cuando su código no llegó a correr— el resultado era
   * un hueco del alto de la gráfica: ni datos, ni explicación, ni pista de que
   * faltara algo. La lista de abajo es la misma información y aparece sola en
   * ese caso.
   */
  if (fallo) {
    return (
      <div className="h-72 overflow-y-auto">
        <p className="text-xs text-amber-300/80 mb-2">
          La gráfica no se pudo dibujar en este navegador. Estos son los mismos números:
        </p>
        <ul className="text-xs text-slate-400 space-y-1">
          {data.map((d) => (
            <li key={d.periodo} className="flex justify-between gap-3 tabular-nums">
              <span>{d.periodo}</span>
              <span>
                <span className="text-emerald-400">+{d.Aperturas}</span>{' '}
                <span className="text-red-400">−{Math.abs(d.Cancelaciones)}</span>{' '}
                <span className="text-slate-300">= {d.Neto > 0 ? '+' : ''}{d.Neto}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="h-72" ref={caja}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.rejilla} vertical={false} />
          <XAxis dataKey="periodo" tick={{ fill: c.eje, fontSize: 11 }} stroke={c.rejilla} />
          <YAxis tick={{ fill: c.eje, fontSize: 11 }} stroke={c.rejilla} />
          <Tooltip
            cursor={{ fill: c.rejilla, fillOpacity: 0.35 }}
            contentStyle={{
              background: c.fondoTooltip,
              border: `1px solid ${c.bordeTooltip}`,
              borderRadius: 12,
              color: c.texto,
              fontSize: 12,
            }}
            formatter={(v, name) => [Math.abs(v), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: c.eje }} />
          <Bar dataKey="Aperturas" fill={c.apertura} radius={[3, 3, 0, 0]} />
          <Bar dataKey="Cancelaciones" fill={c.cancelacion} radius={[0, 0, 3, 3]} />
          <Line type="monotone" dataKey="Neto" stroke={c.neto} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
