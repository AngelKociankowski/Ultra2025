'use client';

const styles = {
  success: 'border-emerald-500/30 bg-emerald-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/10',
  info: 'border-cyan-500/30 bg-cyan-500/10'
};

const icons = {
  success: '✅',
  warning: '⚠️',
  danger: '🚨',
  info: '💡'
};

export default function InsightCard({ type = 'info', title, description, metric }) {
  return (
    <div className={`border rounded-xl p-4 ${styles[type]} card-hover`}>
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">{icons[type]}</span>
        <div className="flex-1">
          <h4 className="font-medium text-white">{title}</h4>
          <p className="text-slate-400 text-sm mt-1">{description}</p>
          {metric && (
            <p className="text-white font-semibold mt-2">{metric}</p>
          )}
        </div>
      </div>
    </div>
  );
}
