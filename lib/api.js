import { NextResponse } from 'next/server';
import { usuarioActual } from './auth';
import { puede } from './rbac';
import { ValidacionError, PermisoError } from './servicios';

/**
 * Envuelve un handler de API: resuelve la sesión, verifica el permiso y
 * traduce los errores del dominio a códigos HTTP.
 */
export function conPermiso(permiso, handler) {
  return async (request, ctx) => {
    const usuario = usuarioActual();
    if (!usuario) {
      return NextResponse.json({ error: 'Sesión no válida. Inicia sesión de nuevo.' }, { status: 401 });
    }
    if (permiso && !puede(usuario.rol, permiso)) {
      return NextResponse.json(
        { error: `Tu rol (${usuario.rol}) no tiene permiso para esta acción.` },
        { status: 403 }
      );
    }
    try {
      return await handler(request, { ...ctx, usuario });
    } catch (err) {
      if (err instanceof ValidacionError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof PermisoError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      console.error('[api]', err);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
  };
}

export async function leerJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ValidacionError('Cuerpo de la petición inválido.');
  }
}
