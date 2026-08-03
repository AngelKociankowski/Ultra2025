import { NextResponse } from 'next/server';

const PUBLICAS = ['/login', '/api/auth/login'];

/**
 * Archivos estáticos servidos desde public/. Sin esta excepción el logo de la
 * pantalla de acceso se pide sin sesión, el portero lo manda a /login y la
 * imagen llega como HTML: se ve rota justo en la única página donde nadie ha
 * iniciado sesión todavía.
 */
const ESTATICOS = /\.(svg|png|jpe?g|gif|webp|ico|woff2?|ttf|css|js|map|txt|webmanifest)$/i;

/**
 * Portero de primer nivel: sin cookie de sesión no se entra.
 * La validación real del token y del rol ocurre en cada página y ruta de API,
 * que sí tienen acceso a la base de datos.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLICAS.some((p) => pathname === p) || pathname.startsWith('/_next') || ESTATICOS.test(pathname)) {
    return NextResponse.next();
  }

  /**
   * Los layouts no reciben la ruta, y el de la aplicación la necesita para
   * mandar a "Mi cuenta" a quien todavía trae la contraseña que le puso el
   * administrador —sin volver a mandarlo cuando ya está ahí, que sería un
   * ciclo—. Se la pasamos en una cabecera de la petición.
   */
  const cabeceras = new Headers(request.headers);
  cabeceras.set('x-ruta', pathname);
  const seguir = () => NextResponse.next({ request: { headers: cabeceras } });

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

  return seguir();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
