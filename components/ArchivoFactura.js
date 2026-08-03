'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * El PDF de una factura: descargarlo si ya está, subirlo si no.
 *
 * Se puede adjuntar después de registrada porque el papel casi nunca llega al
 * mismo tiempo: primero se emite y se manda a timbrar, y el archivo aparece
 * horas más tarde. Condicionar el registro del cobro a tener el PDF sería
 * retrasar el saldo por esperar un archivo.
 */
export default function ArchivoFactura({ factura, puedeSubir }) {
  const router = useRouter();
  const entrada = useRef(null);
  const [estado, setEstado] = useState(null);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendo(true);
    setEstado(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', archivo);
      const res = await fetch(`/api/facturas/${factura.id}/archivo`, { method: 'POST', body: cuerpo });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEstado(data.error || 'No se pudo subir.');
        return;
      }
      router.refresh();
    } catch {
      setEstado('Error de red.');
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  const kb = factura.archivo_bytes ? Math.max(1, Math.round(factura.archivo_bytes / 1024)) : null;

  return (
    <div className="whitespace-nowrap">
      {factura.archivo ? (
        <a
          href={`/api/facturas/${factura.id}/archivo`}
          className="text-xs text-cyan-400 hover:underline"
          title={`${factura.archivo_nombre}${kb ? ` · ${kb} KB` : ''}`}
        >
          📎 {factura.archivo_tipo === 'application/pdf' ? 'PDF' : 'XML'}
        </a>
      ) : (
        <span className="text-xs text-slate-600">—</span>
      )}

      {puedeSubir && (
        <>
          <button
            type="button"
            onClick={() => entrada.current?.click()}
            disabled={subiendo}
            className="text-xs text-slate-500 hover:text-cyan-400 hover:underline ml-2 disabled:opacity-40"
          >
            {subiendo ? '…' : factura.archivo ? 'Cambiar' : 'Subir'}
          </button>
          <input
            ref={entrada}
            type="file"
            accept=".pdf,.xml,application/pdf,application/xml,text/xml"
            onChange={subir}
            className="hidden"
          />
        </>
      )}

      {estado && <span className="block text-[11px] text-red-300 max-w-[160px] whitespace-normal">{estado}</span>}
    </div>
  );
}
