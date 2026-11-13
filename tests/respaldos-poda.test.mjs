/**
 * Los respaldos se podan solos, y nunca se quedan sin red.
 *
 * El disco de producción —un giga, compartido por la base, los adjuntos y los
 * respaldos— se llenó. Con el disco lleno no se puede hacer el respaldo, y como
 * la poda solo corría después de un respaldo bien hecho, tampoco se liberaba
 * nada: un disco lleno no se arreglaba solo nunca. Aquí se prueba el arreglo, que es
 * código que borra respaldos de producción sin que nadie lo mire, así que lo
 * primero que se prueba no es que borre: es lo que NO borra.
 *
 * CÓMO SE ENSAYA UN DISCO LLENO, Y HASTA DÓNDE ES DE VERDAD
 *
 * Llenar un disco de verdad pide montar uno chico, y montar pide ser
 * administrador de la máquina, que el CI no es. Así que:
 *
 *   · Los archivos son de verdad: cada respaldo de estas pruebas lo escribió
 *     `crear()`, es un .zip que abre, y lo que se borra se borra del disco.
 *   · La bitácora es de verdad: se lee de la base después.
 *   · Lo único que se pone es la MEDIDA: `medir`, la función que dice cuánto
 *     espacio queda. Aquí devuelve «un disco de tantos bytes, menos lo que hay
 *     en la carpeta», con los tamaños reales de los archivos reales. La cuenta
 *     que decide si cabe corre sobre esos números igual que sobre los de
 *     `statfs`.
 *   · Una escritura que se corta a la mitad sí se provoca de verdad, sin ser
 *     administrador: con un tope al tamaño de archivo (`ulimit -f`) el núcleo
 *     rechaza el `write`, y se mira qué quedó. Ver `_respaldo-que-se-corta.mjs`.
 *
 * Lo que NO cubre este archivo y sí se comprobó a mano contra un disco lleno de
 * verdad (un tmpfs de pocos megas): que `statfs` dé los números que se esperan
 * y que el `ENOSPC` del sistema siga el mismo camino que el tope de arriba.
 *
 * Estas pruebas cargan `lib/respaldos.js` en el propio proceso, con su base en
 * una carpeta desechable. No levantan el servidor: lo que entra por HTTP —el
 * botón, las subidas, el Tablero— está en `disco-lleno.test.mjs`.
 */

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIA = 86400000;

let dir;
let carpeta;
let archivos;
let respaldos;
let agenda;
let RESERVA;
let getDb;
/** Un completo y uno de solo la base hechos por `crear()`, para plantar copias. */
let molde;

const usuario = { id: null, nombre: 'Quien prueba', rol: 'admin' };
const sobra = () => 1e12;

/** Lo que pesa todo lo que hay en la carpeta de datos, sumando archivos reales. */
function ocupado(d = dir) {
  let bytes = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const ruta = path.join(d, e.name);
    bytes += e.isDirectory() ? ocupado(ruta) : fs.statSync(ruta).size;
  }
  return bytes;
}

/** Un disco de `tope` bytes: lo libre es el tope menos lo que de verdad hay. */
const discoDe = (tope) => () => Math.max(0, tope - ocupado());

/** Un disco al que le quedan exactamente `libre` bytes ahorita. */
const discoConLibre = (libre) => discoDe(ocupado() + libre);

let consecutivo = 0;

/**
 * Deja en la carpeta un respaldo con la edad que se pida.
 *
 * Es una copia de uno que hizo `crear()`: mismo contenido, así que abre y pasa
 * la revisión. Lo que cambia es el nombre y la fecha del archivo, que es de
 * donde la plataforma saca la edad.
 */
function plantar({ dias, completo = true, motivo = 'automatico', datos } = {}) {
  const cuando = new Date(Date.now() - dias * DIA - 60000);
  const p = (n) => String(n).padStart(2, '0');
  consecutivo += 1;
  const fecha = `${cuando.getFullYear()}-${p(cuando.getMonth() + 1)}-${p(cuando.getDate())}`;
  // La hora del nombre solo sirve para ordenar: va bajando con cada plantado
  // para que dos del mismo día no se pisen.
  const hora = `${p(Math.floor((1439 - consecutivo) / 60))}${p((1439 - consecutivo) % 60)}`;
  const nombre = `respaldo-${fecha}-${hora}-${motivo}-${completo ? 'completo' : 'base'}.zip`;
  const ruta = path.join(carpeta, nombre);
  fs.writeFileSync(ruta, datos || (completo ? molde.completo : molde.base));
  fs.utimesSync(ruta, cuando, cuando);
  return nombre;
}

const enLaCarpeta = () => fs.readdirSync(carpeta).filter((n) => n !== '.intento').sort();
const nombres = () => respaldos.listar().map((r) => r.nombre);

