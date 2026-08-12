import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { mesActual } from '@/lib/fechas';
import { calendarioDe, movimientosDe, aniosCon, netoDelPeriodo } from '@/lib/movimientos';
import BarraMeses from '@/components/BarraMeses';
import TablaMovimientos from '@/components/TablaMovimientos';
import ResumenPeriodo from '@/components/ResumenPeriodo';
import Icono from '@/components/Icono';

export const dynamic = 'force-dynamic';

export default function Cancelaciones({ searchParams }) {
  const usuario = usuarioActual();

  // Verlas es de todos: son el historial de por qué se fue cada cliente, y esa
  // es información que a operaciones y a ventas les sirve más que a nadie.
  // Registrar una sigue siendo de quien tiene el permiso.
  const puedeRegistrar = puede(usuario.rol, 'cancelacion');

  const pedido = searchParams?.periodo || '';
  const todo = pedido === 'todo';
  const periodo = todo ? '' : /^\d{4}-\d{2}$/.test(pedido) ? pedido : mesActual();
  const anio = Number((periodo || pedido || mesActual()).slice(0, 4)) || Number(mesActual().slice(0, 4));

  const calendario = calendarioDe('cancelaciones', anio);
  const { movimientos, resumen } = movimientosDe('cancelaciones', periodo, {
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    tipo: searchParams?.tipo || '',
    q: searchParams?.q || '',
  });
  const neto = periodo ? netoDelPeriodo(periodo) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Cancelaciones y reducciones</h1>
          <p className="text-slate-400 text-sm max-w-3xl">
            Es la única vía de salida del estado de fuerza. Escoge el mes y toca cualquier renglón para ver el motivo
            completo y cómo quedó el servicio.
          </p>
        </div>
        {puedeRegistrar && (
          <Link
            href="/cancelaciones/nueva"
            className="bg-red-600 hover:bg-red-500 text-ultra-blanco text-sm rounded-lg px-3 py-2"
          >
            <Icono nombre="movimiento" className="mr-1.5 -mt-0.5" />Movimiento de guardias
          </Link>
        )}
      </div>

      <BarraMeses
        ruta="/cancelaciones"
        calendario={calendario}
        seleccionado={todo ? 'todo' : periodo}
        anios={aniosCon('cancelaciones')}
        tono="red"
      />

      <ResumenPeriodo
        clase="cancelaciones"
        periodo={todo ? null : periodo}
        resumen={resumen}
        extra={
          neto && (
            <span>
              Contra {formatNumber(neto.alta.guardias)} guardias aperturados el mismo mes, el estado de fuerza{' '}
              <strong className={neto.neto >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {neto.neto >= 0 ? 'creció' : 'bajó'} {formatNumber(Math.abs(neto.neto))}
              </strong>
              .{' '}
              <Link href={`/aperturas?periodo=${periodo}`} className="text-cyan-400 hover:underline">
                Ver las aperturas
              </Link>
            </span>
          )
        }
      />

      <TablaMovimientos clase="cancelaciones" movimientos={movimientos} />

      {resumen.sinMonto > 0 && (
        <p className="text-xs text-slate-500">
          {formatNumber(resumen.sinMonto)} de {formatNumber(resumen.movimientos)} movimientos no tienen precio
          capturado ni servicio ligado, así que no entran en los {formatCurrency(resumen.monto)}. Es lo que se sabe
          con certeza; el resto se quedó sin ese dato en los archivos de los que vino.
        </p>
      )}
    </div>
  );
}
