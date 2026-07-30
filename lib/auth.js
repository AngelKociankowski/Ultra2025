import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getDb, auditar } from './db';

const COOKIE = 'ultra_session';
const DIAS_SESION = 7;

// ------------------------------------------------------------- contraseñas

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verificarPassword(password, almacenado) {
  if (!almacenado) return false;
  const [algo, salt, hash] = String(almacenado).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

// ---------------------------------------------------------------- sesiones

export function crearSesion(usuarioId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESION * 864e5).toISOString();
  db.prepare('INSERT INTO sesiones (token, usuario_id, expira_en) VALUES (?, ?, ?)').run(token, usuarioId, expira);
  db.prepare("DELETE FROM sesiones WHERE expira_en < datetime('now')").run();
  return { token, expira };
}

export function destruirSesion(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sesiones WHERE token = ?').run(token);
}

/** Usuario de la petición actual, o null. */
export function usuarioActual() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.nombre, u.rol
         FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expira_en > datetime('now') AND u.activo = 1`
    )
    .get(token);
  return row || null;
}

/** Lanza si no hay sesión. Para uso en páginas y rutas de API. */
export function requerirUsuario() {
  const u = usuarioActual();
  if (!u) throw new NoAutenticado('Sesión no válida.');
  return u;
}

export class NoAutenticado extends Error {}

export const COOKIE_SESION = COOKIE;
export const MAX_AGE_SESION = DIAS_SESION * 86400;

// ----------------------------------------------------------------- login

export function autenticar(email, password) {
  const db = getDb();
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(String(email || '').trim().toLowerCase());
  if (!u || !verificarPassword(password, u.password_hash)) return null;
  const { token, expira } = crearSesion(u.id);
  auditar(db, {
    usuario: u,
    accion: 'login',
    entidad: 'usuario',
    entidad_id: u.id,
    detalle: `Inicio de sesión (${u.rol})`,
  });
  return { token, expira, usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol } };
}
