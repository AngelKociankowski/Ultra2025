import { NextResponse } from 'next/server';
import { requerirUsuario, hashPassword, verificarPassword, NoAutenticado, COOKIE_SESION } from '@/lib/auth';
import { getDb, auditar } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const MINIMO = 8;

/**
 * Cambio de contraseña propia. No depende del rol: cualquiera puede —y debe—
 * cambiar la que trae el alta inicial, que es la misma para las cinco cuentas
 * y está escrita en el README.
 *
 * Pide la contraseña actual aunque haya sesión: si alguien deja el equipo
 * abierto, que no baste con eso para quedarse con la cuenta. Al terminar se
 * cierran las demás sesiones del usuario y se conserva solo la actual.
 */
export async function POST(request) {
  try {
    const usuario = requerirUsuario();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Petición inválida.' }, { status: 400 });
    }

    const { actual, nueva } = body || {};
    if (!actual || !nueva) {
      return NextResponse.json({ error: 'Escribe tu contraseña actual y la nueva.' }, { status: 400 });
    }
    if (String(nueva).length < MINIMO) {
      return NextResponse.json({ error: `La contraseña debe tener al menos ${MINIMO} caracteres.` }, { status: 400 });
    }
    if (String(nueva) === String(actual)) {
      return NextResponse.json({ error: 'La contraseña nueva debe ser distinta de la actual.' }, { status: 400 });
    }

    const db = getDb();
    const fila = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(usuario.id);
    if (!verificarPassword(actual, fila?.password_hash)) {
      return NextResponse.json({ error: 'La contraseña actual no coincide.' }, { status: 401 });
    }

    const token = cookies().get(COOKIE_SESION)?.value || '';
    db.transaction(() => {
      db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(nueva), usuario.id);
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token <> ?').run(usuario.id, token);
    })();

    auditar(db, {
      usuario,
      accion: 'password',
      entidad: 'usuario',
      entidad_id: usuario.id,
      detalle: 'Cambió su contraseña; se cerraron sus demás sesiones',
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NoAutenticado) {
      return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
    }
    throw e;
  }
}
