import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { descartarAperturasEnLote } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Cerrar de un golpe una cola de aperturas que no se van a aplicar.
 *
 * Existe por el arrastre de la importación: doscientas aperturas de 2023 a 2025
 * de servicios que ya no operan, que había que descartar una por una —con su
 * motivo tecleado doscientas veces— o dejar contadas como pendientes para
 * siempre.
 *
 * El permiso es el mismo que descarta una suelta, `apertura`, y no uno nuevo:
 * esto no es una facultad distinta, es la misma hecha de corrido. Lo que lo
 * contiene es el tope de 250 por llamada, el motivo obligatorio y que cada una
 * siga siendo reversible con `reactivarApertura()`.
 */
export const POST = conPermiso('apertura', async (request, { usuario }) => {
  const { ids, motivo } = await leerJson(request);
  return NextResponse.json(descartarAperturasEnLote(ids, { motivo }, usuario));
});
