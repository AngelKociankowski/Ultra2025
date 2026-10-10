'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CampoCatalogo from '@/components/CampoCatalogo';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

/** El control que le toca a un campo, que es el mismo al llenar y al corregir. */
function Control({ campo, valor, opciones, onChange, id }) {
  if (campo.tipo === 'catalogo') {
    return (
      <CampoCatalogo
        id={id}
        valor={valor ?? ''}
        opciones={opciones?.[campo.catalogo] || []}
        onChange={onChange}
        vacio="— sin capturar —"
        className={input}
      />
    );
  }
  return (
    <input
      id={id}
      type={campo.tipo === 'date' ? 'date' : ['money', 'number', 'int'].includes(campo.tipo) ? 'number' : 'text'}
      step={campo.tipo === 'int' ? '1' : ['money', 'number'].includes(campo.tipo) ? 'any' : undefined}
      value={valor ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={input}
    />
  );
}

/**
 * El panel que termina de capturar un alta, y corrige lo que se capturó hoy.
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
 *   · Arriba, los campos que están en blanco. No es un editor: un campo con
 *     valor ya no es un hueco, y cambiarlo es una edición con sus permisos de
 *     siempre, que viven en el bloque «Editar» de más abajo.
 *   · Abajo, y solo si existe, lo que ESTA persona capturó HOY. Es la única
 *     excepción, y vive aquí —en la misma ficha y pegada al hueco que se acaba
 *     de llenar— porque es donde se descubre el error de dedo: a quien acaba de
 *     teclear 95000 en vez de 9500 no se le puede pedir que adivine que existe
 *     un camino para arreglarlo. Mañana el bloque ya no está y el dato se cambia
 *     desde «Editar».
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
export default function Completar({ servicioId, falta, corregibles = [], opciones, puedeCompletar }) {
  const router = useRouter();
  const [valores, setValores] = useState({});
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  /**
   * Las correcciones nacen con lo que el campo dice hoy: se corrige un dato
   * escrito, así que el punto de partida es verlo, no volver a teclearlo entero.
   *
   * El estado guarda SOLO lo que se teclea, y lo que se dibuja sale del valor del
   * servidor mientras nadie haya tecleado. Antes el estado nacía ya lleno con un
   * inicializador de `useState`, que corre una sola vez al montar: después de
   * llenar un hueco, `router.refresh()` trae el campo recién capturado como
   * corregible y el control nacía VACÍO al lado de la etiqueta que dice «ahora
   * dice «95000»» —justo el caso para el que se hizo esto—. Derivarlo no se puede
   * desincronizar.
   */
  const [arreglos, setArreglos] = useState({});
  const [motivo, setMotivo] = useState('');
  const [estadoArreglo, setEstadoArreglo] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(false);

  const comoTexto = (v) => (v === null || v === undefined ? '' : String(v));
  const loQueDice = (c) => arreglos[c.campo] ?? comoTexto(c.valor);

  /**
   * Los campos cuya corrección pasa por el control de siempre: motivo escrito,
   * registro aparte y aviso al área dueña. Lo contesta el servidor
   * (`corregiblesHoy()`), que es donde vive la regla; aquí solo se dibuja.
   */
  const conMotivo = corregibles.filter((c) => c.exigeMotivo);
  const areasAvisadas = [...new Set(conMotivo.flatMap((c) => c.avisaA || []))];

  const campos = [...falta.operar, ...falta.cobrar];
  const resumen = [
    falta.operar.length > 0 && `Para operarlo: ${falta.operar.map((c) => c.etiqueta).join(', ')}`,
    falta.cobrar.length > 0 && `Para cobrarlo: ${falta.cobrar.map((c) => c.etiqueta).join(', ')}`,
  ].filter(Boolean);

  function fijar(campo, valor) {
    setValores((prev) => ({ ...prev, [campo]: valor }));
  }

  async function enviar(cuerpo) {
    const res = await fetch(`/api/servicios/${servicioId}/completar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    return { res, data: await res.json() };
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
      const { res, data } = await enviar(payload);
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

  async function corregir(e) {
    e.preventDefault();
    setEstadoArreglo(null);

    // Solo lo que de verdad cambió. Mandar un campo con el mismo valor no es una
    // corrección, y el servidor lo descarta: pedirlo igual dejaría a la pantalla
    // diciendo «1 dato corregido» cuando no se corrigió nada.
    const cambios = Object.fromEntries(
      corregibles
        .map((c) => [c.campo, loQueDice(c)])
        .filter(([campo, v]) => {
          const antes = corregibles.find((c) => c.campo === campo)?.valor;
          return v !== '' && v !== null && v !== undefined && String(v) !== String(antes ?? '');
        })
    );
    if (Object.keys(cambios).length === 0) {
      setEstadoArreglo({ tipo: 'info', mensaje: 'No cambiaste ningún dato.' });
      return;
    }

    // El motivo se pide solo cuando de verdad hace falta: cuando entre lo que se
    // cambió hay un campo con régimen propio. Para los demás no se pide nada,
    // igual que antes.
    const piden = conMotivo.filter((c) => Object.hasOwn(cambios, c.campo));
    if (piden.length > 0 && motivo.trim().length < 5) {
      setEstadoArreglo({
        tipo: 'error',
        mensaje:
          `Escribe el motivo: ${piden.map((c) => `«${c.etiqueta}»`).join(', ')} se corrige con explicación, ` +
          `queda en el registro de correcciones y se le avisa a ${areasAvisadas.join(' y ') || 'el área dueña'}.`,
      });
      return;
    }

    setCorrigiendo(true);
    try {
      const { res, data } = await enviar({
        correcciones: cambios,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      });
      if (!res.ok) {
        setEstadoArreglo({ tipo: 'error', mensaje: data.error || 'No se pudo corregir.' });
        return;
      }
      const hechos = Object.entries(data.corregidos || {});
      // Y lo que el servidor dice que NO guardó se dice también. Callarlo dejaba
      // la pantalla contestando «No cambió nada» a una petición que el servidor
      // había rechazado campo por campo: el fallo silencioso de siempre.
      const rechazados = data.rechazados?.length
        ? ` No se reconoc${data.rechazados.length === 1 ? 'ió' : 'ieron'}: ${data.rechazados.join(', ')}.`
        : '';
      setEstadoArreglo({
        tipo: hechos.length > 0 ? 'ok' : rechazados ? 'error' : 'info',
        mensaje:
          (hechos.length
            ? `${hechos.length} dato${hechos.length === 1 ? '' : 's'} corregido${
                hechos.length === 1 ? '' : 's'
              }, con tu nombre y la fecha: ${hechos
                .map(([, { antes, despues }]) => `«${antes}» → «${despues}»`)
                .join(', ')}.`
            : 'No cambió nada.') + rechazados,
      });
      setMotivo('');
      router.refresh();
    } catch {
      setEstadoArreglo({ tipo: 'error', mensaje: 'Error de red.' });
    } finally {
      setCorrigiendo(false);
    }
  }

  const aviso = (e) => (
    <p
      className={`text-sm rounded-lg px-3 py-2 border ${
        e.tipo === 'ok'
          ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
          : e.tipo === 'error'
            ? 'text-red-300 bg-red-500/10 border-red-500/30'
            : 'text-slate-300 bg-slate-700/30 border-slate-600/40'
      }`}
    >
      {e.mensaje}
    </p>
  );

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

  /**
   * El bloque de corrección, que solo existe si de verdad hay algo que corregir.
   *
   * No se dibuja vacío con el texto «aquí podrías corregir»: un bloque que
   * aparece siempre y casi nunca sirve se vuelve parte del fondo, y entonces el
   * día que sirve tampoco se ve. Si está, es porque hay al menos un dato que
   * esta persona capturó hoy.
   */
  const arregloPropio = puedeCompletar && corregibles.length > 0 && (
    <div className={`${campos.length > 0 ? 'mt-5 pt-5 border-t border-amber-500/20' : ''}`}>
      <h3 className="text-sm font-semibold text-amber-200">Corregir lo que capturaste hoy</h3>
      <p className="text-xs text-slate-500 max-w-3xl mt-0.5">
        {corregibles.length === 1 ? 'Este dato lo capturaste' : 'Estos datos los capturaste'} tú hoy, así que
        {corregibles.length === 1 ? ' lo' : ' los'} puedes corregir aquí mismo. La corrección queda registrada
        con tu nombre, la fecha y lo que decía antes; el llenado original no se borra. Mañana ya no:
        pasada la medianoche se cambia desde «Editar», con los permisos de siempre.
      </p>

      <form onSubmit={corregir} className="mt-3 space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {corregibles.map((c) => (
            <div key={c.campo}>
              <label htmlFor={`corregir-${c.campo}`} className="block text-xs text-slate-400 mb-1">
                {c.etiqueta} <span className="text-slate-600">· ahora dice «{String(c.valor)}»</span>
              </label>
              <Control
                id={`corregir-${c.campo}`}
                campo={c}
                valor={loQueDice(c)}
                opciones={opciones}
                onChange={(v) => setArreglos((prev) => ({ ...prev, [c.campo]: v }))}
              />
            </div>
          ))}
        </div>

        {/* El motivo, solo si entre lo corregible hay un campo que lo exige, y
            diciendo por qué se pide: es el nombre legal con el que se factura, y
            su corrección se registra aparte y se le avisa al área dueña, venga de
            jurídico o de quien lo acaba de teclear. Un campo corriente se sigue
            corrigiendo sin explicar nada. */}
        {conMotivo.length > 0 && (
          <div>
            <label htmlFor="corregir-motivo" className="block text-xs text-slate-400 mb-1">
              Motivo de la corrección
              <span className="text-slate-600">
                {' · '}
                {conMotivo.map((c) => c.etiqueta).join(', ')} queda en el registro de correcciones
                {areasAvisadas.length > 0 && ` y se le avisa a ${areasAvisadas.join(' y ')}`}
              </span>
            </label>
            <input
              id="corregir-motivo"
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Qué estaba mal capturado"
              className={input}
            />
          </div>
        )}

        {estadoArreglo && aviso(estadoArreglo)}

        <button
          type="submit"
          disabled={corrigiendo}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
        >
          {corrigiendo ? 'Corrigiendo…' : 'Guardar la corrección'}
        </button>
      </form>
    </div>
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
      {campos.length > 0 && cuerpo}

      {campos.length > 0 && (
        <form onSubmit={guardar} className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {campos.map((c) => (
              <div key={c.campo} className={c.tipo === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
                <label htmlFor={`completar-${c.campo}`} className="block text-xs text-slate-400 mb-1">
                  {c.etiqueta}
                </label>
                <Control
                  id={`completar-${c.campo}`}
                  campo={c}
                  valor={valores[c.campo]}
                  opciones={opciones}
                  onChange={(v) => fijar(c.campo, v)}
                />
              </div>
            ))}
          </div>

          {estado && aviso(estado)}

          <button
            type="submit"
            disabled={guardando}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
          >
            {guardando ? 'Guardando…' : 'Guardar lo que capturé'}
          </button>
        </form>
      )}

      {arregloPropio}
    </section>
  );
}
