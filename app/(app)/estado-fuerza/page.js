import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { listarServicios, catalogos } from '@/lib/servicios';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { gruposEditables } from '@/lib/rbac';
import Filtros from './Filtros';

export const dynamic = 'force-dynamic';

export default function EstadoFuerza({ searchParams }) {
  const usuario = usuarioActual();
  const filtros = {
    estatus: searchParams?.estatus ?? 'ACTIVO',
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    contrato: searchParams?.contrato || '',
    facturado: searchParams?.facturado || '',
    q: searchParams?.q || '',
  };
  const servicios = listarServicios(filtros);
  const cat = catalogos();
  const grupos = gruposEditables(usuario.rol);

  const totalGuardias = servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);
  const totalFactura = servicios.reduce((a, s) => a + (s.importe_factura || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Estado de fuerza</h1>
          <p className="text-slate-400 text-sm">
            {formatNumber(servicios.length)} servicios · {formatNumber(totalGuardias)} guardias ·{' '}
            {formatCurrency(totalFactura)} facturación
          </p>
        </div>
        {grupos.length > 0 ? (
          <p className="text-xs text-slate-500 max-w-md text-right">
            Tu rol puede editar: {grupos.map((g) => g.etiqueta).join(' · ')}. Abre un servicio para modificarlo.
          </p>
        ) : (
          <p className="text-xs text-slate-500">Tu rol tiene acceso de consulta sobre esta base.</p>
        )}
      </div>

      <Filtros valores={filtros} catalogos={cat} />

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Servicio</th>
                <th className="text-left px-3 py-3">Razón social</th>
                <th className="text-left px-3 py-3">Zona</th>
                <th className="text-left px-3 py-3">Asesor</th>
                <th className="text-right px-3 py-3">Guardias</th>
                <th className="text-right px-3 py-3">Factura</th>
                <th className="text-center px-3 py-3">Facturado</th>
                <th className="text-center px-3 py-3">Contrato</th>
                <th className="text-left px-3 py-3">Vence</th>
                <th className="text-center px-3 py-3">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {servicios.map((s) => (
                <tr key={s.id} className="border-t border-slate-800/70 hover:bg-slate-800/40">
                  <td className="px-4 py-2">
                    <Link href={`/estado-fuerza/${s.id}`} className="text-white hover:text-cyan-400 font-medium">
                      {s.servicio}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-400 truncate max-w-[220px]">{s.razon_social || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{s.zona || '—'}</td>
                  <td className="px-3 py-2 text-slate-400 truncate max-w-[150px]">{s.asesor || '—'}</td>
                  <td className="px-3 py-2 text-right text-white">{s.total_guardias}</td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {s.importe_factura ? formatCurrency(s.importe_factura) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">{s.facturado ? '✅' : '⛔'}</td>
                  <td className="px-3 py-2 text-center">{s.tiene_contrato ? '✅' : '⛔'}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{s.fecha_vencimiento_contrato || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        s.estatus === 'ACTIVO'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-600/40 text-slate-400'
                      }`}
                    >
                      {s.estatus}
                    </span>
                  </td>
                </tr>
              ))}
              {servicios.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Ningún servicio coincide con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
