import { NextResponse } from 'next/server';
import { autenticar, COOKIE_SESION, MAX_AGE_SESION } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Petición inválida.' }, { status: 400 });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return NextResponse.json({ error: 'Correo y contraseña son obligatorios.' }, { status: 400 });
  }

  const sesion = autenticar(email, password);
  if (!sesion) {
    return NextResponse.json({ error: 'Credenciales incorrectas.' }, { status: 401 });
  }

  const res = NextResponse.json({ usuario: sesion.usuario });
  res.cookies.set(COOKIE_SESION, sesion.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SESION,
  });
  return res;
}
