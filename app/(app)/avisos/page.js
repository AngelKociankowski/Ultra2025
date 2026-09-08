import Link from 'next/link';
import { usuarioActual } from '@/lib/auth';
import { listar } from '@/lib/avisos';
import MarcarLeidos from './MarcarLeidos';

export const dynamic = 'force-dynamic';

/**
 * Lo que te tocó saber.
 *
 * Existe por una observación de la operación: cuando alguien corrige un dato mal
 * capturado, el aviso tiene que llegarle a quien lo capturó y al área que
 * corresponda. Todo eso ya quedaba en la bitácora, pero una bitácora hay que ir
 * a mirarla y nadie la mira por si acaso; es el registro para cuando ya sabes
 * qué buscas. Esta pantalla es lo contrario: son las pocas cosas dirigidas a
 * una persona.
 *
 * Sin permiso propio a propósito. Cualquiera que entra puede haber capturado el
 * dato que otro corrigió, así que cualquiera puede tener avisos; lo que acota
 * no es el rol sino que solo se ven los de uno.
 */
export default function Avisos() {
  const usuario = usuarioActual();
  const avisos = listar(usuario.id);
  const nuevos = avisos.filter((a) => !a.leido_en).length;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Avisos</h1>
          <p className="text-slate-400 text-sm">
            Cuando alguien corrige un dato que capturaste, o un dato de tu área, aparece aquí.
          </p>
        </div>
        {nuevos > 0 && <MarcarLeidos cuantos={nuevos} />}
      </div>

      {avisos.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-8 text-center">
          <p className="text-slate-300">No tienes avisos.</p>
          <p className="text-slate-500 text-sm mt-1">
            Es la situación normal: aquí solo llega lo que alguien corrigió de lo que capturaste.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {avisos.map((a) => (
            <li
              key={a.id}
              className={`border rounded-2xl p-4 ${
                a.leido_en
                  ? 'bg-slate-800/20 border-slate-700/40'
                  : 'bg-slate-800/50 border-cyan-700/50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-medium">
                    {!a.leido_en && (
                      <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-2 align-middle" />
                    )}
                    {a.titulo}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {a.origen} · {a.creado_en}
                  </p>
                </div>
                {a.entidad === 'servicio' && a.entidad_id && (
                  <Link
                    href={`/estado-fuerza/${a.entidad_id}`}
                    className="text-xs text-cyan-400 hover:underline whitespace-nowrap"
                  >
                    Ver el servicio →
                  </Link>
                )}
              </div>
              {/* El antes y el después van tal cual, en varias líneas: es lo
                  único que permite juzgar si la corrección entendió bien lo que
                  uno quiso poner. Resumirlo lo volvería un «te corrigieron
                  algo», que no sirve para nada. */}
              {a.cuerpo && (
                <pre className="text-xs text-slate-400 mt-2.5 whitespace-pre-wrap font-sans bg-slate-900/50 rounded-lg p-3">
                  {a.cuerpo}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
