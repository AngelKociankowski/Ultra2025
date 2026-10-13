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

/**
 * El cuerpo de la petición, exigiendo que sea un objeto con campos.
 *
 * `leerJson()` devuelve tal cual lo que venga, y `null`, `123`, `[]` o `"texto"`
 * son JSON perfectamente válido. Las rutas lo desestructuraban: con el cuerpo
 * `null`, `const { ids, motivo } = null` revienta y el cliente recibe un 500
 * «Error interno del servidor», que le dice que el fallo es nuestro cuando lo
 * que mandó no era un cuerpo. Y con el cuerpo `"texto"`, recorrer sus campos con
 * `Object.entries` da los índices de la cadena: la respuesta llegaba con
 * `rechazados: ['0','1','2','3','4']` y un 200, como si se hubiera intentado
 * capturar cinco campos llamados cero, uno, dos…
 *
 * Un 400 que dice qué se esperaba es la respuesta correcta a las dos cosas.
 */
export async function leerObjeto(request) {
  const cuerpo = await leerJson(request);
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw new ValidacionError('El cuerpo de la petición tiene que ser un objeto con los datos a guardar.');
  }
  return cuerpo;
}
