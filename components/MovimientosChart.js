'use client';

import { useEffect, useState } from 'react';
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

export default function MovimientosChart({ datos }) {
  const c = PALETA[useTema()];

  if (!datos?.length) {
    return <p className="text-slate-500 text-sm py-8 text-center">Sin movimientos registrados.</p>;
  }

  const data = datos.map((d) => ({
    periodo: d.periodo,
    Aperturas: d.guardias_apertura,
    Cancelaciones: -d.guardias_cancelacion,
    Neto: d.neto,
  }));

  return (
    <div className="h-72">
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
