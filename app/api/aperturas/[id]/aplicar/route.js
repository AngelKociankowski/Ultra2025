import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { aplicarApertura } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Mete al estado de fuerza una apertura que quedó anotada sin servicio.
 *
 * Es una apertura como cualquier otra —crea el servicio, deja la trazabilidad y
 * queda en bitácora—, solo que el movimiento ya estaba capturado desde antes.
 */
export const POST = conPermiso('apertura', async (request, { params, usuario }) =>
  NextResponse.json(aplicarApertura(params.id, usuario))
);
