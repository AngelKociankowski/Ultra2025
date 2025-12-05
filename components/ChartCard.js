'use client';

export default function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {subtitle && (
          <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
