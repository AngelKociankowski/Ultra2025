export const formatCurrency = (value) => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
};

export const formatNumber = (value) => {
  return new Intl.NumberFormat('es-MX').format(value);
};

export const formatPercent = (value) => {
  return `${value}%`;
};

export const getStatusColor = (cumplimiento, threshold = 100) => {
  const value = parseFloat(cumplimiento);
  if (value >= threshold) return 'text-emerald-400';
  if (value >= threshold * 0.8) return 'text-amber-400';
  return 'text-red-400';
};

export const getStatusBg = (cumplimiento, threshold = 100) => {
  const value = parseFloat(cumplimiento);
  if (value >= threshold) return 'bg-emerald-500/20 border-emerald-500/30';
  if (value >= threshold * 0.8) return 'bg-amber-500/20 border-amber-500/30';
  return 'bg-red-500/20 border-red-500/30';
};

export const getStatusIcon = (cumplimiento, threshold = 100) => {
  const value = parseFloat(cumplimiento);
  if (value >= threshold) return '✅';
  if (value >= threshold * 0.8) return '⚠️';
  return '🚨';
};

export const getTrendIcon = (value) => {
  if (value > 0) return '↑';
  if (value < 0) return '↓';
  return '→';
};

export const getTrendColor = (value) => {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-slate-400';
};

/**
 * Hoy, en la zona horaria de quien está capturando.
 *
 * Se usa para las fechas que trae puestas un formulario. `toISOString()` habría
 * sido lo cómodo, pero devuelve UTC: a partir de las seis de la tarde en México
 * proponía la fecha de mañana, y una factura registrada al cierre del día salía
 * fechada al día siguiente. `en-CA` da el formato AAAA-MM-DD que la base espera.
 */
export const hoyLocal = () => new Date().toLocaleDateString('en-CA');
