import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { registrarApertura } from '@/lib/servicios';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('ver', async (request) => {
  const { searchParams } = new URL(request.url);
  const periodo = searchParams.get('periodo');
  const db = getDb();
  const rows = periodo
    ? db.prepare('SELECT * FROM aperturas WHERE periodo = ? ORDER BY fecha DESC, id DESC').all(periodo)
    : db.prepare('SELECT * FROM aperturas ORDER BY fecha DESC, id DESC LIMIT 500').all();
  return NextResponse.json({ aperturas: rows });
});

export const POST = conPermiso('apertura', async (request, { usuario }) => {
  const body = await leerJson(request);
  const resultado = registrarApertura(body, usuario);
  return NextResponse.json(resultado, { status: 201 });
});
