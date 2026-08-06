import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { ultimoCorte } from '@/lib/queries';
import { mesActual } from '@/lib/fechas';
import { calendarioDe, movimientosDe, aniosCon, netoDelPeriodo } from '@/lib/movimientos';
import BarraMeses from '@/components/BarraMeses';
import TablaMovimientos from '@/components/TablaMovimientos';
import { opciones } from '@/lib/catalogos';
import ResumenPeriodo from '@/components/ResumenPeriodo';

export const dynamic = 'force-dynamic';

export default function Aperturas({ searchParams }) {
  const usuario = usuarioActual();
  const db = getDb();

  // Las pantallas de movimientos las ve todo el mundo: son el historial de la
  // operación, y ocultárselo a quien no captura no protege nada. Lo que sí está
  // detrás del permiso es cambiarlas.
  const puedeAplicar = puede(usuario.rol, 'apertura');

  // Las que nunca llegaron al estado de fuerza son casi todas viejas, así que
  // pedirlas implica mirar el histórico completo y no un mes suelto.
  const soloPendientes = searchParams?.pendientes === '1';
  const soloDescartadas = searchParams?.descartadas === '1';
  const pedido = soloPendientes || soloDescartadas ? 'todo' : searchParams?.periodo || '';
  const todo = pedido === 'todo';
  const periodo = todo ? '' : /^\d{4}-\d{2}$/.test(pedido) ? pedido : mesActual();
  const anio = Number((periodo || pedido || mesActual()).slice(0, 4)) || Number(mesActual().slice(0, 4));

  const calendario = calendarioDe('aperturas', anio);
  const { movimientos, resumen } = movimientosDe('aperturas', periodo, {
    zona: searchParams?.zona || '',
    asesor: searchParams?.asesor || '',
    tipo: searchParams?.tipo || '',
    q: searchParams?.q || '',
    sinAplicar: soloPendientes,
    descartadas: soloDescartadas,
  });
  const neto = periodo ? netoDelPeriodo(periodo) : null;

  // Una apertura anterior al último corte describe un mes que ya cerró sin
  // ella. Se puede aplicar igual, pero avisando.
  const corte = ultimoCorte();
  const conAviso = movimientos.map((m) => ({ ...m, vieja: !!corte && (m.periodo || '') <= corte }));

  const pendientes = db
    .prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(guardias), 0) AS g FROM aperturas WHERE servicio_id IS NULL AND descartada = 0'
    )
    .get();
  const descartadas = db.prepare('SELECT COUNT(*) AS n FROM aperturas WHERE descartada = 1').get().n;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Aperturas</h1>
          <p className="text-slate-400 text-sm max-w-3xl">
            Es la única vía de entrada al estado de fuerza. Escoge el mes y toca cualquier renglón para ver todo lo
            que se capturó de ese movimiento.
          </p>
        </div>
        {puedeAplicar && (
          <Link
            href="/aperturas/nueva"
            className="bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco text-sm rounded-lg px-3 py-2"
          >
            ➕ Nueva apertura
          </Link>
        )}
      </div>

      {pendientes.n > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-amber-300 font-semibold">
              {formatNumber(pendientes.n)} apertura{pendientes.n === 1 ? '' : 's'} sin aplicar ·{' '}
              {formatNumber(pendientes.g)} guardias que no están sumando
            </p>
            <p className="text-xs text-amber-400 max-w-3xl mt-0.5">
              Están anotadas, pero nunca se les creó el servicio, así que no aparecen en el estado de fuerza.
              {puedeAplicar
                ? ' Aplicar crea el servicio con los datos que la propia apertura ya trae. Si el servicio ya no opera —casi todas son viejas—, Descartar la saca de esta cuenta sin borrarla del histórico.'
                : ' Ventas, operaciones o el administrador pueden aplicarlas o descartarlas.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={soloPendientes ? '/aperturas' : '/aperturas?pendientes=1'}
              className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg px-3 py-2 whitespace-nowrap"
            >
              {soloPendientes ? 'Volver al mes' : 'Ver solo las pendientes'}
            </Link>
            {descartadas > 0 && (
              <Link
                href={soloDescartadas ? '/aperturas' : '/aperturas?descartadas=1'}
                className="text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-300 border border-slate-600/60 rounded-lg px-3 py-2 whitespace-nowrap"
              >
                {soloDescartadas ? 'Volver al mes' : `${formatNumber(descartadas)} descartadas`}
              </Link>
            )}
          </div>
        </div>
      )}

      {pendientes.n === 0 && descartadas > 0 && (
        // Cuando ya no queda ninguna pendiente el aviso de arriba desaparece, y
        // con él la única puerta a las descartadas. Esta la deja abierta.
        <p className="text-xs text-slate-500">
          No queda ninguna apertura pendiente de aplicar ·{' '}
          <Link href={soloDescartadas ? '/aperturas' : '/aperturas?descartadas=1'} className="text-cyan-400 hover:underline">
            {soloDescartadas ? 'volver al mes' : `ver las ${formatNumber(descartadas)} descartadas`}
          </Link>
        </p>
      )}

      <BarraMeses
        ruta="/aperturas"
        calendario={calendario}
        seleccionado={todo ? 'todo' : periodo}
        anios={aniosCon('aperturas')}
        tono="emerald"
      />

      <ResumenPeriodo
        clase="aperturas"
        periodo={todo ? null : periodo}
        resumen={resumen}
        extra={
          neto && (
            <span>
              Contra {formatNumber(neto.baja.guardias)} guardias cancelados el mismo mes, el estado de fuerza{' '}
              <strong className={neto.neto >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {neto.neto >= 0 ? 'creció' : 'bajó'} {formatNumber(Math.abs(neto.neto))}
              </strong>
              .{' '}
              <Link href={`/cancelaciones?periodo=${periodo}`} className="text-cyan-400 hover:underline">
                Ver las cancelaciones
              </Link>
            </span>
          )
        }
      />

      <TablaMovimientos clase="aperturas" movimientos={conAviso} puedeAplicar={puedeAplicar} opciones={opciones()} />

      {resumen.sinMonto > 0 && (
        <p className="text-xs text-slate-500">
          {formatNumber(resumen.sinMonto)} de {formatNumber(resumen.movimientos)} movimientos no traen precio
          capturado ni servicio ligado, así que no entran en los {formatCurrency(resumen.monto)}. El total es de lo
          que se puede saber, no una estimación de todo.
        </p>
      )}
    </div>
  );
}
