import { NextResponse } from 'next/server';
import { usuarioActual } from './auth';
import { puede } from './rbac';
import { ValidacionError, PermisoError } from './servicios';
import { respuestaSinEspacio } from './errores';

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
      const lleno = sinEspacio(err);
      if (lleno) return lleno;
      console.error('[api]', err);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
  };
}

/**
 * La respuesta a una escritura que se topó con el disco lleno, o `null` si el
 * error es otra cosa.
 *
 * Antes esto caía en el 500 de abajo: subir el PDF de un contrato contestaba
 * «Error interno del servidor» y nadie sabía que el problema era el disco. Se
 * deja en la bitácora del servidor con su propia etiqueta, porque es la línea
 * que alguien va a buscar cuando le digan «no me deja subir nada».
 *
 * Se exporta para las tres rutas que escriben sin pasar por `conPermiso()`.
 */
export function sinEspacio(err) {
  const r = respuestaSinEspacio(err);
  if (!r) return null;
  console.error('[disco] sin espacio:', err.code || 'comprobado antes de escribir', '·', err.message);
  return NextResponse.json(r.cuerpo, { status: r.status });
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
