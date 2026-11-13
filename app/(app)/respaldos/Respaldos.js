'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icono from '@/components/Icono';

const MB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * El disco, pintado: cuánto hay, cuánto queda y qué lo ocupa.
 *
 * Existe porque durante semanas la única señal de que el disco se estaba
 * llenando fue que algo dejó de funcionar. Los cuatro renglones suman lo
 * ocupado a propósito —«lo demás» es lo que no es ni base ni adjuntos ni
 * respaldos—: una cuenta que no cuadra no se le cree a nadie.
 *
 * La barra no lleva colores de alarma. Que el disco esté al 60 % no es un
 * problema; el problema es que no quepa lo siguiente, y eso se dice con
 * palabras en los avisos de arriba, no con un rojo que estaría siempre.
 */
function Disco({ disco, proximo, completosQueSeQuieren }) {
  if (!disco) {
    return (
      <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-white">El disco del servidor</h2>
        <p className="text-sm text-slate-400 mt-1">
          Este servidor no deja medir su disco, así que aquí no se puede enseñar cuánto queda. Los respaldos se siguen
          haciendo; lo que no se puede es avisar antes de que se llene.
        </p>
      </section>
    );
  }

  // Tres colores para las tres cosas que la plataforma pone en el disco, y gris
  // para lo que no es suyo. Ninguno es verde, ámbar ni rojo: en esta plataforma
  // esos tres ya significan «bien», «ojo» y «mal», y aquí solo se está diciendo
  // qué es cada pedazo. Los tres se comprobaron distinguibles entre sí sobre el
  // fondo oscuro también para quien no distingue rojo de verde; y aun así cada
  // uno lleva su nombre y su cifra debajo, que es lo que de verdad se lee.
  const partes = [
    ['Adjuntos (contratos y facturas)', disco.adjuntos, '#3987e5', `${disco.cuantosAdjuntos} archivos`],
    ['Respaldos', disco.respaldos, '#d95926', null],
    ['La base', disco.base, '#199e70', null],
    ['Lo demás', disco.otros, '#64748b', 'lo que ocupa el disco y no es de la plataforma'],
  ];
  const pct = (b) => `${Math.max(0, Math.min(100, (b / disco.total) * 100))}%`;
  const c = proximo?.completo;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-white">El disco del servidor</h2>
        <p className="text-sm text-slate-300">
          Quedan <strong className="text-white">{MB(disco.libre)}</strong> libres de {MB(disco.total)}
        </p>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">
        La base, los adjuntos y los respaldos viven en el mismo disco. Si se llena, deja de funcionar todo lo que
        guarda algo.
      </p>

      {/* Lo que queda sin pintar a la derecha es lo libre. */}
      <div className="flex gap-0.5 h-3 rounded-full overflow-hidden bg-slate-900/70 mt-4" aria-hidden="true">
        {partes.map(([nombre, bytes, color]) => (
          <div key={nombre} title={`${nombre}: ${MB(bytes)}`} style={{ width: pct(bytes), backgroundColor: color }} />
        ))}
      </div>
      <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
        {partes.map(([nombre, bytes, color, nota]) => (
          <li key={nombre} className="flex items-baseline justify-between gap-3">
            <span className="text-slate-300">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm mr-2"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              {nombre}
              {nota && <span className="text-slate-500 text-xs"> · {nota}</span>}
            </span>
            <span className="text-slate-400 tabular-nums">{MB(bytes)}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-slate-400 mt-4">
        {disco.reserva > 0 && (
          <>
            De lo libre, {MB(disco.reserva)} se reservan para que la base pueda seguir guardando: ni una subida ni un
            respaldo se los comen.{' '}
          </>
        )}
        {c &&
          (c.cabe
            ? c.cede
              ? `El próximo respaldo completo pesará unos ${MB(c.pesa)}: cabe, pero borrando antes uno de los completos anteriores. El disco ya no da para conservar ${completosQueSeQuieren}.`
              : `El próximo respaldo completo pesará unos ${MB(c.pesa)} y cabe.`
            : `El próximo respaldo completo pesaría unos ${MB(c.pesa)} y ya no cabe.`)}
      </p>

      {/* El arreglo va aquí mismo: una pantalla que dice «no cabe» y no dice
          qué hacer deja a la persona donde estaba. Solo cuando hace falta. */}
      {c && (!c.cabe || c.cede) && (
        <div className="mt-3 text-xs text-slate-300 bg-slate-900/40 border border-slate-700/50 rounded-xl px-4 py-3">
          <p className="font-semibold text-slate-200">Qué se puede hacer</p>
          <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-400">
            <li>
              Si lo que pesa son los <strong className="text-slate-300">respaldos</strong>: bájate el último completo y
              borra, en la lista de abajo, los que ya tengas guardados fuera.
            </li>
            <li>
              Si lo que pesa son los <strong className="text-slate-300">adjuntos</strong>: eso no se arregla borrando,
              porque son los contratos y las facturas. Hay que agrandar el disco del servidor desde el proveedor; se
              hace sin perder nada.
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

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

export default function Respaldos({ inicial, estadoInicial, completosQueSeQuieren }) {
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
      // Si para hacerlo —o después de hacerlo— se borró alguno viejo, se dice
      // aquí con nombre. Un respaldo que desaparece de la lista sin que nadie
      // lo haya dicho es lo que hace desconfiar de la lista entera.
      const podados = data.podados || [];
      setAviso(
        `Respaldo hecho y comprobado: ${data.nombre} (${MB(data.bytes)}), con la base y los PDF de las facturas. ` +
          'Bájalo y guárdalo fuera del servidor: ese es el que de verdad te cubre.' +
          (podados.length
            ? ` Se ${podados.length === 1 ? 'borró 1 respaldo viejo' : `borraron ${podados.length} respaldos viejos`} ` +
              `(${podados.map((p) => `${p.nombre}, ${MB(p.bytes)}`).join('; ')}). El porqué de cada uno está en la Bitácora.`
            : '')
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
              {e.danados > 0 &&
                ` · ${e.danados === 1 ? '1 está dañado y no cuenta' : `${e.danados} están dañados y no cuentan`}: se borra${e.danados === 1 ? '' : 'n'} solo${e.danados === 1 ? '' : 's'} en el siguiente respaldo`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={hacerRespaldo}
              disabled={!!ocupado}
              className="text-sm bg-emerald-600 hover:bg-emerald-500 text-ultra-blanco rounded-lg px-3 py-2 disabled:opacity-50 whitespace-nowrap"
            >
              {ocupado === 'crear' ? 'Haciendo…' : <><Icono nombre="respaldo" className="mr-1.5 -mt-0.5" />Hacer un respaldo ahora</>}
            </button>
            {(e.ultimoCompleto || e.ultimo) && (
              <a
                href={`/api/respaldos/${(e.ultimoCompleto || e.ultimo).nombre}`}
                className="text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 whitespace-nowrap"
              >
                <Icono nombre="descargar" className="mr-1.5 -mt-0.5" />Bajar el último completo
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Los mismos avisos que el Tablero, con las mismas palabras: quien llega
          aquí desde allá tiene que reconocer lo que vino a arreglar. Antes este
          sitio decía «revisa que el servidor esté arriba», que mandaba a mirar
          algo que estaba bien —el servidor estaba arriba: era el que pintaba el
          aviso— cuando el problema era el disco. */}
      {e.avisos.map((a) => (
        <p
          key={a.clave}
          className={`text-sm rounded-xl px-4 py-3 border ${
            a.grave
              ? 'text-red-300 bg-red-500/10 border-red-500/30'
              : 'text-amber-300 bg-amber-500/10 border-amber-500/30'
          }`}
        >
          <strong>{a.titulo}.</strong> {a.texto}
        </p>
      ))}

      {aviso && (
        <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
          {aviso}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">{error}</p>
      )}

      <Disco disco={e.disco} proximo={e.proximo} completosQueSeQuieren={completosQueSeQuieren} />

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
                    {/* Uno a medias no se esconde: ocupa sitio y hay que verlo.
                        Pero se dice que no sirve, para que nadie se lo baje
                        creyendo que se lleva un respaldo. */}
                    {!r.bien && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                        Dañado · no sirve
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">{MB(r.bytes)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {r.bien && (
                      <a href={`/api/respaldos/${r.nombre}`} className="text-cyan-400 hover:underline text-xs">
                        Bajar
                      </a>
                    )}
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
