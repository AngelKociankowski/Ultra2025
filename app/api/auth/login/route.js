import { NextResponse } from 'next/server';
import { autenticar, COOKIE_SESION, MAX_AGE_SESION } from '@/lib/auth';
import { sinEspacio } from '@/lib/api';

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

  /**
   * Entrar ESCRIBE: guarda la sesión y deja el renglón en la bitácora. Con el
   * disco lleno eso revienta, y esta ruta no pasa por `conPermiso()` —todavía
   * no hay sesión que comprobar—, así que el error salía crudo: la pantalla de
   * acceso decía que algo falló y parecía que la contraseña estaba mal o que la
   * plataforma se había caído. Es la primera pantalla que toca cualquiera, o
   * sea la primera donde hay que decir qué pasa de verdad.
   */
  let sesion;
  try {
    sesion = autenticar(email, password);
  } catch (err) {
    const lleno = sinEspacio(err);
    if (lleno) return lleno;
    throw err;
  }
  if (!sesion) {
    return NextResponse.json({ error: 'Credenciales incorrectas.' }, { status: 401 });
  }

  /**
   * El destino lo decide el servidor, no el navegador: si la contraseña todavía
   * es la que puso quien dio de alta la cuenta, lo único que se puede hacer es
   * cambiarla. Mandarlo desde aquí evita que el cliente navegue a una pantalla
   * que el layout va a rechazar —esa carrera dejaba la vista en blanco—.
   */
  const destinoPedido = String(body.destino || '').startsWith('/') ? body.destino : '/';
  const destino = sesion.usuario.debe_cambiar_password ? '/cuenta' : destinoPedido;

  const res = NextResponse.json({ usuario: sesion.usuario, destino });
  res.cookies.set(COOKIE_SESION, sesion.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SESION,
  });
  return res;
}
