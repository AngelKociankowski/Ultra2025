'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils';

/**
 * Poner el acuerdo de la ficha al día desde donde se ve que está viejo.
 *
 * Cobranza lo describió exacto: «yo capturé los importes correctos porque hubo
 * un incremento en el servicio, debería de quedar con 96,976 (…) ya me fui a
 * septiembre y sigue con los 88,160». Corrigió las facturas y el error no se
 * fue, porque el descuadre no estaba ahí: la factura decía la verdad y el que
 * había quedado viejo era el importe acordado de la ficha, que nadie actualizó
 * cuando al cliente se le subió el precio.
 *
 * El permiso para cambiarlo ya existía —finanzas edita el importe acordado
 * desde la ficha del servicio— y aun así el problema seguía sin resolverse. Esa
 * es la parte que interesa: no faltaba un permiso, faltaba un camino. Quien ve
 * el descuadre lo ve en esta pantalla, y el arreglo estaba en otra, en un campo
 * que hay que saber que existe y que se llama parecido a media docena de otros.
 *
 * Por eso el botón vive en el renglón del hallazgo. No hace nada que no se
 * pudiera hacer antes: lleva el importe acordado a lo que de verdad se facturó.
 *
 * Lo que NO hace, a propósito:
 *
 *   · No decide quién tiene razón. La plataforma no puede saber si el número
 *     bueno es la factura o el acuerdo; solo sabe que no coinciden. Por eso
 *     enseña los dos y pregunta, en vez de «arreglar» el descuadre solo.
 *   · No toca la plantilla de guardias. Cuando lo que no cuadra es cuántos
 *     guardias se facturaron contra los que están en la calle, el dato de la
 *     calle es de operaciones y cambiarlo desde cobranza sería taparlo.
 */
export default function AjustarAcuerdo({ servicioId, servicio, facturado, contratado }) {
  const router = useRouter();
  const [estado, setEstado] = useState(null); // null | 'preguntando' | 'enviando' | 'listo'
  const [error, setError] = useState('');

  async function ajustar() {
    setEstado('enviando');
    setError('');
    try {
      const r = await fetch(`/api/servicios/${servicioId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importe_factura: facturado }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'No se pudo actualizar.');
        return setEstado('preguntando');
      }
      setEstado('listo');
      router.refresh();
    } catch {
      setError('Error de red.');
      setEstado('preguntando');
    }
  }

  if (estado === 'listo') {
    return <p className="text-[11px] text-emerald-400 mt-1">Acuerdo actualizado a {formatCurrency(facturado)}.</p>;
  }

  if (estado === 'preguntando' || estado === 'enviando') {
    return (
      <div className="mt-1.5 text-[11px] bg-slate-900/60 border border-slate-700/60 rounded-lg px-2.5 py-2">
        <p className="text-slate-300">
          La ficha de {servicio} dice {formatCurrency(contratado)} al mes y se facturaron{' '}
          {formatCurrency(facturado)}.
        </p>
        <p className="text-slate-500 mt-0.5">
          Si el precio subió y la factura es la buena, esto pone la ficha en {formatCurrency(facturado)}. Si la
          equivocada es la factura, ciérrala y corrígela desde el servicio.
        </p>
        {error && <p className="text-red-400 mt-1">{error}</p>}
        <div className="flex gap-2 mt-1.5">
          <button
            onClick={ajustar}
            disabled={estado === 'enviando'}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-ultra-blanco rounded px-2 py-1"
          >
            {estado === 'enviando' ? 'Guardando…' : 'Sí, la ficha estaba vieja'}
          </button>
          <button onClick={() => setEstado(null)} className="text-slate-500 hover:text-white px-1.5 py-1">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEstado('preguntando')}
      className="text-[11px] text-cyan-400 hover:underline mt-1"
    >
      Actualizar el acuerdo de la ficha
    </button>
  );
}
