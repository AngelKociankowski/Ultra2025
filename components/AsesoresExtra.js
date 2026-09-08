'use client';

/**
 * Los asesores que acompañan al principal.
 *
 * Empieza escondido detrás de un enlace, y eso es lo importante del diseño: la
 * inmensa mayoría de los servicios tiene un asesor y uno solo. Poner siempre a
 * la vista una lista con botones de agregar y quitar le cobraría a todos el
 * precio de una excepción, y el formulario de apertura ya es largo.
 *
 * Aparece desplegado cuando ya hay alguien en la lista —al corregir un servicio
 * que la trae— porque esconder un dato capturado es peor que enseñar un control
 * de más: nadie busca lo que no sabe que existe.
 */
export default function AsesoresExtra({ principal, lista, setLista, opciones }) {
  const disponibles = (opciones || []).filter((a) => a !== principal && !lista.includes(a));

  function agregar(nombre) {
    if (!nombre) return;
    setLista([...lista, nombre]);
  }

  function quitar(nombre) {
    setLista(lista.filter((a) => a !== nombre));
  }

  if (!principal) return null;

  return (
    <details open={lista.length > 0} className="mt-1.5">
      <summary className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden">
        {lista.length ? `Con ${lista.length} asesor${lista.length === 1 ? '' : 'es'} más` : '+ Lo lleva más de un asesor'}
      </summary>

      <div className="mt-1.5 space-y-1.5">
        {lista.map((a) => (
          <div key={a} className="flex items-center gap-2 text-sm">
            <span className="text-slate-300 flex-1 truncate">{a}</span>
            <button
              type="button"
              onClick={() => quitar(a)}
              className="text-xs text-slate-500 hover:text-red-400 px-1.5 py-0.5"
            >
              Quitar
            </button>
          </div>
        ))}

        <select
          value=""
          onChange={(e) => agregar(e.target.value)}
          disabled={disponibles.length === 0}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
        >
          <option value="">
            {disponibles.length ? '— Agregar otro asesor —' : 'Ya están todos los del catálogo'}
          </option>
          {disponibles.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    </details>
  );
}
