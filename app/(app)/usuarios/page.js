import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede, ROLES, GRUPOS_CAMPOS, PERMISOS } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import GestionUsuarios from './GestionUsuarios';

export const dynamic = 'force-dynamic';

export default function Usuarios() {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'usuarios')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">Solo el administrador gestiona usuarios.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  const lista = getDb()
    .prepare(
      `SELECT id, email, nombre, rol, activo, debe_cambiar_password, creado_en
         FROM usuarios ORDER BY rol, nombre`
    )
    .all();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Usuarios y permisos</h1>
        <p className="text-slate-400 text-sm">Altas, cambio de rol, reinicio de contraseña y desactivación.</p>
      </div>

      <GestionUsuarios usuarios={lista} miId={usuario.id} />

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-3">Matriz de permisos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-slate-700">
                <th className="text-left pb-2 pr-3">Rol</th>
                <th className="text-center pb-2 px-2">Consultar</th>
                <th className="text-center pb-2 px-2">Aperturas</th>
                <th className="text-center pb-2 px-2">Cancelaciones</th>
                <th className="text-center pb-2 px-2">Contratos</th>
                <th className="text-center pb-2 px-2">Facturas / pagos</th>
                <th className="text-center pb-2 px-2">Datos operativos</th>
                <th className="text-center pb-2 px-2">Usuarios</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ROLES).map(([clave, r]) => {
                const p = PERMISOS[clave] || [];
                const si = (x) => (p.includes(x) ? '✅' : '—');
                return (
                  <tr key={clave} className="border-b border-slate-800/60">
                    <td className="py-2 pr-3">
                      <span className="text-slate-200">{r.etiqueta}</span>
                      <p className="text-xs text-slate-500">{r.descripcion}</p>
                    </td>
                    <td className="text-center">{si('ver')}</td>
                    <td className="text-center">{si('apertura')}</td>
                    <td className="text-center">{si('cancelacion')}</td>
                    <td className="text-center">{si('editar_contrato')}</td>
                    <td className="text-center">{si('editar_finanzas')}</td>
                    <td className="text-center">{si('editar_operativo')}</td>
                    <td className="text-center">{si('usuarios')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Ningún rol puede dar de alta o eliminar un servicio directamente: el estado de fuerza solo cambia con
          aperturas y cancelaciones.
        </p>
      </section>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-3">Campos por bloque</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {Object.entries(GRUPOS_CAMPOS).map(([clave, g]) => (
            <div key={clave}>
              <p className="text-sm text-slate-200">{g.etiqueta}</p>
              <p className="text-xs text-slate-500 mb-2">
                Editan: {g.roles.map((r) => ROLES[r]?.etiqueta || r).join(', ')}
              </p>
              <div className="flex flex-wrap gap-1">
                {g.campos.map((c) => (
                  <span key={c} className="text-[11px] bg-slate-900/70 text-slate-400 rounded px-1.5 py-0.5">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
