import { usuarioActual } from '@/lib/auth';
import { ROLES } from '@/lib/rbac';
import CambiarPassword from './CambiarPassword';

export const dynamic = 'force-dynamic';

export default function Cuenta() {
  const usuario = usuarioActual();
  const rol = ROLES[usuario.rol];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Mi cuenta</h1>
        <p className="text-slate-400 text-sm">
          {usuario.nombre} · {usuario.email} · {rol?.etiqueta || usuario.rol}
        </p>
      </div>

      <div className="max-w-md">
        <h2 className="text-sm font-semibold text-white mb-1">Cambiar mi contraseña</h2>
        <p className="text-xs text-slate-500 mb-3">
          El alta inicial reparte la misma contraseña a las cinco cuentas. Cámbiala en cuanto entres.
        </p>
        <CambiarPassword />
      </div>

      <p className="text-xs text-slate-500 max-w-md">
        Al cambiarla se cierran tus demás sesiones y esta se mantiene. Si olvidaste la actual, un
        administrador puede restablecerla desde Usuarios.
      </p>
    </div>
  );
}
