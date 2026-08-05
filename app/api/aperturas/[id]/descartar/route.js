import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { descartarApertura, reactivarApertura } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/** «Esta no se va a aplicar»: sale de la cola de pendientes, no del histórico. */
export const POST = conPermiso('apertura', async (request, { params, usuario }) => {
  const { motivo } = await leerJson(request).catch(() => ({}));
  return NextResponse.json(descartarApertura(params.id, { motivo }, usuario));
});

/** Y de vuelta a la cola, si cambió el criterio. */
export const DELETE = conPermiso('apertura', async (request, { params, usuario }) =>
  NextResponse.json(reactivarApertura(params.id, usuario))
);
