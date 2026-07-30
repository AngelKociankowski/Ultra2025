import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { serviciosActivosParaSelect } from '@/lib/queries';
import FormCancelacion from './FormCancelacion';

export const dynamic = 'force-dynamic';

export default function NuevaCancelacion({ searchParams }) {
  const usuario = usuarioActual();

  if (!puede(usuario.rol, 'cancelacion')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">
          Tu rol ({usuario.rol}) no registra cancelaciones. Corresponde a admin, operaciones y ventas.
        </p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <Link href="/cancelaciones" className="text-sm text-slate-400 hover:text-cyan-400">
          ← Cancelaciones
        </Link>
        <h1 className="text-2xl font-bold text-white mt-2">Nueva cancelación</h1>
        <p className="text-slate-400 text-sm">
          Una cancelación retira el servicio completo del estado de fuerza. Una reducción solo baja el número de
          guardias.
        </p>
      </div>
      <FormCancelacion
        serviciosActivos={serviciosActivosParaSelect()}
        preseleccion={searchParams?.servicio_id || ''}
      />
    </div>
  );
}
