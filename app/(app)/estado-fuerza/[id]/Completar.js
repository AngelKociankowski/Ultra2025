'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CampoCatalogo from '@/components/CampoCatalogo';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

/**
 * El panel que termina de capturar un alta.
 *
 * Es la otra mitad de haber partido el alta en dos. Si el formulario deja abrir
 * un servicio con cinco datos y después no hay por dónde volver a entrar,
 * «completar cuando lo tengas» no es una invitación: es una forma elegante de
 * perder el dato. Antes de esto los campos operativos —dirección, precio,
 * uniforme, estado— eran del grupo `operativo` del RBAC, que es solo del
 * administrador, así que quien abría el servicio no podía terminarlo.
 *
 * Lo que este panel hace y lo que deliberadamente no hace:
 *
 *   · Solo enseña los campos que están en blanco. No es un editor: un campo con
 *     valor ya no es un hueco, y cambiarlo es una edición con sus permisos de
 *     siempre, que viven en el bloque «Editar» de más abajo.
 *   · No borra. Guardar en blanco no hace nada; el servidor ignora lo vacío.
 *   · Quien no registra aperturas ve la lista y no los campos. Saber qué le
 *     falta a un servicio le sirve a cualquiera que lo consulte —es la
 *     explicación de por qué cobranza no puede facturarlo—; llenarlo es de
 *     quien lo abrió.
 *
 * Está agrupado en «para operarlo» y «para cobrarlo» porque las dos listas las
 * atienden personas distintas en momentos distintos: la primera, operaciones
 * antes del primer turno; la segunda, ventas o cobranza antes de la primera
 * factura. Doce campos revueltos no le dicen a nadie qué le toca a él.
 */
export default function Completar({ servicioId, falta, opciones, puedeCompletar }) {
  const router = useRouter();
  const [valores, setValores] = useState({});
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const campos = [...falta.operar, ...falta.cobrar];
  const resumen = [
    falta.operar.length > 0 && `Para operarlo: ${falta.operar.map((c) => c.etiqueta).join(', ')}`,
    falta.cobrar.length > 0 && `Para cobrarlo: ${falta.cobrar.map((c) => c.etiqueta).join(', ')}`,
  ].filter(Boolean);

  function fijar(campo, valor) {
    setValores((prev) => ({ ...prev, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    setEstado(null);

    // Solo lo que se escribió. Mandar los doce campos con once vacíos obligaría
    // al servidor a distinguir «no lo tengo» de «bórralo», y aquí no se borra.
    const payload = Object.fromEntries(
      Object.entries(valores).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    );
    if (Object.keys(payload).length === 0) {
      setEstado({ tipo: 'info', mensaje: 'No escribiste nada todavía.' });
      return;
    }

    setGuardando(true);
    try {
      const res = await fetch(`/api/servicios/${servicioId}/completar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setEstado({ tipo: 'error', mensaje: data.error || 'No se pudo guardar.' });
        return;
      }
      const n = Object.keys(data.llenados || {}).length;
      const yaTenian = data.yaTenian?.length
        ? ` ${data.yaTenian.length} ya tenía${data.yaTenian.length === 1 ? '' : 'n'} valor y no se tocó${
            data.yaTenian.length === 1 ? '' : 'aron'
          }: eso se cambia desde «Editar».`
        : '';
      setEstado({
        tipo: n > 0 ? 'ok' : 'info',
        mensaje: `${n} dato${n === 1 ? '' : 's'} capturado${n === 1 ? '' : 's'}.${yaTenian}`,
      });
      setValores({});
      router.refresh();
    } catch {
      setEstado({ tipo: 'error', mensaje: 'Error de red.' });
    } finally {
      setGuardando(false);
    }
  }

  const cuerpo = (
    <>
      {/* En ámbar tenue y sin caja de alarma, a propósito. A los 217 servicios
          de la carga inicial les falta algo —el REPSE está vacío en los 217—,
          así que esto en rojo sería una pantalla roja, y una pantalla roja
          permanente es lo que enseña a no mirar los avisos. */}
      <h2 className="text-base font-semibold text-amber-300">Falta por capturar</h2>
      <p className="text-xs text-amber-400/80 max-w-3xl mt-0.5">
        {resumen.join(' · ')}
      </p>
      <p className="text-xs text-slate-500 max-w-3xl mt-1.5">
        {puedeCompletar
          ? 'Se llena un hueco; no se cambia nada de lo que ya está escrito. Cada dato queda registrado con tu nombre y la fecha.'
          : 'Los capturan ventas, operaciones o el administrador desde esta misma ficha.'}
      </p>
    </>
  );

  if (!puedeCompletar) {
    return (
      <section
        id="completar"
        className="scroll-mt-20 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5"
      >
        {cuerpo}
      </section>
    );
  }

  return (
    <section id="completar" className="scroll-mt-20 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      {cuerpo}

      <form onSubmit={guardar} className="mt-4 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {campos.map((c) => (
            <div key={c.campo} className={c.tipo === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
              <label htmlFor={`completar-${c.campo}`} className="block text-xs text-slate-400 mb-1">
                {c.etiqueta}
              </label>
              {c.tipo === 'catalogo' ? (
                <CampoCatalogo
                  id={`completar-${c.campo}`}
                  valor={valores[c.campo] ?? ''}
                  opciones={opciones?.[c.catalogo] || []}
                  onChange={(v) => fijar(c.campo, v)}
                  vacio="— sin capturar —"
                  className={input}
                />
              ) : (
                <input
                  id={`completar-${c.campo}`}
                  type={c.tipo === 'date' ? 'date' : ['money', 'number', 'int'].includes(c.tipo) ? 'number' : 'text'}
                  step={c.tipo === 'int' ? '1' : ['money', 'number'].includes(c.tipo) ? 'any' : undefined}
                  value={valores[c.campo] ?? ''}
                  onChange={(e) => fijar(c.campo, e.target.value)}
                  className={input}
                />
              )}
            </div>
          ))}
        </div>

        {estado && (
          <p
            className={`text-sm rounded-lg px-3 py-2 border ${
              estado.tipo === 'ok'
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                : estado.tipo === 'error'
                  ? 'text-red-300 bg-red-500/10 border-red-500/30'
                  : 'text-slate-300 bg-slate-700/30 border-slate-600/40'
            }`}
          >
            {estado.mensaje}
          </p>
        )}

        <button
          type="submit"
          disabled={guardando}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
        >
          {guardando ? 'Guardando…' : 'Guardar lo que capturé'}
        </button>
      </form>
    </section>
  );
}
