'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500';

export default function GestionCatalogos({ datos, tipos }) {
  const router = useRouter();
  const claves = Object.keys(tipos);
  const [tipoActivo, setTipoActivo] = useState(claves[0]);
  const [nuevo, setNuevo] = useState('');
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cfg = tipos[tipoActivo];
  const { opciones, huerfanos } = datos[tipoActivo];

  async function llamar(metodo, cuerpo, ruta = '/api/catalogos') {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(ruta, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo completar la operación.' });
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de red.' });
      return null;
    } finally {
      setOcupado(false);
    }
  }

  function cambiarTipo(t) {
    setTipoActivo(t);
    setNuevo('');
    setMensaje(null);
  }

  async function agregar(e, valor) {
    e?.preventDefault();
    const v = (valor ?? nuevo).trim();
    if (!v) return;
    const data = await llamar('POST', { tipo: tipoActivo, valor: v });
    if (data) {
      setMensaje({ tipo: 'ok', texto: `«${data.valor}» ya se puede elegir al capturar.` });
      setNuevo('');
    }
  }

  async function renombrar(fila) {
    const valor = window.prompt(
      `Nuevo nombre para «${fila.valor}».\n\nSe corrige también en los ${fila.usos} servicio(s) que lo traen y en sus movimientos.`,
      fila.valor
    );
    if (valor === null) return;
    const data = await llamar('PATCH', { id: fila.id, valor });
    if (data && !data.sinCambios) {
      setMensaje({
        tipo: 'ok',
        texto: `«${data.antes}» ahora es «${data.valor}»: se actualizaron ${data.servicios} servicio(s) y ${data.movimientos} movimiento(s).`,
      });
    }
  }

  /**
   * Unir dos opciones que siempre fueron la misma.
   *
   * Es lo que faltaba y se nota en los datos: «JUAN JAIR TREJO» con 1 servicio
   * y «JUAN JAIR TREJO TREJO» con 26 son el mismo supervisor, escrito una vez
   * sin el apellido materno. Renombrar no servía —el destino ya existe— y el
   * mensaje mandaba a mover los servicios uno por uno.
   */
  async function fusionar(fila) {
    const candidatos = opciones.filter((o) => o.id !== fila.id);
    if (!candidatos.length) {
      setMensaje({ tipo: 'error', texto: 'No hay otra opción con la que unirlo.' });
      return;
    }
    const lista = candidatos.map((o, i) => `${i + 1}. ${o.valor} (${o.usos})`).join('\n');
    const eleccion = window.prompt(
      `Unir «${fila.valor}» (${fila.usos} servicio(s)) con otra opción.\n\n` +
        `Sus servicios y movimientos pasan a llamarse como la que elijas, y «${fila.valor}» se borra del catálogo. ` +
        `Los cortes cerrados no se tocan.\n\nEscribe el número:\n\n${lista}`
    );
    if (eleccion === null) return;
    const destino = candidatos[Number(eleccion) - 1];
    if (!destino) {
      setMensaje({ tipo: 'error', texto: 'Ese número no está en la lista.' });
      return;
    }
    if (!window.confirm(`¿Unir «${fila.valor}» dentro de «${destino.valor}»?`)) return;

    const data = await llamar('PATCH', { id: fila.id, fusionarCon: destino.id });
    if (data) {
      setMensaje({
        tipo: 'ok',
        texto: `«${data.origen}» se unió a «${data.destino}»: se actualizaron ${data.servicios} servicio(s) y ${data.movimientos} movimiento(s).`,
      });
    }
  }

  async function alternar(fila) {
    const data = await llamar('PATCH', { id: fila.id, activo: !fila.activo });
    if (data) {
      setMensaje({
        tipo: 'ok',
        texto: fila.activo
          ? `«${fila.valor}» dejó de ofrecerse al capturar. Los servicios que lo traen no cambiaron.`
          : `«${fila.valor}» vuelve a estar disponible.`,
      });
    }
  }

  /** Convertir un huérfano en opción, sin volver a escribirlo a mano. */
  async function adoptar(valor) {
    const data = await llamar('PUT', { tipo: tipoActivo, valor });
    if (data) setMensaje({ tipo: 'ok', texto: `«${data.valor}» ya es una opción del catálogo.` });
  }

  async function borrar(fila) {
    if (!window.confirm(`¿Borrar «${fila.valor}» del catálogo?`)) return;
    const data = await llamar('DELETE', null, `/api/catalogos?id=${fila.id}`);
    if (data) setMensaje({ tipo: 'ok', texto: `«${fila.valor}» se quitó del catálogo.` });
  }

  const activas = opciones.filter((o) => o.activo).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {claves.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => cambiarTipo(t)}
            className={`text-sm px-3 py-1.5 rounded-lg ${
              t === tipoActivo ? 'bg-violet-600 text-ultra-blanco' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {tipos[t].etiqueta}
            <span className="text-xs opacity-70 ml-1.5">{datos[t].opciones.filter((o) => o.activo).length}</span>
          </button>
        ))}
      </div>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white">Agregar {cfg.singular.toLowerCase()}</h2>
        <p className="text-xs text-slate-500 mb-3">{cfg.ayuda}</p>
        <form onSubmit={agregar} className="flex flex-wrap gap-2 items-end">
          <div className="w-full sm:w-72">
            <input
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              placeholder={`Ej.: ${cfg.ejemplo}`}
              className={input}
            />
          </div>
          <button
            type="submit"
            disabled={ocupado || !nuevo.trim()}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-ultra-blanco text-sm rounded-lg px-4 py-2"
          >
            Agregar
          </button>
        </form>

        {mensaje && (
          <p
            className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
              mensaje.tipo === 'ok'
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                : 'text-red-300 bg-red-500/10 border-red-500/30'
            }`}
          >
            {mensaje.texto}
          </p>
        )}
      </section>

      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-white">{cfg.etiqueta}</h2>
          <p className="text-xs text-slate-500">
            {activas} disponible{activas === 1 ? '' : 's'} al capturar
            {opciones.length - activas > 0 && ` · ${opciones.length - activas} desactivada(s)`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">{cfg.singular}</th>
                <th className="text-center px-3 py-3">Servicios que {cfg.lo} usan</th>
                <th className="text-center px-3 py-3">Estado</th>
                <th className="text-right px-3 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {opciones.map((o) => (
                <tr key={o.id} className="border-t border-slate-800/70">
                  <td className={`px-4 py-2 ${o.activo ? 'text-white' : 'text-slate-500'}`}>{o.valor}</td>
                  <td className="px-3 py-2 text-center text-slate-400">{o.usos || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        o.activo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-slate-400'
                      }`}
                    >
                      {o.activo ? 'Disponible' : 'Desactivada'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => renombrar(o)}
                      disabled={ocupado}
                      className="text-xs text-cyan-400 hover:underline disabled:opacity-40"
                    >
                      Renombrar
                    </button>
                    <button
                      onClick={() => fusionar(o)}
                      disabled={ocupado || opciones.length < 2}
                      title="Unir con otra opción que sea la misma escrita distinto"
                      className="text-xs text-amber-400 hover:underline disabled:opacity-40"
                    >
                      Fusionar
                    </button>
                    <button
                      onClick={() => alternar(o)}
                      disabled={ocupado}
                      className="text-xs text-slate-400 hover:underline disabled:opacity-40"
                    >
                      {o.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => borrar(o)}
                      disabled={ocupado || o.usos > 0}
                      title={o.usos > 0 ? `Hay servicios que ${cfg.lo} traen capturad${cfg.lo === 'la' ? 'a' : 'o'}: desactíva${cfg.lo}.` : ''}
                      className="text-xs text-red-400 hover:underline disabled:opacity-30"
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {opciones.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    Todavía no hay {cfg.plural} en el catálogo, así que ese campo no se puede capturar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {huerfanos.length > 0 && (
        <section className="bg-slate-800/30 border border-amber-600/30 rounded-2xl p-5">
          <h2 className="text-base font-semibold text-white">Capturadas fuera del catálogo</h2>
          <p className="text-xs text-slate-500 mb-3 max-w-2xl">
            Estos valores están en servicios del estado de fuerza pero no existen como opción, casi siempre porque se
            escribieron a mano antes de que hubiera catálogo. Agrégalos si son buenos; si son una falta de captura, lo
            que corresponde es corregir el servicio.
          </p>
          <div className="flex flex-wrap gap-2">
            {huerfanos.map((h) => (
              <button
                key={h.valor}
                type="button"
                onClick={() => adoptar(h.valor)}
                disabled={ocupado}
                className="text-xs bg-slate-900/70 hover:bg-slate-700 text-slate-300 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
              >
                {h.valor} <span className="text-slate-500">({h.usos}) ＋</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
