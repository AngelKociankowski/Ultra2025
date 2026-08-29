import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Qué versión está corriendo de verdad.
 *
 *   GET /api/version
 *
 * Existe por una tarde perdida. Se reportó la plataforma caída y después a
 * medias —el menú sin responder, una gráfica en blanco— y desde fuera no había
 * manera de saber si el servidor estaba sirviendo el código recién subido o uno
 * de tres versiones atrás. Se comprobaron el build, las pruebas, la memoria y
 * las cabeceras de caché, todo sano, para acabar sospechando de lo único que no
 * se podía mirar.
 *
 * Con esto se mira: se abre esta dirección y dice el commit. Si no coincide con
 * el último de `main`, el problema es el despliegue y no hay nada que buscar en
 * el código.
 *
 * No pide sesión a propósito: cuando algo está roto, quien pregunta puede ser
 * justo quien no logra entrar. Y no revela nada que no sea público —el commit
 * ya está en el repositorio— ni toca la base de datos, así que sigue
 * contestando aunque la base sea el problema.
 */
export async function GET() {
  return NextResponse.json({
    // Render la publica sola. En otro proveedor se pasa al construir.
    commit: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || 'sin marcar',
    rama: process.env.RENDER_GIT_BRANCH || null,
    arrancado: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
    horasEnPie: Math.round((process.uptime() / 3600) * 10) / 10,
    node: process.version,
  });
}
