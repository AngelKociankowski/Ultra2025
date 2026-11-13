/**
 * Un disco lleno se dice, no se disfraza de error interno.
 *
 * El dueño reportó que «Subir el PDF del contrato» contestaba «Error interno
 * del servidor», y diez días antes que «Hacer un respaldo ahora» contestaba lo
 * mismo. Es lo que la plataforma contestaba con el disco lleno: el sistema le
 * decía qué pasaba —`ENOSPC`— y ella lo traducía a la única frase que no le
 * sirve a nadie, la que dice que el fallo es un misterio.
 *
 * Aquí se prueba por HTTP, contra la aplicación compilada:
 *
 *   · que quedarse sin sitio conteste qué pasó, que no se guardó nada y qué
 *     hacer, con su propio estado (507) y no el 500 genérico;
 *   · que una subida que no termina no deje ni un archivo huérfano ni uno a
 *     medias;
 *   · que el disco se vea en la pantalla de Respaldos, y que el aviso llegue al
 *     Tablero del administrador con el arreglo al lado —y solo cuando hay algo
 *     que avisar—.
 *
 * CÓMO SE LLENA EL DISCO AQUÍ, Y QUÉ TAN DE VERDAD ES
 *
 * El CI no puede montar un disco chico: eso pide ser administrador de la
 * máquina. Lo que sí puede es lo que haría quien configura la plataforma: subir
 * la RESERVA (`DISCO_RESERVA_MB`), que son los megas que ni una subida ni un
 * respaldo pueden comerse. Con una reserva más grande que cualquier disco, la
 * plataforma se ve a sí misma sin sitio: la medida es la de verdad (`statfs`),
 * la ruta es la de verdad, la respuesta es la de verdad. Lo que no ocurre es el
 * rechazo del sistema operativo, porque la plataforma se niega antes.
 *
 * Ese rechazo —el `ENOSPC` crudo, y su equivalente de SQLite— se prueba aparte
 * y con errores auténticos, no fabricados: el del sistema sale de escribir en
 * `/dev/full`, que es el dispositivo que existe para eso, y el de la base de
 * ponerle un tope de páginas a una base real. Lo que NO se pudo automatizar es
 * ese mismo error atravesando una ruta HTTP; eso se comprobó a mano contra un
 * disco lleno de verdad (un tmpfs de pocos megas) y está en el reporte.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Un PDF mínimo pero de verdad. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

/** Lo que hay en una carpeta de datos del servidor de prueba, o nada si no existe. */
const enCarpeta = (app, nombre) => {
  const dir = path.join(app.carpetaDatos, nombre);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

async function abrirServicio(cliente, nombre) {
  const r = await cliente.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, fecha: '2026-07-01', turnos: { '24 HRS': 2 }, dias_credito: 30 }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

async function subir(app, cliente, ruta, { datos = PDF, nombre = 'papel.pdf' } = {}) {
  const cuerpo = new FormData();
  cuerpo.append('archivo', new Blob([datos], { type: 'application/pdf' }), nombre);
  const r = await fetch(`${app.base}${ruta}`, { method: 'POST', headers: { cookie: cliente.cookie }, body: cuerpo });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* no era JSON: se verá en el texto */
  }
  return { status: r.status, json, texto };
}

/** El aviso del Tablero que lleva ese título: la etiqueta que lo abre, con su `href`. */
function avisoDelTablero(html, titulo) {
  const i = html.indexOf(titulo);
  if (i === -1) return null;
  return html.slice(html.lastIndexOf('<a ', i), i);
}

// ---------------------------------------------------------------------------

