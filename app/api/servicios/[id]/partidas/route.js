import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { partidasDe, resumenDe, guardarPartidas } from '@/lib/partidas';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('ver', async (request, { params }) => {
  const s = getDb().prepare('SELECT * FROM servicios WHERE id = ?').get(Number(params.id));
  if (!s) return NextResponse.json({ error: 'Ese servicio no existe.' }, { status: 404 });
  return NextResponse.json(resumenDe(s));
});

/**
 * Guarda el desglose completo. Es el precio al cliente, así que lo mueven los
 * mismos que mueven precios: ventas, finanzas y el administrador.
 */
export const PUT = conPermiso('precios', async (request, { params, usuario }) => {
  const { partidas } = await leerJson(request);
  return NextResponse.json(guardarPartidas(params.id, partidas, usuario));
});