/** Los renglones de la bitácora que hablan de respaldos, del más viejo al más nuevo. */
const bitacora = () =>
  getDb()
    .prepare("SELECT id, accion, usuario, detalle FROM bitacora WHERE accion LIKE 'respaldo%' ORDER BY id")
    .all();

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-poda-'));
  carpeta = path.join(dir, 'respaldos');
  archivos = path.join(dir, 'archivos');
  fs.mkdirSync(carpeta, { recursive: true });
  fs.mkdirSync(archivos, { recursive: true });

  // La base se abre donde diga esta variable, y lo lee al cargarse: tiene que
  // estar puesta antes del `import`.
  process.env.DATABASE_PATH = path.join(dir, 'prueba.db');
  // La reserva de producción son 50 MB, pensada para un disco de un giga. Aquí
  // los respaldos pesan tres megas: con un mega de reserva las cuentas quedan a
  // la escala de la prueba. Es la misma variable con la que se configura.
  process.env.DISCO_RESERVA_MB = '1';

  /**
   * Al abrir la base se enciende el respaldo automático, que mira por primera
   * vez a los treinta segundos. Estas pruebas terminan mucho antes; pero si una
   * máquina lenta las alcanzara, la agenda haría un respaldo por su cuenta a
   * media prueba y descuadraría las cuentas. La marca de «intento reciente» es
   * el freno que la propia agenda respeta: con ella puesta, mira y no hace nada.
   */
  fs.writeFileSync(path.join(carpeta, '.intento'), new Date().toISOString());

  const { register } = await import('node:module');
  register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
  respaldos = await import(new URL('../lib/respaldos.js', import.meta.url).href);
  agenda = await import(new URL('../lib/agenda.js', import.meta.url).href);
  ({ RESERVA_BYTES: RESERVA } = await import(new URL('../lib/disco.js', import.meta.url).href));
  ({ getDb } = await import(new URL('../lib/db.js', import.meta.url).href));
  getDb();

  // Adjuntos que no se comprimen, como los PDF: así un completo pesa de verdad
  // más que uno de solo la base, que es toda la gracia.
  for (let i = 0; i < 6; i += 1) fs.writeFileSync(path.join(archivos, `f${i}.pdf`), randomBytes(512 * 1024));

  const c = respaldos.crear({ motivo: 'manual', medir: sobra });
  const b = respaldos.crear({ motivo: 'automatico', conArchivos: false, medir: sobra });
  molde = {
    completo: fs.readFileSync(path.join(carpeta, c.nombre)),
    base: fs.readFileSync(path.join(carpeta, b.nombre)),
  };
  assert.ok(molde.completo.length > molde.base.length + 1024 * 1024, 'el completo tiene que pesar bastante más');
});

after(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const n of enLaCarpeta()) fs.rmSync(path.join(carpeta, n), { force: true });
  getDb().prepare("DELETE FROM bitacora WHERE accion LIKE 'respaldo%'").run();
  // La base, consolidada. Lo que SQLite todavía no pasó al archivo principal
  // vive en un diario aparte que puede pesar megas aunque guarde casi nada, y
  // la estimación del respaldo lo cuenta entero —por arriba, a propósito—. Con
  // respaldos de tres megas, ese diario mandaría en todas las cuentas.
  getDb().pragma('wal_checkpoint(TRUNCATE)');
});

/**
 * Un adjunto de 40 MB que no ocupa 40 MB: un archivo con hueco. Sirve para las
 * pruebas que solo PREGUNTAN si el siguiente respaldo cabe —no lo hacen—, y que
 * necesitan que un respaldo completo pese más que el umbral de «disco lleno».
 */
function conAdjuntoGrande(hacer) {
  const ruta = path.join(archivos, 'zz-grande.pdf');
  fs.writeFileSync(ruta, '');
  fs.truncateSync(ruta, 40 * 1024 * 1024);
  try {
    return hacer();
  } finally {
    fs.rmSync(ruta, { force: true });
  }
}

/** Cuánto necesita el siguiente respaldo completo, dicho por la plataforma. */
const loQueNecesita = (completo = true) =>
  respaldos.estado({ medir: sobra }).proximo[completo ? 'completo' : 'base'].necesita;

