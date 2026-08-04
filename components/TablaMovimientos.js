'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { EXPEDIENTE_APERTURA, EXPEDIENTE_CANCELACION } from '@/lib/campos';
import AplicarApertura from './AplicarApertura';

const dinero = (v) => (v === null || v === undefined || v === '' ? null : formatCurrency(v));

function valor(f, clave, tipo) {
  const v = f[clave];
  if (v === null || v === undefined || v === '') return null;
  if (tipo === 'money') return dinero(v);
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
}

function Turnos({ turnos, tono }) {
  const filas = Object.entries(turnos || {});
  if (!filas.length) return <span className="text-slate-600">sin desglose</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {filas.map(([t, n]) => (
        <span key={t} className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${tono}`}>
          {t} · {n}
        </span>
      ))}
    </div>
  );
}

/**
 * La tabla del mes, con el expediente completo detrás de cada renglón.
 *
 * En la captura de una apertura se llenan treinta campos y en la lista caben
 * siete. Todo lo demás quedaba escrito y sin nadie que lo mirara nunca, que es
 * casi lo mismo que no haberlo capturado. Aquí el renglón se abre y enseña todo
 * lo que se guardó de ese movimiento, más lo que hoy dice la ficha del servicio.
 *
 * Se abre uno a la vez, a propósito: si se pudieran abrir todos, la tabla del
 * mes volvería a ser el archivero volcado en el suelo del que veníamos.
 */
export default function TablaMovimientos({ clase, movimientos, puedeAplicar = false }) {
  const [abierto, setAbierto] = useState(null);
  const esApertura = clase === 'aperturas';
  const grupos = esApertura ? EXPEDIENTE_APERTURA : EXPEDIENTE_CANCELACION;
  const tonoTurno = esApertura ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300';
  const columnas = 9;

  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1080px]">
          <thead className="bg-slate-900/60">
            <tr className="text-slate-400 text-xs">
              <th className="w-8 px-3 py-3"></th>
              <th className="text-left px-3 py-3">Folio</th>
              <th className="text-left px-3 py-3">Servicio</th>
              <th className="text-left px-3 py-3">Zona</th>
              <th className="text-left px-3 py-3">Asesor</th>
              <th className="text-left px-3 py-3">Turnos</th>
              <th className="text-right px-3 py-3">Guardias</th>
              <th className="text-right px-3 py-3">Importe al mes</th>
              <th className="text-left px-4 py-3">{esApertura ? 'Estado de fuerza' : 'Motivo'}</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((f) => {
              const activo = abierto === f.id;
              return (
                <Fragment key={f.id}>
                  <tr
                    onClick={() => setAbierto(activo ? null : f.id)}
                    className={`border-t border-slate-800/70 cursor-pointer ${
                      activo ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="px-3 py-2 text-slate-500 select-none">{activo ? '▾' : '▸'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {f.folio}
                      <span className="block text-[11px] text-slate-500">{f.fecha || '—'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-white">{f.servicio}</span>
                      <span className="block text-[11px] text-slate-500">
                        {f.razon_social || f.s_razon_social || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{f.zona || f.s_zona || '—'}</td>
                    <td className="px-3 py-2 text-slate-400 truncate max-w-[150px]">{f.asesor || '—'}</td>
                    <td className="px-3 py-2">
                      <Turnos turnos={f.turnos} tono={tonoTurno} />
                    </td>
                    <td className={`px-3 py-2 text-right ${esApertura ? 'text-emerald-400' : 'text-red-400'}`}>
                      {esApertura ? '+' : '−'}
                      {f.guardias}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {f.monto === null ? (
                        <span className="text-slate-600 text-xs">sin precio</span>
                      ) : (
                        <>
                          <span className="text-slate-200">{formatCurrency(f.monto)}</span>
                          {f.origenMonto === 'del servicio' && (
                            <span className="block text-[11px] text-slate-500">estimado</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {esApertura ? (
                        f.estatus_servicio ? (
                          <span className={f.estatus_servicio === 'ACTIVO' ? 'text-emerald-400' : 'text-slate-500'}>
                            {f.estatus_servicio}
                          </span>
                        ) : (
                          <span onClick={(e) => e.stopPropagation()}>
                            {puedeAplicar ? (
                              <AplicarApertura apertura={f} vieja={!!f.vieja} />
                            ) : (
                              <span className="text-amber-400/80">Sin aplicar</span>
                            )}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400 line-clamp-2 max-w-[220px] inline-block">
                          {f.motivo || '—'}
                        </span>
                      )}
                    </td>
                  </tr>

                  {activo && (
                    <tr className="border-t border-slate-800/70 bg-slate-900/40">
                      <td colSpan={columnas} className="px-6 py-4">
                        <div className="grid gap-5 lg:grid-cols-3">
                          {grupos.map((g) => {
                            const datos = g.campos
                              .map(([clave, etiqueta, tipo]) => [etiqueta, valor(f, clave, tipo)])
                              .filter(([, v]) => v !== null);
                            if (!datos.length) return null;
                            return (
                              <div key={g.titulo}>
                                <h4 className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">{g.titulo}</h4>
                                <dl className="space-y-1">
                                  {datos.map(([etiqueta, v]) => (
                                    <div key={etiqueta} className="flex gap-2 text-xs">
                                      <dt className="text-slate-500 min-w-[110px]">{etiqueta}</dt>
                                      <dd className="text-slate-300">{v}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            );
                          })}

                          <div>
                            <h4 className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                              El servicio hoy
                            </h4>
                            {f.servicio_id ? (
                              <dl className="space-y-1">
                                <div className="flex gap-2 text-xs">
                                  <dt className="text-slate-500 min-w-[110px]">Estatus</dt>
                                  <dd className={f.estatus_servicio === 'ACTIVO' ? 'text-emerald-400' : 'text-slate-400'}>
                                    {f.estatus_servicio}
                                    {f.s_guardias != null && ` · ${formatNumber(f.s_guardias)} guardia${f.s_guardias === 1 ? '' : 's'}`}
                                  </dd>
                                </div>
                                {f.turnosServicio && Object.keys(f.turnosServicio).length > 0 && (
                                  <div className="flex gap-2 text-xs">
                                    <dt className="text-slate-500 min-w-[110px]">Turnos hoy</dt>
                                    <dd>
                                      <Turnos turnos={f.turnosServicio} tono="bg-slate-700/60 text-slate-300" />
                                    </dd>
                                  </div>
                                )}
                                {[
                                  ['Importe al mes', dinero(f.s_importe)],
                                  ['Se factura', f.s_esquema],
                                  ['Días de crédito', f.s_dias_credito],
                                  ['Forma de pago', f.s_forma_pago],
                                  ['Contrato', f.s_contrato ? 'Sí' : 'No'],
                                  ['Pendiente de pago', dinero(f.s_pendiente)],
                                  ['Saldo vencido', dinero(f.s_vencido)],
                                  ['Alta', f.s_alta],
                                ]
                                  .filter(([, v]) => v !== null && v !== undefined && v !== '')
                                  .map(([etiqueta, v]) => (
                                    <div key={etiqueta} className="flex gap-2 text-xs">
                                      <dt className="text-slate-500 min-w-[110px]">{etiqueta}</dt>
                                      <dd className="text-slate-300">{v}</dd>
                                    </div>
                                  ))}
                                <Link
                                  href={`/estado-fuerza/${f.servicio_id}`}
                                  className="inline-block mt-2 text-xs text-cyan-400 hover:underline"
                                >
                                  Abrir el expediente completo →
                                </Link>
                              </dl>
                            ) : (
                              <p className="text-xs text-amber-400/80">
                                Este movimiento no está ligado a ningún servicio del estado de fuerza.
                              </p>
                            )}
                          </div>
                        </div>

                        {f.comentarios && (
                          <p className="text-xs text-slate-400 mt-4 bg-slate-900/60 rounded-lg p-2.5">
                            {f.comentarios}
                          </p>
                        )}
                        {!esApertura && f.motivo && (
                          <p className="text-xs text-slate-400 mt-4 bg-slate-900/60 rounded-lg p-2.5">
                            <strong className="text-slate-300">Motivo: </strong>
                            {f.motivo}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={columnas} className="px-4 py-10 text-center text-slate-500">
                  No hubo movimientos en este mes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
