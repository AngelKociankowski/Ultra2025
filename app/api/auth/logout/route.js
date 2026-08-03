import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destruirSesion, COOKIE_SESION } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const token = cookies().get(COOKIE_SESION)?.value;
  destruirSesion(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESION, '', { path: '/', maxAge: 0 });
  return res;
}
