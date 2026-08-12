'use client';

import { useState } from 'react';
import Link from 'next/link';
import NombreServicio from '@/components/NombreServicio';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';
import FormFactura from './FormFactura';
import Icono from '@/components/Icono';

/**
 * Lo que falta facturar del mes, servicio por servicio.
 *
 * Cada factura se emite por separado y revisada: la plataforma propone la fecha
 * y el importe que le tocarían según cómo se le cobra a ese cliente, pero quien
 * factura confirma o corrige antes de guardar. El importe del mes casi nunca es
 * el del mes pasado —guardias que subieron, extras, servicios que arrancaron a
 * media quincena— y emitir en bloque daría por bueno el mismo número para
 * todos.
 *
 * Debajo va la otra mitad: los que ya tienen su factura. Están a la vista y no
 * escondidos porque tener una factura no quiere decir estar cobrado completo —a
 * varios clientes se les factura por sede y reciben dos, tres o cuatro papeles
 * del mismo mes—, y hasta ahora el servicio desaparecía de la pantalla con la
 * primera, sin dejar por dónde registrar las demás.
 */
export default function PorFacturar({ periodo, porFacturar, sinCondiciones, facturados, yaFacturados }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState(null);

  const clave = (f) => `${f.servicio_id}·${f.concepto}`;

  // Buscar sin acentos y sin importar mayúsculas: nadie escribe «BAJÍO» con
  // acento cuando está buscando a las prisas.
  const plano = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const termino = plano(busqueda.trim());
  const coincide = (f) =>
    !termino || [f.servicio, f.razon_social, f.zona, f.asesor].some((c) => plano(c).includes(termino));

  const visibles = porFacturar.filter(coincide);
  // Los ya facturados solo salen cuando se busca uno. Al día 1 del mes son
  // doscientos renglones que no hay que tocar, y ponerlos siempre convertiría
  // la pantalla de «lo que falta» en una lista de todo.
  const yaVisibles = termino ? yaFacturados.filter(coincide) : [];

  function terminar(r) {
    setMensaje({ tipo: r.tipo, texto: r.texto });
    if (r.exito) {
      setAbierta(null);
      router.refresh();
    }
  }

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">Por facturar — {periodo}</h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            Cada factura se registra por separado. La fecha y el importe vienen propuestos según cómo se le cobra a
            ese cliente; revísalos antes de guardar. Si a un cliente le mandas varias facturas del mismo mes,
            búscalo por nombre y agrégaselas una por una.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cliente, zona o asesor…"
              aria-label="Buscar el servicio que quieres facturar"
              className="w-60 bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <Icono
              nombre="buscar"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
            />
          </div>
          <p className="text-xs text-slate-500">
            {termino ? (
              <>
                {visibles.length} de {porFacturar.length} pendientes
                {yaVisibles.length > 0 && ` · ${yaVisibles.length} ya con factura`}
              </>
            ) : (
              <>
                {porFacturar.length} pendiente{porFacturar.length === 1 ? '' : 's'} · {facturados} ya facturado
                {facturados === 1 ? '' : 's'}
              </>
            )}
          </p>
        </div>
      </div>

      {mensaje && (
        <p
          className={`mx-5 mt-3 text-sm rounded-lg px-3 py-2 border ${
            mensaje.tipo === 'ok'
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              : 'text-red-300 bg-red-500/10 border-red-500/30'
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      {/* El botón de cada renglón va discreto y el de guardar, dentro del
          formulario, va lleno. Doscientos diecisiete botones verdes en columna
          no son doscientos diecisiete llamados a la acción: son una pared, y
          entre ellos se pierde el único botón que de verdad confirma algo. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-slate-900/60">
            <tr className="text-slate-400 text-xs">
              <th className="text-left px-4 py-3">Servicio</th>
              <th className="text-left px-3 py-3">Concepto</th>
              <th className="text-left px-3 py-3">Se factura</th>
              <th className="text-left px-3 py-3">Vencería</th>
              <th className="text-right px-3 py-3">Importe propuesto</th>
              <th className="text-right px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={clave(f)} className="border-t border-slate-800/70 align-top">
                <td className="px-4 py-2">
                  <NombreServicio id={f.servicio_id} servicio={f.servicio} razonSocial={f.razon_social} />
                  <span className="block text-[11px] text-slate-500">
                    {[f.zona, f.asesor].filter(Boolean).join(' · ') || '—'}
                  </span>

                  {abierta === clave(f) && (
                    <FormFactura
                      servicioId={f.servicio_id}
                      periodo={periodo}
                      plantilla={f.plantilla}
                      inicial={{
                        // Sin condiciones capturadas no hay fecha que proponer:
                        // el formulario ofrece la de hoy, que es un punto de
                        // partida y no una suposición sobre el negocio.
                        fecha: f.fecha,
                        importe: f.importe,
                        // Se propone la plantilla del servicio. Es lo que está
                        // en la calle: si se factura otra cosa, que sea porque
                        // alguien la cambió a propósito y no porque el campo
                        // llegó vacío.
                        guardias: f.plantilla,
                        concepto: f.concepto,
                      }}
                      onListo={terminar}
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400">{f.concepto}</td>
                <td className="px-3 py-2 text-slate-400">
                  {f.fecha || <span className="text-amber-300/80 text-xs">la capturas tú</span>}
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {f.fecha_vencimiento || <span className="text-slate-600">—</span>}
                  <span className="block text-[11px] text-slate-500">
                    {f.dias_credito ? `${f.dias_credito} días de crédito` : 'sin crédito'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-slate-300">
                  {f.importe ? (
                    formatCurrency(f.importe)
                  ) : (
                    <span className="text-amber-300/90 text-xs">falta capturarlo</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      setMensaje(null);
                      setAbierta(abierta === clave(f) ? null : clave(f));
                    }}
                    className="text-xs border border-slate-600 text-slate-200 hover:bg-slate-700/60 hover:border-slate-500 rounded-lg px-3 py-1.5"
                  >
                    {abierta === clave(f) ? 'Cerrar' : <><Icono nombre="factura" className="mr-1.5 -mt-0.5" />Facturar</>}
                  </button>
                </td>
              </tr>
            ))}

            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {termino
                    ? yaVisibles.length > 0
                      ? `«${busqueda.trim()}» ya tiene su factura de ${periodo}. Está abajo, por si le falta alguna.`
                      : `Ningún pendiente de ${periodo} coincide con «${busqueda.trim()}».`
                    : `Ya se facturó todo lo que tocaba de ${periodo}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {yaVisibles.length > 0 && (
        <div className="border-t border-slate-700/50">
          <div className="px-5 py-3 bg-slate-900/30">
            <h3 className="text-sm font-semibold text-white">Ya tienen factura de {periodo}</h3>
            <p className="text-xs text-slate-500 max-w-2xl">
              Tener una factura no quiere decir estar cobrado completo. Aquí ves cuánto llevas registrado contra el
              importe del servicio, y puedes agregarle las que falten.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-slate-900/60">
                <tr className="text-slate-400 text-xs">
                  <th className="text-left px-4 py-3">Servicio</th>
                  <th className="text-left px-3 py-3">Facturas registradas</th>
                  <th className="text-right px-3 py-3">Llevas</th>
                  <th className="text-right px-3 py-3">Del servicio</th>
                  <th className="text-right px-4 py-3">Acción</th>
                </tr>
              </thead>
              <tbody>
                {yaVisibles.map((f) => {
                  const id = `otra·${f.servicio_id}`;
                  const falta = f.faltaImporte;
                  return (
                    <tr key={id} className="border-t border-slate-800/70 align-top">
                      <td className="px-4 py-2">
                        <NombreServicio id={f.servicio_id} servicio={f.servicio} razonSocial={f.razon_social} />
                        <span className="block text-[11px] text-slate-500">
                          {[f.zona, f.asesor].filter(Boolean).join(' · ') || '—'}
                        </span>
                        {abierta === id && (
                          <FormFactura
                            servicioId={f.servicio_id}
                            periodo={periodo}
                            plantilla={f.plantilla}
                            conConcepto
                            inicial={{
                              // Se propone lo que falta para llegar al importe
                              // del servicio, que es la cifra que cobranza está
                              // sacando con la calculadora.
                              importe: falta > 0 ? falta : '',
                              restante: falta > 0 ? falta : 0,
                              guardias:
                                f.sumaGuardias !== null && f.plantilla > f.sumaGuardias
                                  ? f.plantilla - f.sumaGuardias
                                  : '',
                              concepto: `Factura ${f.facturas.length + 1}`,
                            }}
                            onListo={terminar}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {f.facturas.map((x, i) => (
                          <span key={i} className="block text-[11px]">
                            {x.concepto} · {formatCurrency(x.importe)}
                            {x.guardias !== null && ` · ${x.guardias} guardias`}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300 tabular-nums whitespace-nowrap">
                        {formatCurrency(f.sumaImporte)}
                        <span className="block text-[11px] text-slate-500">
                          {f.facturas.length} factura{f.facturas.length === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {f.contratado > 0 ? (
                          <>
                            <span className="text-slate-400">{formatCurrency(f.contratado)}</span>
                            <span
                              className={`block text-[11px] ${
                                falta > 1 ? 'text-amber-300/80' : falta < -1 ? 'text-amber-300/80' : 'text-emerald-400/80'
                              }`}
                            >
                              {falta > 1
                                ? `faltan ${formatCurrency(falta)}`
                                : falta < -1
                                  ? `${formatCurrency(-falta)} de más`
                                  : 'cuadra'}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-600 text-xs">sin importe en la ficha</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => {
                            setMensaje(null);
                            setAbierta(abierta === id ? null : id);
                          }}
                          className="text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5"
                        >
                          {abierta === id ? 'Cerrar' : <><Icono nombre="alta" className="mr-1.5 -mt-0.5" />Otra factura</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sinCondiciones.length > 0 && (
        <p className="px-5 py-3 border-t border-slate-700/50 text-xs text-slate-500 max-w-3xl">
          <span className="text-amber-300/90">
            {sinCondiciones.length} de estos servicios no tienen capturado cuándo se les factura.
          </span>{' '}
          Se pueden facturar igual —la fecha la escribes tú al registrarlos—, pero si dejas sus condiciones guardadas
          la plataforma te propone fecha e importe cada mes y puede decirte qué te falta.{' '}
          <Link href="/cobranza/inicio" className="text-cyan-400 hover:underline">
            Capturarlas de una vez
          </Link>
          .
        </p>
      )}
    </section>
  );
}
