import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { opciones, listarParaAdmin, crear, renombrar, alternar, eliminar, fusionar, adoptar } from '@/lib/catalogos';
import { ValidacionError, PermisoError } from '@/lib/errores';
import { puede } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Leer el catálogo lo puede cualquiera que entre: sin él no se puede ni pintar
 * un formulario de captura. Alimentarlo es solo del administrador, y por eso
 * las tres escrituras piden el permiso `catalogos`.
 *
 * Con ?detalle=1 va el catálogo completo —ids, desactivadas y cuántos servicios
 * usan cada una—, que es lo que necesita la pantalla del administrador y nadie
 * más.
 */
export const GET = conPermiso('ver', async (request, { usuario }) => {
  if (new URL(request.url).searchParams.get('detalle') !== '1') {
    return NextResponse.json(opciones());
  }
  if (!puede(usuario.rol, 'catalogos')) {
    throw new PermisoError('Solo el administrador consulta el catálogo completo.');
  }
  return NextResponse.json(listarParaAdmin());
});

export const POST = conPermiso('catalogos', async (request, { usuario }) => {
  const { tipo, valor } = await leerJson(request);
  return NextResponse.json(crear(tipo, valor, usuario), { status: 201 });
});

export const PATCH = conPermiso('catalogos', async (request, { usuario }) => {
  const { id, valor, activo, fusionarCon } = await leerJson(request);
  if (!id) throw new ValidacionError('Falta el id de la opción.');
  // La fusión va antes que el renombre: las dos llevan `id`, y confundirlas
  // dejaría una opción renombrada donde se pedía unir dos.
  if (fusionarCon !== undefined) return NextResponse.json(fusionar(id, fusionarCon, usuario));
  if (valor !== undefined) return NextResponse.json(renombrar(id, valor, usuario));
  if (activo !== undefined) return NextResponse.json(alternar(id, activo, usuario));
  throw new ValidacionError('Nada que actualizar.');
});

/** Adoptar un valor huérfano: convertirlo en opción sin volver a escribirlo. */
export const PUT = conPermiso('catalogos', async (request, { usuario }) => {
  const { tipo, valor } = await leerJson(request);
  return NextResponse.json(adoptar(tipo, valor, usuario), { status: 201 });
});

export const DELETE = conPermiso('catalogos', async (request, { usuario }) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw new ValidacionError('Falta el id de la opción.');
  return NextResponse.json(eliminar(id, usuario));
});
