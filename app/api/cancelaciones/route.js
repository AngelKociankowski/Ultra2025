import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { registrarCancelacion } from '@/lib/servicios';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('ver', async (request) => {
  const { searchParams } = new URL(request.url);
  const periodo = searchParams.get('periodo');
  const db = getDb();
  const rows = periodo
    ? db.prepare('SELECT * FROM cancelaciones WHERE periodo = ? ORDER BY fecha DESC, id DESC').all(periodo)
    : db.prepare('SELECT * FROM cancelaciones ORDER BY fecha DESC, id DESC LIMIT 500').all();
  return NextResponse.json({ cancelaciones: rows });
});

export const POST = conPermiso('cancelacion', async (request, { usuario }) => {
  const body = await leerJson(request);
  const resultado = registrarCancelacion(body, usuario);
  return NextResponse.json(resultado, { status: 201 });
});
