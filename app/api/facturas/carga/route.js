import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { cargarFacturas, plantillaDeCarga } from '@/lib/facturacion';
import { escribirCSV, leerCSV } from '@/lib/csv';

export const dynamic = 'force-dynamic';

const COLUMNAS = [
  ['id', 'id'],
  ['servicio', 'Servicio'],
  ['periodo', 'Periodo'],
  ['concepto', 'Concepto'],
  ['fecha_factura', 'Fecha de factura'],
  ['dias_credito', 'Días de crédito'],
  ['importe', 'Importe'],
  ['folio', 'Folio fiscal'],
  ['pagado', '¿Pagada?'],
  ['fecha_pago', 'Fecha de pago'],
];

/**
 * La plantilla para capturar en Excel lo que ya se había facturado.
 *
 * Va con los servicios y las fechas ya propuestas donde se pueden calcular, y
 * con la columna `id` para que un nombre repetido —hay dos «CHRYSLER ANZURES»—
 * no acabe cargándole la factura al servicio equivocado.
 */
export const GET = conPermiso('editar_finanzas', async (request) => {
  const periodo = new URL(request.url).searchParams.get('periodo') || new Date().toISOString().slice(0, 7);
  const csv = escribirCSV(COLUMNAS, plantillaDeCarga(periodo));
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cobranza-${periodo}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

/**
 * Carga el archivo. Con `simular` revisa y no guarda nada: esa pasada en seco
 * es la que enseña los errores antes de meter doscientos renglones.
 */
export const POST = conPermiso('editar_finanzas', async (request, { usuario }) => {
  const { csv, simular } = await leerJson(request);
  const filas = leerCSV(csv || '');
  return NextResponse.json(cargarFacturas(filas, usuario, { simular: !!simular }));
});
