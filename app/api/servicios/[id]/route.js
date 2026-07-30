import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { obtenerServicio, actualizarServicio } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('ver', async (request, { params }) => {
  const servicio = obtenerServicio(Number(params.id));
  if (!servicio) return NextResponse.json({ error: 'Servicio no encontrado.' }, { status: 404 });
  return NextResponse.json({ servicio });
});

/**
 * Edición por bloques según rol:
 *   jurídico -> campos de contrato
 *   finanzas -> campos de facturación y cobranza
 *   admin    -> todos, más los datos operativos
 * Los campos fuera del alcance del rol se rechazan sin aplicarse.
 */
export const PATCH = conPermiso('ver', async (request, { params, usuario }) => {
  const body = await leerJson(request);
  const resultado = actualizarServicio(Number(params.id), body, usuario);
  return NextResponse.json(resultado);
});

/**
 * No existe baja directa: la única salida del estado de fuerza es
 * POST /api/cancelaciones.
 */
export async function DELETE() {
  return NextResponse.json(
    {
      error:
        'Un servicio no se elimina. Registra una cancelación en POST /api/cancelaciones.',
    },
    { status: 405 }
  );
}
