import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { suspenderServicio, reactivarServicio } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Pone el servicio en pausa. No es una cancelación y por eso no vive en
 * /api/cancelaciones: un suspendido no se fue, dejó de contar.
 *
 * Lo mueve quien mueve el estado de fuerza —operaciones, ventas y el
 * administrador—, que son los que saben si el cliente paró o se fue.
 */
export const POST = conPermiso('cancelacion', async (request, { params, usuario }) => {
  const { motivo, desde } = await leerJson(request).catch(() => ({}));
  return NextResponse.json(suspenderServicio(params.id, { motivo, desde }, usuario));
});

/** Y de vuelta a la operación, con la plantilla que tenía. */
export const DELETE = conPermiso('cancelacion', async (request, { params, usuario }) => {
  const { motivo } = await leerJson(request).catch(() => ({}));
  return NextResponse.json(reactivarServicio(params.id, { motivo }, usuario));
});
