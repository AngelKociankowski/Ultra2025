import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { puede } from '@/lib/rbac';
import { PermisoError, ValidacionError } from '@/lib/errores';
import {
  facturasDeServicio,
  resumenDe,
  registrarFactura,
  registrarPago,
  cancelarFactura,
  facturasVencidas,
} from '@/lib/facturacion';

export const dynamic = 'force-dynamic';

/**
 * Cobranza de un servicio, o la cartera vencida completa si no se pide uno.
 * Consultar es de cualquier rol; mover la cobranza es de finanzas y admin.
 */
export const GET = conPermiso('ver', async (request) => {
  const servicioId = new URL(request.url).searchParams.get('servicio_id');
  if (!servicioId) return NextResponse.json({ vencidas: facturasVencidas() });
  return NextResponse.json({
    facturas: facturasDeServicio(servicioId),
    resumen: resumenDe(servicioId),
  });
});

export const POST = conPermiso('editar_finanzas', async (request, { usuario }) =>
  NextResponse.json(registrarFactura(await leerJson(request), usuario), { status: 201 })
);

/**
 * Dos movimientos sobre una factura ya emitida:
 *   { id, pago: {...} }      -> entra dinero
 *   { id, cancelar: motivo } -> se anula una factura mal registrada (solo admin)
 */
export const PATCH = conPermiso('editar_finanzas', async (request, { usuario }) => {
  const cuerpo = await leerJson(request);
  if (!cuerpo.id) throw new ValidacionError('Falta el id de la factura.');

  if (cuerpo.cancelar !== undefined) {
    // Anular una factura es de la misma familia que corregir una captura: borra
    // un hecho que se había dado por bueno, así que lo hace quien puede corregir.
    if (!puede(usuario.rol, 'corregir')) {
      throw new PermisoError('Solo el administrador cancela una factura ya emitida.');
    }
    return NextResponse.json(cancelarFactura(cuerpo.id, cuerpo.cancelar, usuario));
  }

  return NextResponse.json(registrarPago({ ...(cuerpo.pago || cuerpo), factura_id: cuerpo.id }, usuario));
});
