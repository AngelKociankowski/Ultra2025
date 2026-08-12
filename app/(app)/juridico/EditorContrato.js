'use client';

import { useState } from 'react';
import Icono from '@/components/Icono';

const campo =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60';

const MB = (b) => `${(Number(b) / 1024 / 1024).toFixed(1)} MB`;

/**
 * El contrato de un servicio, editable sin salir de la lista.
 *
 * Jurídico trabaja de corrido: revisa 58 vencidos y actualiza fechas o deja
 * una nota en cada uno. Obligar a abrir la ficha, editar, volver y buscar el
 * renglón donde se quedó convierte una tarde en dos.
 *
 * No es una segunda puerta de escritura: pega contra el mismo
 * PATCH /api/servicios/[id] que la ficha, con los mismos permisos por bloque de
 * campos. Si el rol no puede tocar contratos, el servidor lo rechaza igual que
 * si lo intentara desde la ficha.
 */
export default function EditorContrato({ servicio: s, puedeEditar, onGuardado }) {
  const [f, setF] = useState({
    tiene_contrato: Boolean(s.tiene_contrato),
    fecha_contrato: s.fecha_contrato || '',
    fecha_vencimiento_contrato: s.fecha_vencimiento_contrato || '',
    condiciones_comerciales: s.condiciones_comerciales || '',
    comentarios_contrato: s.comentarios_contrato || '',
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);

  const set = (k, v) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setListo(false);
  };

  async function guardar() {
    setEnviando(true);
    setError('');
    try {
      const r = await fetch(`/api/servicios/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f,
          tiene_contrato: f.tiene_contrato ? 1 : 0,
          // Un campo vacío se manda como null, no como cadena vacía: así la
          // base distingue «no se sabe» de «se dejó en blanco a propósito», y
          // los filtros de vigencia no tienen que adivinar cuál es cuál.
          fecha_contrato: f.fecha_contrato || null,
          fecha_vencimiento_contrato: f.fecha_vencimiento_contrato || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo guardar.');
      setListo(true);
      onGuardado?.();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  async function subirPdf(ev) {
    const archivo = ev.target.files?.[0];
    if (!archivo) return;
    setEnviando(true);
    setError('');
    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', archivo);
      const r = await fetch(`/api/servicios/${s.id}/contrato`, { method: 'POST', body: cuerpo });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo subir el contrato.');
      onGuardado?.();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
      ev.target.value = '';
    }
  }

  // Sin permiso la ventana se vuelve de solo lectura, en vez de desaparecer:
  // ventas y operaciones también necesitan leer las condiciones con las que se
  // firmó un cliente.
  if (!puedeEditar) {
    return (
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Dato etiqueta="Contrato" valor={s.tiene_contrato ? 'Sí cuenta con contrato' : 'No cuenta con contrato'} />
        <Dato etiqueta="Condiciones comerciales" valor={s.condiciones_comerciales} />
        <Dato etiqueta="Firma" valor={s.fecha_contrato} />
        <Dato etiqueta="Vencimiento" valor={s.fecha_vencimiento_contrato} />
        <div className="md:col-span-2">
          <Dato etiqueta="Notas de jurídico" valor={s.comentarios_contrato} />
        </div>
        <p className="md:col-span-2 text-xs text-slate-500">
          Solo jurídico y el administrador modifican estos datos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-4 gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-1">
          <input
            type="checkbox"
            checked={f.tiene_contrato}
            onChange={(e) => set('tiene_contrato', e.target.checked)}
            className="w-4 h-4 accent-emerald-500"
          />
          Cuenta con contrato
        </label>

        <label className="text-xs text-slate-500">
          Fecha de firma
          <input type="date" value={f.fecha_contrato} onChange={(e) => set('fecha_contrato', e.target.value)} className={`${campo} mt-1`} />
        </label>

        <label className="text-xs text-slate-500">
          Vence
          <input
            type="date"
            value={f.fecha_vencimiento_contrato}
            onChange={(e) => set('fecha_vencimiento_contrato', e.target.value)}
            className={`${campo} mt-1`}
          />
        </label>

        <label className="text-xs text-slate-500">
          Condiciones comerciales
          <input
            value={f.condiciones_comerciales}
            onChange={(e) => set('condiciones_comerciales', e.target.value)}
            placeholder="A los 20 días de cada mes"
            className={`${campo} mt-1`}
          />
        </label>
      </div>

      <label className="block text-xs text-slate-500">
        Notas de jurídico
        <textarea
          value={f.comentarios_contrato}
          onChange={(e) => set('comentarios_contrato', e.target.value)}
          rows={2}
          placeholder="En qué va la renovación, qué falta, con quién se está negociando…"
          className={`${campo} mt-1 resize-y`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={enviando}
          className="text-sm bg-ultra-rojo hover:opacity-90 text-ultra-blanco rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {enviando ? 'Guardando…' : 'Guardar'}
        </button>

        {s.contrato_archivo ? (
          <span className="text-xs text-slate-400">
            <a href={`/api/servicios/${s.id}/contrato`} className="text-emerald-300 hover:underline">
              <Icono nombre="documento" className="mr-1.5 -mt-0.5" />{s.contrato_archivo_nombre || 'contrato.pdf'}
            </a>
            {s.contrato_archivo_bytes ? ` · ${MB(s.contrato_archivo_bytes)}` : ''} ·{' '}
            <label className="text-cyan-400 hover:underline cursor-pointer">
              reemplazar
              <input type="file" accept="application/pdf,.pdf" onChange={subirPdf} className="hidden" disabled={enviando} />
            </label>
          </span>
        ) : (
          <label className="text-xs text-cyan-400 hover:underline cursor-pointer">
            <Icono nombre="subir" className="mr-1.5 -mt-0.5" />Subir el PDF del contrato
            <input type="file" accept="application/pdf,.pdf" onChange={subirPdf} className="hidden" disabled={enviando} />
          </label>
        )}

        {listo && <span className="text-xs text-emerald-400">Guardado.</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <p className="text-slate-300">
      <span className="text-xs text-slate-500 block">{etiqueta}</span>
      {valor || <span className="text-slate-600">—</span>}
    </p>
  );
}
