import { conPermiso } from '@/lib/api';
import { carteraJuridica, COLUMNAS_CSV, filaParaCSV, ESTADOS } from '@/lib/juridico';
import { escribirCSV } from '@/lib/csv';
import { hoy } from '@/lib/fechas';

export const dynamic = 'force-dynamic';

/**
 * La cartera de contratos en CSV, con los filtros que traiga la pantalla.
 *
 * Jurídico no siempre trabaja dentro de la plataforma: una junta con dirección,
 * un despacho externo o una revisión de un cliente terminan en una hoja de
 * cálculo. Se exporta lo filtrado y no todo, porque quien pidió «los vencidos
 * de la zona norte» quiere ese archivo, no 223 renglones que tiene que volver
 * a filtrar en Excel.
 */
export const GET = conPermiso('ver', async (request) => {
  const url = new URL(request.url);
  const p = (k) => url.searchParams.get(k) || '';
  const estado = ESTADOS[p('estado')] ? p('estado') : '';

  const { filas } = carteraJuridica({
    estado,
    zona: p('zona'),
    asesor: p('asesor'),
    pdf: ['con', 'sin'].includes(p('pdf')) ? p('pdf') : '',
    q: p('q'),
  });

  const csv = escribirCSV(COLUMNAS_CSV, filas.map(filaParaCSV));
  const nombre = `contratos-${estado ? `${estado.toLowerCase()}-` : ''}${hoy()}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
