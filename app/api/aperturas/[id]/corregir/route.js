import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { corregirApertura } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Arregla los datos de catálogo de una apertura que todavía no se aplica.
 *
 * Va con el permiso de apertura y no con el de corregir: no es una corrección
 * del estado de fuerza —el servicio ni existe todavía— sino un arreglo del
 * movimiento antes de que entre. Quien captura aperturas es quien la puede
 * enmendar.
 */
export const PATCH = conPermiso('apertura', async (request, { params, usuario }) => {
  const cambios = await leerJson(request);
  return NextResponse.json(corregirApertura(params.id, cambios, usuario));
});