describe('el error del disco lleno, con errores auténticos', () => {
  let errores;

  before(async () => {
    errores = await import(new URL('../lib/errores.js', import.meta.url).href);
  });

  /** El `ENOSPC` que da el sistema, no uno escrito a mano. */
  function enospcDeVerdad() {
    try {
      fs.writeFileSync('/dev/full', 'x');
    } catch (err) {
      return err;
    }
    return null;
  }

  /** El `SQLITE_FULL` que da SQLite cuando la base no puede crecer. */
  function sqliteLlenoDeVerdad() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-llena-'));
    const db = new Database(path.join(dir, 'tope.db'));
    try {
      db.exec('CREATE TABLE t (x TEXT)');
      db.pragma(`max_page_count = ${db.pragma('page_count', { simple: true })}`);
      db.prepare('INSERT INTO t VALUES (?)').run('x'.repeat(200000));
    } catch (err) {
      return err;
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return null;
  }

  test('el ENOSPC del sistema de archivos se traduce a un 507 que dice qué pasó y qué hacer', (t) => {
    if (!fs.existsSync('/dev/full')) return t.skip('este sistema no tiene /dev/full');
    const err = enospcDeVerdad();
    assert.equal(err?.code, 'ENOSPC', 'la prueba necesita el error de verdad');

    const r = errores.respuestaSinEspacio(err);
    assert.equal(r.status, 507);
    assert.match(r.cuerpo.error, /sin espacio/, 'qué pasó');
    assert.match(r.cuerpo.error, /no se guardó/, 'que no se guardó nada');
    assert.match(r.cuerpo.error, /Respaldos/, 'y qué hacer: a dónde ir');
    assert.doesNotMatch(r.cuerpo.error, /Error interno/);
    assert.doesNotMatch(r.cuerpo.error, /ENOSPC/, 'en castellano llano, sin el código del sistema');
  });

  test('el SQLITE_FULL de la base, igual', () => {
    const err = sqliteLlenoDeVerdad();
    assert.match(String(err?.code), /^SQLITE_FULL/, `la prueba necesita el error de verdad y salió ${err?.code}`);
    const r = errores.respuestaSinEspacio(err);
    assert.equal(r.status, 507);
    assert.match(r.cuerpo.error, /no se guardó/);
  });

  test('el que la plataforma lanza al comprobar antes lleva su propio mensaje', () => {
    const r = errores.respuestaSinEspacio(new errores.SinEspacioError('No cabe el PDF: pesa 3 MB y queda 1.'));
    assert.equal(r.status, 507);
    assert.equal(r.cuerpo.error, 'No cabe el PDF: pesa 3 MB y queda 1.');
  });

  test('lo que no es falta de espacio no se disfraza de falta de espacio', () => {
    let noExiste;
    try {
      fs.readFileSync(path.join(os.tmpdir(), 'ultra-no-existe-jamas'));
    } catch (err) {
      noExiste = err;
    }
    assert.equal(noExiste.code, 'ENOENT');
    for (const err of [noExiste, new Error('otra cosa'), new errores.ValidacionError('dato malo'), null, undefined]) {
      assert.equal(errores.respuestaSinEspacio(err), null);
    }
  });
});

// ---------------------------------------------------------------------------

