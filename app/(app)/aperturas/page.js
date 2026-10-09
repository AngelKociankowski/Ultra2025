import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { ultimoCorte } from '@/lib/queries';
import { mesActual } from '@/lib/fechas';
import {
  calendarioDe,
  movimientosDe,
  aniosCon,
  netoDelPeriodo,
  pendientesPorAntiguedad,
  filtroDePendientes,
  MESES_RECIENTE,
} from '@/lib/movimientos';
import BarraMeses from '@/components/BarraMeses';
import TablaMovimientos from '@/components/TablaMovimientos';
import DescarteEnLote from './DescarteEnLote';
import { TOPE_LOTE } from '@/lib/servicios';
import { opciones } from '@/lib/catalogos';
import ResumenPeriodo from '@/components/ResumenPeriodo';
import Icono from '@/components/Icono';

export const dynamic = 'force-dynamic';

export default function Aperturas({ searchParams }) {
  const usuario = usuarioActual();
  const db = getDb();

  // Las pantallas de movimientos las ve todo el mundo: son el historial de la
  // operación, y ocultárselo a quien no captura no protege nada. Lo que sí está
  // detrás del permiso es cambiarlas.
  const puedeAplicar = puede(usuario.rol, 'apertura');

  /**
   * Cuál cola de pendientes se está viendo.
   *
   * Son tres y no una porque las 219 aperturas sin aplicar no son una sola cosa:
   * las de los últimos doce meses todavía se pueden atender, y el resto es el
   * arrastre de la importación —servicios que ya no operan—, que se revisa una
   * vez y se cierra. Mezclarlas en un único «pendientes» es lo que tenía el
   * aviso de arriba encendido en 219 para siempre.
   *
   * `todas` se conserva para quien venga de un enlace viejo o quiera el total:
   * lo que el aviso deja de contar no desaparece de la plataforma.
   */
  const colaPedida = ['1', 'viejas', 'todas'].includes(searchParams?.pendientes)
    ? searchParams.pendientes
    : '';
  const cola = colaPedida === '1' ? 'recientes' : colaPedida;
  const soloPendientes = Boolean(cola);
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
    ...(soloPendientes ? filtroDePendientes(cola) : {}),
    descartadas: soloDescartadas,
  });
  const neto = periodo ? netoDelPeriodo(periodo) : null;

  // Una apertura anterior al último corte describe un mes que ya cerró sin
  // ella. Se puede aplicar igual, pero avisando.
  const corte = ultimoCorte();
  const conAviso = movimientos.map((m) => ({ ...m, vieja: !!corte && (m.periodo || '') <= corte }));

  const pendientes = pendientesPorAntiguedad();
  const descartadas = db.prepare('SELECT COUNT(*) AS n FROM aperturas WHERE descartada = 1').get().n;

  /**
   * Los años que abarca el arrastre, sacados de los datos y no escritos a mano.
   *
   * «de 2023 a 2025» en el código quedaría congelado el día que alguien
   * descarte las más viejas, y entonces la línea mentiría sobre lo que queda.
   * Cuando el primero y el último son el mismo año se dice uno solo: «de 2025 a
   * 2025» se lee como un error de redacción.
   */
  const anioA = pendientes.viejas.desde?.slice(0, 4);
  const anioB = pendientes.viejas.hasta?.slice(0, 4);
  const aniosViejas = anioA === anioB ? `de ${anioA}` : `de ${anioA} a ${anioB}`;

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
            <Icono nombre="alta" className="mr-1.5 -mt-0.5" />Nueva apertura
          </Link>
        )}
      </div>

      {/* La caja ámbar cuenta solo lo que todavía se puede atender.
          El texto —«N apertura(s) sin aplicar · M guardias que no están
          sumando»— se conserva palabra por palabra: está bien escrito y es el
          que la operación ya tiene leído. Lo que cambia es de dónde sale el
          número. */}
      {pendientes.recientes.n > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-amber-300 font-semibold">
              {formatNumber(pendientes.recientes.n)} apertura{pendientes.recientes.n === 1 ? '' : 's'} sin aplicar ·{' '}
              {formatNumber(pendientes.recientes.guardias)} guardias que no están sumando
            </p>
            <p className="text-xs text-amber-400 max-w-3xl mt-0.5">
              De los últimos {MESES_RECIENTE} meses. Están anotadas, pero nunca se les creó el servicio, así que no
              aparecen en el estado de fuerza.
              {puedeAplicar
                ? ' Aplicar crea el servicio con los datos que la propia apertura ya trae. Si el servicio ya no opera, Descartar la saca de esta cuenta sin borrarla del histórico.'
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

      {/* El arrastre de la importación, en gris y sin caja de alarma.
          Dicho una vez y alcanzable, que es lo que necesita: son aperturas de
          servicios que hace años no operan, y tenerlas sumadas al aviso de
          arriba era lo que lo dejaba encendido en 219 para siempre. Un número
          que no se puede llevar a cero no es un pendiente; encima enseña a
          pasar por encima de los avisos ámbar que sí piden algo. */}
      {pendientes.viejas.n > 0 && (
        <p className="text-xs text-slate-500 max-w-4xl">
          Otras {formatNumber(pendientes.viejas.n)} aperturas {aniosViejas} quedaron sin aplicar al importar el
          archivo: describen servicios que ya no operan.{' '}
          <Link
            href={cola === 'viejas' ? '/aperturas' : '/aperturas?pendientes=viejas'}
            className="text-cyan-400 hover:underline"
          >
            {cola === 'viejas' ? 'Volver al mes' : 'Revisarlas'} →
          </Link>
        </p>
      )}

      {pendientes.total.n === 0 && descartadas > 0 && (
        // Cuando ya no queda ninguna pendiente el aviso de arriba desaparece, y
        // con él la única puerta a las descartadas. Esta la deja abierta.
        <p className="text-xs text-slate-500">
          No queda ninguna apertura pendiente de aplicar ·{' '}
          <Link href={soloDescartadas ? '/aperturas' : '/aperturas?descartadas=1'} className="text-cyan-400 hover:underline">
            {soloDescartadas ? 'volver al mes' : `ver las ${formatNumber(descartadas)} descartadas`}
          </Link>
        </p>
      )}

      {/* Cuál de las tres colas se está viendo, y cómo pasar a otra. Sin esto,
          `?pendientes=viejas` y `?pendientes=todas` serían dos pantallas a las
          que solo se puede llegar escribiendo la URL. */}
      {soloPendientes && (
        <p className="text-xs text-slate-400 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-slate-500">Estás viendo las pendientes:</span>
          {[
            ['1', 'recientes', `últimos ${MESES_RECIENTE} meses`, pendientes.recientes.n],
            ['viejas', 'viejas', 'arrastre de la importación', pendientes.viejas.n],
            ['todas', 'todas', 'todas', pendientes.total.n],
          ].map(([clave, valor, etiqueta, n]) => (
            <Link
              key={clave}
              href={`/aperturas?pendientes=${clave}`}
              className={`rounded px-1.5 py-0.5 ${
                cola === valor ? 'bg-cyan-500/20 text-cyan-200' : 'hover:bg-slate-700/60 text-slate-400'
              }`}
            >
              {etiqueta} ({formatNumber(n)})
            </Link>
          ))}
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

      {/* La barra de descarte en lote solo en la cola de las viejas y solo para
          quien registra aperturas. No se ofrece sobre el mes ni sobre «todas»:
          un descarte masivo tiene que caer sobre una lista ya acotada, y la de
          las viejas es justo la que el corte dejó del otro lado. */}
      {cola === 'viejas' && puedeAplicar ? (
        <DescarteEnLote movimientos={conAviso} opciones={opciones()} tope={TOPE_LOTE} />
      ) : (
        <TablaMovimientos clase="aperturas" movimientos={conAviso} puedeAplicar={puedeAplicar} opciones={opciones()} />
      )}

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
