import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import { formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default function Aperturas() {
  const usuario = usuarioActual();
  const db = getDb();
  const filas = db
    .prepare(
      `SELECT a.*, s.estatus AS estatus_servicio
         FROM aperturas a LEFT JOIN servicios s ON s.id = a.servicio_id
        ORDER BY COALESCE(a.fecha, a.creado_en) DESC, a.id DESC
        LIMIT 400`
    )
    .all();
  const totalGuardias = filas.reduce((a, f) => a + (f.guardias || 0), 0);

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
        {puede(usuario.rol, 'apertura') && (
          <Link
            href="/aperturas/nueva"
            className="bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco text-sm rounded-lg px-3 py-2"
          >
            ➕ Nueva apertura
          </Link>
        )}
      </div>

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
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Sin aperturas registradas.
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
