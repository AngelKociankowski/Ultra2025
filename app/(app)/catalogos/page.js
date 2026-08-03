import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { puede } from '@/lib/rbac';
import { listarParaAdmin, TIPOS } from '@/lib/catalogos';
import GestionCatalogos from './GestionCatalogos';

export const dynamic = 'force-dynamic';

export default function Catalogos() {
  const usuario = usuarioActual();
  if (!puede(usuario.rol, 'catalogos')) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-white mb-2">Sin permiso</h1>
        <p className="text-slate-400 text-sm">Solo el administrador alimenta los catálogos de captura.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-cyan-400 hover:underline">
          ← Volver al tablero
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Catálogos de captura</h1>
        <p className="text-slate-400 text-sm max-w-3xl">
          Las listas que se ofrecen al registrar una apertura o un movimiento. Lo que agregues aquí aparece de
          inmediato en los formularios; lo que no esté en la lista no se puede capturar.
        </p>
      </div>

      <GestionCatalogos datos={listarParaAdmin()} tipos={TIPOS} />

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white mb-2">Cómo se comporta cada acción</h2>
        <dl className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-slate-200">Renombrar</dt>
            <dd className="text-slate-400 text-xs">
              Corrige también hacia atrás: cambia el valor en los servicios que lo traen y en sus movimientos. Es
              para arreglar una falta de captura, no para reasignar un servicio a otra zona o a otro asesor —eso se
              hace servicio por servicio.
            </dd>
          </div>
          <div>
            <dt className="text-slate-200">Desactivar</dt>
            <dd className="text-slate-400 text-xs">
              Deja de ofrecerse en capturas nuevas y no le toca el dato a nadie. Es lo que corresponde cuando un
              asesor se va o una zona se deja de operar: sus servicios conservan el nombre con el que se registraron.
            </dd>
          </div>
          <div>
            <dt className="text-slate-200">Borrar</dt>
            <dd className="text-slate-400 text-xs">
              Solo si ningún servicio la trae capturada. Si alguno la usa, la plataforma no deja borrarla, porque el
              dato seguiría en pantalla sin nada que lo explique.
            </dd>
          </div>
          <div>
            <dt className="text-slate-200">Cortes cerrados</dt>
            <dd className="text-slate-400 text-xs">
              Ninguna de estas acciones toca los cortes de meses anteriores. Ese es el respaldo de lo que se facturó y
              no se reescribe.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