describe('la regla que no se negocia: el completo más reciente que está bien no se borra', () => {
  /**
   * Un generador con semilla, para que la prueba pruebe siempre lo mismo y, si
   * un día falla, falle con el mismo caso.
   */
  function azar(semilla) {
    let s = semilla;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  test('ni la política ni la falta de espacio lo eligen nunca, en tres mil discos distintos', () => {
    const r = azar(20261113);
    const ahora = Date.now();
    let conCompletoBueno = 0;
    let sinSitio = 0;
    let cediendo = 0;

    for (let caso = 0; caso < 3000; caso += 1) {
      const cuantos = Math.floor(r() * 14);
      const lista = [];
      for (let i = 0; i < cuantos; i += 1) {
        const dias = Math.floor(r() * 400);
        const completo = r() < 0.45;
        const motivo = ['automatico', 'manual', 'antes-de-restaurar'][Math.floor(r() * 3)];
        const cuando = new Date(ahora - dias * DIA - i * 60000);
        lista.push({
          // El nombre ordena igual que la fecha, como en la carpeta de verdad.
          nombre: `respaldo-${cuando.toISOString().slice(0, 10)}-${String(2359 - i).padStart(4, '0')}-${motivo}-${completo ? 'completo' : 'base'}.zip`,
          fecha: cuando.toISOString().slice(0, 10),
          motivo,
          completo,
          bien: r() < 0.8,
          bytes: completo ? 150 + Math.floor(r() * 100) : 1 + Math.floor(r() * 3),
          creado_en: cuando.toISOString(),
        });
      }
      lista.sort((a, b) => (a.nombre < b.nombre ? 1 : -1));
      const intocable = lista.find((x) => x.completo && x.bien);
      if (intocable) conCompletoBueno += 1;

      // La política: lo que se borra «por viejo».
      const decisiones = respaldos.politica(lista, { ahora });
      assert.equal(decisiones.length, lista.length);
      if (intocable) {
        const suya = decisiones.find((d) => d.r.nombre === intocable.nombre);
        assert.equal(suya.conserva, true, `caso ${caso}: la política quiso borrar el completo bueno más reciente`);
        assert.equal(suya.cedible, false, `caso ${caso}: lo marcó como sacrificable`);
      }

      // Y el espacio: lo que se borra «para hacer sitio», desde un disco lleno
      // hasta uno en el que casi cabe.
      const libre = Math.floor(r() * 300);
      const necesidad = 100 + Math.floor(r() * 400);
      const plan = respaldos.planearSitio({ lista, libre, necesidad, reserva: 20, ahora });
      if (!plan.cabe) {
        sinSitio += 1;
        assert.deepEqual(plan.victimas, [], `caso ${caso}: no cabe, y aun así propuso borrar`);
      }
      if (plan.cede) cediendo += 1;
      for (const v of plan.victimas) {
        assert.notEqual(v.nombre, intocable?.nombre, `caso ${caso}: para hacer sitio eligió el completo bueno más reciente`);
      }
      // Lo que propone borrar alcanza, y no se pasa: quitando el último, ya no cabría.
      if (plan.victimas.length) {
        const libera = plan.victimas.reduce((a, v) => a + v.bytes, 0);
        assert.ok(libre + libera - necesidad >= 20, `caso ${caso}: lo que borra no alcanza`);
        const sinElUltimo = libera - plan.victimas[plan.victimas.length - 1].bytes;
        assert.ok(libre + sinElUltimo - necesidad < 20, `caso ${caso}: borra más de lo necesario`);
      }
    }

    // Que la prueba no esté pasando de vacío: tiene que haber visto de todo.
    assert.ok(conCompletoBueno > 2000, `solo ${conCompletoBueno} casos tenían un completo bueno que proteger`);
    assert.ok(sinSitio > 100, `solo ${sinSitio} casos sin sitio`);
    assert.ok(cediendo > 100, `solo ${cediendo} casos en los que la política cedía`);
  });

  test('con el disco lleno y un solo completo, no se hace el respaldo y no se borra nada', () => {
    const unico = plantar({ dias: 8 });
    const diarios = [1, 2, 3].map((dias) => plantar({ dias, completo: false }));
    const antes = enLaCarpeta();

    // Falta un solo byte. No hay nada que se pueda borrar para ganarlo: los
    // diarios no se sacrifican y el único completo es el intocable.
    const medir = discoConLibre(loQueNecesita() + RESERVA - 1);
    assert.throws(
      () => respaldos.crear({ motivo: 'manual', usuario, medir }),
      (err) => {
        assert.equal(err.constructor.name, 'SinEspacioError');
        assert.match(err.message, /no cabe en el disco/, 'dice qué pasó');
        assert.match(err.message, /no se borró nada/i, 'dice que no se perdió nada');
        assert.match(err.message, /Qué hacer/, 'y dice qué hacer');
        assert.match(err.message, /más reciente no se borra nunca/);
        return true;
      }
    );

    assert.deepEqual(enLaCarpeta(), antes, 'la carpeta quedó idéntica: ni se borró ni quedó nada a medias');
    assert.ok(nombres().includes(unico));
    for (const d of diarios) assert.ok(nombres().includes(d));
    assert.deepEqual(bitacora(), [], 'y no hay nada que anotar, porque no pasó nada');
  });

  test('si lo que se puede borrar no alcanza, tampoco se borra eso', () => {
    // Hay un diario viejísimo que la política sí soltaría, pero pesa casi nada:
    // borrarlo no hace caber el respaldo. Borrarlo «por si acaso» sería quedarse
    // sin lo viejo y sin lo nuevo.
    plantar({ dias: 8 });
    const viejo = plantar({ dias: 500, completo: false });
    const antes = enLaCarpeta();

    const medir = discoConLibre(loQueNecesita() + RESERVA - molde.base.length - 1);
    assert.throws(() => respaldos.crear({ motivo: 'manual', medir }), /liberarían .* y no alcanza/);
    assert.deepEqual(enLaCarpeta(), antes);
    assert.ok(nombres().includes(viejo), 'el diario viejo sigue ahí');
  });

  test('un completo que parece entero pero tiene el contenido dañado no cuenta como red', () => {
    // El más nuevo tiene un byte cambiado en medio: termina como un ZIP, así
    // que la revisión rápida de la lista lo da por bueno. Si la poda se fiara de
    // eso, lo dejaría como «el completo más reciente» y borraría uno sano.
    const sanoViejo = plantar({ dias: 20 });
    const sano = plantar({ dias: 10 });
    const podrido = Buffer.from(molde.completo);
    podrido[Math.floor(podrido.length / 2)] ^= 0xff;
    const malo = plantar({ dias: 3, datos: podrido });
    assert.equal(respaldos.listar().find((r) => r.nombre === malo).bien, true, 'por encima parece entero');

    // Con tres completos y política de dos, toca soltar uno. Antes de soltarlo
    // se lee entero el que se iba a quedar como el más reciente.
    const borrados = respaldos.depurar();

    assert.ok(nombres().includes(sano), 'el sano más reciente se queda');
    assert.ok(nombres().includes(sanoViejo), 'y el otro sano también: son los dos que sirven');
    assert.equal(nombres().includes(malo), false, 'el que se fue es el dañado');
    assert.deepEqual(borrados.map((b) => b.nombre), [malo]);
    assert.match(borrados[0].razon, /dañado/);
  });
});

describe('lo viejo se borra después de que lo nuevo existe', () => {
  test('con sitio de sobra: se hace el nuevo, y hasta entonces se podan los que ya no tocan', () => {
    const c1 = plantar({ dias: 30 });
    const c2 = plantar({ dias: 20 });
    const c3 = plantar({ dias: 10 });
    const diario = plantar({ dias: 2, completo: false });

    const r = respaldos.crear({ motivo: 'manual', usuario, medir: sobra });

    // Quedan los dos completos más recientes: el nuevo y el de hace 10 días.
    assert.ok(nombres().includes(r.nombre));
    assert.ok(nombres().includes(c3));
    assert.ok(nombres().includes(diario), 'los diarios recientes no se tocan');
    assert.equal(nombres().includes(c1), false);
    assert.equal(nombres().includes(c2), false);
    assert.deepEqual([...r.borrados].sort(), [c1, c2].sort(), 'y la respuesta dice cuáles se fueron');

    // El orden, leído de la bitácora: primero consta el respaldo nuevo —que se
    // anota cuando ya tiene su nombre definitivo— y después las podas.
    const libro = bitacora();
    const hecho = libro.find((b) => b.accion === 'respaldo');
    const podas = libro.filter((b) => b.accion === 'respaldo_podado');
    assert.ok(hecho, 'el respaldo nuevo quedó anotado');
    assert.equal(podas.length, 2);
    for (const p of podas) assert.ok(p.id > hecho.id, 'cada poda se anotó después de que el nuevo existía');
  });

  test('cada poda queda en la bitácora: qué se borró, cuánto pesaba y por qué', () => {
    const viejo = plantar({ dias: 30 });
    plantar({ dias: 20 });
    plantar({ dias: 10 });

    const borrados = respaldos.depurar();
    assert.deepEqual(borrados.map((b) => b.nombre), [viejo]);
    assert.equal(borrados[0].bytes, molde.completo.length);

    const [renglon] = bitacora().filter((b) => b.accion === 'respaldo_podado');
    assert.ok(renglon, 'un respaldo que desaparece sin rastro es peor que uno que no se borra');
    assert.equal(renglon.usuario, 'sistema', 'lo borró la plataforma, no una persona');
    assert.ok(renglon.detalle.includes(viejo), 'dice cuál');
    assert.match(renglon.detalle, /\(\d+(\.\d)? MB\)/, 'dice cuánto pesaba');
    assert.match(renglon.detalle, /se conservan los 2 respaldos completos más recientes/, 'y dice por qué');
  });

  test('la política por omisión: dos completos, catorce días de diarios, y uno por mes', () => {
    const completos = [3, 10, 25, 60].map((dias) => plantar({ dias }));
    const recientes = [1, 5, 13].map((dias) => plantar({ dias, completo: false }));
    // Dos diarios viejos del mismo mes, separados por un día: se queda el más
    // nuevo de los dos. Se buscan a mitad de un mes para que caigan juntos.
    const mitad = new Date(Date.now() - 75 * DIA);
    mitad.setDate(15);
    const haceDias = (d) => Math.round((Date.now() - d.getTime()) / DIA);
    const delMes = [haceDias(mitad), haceDias(mitad) + 1].map((dias) => plantar({ dias, completo: false }));
    const prehistorico = plantar({ dias: 500, completo: false });

    respaldos.depurar();
    const quedan = nombres();

    assert.deepEqual(completos.map((n) => quedan.includes(n)), [true, true, false, false], 'los dos completos más nuevos');
    assert.deepEqual(recientes.map((n) => quedan.includes(n)), [true, true, true], 'los diarios de menos de 14 días');
    assert.deepEqual(delMes.map((n) => quedan.includes(n)), [true, false], 'de un mes viejo, solo el más nuevo');
    assert.equal(quedan.includes(prehistorico), false, 'y de hace más de un año, ninguno');
  });

  test('el de antes de restaurar se queda catorce días aunque haya completos de más', () => {
    // Alguien restauró hace tres días y luego hizo dos respaldos a mano. Sin
    // esta regla, el segundo respaldo se llevaba por delante la vuelta atrás.
    const vuelta = plantar({ dias: 3, motivo: 'antes-de-restaurar' });
    const m1 = plantar({ dias: 2, motivo: 'manual' });
    const m2 = plantar({ dias: 1, motivo: 'manual' });
    respaldos.depurar();
    assert.deepEqual([vuelta, m1, m2].map((n) => nombres().includes(n)), [true, true, true]);

    // Pasados los catorce días es un completo más, y ya no es de los dos nuevos.
    const cuando = new Date(Date.now() - 20 * DIA);
    fs.utimesSync(path.join(carpeta, vuelta), cuando, cuando);
    const borrados = respaldos.depurar();
    assert.deepEqual(borrados.map((b) => b.nombre), [vuelta]);
  });
});

describe('la política se puede cambiar por variable de entorno, y un valor malo no borra nada de más', () => {
  /** Cuatro completos y nada más, del más nuevo al más viejo. */
  const cuatro = () =>
    [1, 8, 15, 22].map((dias, i) => {
      const cuando = new Date(Date.now() - dias * DIA);
      return {
        nombre: `respaldo-${cuando.toISOString().slice(0, 10)}-${String(2300 - i).padStart(4, '0')}-automatico-completo.zip`,
        fecha: cuando.toISOString().slice(0, 10),
        motivo: 'automatico',
        completo: true,
        bien: true,
        bytes: 100,
        creado_en: cuando.toISOString(),
      };
    });

  /** El módulo, cargado de nuevo con esas variables: las lee al cargarse. */
  async function con(variables) {
    const antes = { ...process.env };
    Object.assign(process.env, variables);
    try {
      const marca = Object.entries(variables).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      return await import(`${new URL('../lib/respaldos.js', import.meta.url).href}?${marca}`);
    } finally {
      for (const k of Object.keys(variables)) {
        if (k in antes) process.env[k] = antes[k];
        else delete process.env[k];
      }
    }
  }

  const conservados = (m) => m.politica(cuatro()).filter((d) => d.conserva).length;

  test('RESPALDOS_COMPLETOS y RESPALDOS_DIAS_BASE mandan', async () => {
    const uno = await con({ RESPALDOS_COMPLETOS: '1', RESPALDOS_DIAS_BASE: '3' });
    assert.equal(uno.COMPLETOS_A_CONSERVAR, 1);
    assert.equal(uno.DIAS_SOLO_BASE, 3);
    assert.equal(conservados(uno), 1);

    const tres = await con({ RESPALDOS_COMPLETOS: '3' });
    assert.equal(conservados(tres), 3);
  });

  test('un valor que no se entiende cae en la omisión: nunca en «no conservar ninguno»', async () => {
    // Es el caso que importa. `Number('dos')` es NaN, y contra NaN toda
    // comparación es falsa: un «conservar NaN completos» conservaría solo el
    // intocable sin que nadie lo hubiera pedido. Lo mismo un cero o un negativo.
    for (const malo of ['dos', '', '0', '-1', '2.5', 'Infinity']) {
      const m = await con({ RESPALDOS_COMPLETOS: malo, RESPALDOS_DIAS_BASE: malo });
      assert.equal(m.COMPLETOS_A_CONSERVAR, 2, `con «${malo}»`);
      assert.equal(m.DIAS_SOLO_BASE, 14, `con «${malo}»`);
      assert.equal(conservados(m), 2);
    }
  });
});

describe('la reserva del disco también se configura, y tampoco se apaga sola', () => {
  async function reservaCon(valor) {
    const antes = process.env.DISCO_RESERVA_MB;
    process.env.DISCO_RESERVA_MB = valor;
    try {
      const m = await import(`${new URL('../lib/disco.js', import.meta.url).href}?reserva=${encodeURIComponent(valor)}`);
      return m.RESERVA_BYTES / 1024 / 1024;
    } finally {
      process.env.DISCO_RESERVA_MB = antes;
    }
  }

  test('DISCO_RESERVA_MB manda; el cero vale, porque es una decisión; lo que no se entiende, no', async () => {
    assert.equal(await reservaCon('10'), 10);
    assert.equal(await reservaCon('0'), 0, 'sin reserva, si alguien lo decide');
    // Una reserva que no se entiende no puede quedar en cero ni en NaN: sería
    // quitarla sin que nadie lo hubiera decidido. Vacía es «no la pusieron».
    for (const malo of ['', '  ', 'mucho', '-5', 'NaN']) {
      assert.equal(await reservaCon(malo), 50, `con «${malo}» tiene que quedar la de omisión`);
    }
  });
});

describe('cuando no cabe, se hace sitio antes, y la política cede ante el espacio', () => {
  test('si dos completos ya no caben junto al nuevo, se suelta el más viejo y se dice', () => {
    const viejo = plantar({ dias: 15 });
    const reciente = plantar({ dias: 8 });
    const diario = plantar({ dias: 1, completo: false });

    // Falta un byte para que quepa. La política conservaría los dos completos;
    // el disco no da. El único que se puede soltar es el más viejo.
    const medir = discoConLibre(loQueNecesita() + RESERVA - 1);
    const e = respaldos.estado({ medir });
    assert.equal(e.proximo.completo.cabe, true, 'cabe…');
    assert.equal(e.proximo.completo.cede, true, '…pero cediendo, y la pantalla lo sabe antes de intentarlo');

    const r = respaldos.crear({ motivo: 'manual', usuario, medir });

    assert.ok(nombres().includes(r.nombre), 'el nuevo se hizo');
    assert.ok(nombres().includes(reciente), 'el completo bueno más reciente sobrevivió');
    assert.ok(nombres().includes(diario), 'los diarios no se sacrifican');
    assert.equal(nombres().includes(viejo), false, 'se soltó el más viejo');
    assert.deepEqual(r.podados.map((p) => p.nombre), [viejo], 'y solo ese: ni uno más de los necesarios');
    assert.match(r.podados[0].razon, /no cabía el respaldo nuevo/);

    const renglon = bitacora().find((b) => b.accion === 'respaldo_podado');
    assert.ok(renglon.detalle.includes(viejo));
    assert.match(renglon.detalle, /el disco ya no da para conservar/);
  });

  test('primero se van los dañados y los que ya sobraban, antes que un completo que la política quería', () => {
    const cortado = plantar({ dias: 40, datos: molde.completo.subarray(0, 300 * 1024) });
    const viejo = plantar({ dias: 15 });
    const reciente = plantar({ dias: 8 });

    // Con soltar el cortado ya cabe: el completo viejo, que la política sí
    // quiere, no tiene por qué pagar.
    const medir = discoConLibre(loQueNecesita(false) - 1);
    const r = respaldos.crear({ motivo: 'automatico', conArchivos: false, medir });

    assert.equal(r.completo, false);
    assert.equal(nombres().includes(cortado), false);
    assert.ok(nombres().includes(viejo));
    assert.ok(nombres().includes(reciente));
    assert.match(r.podados.find((p) => p.nombre === cortado).razon, /dañado o a medias/);
  });

  test('un disco como el del reporte —lleno, con semanas sin respaldo y uno cortado en medio— se arregla solo', async () => {
    // Las cifras del reporte (19 respaldos, el último de hace semanas, ni un
    // byte libre) y, además, el respaldo cortado que deja el código anterior
    // cuando se queda sin disco a media escritura. Que en producción haya uno
    // así no está comprobado; que este camino lo aguanta, sí.
    // Cuatro completos —el más nuevo, cortado a media escritura— y dieciséis
    // diarios; el último respaldo que sirve, de hace 28 días. Ni un byte libre.
    const c0 = plantar({ dias: 48 });
    const c1 = plantar({ dias: 41 });
    const c2 = plantar({ dias: 34 });
    const cortado = plantar({ dias: 27, datos: molde.completo.subarray(0, 700 * 1024) });
    for (let dias = 28; dias < 44; dias += 1) plantar({ dias, completo: false });
    fs.rmSync(path.join(carpeta, '.intento'), { force: true });

    const lleno = discoDe(ocupado());
    assert.equal(lleno(), 0);
    const antes = respaldos.estado({ medir: lleno });
    assert.equal(antes.ultimoCompleto.nombre, c2, 'el cortado no cuenta como el último completo');
    assert.ok(antes.dias >= 28, `el último que sirve tiene ${antes.dias} días, no los 27 del cortado`);
    assert.ok(antes.avisos.some((a) => a.clave === 'atrasado'), 'y el Tablero lo dice');

    // Lo que hace la agenda sola, sin que nadie pida nada.
    await agenda.revisar({ medir: lleno });

    const despues = respaldos.listar();
    const nuevo = despues[0];
    assert.equal(nuevo.motivo, 'automatico', 'se hizo un respaldo');
    assert.equal(nuevo.completo, true, 'completo, porque el último bueno tenía más de una semana');
    assert.equal(nuevo.bien, true);
    assert.ok(despues.some((r) => r.nombre === c2), 'el completo bueno más reciente siguió ahí mientras se hacía el nuevo');
    assert.equal(despues.some((r) => r.nombre === cortado), false, 'el cortado se fue');
    assert.equal(despues.some((r) => r.nombre === c0 || r.nombre === c1), false, 'y los completos viejos también');
    assert.deepEqual(
      despues.filter((r) => r.completo).map((r) => r.nombre),
      [nuevo.nombre, c2],
      'quedan los dos completos que dice la política: el nuevo y el bueno más reciente de antes'
    );
    assert.equal(fs.existsSync(path.join(carpeta, '.intento')), false, 'la marca del intento se levantó al terminar bien');

    const ahora = respaldos.estado({ medir: discoDe(ocupado() + RESERVA + 64 * 1024 * 1024) });
    assert.equal(ahora.alDia, true);
    assert.deepEqual(ahora.avisos, [], 'con el respaldo hecho y sitio en el disco, no queda nada que avisar');

    // Todo lo que se borró está en la bitácora, con su razón.
    const podas = bitacora().filter((b) => b.accion === 'respaldo_podado');
    assert.ok(podas.some((p) => p.detalle.includes(cortado) && /dañado/.test(p.detalle)));
    assert.ok(podas.some((p) => p.detalle.includes(c0)));
    assert.ok(podas.some((p) => p.detalle.includes(c1)));
    fs.writeFileSync(path.join(carpeta, '.intento'), new Date().toISOString());
  });

  test('si el completo no cabe de ninguna manera, la agenda respalda al menos la base', async () => {
    // El único completo es el intocable y los adjuntos ya no dejan sitio para
    // otro. Antes, la agenda insistía en el completo cada día y fallaba cada
    // día: dejaba de haber respaldo de cualquier cosa.
    const unico = plantar({ dias: 9 });
    fs.rmSync(path.join(carpeta, '.intento'), { force: true });

    // Queda menos sitio que la reserva del disco. Un completo no puede entrar
    // ahí; el de solo la base sí, porque pesa casi nada y negárselo sería
    // quedarse sin ningún respaldo justo cuando el disco aprieta.
    const medir = discoConLibre(loQueNecesita(false) + 4096);
    assert.ok(medir() < RESERVA, 'la prueba necesita que quede menos que la reserva');
    assert.equal(respaldos.estado({ medir }).proximo.completo.cabe, false);
    assert.equal(respaldos.estado({ medir }).proximo.base.cabe, true);

    await agenda.revisar({ medir });

    const lista = respaldos.listar();
    assert.equal(lista.length, 2);
    assert.match(lista[0].nombre, /-automatico-base\.zip$/, 'hay respaldo de hoy, de la base');
    assert.ok(lista.some((r) => r.nombre === unico), 'y el completo sigue ahí');

    // La base está al día, pero eso no puede pasar por «todo bien»: con el
    // disco así de justo, el aviso del disco sigue puesto.
    const e = respaldos.estado({ medir });
    assert.equal(e.alDia, true);
    assert.equal(e.proximo.completo.cabe, false);
    assert.ok(e.avisos.some((a) => a.grave), `avisos: ${e.avisos.map((a) => a.clave)}`);
    fs.writeFileSync(path.join(carpeta, '.intento'), new Date().toISOString());
  });
});

describe('un respaldo fallido no deja un archivo a medias', () => {
  test('uno cortado que ya estaba en la carpeta no figura como si sirviera', () => {
    const bueno = plantar({ dias: 5 });
    // Más nuevo que el bueno, con nombre de respaldo completo, y cortado: es lo
    // que dejaba un respaldo que se quedaba sin disco.
    const cortado = plantar({ dias: 0, datos: molde.completo.subarray(0, 500 * 1024) });

    const lista = respaldos.listar();
    assert.equal(lista.find((r) => r.nombre === cortado).bien, false);
    assert.equal(lista.find((r) => r.nombre === bueno).bien, true);

    const e = respaldos.estado({ medir: sobra });
    assert.equal(e.ultimo.nombre, bueno, 'el último es el último que sirve');
    assert.equal(e.ultimoCompleto.nombre, bueno, 'y es el que se ofrece para bajar');
    assert.equal(e.dias, 5, 'la edad se cuenta desde el bueno: el cortado no reinicia el reloj');
    assert.equal(e.alDia, false);
    assert.equal(e.danados, 1);
    assert.ok(e.avisos.some((a) => a.clave === 'atrasado'), 'así que el aviso de respaldo atrasado no se calla');
  });

  test('si el sistema corta la escritura a la mitad, no queda nada y el bueno sigue siendo el último', () => {
    const aparte = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-corte-'));
    try {
      // 8192 bloques de 512 bytes: ningún archivo de ese proceso pasa de 4 MB.
      // El respaldo que intenta lleva 12 MB de adjuntos que no se comprimen.
      const guion = fileURLToPath(new URL('./_respaldo-que-se-corta.mjs', import.meta.url));
      const salida = execFileSync('sh', ['-c', 'ulimit -f 8192; exec "$0" "$1" "$2"', process.execPath, guion, aparte], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const r = JSON.parse(salida.split('RESULTADO ')[1]);

      assert.ok(r.fallo, 'el segundo respaldo tenía que fallar');
      assert.equal(r.fallo.code, 'EFBIG', `falló por otra cosa: ${r.fallo.message}`);
      assert.deepEqual(r.enLaCarpeta, [r.bueno], 'en la carpeta solo está el bueno: ni el pedazo ni la copia de la base');
      assert.deepEqual(r.lista, [{ nombre: r.bueno, bien: true }]);
      assert.equal(r.ultimoCompleto, r.bueno, 'y sigue siendo el que se ofrece para bajar');
    } finally {
      fs.rmSync(aparte, { recursive: true, force: true });
    }
  });

  test('los restos de un proceso que murió a media escritura se quitan en el siguiente respaldo', () => {
    // Lo que queda si al servidor lo matan mientras escribe: el provisional del
    // .zip y la copia temporal de la base. No salen en ninguna lista y pueden
    // pesar lo que un respaldo completo.
    const resto = path.join(carpeta, '.escribiendo-999-1-respaldo-2026-01-01-0000-automatico-completo.zip');
    const copia = path.join(carpeta, '.copia-999-1.db');
    const subida = path.join(archivos, '.escribiendo-999-1-contrato-abc.pdf');
    fs.writeFileSync(resto, molde.completo.subarray(0, 100000));
    fs.writeFileSync(copia, Buffer.alloc(50000));
    fs.writeFileSync(subida, Buffer.alloc(1000));
    assert.equal(nombres().length, 0, 'ninguno figura como respaldo');

    const r = respaldos.crear({ motivo: 'manual', medir: sobra });

    assert.deepEqual(enLaCarpeta(), [r.nombre], 'solo queda el respaldo nuevo');
    assert.equal(fs.existsSync(subida), false, 'y el adjunto a medias tampoco');
    // Y el adjunto a medias no se coló en el respaldo como si fuera de alguien.
    const dentro = execFileSync('unzip', ['-Z1', path.join(carpeta, r.nombre)]).toString();
    assert.doesNotMatch(dentro, /escribiendo/);
  });

  test('el respaldo nuevo se comprueba entero antes de llamarse respaldo', () => {
    const r = respaldos.crear({ motivo: 'manual', medir: sobra });
    execFileSync('unzip', ['-t', path.join(carpeta, r.nombre)]);
    assert.equal(respaldos.listar()[0].bien, true);
    assert.deepEqual(enLaCarpeta(), [r.nombre], 'sin provisional ni copia temporal al lado');
  });
});

describe('el aviso: ni se calla cuando hay problema, ni suena cuando no lo hay', () => {
  test('con respaldo de hoy y disco con sitio, ningún aviso', () => {
    respaldos.crear({ motivo: 'manual', medir: sobra });
    const e = respaldos.estado({ medir: sobra });
    assert.equal(e.alDia, true);
    assert.deepEqual(e.avisos, []);
  });

  test('sin ningún respaldo, se dice; y si además no cabe, se dice por qué', () => {
    const [a] = respaldos.estado({ medir: sobra }).avisos;
    assert.equal(a.clave, 'sin-respaldo');
    assert.match(a.titulo, /Todavía no hay ningún respaldo/);

    const lleno = respaldos.estado({ medir: () => 0 }).avisos;
    assert.match(lleno[0].texto, /disco del servidor está lleno/);
    assert.deepEqual(lleno.map((x) => x.clave), ['sin-respaldo', 'disco-lleno'], 'como mucho dos: uno del respaldo y uno del disco');
  });

  test('atrasado por falta de sitio no manda a «hacer uno»: dice que es el disco', () => {
    plantar({ dias: 6 });
    const conSitio = respaldos.estado({ medir: sobra }).avisos.find((a) => a.clave === 'atrasado');
    assert.match(conSitio.titulo, /hace 6 días/);
    assert.match(conSitio.texto, /haz uno y bájatelo/);

    const sinSitio = respaldos.estado({ medir: () => 0 }).avisos.find((a) => a.clave === 'atrasado');
    assert.match(sinSitio.texto, /no se ha podido hacer porque el disco del servidor está lleno/);
    assert.doesNotMatch(sinSitio.texto, /haz uno y bájatelo/, 'mandar a un botón que va a fallar es peor que no avisar');
  });

  test('hay diarios al día pero el completo se quedó viejo: se avisa, en ámbar', () => {
    plantar({ dias: 12 });
    plantar({ dias: 0, completo: false });
    const e = respaldos.estado({ medir: sobra });
    assert.equal(e.alDia, true);
    const [a] = e.avisos;
    assert.equal(a.clave, 'completo-atrasado');
    assert.equal(a.grave, false);
    assert.match(a.titulo, /con los PDF es de hace 12 días/);
  });

  test('el disco todavía tiene sitio pero el siguiente completo ya no cabe: se avisa antes de que falle', () => {
    plantar({ dias: 1 });
    conAdjuntoGrande(() => {
      // Quedan 30 MB —se puede subir un contrato sin problema— y el respaldo
      // completo pesaría más de 40. No hay nada que borrar salvo el intocable.
      const e = respaldos.estado({ medir: () => 30 * 1024 * 1024 });
      assert.equal(e.alDia, true, 'hoy todavía hay respaldo');
      const [a, ...resto] = e.avisos;
      assert.equal(a.clave, 'completo-no-cabe');
      assert.equal(a.grave, true);
      assert.match(a.texto, /no se borra nunca/);
      assert.deepEqual(resto, []);
    });
  });

  test('caben, pero ya no los dos que la política quiere: se avisa en ámbar, con el número', () => {
    plantar({ dias: 6 });
    plantar({ dias: 1 });
    conAdjuntoGrande(() => {
      const medir = discoConLibre(loQueNecesita() + RESERVA - 1);
      const e = respaldos.estado({ medir });
      assert.deepEqual(e.avisos.map((a) => [a.clave, a.grave]), [['disco-justo', false]]);
      assert.match(e.avisos[0].titulo, /ya no da para conservar 2 respaldos completos/);
    });
  });

  test('todos los avisos dicen dónde se arregla', () => {
    plantar({ dias: 30 });
    for (const medir of [sobra, () => 0, discoConLibre(loQueNecesita() + RESERVA - 1)]) {
      for (const a of respaldos.estado({ medir }).avisos) {
        assert.match(a.texto, /Entra a Respaldos|entra a Respaldos/, `«${a.titulo}» no dice a dónde ir`);
      }
    }
  });
});
