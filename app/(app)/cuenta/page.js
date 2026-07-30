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

      {usuario.debe_cambiar_password ? (
        <div className="max-w-md rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-amber-300">Pon tu contraseña para continuar</p>
          <p className="text-xs text-amber-300/90 mt-1">
            La que estás usando la escribió quien te dio de alta. Hasta que elijas una tuya, esta es la
            única pantalla disponible.
          </p>
        </div>
      ) : null}

      <div className="max-w-md">
        <h2 className="text-sm font-semibold text-white mb-1">Cambiar mi contraseña</h2>
        <p className="text-xs text-slate-500 mb-3">
          Una contraseña que conoce otra persona no es tuya. Cámbiala en cuanto entres.
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
