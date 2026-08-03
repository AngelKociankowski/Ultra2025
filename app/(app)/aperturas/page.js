import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import { formatNumber } from '@/lib/utils';
import { ultimoCorte } from '@/lib/queries';
import AplicarApertura from './AplicarApertura';

export const dynamic = 'force-dynamic';

export default function Aperturas({ searchParams }) {
  const usuario = usuarioActual();
  const db = getDb();
  const soloPendientes = searchParams?.pendientes === '1';

  const filas = db
    .prepare(
      `SELECT a.*, s.estatus AS estatus_servicio
         FROM aperturas a LEFT JOIN servicios s ON s.id = a.servicio_id
        ${soloPendientes ? 'WHERE a.servicio_id IS NULL' : ''}
        ORDER BY COALESCE(a.fecha, a.creado_en) DESC, a.id DESC
        LIMIT 400`
    )
    .all();
  const totalGuardias = filas.reduce((a, f) => a + (f.guardias || 0), 0);

  // Aperturas anotadas que nunca llegaron al estado de fuerza. Casi todas vienen
  // de los archivos viejos, donde el movimiento se capturó pero el servicio no
  // apareció en ningún corte, así que al importar no hubo a quién amarrarlo.
  const pendientes = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(guardias), 0) AS g FROM aperturas WHERE servicio_id IS NULL')
    .get();

  // Cualquier apertura anterior al último corte importado describe un mes que ya
  // se cerró sin ella: si el servicio siguiera operando, habría salido en el
  // corte. Se puede aplicar igual, pero avisando.
  const corte = ultimoCorte();
  const esVieja = (f) => !!corte && (f.periodo || '') <= corte;
  const puedeAplicar = puede(usuario.rol, 'apertura');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Aperturas</h1>
          <p className="text-slate-400 text-sm">
            {formatNumber(filas.length)} movimientos · {formatNumber(totalGuardias)} guardias aperturados. Es la única
            vía de entrada al estado de fuerza.
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
              Están anotadas, pero nunca se les creó el servicio, así que no aparecen en el estado de fuerza. El botón{' '}
              <strong>Aplicar</strong> de cada renglón lo crea con los datos que la propia apertura ya trae. Revisa
              antes las viejas: si el servicio ya no opera, aplicarla lo daría de alta hoy.
            </p>
          </div>
          <Link
            href={soloPendientes ? '/aperturas' : '/aperturas?pendientes=1'}
            className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg px-3 py-2 whitespace-nowrap"
          >
            {soloPendientes ? 'Ver todas' : 'Ver solo las pendientes'}
          </Link>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Folio</th>
                <th className="text-left px-3 py-3">Tipo</th>
                <th className="text-left px-3 py-3">Servicio</th>
                <th className="text-left px-3 py-3">Zona</th>
                <th className="text-left px-3 py-3">Asesor</th>
                <th className="text-right px-3 py-3">Guardias</th>
                <th className="text-left px-3 py-3">Fecha</th>
                <th className="text-left px-3 py-3">Periodo</th>
                <th className="text-left px-3 py-3">Estado de fuerza</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t border-slate-800/70 hover:bg-slate-800/40">
                  <td className="px-4 py-2 font-mono text-xs text-slate-400">{f.folio}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">{f.tipo}</span>
                  </td>
                  <td className="px-3 py-2">
                    {f.servicio_id ? (
                      <Link href={`/estado-fuerza/${f.servicio_id}`} className="text-white hover:text-cyan-400">
                        {f.servicio}
                      </Link>
                    ) : (
                      <span className="text-slate-300">{f.servicio}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{f.zona || '—'}</td>
                  <td className="px-3 py-2 text-slate-400 truncate max-w-[150px]">{f.asesor || '—'}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">+{f.guardias}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{f.fecha || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{f.periodo || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {f.estatus_servicio ? (
                      <span className={f.estatus_servicio === 'ACTIVO' ? 'text-emerald-400' : 'text-slate-500'}>
                        {f.estatus_servicio}
                      </span>
                    ) : puedeAplicar ? (
                      <AplicarApertura
                        apertura={{
                          id: f.id,
                          folio: f.folio,
                          servicio: f.servicio,
                          guardias: f.guardias,
                          fecha: f.fecha,
                          periodo: f.periodo,
                        }}
                        vieja={esVieja(f)}
                      />
                    ) : (
                      <span className="text-amber-400/80">Sin aplicar</span>
                    )}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    {soloPendientes ? 'No queda ninguna apertura sin aplicar.' : 'Sin aperturas registradas.'}
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
