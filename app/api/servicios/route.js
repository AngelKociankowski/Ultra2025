import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { listarServicios } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('ver', async (request) => {
  const { searchParams } = new URL(request.url);
  const servicios = listarServicios({
    estatus: searchParams.get('estatus') || undefined,
    zona: searchParams.get('zona') || undefined,
    asesor: searchParams.get('asesor') || undefined,
    turno: searchParams.get('turno') || undefined,
    contrato: searchParams.get('contrato') || undefined,
    facturado: searchParams.get('facturado') || undefined,
    q: searchParams.get('q') || undefined,
  });
  return NextResponse.json({ servicios });
});

/**
 * No existe alta directa de servicios: la única entrada al estado de fuerza es
 * POST /api/aperturas.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Un servicio no se da de alta directamente. Registra una apertura en POST /api/aperturas.',
    },
    { status: 405 }
  );
}
