import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import {
  kpisEstadoFuerza,
  movimientosPorPeriodo,
  motivosCancelacion,
  distribucionPorZona,
  distribucionPorTurno,
  rankingAsesores,
  contratosPorVencer,
  ultimosMovimientos,
} from '@/lib/queries';
import { kpisCobranza } from '@/lib/facturacion';
import { estado as estadoRespaldos } from '@/lib/respaldos';
import { formatCurrency, formatNumber } from '@/lib/utils';
import MovimientosChart from '@/components/MovimientosChart';
import RepartoTurnos from '@/components/RepartoTurnos';

export const dynamic = 'force-dynamic';

function Kpi({ titulo, valor, sub, icono, tono = 'slate' }) {
  const tonos = {
    slate: 'text-white',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    cyan: 'text-cyan-400',
  };
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-400 text-xs font-medium">{titulo}</p>
          <p className={`text-2xl font-bold mt-1 ${tonos[tono]}`}>{valor}</p>
          {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
        </div>
        {icono && <span className="text-2xl opacity-70">{icono}</span>}
      </div>
    </div>
  );
}

export default function Tablero() {
  const usuario = usuarioActual();
  const k = kpisEstadoFuerza();
  const cobranza = kpisCobranza();
  const movimientos = movimientosPorPeriodo(18);
  const motivos = motivosCancelacion(8);
  const zonas = distribucionPorZona();
  const turnos = distribucionPorTurno();
  const asesores = rankingAsesores(10);
  const vencen = contratosPorVencer(90);
  const recientes = ultimosMovimientos(12);

  const netoTotal = movimientos.reduce((a, m) => a + m.neto, 0);

  // Un respaldo que dejó de correr no se nota por sí solo: nada falla, nada se
  // ve distinto, y el día que hace falta ya es tarde. Por eso se avisa aquí.
  const respaldos = puede(usuario.rol, 'respaldos') ? estadoRespaldos() : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Tablero</h1>
          <p className="text-slate-400 text-sm">
            Hola {usuario.nombre.split(' ')[0]} — estado de fuerza vigente y movimientos.
          </p>
        </div>
        <div className="flex gap-2">
          {puede(usuario.rol, 'apertura') && (
            <Link
              href="/aperturas/nueva"
              className="bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco text-sm rounded-lg px-3 py-2"
            >
              ➕ Nueva apertura
            </Link>
          )}
          {puede(usuario.rol, 'cancelacion') && (
            <Link
              href="/cancelaciones/nueva"
              className="bg-red-600 hover:bg-red-500 text-ultra-blanco text-sm rounded-lg px-3 py-2"
            >
              ➖ Nueva cancelación
            </Link>
          )}
        </div>
      </div>

      {respaldos && !respaldos.alDia && (
        <Link
          href="/respaldos"
          className="block bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 hover:bg-amber-500/15"
        >
          <p className="text-sm text-amber-300 font-semibold">
            {respaldos.ultimo
              ? `El último respaldo es de hace ${respaldos.dias} días`
              : 'Todavía no hay ningún respaldo de la plataforma'}
          </p>
          <p className="text-xs text-amber-400 mt-0.5">
            {respaldos.ultimo
              ? 'El respaldo automático se está atrasando. Entra a Respaldos, haz uno y bájatelo.'
              : 'Entra a Respaldos, haz el primero y guárdalo fuera del servidor. Hasta entonces no hay a dónde volver.'}
          </p>
        </Link>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi titulo="Servicios activos" valor={formatNumber(k.servicios)} icono="🏢" />
        <Kpi titulo="Guardias en operación" valor={formatNumber(k.guardias)} sub={`${k.promGuardias} por servicio`} icono="👮" tono="cyan" />
        <Kpi titulo="Facturación mensual" valor={formatCurrency(k.facturacion)} icono="💰" tono="emerald" />
        <Kpi titulo="Sin contrato" valor={formatNumber(k.sinContrato)} sub={`${k.conContrato} con contrato`} icono="📄" tono={k.sinContrato ? 'amber' : 'emerald'} />
        <Kpi titulo="Sin facturar" valor={formatNumber(k.sinFacturar)} sub={`${k.facturados} facturados`} icono="🧾" tono={k.sinFacturar ? 'amber' : 'emerald'} />
        {/* Vencido y por vencer van separados a propósito: los dos son dinero
            sin cobrar, pero solo el primero es adeudo. Al segundo todavía le
            corre el plazo de crédito que se le concedió al cliente. */}
        <Kpi
          titulo="Saldo vencido"
          valor={formatCurrency(cobranza.vencido)}
          sub={`${formatCurrency(cobranza.porVencer)} por vencer`}
          icono="⚠️"
          tono={cobranza.vencido > 0 ? 'red' : 'slate'}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Aperturas vs cancelaciones</h2>
              <p className="text-slate-400 text-sm">Guardias por periodo — últimos 18 meses con movimiento</p>
            </div>
            <span className={`text-sm font-medium ${netoTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Neto {netoTotal >= 0 ? '+' : ''}
              {formatNumber(netoTotal)}
            </span>
          </div>
          <MovimientosChart datos={movimientos} />
        </div>

        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-white mb-1">Motivos de cancelación</h2>
          <p className="text-slate-400 text-sm mb-4">Guardias retirados por motivo</p>
          <div className="space-y-2">
            {motivos.motivos.map((m) => {
              const max = motivos.motivos[0]?.guardias || 1;
              return (
                <div key={m.motivo}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300 truncate pr-2">{m.motivo}</span>
                    <span className="text-slate-400 shrink-0">{formatNumber(m.guardias)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${(m.guardias / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {motivos.motivos.length === 0 && (
              <p className="text-slate-500 text-sm">Sin cancelaciones con motivo registrado.</p>
            )}
          </div>
          {motivos.sin_motivo > 0 && (
            <p className="text-slate-500 text-xs mt-4 pt-3 border-t border-slate-700/60">
              {motivos.sin_motivo} de {motivos.total} cancelaciones no traen motivo: ese dato vive en el
              archivo de Aperturas y Cancelaciones, no en la hoja del estado de fuerza.
            </p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <RepartoTurnos reparto={turnos} base="/estado-fuerza" />

        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Por zona</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Zona</th>
                <th className="text-right pb-2">Serv.</th>
                <th className="text-right pb-2">Guardias</th>
              </tr>
            </thead>
            <tbody>
              {zonas.map((z) => (
                <tr key={z.zona} className="border-b border-slate-800/60">
                  <td className="py-1.5 text-slate-300">{z.zona}</td>
                  <td className="py-1.5 text-right text-slate-400">{z.servicios}</td>
                  <td className="py-1.5 text-right text-white">{formatNumber(z.guardias)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Asesores por guardias</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Asesor</th>
                <th className="text-right pb-2">Serv.</th>
                <th className="text-right pb-2">Guardias</th>
              </tr>
            </thead>
            <tbody>
              {asesores.map((a) => (
                <tr key={a.asesor} className="border-b border-slate-800/60">
                  <td className="py-1.5 text-slate-300 truncate max-w-[140px]">{a.asesor}</td>
                  <td className="py-1.5 text-right text-slate-400">{a.servicios}</td>
                  <td className="py-1.5 text-right text-white">{formatNumber(a.guardias)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Contratos</h2>

          <div className="flex items-baseline justify-between">
            <p className="text-xs text-red-400 font-medium">Ya vencidos</p>
            <span className="text-xs text-slate-500">{vencen.vencidos.length}</span>
          </div>
          {vencen.vencidos.length === 0 ? (
            <p className="text-slate-500 text-xs mt-1">Ninguno.</p>
          ) : (
            <ul className="space-y-1.5 mt-1.5">
              {vencen.vencidos.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <Link href={`/estado-fuerza/${s.id}`} className="text-sm text-slate-300 hover:text-cyan-400 truncate">
                    {s.servicio}
                  </Link>
                  <span className="text-xs text-red-400 shrink-0">{s.fecha_vencimiento_contrato}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-baseline justify-between mt-4 pt-3 border-t border-slate-700/60">
            <p className="text-xs text-amber-400 font-medium">Vencen en 90 días</p>
            <span className="text-xs text-slate-500">{vencen.porVencer.length}</span>
          </div>
          {vencen.porVencer.length === 0 ? (
            <p className="text-slate-500 text-xs mt-1">Ninguno en los próximos 90 días.</p>
          ) : (
            <ul className="space-y-1.5 mt-1.5">
              {vencen.porVencer.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <Link href={`/estado-fuerza/${s.id}`} className="text-sm text-slate-300 hover:text-cyan-400 truncate">
                    {s.servicio}
                  </Link>
                  <span className="text-xs text-amber-400 shrink-0">{s.fecha_vencimiento_contrato}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white mb-3">Movimientos recientes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-700">
                <th className="text-left pb-2">Folio</th>
                <th className="text-left pb-2">Tipo</th>
                <th className="text-left pb-2">Servicio</th>
                <th className="text-right pb-2">Guardias</th>
                <th className="text-right pb-2">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recientes.map((m) => (
                <tr key={m.folio} className="border-b border-slate-800/60">
                  <td className="py-1.5 font-mono text-xs text-slate-400">{m.folio}</td>
                  <td className="py-1.5">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        m.clase === 'APERTURA'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}
                    >
                      {m.tipo}
                    </span>
                  </td>
                  <td className="py-1.5 text-slate-300">{m.servicio}</td>
                  <td className={`py-1.5 text-right ${m.clase === 'APERTURA' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {m.clase === 'APERTURA' ? '+' : '-'}
                    {m.guardias}
                  </td>
                  <td className="py-1.5 text-right text-slate-500 text-xs">{m.fecha || '—'}</td>
                </tr>
              ))}
              {recientes.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    Sin movimientos.
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
