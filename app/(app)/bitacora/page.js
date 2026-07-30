import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { listarBitacora } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const COLOR_ACCION = {
  apertura: 'bg-emerald-500/20 text-emerald-300',
  incremento: 'bg-emerald-500/20 text-emerald-300',
  cancelacion: 'bg-red-500/20 text-red-300',
  reduccion: 'bg-amber-500/20 text-amber-300',
  editar: 'bg-cyan-500/20 text-cyan-300',
  login: 'bg-slate-600/40 text-slate-300',
  crear_usuario: 'bg-violet-500/20 text-violet-300',
  editar_usuario: 'bg-violet-500/20 text-violet-300',
};

export default function Bitacora() {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'bitacora')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">Tu rol ({usuario.rol}) no tiene acceso a la bitácora.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  const filas = listarBitacora({ limite: 300 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Bitácora</h1>
        <p className="text-slate-400 text-sm">
          Todo movimiento y toda edición quedan registrados con usuario, rol y fecha.
        </p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-3 py-3">Usuario</th>
                <th className="text-left px-3 py-3">Rol</th>
                <th className="text-left px-3 py-3">Acción</th>
                <th className="text-left px-3 py-3">Detalle</th>
                <th className="text-left px-3 py-3">Cambios</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((b) => {
                let cambios = null;
                try {
                  cambios = b.cambios ? JSON.parse(b.cambios) : null;
                } catch {
                  cambios = null;
                }
                return (
                  <tr key={b.id} className="border-t border-slate-800/70 align-top">
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{b.creado_en}</td>
                    <td className="px-3 py-2 text-slate-300">{b.usuario}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{b.rol}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${COLOR_ACCION[b.accion] || 'bg-slate-700 text-slate-300'}`}>
                        {b.accion}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {b.entidad === 'servicio' && b.entidad_id ? (
                        <Link href={`/estado-fuerza/${b.entidad_id}`} className="hover:text-cyan-400">
                          {b.detalle}
                        </Link>
                      ) : (
                        b.detalle
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 max-w-[320px]">
                      {cambios
                        ? Object.entries(cambios).map(([k, v]) => (
                            <div key={k} className="truncate">
                              <span className="text-slate-400">{k}:</span> {String(v.antes ?? '—')} →{' '}
                              <span className="text-slate-300">{String(v.despues ?? '—')}</span>
                            </div>
                          ))
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Sin registros.
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
