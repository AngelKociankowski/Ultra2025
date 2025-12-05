'use client';

export default function ProgressBar({ label, value, max, showPercent = true }) {
  const percent = Math.round((value / max) * 100);
  const colorClass = percent >= 100 ? 'bg-emerald-500' : percent >= 80 ? 'bg-amber-500' : 'bg-red-500';
  const textColorClass = percent >= 100 ? 'text-emerald-400' : percent >= 80 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
      <span className="w-10 text-sm text-white">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-4 overflow-hidden">
        <div 
          className={`${colorClass} h-full progress-bar rounded-full`} 
          style={{ width: `${Math.min(percent, 150)}%` }}
        />
      </div>
      <span className={`${textColorClass} font-medium w-14 text-right text-sm`}>
        {value}/{max}
      </span>
      {showPercent && (
        <span className={`${textColorClass} text-xs w-12 text-right`}>
          {percent}%
        </span>
      )}
    </div>
  );
}
