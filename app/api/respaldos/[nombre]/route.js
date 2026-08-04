import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { leer } from '@/lib/respaldos';

export const dynamic = 'force-dynamic';

/**
 * Baja el respaldo a la computadora de quien lo pide. Este es el paso que de
 * verdad protege: mientras el archivo solo esté en el servidor, comparte su
 * suerte con lo que se supone que respalda.
 */
export const GET = conPermiso('respaldos', async (request, { params }) => {
  const { nombre, datos } = leer(params.nombre);
  return new NextResponse(datos, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(datos.length),
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  });
});
