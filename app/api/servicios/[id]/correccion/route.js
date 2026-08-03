import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { registrarCorreccion, listarCorrecciones } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

/**
 * Correcciones de captura sobre un servicio. Reservado a admin.
 *
 * Va en su propia ruta y no en el PATCH del servicio a propósito: el PATCH
 * normal tiene bloqueados el nombre, el estatus y el total de guardias, y esa
 * regla debe seguir valiendo para todos los roles. Corregir es otra operación,
 * con otro permiso y otro registro.
 */
export const POST = conPermiso('corregir', async (request, { params, usuario }) => {
  const body = await leerJson(request);
  const resultado = registrarCorreccion(params.id, body, usuario);
  return NextResponse.json(resultado, { status: resultado.sinCambios ? 200 : 201 });
});

export const GET = conPermiso('corregir', async (request, { params }) =>
  NextResponse.json({ correcciones: listarCorrecciones(params.id) })
);