describe('con sitio en el disco', () => {
  let app;
  let admin;
  let juridico;
  let servicio;

  /** La bitácora del servidor de prueba, leída de su base. */
  function bitacora(accion) {
    const db = new Database(path.join(app.carpetaDatos, 'prueba.db'), { readonly: true });
    try {
      return db.prepare('SELECT usuario, detalle FROM bitacora WHERE accion = ? ORDER BY id').all(accion);
    } finally {
      db.close();
    }
  }

  before(async () => {
    app = await arrancar();
    /**
     * La agenda hace un respaldo sola a los treinta segundos de arrancar. Aquí
     * se cuenta qué respaldos hay y de cuándo, así que se le pone su propio
     * freno —la marca de «intento reciente»— para que no meta uno por su cuenta
     * a media prueba.
     */
    fs.mkdirSync(path.join(app.carpetaDatos, 'respaldos'), { recursive: true });
    fs.writeFileSync(path.join(app.carpetaDatos, 'respaldos', '.intento'), new Date().toISOString());

    admin = await app.entrarYAsentar(ROLES.admin);
    juridico = await app.entrarYAsentar(ROLES.juridico);
    servicio = await abrirServicio(admin, 'DISCO CON SITIO');
  });

  after(async () => {
    await app?.cerrar();
  });

  describe('subir un archivo no deja basura', () => {
    test('si el registro falla, el archivo no se queda huérfano en el disco', async () => {
      // Subir el contrato de un servicio que no existe: el PDF llegaba a
      // escribirse, el registro fallaba, y el archivo se quedaba para siempre
      // en un disco donde nada lo nombra.
      const r = await subir(app, juridico, '/api/servicios/99999999/contrato');
      assert.equal(r.status, 400, r.texto);
      assert.match(r.json.error, /no existe/);
      assert.deepEqual(enCarpeta(app, 'archivos'), [], 'no quedó ningún archivo sin dueño');
    });

    test('una subida buena deja exactamente su archivo, entero y sin provisional al lado', async () => {
      const datos = Buffer.concat([PDF, Buffer.alloc(300 * 1024, 7)]);
      const r = await subir(app, juridico, `/api/servicios/${servicio}/contrato`, { datos });
      assert.equal(r.status, 201, r.texto);

      const dentro = enCarpeta(app, 'archivos');
      assert.deepEqual(dentro, [r.json.archivo], 'un archivo, con el nombre que quedó registrado');
      assert.ok(fs.readFileSync(path.join(app.carpetaDatos, 'archivos', dentro[0])).equals(datos), 'y es el que se subió');
    });

    test('reemplazarlo sigue dejando uno solo', async () => {
      const r = await subir(app, juridico, `/api/servicios/${servicio}/contrato`, { nombre: 'el-bueno.pdf' });
      assert.equal(r.status, 201, r.texto);
      assert.deepEqual(enCarpeta(app, 'archivos'), [r.json.archivo]);
    });
  });

  describe('el disco se ve', () => {
    test('la plataforma dice cuánto hay, cuánto queda y qué lo ocupa, y la cuenta cuadra', async () => {
      const { estado } = (await admin.pedir('/api/respaldos')).json;
      const d = estado.disco;
      assert.ok(d, 'el disco se pudo medir');
      assert.ok(d.total > 0 && d.libre > 0 && d.libre < d.total);
      assert.equal(d.adjuntos, PDF.length, 'los adjuntos pesan lo que pesa el contrato que hay');
      assert.equal(d.cuantosAdjuntos, 1);
      assert.ok(d.base > 100000, 'la base pesa lo suyo');
      assert.equal(d.base + d.adjuntos + d.respaldos + d.otros, d.ocupado, 'los cuatro renglones suman lo ocupado');
      assert.equal(d.ocupado, d.total - d.libre);
    });

    test('la pantalla de Respaldos lo enseña', async () => {
      const html = comoSeLee((await admin.pedir('/respaldos')).texto);
      assert.match(html, /El disco del servidor/);
      assert.match(html, /libres de/);
      assert.match(html, /Adjuntos \(contratos y facturas\)/);
      assert.match(html, /La base/);
      assert.match(html, /El próximo respaldo completo pesará unos [\d.]+ MB y cabe/);
      assert.doesNotMatch(html, /Qué se puede hacer/, 'el remedio solo aparece cuando hace falta');
    });
  });

  describe('el aviso llega al Tablero, y solo cuando toca', () => {
    let viejo;

    test('con un respaldo de hoy y sitio en el disco, el Tablero no dice nada del tema', async () => {
      const hecho = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'manual' }) });
      assert.equal(hecho.status, 201, hecho.texto);

      const html = comoSeLee((await admin.pedir('/')).texto);
      assert.doesNotMatch(html, /El último respaldo es de hace/);
      assert.doesNotMatch(html, /disco del servidor/);
      assert.doesNotMatch(html, /ya no cabe/);
      assert.doesNotMatch(html, /ya no da para conservar/);

      // Se deja como único respaldo, con cinco días encima: lo que habría si el
      // automático llevara cinco días sin poder hacerse.
      const dir = path.join(app.carpetaDatos, 'respaldos');
      const cuando = new Date(Date.now() - 5 * 86400000 - 60000);
      const fecha = new Intl.DateTimeFormat('en-CA').format(cuando);
      viejo = `respaldo-${fecha}-0900-manual-completo.zip`;
      fs.renameSync(path.join(dir, hecho.json.nombre), path.join(dir, viejo));
      fs.utimesSync(path.join(dir, viejo), cuando, cuando);
      for (const n of fs.readdirSync(dir)) {
        if (n !== viejo && n !== '.intento') fs.rmSync(path.join(dir, n), { force: true });
      }
    });

    test('con el respaldo atrasado, el administrador lo ve al entrar, con el enlace a donde se arregla', async () => {
      const html = comoSeLee((await admin.pedir('/')).texto);
      const aviso = avisoDelTablero(html, 'El último respaldo es de hace 5 días');
      assert.ok(aviso, 'el Tablero tiene que decirlo');
      assert.match(aviso, /href="\/respaldos"/, 'y llevar a donde se arregla');
      assert.match(aviso, /red-500/, 'en rojo: esto ya dejó de funcionar');
    });

    test('quien no puede arreglarlo no lo ve', async () => {
      const html = comoSeLee((await juridico.pedir('/')).texto);
      assert.doesNotMatch(html, /El último respaldo es de hace/);
    });

    test('un respaldo cortado, aunque sea de hoy, no calla el aviso ni se ofrece para bajar', async () => {
      // Lo que dejaba un respaldo que se quedaba sin disco a media escritura:
      // un .zip con nombre de respaldo completo y sin final. Contaba como «el
      // respaldo de hoy» y el aviso se callaba el mismo día del fallo.
      const dir = path.join(app.carpetaDatos, 'respaldos');
      const entero = fs.readFileSync(path.join(dir, viejo));
      const hoy = new Intl.DateTimeFormat('en-CA').format(new Date());
      const cortado = `respaldo-${hoy}-0001-automatico-completo.zip`;
      fs.writeFileSync(path.join(dir, cortado), entero.subarray(0, Math.floor(entero.length / 2)));

      const { respaldos, estado } = (await admin.pedir('/api/respaldos')).json;
      assert.equal(respaldos[0].nombre, cortado, 'es el más nuevo de la carpeta');
      assert.equal(respaldos[0].bien, false, 'y la plataforma sabe que no sirve');
      assert.equal(estado.ultimo.nombre, viejo, 'el último es el último que sirve');
      assert.equal(estado.ultimoCompleto.nombre, viejo);
      assert.equal(estado.alDia, false);
      assert.equal(estado.danados, 1);

      assert.ok(avisoDelTablero(comoSeLee((await admin.pedir('/')).texto), 'El último respaldo es de hace 5 días'));

      const pantalla = comoSeLee((await admin.pedir('/respaldos')).texto);
      assert.match(pantalla, /Dañado · no sirve/);
      assert.match(pantalla, new RegExp(`href="/api/respaldos/${viejo}"[^>]*>(?:<[^>]+>)*[^<]*Bajar el último completo`));
      assert.doesNotMatch(pantalla, new RegExp(`href="/api/respaldos/${cortado}"`), 'el cortado no se ofrece para bajar');
    });
  });

  describe('el respaldo a mano pasa por las mismas reglas', () => {
    test('«Hacer un respaldo ahora» poda lo que sobra, dice qué borró y lo deja en la bitácora', async () => {
      // En la carpeta: el completo de hace 5 días y el cortado de hoy. Se añaden
      // dos completos más viejos, copias del bueno.
      const dir = path.join(app.carpetaDatos, 'respaldos');
      const [viejo] = fs.readdirSync(dir).filter((n) => /-0900-manual-completo\.zip$/.test(n));
      const [cortado] = fs.readdirSync(dir).filter((n) => /-0001-automatico-completo\.zip$/.test(n));
      const entero = fs.readFileSync(path.join(dir, viejo));
      const masViejos = [20, 30].map((dias) => {
        const cuando = new Date(Date.now() - dias * 86400000);
        const nombre = `respaldo-${new Intl.DateTimeFormat('en-CA').format(cuando)}-0900-automatico-completo.zip`;
        fs.writeFileSync(path.join(dir, nombre), entero);
        fs.utimesSync(path.join(dir, nombre), cuando, cuando);
        return nombre;
      });

      const r = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'manual' }) });
      assert.equal(r.status, 201, r.texto);

      assert.deepEqual(
        r.json.podados.map((p) => p.nombre).sort(),
        [cortado, ...masViejos].sort(),
        'se fueron el cortado y los dos completos que ya no eran de los dos más recientes'
      );
      for (const p of r.json.podados) {
        assert.ok(p.bytes > 0 && p.razon, 'cada uno con su peso y su razón');
      }

      const quedan = (await admin.pedir('/api/respaldos')).json.respaldos;
      assert.deepEqual(quedan.map((x) => x.nombre), [r.json.nombre, viejo], 'quedan el nuevo y el completo bueno de antes');
      assert.deepEqual(
        fs.readdirSync(dir).filter((n) => n !== '.intento').sort(),
        [r.json.nombre, viejo].sort(),
        'y en la carpeta no quedó nada a medias'
      );

      const podas = bitacora('respaldo_podado');
      assert.equal(podas.length, 3);
      for (const nombre of [cortado, ...masViejos]) {
        const renglon = podas.find((p) => p.detalle.includes(nombre));
        assert.ok(renglon, `${nombre} desapareció sin rastro`);
        assert.equal(renglon.usuario, 'sistema');
        assert.match(renglon.detalle, /\([\d.]+ MB\) — /);
      }
      assert.match(podas.find((p) => p.detalle.includes(cortado)).detalle, /dañado o a medias/);

      const libro = comoSeLee((await admin.pedir('/bitacora')).texto);
      assert.match(libro, /respaldo_podado/, 'y se ve en la pantalla de Bitácora');
    });
  });
});

