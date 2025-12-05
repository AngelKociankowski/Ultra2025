'use client';

import { formatCurrency, formatPercent, getStatusColor, getStatusIcon, getTrendColor, getTrendIcon } from '@/lib/utils';

export default function KPICard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  meta, 
  cumplimiento, 
  trend,
  format = 'number',
  size = 'default'
}) {
  const formattedValue = format === 'currency' ? formatCurrency(value) : value;
  const statusColor = cumplimiento ? getStatusColor(cumplimiento) : '';
  const statusIcon = cumplimiento ? getStatusIcon(cumplimiento) : '';
  
  const sizeClasses = {
    default: 'p-5',
    large: 'p-6',
    small: 'p-4'
  };

  return (
    <div className={`card-hover bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl ${sizeClasses[size]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-slate-400 text-sm font-medium mb-1">{title}</p>
          <p className={`font-bold text-white ${size === 'large' ? 'text-3xl' : 'text-2xl'}`}>
            {formattedValue}
          </p>
          {subtitle && (
            <p className="text-slate-500 text-xs mt-1">{subtitle}</p>
          )}
          {meta && (
            <p className="text-slate-600 text-xs mt-1">Meta: {format === 'currency' ? formatCurrency(meta) : meta}</p>
          )}
        </div>
        {icon && (
          <div className="p-3 rounded-xl bg-slate-700/50 text-2xl">
            {icon}
          </div>
        )}
      </div>
      
      {cumplimiento !== undefined && (
        <div className={`mt-3 flex items-center gap-2 text-sm ${statusColor}`}>
          <span>{statusIcon}</span>
          <span>{formatPercent(cumplimiento)} de meta</span>
        </div>
      )}
      
      {trend !== undefined && (
        <div className={`mt-3 flex items-center gap-1 text-sm ${getTrendColor(trend)}`}>
          <span>{getTrendIcon(trend)}</span>
          <span>{Math.abs(trend)}% YTD</span>
        </div>
      )}
    </div>
  );
}
