import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { aplicarApertura } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Mete al estado de fuerza una apertura que quedó anotada sin servicio.
 *
 * Es una apertura como cualquier otra —crea el servicio, deja la trazabilidad y
 * queda en bitácora—, solo que el movimiento ya estaba capturado desde antes.
 */
export const POST = conPermiso('apertura', async (request, { params, usuario }) => {
  // Opcionalmente trae correcciones para los campos de catálogo. Es lo que
  // permite arreglar al aplicar una zona que ya no existe, en lugar de meterla
  // al estado de fuerza y descubrirla después como huérfana en Catálogos.
  const correcciones = await leerJson(request).catch(() => ({}));
  return NextResponse.json(aplicarApertura(params.id, usuario, correcciones || {}));
});
