import Link from 'next/link';
import Icono from '@/components/Icono';

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
 *
 * Va como texto y un punto de color, no como pastilla con fondo y borde.
 * Setenta y tres de doscientos diecisiete servicios no tienen contrato: con la
 * pastilla, la columna era una pared de rojo de arriba abajo, y un color que
 * sale en un renglón de cada tres deja de avisar de nada. El punto conserva la
 * señal —se recorre la columna y se ve dónde está el rojo— sin que cada renglón
 * grite. Y el color nunca va solo: la palabra dice lo mismo, que es lo que
 * salva a quien no distingue el rojo del verde.
 */

function Punto({ tono }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tono}`}
    />
  );
}

export default function CeldaContrato({ servicioId, tiene, archivo, nombre, vence }) {
  const base = 'group/c inline-flex items-baseline gap-1.5 text-xs whitespace-nowrap';

  if (!tiene) {
    return (
      <Link
        href={servicioId ? `/estado-fuerza/${servicioId}#contrato` : '#'}
        title={
          vence
            ? `Marcado como sin contrato, pero trae fecha de vencimiento (${vence}). Una de las dos cosas está mal capturada.`
            : 'Este servicio opera sin contrato firmado'
        }
        className={`${base} text-red-300 hover:underline`}
      >
        <Punto tono="bg-red-400 translate-y-[-1px]" />
        <span>
          Sin contrato
          {/* Treinta servicios dicen que no tienen contrato y traen fecha de
              vencimiento. Con la palomita de antes no se notaba; ahora que la
              leyenda es explícita, callarlo sería esconder el error. */}
          {vence && (
            <span className="block text-[10px] text-amber-400 leading-tight">…pero vence {vence}</span>
          )}
        </span>
      </Link>
    );
  }

  if (archivo) {
    return (
      <a
        href={`/api/servicios/${servicioId}/contrato`}
        title={`Abrir ${nombre || 'el contrato'}${vence ? ` · vence ${vence}` : ''}`}
        className={`${base} text-slate-300 hover:text-cyan-400 hover:underline`}
      >
        <Icono nombre="contrato" tamano={13} className="text-emerald-400 translate-y-[2px]" />
        <span>
          Con contrato
          {vence && <span className="block text-[10px] text-slate-500 leading-tight">vence {vence}</span>}
        </span>
      </a>
    );
  }

  return (
    <Link
      href={servicioId ? `/estado-fuerza/${servicioId}#contrato` : '#'}
      title="Sí tiene contrato, pero el PDF no se ha subido a la plataforma"
      className={`${base} text-slate-300 hover:text-cyan-400 hover:underline`}
    >
      <Punto tono="bg-slate-500 translate-y-[-1px]" />
      <span>
        Con contrato
        <span className="block text-[10px] text-slate-500 leading-tight">
          falta subir el PDF{vence ? ` · vence ${vence}` : ''}
        </span>
      </span>
    </Link>
  );
}
