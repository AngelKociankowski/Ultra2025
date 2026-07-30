'use client';

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

export default function MovimientosChart({ datos }) {
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
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="periodo" tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569" />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569" />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 12,
              color: '#e2e8f0',
              fontSize: 12,
            }}
            formatter={(v, name) => [Math.abs(v), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
          <Bar dataKey="Aperturas" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="Cancelaciones" fill="#ef4444" radius={[0, 0, 3, 3]} />
          <Line type="monotone" dataKey="Neto" stroke="#06b6d4" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
