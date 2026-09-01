import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { conPermiso } from '@/lib/api';
import { leer } from '@/lib/respaldos';

export const dynamic = 'force-dynamic';

/**
 * Baja el respaldo a la computadora de quien lo pide. Este es el paso que de
 * verdad protege: mientras el archivo solo esté en el servidor, comparte su
 * suerte con lo que se supone que respalda.
 *
 * Se manda por pedazos, leyéndolo del disco a medida que sale, en vez de
 * cargarlo entero a memoria primero. Un respaldo completo trae la base y todos
 * los PDF de facturas y contratos: leerlo de golpe podía pasarse de los 512 MB
 * de la máquina, y quedarse sin memoria no es un error que se pueda atrapar —el
 * sistema mata el proceso—. El síntoma era la plataforma «caída» justo después
 * de darle a Bajar, y como el archivo nunca llegaba, uno le volvía a dar.
 *
 * Así la memoria que ocupa bajarlo ya no depende de cuánto pese el respaldo.
 */
export const GET = conPermiso('respaldos', async (request, { params }) => {
  const { nombre, ruta, bytes } = leer(params.nombre);

  return new NextResponse(Readable.toWeb(fs.createReadStream(ruta)), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(bytes),
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  });
});
