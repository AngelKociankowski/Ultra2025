'use client';

export default function MetricBadge({ value, isPositive, label }) {
  const colorClass = isPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400';
  const icon = isPositive ? '↑' : '↓';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${colorClass}`}>
      <span>{icon}</span>
      <span>{value}</span>
      {label && <span className="text-slate-400 ml-1">{label}</span>}
    </span>
  );
}
