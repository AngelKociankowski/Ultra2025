import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { estadoAlDia, movimientosDelDia, contrasteConCorte, comoDia } from '@/lib/dias';

export const dynamic = 'force-dynamic';

/**
 * El estado de fuerza a una fecha.
 *
 *   GET /api/estado-fuerza/dia?dia=2026-07-31
 *
 * Devuelve los servicios que estaban en la calle ese día, con la plantilla
 * corregida hacia atrás hasta donde los movimientos lo permiten, y —esto es lo
 * que la hace utilizable— el detalle de qué parte del número es exacta:
 *
 *   `exactitud`  a cuántos servicios se les revirtió un movimiento y a cuántos
 *                se les está enseñando la plantilla de hoy.
 *   `limite`     desde qué fecha la reconstrucción es de fiar, y
 *   `fueraDeAlcance` si la que se pidió quedó antes. Más atrás del último corte
 *                faltan los servicios cancelados antes de que se cargara el
 *                histórico, así que el total sale corto sin avisar.
 *   `contraste`  la comparación contra el corte guardado de ese mes, cuando la
 *                fecha es el último día del mes. Es la comprobación del método:
 *                si no cuadra con la foto contra la que se facturó, hay que
 *                saberlo antes de usar la cifra.
 *
 * Existe aparte de la pantalla porque el número tiene que poder comprobarse sin
 * leer HTML: una cifra que solo se puede verificar mirándola no está verificada.
 */
export const GET = conPermiso('ver', async (request) => {
  const pedido = new URL(request.url).searchParams.get('dia');
  const dia = comoDia(pedido);
  if (!dia) {
    return NextResponse.json(
      { error: `La fecha «${pedido ?? ''}» no existe. Va como AAAA-MM-DD.` },
      { status: 400 }
    );
  }

  const { servicios, exactitud, fueraDeAlcance, limite } = estadoAlDia(dia);
  const guardias = servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);

  return NextResponse.json({
    dia,
    total: { servicios: servicios.length, guardias },
    // Hasta dónde llega la reconstrucción, y si esta fecha se salió. Va en la
    // respuesta y no solo en la pantalla: quien consuma esta API tiene el mismo
    // derecho a saber que el número se queda corto.
    fueraDeAlcance,
    limite,
    exactitud,
    contraste: contrasteConCorte(dia, guardias, servicios.length),
    movimientos: movimientosDelDia(dia),
    servicios,
  });
});
