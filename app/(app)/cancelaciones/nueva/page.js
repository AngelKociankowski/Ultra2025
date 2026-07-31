import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede, PERMISOS } from '@/lib/rbac';
import { serviciosActivosParaSelect } from '@/lib/queries';
import FormMovimiento from './FormMovimiento';

export const dynamic = 'force-dynamic';

export default function NuevoMovimiento({ searchParams }) {
  const usuario = usuarioActual();
  const puedeAlgo = puede(usuario.rol, 'cancelacion') || puede(usuario.rol, 'apertura');

  if (!puedeAlgo) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">
          Tu rol ({usuario.rol}) no mueve el estado de fuerza. Corresponde a admin, operaciones y ventas.
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
        <h1 className="text-2xl font-bold text-white mt-2">Movimiento de guardias</h1>
        <p className="text-slate-400 text-sm">
          Ampliar, disminuir o cancelar. Los tres cambian el número de guardias del servicio y quedan con folio, fecha
          y motivo.
        </p>
      </div>
      <FormMovimiento
        serviciosActivos={serviciosActivosParaSelect()}
        preseleccion={searchParams?.servicio_id || ''}
        permisos={PERMISOS[usuario.rol] || []}
        modoInicial={searchParams?.modo || ''}
      />
    </div>
  );
}
