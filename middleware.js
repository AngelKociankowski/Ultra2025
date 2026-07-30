import { NextResponse } from 'next/server';

const PUBLICAS = ['/login', '/api/auth/login'];

/**
 * Portero de primer nivel: sin cookie de sesión no se entra.
 * La validación real del token y del rol ocurre en cada página y ruta de API,
 * que sí tienen acceso a la base de datos.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLICAS.some((p) => pathname === p) || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('ultra_session')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('destino', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
