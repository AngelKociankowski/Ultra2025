'use client';

import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, ComposedChart, Area, Legend, ReferenceLine
} from 'recharts';
import {
  CONFIG, METAS, ventasMensuales, asesores, operacionesMensuales,
  motivosCancelacion, serviciosActivos, distribucionZona, distribucionTipo, topClientes, KPIs
} from '@/lib/data';
import { formatCurrency, formatNumber, getStatusColor, getStatusIcon } from '@/lib/utils';
import KPICard from '@/components/KPICard';
import ChartCard from '@/components/ChartCard';
import InsightCard from '@/components/InsightCard';
import DataTable from '@/components/DataTable';
import ProgressBar from '@/components/ProgressBar';

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: '📊' },
  { id: 'ventas', label: 'Ventas', icon: '💰' },
  { id: 'operaciones', label: 'Operaciones', icon: '🔄' },
  { id: 'fuerza', label: 'Estado de Fuerza', icon: '🏢' },
  { id: 'comercial', label: 'Comercial', icon: '👥' }
];

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-slate-400 text-sm mb-2">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
};

// ==================== RESUMEN VIEW ====================
function ResumenView() {
  return (
    <div className="animate-fade-in">
      {/* Config Banner */}
      <div className="mb-6 p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">👥 Asesores:</span>
            <span className="text-white font-medium">{CONFIG.NUM_ASESORES}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">🎯 Meta Ventas/Mes:</span>
            <span className="text-white font-medium">{formatCurrency(METAS.ventasMensual)}</span>
            <span className="text-slate-600 text-xs">({CONFIG.NUM_ASESORES} × {formatCurrency(CONFIG.META_VENTAS_POR_ASESOR)})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">📈 Meta Guardias/Mes:</span>
            <span className="text-white font-medium">{METAS.guardiasMensual}</span>
            <span className="text-slate-600 text-xs">({CONFIG.NUM_ASESORES} × {CONFIG.META_GUARDIAS_POR_ASESOR})</span>
          </div>
        </div>
      </div>

      {/* KPIs Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          title="Ventas YTD"
          value={KPIs.ventasYTD}
          format="currency"
          subtitle={`${CONFIG.MESES_VENTAS} meses`}
          icon="💰"
          meta={KPIs.ventasMetaYTD}
          cumplimiento={KPIs.ventasCumplimiento}
        />
        <KPICard
          title="Servicios Activos"
          value={KPIs.serviciosActuales}
          subtitle="Noviembre 2025"
          icon="🏢"
          trend={parseFloat(KPIs.crecimientoServicios)}
        />
        <KPICard
          title="Guardias Aperturados"
          value={KPIs.guardiasApertYTD}
          subtitle="YTD"
          icon="👮"
          meta={KPIs.guardiasMetaYTD}
          cumplimiento={KPIs.guardiasCumplimiento}
        />
        <KPICard
          title="Variación Neta"
          value={`${KPIs.guardiasNetoYTD >= 0 ? '+' : ''}${KPIs.guardiasNetoYTD}`}
          subtitle={`${KPIs.guardiasApertYTD} apert / ${KPIs.guardiasCancelYTD} canc`}
          icon="📊"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Ventas vs Meta Mensual" subtitle={`Meta: ${formatCurrency(METAS.ventasMensual)}/mes (línea amarilla)`}>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ventasMensuales}>
                <defs>
                  <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="mes" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                <ReferenceLine y={METAS.ventasMensual} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={2} />
                <Area type="monotone" dataKey="ventas" fill="url(#colorVentas)" stroke="#10b981" strokeWidth={2} name="Ventas" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Guardias: Aperturados vs Cancelados" subtitle={`Meta: ${METAS.guardiasMensual} guardias/mes`}>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={operacionesMensuales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="mes" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <ReferenceLine y={METAS.guardiasMensual} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={2} />
                <Bar dataKey="guardiasApert" name="Aperturados" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="guardiasCancl" name="Cancelados" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="neto" name="Neto" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Second Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <ChartCard title="Distribución por Zona">
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribucionZona} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={2} dataKey="servicios">
                  {distribucionZona.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1">
            {distribucionZona.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-300">{item.zona}</span>
                </div>
                <span className="text-white font-medium">{item.servicios} ({item.participacion}%)</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Top 5 Asesores">
          <div className="space-y-2">
            {asesores.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: a.color }}>
                  {i + 1}
                </div>
                <span className="text-white flex-1 truncate text-sm">{a.nombre}</span>
                <span className="text-slate-400 text-sm">{formatCurrency(a.ventas)}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Servicios Activos (Tendencia)">
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serviciosActivos}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="mes" stroke="#64748b" fontSize={10} />
                <YAxis stroke="#64748b" fontSize={10} domain={[180, 250]} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="servicios" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Insights */}
      <ChartCard title="Insights Clave" subtitle="Hallazgos principales del análisis">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <InsightCard type="success" title="Ventas Superan Meta" description="Todos los meses superaron la meta de ventas" metric={`${KPIs.ventasCumplimiento}% cumplimiento YTD`} />
          <InsightCard type="warning" title="Aperturas Bajo Meta" description={`Solo ${KPIs.mesesSobreMetaGuardias}/12 meses alcanzaron la meta`} metric={`${KPIs.guardiasCumplimiento}% cumplimiento YTD`} />
          <InsightCard type="warning" title="Concentración Comercial" description="Alto riesgo por dependencia de pocos asesores" metric={`Top 2 = ${KPIs.concentracionTop2}% de ventas`} />
          <InsightCard type="danger" title="Febrero Crítico" description="Mayor cantidad de cancelaciones del año" metric={`${KPIs.peorMesCancelaciones.guardiasCancl} guardias cancelados`} />
          <InsightCard type="info" title="Mejor Mes Ventas" description={`${KPIs.ventasMejorMes.mes} registró las mayores ventas`} metric={formatCurrency(KPIs.ventasMejorMes.ventas)} />
          <InsightCard type="info" title="Costo de Oportunidad" description="Valor perdido por cancelaciones" metric={formatCurrency(KPIs.costoOportunidadTotal)} />
        </div>
      </ChartCard>
    </div>
  );
}

