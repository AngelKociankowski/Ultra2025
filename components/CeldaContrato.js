import Link from 'next/link';

/**
 * Si el servicio tiene contrato, y el contrato.
 *
 * La palomita de antes contestaba media pregunta. «Sí tiene contrato» sin poder
 * verlo obliga a ir a buscar el papel a un cajón, que es exactamente el trabajo
 * que esta plataforma existe para ahorrar.
 *
 * Cuando el PDF está subido, la leyenda es el botón que lo abre. Cuando no,
 * lleva a la ficha —ahí lo sube jurídico— y lo dice sin rodeos, porque un
 * contrato que nadie encuentra es, en la práctica, un contrato que no está.
 */
export default function CeldaContrato({ servicioId, tiene, archivo, nombre, vence }) {
  const base = 'inline-block text-xs rounded-lg px-2 py-1 border whitespace-nowrap';

  if (!tiene) {
    return (
      <Link
        href={servicioId ? `/estado-fuerza/${servicioId}#contrato` : '#'}
        title={
          vence
            ? `Marcado como sin contrato, pero trae fecha de vencimiento (${vence}). Una de las dos cosas está mal capturada.`
            : 'Este servicio opera sin contrato firmado'
        }
        className={`${base} bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20`}
      >
        No cuenta con contrato
        {/* Treinta servicios dicen que no tienen contrato y traen fecha de
            vencimiento. Con la palomita de antes no se notaba; ahora que la
            leyenda es explícita, callarlo sería esconder el error. */}
        {vence && <span className="block text-[10px] text-amber-400 leading-tight">…pero vence {vence}</span>}
      </Link>
    );
  }

  if (archivo) {
    return (
      <a
        href={`/api/servicios/${servicioId}/contrato`}
        title={`Abrir ${nombre || 'el contrato'}${vence ? ` · vence ${vence}` : ''}`}
        className={`${base} bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25`}
      >
        📄 Cuenta con contrato
        {vence && <span className="block text-[10px] text-emerald-400/70 leading-tight">vence {vence}</span>}
      </a>
    );
  }

  return (
    <Link
      href={servicioId ? `/estado-fuerza/${servicioId}#contrato` : '#'}
      title="Sí tiene contrato, pero el PDF no se ha subido a la plataforma"
      className={`${base} bg-slate-700/60 text-slate-300 border-slate-600/60 hover:bg-slate-700`}
    >
      Cuenta con contrato
      <span className="block text-[10px] text-slate-500 leading-tight">
        falta subir el PDF{vence ? ` · vence ${vence}` : ''}
      </span>
    </Link>
  );
}
