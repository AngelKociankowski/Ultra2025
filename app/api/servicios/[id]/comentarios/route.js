import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { listarComentarios, agregarComentario, existeServicio } from '@/lib/comentarios';

export const dynamic = 'force-dynamic';

/**
 * Comentarios de un servicio. Basta el permiso de consulta: una nota no cambia
 * el estado de fuerza ni ninguna cifra, y el equipo que opera necesita poder
 * dejarse recados sobre un sitio aunque no le toque editar sus campos.
 */
export const GET = conPermiso('ver', async (request, { params }) => {
  // Sin esta comprobación, pedir los comentarios de un servicio inexistente
  // devolvía una lista vacía con 200: parecía que el servicio existe y no tiene
  // notas.
  if (!existeServicio(params.id)) {
    return NextResponse.json({ error: 'El servicio no existe.' }, { status: 404 });
  }
  return NextResponse.json({ comentarios: listarComentarios(params.id) });
});

export const POST = conPermiso('ver', async (request, { params, usuario }) => {
  const { texto } = await leerJson(request);
  const comentario = agregarComentario(params.id, texto, usuario);
  return NextResponse.json({ comentario }, { status: 201 });
});
