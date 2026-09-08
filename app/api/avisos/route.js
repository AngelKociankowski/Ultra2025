import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { listar, marcarLeido, marcarTodosLeidos, sinLeer } from '@/lib/avisos';

export const dynamic = 'force-dynamic';

/**
 * Los avisos de quien pregunta, y solo los suyos.
 *
 * El permiso pedido es «ver», el más bajo que existe, y no uno propio: cualquier
 * cuenta que entra a la plataforma puede recibir un aviso, porque cualquiera
 * puede haber capturado el dato que alguien corrigió. Lo que acota no es el rol
 * sino el destinatario: la consulta filtra por el id de la sesión, así que no
 * hay manera de pedir los de otro.
 */
export const GET = conPermiso('ver', async (request, { usuario }) => {
  return NextResponse.json({
    avisos: listar(usuario.id),
    sinLeer: sinLeer(usuario.id),
  });
});

/**
 * Marcar como leído: uno, o todos.
 *
 * Va por POST y no por PATCH sobre cada aviso porque «ya los vi todos» es la
 * acción real: quien abre la pantalla los leyó, y obligarle a tocar quince
 * veces para vaciarla haría que dejara de abrirla.
 */
export const POST = conPermiso('ver', async (request, { usuario }) => {
  const body = await leerJson(request);
  if (body.todos) return NextResponse.json(marcarTodosLeidos(usuario.id));
  if (!body.id) return NextResponse.json({ error: 'Indica cuál aviso.' }, { status: 400 });
  return NextResponse.json(marcarLeido(body.id, usuario.id));
});
