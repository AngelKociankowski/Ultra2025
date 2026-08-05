import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { deshacerApertura } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Saca del estado de fuerza una apertura que se aplicó por error, sin fabricar
 * una cancelación que diga que el cliente se fue.
 *
 * Lo puede hacer quien registra aperturas —quien se equivoca aplicando es quien
 * debe poder corregirlo— pero solo mientras el servicio no haya trabajado. En
 * cuanto tiene una factura o un comentario, la función lo rechaza y manda a la
 * cancelación, que es la única salida con folio y motivo.
 */
export const POST = conPermiso('apertura', async (request, { params, usuario }) => {
  const { motivo } = await leerJson(request).catch(() => ({}));
  return NextResponse.json(deshacerApertura(params.id, { motivo }, usuario));
});
