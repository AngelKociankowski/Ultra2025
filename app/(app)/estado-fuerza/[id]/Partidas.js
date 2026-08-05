'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatNumber } from '@/lib/utils';

const IVA = 0.16;
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numero = (v) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const vacia = () => ({ puesto: '', turno: '', cantidad: '', precio_unitario: '', nota: '' });

/**
 * El precio del servicio, renglón por renglón.
 *
 * Cada renglón es una partida —tantos guardias, de tal puesto, en tal turno, a
 * tal precio— y el importe mensual es la suma. Con un solo precio por servicio
 * había que promediar, y un promedio no se le puede enseñar al cliente.
 *
 * El total de guardias del desglose se compara contra la plantilla, que la
 * mueven las aperturas y las cancelaciones. Cuando no cuadran se avisa y no se
 * corrige: puede faltar un movimiento o sobrar un renglón, y quien lleva el
 * servicio es el único que sabe cuál de las dos.
 */
export default function Partidas({ servicio, resumen, puestos, turnos, puedeEditar }) {
  const router = useRouter();
  // Los turnos que este servicio sí tiene van primero: son los únicos que
  // normalmente se cotizan, y buscarlos entre los quince del catálogo era
  // trabajo para nada.
  const suyos = Object.keys(servicio.turnos || {});
  const otros = turnos.filter((t) => !suyos.includes(t));
  const [filas, setFilas] = useState(() =>
    resumen.partidas.length
      ? resumen.partidas.map((p) => ({
          puesto: p.puesto,
          turno: p.turno || '',
          cantidad: String(p.cantidad),
          precio_unitario: String(p.precio_unitario),
          nota: p.nota || '',
        }))
      : []
  );
  const [editando, setEditando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cambiar = (i, campo, valor) =>
    setFilas((f) => f.map((fila, j) => (j === i ? { ...fila, [campo]: valor } : fila)));
  const quitar = (i) => setFilas((f) => f.filter((_, j) => j !== i));
  const agregar = () => setFilas((f) => [...f, vacia()]);

  const conDatos = filas.filter((f) => f.puesto || f.cantidad || f.precio_unitario);
  const guardias = conDatos.reduce((a, f) => a + Math.round(numero(f.cantidad)), 0);
  const sinIva = redondear(conDatos.reduce((a, f) => a + numero(f.cantidad) * numero(f.precio_unitario), 0));
  const cuadra = conDatos.length === 0 || guardias === servicio.total_guardias;

  async function guardar() {
    setEnviando(true);
    setError('');
    try {
      const r = await fetch(`/api/servicios/${servicio.id}/partidas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partidas: conDatos }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo guardar.');
      setEditando(false);
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  const campo = 'bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white';

  return (
    <section id="precio" className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden scroll-mt-20">
      <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">Precio por puesto</h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            En un servicio los guardias no cuestan lo mismo: un jefe de servicio no vale lo que un guardia raso, ni
            las 24 horas lo que un 12X12. Aquí se captura renglón por renglón y el importe del mes es la suma.
          </p>
        </div>
        {puedeEditar && !editando && (
          <button
            type="button"
            onClick={() => {
              if (!filas.length) setFilas([vacia()]);
              setEditando(true);
            }}
            className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
          >
            {resumen.hay ? '✎ Editar el desglose' : '➕ Capturar el desglose'}
          </button>
        )}
      </div>

      {!editando && !resumen.hay && (
        <p className="px-5 py-6 text-sm text-slate-500">
          Este servicio todavía lleva un solo precio para todos.{' '}
          {servicio.importe_factura ? (
            <>
              Hoy factura <strong className="text-slate-300">{formatCurrency(servicio.importe_factura)}</strong> al
              mes, sin desglosar.
            </>
          ) : (
            'No tiene importe capturado.'
          )}
        </p>
      )}

      {(editando || resumen.hay) && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Puesto</th>
                <th className="text-left px-3 py-3">Turno</th>
                <th className="text-right px-3 py-3">Guardias</th>
                <th className="text-right px-3 py-3">Precio c/u</th>
                <th className="text-right px-3 py-3">Importe</th>
                <th className="text-left px-3 py-3">Nota</th>
                {editando && <th className="w-10 px-3 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {(editando ? filas : resumen.partidas).map((p, i) =>
                editando ? (
                  <tr key={i} className="border-t border-slate-800/70">
                    <td className="px-4 py-2">
                      <select
                        value={p.puesto}
                        onChange={(e) => cambiar(i, 'puesto', e.target.value)}
                        className={`${campo} w-full`}
                      >
                        <option value="">— Escoge —</option>
                        {puestos.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                        {p.puesto && !puestos.includes(p.puesto) && <option value={p.puesto}>{p.puesto}</option>}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={p.turno}
                        onChange={(e) => cambiar(i, 'turno', e.target.value)}
                        className={`${campo} w-full`}
                      >
                        <option value="">Sin distinguir</option>
                        {suyos.length > 0 && (
                          <optgroup label="Los de este servicio">
                            {suyos.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Los demás">
                          {otros.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </optgroup>
                        {p.turno && !turnos.includes(p.turno) && <option value={p.turno}>{p.turno}</option>}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="1"
                        value={p.cantidad}
                        onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
                        className={`${campo} w-20 text-right`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={p.precio_unitario}
                        onChange={(e) => cambiar(i, 'precio_unitario', e.target.value)}
                        className={`${campo} w-28 text-right`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatCurrency(numero(p.cantidad) * numero(p.precio_unitario))}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={p.nota}
                        onChange={(e) => cambiar(i, 'nota', e.target.value)}
                        placeholder="opcional"
                        className={`${campo} w-full`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => quitar(i)}
                        title="Quitar el renglón"
                        className="text-slate-500 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className="border-t border-slate-800/70">
                    <td className="px-4 py-2 text-slate-200">{p.puesto}</td>
                    <td className="px-3 py-2 text-slate-400">{p.turno || '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-300 tabular-nums">{p.cantidad}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{formatCurrency(p.precio_unitario)}</td>
                    <td className="px-3 py-2 text-right text-slate-200">{formatCurrency(p.importe)}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{p.nota || ''}</td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-700 bg-slate-900/40">
                <td className="px-4 py-2 text-slate-400 text-xs" colSpan={2}>
                  Total del mes
                </td>
                <td className="px-3 py-2 text-right text-slate-200 tabular-nums">{formatNumber(guardias)}</td>
                <td></td>
                <td className="px-3 py-2 text-right font-semibold text-white">{formatCurrency(sinIva)}</td>
                <td className="px-3 py-2 text-xs text-slate-500" colSpan={editando ? 2 : 1}>
                  {formatCurrency(redondear(sinIva * (1 + IVA)))} con IVA
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!cuadra && (
        <p className="px-5 py-3 text-xs text-amber-400 border-t border-slate-700/50">
          El desglose suma {formatNumber(guardias)} guardias y la plantilla dice{' '}
          {formatNumber(servicio.total_guardias)}. Puede faltar registrar un movimiento o sobrar un renglón; el
          estado de fuerza solo lo mueven las aperturas y las cancelaciones, así que esto no lo corrige.
        </p>
      )}

      {editando && (
        <div className="px-5 py-3 border-t border-slate-700/50 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={agregar}
            className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2"
          >
            + Agregar renglón
          </button>
          {suyos.length > 0 && (
            /* El desglose por turno ya está capturado en la plantilla: repetirlo
               a mano para cotizarlo era teclear dos veces lo mismo. Esto lo
               arranca cuadrado y solo queda poner los precios. */
            <button
              type="button"
              onClick={() =>
                setFilas(
                  suyos.map((t) => ({
                    puesto: puestos[0] || '',
                    turno: t,
                    cantidad: String(servicio.turnos[t]),
                    precio_unitario: '',
                    nota: '',
                  }))
                )
              }
              className="text-sm bg-slate-700/60 hover:bg-slate-700 text-slate-300 rounded-lg px-3 py-2"
              title="Un renglón por cada turno del servicio, con sus cantidades"
            >
              Partir por turnos
            </button>
          )}
          <button
            type="button"
            onClick={guardar}
            disabled={enviando}
            className="text-sm bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {enviando ? 'Guardando…' : 'Guardar el desglose'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditando(false);
              setError('');
              setFilas(
                resumen.partidas.map((p) => ({
                  puesto: p.puesto,
                  turno: p.turno || '',
                  cantidad: String(p.cantidad),
                  precio_unitario: String(p.precio_unitario),
                  nota: p.nota || '',
                }))
              );
            }}
            className="text-sm text-slate-400 hover:text-white"
          >
            Cancelar
          </button>
          <span className="text-xs text-slate-500">
            Al guardar, el importe de factura del servicio pasa a ser esta suma.
          </span>
        </div>
      )}

      {error && <p className="px-5 py-3 text-sm text-red-400 border-t border-slate-700/50">{error}</p>}
    </section>
  );
}
