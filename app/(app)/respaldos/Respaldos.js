'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function enPalabras(fecha) {
  const [a, m, d] = String(fecha || '').split('-');
  if (!a || !m || !d) return fecha || '—';
  return `${Number(d)} de ${MESES[Number(m)]} de ${a}`;
}

function haceCuanto(dias) {
  if (dias === null || dias === undefined) return 'nunca';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

export default function Respaldos({ inicial, estadoInicial }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState('');
  const [abrirRestaurar, setAbrirRestaurar] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [confirmacion, setConfirmacion] = useState('');

  const lista = inicial;
  const e = estadoInicial;

  async function hacerRespaldo() {
    setOcupado('crear');
    setError('');
    setAviso(null);
    try {
      const r = await fetch('/api/respaldos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: 'manual' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo hacer el respaldo.');
      setAviso(
        `Respaldo hecho: ${data.nombre} (${MB(data.bytes)}), con la base y los PDF de las facturas. ` +
          'Bájalo y guárdalo fuera del servidor: ese es el que de verdad te cubre.'
      );
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setOcupado('');
    }
  }

  async function borrar(nombre) {
    if (!confirm(`¿Borrar ${nombre}?\n\nSe quita del servidor. Si ya lo tienes bajado, esa copia no se toca.`)) return;
    setOcupado(nombre);
    setError('');
    try {
      const r = await fetch(`/api/respaldos?nombre=${encodeURIComponent(nombre)}`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo borrar.');
      router.refresh();
    } finally {
      setOcupado('');
    }
  }

  async function restaurar(ev) {
    ev.preventDefault();
    if (!archivo) return setError('Escoge el archivo .zip del respaldo.');
    const seguro = confirm(
      'Restaurar reemplaza TODA la base con la del respaldo.\n\n' +
        'Todo lo capturado después de ese respaldo se pierde. Antes de tocar nada, la plataforma guarda un respaldo ' +
        'de cómo está ahorita, por si esto fue un error.\n\n¿Seguimos?'
    );
    if (!seguro) return;

    setOcupado('restaurar');
    setError('');
    setAviso(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', archivo);
      cuerpo.append('confirmacion', confirmacion);
      const r = await fetch('/api/respaldos', { method: 'POST', body: cuerpo });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo restaurar.');
      const c = data.conteos || {};
      setAviso(
        `Restaurado el respaldo del ${enPalabras(data.restaurado?.fecha)}. ` +
          `La plataforma quedó con ${c.servicios} servicios activos, ${c.guardias} guardias y ${c.facturas} facturas. ` +
          (data.traiaArchivos
            ? `Se repusieron ${data.repuestos} archivos de facturas. `
            : 'Ese respaldo era solo de la base: los PDF que ya estaban en el servidor siguen ahí, sin tocar. ') +
          `Lo anterior quedó guardado en ${data.respaldoPrevio}.`
      );
      setAbrirRestaurar(false);
      setArchivo(null);
      setConfirmacion('');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setOcupado('');
    }
  }

  return (
    <div className="space-y-4">
      {/* Estado ---------------------------------------------------------- */}
      <section
        className={`rounded-2xl border p-5 ${
          e.alDia ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={`text-sm font-semibold ${e.alDia ? 'text-emerald-300' : 'text-amber-300'}`}>
              {e.ultimo
                ? `Último respaldo ${haceCuanto(e.dias)} · ${enPalabras(e.ultimo.fecha)} a las ${e.ultimo.hora}`
                : 'Todavía no hay ningún respaldo'}
            </p>
            <p className={`text-xs mt-0.5 ${e.alDia ? 'text-emerald-400' : 'text-amber-400'}`}>
              {e.ultimo
                ? `${e.total} guardados en el servidor · ${MB(e.bytes)} en total`
                : 'Haz el primero ahora mismo y bájatelo: hasta que exista, no hay a dónde volver.'}
              {e.ultimo && !e.alDia && ' · El respaldo automático se está atrasando, revisa que el servidor esté arriba.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={hacerRespaldo}
              disabled={!!ocupado}
              className="text-sm bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco rounded-lg px-3 py-2 disabled:opacity-50 whitespace-nowrap"
            >
              {ocupado === 'crear' ? 'Haciendo…' : '💾 Hacer un respaldo ahora'}
            </button>
            {(e.ultimoCompleto || e.ultimo) && (
              <a
                href={`/api/respaldos/${(e.ultimoCompleto || e.ultimo).nombre}`}
                className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
              >
                ⬇ Bajar el último completo
              </a>
            )}
          </div>
        </div>
      </section>

      {aviso && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
          {aviso}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Lista ----------------------------------------------------------- */}
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-white">Respaldos guardados</h2>
          <p className="text-xs text-slate-500">Del más reciente al más viejo.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-slate-900/60">
              <tr className="text-slate-400 text-xs">
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-3 py-3">Hora</th>
                <th className="text-left px-3 py-3">Origen</th>
                <th className="text-left px-3 py-3">Contenido</th>
                <th className="text-right px-3 py-3">Tamaño</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.nombre} className="border-t border-slate-800/70">
                  <td className="px-4 py-2 text-slate-200">{enPalabras(r.fecha)}</td>
                  <td className="px-3 py-2 text-slate-400">{r.hora}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        r.motivo === 'antes-de-restaurar'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {r.motivoTexto}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        r.completo ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/60 text-slate-400'
                      }`}
                    >
                      {r.alcanceTexto}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">{MB(r.bytes)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <a href={`/api/respaldos/${r.nombre}`} className="text-cyan-400 hover:underline text-xs">
                      Bajar
                    </a>
                    <button
                      type="button"
                      onClick={() => borrar(r.nombre)}
                      disabled={!!ocupado}
                      className="ml-3 text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Todavía no hay respaldos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Restaurar ------------------------------------------------------- */}
      <section className="bg-slate-800/30 border border-red-500/30 rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Restaurar un respaldo</h2>
            <p className="text-xs text-slate-400 max-w-2xl mt-0.5">
              Deja la plataforma tal como estaba el día de ese respaldo. Todo lo que se haya capturado después se
              pierde. Antes de tocar nada se guarda un respaldo de cómo está ahorita, así que hay vuelta atrás.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAbrirRestaurar((v) => !v)}
            className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
          >
            {abrirRestaurar ? 'Cancelar' : 'Restaurar…'}
          </button>
        </div>

        {abrirRestaurar && (
          <form onSubmit={restaurar} className="mt-4 space-y-3 border-t border-slate-700/50 pt-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">El archivo .zip del respaldo</label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(ev) => setArchivo(ev.target.files?.[0] || null)}
                className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Escribe <strong className="text-red-300">RESTAURAR</strong> para confirmar
              </label>
              <input
                type="text"
                value={confirmacion}
                onChange={(ev) => setConfirmacion(ev.target.value)}
                placeholder="RESTAURAR"
                className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white w-56"
              />
            </div>
            <button
              type="submit"
              disabled={ocupado === 'restaurar'}
              className="text-sm bg-red-600 hover:bg-red-500 text-ultra-blanco rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {ocupado === 'restaurar' ? 'Restaurando…' : 'Restaurar esta base'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
