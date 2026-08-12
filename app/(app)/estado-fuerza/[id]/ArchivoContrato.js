'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icono from '@/components/Icono';

const MB = (b) => `${(Number(b) / 1024 / 1024).toFixed(1)} MB`;

/**
 * Subir, ver o quitar el PDF del contrato.
 *
 * Es el mismo trato que se le da al CFDI de una factura: el papel vive en el
 * disco junto a la base, entra solo en PDF, y se baja como descarga y nunca
 * como página. Lo que cambia es quién puede tocarlo —jurídico y el
 * administrador— y que verlo es de todos, porque saber con qué condiciones
 * opera un servicio le sirve a operaciones tanto como a jurídico.
 */
export default function ArchivoContrato({ servicioId, archivo, nombre, bytes, subidoEn, puedeEditar }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function subir(ev) {
    const archivoNuevo = ev.target.files?.[0];
    if (!archivoNuevo) return;
    setEnviando(true);
    setError('');
    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', archivoNuevo);
      const r = await fetch(`/api/servicios/${servicioId}/contrato`, { method: 'POST', body: cuerpo });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo subir el contrato.');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setEnviando(false);
      ev.target.value = '';
    }
  }

  async function quitar() {
    if (!confirm('¿Quitar el PDF del contrato?\n\nEl servicio sigue marcado como que sí tiene contrato; lo que se quita es el archivo.')) {
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const r = await fetch(`/api/servicios/${servicioId}/contrato`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return setError(data.error || 'No se pudo quitar.');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-700/50 pt-3">
      {archivo ? (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`/api/servicios/${servicioId}/contrato`}
            className="text-sm bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 rounded-lg px-3 py-2"
          >
            <Icono nombre="documento" className="mr-1.5 -mt-0.5" />Ver el contrato
          </a>
          <span className="text-xs text-slate-500">
            {nombre}
            {bytes ? ` · ${MB(bytes)}` : ''}
            {subidoEn ? ` · subido el ${subidoEn}` : ''}
          </span>
          {puedeEditar && (
            <div className="flex items-center gap-3 ml-auto">
              <label className="text-xs text-cyan-400 hover:underline cursor-pointer">
                Reemplazar
                <input type="file" accept=".pdf,application/pdf" onChange={subir} disabled={enviando} className="hidden" />
              </label>
              <button
                type="button"
                onClick={quitar}
                disabled={enviando}
                className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
              >
                Quitar
              </button>
            </div>
          )}
        </div>
      ) : puedeEditar ? (
        <label className="inline-flex items-center gap-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-2 cursor-pointer">
          {enviando ? 'Subiendo…' : <><Icono nombre="subir" className="mr-1.5 -mt-0.5" />Subir el PDF del contrato</>}
          <input type="file" accept=".pdf,application/pdf" onChange={subir} disabled={enviando} className="hidden" />
        </label>
      ) : (
        <p className="text-xs text-slate-500">
          El PDF del contrato no está en la plataforma. Jurídico o el administrador pueden subirlo.
        </p>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