// ---------------------------------------------------------------------------

describe('sin sitio en el disco', () => {
  let app;
  let admin;
  let juridico;
  let finanzas;
  let servicio;

  before(async () => {
    // Una reserva más grande que cualquier disco: para la plataforma, no queda
    // un byte que se pueda usar. Es la misma variable con la que se configura.
    app = await arrancar({ env: { DISCO_RESERVA_MB: '100000000000' } });
    // El mismo freno que arriba: aquí se cuenta con que no hay ningún respaldo,
    // y la agenda, al no caberle el completo, haría sola el de la base.
    fs.mkdirSync(path.join(app.carpetaDatos, 'respaldos'), { recursive: true });
    fs.writeFileSync(path.join(app.carpetaDatos, 'respaldos', '.intento'), new Date().toISOString());
    admin = await app.entrarYAsentar(ROLES.admin);
    juridico = await app.entrarYAsentar(ROLES.juridico);
    finanzas = await app.entrarYAsentar(ROLES.finanzas);
    servicio = await abrirServicio(admin, 'DISCO LLENO');
  });

  after(async () => {
    await app?.cerrar();
  });

  /** Lo que tiene que decir cualquier respuesta de «no hay sitio». */
  function diceLoQueHayQueDecir(r, { queNoSeHizo }) {
    assert.equal(r.status, 507, `esperaba 507 y fue ${r.status}: ${r.texto.slice(0, 300)}`);
    assert.doesNotMatch(r.json.error, /Error interno/);
    assert.match(r.json.error, /disco del servidor/, 'qué pasó');
    assert.match(r.json.error, queNoSeHizo, 'que no se hizo nada a medias');
    assert.match(r.json.error, /Respaldos|Qué hacer/, 'y qué hacer');
  }

  test('subir el PDF del contrato dice que no hay sitio, y no deja nada', async () => {
    const r = await subir(app, juridico, `/api/servicios/${servicio}/contrato`);
    diceLoQueHayQueDecir(r, { queNoSeHizo: /No se guardó nada/ });
    assert.match(r.json.error, /No es un problema de tu archivo/);
    assert.match(r.json.error, /Avísale al administrador/, 'quien sube un contrato no es quien puede hacer sitio');

    assert.deepEqual(enCarpeta(app, 'archivos'), [], 'ni el archivo ni un pedazo');
    const baja = await juridico.pedir(`/api/servicios/${servicio}/contrato`);
    assert.equal(baja.status, 404, 'y el servicio no quedó diciendo que tiene un contrato que no existe');
  });

  test('subir el archivo de una factura, igual', async () => {
    const alta = await finanzas.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({ servicio_id: servicio, periodo: '2026-07', fecha_factura: HOY, importe: 1000 }),
    });
    assert.equal(alta.status, 201, alta.texto);

    const r = await subir(app, finanzas, `/api/facturas/${alta.json.id}/archivo`);
    diceLoQueHayQueDecir(r, { queNoSeHizo: /No se guardó nada/ });
    assert.deepEqual(enCarpeta(app, 'archivos'), []);
  });

  test('lo que no escribe archivos sigue funcionando: capturar no depende de esa comprobación', async () => {
    // La reserva protege a la base de las subidas; no le cierra la puerta a la
    // base. Con la plataforma negándose a guardar PDF, se sigue pudiendo abrir
    // un servicio.
    await abrirServicio(admin, 'DISCO LLENO, PERO SE CAPTURA');
  });

  test('«Hacer un respaldo ahora» dice que no cabe, no borra nada y no deja un pedazo', async () => {
    const r = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'manual' }) });
    diceLoQueHayQueDecir(r, { queNoSeHizo: /no se borró nada/ });
    assert.match(r.json.error, /No se hizo el respaldo porque no cabe/);

    assert.deepEqual((await admin.pedir('/api/respaldos')).json.respaldos, []);
    assert.deepEqual(
      enCarpeta(app, 'respaldos').filter((n) => n !== '.intento'),
      [],
      'ni un respaldo a medias ni la copia temporal de la base'
    );
  });

  test('el Tablero del administrador lo dice en rojo, con el enlace a Respaldos', async () => {
    const html = comoSeLee((await admin.pedir('/')).texto);

    const disco = avisoDelTablero(html, 'El disco del servidor está lleno');
    assert.ok(disco, 'el Tablero tiene que decir que el disco está lleno');
    assert.match(disco, /href="\/respaldos"/);
    assert.match(disco, /red-500/);
    assert.match(html, /Ya no se pueden subir contratos ni facturas/);

    // Y el otro aviso, el del respaldo, va aparte y también lleva a Respaldos:
    // como mucho dos, uno de cada cosa.
    const respaldo = avisoDelTablero(html, 'Todavía no hay ningún respaldo de la plataforma');
    assert.ok(respaldo);
    assert.match(respaldo, /href="\/respaldos"/);
    const avisos = (html.match(/<a [^>]*>/g) || []).filter(
      (a) => a.includes('href="/respaldos"') && a.includes('rounded-2xl px-4 py-3')
    );
    assert.equal(avisos.length, 2);
  });

  test('los demás roles no cargan con un aviso que no pueden arreglar', async () => {
    const html = comoSeLee((await juridico.pedir('/')).texto);
    assert.doesNotMatch(html, /El disco del servidor está lleno/);
    assert.doesNotMatch(html, /ningún respaldo/);
  });

  test('la pantalla de Respaldos dice qué ocupa el disco y qué se puede hacer', async () => {
    const html = comoSeLee((await admin.pedir('/respaldos')).texto);
    assert.match(html, /El disco del servidor está lleno/);
    assert.match(html, /El próximo respaldo completo pesaría unos [\d.]+ MB y ya no cabe/);
    assert.match(html, /Qué se puede hacer/);
    assert.match(html, /agrandar el disco del servidor/);
  });
});

