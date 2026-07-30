import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { catalogos } from '@/lib/servicios';
import { serviciosActivosParaSelect } from '@/lib/queries';
import FormApertura from './FormApertura';

export const dynamic = 'force-dynamic';

export default function NuevaApertura() {
  const usuario = usuarioActual();

  if (!puede(usuario.rol, 'apertura')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">
          Tu rol ({usuario.rol}) no registra aperturas. Corresponde a admin, operaciones y ventas.
        </p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <Link href="/aperturas" className="text-sm text-slate-400 hover:text-cyan-400">
          ← Aperturas
        </Link>
        <h1 className="text-2xl font-bold text-white mt-2">Nueva apertura</h1>
        <p className="text-slate-400 text-sm">
          Al guardar, el servicio entra al estado de fuerza. Un incremento suma guardias a un servicio ya activo.
        </p>
      </div>
      <FormApertura catalogos={catalogos()} serviciosActivos={serviciosActivosParaSelect()} />
    </div>
  );
}
