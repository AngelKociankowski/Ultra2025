import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import {
  kpisJuridico,
  carteraJuridica,
  calendarioVencimientos,
  inconsistencias,
  catalogosJuridicos,
  ESTADOS,
  DIAS_AVISO,
} from '@/lib/juridico';
import { formatCurrency, formatNumber } from '@/lib/utils';
import Filtros from './Filtros';
import Agenda from './Agenda';
import Fila from './Fila';
import Inconsistencias from './Inconsistencias';

export const dynamic = 'force-dynamic';

const plural = (n, uno, muchos) => `${formatNumber(n)} ${n === 1 ? uno : muchos}`;

function Kpi({ titulo, estado, datos, sub, grande = false, href }) {
  const tono = estado ? ESTADOS[estado].tono : 'slate';
  const color = {
    red: 'text-red-400',
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    slate: 'text-slate-300',
  }[tono];
  const borde = {
    red: 'border-red-500/30 bg-red-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
    emerald: 'border-slate-700/50 bg-slate-800/30',
    slate: 'border-slate-700/50 bg-slate-800/30',
  }[tono];

  const cuerpo = (
    <>
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`${grande ? 'text-3xl' : 'text-2xl'} font-bold ${color}`}>{formatNumber(datos.servicios)}</p>
      <p className="text-xs text-slate-400 mt-0.5">
        {plural(datos.guardias, 'guardia', 'guardias')} · {formatCurrency(datos.monto)}/mes
      </p>
      {sub && <p className="text-[11px] text-slate-500 mt-1 leading-tight">{sub}</p>}
    </>
  );

  const clase = `block rounded-2xl border p-4 ${borde} ${href ? 'hover:border-slate-500 transition-colors' : ''}`;
  return href ? (
    <Link href={href} className={clase}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clase}>{cuerpo}</div>
  );
}

export default function Juridico({ searchParams }) {
  const usuario = usuarioActual();
  const puedeEditar = puede(usuario.rol, 'editar_contrato');

  const filtros = {
    estado: ESTADOS[searchParams?.estado] ? searchParams.estado : '',
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    pdf: ['con', 'sin'].includes(searchParams?.pdf) ? searchParams.pdf : '',
    q: searchParams?.q || '',
  };

  const k = kpisJuridico();
  const { filas, subtotal } = carteraJuridica(filtros);
  const agenda = calendarioVencimientos();
  const raras = inconsistencias();
  const catalogos = catalogosJuridicos();
  const hayFiltro = Object.values(filtros).some(Boolean);

  const consulta = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Jurídico</h1>
          <p className="text-slate-400 text-sm max-w-3xl">
            Con qué papel está operando cada servicio. Son los{' '}
            <strong className="text-white">{formatNumber(k.total.servicios)}</strong> servicios vivos —activos y
            suspendidos—, porque un servicio en pausa conserva su contrato y su vigencia sigue corriendo mientras
            está parado.
          </p>
        </div>
        <a
          href={`/api/juridico/export${consulta ? `?${consulta}` : ''}`}
          className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
        >
          ⬇ Bajar a Excel
        </a>
      </div>

      {/* Lo que exige acción esta semana va primero y en grande. Lo demás es
          contexto. Un tablero que pinta las cinco casillas del mismo tamaño
          obliga a leerlas todas para saber cuál importa. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi
          titulo="Sin contrato"
          estado="SIN_CONTRATO"
          datos={k.por.SIN_CONTRATO}
          sub="operando sin papel firmado"
          grande
          href="/juridico?estado=SIN_CONTRATO"
        />
        <Kpi
          titulo="Contrato vencido"
          estado="VENCIDO"
          datos={k.por.VENCIDO}
          sub="la vigencia ya terminó"
          grande
          href="/juridico?estado=VENCIDO"
        />
        <Kpi
          titulo={`Vence en ${DIAS_AVISO} días`}
          estado="POR_VENCER"
          datos={k.por.POR_VENCER}
          sub="hay tiempo de renovar"
          href="/juridico?estado=POR_VENCER"
        />
        <Kpi
          titulo="Sin vigencia capturada"
          estado="SIN_FECHA"
          datos={k.por.SIN_FECHA}
          sub="ni siquiera se sabe si vencieron"
          href="/juridico?estado=SIN_FECHA"
        />
        <Kpi
          titulo="Vigente"
          estado="VIGENTE"
          datos={k.por.VIGENTE}
          sub="firmado y dentro de su plazo"
          href="/juridico?estado=VIGENTE"
        />
      </div>

      {/* El resumen en una frase, para quien solo va a leer un renglón. */}
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-5 py-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm text-slate-300">Hoy hay</span>
        <strong className="text-lg text-red-400">{plural(k.urgente.servicios, 'servicio', 'servicios')}</strong>
        <span className="text-sm text-slate-300">
          operando sin contrato vigente: {plural(k.urgente.guardias, 'guardia', 'guardias')} en la calle y{' '}
          <strong className="text-white">{formatCurrency(k.urgente.monto)}</strong> facturados al mes sin respaldo.
        </span>
      </div>

      <Agenda agenda={agenda} />

      {raras.total > 0 && <Inconsistencias datos={raras} puedeEditar={puedeEditar} />}

      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">Cartera de contratos</h2>
            <p className="text-xs text-slate-500">
              De lo más urgente a lo que ya está resuelto.{' '}
              {puedeEditar
                ? 'Da clic en un renglón para actualizar su contrato sin salir de aquí.'
                : 'Da clic en un renglón para ver el detalle del contrato.'}
            </p>
          </div>
          <p className="text-xs text-slate-400">
            {hayFiltro ? 'Filtrado: ' : 'Total: '}
            <strong className="text-white">{plural(subtotal.servicios, 'servicio', 'servicios')}</strong> ·{' '}
            {plural(subtotal.guardias, 'guardia', 'guardias')} · {formatCurrency(subtotal.monto)}/mes
          </p>
        </div>

        <div className="p-3 border-b border-slate-700/50">
          <Filtros valores={filtros} catalogos={catalogos} />
        </div>

        {filas.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500 text-center">
            Ningún servicio cumple con esos filtros.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead className="bg-slate-900/60">
                <tr className="text-slate-400 text-xs">
                  <th className="text-left px-4 py-3">Servicio</th>
                  <th className="text-left px-3 py-3">Zona</th>
                  <th className="text-right px-3 py-3">Guardias</th>
                  <th className="text-right px-3 py-3">Importe/mes</th>
                  <th className="text-left px-3 py-3">Estado</th>
                  <th className="text-left px-3 py-3">Firma</th>
                  <th className="text-left px-3 py-3">Vence</th>
                  <th className="text-left px-3 py-3">Expediente</th>
                  <th className="text-left px-3 py-3">Notas de jurídico</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((s) => (
                  <Fila key={s.id} servicio={s} puedeEditar={puedeEditar} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!puedeEditar && (
        <p className="text-xs text-slate-500">
          Esta pantalla la ven todos —saber si un cliente tiene contrato le sirve a ventas y a operaciones tanto
          como a jurídico— pero solo jurídico y el administrador la modifican.
        </p>
      )}
    </div>
  );
}
