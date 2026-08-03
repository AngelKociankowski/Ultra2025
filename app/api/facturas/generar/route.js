import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { generarDelPeriodo } from '@/lib/facturacion';

export const dynamic = 'force-dynamic';

/**
 * Emite de golpe la facturación del mes: a cada servicio activo la factura que
 * le toca según su esquema. Se puede volver a pulsar sin miedo —salta lo que ya
 * está emitido— y devuelve qué se quedó fuera y por qué.
 */
export const POST = conPermiso('editar_finanzas', async (request, { usuario }) => {
  const { periodo } = await leerJson(request);
  return NextResponse.json(generarDelPeriodo(periodo, usuario), { status: 201 });
});
