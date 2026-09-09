'use client';

import { formatCurrency } from '@/lib/utils';

/**
 * Cuántos guardias de cada puesto, a qué precio y con qué sueldo.
 *
 * En un servicio los guardias no cuestan lo mismo ni ganan lo mismo. Un jefe de
 * servicio no es un guardia raso, y el mismo puesto en 24 horas no vale lo que
 * en 12X12. La plataforma ya sabía guardar ese detalle —vive en las partidas de
 * precio del servicio— pero solo se podía capturar entrando después a la ficha,
 * y quien da de alta el servicio es el que tiene el dato en la mano en ese
 * momento. Al revisar una apertura se reportó justamente eso: la división de
 * jornadas y la de turnos estaban, la de puestos y la de salarios no.
 *
 * El sueldo es lo único que aquí es nuevo de verdad. Antes el servicio tenía UN
 * sueldo base para todos, que no es cierto en ninguna parte. Con el precio y el
 * sueldo en el mismo renglón, cada puesto dice por fin lo que deja.
 *
 * Dos decisiones de forma:
 *
 *   · Es opcional y va cerrado. Un servicio se puede abrir sin desglosar el
 *     precio —así se abrieron los 217 que ya están— y el formulario de apertura
 *     ya es largo. Quien lo necesita lo abre.
 *   · Avisa si la suma no cuadra con las jornadas, y no lo impide. Que las
 *     partidas sumen ocho y la plantilla diga seis puede ser un renglón de más
 *     o un movimiento de menos, y solo quien está capturando sabe cuál.
 */
export default function DesglosePuestos({ filas, setFilas, puestos, jornadas, plantilla }) {
  const numero = (v) => {
    const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const conDatos = filas.filter((f) => f.puesto || f.cantidad || f.precio_unitario || f.sueldo);
  const guardias = conDatos.reduce((a, f) => a + Math.round(numero(f.cantidad)), 0);
  const precio = conDatos.reduce((a, f) => a + numero(f.cantidad) * numero(f.precio_unitario), 0);
  const conSueldo = conDatos.filter((f) => String(f.sueldo || '').trim() !== '');
  const nomina = conSueldo.reduce((a, f) => a + numero(f.cantidad) * numero(f.sueldo), 0);
  const precioConSueldo = conSueldo.reduce((a, f) => a + numero(f.cantidad) * numero(f.precio_unitario), 0);

  const cambiar = (i, campo, valor) =>
    setFilas(filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  const campo =
    'bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500';

  return (
    <details className="mt-4 border-t border-slate-700/50 pt-4">
      <summary className="text-sm text-slate-300 hover:text-white cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden">
        Puestos y sueldos
        <span className="text-[11px] text-slate-500 ml-2">
          Opcional. Cuántos son de cada puesto, a qué precio y con qué sueldo.
        </span>
      </summary>

      <div className="mt-3 space-y-2">
        {filas.map((f, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Puesto</label>
              <select value={f.puesto} onChange={(e) => cambiar(i, 'puesto', e.target.value)} className={`${campo} w-44`}>
                <option value="">— elige —</option>
                {puestos.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Jornada</label>
              <select value={f.turno} onChange={(e) => cambiar(i, 'turno', e.target.value)} className={`${campo} w-32`}>
                <option value="">todas</option>
                {jornadas.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Guardias</label>
              <input
                type="number"
                min="0"
                value={f.cantidad}
                onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
                className={`${campo} w-20 text-right`}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Precio c/u</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={f.precio_unitario}
                onChange={(e) => cambiar(i, 'precio_unitario', e.target.value)}
                className={`${campo} w-28 text-right`}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Sueldo c/u</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={f.sueldo}
                onChange={(e) => cambiar(i, 'sueldo', e.target.value)}
                placeholder="opcional"
                className={`${campo} w-28 text-right`}
              />
            </div>
            <button
              type="button"
              onClick={() => setFilas(filas.filter((_, j) => j !== i))}
              className="text-xs text-slate-500 hover:text-red-400 pb-1.5"
            >
              Quitar
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setFilas([...filas, { puesto: '', turno: '', cantidad: '', precio_unitario: '', sueldo: '' }])}
          className="text-xs text-cyan-400 hover:underline"
        >
          + Agregar puesto
        </button>

        {conDatos.length > 0 && (
          <div className="text-xs bg-slate-900/50 rounded-lg px-3 py-2 flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-slate-400">
              {guardias} guardias · <strong className="text-white">{formatCurrency(precio)}</strong> al mes
            </span>
            {nomina > 0 && (
              <span className="text-slate-400">
                Nómina {formatCurrency(nomina)} · deja{' '}
                <strong className={precioConSueldo - nomina >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatCurrency(precioConSueldo - nomina)}
                </strong>
              </span>
            )}
            {/* El descuadre se avisa y no se impide: puede ser un renglón de
                más o una jornada de menos, y eso lo sabe quien captura. */}
            {plantilla > 0 && guardias !== plantilla && (
              <span className="text-amber-400">
                Los puestos suman {guardias} y las jornadas {plantilla}.
              </span>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
