import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { ValidacionError } from '@/lib/errores';
import { getDb } from '@/lib/db';
import { adjuntarContrato, quitarContrato } from '@/lib/servicios';
import { guardar, leer, borrar } from '@/lib/archivos';

export const dynamic = 'force-dynamic';

const servicio = (id) => getDb().prepare('SELECT * FROM servicios WHERE id = ?').get(Number(id));

/**
 * Descarga el contrato. Verlo es de cualquier rol: saber con qué condiciones
 * opera un servicio le sirve a operaciones y a ventas tanto como a jurídico.
 *
 * Se sirve como descarga y nunca como página, la misma regla que los CFDI.
 */
export const GET = conPermiso('ver', async (request, { params }) => {
  const s = servicio(params.id);
  if (!s) return NextResponse.json({ error: 'Ese servicio no existe.' }, { status: 404 });
  if (!s.contrato_archivo) {
    return NextResponse.json({ error: 'Este servicio no tiene el contrato adjunto.' }, { status: 404 });
  }

  const datos = leer(s.contrato_archivo);
  if (!datos) return NextResponse.json({ error: 'El archivo ya no está en el disco.' }, { status: 404 });

  return new NextResponse(datos, {
    headers: {
      'Content-Type': s.contrato_archivo_tipo || 'application/pdf',
      'Content-Disposition': `attachment; filename="${s.contrato_archivo_nombre || 'contrato.pdf'}"`,
      'Content-Length': String(datos.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** Subir o reemplazar el contrato: eso ya es jurídico. */
export const POST = conPermiso('editar_contrato', async (request, { params, usuario }) => {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new ValidacionError('No llegó el archivo.');
  }

  const datos = await guardar(form.get('archivo'), 'contrato', { acepta: ['pdf'] });
  const { anterior } = adjuntarContrato(params.id, datos, usuario);
  // El que se reemplaza se borra del disco: dejarlo ahí sería guardar copias
  // que ya nadie puede alcanzar desde la plataforma.
  if (anterior && anterior !== datos.archivo) borrar(anterior);

  return NextResponse.json({ ...datos, ok: true }, { status: 201 });
});

export const DELETE = conPermiso('editar_contrato', async (request, { params, usuario }) => {
  const { archivo } = quitarContrato(params.id, usuario);
  borrar(archivo);
  return NextResponse.json({ ok: true });
});
