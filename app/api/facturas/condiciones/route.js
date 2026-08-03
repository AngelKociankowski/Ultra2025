import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { aplicarCondiciones } from '@/lib/facturacion';

export const dynamic = 'force-dynamic';

/**
 * Aplica las mismas condiciones de cobro a un grupo de servicios.
 * Es configuración: no emite ni una factura.
 */
export const POST = conPermiso('editar_finanzas', async (request, { usuario }) =>
  NextResponse.json(aplicarCondiciones(await leerJson(request), usuario))
);
