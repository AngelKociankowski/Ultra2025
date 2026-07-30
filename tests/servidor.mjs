/**
 * Arranca la aplicación real contra una base desechable y devuelve un cliente.
 *
 * Las pruebas van contra el servidor de verdad, no contra funciones sueltas: la
 * regla del negocio vive repartida entre las rutas de API, el RBAC y
 * lib/servicios.js, y solo probando el conjunto se comprueba que nadie pueda
 * saltársela por otro camino.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
export const PASSWORD = 'UltraGuardias2026';

function ejecutar(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: RAIZ, env: { ...process.env, ...env }, stdio: 'pipe' });
    let salida = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (salida += d));
    p.on('close', (code) => (code === 0 ? resolve(salida) : reject(new Error(`${cmd} salió con ${code}:\n${salida}`))));
  });
}

async function esperar(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* todavía no levanta */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`El servidor no respondió en ${url}`);
}

export async function arrancar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-test-'));
  const dbPath = path.join(dir, 'prueba.db');
  const puerto = 3000 + Math.floor(Math.random() * 2000);
  const env = { DATABASE_PATH: dbPath, PORT: String(puerto), NODE_ENV: 'production' };

  await ejecutar('node', ['scripts/seed.mjs', '--reset'], env);

  if (!fs.existsSync(path.join(RAIZ, '.next', 'BUILD_ID'))) {
    throw new Error('Falta compilar. Corre `npm run build` antes de las pruebas.');
  }

  const proc = spawn('node', [path.join(RAIZ, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start'], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });

  const base = `http://127.0.0.1:${puerto}`;
  try {
    await esperar(`${base}/login`);
  } catch (e) {
    proc.kill('SIGKILL');
    throw e;
  }

  /** Cliente con cookies por sesión: cada rol se autentica por separado. */
  const cliente = (cookie = '') => ({
    cookie,
    async pedir(ruta, opciones = {}) {
      const r = await fetch(base + ruta, {
        ...opciones,
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cookie ? { cookie: this.cookie } : {}),
          ...(opciones.headers || {}),
        },
      });
      const texto = await r.text();
      let json = null;
      try {
        json = JSON.parse(texto);
      } catch {
        /* HTML */
      }
      return { status: r.status, json, texto, headers: r.headers };
    },
  });

  async function entrar(email) {
    const c = cliente();
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const set = r.headers.getSetCookie?.() || [];
    c.cookie = set.map((s) => s.split(';')[0]).join('; ');
    if (r.status !== 200) throw new Error(`No se pudo entrar como ${email}: ${r.status}`);
    return c;
  }

  return {
    base,
    entrar,
    anonimo: () => cliente(),
    async cerrar() {
      proc.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const ROLES = {
  admin: 'admin@corporativoultra.com',
  juridico: 'juridico@corporativoultra.com',
  finanzas: 'finanzas@corporativoultra.com',
  operaciones: 'operaciones@corporativoultra.com',
  ventas: 'ventas@corporativoultra.com',
};
