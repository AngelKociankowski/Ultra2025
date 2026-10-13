import Link from 'next/link';
import { formatNumber } from '@/lib/utils';
import { comoFecha } from './formato';

/**
 * Los renglones donde el dato se contradice a sí mismo.
 *
 * No se corrigen solos ni se esconden. Vienen del archivo con el que se cargó
 * la plataforma y solo jurídico sabe cuál de las dos versiones es la buena:
 * si el contrato existe y falta la palomita, o si las fechas son de uno que ya
 * no vale.
 *
 * Podrían «arreglarse» automáticamente —marcar como que sí tienen contrato a
 * los que traen fecha— y la pantalla se vería limpia. Sería inventar un dato:
 * lo único que sabemos con certeza es que alguien capturó dos cosas que no
 * pueden ser ciertas al mismo tiempo.
 *
 * El texto y el destino tienen que decir lo mismo. Este panel decía «da clic en
 * cualquiera para arreglarlo en la lista de abajo» y cada nombre enlazaba a la
 * ficha del servicio, en otra pantalla: se prometía la lista de abajo y se
 * entregaba un viaje. Ahora los enlaces filtran la cartera de aquí mismo, que
 * es donde el renglón se abre con su editor de contrato, y por eso cada bloque
 * tiene un enlace de grupo además de los nombres sueltos.
 */
export default function Inconsistencias({ datos, puedeEditar, activo = '' }) {
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <h2 className="text-base font-semibold text-amber-300">
        {formatNumber(datos.total)} capturas que se contradicen
      </h2>
      <p className="text-xs text-amber-400/80 max-w-3xl mt-0.5">
        Vienen del archivo con el que se cargó la plataforma. No se corrigieron solas a propósito: cuál de las dos
        versiones es la buena lo sabe jurídico, no el sistema.
        {puedeEditar && ' Da clic en cualquiera para arreglarlo en la lista de abajo.'}
      </p>

      <div className="grid md:grid-cols-2 gap-5 mt-4">
        <Bloque
          titulo="Dicen «sin contrato» pero traen fechas"
          explicacion="O el contrato existe y falta marcarlo, o las fechas son de uno que ya venció."
          filas={datos.dicenQueNo}
          raro="sin_marca"
          activo={activo}
          detalle={(s) =>
            s.fecha_vencimiento_contrato ? `vencía ${comoFecha(s.fecha_vencimiento_contrato)}` : `firmado ${comoFecha(s.fecha_contrato)}`
          }
        />
        <Bloque
          titulo="Dicen «con contrato» y no hay nada"
          explicacion="Sin fecha de firma, sin vigencia y sin PDF. La palomita no está respaldada por ningún dato."
          filas={datos.dicenQueSi}
          raro="sin_respaldo"
          activo={activo}
          detalle={() => 'sin fecha ni PDF'}
        />
      </div>
    </section>
  );
}

function Bloque({ titulo, explicacion, filas, detalle, raro, activo }) {
  if (filas.length === 0) return null;
  const destino = `/juridico?raro=${raro}#cartera`;
  return (
    <div>
      <p className="text-sm text-white font-medium">
        {titulo} <span className="text-slate-400 font-normal">({formatNumber(filas.length)})</span>
      </p>
      <p className="text-xs text-slate-500 mb-2">{explicacion}</p>
      <ul className="space-y-0.5 max-h-52 overflow-y-auto pr-1">
        {filas.map((s) => (
          <li key={s.id} className="text-xs flex justify-between gap-3">
            {/* El nombre también lleva a la cartera filtrada y no a la ficha:
                todos los enlaces del panel van al mismo sitio, que es lo que
                hace que el rótulo de arriba sea cierto. */}
            <Link href={destino} className="text-slate-300 hover:text-white hover:underline truncate">
              {s.servicio}
            </Link>
            <span className="text-slate-500 whitespace-nowrap">{detalle(s)}</span>
          </li>
        ))}
      </ul>
      <Link
        href={activo === raro ? '/juridico#cartera' : destino}
        className="inline-block text-xs text-cyan-400 hover:underline mt-2"
      >
        {activo === raro ? 'Quitar el filtro' : `Verlos en la cartera de abajo →`}
      </Link>
    </div>
  );
}
