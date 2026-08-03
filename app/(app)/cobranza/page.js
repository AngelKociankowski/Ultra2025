import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import {
  kpisCobranza,
  facturasVencidas,
  pendientesDeFacturar,
  facturasDelPeriodo,
  calendarioFacturacion,
} from '@/lib/facturacion';
import { formatCurrency, formatNumber } from '@/lib/utils';
import PorFacturar from './PorFacturar';
import CalendarioMeses from './CalendarioMeses';
import Emitidas from './Emitidas';

export const dynamic = 'force-dynamic';

const plural = (n, singular) => `${formatNumber(n)} ${singular}${n === 1 ? '' : 's'}`;

function Kpi({ titulo, valor, sub, tono = 'slate' }) {
  const color = {
    slate: 'text-slate-200',
    emerald: 'text-emerald-400',
    cyan: 'text-cyan-400',
    red: 'text-red-400',
  }[tono];
  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-bold ${color}`}>{valor}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CobranzaGeneral({ searchParams }) {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'editar_finanzas')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">La cobranza la llevan finanzas y el administrador.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  const k = kpisCobranza();
  const vencidas = facturasVencidas(200);
  // El mes se puede cambiar desde la pantalla: facturar suele hacerse a
  // principios del siguiente, cuando ya cerró el que se va a cobrar.
  const periodo = /^\d{4}-\d{2}$/.test(searchParams?.periodo || '')
    ? searchParams.periodo
    : new Date().toISOString().slice(0, 7);
  const pendientes = pendientesDeFacturar(periodo);
  const calendario = calendarioFacturacion(periodo.slice(0, 4));
  const emitidas = facturasDelPeriodo(periodo);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Cobranza</h1>
          <p className="text-slate-400 text-sm max-w-3xl">
            Lo que está <strong className="text-cyan-400">por vencer</strong> todavía corre dentro del plazo de
            crédito que se le dio al cliente. Solo lo <strong className="text-red-400">vencido</strong> es adeudo.
          </p>
        </div>
        <Link
          href="/cobranza/inicio"
          className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
        >
          ⚙ Puesta al día
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi titulo="Facturado" valor={formatCurrency(k.emitido)} sub={plural(k.facturas, 'factura')} />
        <Kpi titulo="Cobrado" valor={formatCurrency(k.cobrado)} tono="emerald" />
        <Kpi titulo="Por vencer" valor={formatCurrency(k.porVencer)} sub="dentro del plazo" tono="cyan" />
        <Kpi
          titulo="Vencido"
          valor={formatCurrency(k.vencido)}
          sub={`${plural(k.facturasVencidas, 'factura')} · ${plural(k.serviciosConAdeudo, 'servicio')}`}
          tono={k.vencido > 0 ? 'red' : 'slate'}
        />
        <Kpi titulo="Pendiente total" valor={formatCurrency(k.pendiente)} sub="vencido + por vencer" />
      </div>

      <CalendarioMeses calendario={calendario} seleccionado={periodo} />

      <PorFacturar
        periodo={pendientes.periodo}
        porFacturar={pendientes.porFacturar}
        sinCondiciones={pendientes.sinCondiciones}
        facturados={pendientes.facturados}
      />

      <Emitidas periodo={periodo} facturas={emitidas} puedeSubir={puede(usuario.rol, 'editar_finanzas')} />

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-white">Cartera vencida</h2>
          <p className="text-xs text-slate-500">
            Facturas cuyo plazo de crédito ya terminó. De la más atrasada a la más reciente.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Servicio</th>
                <th className="text-left px-3 py-3">Zona</th>
                <th className="text-left px-3 py-3">Asesor</th>
                <th className="text-left px-3 py-3">Periodo</th>
                <th className="text-left px-3 py-3">Venció</th>
                <th className="text-right px-3 py-3">Saldo</th>
                <th className="text-right px-4 py-3">Atraso</th>
              </tr>
            </thead>
            <tbody>
              {vencidas.map((f) => (
                <tr key={f.id} className="border-t border-slate-800/70">
                  <td className="px-4 py-2">
                    <Link href={`/estado-fuerza/${f.servicio_id}`} className="text-slate-200 hover:text-cyan-400">
                      {f.servicio}
                    </Link>
                    <span className="block text-[11px] text-slate-500">{f.razon_social || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{f.zona || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{f.asesor || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {f.periodo}
                    <span className="block text-[11px] text-slate-500">{f.concepto}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{f.fecha_vencimiento}</td>
                  <td className="px-3 py-2 text-right text-red-300">{formatCurrency(f.saldo)}</td>
                  <td className="px-4 py-2 text-right text-slate-400">{Math.abs(f.dias)} días</td>
                </tr>
              ))}
              {vencidas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No hay facturas vencidas. Todo lo emitido está dentro de su plazo o ya se cobró.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
