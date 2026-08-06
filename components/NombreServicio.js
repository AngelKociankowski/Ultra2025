import Link from 'next/link';

/**
 * El servicio con su razón social debajo.
 *
 * En cobranza el nombre corto no alcanza. «AGATHA» es como lo conoce
 * operaciones, pero quien persigue el pago habla con «ADMINISTRADORA GRUPO
 * ADCCO, AC», que es lo que dice la factura y lo que aparece en el estado de
 * cuenta del banco. De 217 servicios activos, 193 tienen una razón social
 * distinta de su nombre: en la práctica, casi siempre son dos nombres para lo
 * mismo y en la pantalla de cobro hacía falta el segundo.
 *
 * Se omite cuando no aporta —vacía, o igual al nombre salvo mayúsculas y
 * espacios—: repetir el mismo texto dos veces solo alarga el renglón.
 */
export default function NombreServicio({ id, servicio, razonSocial, className = '' }) {
  const normal = (v) => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const distinta = razonSocial && normal(razonSocial) !== normal(servicio);

  return (
    <div className={className}>
      {id ? (
        <Link href={`/estado-fuerza/${id}`} className="text-slate-200 hover:text-cyan-400">
          {servicio}
        </Link>
      ) : (
        <span className="text-slate-200">{servicio}</span>
      )}
      {distinta && <p className="text-xs text-slate-500 leading-tight">{razonSocial}</p>}
    </div>
  );
}
