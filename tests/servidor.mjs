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
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');

/** La que pone quien da de alta: nace prestada y hay que cambiarla al entrar. */
export const PASSWORD_TEMPORAL = 'UltraGuardias2026';
/** La que cada cuenta se pone a sí misma, y con la que trabajan las pruebas. */
export const PASSWORD = 'PruebaUltra2026';

/**
 * El alta inicial crea solo al primer administrador. Los demás roles los crea
 * él, que es justo como funciona en producción: si esa alta se rompiera, estas
 * pruebas no podrían ni empezar.
 */
export const ROLES = {
  admin: 'angelk@corporativoultra.com',
  juridico: 'juridico@corporativoultra.com',
  finanzas: 'finanzas@corporativoultra.com',
  operaciones: 'operaciones@corporativoultra.com',
  ventas: 'ventas@corporativoultra.com',
};

const EQUIPO = [
  ['juridico', 'Jurídico de prueba'],
  ['finanzas', 'Finanzas de prueba'],
  ['operaciones', 'Operaciones de prueba'],
  ['ventas', 'Ventas de prueba'],
];

function ejecutar(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: RAIZ, env: { ...process.env, ...env }, stdio: 'pipe' });
    let salida = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (salida += d));
    p.on('close', (code) => (code === 0 ? resolve(salida) : reject(new Error(`${cmd} salió con ${code}:\n${salida}`))));
  });
}

/**
 * Un puerto que el sistema operativo confirma libre, en lugar de uno al azar.
 *
 * Antes se elegía con Math.random() entre 3000 y 5000. Con catorce archivos de
 * prueba levantando su propio servidor, tarde o temprano dos escogen el mismo:
 * el segundo muere con EADDRINUSE, su `before` revienta y todas las pruebas de
 * ese archivo salen canceladas. No falla ninguna —el reporte dice «fail 0»—
 * pero la corrida termina en rojo, y el rojo no es del código.
 *
 * Pedirlo al sistema deja una carrera diminuta entre cerrar este socket y que
 * Next abra el suyo; el reintento de abajo cubre ese resto.
 */
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Espera a que responda, y se rinde en cuanto el proceso muere.
 *
 * Sin mirar al proceso, un servidor que no arrancó costaba treinta segundos de
 * reintentos contra un puerto donde ya no había nadie, y el error final no
 * decía por qué.
 */
async function esperar(url, proc, intentos = 180) {
  for (let i = 0; i < intentos; i++) {
    if (proc.exitCode !== null || proc.signalCode) {
      throw new Error(`El servidor se cayó al arrancar (${proc.exitCode ?? proc.signalCode}): ${proc.salida.slice(-500)}`);
    }
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
  const envBase = { DATABASE_PATH: dbPath, NODE_ENV: 'production' };

  await ejecutar('node', ['scripts/seed.mjs', '--reset'], envBase);

  if (!fs.existsSync(path.join(RAIZ, '.next', 'BUILD_ID'))) {
    throw new Error('Falta compilar. Corre `npm run build` antes de las pruebas.');
  }

  // Tres intentos: si el puerto se lo ganó otro entre que lo soltamos y que
  // Next lo abre, se pide otro en lugar de tumbar el archivo entero.
  let proc;
  let base;
  let ultimo;
  for (let intento = 1; intento <= 3; intento++) {
    const puerto = await puertoLibre();
    const env = { ...envBase, PORT: String(puerto) };
    proc = spawn('node', [path.join(RAIZ, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start'], {
      cwd: RAIZ,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Se guarda la salida para que el error diga qué pasó y no solo que no hubo
    // respuesta.
    proc.salida = '';
    proc.stdout.on('data', (d) => (proc.salida += d));
    proc.stderr.on('data', (d) => (proc.salida += d));

    base = `http://127.0.0.1:${puerto}`;
    try {
      await esperar(`${base}/login`, proc);
      ultimo = null;
      break;
    } catch (e) {
      ultimo = e;
      proc.kill('SIGKILL');
      proc = null;
    }
  }
  if (ultimo) throw ultimo;

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

  async function entrar(email, password = PASSWORD) {
    const c = cliente();
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const set = r.headers.getSetCookie?.() || [];
    c.cookie = set.map((s) => s.split(';')[0]).join('; ');
    if (r.status !== 200) throw new Error(`No se pudo entrar como ${email}: ${r.status}`);
    return c;
  }

  /**
   * Deja la cuenta lista para trabajar. Si la contraseña ya es la definitiva
   * entra directo; si todavía es la prestada, la cambia primero. Así las
   * pruebas no tienen que llevar la cuenta de en qué estado está cada cuenta.
   */
  async function entrarYAsentar(email) {
    try {
      return await entrar(email, PASSWORD);
    } catch {
      const c = await entrar(email, PASSWORD_TEMPORAL);
      await c.pedir('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
      });
      return entrar(email, PASSWORD);
    }
  }

  // El administrador inicial nace con la contraseña prestada.
  const admin = await entrar(ROLES.admin, PASSWORD_TEMPORAL);
  await admin.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });

  // …y desde ahí da de alta al resto del equipo.
  const adminListo = await entrar(ROLES.admin, PASSWORD);
  for (const [rol, nombre] of EQUIPO) {
    const r = await adminListo.pedir('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify({ email: ROLES[rol], nombre, rol, password: PASSWORD_TEMPORAL }),
    });
    if (r.status !== 201) throw new Error(`No se pudo crear al usuario ${rol}: ${r.status} ${r.texto}`);
  }

  return {
    base,
    // La carpeta de datos del servidor de prueba. Se expone para las pruebas
    // que necesitan mirar —o dejar— archivos que no pasan por la API: los
    // adjuntos de las facturas viven en el disco, no dentro de la base.
    carpetaDatos: dir,
    entrar,
    entrarYAsentar,
    anonimo: () => cliente(),
    async cerrar() {
      proc.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 300));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
