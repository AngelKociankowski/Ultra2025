import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { listarServicios, catalogos } from '@/lib/servicios';
import {
  periodosDisponibles,
  periodoVigente,
  serviciosDeCorte,
  catalogosDeCorte,
  comparativoCorte,
} from '@/lib/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { gruposEditables } from '@/lib/rbac';
import Filtros from './Filtros';

export const dynamic = 'force-dynamic';

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (p) => {
  const [a, m] = String(p).split('-');
  return `${MESES[Number(m)]} ${a}`;
};

const delta = (n, fmt = formatNumber) =>
  n === 0 ? '=' : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

export default function EstadoFuerza({ searchParams }) {
  const usuario = usuarioActual();
  const vigente = periodoVigente();
  const periodos = periodosDisponibles(vigente);

  /**
   * Sin `periodo` en la URL se ve el mes en curso, que es el estado de fuerza
   * vivo: sale de `servicios` y cambia con aperturas y cancelaciones. Con un
   * periodo cerrado se ve su corte, que es la foto contra la que se facturó y
   * por eso no se edita.
   */
  const pedido = searchParams?.periodo || '';
  const esCorte = Boolean(pedido) && pedido !== vigente && periodos.some((p) => p.periodo === pedido);

  const filtros = {
    estatus: searchParams?.estatus ?? 'ACTIVO',
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    contrato: searchParams?.contrato || '',
    facturado: searchParams?.facturado || '',
    q: searchParams?.q || '',
    periodo: esCorte ? pedido : '',
  };

  const servicios = esCorte ? serviciosDeCorte(pedido, filtros) : listarServicios(filtros);
  const cat = esCorte ? catalogosDeCorte(pedido) : catalogos();
  const comparativo = esCorte ? comparativoCorte(pedido) : null;
  const grupos = gruposEditables(usuario.rol);

  const totalGuardias = servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);
  const totalFactura = servicios.reduce((a, s) => a + (s.importe_factura || 0), 0);
  const facturadoDe = (s) => (esCorte ? s.importe_factura > 0 : s.facturado);

  /**
   * Los cortes de 2023 y algunos de 2024 no traen la facturación capturada por
   * servicio —en esos meses se llevaba por quincenas en otras columnas—, así
   * que conviene decirlo en vez de mostrar un total en ceros como si fuera real.
   */
  const conFactura = esCorte ? servicios.filter((s) => s.importe_factura).length : 0;
  const sinFacturacion = esCorte && servicios.length > 0 && conFactura < servicios.length / 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Estado de fuerza</h1>
            {esCorte ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                corte de {nombreMes(pedido)} · cerrado
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                {nombreMes(vigente)} · en curso
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {formatNumber(servicios.length)} servicios · {formatNumber(totalGuardias)} guardias ·{' '}
            {formatCurrency(totalFactura)} facturación
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          {esCorte ? (
            <p className="text-xs text-slate-500 max-w-md text-right">
              Un corte cerrado es el respaldo de lo que se facturó ese mes: no se edita, ni con permisos de
              administrador. Para cambiar la plantilla, vuelve al mes en curso.
            </p>
          ) : grupos.length > 0 ? (
            <p className="text-xs text-slate-500 max-w-md text-right">
              Tu rol puede editar: {grupos.map((g) => g.etiqueta).join(' · ')}. Abre un servicio para modificarlo.
            </p>
          ) : (
            <p className="text-xs text-slate-500">Tu rol tiene acceso de consulta sobre esta base.</p>
          )}
          <a
            href={`/api/cortes/${esCorte ? pedido : 'actual'}`}
            download
            className="shrink-0 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5"
          >
            ⬇ Descargar CSV
          </a>
        </div>
      </div>

      {comparativo && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded-xl px-4 py-2.5">
          <span className="text-slate-500">Contra {nombreMes(comparativo.previo)}:</span>
          <span className={comparativo.servicios >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta(comparativo.servicios)} servicios
          </span>
          <span className={comparativo.guardias >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta(comparativo.guardias)} guardias
          </span>
          <span className={comparativo.facturacion >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta(comparativo.facturacion, formatCurrency)} facturación
          </span>
        </div>
      )}

      {sinFacturacion && (
        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5">
          Solo {conFactura} de {servicios.length} servicios traen importe de factura en este corte. En esos meses
          la hoja llevaba la facturación por quincenas, no por servicio; el total de arriba es lo que sí quedó
          capturado, no lo facturado del mes.
        </p>
      )}

      <Filtros valores={filtros} catalogos={cat} periodos={periodos} vigente={vigente} />

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
                <th className="text-center px-3 py-3">{esCorte ? 'Cobranza' : 'Estatus'}</th>
              </tr>
            </thead>
            <tbody>
              {servicios.map((s) => (
                <tr key={s.id} className="border-t border-slate-800/70 hover:bg-slate-800/40">
                  <td className="px-4 py-2">
                    {esCorte ? (
                      <span className="text-white font-medium">{s.servicio}</span>
                    ) : (
                      <Link href={`/estado-fuerza/${s.id}`} className="text-white hover:text-cyan-400 font-medium">
                        {s.servicio}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400 truncate max-w-[220px]">{s.razon_social || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{s.zona || '—'}</td>
                  <td className="px-3 py-2 text-slate-400 truncate max-w-[150px]">{s.asesor || '—'}</td>
                  <td className="px-3 py-2 text-right text-white">{s.total_guardias}</td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {s.importe_factura ? formatCurrency(s.importe_factura) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">{facturadoDe(s) ? '✅' : '⛔'}</td>
                  <td className="px-3 py-2 text-center">{s.tiene_contrato ? '✅' : '⛔'}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{s.fecha_vencimiento_contrato || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {esCorte ? (
                      <span className="text-xs text-slate-400">{s.status_cobranza || '—'}</span>
                    ) : (
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          s.estatus === 'ACTIVO'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-600/40 text-slate-400'
                        }`}
                      >
                        {s.estatus}
                      </span>
                    )}
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
