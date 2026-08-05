import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { agenda, aplicar, historialReciente } from '@/lib/precios';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('precios', async (request) => {
  const p = new URL(request.url).searchParams;
  if (p.get('historial')) return NextResponse.json({ historial: historialReciente(Number(p.get('historial')) || 60) });
  return NextResponse.json(
    agenda({
      estado: p.get('estado') || '',
      zona: p.get('zona') || '',
      asesor: p.get('asesor') || '',
      q: p.get('q') || '',
    })
  );
});

/**
 * Sube el precio. Con `simular` devuelve las cuentas sin guardar nada.
 *
 * La pantalla ya enseña una vista previa calculada en el navegador —es
 * aritmética y así se ve al instante—, pero el que manda es este: aquí se
 * vuelven a leer los precios de la base y se recalcula todo. Lo que llega del
 * navegador es la instrucción, nunca el resultado.
 */
export const POST = conPermiso('precios', async (request, { usuario }) => {
  const cuerpo = await leerJson(request);
  const salida = aplicar(cuerpo, usuario);
  return NextResponse.json(salida, { status: cuerpo.simular ? 200 : 201 });
});