// ==================== VENTAS VIEW ====================
function VentasView() {
  const ventasColumns = [
    { header: 'Mes', accessor: 'mes' },
    { header: 'Ventas', accessor: 'ventas', align: 'right', render: (row) => formatCurrency(row.ventas) },
    { header: 'Meta', accessor: 'meta', align: 'right', render: (row) => formatCurrency(row.meta), className: () => 'text-slate-500' },
    { header: 'Diferencia', accessor: 'diferencia', align: 'right', render: (row) => formatCurrency(row.diferencia), className: (row) => row.diferencia >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { header: 'Cumpl.', accessor: 'cumplimiento', align: 'right', render: (row) => `${row.cumplimiento}%`, className: () => 'text-emerald-400 font-medium' }
  ];

  return (
    <div className="animate-fade-in">
      {/* Formula Banner */}
      <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-emerald-400 font-medium">Fórmula de Meta</h3>
            <p className="text-slate-400 text-sm">{CONFIG.NUM_ASESORES} asesores × {formatCurrency(CONFIG.META_VENTAS_POR_ASESOR)} = <span className="text-white font-medium">{formatCurrency(METAS.ventasMensual)}/mes</span></p>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-sm">Cumplimiento YTD</p>
            <p className="text-3xl font-bold text-emerald-400">{KPIs.ventasCumplimiento}%</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <KPICard title="Ventas YTD" value={KPIs.ventasYTD} format="currency" icon="💰" cumplimiento={KPIs.ventasCumplimiento} />
        <KPICard title="Promedio Mensual" value={KPIs.ventasPromMensual} format="currency" icon="📊" meta={METAS.ventasMensual} cumplimiento={((KPIs.ventasPromMensual / METAS.ventasMensual) * 100).toFixed(1)} />
        <KPICard title="Mejor Mes" value={KPIs.ventasMejorMes.mes} subtitle={formatCurrency(KPIs.ventasMejorMes.ventas)} icon="🏆" />
        <KPICard title="Meses Sobre Meta" value={`${KPIs.mesesSobreMetaVentas}/${CONFIG.MESES_VENTAS}`} subtitle="100%" icon="✅" />
        <KPICard title="Ticket Promedio" value={KPIs.ticketPromedioGeneral} format="currency" icon="🎫" />
      </div>

      {/* Chart */}
      <ChartCard title="Ventas Mensuales vs Meta" subtitle="Todos los meses superaron la meta" className="mb-6">
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ventasMensuales}>
              <defs>
                <linearGradient id="ventasGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="mes" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
              <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
              <Legend />
              <ReferenceLine y={METAS.ventasMensual} stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" label={{ value: `Meta ${formatCurrency(METAS.ventasMensual)}`, fill: '#f59e0b', fontSize: 11, position: 'right' }} />
              <Area type="monotone" dataKey="ventas" name="Ventas" fill="url(#ventasGradient)" stroke="#10b981" strokeWidth={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Asesores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Ventas por Asesor" subtitle="Ranking YTD">
          <div style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={asesores} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
                <YAxis dataKey="nombre" type="category" stroke="#64748b" fontSize={10} width={110} />
                <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                <Bar dataKey="ventas" name="Ventas" radius={[0, 4, 4, 0]}>
                  {asesores.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Cumplimiento Individual" subtitle={`Meta: ${formatCurrency(CONFIG.META_VENTAS_POR_ASESOR * CONFIG.MESES_VENTAS)} YTD por asesor`}>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
            {asesores.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="text-white flex-1 truncate text-sm">{a.nombre}</span>
                <span className="text-slate-400 text-xs">{a.participacion}%</span>
                <span className={`font-bold ${a.sobreMeta ? 'text-emerald-400' : 'text-amber-400'}`}>{a.cumplimiento}%</span>
                <span className={`text-xs px-2 py-1 rounded ${a.sobreMeta ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {a.sobreMeta ? '✓' : '↓'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-slate-800/50 rounded-lg flex justify-between">
            <span className="text-emerald-400">✓ Sobre meta: {KPIs.asesoresSobreMeta}</span>
            <span className="text-amber-400">↓ Bajo meta: {KPIs.asesoresBajoMeta}</span>
          </div>
        </ChartCard>
      </div>

      {/* Table */}
      <ChartCard title="Detalle Mensual">
        <DataTable columns={ventasColumns} data={ventasMensuales} highlightCondition={(row) => parseFloat(row.cumplimiento) >= 200} />
      </ChartCard>
    </div>
  );
}

// Continúa en la siguiente parte...
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('resumen');

  const renderContent = () => {
    switch (activeTab) {
      case 'ventas': return <VentasView />;
      case 'operaciones': return <OperacionesView />;
      case 'fuerza': return <FuerzaView />;
      case 'comercial': return <ComercialView />;
      default: return <ResumenView />;
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <span className="text-2xl">🛡️</span>
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">Ultra Seguridad Privada</h1>
                <p className="text-slate-400 text-sm">Dashboard Ejecutivo 2025</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'tab-active'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-white border border-slate-700/50'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Breadcrumb */}
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <span>Dashboard</span>
            <span>›</span>
            <span className="text-slate-300">{TABS.find((t) => t.id === activeTab)?.label}</span>
            <span className="ml-auto">Actualizado: Noviembre 2025</span>
          </div>
        </header>

        {/* Main Content */}
        <main>{renderContent()}</main>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-slate-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-slate-500">
            <p>Ultra Seguridad Privada © 2025 | Dashboard de Business Intelligence</p>
            <div className="flex gap-4">
              <span>Meta Ventas: {formatCurrency(METAS.ventasMensual)}/mes</span>
              <span>Meta Guardias: {METAS.guardiasMensual}/mes</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ==================== OPERACIONES VIEW ====================
function OperacionesView() {
  return (
    <div className="animate-fade-in">
      {/* Formula Banner */}
      <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-amber-400 font-medium">Fórmula de Meta Aperturas</h3>
            <p className="text-slate-400 text-sm">{CONFIG.NUM_ASESORES} asesores × {CONFIG.META_GUARDIAS_POR_ASESOR} guardias = <span className="text-white font-medium">{METAS.guardiasMensual} guardias/mes</span></p>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-sm">Cumplimiento YTD</p>
            <p className={`text-3xl font-bold ${parseFloat(KPIs.guardiasCumplimiento) >= 100 ? 'text-emerald-400' : 'text-amber-400'}`}>{KPIs.guardiasCumplimiento}%</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <KPICard title="Guardias Aperturados" value={KPIs.guardiasApertYTD} subtitle="YTD" icon="👮" meta={KPIs.guardiasMetaYTD} cumplimiento={KPIs.guardiasCumplimiento} />
        <KPICard title="Guardias Cancelados" value={KPIs.guardiasCancelYTD} subtitle="YTD" icon="📉" />
        <KPICard title="Variación Neta" value={`${KPIs.guardiasNetoYTD >= 0 ? '+' : ''}${KPIs.guardiasNetoYTD}`} icon="⚖️" />
        <KPICard title="Meses Sobre Meta" value={`${KPIs.mesesSobreMetaGuardias}/12`} icon="🎯" />
        <KPICard title="Costo Oportunidad" value={KPIs.costoOportunidadTotal} format="currency" subtitle="Por cancelaciones" icon="💸" />
      </div>

      {/* Chart */}
      <ChartCard title="Guardias: Aperturados vs Cancelados" subtitle="Meta = 40 guardias/mes (línea amarilla)" className="mb-6">
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={operacionesMensuales}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="mes" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <ReferenceLine y={METAS.guardiasMensual} stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" />
              <Bar dataKey="guardiasApert" name="Aperturados" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="guardiasCancl" name="Cancelados" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="neto" name="Variación Neta" stroke="#06b6d4" strokeWidth={3} dot={{ fill: '#06b6d4' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Motivos y Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Motivos de Cancelación" subtitle="Distribución de servicios cancelados">
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={motivosCancelacion} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="cantidad">
                  {motivosCancelacion.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {motivosCancelacion.slice(0, 6).map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-slate-400 truncate">{item.motivo}</span>
                <span className="text-white ml-auto">{item.porcentaje}%</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Cumplimiento Mensual" subtitle="Guardias aperturados vs meta de 40">
          <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
            {operacionesMensuales.map((m, i) => (
              <ProgressBar key={i} label={m.mes} value={m.guardiasApert} max={METAS.guardiasMensual} />
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Table */}
      <ChartCard title="Detalle Mensual de Operaciones">
        <DataTable
          columns={[
            { header: 'Mes', accessor: 'mes' },
            { header: 'Aperturados', accessor: 'guardiasApert', align: 'right', className: () => 'text-emerald-400' },
            { header: 'Meta', accessor: 'meta', align: 'right', className: () => 'text-slate-500' },
            { header: 'Cumpl.', align: 'right', render: (row) => `${row.cumplimiento}%`, className: (row) => parseFloat(row.cumplimiento) >= 100 ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium' },
            { header: 'Cancelados', accessor: 'guardiasCancl', align: 'right', className: () => 'text-red-400' },
            { header: 'Neto', align: 'right', render: (row) => `${row.neto >= 0 ? '+' : ''}${row.neto}`, className: (row) => row.neto >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium' }
          ]}
          data={operacionesMensuales}
          highlightCondition={(row) => row.sobreMeta}
        />
      </ChartCard>
    </div>
  );
}

// ==================== FUERZA VIEW ====================
function FuerzaView() {
  return (
    <div className="animate-fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard title="Servicios Activos" value={KPIs.serviciosActuales} subtitle="Noviembre 2025" icon="🏢" />
        <KPICard title="Guardias Activos" value={KPIs.guardiasActuales} subtitle="Noviembre 2025" icon="👮" />
        <KPICard title="Crecimiento YTD" value={`+${KPIs.crecimientoServicios}%`} subtitle="vs Enero (198)" icon="📈" trend={parseFloat(KPIs.crecimientoServicios)} />
        <KPICard title="Prom. Guardias/Servicio" value={KPIs.promGuardiasPorServicio} icon="📊" />
      </div>

      {/* Chart */}
      <ChartCard title="Evolución de Servicios y Guardias Activos" subtitle="Tendencia mensual 2025" className="mb-6">
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serviciosActivos}>
              <defs>
                <linearGradient id="serviciosGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="mes" stroke="#64748b" fontSize={12} />
              <YAxis yAxisId="left" stroke="#64748b" fontSize={11} domain={[180, 250]} />
              <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={11} domain={[800, 950]} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="servicios" name="Servicios" fill="url(#serviciosGradient)" stroke="#06b6d4" strokeWidth={3} />
              <Line yAxisId="right" type="monotone" dataKey="guardias" name="Guardias" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Distribución por Zona">
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribucionZona} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="servicios">
                  {distribucionZona.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            {distribucionZona.map((item, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-white">{item.zona}</span>
                  <span className={`text-xs ${item.tendencia.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`}>{item.tendencia}</span>
                </div>
                <div className="text-right">
                  <span className="text-white font-medium">{item.servicios}</span>
                  <span className="text-slate-400 text-sm ml-1">({item.participacion}%)</span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Distribución por Tipo de Cliente">
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribucionTipo} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis dataKey="tipo" type="category" stroke="#64748b" fontSize={11} width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="cantidad" radius={[0, 4, 4, 0]}>
                  {distribucionTipo.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            {distribucionTipo.map((item, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-white">{item.tipo}</span>
                </div>
                <div className="text-right">
                  <span className="text-white font-medium">{item.cantidad}</span>
                  <span className="text-slate-400 text-sm ml-1">({item.participacion}%)</span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Top Clients */}
      <ChartCard title="Top 5 Clientes por Guardias">
        <DataTable
          columns={[
            { header: 'Cliente', accessor: 'nombre' },
            { header: 'Guardias', accessor: 'guardias', align: 'right', className: () => 'text-emerald-400 font-medium' },
            { header: 'Ingreso Mensual', align: 'right', render: (row) => formatCurrency(row.ingresoMensual) },
            { header: 'Zona', accessor: 'zona' },
            { header: 'Antigüedad', align: 'right', render: (row) => `${row.antiguedad} años` }
          ]}
          data={topClientes}
        />
      </ChartCard>
    </div>
  );
}

// ==================== COMERCIAL VIEW ====================
function ComercialView() {
  return (
    <div className="animate-fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard title="Asesores Activos" value={CONFIG.NUM_ASESORES} icon="👥" />
        <KPICard title="Sobre Meta" value={KPIs.asesoresSobreMeta} subtitle={`de ${CONFIG.NUM_ASESORES}`} icon="✅" />
        <KPICard title="Bajo Meta" value={KPIs.asesoresBajoMeta} subtitle={`de ${CONFIG.NUM_ASESORES}`} icon="⚠️" />
        <KPICard title="Concentración Top 2" value={`${KPIs.concentracionTop2}%`} subtitle="de ventas totales" icon="📊" />
      </div>

      {/* Performance Chart */}
      <ChartCard title="Performance por Asesor" subtitle="Ventas YTD y cumplimiento de meta" className="mb-6">
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={asesores} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} />
              <YAxis dataKey="nombre" type="category" stroke="#64748b" fontSize={10} width={120} />
              <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
              <ReferenceLine x={CONFIG.META_VENTAS_POR_ASESOR * CONFIG.MESES_VENTAS} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={2} />
              <Bar dataKey="ventas" name="Ventas YTD" radius={[0, 4, 4, 0]}>
                {asesores.map((entry, i) => <Cell key={i} fill={entry.sobreMeta ? '#10b981' : '#f59e0b'} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Detailed Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Ranking de Ventas" subtitle="Detalle por asesor">
          <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
            {asesores.map((a, i) => (
              <div key={i} className={`p-4 rounded-lg border ${a.sobreMeta ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: a.color }}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">{a.nombre}</p>
                    <p className="text-slate-400 text-xs">Zona {a.zona} • {a.antiguedad} años</p>
                  </div>
                  <span className={`text-lg font-bold ${a.sobreMeta ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {a.cumplimiento}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Ventas: <span className="text-white">{formatCurrency(a.ventas)}</span></span>
                  <span className="text-slate-400">Servicios: <span className="text-white">{a.servicios}</span></span>
                  <span className="text-slate-400">Ticket: <span className="text-white">{formatCurrency(a.ticketPromedio)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Participación de Mercado" subtitle="Concentración de ventas">
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={asesores} cx="50%" cy="50%" outerRadius={90} dataKey="ventas" label={({ nombre, participacion }) => `${participacion}%`} labelLine={false}>
                  {asesores.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 p-4 bg-slate-800/50 rounded-lg">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Top 2 Asesores</p>
                <p className="text-2xl font-bold text-amber-400">{KPIs.concentracionTop2}%</p>
                <p className="text-slate-500 text-xs">de las ventas totales</p>
              </div>
              <div>
                <p className="text-slate-400">Resto del Equipo</p>
                <p className="text-2xl font-bold text-slate-300">{(100 - parseFloat(KPIs.concentracionTop2)).toFixed(1)}%</p>
                <p className="text-slate-500 text-xs">8 asesores</p>
              </div>
            </div>
          </div>
          <InsightCard type="warning" title="Alta Concentración" description="Se recomienda desarrollar al resto del equipo para reducir el riesgo de dependencia" className="mt-4" />
        </ChartCard>
      </div>
    </div>
  );
}
