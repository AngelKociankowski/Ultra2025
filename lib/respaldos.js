/**
 * Respaldos.
 *
 * La plataforma vive en un servidor con un disco. Mientras ese disco esté bien,
 * todo está bien; el día que no lo esté, sin respaldos no hay a dónde volver.
 * Ese es el único riesgo real que le queda a esta instalación, y esto es lo que
 * lo cierra.
 *
 * Un respaldo es UN archivo .zip con las dos cosas que importan:
 *
 *   - `ultra.db`, la base entera —servicios, movimientos, cobranza, usuarios,
 *     bitácora—, sacada con VACUUM INTO. Eso da una copia consistente aunque
 *     alguien esté capturando en ese momento: no es copiar el archivo a lo
 *     bruto y rezar.
 *   - `archivos/`, los PDF y XML de las facturas, que viven en el disco y no
 *     dentro de la base. Un respaldo que solo trajera la base dejaría las
 *     facturas atrás, que es la mitad del expediente fiscal.
 *
 * Y un `respaldo.json` con qué había adentro el día que se hizo. Sirve para dos
 * cosas: verlo en la pantalla sin abrir el zip, y para que al restaurar la
 * plataforma pueda decir «esto que me estás dando tiene 219 servicios y 2,600
 * facturas» antes de tocar nada.
 *
 * Dos maneras de que existan, y las dos hacen falta:
 *   - Solo: una copia diaria automática que se queda en el servidor. Protege de
 *     un error de captura, de una carga que salió mal, de un borrado.
 *   - Bajado: el administrador se lo lleva a su computadora. Es el único que
 *     protege de que el servidor se pierda, porque es el único que no está en
 *     el servidor.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, cerrarDb, auditar } from './db';
import { escribirZipAArchivo, leerZip } from './zip';
import { ValidacionError } from './errores';
import { hoy } from './fechas';

/** Días de respaldos diarios que se guardan completos antes de ralear. */
export const DIAS_DIARIOS = 14;
/** Meses de los que se guarda un respaldo, ya raleados. */
export const MESES_MENSUALES = 12;
/** Cada cuánto uno de los automáticos se lleva también los PDF. */
export const DIAS_ENTRE_COMPLETOS = 7;

const MOTIVOS = {
  automatico: 'Automático',
  manual: 'A mano',
  'antes-de-restaurar': 'Antes de restaurar',
};

function rutaBase() {
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ultra.db');
}

function carpetaDatos() {
  return path.dirname(rutaBase());
}

