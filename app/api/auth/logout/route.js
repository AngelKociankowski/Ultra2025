import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destruirSesion, COOKIE_SESION } from '@/lib/auth';
import { esFaltaDeEspacio } from '@/lib/errores';

export const dynamic = 'force-dynamic';

export async function POST() {
  const token = cookies().get(COOKIE_SESION)?.value;
  // Salir borra la sesión de la base, y con el disco lleno hasta un borrado
  // falla: SQLite necesita escribir en su diario para quitar un renglón. La
  // cookie se quita de todos modos —quien pide salir tiene que quedar fuera de
  // este navegador— y la sesión que no se pudo borrar caduca sola.
  try {
    destruirSesion(token);
  } catch (err) {
    if (!esFaltaDeEspacio(err)) throw err;
    console.error('[disco] sin espacio al cerrar una sesión:', err.message);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESION, '', { path: '/', maxAge: 0 });
  return res;
}
