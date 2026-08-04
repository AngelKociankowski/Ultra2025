import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { crear, listar, estado, borrar, restaurar } from '@/lib/respaldos';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('respaldos', async () =>
  NextResponse.json({ respaldos: listar(), estado: estado() })
);

/**
 * Dos operaciones muy distintas por la misma puerta, según lo que llegue:
 *
 *  - JSON  -> hacer un respaldo ahora.
 *  - Un formulario con archivo -> restaurar uno.
 *
 * La restauración se pide con archivo porque el que se restaura suele ser el
 * que el administrador tenía guardado en su computadora, no uno del servidor:
 * si el servidor se perdió, los de adentro se perdieron con él.
 */
export const POST = conPermiso('respaldos', async (request, { usuario }) => {
  const tipo = request.headers.get('content-type') || '';

  if (tipo.includes('multipart/form-data')) {
    const form = await request.formData();
    const archivo = form.get('archivo');
    if (!archivo || typeof archivo.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Escoge el archivo .zip del respaldo.' }, { status: 400 });
    }
    const datos = Buffer.from(await archivo.arrayBuffer());
    return NextResponse.json(restaurar(datos, usuario, { confirmacion: form.get('confirmacion') }));
  }

  const { motivo } = await leerJson(request).catch(() => ({}));
  return NextResponse.json(crear({ motivo: motivo === 'automatico' ? 'automatico' : 'manual', usuario }), {
    status: 201,
  });
});

export const DELETE = conPermiso('respaldos', async (request, { usuario }) => {
  const nombre = new URL(request.url).searchParams.get('nombre');
  return NextResponse.json(borrar(nombre, usuario));
});
