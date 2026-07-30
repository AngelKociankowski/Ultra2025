import { NextResponse } from 'next/server';
import { conPermiso, leerJson } from '@/lib/api';
import { getDb, auditar } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { ROLES } from '@/lib/rbac';
import { ValidacionError } from '@/lib/servicios';

export const dynamic = 'force-dynamic';

export const GET = conPermiso('usuarios', async () => {
  const rows = getDb()
    .prepare('SELECT id, email, nombre, rol, activo, creado_en FROM usuarios ORDER BY rol, nombre')
    .all();
  return NextResponse.json({ usuarios: rows });
});

export const POST = conPermiso('usuarios', async (request, { usuario }) => {
  const { email, nombre, rol, password } = await leerJson(request);
  if (!email || !nombre || !rol || !password) {
    throw new ValidacionError('Correo, nombre, rol y contraseña son obligatorios.');
  }
  if (!ROLES[rol]) throw new ValidacionError('Rol no válido.');
  if (String(password).length < 8) throw new ValidacionError('La contraseña debe tener al menos 8 caracteres.');

  const db = getDb();
  const correo = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(correo)) {
    throw new ValidacionError('Ya existe un usuario con ese correo.');
  }

  const info = db
    .prepare('INSERT INTO usuarios (email, nombre, rol, password_hash) VALUES (?,?,?,?)')
    .run(correo, nombre, rol, hashPassword(password));

  auditar(db, {
    usuario,
    accion: 'crear_usuario',
    entidad: 'usuario',
    entidad_id: info.lastInsertRowid,
    detalle: `${nombre} <${correo}> como ${rol}`,
  });

  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
});

export const PATCH = conPermiso('usuarios', async (request, { usuario }) => {
  const { id, rol, activo, password } = await leerJson(request);
  if (!id) throw new ValidacionError('Falta el id del usuario.');
  const db = getDb();
  const actual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!actual) throw new ValidacionError('El usuario no existe.');

  const sets = [];
  const args = [];
  const detalle = [];
  if (rol !== undefined) {
    if (!ROLES[rol]) throw new ValidacionError('Rol no válido.');
    sets.push('rol = ?'); args.push(rol); detalle.push(`rol → ${rol}`);
  }
  if (activo !== undefined) {
    if (Number(id) === Number(usuario.id) && !activo) {
      throw new ValidacionError('No puedes desactivar tu propia cuenta.');
    }
    sets.push('activo = ?'); args.push(activo ? 1 : 0); detalle.push(activo ? 'activado' : 'desactivado');
  }
  if (password) {
    if (String(password).length < 8) throw new ValidacionError('La contraseña debe tener al menos 8 caracteres.');
    sets.push('password_hash = ?'); args.push(hashPassword(password)); detalle.push('contraseña restablecida');
  }
  if (!sets.length) throw new ValidacionError('Nada que actualizar.');

  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  if (activo === false) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);

  auditar(db, {
    usuario,
    accion: 'editar_usuario',
    entidad: 'usuario',
    entidad_id: Number(id),
    detalle: `${actual.nombre}: ${detalle.join(', ')}`,
  });

  return NextResponse.json({ ok: true });
});
