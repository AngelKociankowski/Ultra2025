import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { ValidacionError } from '@/lib/errores';
import { facturaPorId, adjuntarArchivo } from '@/lib/facturacion';
import { guardar, leer, borrar } from '@/lib/archivos';

export const dynamic = 'force-dynamic';

/**
 * Descarga del archivo de una factura. Consultarlo es de cualquier rol: es el
 * respaldo de un cobro y quien ve la cuenta tiene que poder ver el papel.
 *
 * Se sirve siempre como descarga —nunca como página— para que un XML con algo
 * dentro no se ejecute en la sesión de quien lo abre.
 */
export const GET = conPermiso('ver', async (request, { params }) => {
  const factura = facturaPorId(params.id);
  if (!factura) return NextResponse.json({ error: 'Esa factura no existe.' }, { status: 404 });
  if (!factura.archivo) return NextResponse.json({ error: 'Esa factura no tiene archivo.' }, { status: 404 });

  const datos = leer(factura.archivo);
  if (!datos) return NextResponse.json({ error: 'El archivo ya no está en el disco.' }, { status: 404 });

  return new NextResponse(datos, {
    headers: {
      'Content-Type': factura.archivo_tipo || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${factura.archivo_nombre || 'factura'}"`,
      'Content-Length': String(datos.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** Subir o reemplazar el archivo. Eso ya es mover la cobranza. */
export const POST = conPermiso('editar_finanzas', async (request, { params, usuario }) => {
  const factura = facturaPorId(params.id);
  if (!factura) throw new ValidacionError('Esa factura no existe.');

  let form;
  try {
    form = await request.formData();
  } catch {
    throw new ValidacionError('No se pudo leer el archivo.');
  }

  const datos = await guardar(form.get('archivo'), `f${factura.id}`);
  const resultado = adjuntarArchivo(factura.id, datos, usuario);
  // El anterior se borra solo después de que el nuevo quedó registrado.
  if (resultado.reemplazo) borrar(resultado.reemplazo);

  return NextResponse.json({ ok: true, archivo_nombre: datos.archivo_nombre }, { status: 201 });
});