export function carpeta() {
  const dir = path.join(carpetaDatos(), 'respaldos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function carpetaArchivos() {
  const dir = path.join(carpetaDatos(), 'archivos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * El nombre lo arma la plataforma y solo se acepta si tiene esta forma exacta.
 * Un nombre que venga de fuera nunca se pega a una ruta sin pasar por aquí: es
 * la vía más corta para que alguien pida `../../algo` y se lleve lo que no es.
 */
const NOMBRE = /^respaldo-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-(automatico|manual|antes-de-restaurar)-(completo|base)\.zip$/;

function exigirNombre(nombre) {
  const n = String(nombre || '');
  if (!NOMBRE.test(n)) throw new ValidacionError('Ese respaldo no existe.');
  return n;
}

function marca(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function conteos(db) {
  const uno = (sql) => {
    try {
      return db.prepare(sql).get().n;
    } catch {
      return 0;
    }
  };
  return {
    servicios: uno("SELECT COUNT(*) AS n FROM servicios WHERE estatus = 'ACTIVO'"),
    servicios_total: uno('SELECT COUNT(*) AS n FROM servicios'),
    guardias: uno("SELECT COALESCE(SUM(total_guardias), 0) AS n FROM servicios WHERE estatus = 'ACTIVO'"),
    aperturas: uno('SELECT COUNT(*) AS n FROM aperturas'),
    cancelaciones: uno('SELECT COUNT(*) AS n FROM cancelaciones'),
    facturas: uno('SELECT COUNT(*) AS n FROM facturas'),
    usuarios: uno('SELECT COUNT(*) AS n FROM usuarios'),
    bitacora: uno('SELECT COUNT(*) AS n FROM bitacora'),
  };
}

// ------------------------------------------------------------------- crear

/**
 * ¿Este respaldo se lleva también los PDF de las facturas?
 *
 * Los adjuntos son la parte pesada y la que nunca cambia: un PDF, una vez
 * subido, no se vuelve a tocar. Meterlos en la copia de todos los días sería
 * escribir los mismos cientos de megabytes catorce veces para guardar lo mismo,
 * y con eso se llena el disco del servidor en un año.
 *
 * Entonces: los diarios automáticos llevan solo la base, que es lo que cambia a
 * diario y pesa poco. Una vez por semana —y siempre que el respaldo lo pida una
 * persona, porque ese es el que se va a bajar— se hace uno completo.
 */
function decidirArchivos(motivo, forzar) {
  if (forzar !== undefined) return !!forzar;
  if (motivo !== 'automatico') return true; // manual y antes-de-restaurar: completos
  const ultimoCompleto = listar().find((r) => r.completo);
  if (!ultimoCompleto) return true;
  return Date.now() - new Date(ultimoCompleto.creado_en).getTime() >= DIAS_ENTRE_COMPLETOS * 86400000;
}

/**
 * Arma un respaldo y lo deja en el disco. Devuelve con qué quedó.
 *
 * La copia de la base se hace con VACUUM INTO sobre un archivo temporal: SQLite
 * la escribe consistente aunque haya escrituras en curso, y de paso sale
 * compactada. Copiar `ultra.db` a mano mientras el WAL tiene cambios sin
 * consolidar daría un archivo a medias, que es la peor clase de respaldo: uno
 * que parece existir.
 */
export function crear({ motivo = 'manual', usuario = null, conArchivos } = {}) {
  if (!MOTIVOS[motivo]) throw new ValidacionError('Motivo de respaldo desconocido.');
  const db = getDb();
  const dir = carpeta();
  const completo = decidirArchivos(motivo, conArchivos);
  const nombre = `respaldo-${marca()}-${motivo}-${completo ? 'completo' : 'base'}.zip`;
  const destino = path.join(dir, nombre);
  const temporal = path.join(dir, `.copia-${process.pid}-${Date.now()}.db`);

  try {
    fs.rmSync(temporal, { force: true });
    db.prepare('VACUUM INTO ?').run(temporal);
    const baseBytes = fs.statSync(temporal).size;

    /**
     * Las entradas se apuntan por ruta, no por contenido.
     *
     * Antes se leía la base y CADA PDF a memoria antes de empezar a comprimir,
     * y el ZIP se armaba entero en memoria antes de tocar el disco: el pico era
     * como tres veces todo lo que hubiera guardado. Este respaldo lo dispara
     * sola la plataforma cada día, sin que nadie mire, y en un servidor de 512
     * MB terminaba de una sola manera —el sistema mata el proceso—. No es una
     * excepción que se pueda atrapar: el servidor desaparece y quien estuviera
     * navegando recibe un 502, sin nada en la bitácora que lo explique.
     *
     * Ahora las lee de una en una y las va soltando al disco.
     */
    const entradas = [{ nombre: 'ultra.db', ruta: temporal }];
    if (completo) {
      const origen = carpetaArchivos();
      for (const f of fs.readdirSync(origen)) {
        const ruta = path.join(origen, f);
        if (fs.statSync(ruta).isFile()) entradas.push({ nombre: `archivos/${f}`, ruta });
      }
    }

    const manifiesto = {
      plataforma: 'Ultra Seguridad Privada — Plataforma de Guardias',
      creado_en: new Date().toISOString(),
      fecha: hoy(),
      motivo,
      completo,
      creado_por: usuario?.nombre || usuario?.email || 'la plataforma',
      base_bytes: baseBytes,
      archivos: entradas.length - 1,
      conteos: conteos(db),
    };
    entradas.push({ nombre: 'respaldo.json', datos: Buffer.from(JSON.stringify(manifiesto, null, 2), 'utf8') });

    escribirZipAArchivo(destino, entradas);
  } finally {
    fs.rmSync(temporal, { force: true });
  }

  const bytes = fs.statSync(destino).size;
  if (usuario) {
    auditar(db, {
      usuario,
      accion: 'respaldo',
      entidad: 'sistema',
      entidad_id: null,
      detalle: `${nombre} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
    });
  }

  const borrados = depurar();
  return { nombre, bytes, completo, borrados };
}

// ----------------------------------------------------------------- consultar

export function listar() {
  const dir = carpeta();
  return fs
    .readdirSync(dir)
    .map((nombre) => [nombre, NOMBRE.exec(nombre)])
    .filter(([, m]) => m)
    .map(([nombre, [, fecha, hh, mm, motivo, alcance]]) => {
      const st = fs.statSync(path.join(dir, nombre));
      return {
        nombre,
        fecha,
        hora: `${hh}:${mm}`,
        motivo,
        motivoTexto: MOTIVOS[motivo] || motivo,
        completo: alcance === 'completo',
        alcanceTexto: alcance === 'completo' ? 'Base + facturas' : 'Solo la base',
        bytes: st.size,
        creado_en: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
}

export function leer(nombre) {
  const n = exigirNombre(nombre);
  const ruta = path.join(carpeta(), n);
  if (!fs.existsSync(ruta)) throw new ValidacionError('Ese respaldo ya no está en el servidor.');
  return { nombre: n, datos: fs.readFileSync(ruta) };
}

/**
 * Qué tan protegida está la operación ahorita. Lo consume la pantalla para
 * avisar cuando el último respaldo se está quedando viejo, que es la única
 * forma de que un respaldo automático que dejó de correr se note a tiempo.
 */
export function estado() {
  const todos = listar();
  const ultimo = todos[0] || null;
  // El que conviene bajarse es el último completo: el que también trae los PDF.
  const ultimoCompleto = todos.find((r) => r.completo) || null;
  const dias = (r) => (r ? Math.floor((Date.now() - new Date(r.creado_en).getTime()) / 86400000) : null);
  const d = dias(ultimo);
  return {
    ultimo,
    ultimoCompleto,
    total: todos.length,
    bytes: todos.reduce((a, r) => a + r.bytes, 0),
    dias: d,
    diasCompleto: dias(ultimoCompleto),
    alDia: d !== null && d <= 2,
  };
}

// ---------------------------------------------------------------- depurar

/**
 * Ralea los viejos para que el disco no se llene solo.
 *
 * Los últimos catorce días quedan completos, porque un error de captura se
 * descubre a los pocos días. De ahí para atrás se guarda uno por mes, un año:
 * a esa distancia lo que se quiere recuperar es «cómo estaba la operación en
 * marzo», no la versión de las 3 de la tarde.
 *
 * Dos que nunca se borran solos: el que se hizo antes de restaurar —es
 * exactamente el que uno va a querer si la restauración fue el error— y el
 * último completo, porque es el único que todavía tiene los PDF de las
 * facturas.
 */
export function depurar() {
  const dir = carpeta();
  const todos = listar();
  const corte = Date.now() - DIAS_DIARIOS * 86400000;
  const intocable = todos.find((r) => r.completo)?.nombre;
  const mesesVistos = new Set();
  const borrados = [];

  for (const r of todos) {
    if (r.motivo === 'antes-de-restaurar') continue;
    if (r.nombre === intocable) continue;
    if (new Date(r.creado_en).getTime() >= corte) continue;

    const mes = r.fecha.slice(0, 7);
    const edadMeses = (Date.now() - new Date(r.creado_en).getTime()) / (30 * 86400000);
    // `todos` viene del más nuevo al más viejo, así que el primero de cada mes
    // que se encuentra es el más reciente de ese mes: ese es el que se queda.
    if (!mesesVistos.has(mes) && edadMeses <= MESES_MENSUALES) {
      mesesVistos.add(mes);
      continue;
    }
    fs.rmSync(path.join(dir, r.nombre), { force: true });
    borrados.push(r.nombre);
  }
  return borrados;
}

export function borrar(nombre, usuario) {
  const n = exigirNombre(nombre);
  const ruta = path.join(carpeta(), n);
  if (!fs.existsSync(ruta)) throw new ValidacionError('Ese respaldo ya no está en el servidor.');
  fs.rmSync(ruta, { force: true });
  auditar(getDb(), { usuario, accion: 'respaldo_borrado', entidad: 'sistema', entidad_id: null, detalle: n });
  return { nombre: n };
}

// --------------------------------------------------------------- restaurar

/**
 * Deja la plataforma como estaba el día de ese respaldo.
 *
 * Esta es la operación más destructiva que existe aquí: reemplaza la base
 * completa. Por eso el orden importa y no se puede acortar:
 *
 *   1. Se abre y se verifica el zip ANTES de tocar nada. Si viene dañado, o si
 *      la base que trae no pasa la revisión de integridad de SQLite, se rechaza
 *      y la operación sigue como estaba.
 *   2. Se hace un respaldo de lo que hay ahora mismo. Si restaurar fue un
 *      error, ese archivo es la vuelta atrás.
 *   3. Hasta entonces se cierra la base y se reemplazan los archivos.
 */
export function restaurar(buffer, usuario, { confirmacion } = {}) {
  if (String(confirmacion || '').trim().toUpperCase() !== 'RESTAURAR') {
    throw new ValidacionError('Para restaurar hay que escribir la palabra RESTAURAR. Es a propósito.');
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ValidacionError('No llegó ningún archivo.');

  let entradas;
  try {
    entradas = leerZip(buffer);
  } catch (e) {
    throw new ValidacionError(`Ese archivo no se puede leer como respaldo: ${e.message}`);
  }

  const base = entradas.find((e) => e.nombre === 'ultra.db');
  if (!base) throw new ValidacionError('El archivo no trae la base de datos: no es un respaldo de esta plataforma.');
  const manifiesto = entradas.find((e) => e.nombre === 'respaldo.json');
  let info = null;
  try {
    info = manifiesto ? JSON.parse(manifiesto.datos.toString('utf8')) : null;
  } catch {
    info = null;
  }

  // Se revisa la base traída, en un archivo aparte, antes de darle su lugar.
  const dir = carpeta();
  const candidata = path.join(dir, `.entrante-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(candidata, base.datos);
  try {
    const prueba = new Database(candidata, { readonly: true });
    try {
      const integridad = prueba.pragma('integrity_check', { simple: true });
      if (integridad !== 'ok') throw new ValidacionError(`La base del respaldo está dañada: ${integridad}`);
      const tablas = prueba
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
      for (const t of ['servicios', 'aperturas', 'usuarios']) {
        if (!tablas.includes(t)) {
          throw new ValidacionError(`El respaldo no trae la tabla «${t}»: no es de esta plataforma.`);
        }
      }
      if (prueba.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
        throw new ValidacionError('El respaldo no trae ningún usuario: nadie podría entrar después de restaurarlo.');
      }
    } finally {
      prueba.close();
    }

    // Red de seguridad: lo que hay ahora, completo —con los PDF— porque es la
    // última oportunidad de conservarlo antes de reemplazar la base.
    const previo = crear({ motivo: 'antes-de-restaurar', usuario: null, conArchivos: true });

    const destino = rutaBase();
    cerrarDb();
    fs.rmSync(`${destino}-wal`, { force: true });
    fs.rmSync(`${destino}-shm`, { force: true });
    fs.copyFileSync(candidata, destino);

    // Los adjuntos se reponen sin borrar los que ya estaban: si el respaldo es
    // viejo, las facturas subidas después siguen ahí y sus PDF no se pierden.
    const aArchivos = carpetaArchivos();
    let repuestos = 0;
    for (const e of entradas) {
      if (!e.nombre.startsWith('archivos/')) continue;
      const solo = path.basename(e.nombre);
      if (!solo || solo.startsWith('.')) continue;
      fs.writeFileSync(path.join(aArchivos, solo), e.datos);
      repuestos++;
    }

    const db = getDb();
    auditar(db, {
      usuario,
      accion: 'restauracion',
      entidad: 'sistema',
      entidad_id: null,
      detalle: `Restaurado el respaldo del ${info?.fecha || 'origen desconocido'} · ${repuestos} archivos · respaldo previo ${previo.nombre}`,
    });

    return {
      restaurado: info,
      repuestos,
      // Un respaldo de solo base no trae los PDF, y eso hay que decirlo: los que
      // estén en el disco siguen ahí, pero los de un servidor perdido no vuelven.
      traiaArchivos: entradas.some((e) => e.nombre.startsWith('archivos/')),
      respaldoPrevio: previo.nombre,
      conteos: conteos(db),
    };
  } finally {
    fs.rmSync(candidata, { force: true });
  }
}