// ---------------------------------------------------------------------------

/**
 * La escritura que se queda corta.
 *
 * Este bloque existe por lo que salió al probar el arreglo contra un disco
 * lleno de verdad —un tmpfs de 64 KB montado sobre la carpeta de adjuntos— en
 * vez de contra la reserva gigante de arriba. Subir un PDF de 200 KB contestó
 * 201, anotó 204,809 bytes en la ficha y dejó en el disco un archivo de 65,536.
 *
 * La causa: cuando el disco se llena a MEDIA escritura, el sistema no lanza;
 * escribe lo que cupo y devuelve cuántos bytes fueron. El error llega en la
 * llamada siguiente, y `escribirEntero` solo hacía una. Así que la función que
 * existe para que no queden archivos a medias renombraba uno a medias.
 *
 * La reserva de arriba no lo puede ver —ahí la escritura nunca empieza—, y
 * montar un disco pide permisos que la máquina de las pruebas no tiene. Por eso
 * aquí se provoca la escritura corta con el escritor de verdad, capado: escribe
 * en el disco, pero nunca más de lo que se le deja.
 */
describe('la escritura que se queda corta', () => {
  let disco;
  let dir;

  before(async () => {
    const { register } = await import('node:module');
    register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
    disco = await import(new URL('../lib/disco.js', import.meta.url).href);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-corta-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Un escritor que, como un disco apretado, nunca escribe más de `tope` bytes por llamada. */
  const deATramos = (tope) => (fd, buf, desde, largo) => fs.writeSync(fd, buf, desde, Math.min(largo, tope));

  /** Un disco al que le caben `sitio` bytes: escribe lo que quepa, luego nada, sin lanzar nunca. */
  function discoDe(sitio) {
    let queda = sitio;
    return (fd, buf, desde, largo) => {
      const n = Math.min(largo, queda);
      if (n > 0) fs.writeSync(fd, buf, desde, n);
      queda -= n;
      return n;
    };
  }

  test('si el sistema escribe a tramos, el archivo queda entero', () => {
    const datos = Buffer.from(Array.from({ length: 100000 }, (_, i) => i % 251));
    const ruta = path.join(dir, 'a-tramos.bin');
    const fd = fs.openSync(ruta, 'w');
    try {
      assert.equal(disco.escribirTodo(fd, datos, deATramos(7001)), datos.length);
    } finally {
      fs.closeSync(fd);
    }
    assert.ok(fs.readFileSync(ruta).equals(datos), 'byte por byte lo mismo que se mandó');
  });

  test('si se acaba el sitio a media escritura, lanza el mismo error que un disco lleno', async () => {
    const errores = await import(new URL('../lib/errores.js', import.meta.url).href);
    const datos = Buffer.alloc(200 * 1024, 7);
    const ruta = path.join(dir, 'cortado.bin');
    const fd = fs.openSync(ruta, 'w');
    let err = null;
    try {
      disco.escribirTodo(fd, datos, discoDe(64 * 1024));
    } catch (e) {
      err = e;
    } finally {
      fs.closeSync(fd);
    }
    assert.ok(err, 'no puede darse por escrito lo que no se escribió');
    assert.equal(err.code, 'ENOSPC');
    // Y ese error es de los que la plataforma sabe decir: no acaba en «Error interno».
    const r = errores.respuestaSinEspacio(err);
    assert.ok(r, 'se reconoce como disco lleno');
    assert.equal(r.status, 507);
  });

  test('el escritor de verdad no se quedó con la llamada única', () => {
    /**
     * Las dos pruebas de arriba inyectan el escritor; esta mira que el código
     * que corre en producción pase por ahí. Sin ella, alguien podría devolver
     * `escribirEntero` o el ZIP al `fs.writeSync` suelto y todo seguiría en
     * verde, porque en un disco con sitio las dos formas hacen lo mismo.
     */
    for (const archivo of ['../lib/disco.js', '../lib/zip.js', '../lib/archivos.js', '../lib/respaldos.js']) {
      const fuente = fs.readFileSync(new URL(archivo, import.meta.url), 'utf8');
      const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const sueltas = [...sinComentarios.matchAll(/fs\.writeSync\(/g)].length;
      // La única que se permite es el valor por omisión de `escribirTodo`, que
      // no es una llamada: `escribir = fs.writeSync`.
      assert.equal(sueltas, 0, `${archivo} llama a fs.writeSync sin mirar cuánto escribió`);
    }
  });
});
