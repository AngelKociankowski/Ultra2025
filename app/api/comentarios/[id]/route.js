import { NextResponse } from 'next/server';
import { conPermiso } from '@/lib/api';
import { eliminarComentario } from '@/lib/comentarios';

export const dynamic = 'force-dynamic';

/**
 * Borrar un comentario. El permiso fino —autor o administrador— lo resuelve
 * lib/comentarios.js; aquí solo se exige tener sesión.
 */
export const DELETE = conPermiso('ver', async (request, { params, usuario }) => {
  return NextResponse.json(eliminarComentario(params.id, usuario));
});

/**
 * Un comentario no se edita: una nota corregida después deja de ser registro de
 * lo que se dijo. Si hace falta rectificar, se borra y se escribe otra.
 */
export async function PATCH() {
  return NextResponse.json(
    { error: 'Un comentario no se edita. Bórralo y escribe uno nuevo.' },
    { status: 405 }
  );
}
