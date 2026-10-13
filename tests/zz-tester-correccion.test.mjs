/**
 * Ataque del tester a la excepción «corrige tu propio dato el mismo día».
 *
 * La regla que esto ensancha es la decisión 2 del director —solo de vacío a
 * valor— y lo que protege es el precio que paga un cliente. Así que lo que se
 * prueba aquí no es que la corrección funcione: es que NO funcione fuera de los
 * seis límites del contrato.
 *
 *   1. Solo el dato propio.
 *   2. Solo el mismo día natural de `America/Mexico_City`.
 *   3. Con nombre y fecha, y legible qué decía antes, sin pisar el llenado.
 *   4. La regla general intacta: excepción estrecha y nombrada, no una grieta.
 *   5. Sin puertas nuevas: hereda ACTIVO, pertenencia, tipos y topes.
 *   6. Visible solo donde de verdad lleva a alguna parte.
 *
 * Nada de lo que afirma el coder se da por bueno: cada punto se vuelve a correr
 * aquí, y los vectores que su archivo no tocó —ventas y el administrador
 * corrigiendo lo suyo, el espectador, SUSPENDIDO, la codificación, el volumen,
 * el rastro de la razón social y el filo de la medianoche por el lado que rueda—
 * se corren por primera vez.
 *
 * Las pruebas que quedan EN ROJO son hallazgos, y cada una lo dice en su nombre.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const EN_MEXICO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** El único «hoy» que cuenta: el de la oficina. */
const HOY = EN_MEXICO.format(new Date());
const diaOficina = (marcaUtc) => EN_MEXICO.format(new Date(`${marcaUtc.replace(' ', 'T')}Z`));

/** Cuántas horas va el servidor por delante de la oficina. Medido, no escrito. */
const DESFASE = (() => {
  const ahora = new Date();
  const alla = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const aqui = new Date(ahora.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((aqui - alla) / 3_600_000);
})();

/** Una marca UTC como la que guarda la base, para una hora de la oficina. */
function marcaUtc(diaDeLaOficina, hora, minuto = 0, segundo = 0) {
  const [a, m, d] = diaDeLaOficina.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, hora + DESFASE, minuto, segundo))
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

const correrDias = (dia, n) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

const AYER = correrDias(HOY, -1);
const MANANA = correrDias(HOY, 1);

let app;
let admin;
let operaciones;
let ventas;
let finanzas;
let juridico;
let espectador;
let opciones;

const ESPECTADOR = 'mirona@corporativoultra.com';

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

const corregir = (sesion, id, correcciones) => completar(sesion, id, { correcciones });

/** Un servicio nuevo con lo mínimo, abierto por quien se diga. */
async function abrir(sesion, nombre, extra = {}) {
  const r = await sesion.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: `${nombre} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
      ...extra,
    }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

const abrirMinimo = (nombre, extra) => abrir(operaciones, nombre, extra);

/** La base del servidor de prueba, para mirar y mover lo que no pasa por la API. */
function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const renglones = (id, accion = null) =>
  conLaBase((db) =>
    db
      .prepare(
        `SELECT id, accion, usuario, usuario_id, rol, detalle, cambios, creado_en FROM bitacora
          WHERE entidad = 'servicio' AND entidad_id = ? AND (? IS NULL OR accion = ?)
          ORDER BY id`
      )
      .all(Number(id), accion, accion)
      .map((r) => ({ ...r, cambios: JSON.parse(r.cambios || 'null') }))
  );

/** La cadena de un campo tal como la cuenta la bitácora, del más viejo al más nuevo. */
const cadenaDe = (id, campo) =>
  renglones(id)
    .filter((r) => r.cambios && Object.hasOwn(r.cambios, campo))
    .map((r) => ({ accion: r.accion, usuario: r.usuario, ...r.cambios[campo] }));

/** Mueve a otra hora los renglones de llenado y/o corrección de un servicio. */
function fechar(id, marca, acciones = ['alta_completada', 'alta_corregida']) {
  const marcas = acciones.map(() => '?').join(',');
  const movidas = conLaBase(
    (db) =>
      db
        .prepare(
          `UPDATE bitacora SET creado_en = ?
            WHERE entidad = 'servicio' AND entidad_id = ? AND accion IN (${marcas})`
        )
        .run(marca, Number(id), ...acciones).changes
  );
  assert.ok(movidas > 0, `no había renglón ${acciones.join('/')} que mover`);
  return movidas;
}

const avisosDe = async (sesion) => (await sesion.pedir('/api/avisos')).json;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  opciones = (await admin.pedir('/api/catalogos')).json;

  // El espectador no viene en el equipo del arranque: se da de alta aquí, que es
  // como se da de alta en producción.
  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({
      email: ESPECTADOR,
      nombre: 'Mirona de prueba',
      rol: 'espectador',
      password: PASSWORD_TEMPORAL,
    }),
  });
  assert.equal(alta.status, 201, alta.texto);
  espectador = await app.entrarYAsentar(ESPECTADOR);
});

after(async () => {
  await app?.cerrar();
});

// ---------------------------------------------------------------- Z0 · la base

describe('Z0 · la línea base que el cambio no debía mover', () => {
  test('Z0.1 las fixtures de tiempo caen en el día que dicen', () => {
    // Si esto falla, los filos de la medianoche no prueban nada.
    assert.equal(diaOficina(marcaUtc(HOY, 10)), HOY);
    assert.equal(diaOficina(marcaUtc(AYER, 23, 59)), AYER);
    assert.equal(diaOficina(marcaUtc(HOY, 0, 0)), HOY);
    assert.equal(marcaUtc(AYER, 23, 59).slice(0, 10), HOY, 'engaña a quien mire la cadena UTC');
    assert.equal(marcaUtc(HOY, 19).slice(0, 10), MANANA, 'y por el otro lado también');
  });

  test('Z0.2 los 217 y el filtro ?falta=1 siguen donde estaban', async () => {
    // Antes de que este archivo abra un solo servicio.
    const todos = (await admin.pedir('/api/servicios')).json.servicios;
    assert.equal(todos.length, 217, `servicios en la base: ${todos.length}`);

    const html = comoSeLee((await admin.pedir('/estado-fuerza?falta=1')).texto);
    assert.match(html, /217 servicios/, 'la etiqueta de «le falta capturar» sigue saliendo en los 217');
    assert.match(html, /880 guardias/);
  });
});

// ------------------------------------------- Z1 · quién entra y quién no entra

describe('Z1 · los roles, uno por uno', () => {
  test('Z1.1 ventas corrige lo que ventas llenó', async () => {
    const id = await abrir(ventas, 'Z1 VENTAS');
    const lleno = await completar(ventas, id, { precio_guardia: 95000 });
    assert.equal(lleno.status, 200, lleno.texto);

    const r = await corregir(ventas, id, { precio_guardia: 9500 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, { precio_guardia: { antes: 95000, despues: 9500 } });
    assert.equal((await ficha(id)).precio_guardia, 9500);
  });

  test('Z1.2 operaciones corrige lo que operaciones llenó', async () => {
    const id = await abrirMinimo('Z1 OPERACIONES');
    await completar(operaciones, id, { dias_credito: 300 });
    const r = await corregir(operaciones, id, { dias_credito: 30 });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).dias_credito, 30);
  });

  test('Z1.3 el administrador corrige lo que el administrador llenó', async () => {
    const id = await abrir(admin, 'Z1 ADMIN');
    await completar(admin, id, { direccion: 'Calle Admin 1' });
    const r = await corregir(admin, id, { direccion: 'Calle Admin 2' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).direccion, 'Calle Admin 2');
  });

  test('Z1.4 finanzas, jurídico, espectador y el anónimo no entran', async () => {
    const id = await abrirMinimo('Z1 SIN PERMISO');
    await completar(operaciones, id, { direccion: 'Calle Firme 1' });

    for (const [quien, sesion] of [
      ['finanzas', finanzas],
      ['juridico', juridico],
      ['espectador', espectador],
    ]) {
      const r = await corregir(sesion, id, { direccion: 'Calle Robada' });
      assert.equal(r.status, 403, `${quien} → ${r.status} ${r.texto.slice(0, 120)}`);
    }
    const sin = await corregir(app.anonimo(), id, { direccion: 'Calle Robada' });
    assert.ok([401, 302, 307].includes(sin.status), `sin sesión → ${sin.status}`);

    assert.equal((await ficha(id)).direccion, 'Calle Firme 1');
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });
});

// --------------------------------------------------- Z2 · el dato de otra gente

describe('Z2 · el dato ajeno, disfrazado por todos los caminos', () => {
  test('Z2.1 de frente: ventas no corrige lo que llenó operaciones', async () => {
    const id = await abrirMinimo('Z2 DE FRENTE');
    await completar(operaciones, id, { razon_social: 'DE OPERACIONES SA' });
    const r = await corregir(ventas, id, { razon_social: 'DE VENTAS SA' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo capturó Operaciones de prueba/);
    assert.equal((await ficha(id)).razon_social, 'DE OPERACIONES SA');
  });

  test('Z2.2 escondido en un lote: el hueco bueno tampoco se escribe', async () => {
    // El vector es el lote mixto: una corrección ajena viajando junto a un
    // llenado legítimo. Si el llenado entrara, el 400 sería mentira a medias.
    const id = await abrirMinimo('Z2 LOTE MIXTO');
    await completar(operaciones, id, { razon_social: 'AJENA SA' });

    const r = await completar(ventas, id, {
      direccion: 'Calle De Ventas 9',
      correcciones: { razon_social: 'MIA SA' },
    });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(id);
    assert.equal(s.razon_social, 'AJENA SA');
    assert.equal(s.direccion, null, 'el llenado del mismo lote no se guardó');
  });

  test('Z2.3 tras la corrección del dueño, sigue siendo del dueño', async () => {
    const id = await abrirMinimo('Z2 TRAS CORRECCION');
    await completar(operaciones, id, { precio_guardia: 100 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 200 })).status, 200);
    const r = await corregir(ventas, id, { precio_guardia: 300 });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).precio_guardia, 200);
  });

  test('Z2.4 un renglón de llenado de dos campos no reparte autoría', async () => {
    const id = await abrirMinimo('Z2 DOS CAMPOS');
    await completar(operaciones, id, { razon_social: 'DOS SA', direccion: 'Calle Dos 2' });
    for (const campo of ['razon_social', 'direccion']) {
      const r = await corregir(ventas, id, { [campo]: 'ROBADO' });
      assert.equal(r.status, 400, `${campo} → ${r.status}`);
    }
  });

  test('Z2.5 lo que el administrador editó no lo corrige nadie por esta vía, ni él', async () => {
    const id = await abrirMinimo('Z2 TRAS EDICION');
    await completar(operaciones, id, { precio_guardia: 5000 });
    const edicion = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ precio_guardia: 6000 }),
    });
    assert.equal(edicion.status, 200, edicion.texto);

    const delAutor = await corregir(operaciones, id, { precio_guardia: 5500 });
    assert.equal(delAutor.status, 400, delAutor.texto);
    assert.match(delAutor.json.error, /editando la ficha/);

    // Y el administrador tampoco: su edición no es un llenado de hueco. Si
    // entrara, la excepción se habría generalizado a «editar lo reciente».
    const delAdmin = await corregir(admin, id, { precio_guardia: 5500 });
    assert.equal(delAdmin.status, 400, delAdmin.texto);
    assert.equal((await ficha(id)).precio_guardia, 6000);
  });

  test('Z2.6 lo que llenó el administrador no lo corrige ventas', async () => {
    const id = await abrir(admin, 'Z2 DEL ADMIN');
    await completar(admin, id, { dias_credito: 7 });
    const r = await corregir(ventas, id, { dias_credito: 70 });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).dias_credito, 7);
  });
});

// ------------------------------------------------- Z3 · lo que no nació aquí

describe('Z3 · la importación y la apertura', () => {
  test('Z3.1 un dato de los 217 no se corrige, con ningún rol', async () => {
    // De la carga inicial, la razón social viene en 214 de 217 y el supervisor
    // en 196: los dos son dato de importación, y ninguno pasó por el panel.
    const lista = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    const viejo = lista.find((s) => s.razon_social && s.supervisor);
    assert.ok(viejo, 'la carga trae servicios con razón social y supervisor');

    for (const [campo, nuevo] of [
      ['razon_social', 'REESCRITA SA'],
      ['supervisor', opciones.supervisores[0]],
    ]) {
      for (const [quien, sesion] of [
        ['operaciones', operaciones],
        ['ventas', ventas],
        ['admin', admin],
      ]) {
        const r = await corregir(sesion, viejo.id, { [campo]: nuevo });
        assert.equal(r.status, 400, `${campo} · ${quien} → ${r.status} ${r.texto.slice(0, 160)}`);
        assert.match(r.json.error, /ya venía cargado/);
      }
    }
    const s = await ficha(viejo.id);
    assert.equal(s.razon_social, viejo.razon_social);
    assert.equal(s.supervisor, viejo.supervisor);
  });

  test('Z3.2 ni la zona ni el asesor que escribió la apertura', async () => {
    const id = await abrirMinimo('Z3 APERTURA');
    for (const [campo, valor] of [
      ['zona', opciones.zonas[1]],
      ['asesor', opciones.asesores[1]],
    ]) {
      const r = await corregir(operaciones, id, { [campo]: valor });
      assert.equal(r.status, 400, `${campo} → ${r.status}`);
      assert.match(r.json.error, /ya venía cargado/);
    }
    const s = await ficha(id);
    assert.equal(s.zona, opciones.zonas[0]);
    assert.equal(s.asesor, opciones.asesores[0]);
  });
});

// --------------------------------------------------- Z4 · el día, y sus filos

describe('Z4 · el mismo día natural, y lo que pasa en el filo', () => {
  test('Z4.1 lo de ayer no se corrige hoy', async () => {
    const id = await abrirMinimo('Z4 AYER');
    await completar(operaciones, id, { precio_guardia: 4000 });
    fechar(id, marcaUtc(AYER, 12));
    const r = await corregir(operaciones, id, { precio_guardia: 4500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER} y hoy es ${HOY}`));
    assert.equal((await ficha(id)).precio_guardia, 4000);
  });

  test('Z4.2 las 23:59 de anoche son de ayer aunque en UTC ya fuera hoy', async () => {
    const id = await abrirMinimo('Z4 FILO CERRADO');
    await completar(operaciones, id, { precio_guardia: 3000 });
    const anoche = marcaUtc(AYER, 23, 59);
    assert.equal(anoche.slice(0, 10), HOY, 'la fixture engaña a quien mire la cadena');
    fechar(id, anoche);
    const r = await corregir(operaciones, id, { precio_guardia: 3500 });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).precio_guardia, 3000);
  });

  test('Z4.3 las 19:00 de hoy siguen siendo de hoy aunque en UTC ya sea mañana', async () => {
    const id = await abrirMinimo('Z4 FILO ABIERTO');
    await completar(operaciones, id, { precio_guardia: 2000 });
    const tarde = marcaUtc(HOY, 19);
    assert.equal(tarde.slice(0, 10), MANANA);
    fechar(id, tarde);
    const r = await corregir(operaciones, id, { precio_guardia: 2500 });
    assert.equal(r.status, 200, r.texto);
  });

  test('Z4.4 la ventana la manda el llenado, no el último renglón', async () => {
    /**
     * Esta prueba nació al revés, y a propósito: exigía 200 para documentar el
     * mecanismo del hallazgo Z4.5 —mover el LLENADO a ayer y dejar la
     * corrección de hoy mantenía la ventana abierta, porque la autoría la daba
     * el último renglón—. Mientras el defecto existió, su 200 era su huella.
     *
     * Cerrado el defecto, la ventana se ancla al día del llenado y el signo se
     * invierte. Queda como regresión de Z4.5 por el otro lado: montan el mismo
     * estado, así que las dos no pueden pedir lo mismo, y es esta la que dice
     * qué debe pasar cuando el llenado ya es de ayer.
     */
    const id = await abrirMinimo('Z4 ULTIMA PALABRA');
    await completar(operaciones, id, { precio_guardia: 1000 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 1100 })).status, 200);
    fechar(id, marcaUtc(AYER, 10), ['alta_completada']);

    const r = await corregir(operaciones, id, { precio_guardia: 1200 });
    assert.equal(r.status, 400, `el llenado es de ayer: la ventana está cerrada (status ${r.status})`);
    // Y lo que importa de verdad: no escribió.
    assert.equal((await ficha(id)).precio_guardia, 1100, 'el valor se queda en la última corrección válida');
  });

  test('Z4.5 HALLAZGO · la ventana rueda al día siguiente: lo llenado AYER se corrige HOY', async () => {
    /**
     * El estado que esto reproduce lo produce una sola petición real: una
     * corrección legítima guardada en el último instante del día de la oficina.
     * `hoy()` se lee en el momento de decidir y el renglón se inserta con
     * `datetime('now')`; si el INSERT cae al otro lado de la medianoche de la
     * Ciudad de México, el renglón nuevo queda fechado MAÑANA, y mañana vuelve a
     * dar autoría durante todo el día.
     *
     * El llenado fue AYER. El contrato dice «solo el mismo día». Hoy debería
     * contestar 400 «se capturó el AYER y hoy es HOY»; contesta 200 y escribe.
     */
    const id = await abrirMinimo('Z4 RUEDA');
    await completar(operaciones, id, { precio_guardia: 8000 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 8100 })).status, 200);

    // El llenado y la primera corrección, en el último minuto de ayer; el
    // renglón de la corrección, ya del lado de hoy.
    fechar(id, marcaUtc(AYER, 23, 59, 59), ['alta_completada']);
    fechar(id, marcaUtc(HOY, 0, 0, 0), ['alta_corregida']);
    const cadena = cadenaDe(id, 'precio_guardia');
    assert.equal(cadena.length, 2, 'la fixture deja el llenado de ayer y la corrección de hoy');

    const r = await corregir(operaciones, id, { precio_guardia: 1 });
    assert.equal(
      r.status,
      400,
      `HALLAZGO: el dato se llenó el ${AYER} y hoy ${HOY} se corrigió igual (status ${r.status}, ` +
        `valor final ${(await ficha(id)).precio_guardia})`
    );
  });
});

// ------------------------------------------------- Z5 · los dos carriles

describe('Z5 · el carril de la corrección contra el del llenado', () => {
  test('Z5.1 un campo vacío no se llena por el carril de la corrección', async () => {
    const id = await abrirMinimo('Z5 VACIO');
    const r = await corregir(operaciones, id, { direccion: 'Calle Colada 1' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /todavía está vacío/);
    assert.equal((await ficha(id)).direccion, null);
  });

  test('Z5.2 un campo escrito no se cambia por el carril del llenado, con ningún rol', async () => {
    const id = await abrirMinimo('Z5 SUELTO');
    await completar(operaciones, id, { precio_guardia: 8000 });
    for (const [quien, sesion] of [
      ['el propio autor', operaciones],
      ['ventas', ventas],
      ['admin', admin],
    ]) {
      const r = await completar(sesion, id, { precio_guardia: 99999 });
      assert.equal(r.status, 200, `${quien} → ${r.status}`);
      assert.deepEqual(r.json.yaTenian, ['precio_guardia'], quien);
      assert.deepEqual(r.json.corregidos, {}, quien);
    }
    assert.equal((await ficha(id)).precio_guardia, 8000);
  });

  test('Z5.3 el mismo campo por los dos carriles a la vez se rechaza', async () => {
    const id = await abrirMinimo('Z5 DOS ORDENES');
    await completar(operaciones, id, { razon_social: 'UNA SA' });
    const r = await completar(operaciones, id, {
      razon_social: 'POR UN LADO SA',
      correcciones: { razon_social: 'POR EL OTRO SA' },
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /llegó como hueco y como corrección/);
    assert.equal((await ficha(id)).razon_social, 'UNA SA');
  });

  test('Z5.4 llenar un hueco y corregir otro campo en la misma petición', async () => {
    const id = await abrirMinimo('Z5 LAS DOS COSAS');
    await completar(operaciones, id, { precio_guardia: 500 });
    const r = await completar(operaciones, id, {
      direccion: 'Calle Mixta 3',
      correcciones: { precio_guardia: 550 },
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.llenados.direccion, { antes: null, despues: 'Calle Mixta 3' });
    assert.deepEqual(r.json.corregidos.precio_guardia, { antes: 500, despues: 550 });
    // Dos renglones, uno por cada hecho, y ninguno pisa al otro.
    assert.equal(renglones(id, 'alta_completada').length, 2);
    assert.equal(renglones(id, 'alta_corregida').length, 1);
  });

  test('Z5.5 «correcciones» que no es un objeto se contesta 400, no 500', async () => {
    const id = await abrirMinimo('Z5 NO OBJETO');
    await completar(operaciones, id, { direccion: 'Calle 1' });
    for (const cuerpo of [
      { correcciones: 'direccion' },
      { correcciones: [] },
      { correcciones: [{ direccion: 'x' }] },
      { correcciones: 7 },
      { correcciones: true },
    ]) {
      const r = await completar(operaciones, id, cuerpo);
      assert.equal(r.status, 400, `${JSON.stringify(cuerpo)} → ${r.status} ${r.texto.slice(0, 120)}`);
    }
    assert.equal((await ficha(id)).direccion, 'Calle 1');
  });

  test('Z5.6 «correcciones» nulo o vacío no es un error ni escribe nada', async () => {
    const id = await abrirMinimo('Z5 NULO');
    await completar(operaciones, id, { direccion: 'Calle 1' });
    for (const cuerpo of [{ correcciones: null }, { correcciones: {} }]) {
      const r = await completar(operaciones, id, cuerpo);
      assert.equal(r.status, 200, `${JSON.stringify(cuerpo)} → ${r.status}`);
      assert.deepEqual(r.json.corregidos, {});
    }
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });

  test('Z5.7 el cuerpo que no es un objeto, y las claves heredadas', async () => {
    const id = await abrirMinimo('Z5 CUERPO RARO');
    await completar(operaciones, id, { direccion: 'Calle 1' });
    for (const crudo of ['"texto"', 'null', '[]', '7', 'true']) {
      const r = await operaciones.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: crudo });
      assert.equal(r.status, 400, `cuerpo ${crudo} → ${r.status} ${r.texto.slice(0, 120)}`);
    }
    const herencia = await completar(operaciones, id, {
      correcciones: { __proto__: { x: 1 }, constructor: 'x', toString: 'x', estatus: 'BAJA', id: 9 },
    });
    assert.equal(herencia.status, 200, herencia.texto);
    assert.deepEqual(herencia.json.corregidos, {});
    const s = await ficha(id);
    assert.equal(s.estatus, 'ACTIVO');
    assert.equal(s.direccion, 'Calle 1');
  });

  test('Z5.8 «correcciones» anidado en sí mismo no abre nada', async () => {
    const id = await abrirMinimo('Z5 ANIDADO');
    await completar(operaciones, id, { precio_guardia: 1000 });
    const r = await completar(operaciones, id, {
      correcciones: { correcciones: { precio_guardia: 1 } },
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, {});
    assert.ok(r.json.rechazados.includes('correcciones'));
    assert.equal((await ficha(id)).precio_guardia, 1000);
  });
});

// --------------------------------------- Z6 · tipos, topes, letras y volumen

describe('Z6 · tipos, topes, codificación y volumen', () => {
  let id;
  before(async () => {
    id = await abrirMinimo('Z6 ENTRADA DURA');
    const r = await completar(operaciones, id, {
      precio_guardia: 1234.5,
      razon_social: 'DURA SA',
      dias_credito: 30,
      uniforme: opciones.uniformes[0],
      esquema_facturacion: 'FIN_MES',
    });
    assert.equal(r.status, 200, r.texto);
  });

  const sinTocar = async (correcciones, etiqueta) => {
    const antes = await ficha(id);
    const r = await corregir(operaciones, id, correcciones);
    const despues = await ficha(id);
    for (const k of Object.keys(correcciones)) {
      assert.deepEqual(despues[k], antes[k], `${etiqueta}: ${k} cambió a ${despues[k]}`);
    }
    return r;
  };

  test('Z6.1 lo que no es texto ni número se rechaza', async () => {
    for (const valor of [[], {}, ['a'], [[]], true, false, { despues: 'x' }]) {
      const r = await sinTocar({ razon_social: valor }, JSON.stringify(valor));
      assert.equal(r.status, 400, `${JSON.stringify(valor)} → ${r.status}`);
    }
  });

  test('Z6.2 los topes de cordura y los números que no se entienden', async () => {
    for (const [valor, patron] of [
      ['carísimo', /no es un número/],
      [1e9, /no puede pasar de/],
      [1e21, /no puede pasar de/],
      [-5, /no puede ser negativo/],
    ]) {
      const r = await sinTocar({ precio_guardia: valor }, String(valor));
      assert.equal(r.status, 400, `${valor} → ${r.status}`);
      assert.match(r.json.error, patron);
    }
    for (const valor of [4000, '1,234.56', 366]) {
      const r = await sinTocar({ dias_credito: valor }, String(valor));
      assert.equal(r.status, 400, `dias_credito ${valor} → ${r.status}`);
      assert.match(r.json.error, /no puede pasar de 365/);
    }
  });

  test('Z6.3 el catálogo y el esquema se siguen exigiendo', async () => {
    const uni = await sinTocar({ uniforme: 'UNIFORME QUE NO EXISTE' }, 'uniforme');
    assert.equal(uni.status, 400);
    const esq = await sinTocar({ esquema_facturacion: 'CUANDO SE PUEDA' }, 'esquema');
    assert.equal(esq.status, 400);
  });

  test('Z6.4 en blanco no borra', async () => {
    for (const blanco of ['', '   ', '\t\n ', null]) {
      const r = await sinTocar({ razon_social: blanco }, JSON.stringify(blanco));
      assert.ok([200, 400].includes(r.status), `${JSON.stringify(blanco)} → ${r.status}`);
      if (r.status === 400) assert.match(r.json.error, /no lo borra|vacío/);
    }
    assert.equal((await ficha(id)).razon_social, 'DURA SA');
  });

  test('Z6.5 acentos, ñ y emojis van y vuelven iguales, y se pueden volver a corregir', async () => {
    // El segundo paso es el que importa: el guardia del valor compara lo que
    // dice la columna contra lo que dice la bitácora. Si el viaje por JSON y por
    // SQLite cambiara un solo byte, la segunda corrección se negaría a sí misma.
    const propio = await abrirMinimo('Z6 LETRAS');
    await completar(operaciones, propio, { razon_social: 'INICIAL SA' });

    const raro = 'Ñandú Söl 🚨 Acción café — S.A. de C.V.';
    const uno = await corregir(operaciones, propio, { razon_social: raro });
    assert.equal(uno.status, 200, uno.texto);
    assert.equal((await ficha(propio)).razon_social, raro);
    assert.deepEqual(cadenaDe(propio, 'razon_social').at(-1).despues, raro);

    const dos = await corregir(operaciones, propio, { razon_social: `${raro} II` });
    assert.equal(dos.status, 200, `la segunda corrección sobre un valor con emoji: ${dos.texto}`);
    assert.deepEqual(dos.json.corregidos.razon_social, { antes: raro, despues: `${raro} II` });
  });

  test('Z6.6 una cadena larguísima por el carril de la corrección', async () => {
    const propio = await abrirMinimo('Z6 LARGO');
    await completar(operaciones, propio, { direccion: 'Calle Corta 1' });
    const larga = 'Á'.repeat(20_000);
    const r = await corregir(operaciones, propio, { direccion: larga });
    // No se afirma cuál es lo correcto: se mide. Si entra, queda anotado que el
    // carril de la corrección no pone tope a los textos, igual que el llenado.
    assert.ok([200, 400].includes(r.status), `20 000 caracteres → ${r.status}`);
    if (r.status === 200) {
      assert.equal((await ficha(propio)).direccion.length, 20_000, 'se guardó sin truncar en silencio');
      // Y la ficha sigue dibujándose.
      const html = await operaciones.pedir(`/estado-fuerza/${propio}`);
      assert.equal(html.status, 200);
    }
  });

  test('Z6.7 el cero es una respuesta: se corrige a cero y desde cero', async () => {
    const propio = await abrirMinimo('Z6 CERO');
    await completar(operaciones, propio, { precio_guardia: 7000 });
    const aCero = await corregir(operaciones, propio, { precio_guardia: 0 });
    assert.equal(aCero.status, 200, aCero.texto);
    assert.equal((await ficha(propio)).precio_guardia, 0);
    const deCero = await corregir(operaciones, propio, { precio_guardia: 6500 });
    assert.equal(deCero.status, 200, deCero.texto);
    assert.deepEqual(deCero.json.corregidos.precio_guardia, { antes: 0, despues: 6500 });
  });

  test('Z6.8 volumen: doce correcciones seguidas y la cadena se lee entera', async () => {
    const propio = await abrirMinimo('Z6 VOLUMEN');
    await completar(operaciones, propio, { precio_guardia: 1 });
    for (let n = 2; n <= 13; n++) {
      const r = await corregir(operaciones, propio, { precio_guardia: n });
      assert.equal(r.status, 200, `corrección ${n}: ${r.texto}`);
    }
    const cadena = cadenaDe(propio, 'precio_guardia');
    assert.equal(cadena.length, 13, 'un renglón por hecho');
    for (let i = 1; i < cadena.length; i++) {
      assert.deepEqual(
        cadena[i].antes,
        cadena[i - 1].despues,
        `el eslabón ${i} no engancha: ${JSON.stringify(cadena[i - 1])} → ${JSON.stringify(cadena[i])}`
      );
    }
    assert.equal((await ficha(propio)).precio_guardia, cadena.at(-1).despues);
  });
});

// ----------------------------------------------------------- Z7 · el estatus

describe('Z7 · solo sobre un servicio que opera', () => {
  test('Z7.1 en un servicio SUSPENDIDO no se corrige', async () => {
    const id = await abrirMinimo('Z7 SUSPENDIDO');
    await completar(operaciones, id, { precio_guardia: 1000 });
    const sus = await admin.pedir(`/api/servicios/${id}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'El cliente lo paró un mes' }),
    });
    assert.equal(sus.status, 200, sus.texto);
    assert.equal((await ficha(id)).estatus, 'SUSPENDIDO');

    const r = await corregir(operaciones, id, { precio_guardia: 1100 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya no se le captura el alta/);
    assert.equal((await ficha(id)).precio_guardia, 1000);

    // Y al reactivarlo, el mismo día, vuelve a poderse: la puerta la cierra el
    // estatus y no un estado nuevo que haya que limpiar.
    const alta = await admin.pedir(`/api/servicios/${id}/suspension`, {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    assert.equal(alta.status, 200, alta.texto);
    const otra = await corregir(operaciones, id, { precio_guardia: 1100 });
    assert.equal(otra.status, 200, otra.texto);
  });

  test('Z7.2 en un servicio de BAJA no se corrige', async () => {
    const id = await abrirMinimo('Z7 BAJA');
    await completar(operaciones, id, { precio_guardia: 2000 });
    const can = await operaciones.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: id,
        fecha: HOY,
        motivo: opciones.motivosBaja[0],
      }),
    });
    assert.equal(can.status, 201, can.texto);
    const r = await corregir(operaciones, id, { precio_guardia: 2100 });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).precio_guardia, 2000);
  });
});

// --------------------------------------- Z8 · concurrencia y estado sucio

describe('Z8 · dos manos a la vez, y correr dos veces', () => {
  test('Z8.1 dos correcciones simultáneas: la bitácora no puede quedar mintiendo', async () => {
    const id = await abrirMinimo('Z8 CARRERA');
    await completar(operaciones, id, { precio_guardia: 100 });
    const [a, b] = await Promise.all([
      corregir(operaciones, id, { precio_guardia: 200 }),
      corregir(operaciones, id, { precio_guardia: 300 }),
    ]);
    assert.equal(a.status, 200, a.texto);
    assert.equal(b.status, 200, b.texto);

    const cadena = cadenaDe(id, 'precio_guardia');
    const final = (await ficha(id)).precio_guardia;
    // Lo que no puede pasar: que dos renglones digan que partieron del mismo
    // valor, o que el valor de la columna no sea el del último renglón. Las dos
    // cosas dejan la bitácora afirmando algo que no ocurrió.
    for (let i = 1; i < cadena.length; i++) {
      assert.deepEqual(
        cadena[i].antes,
        cadena[i - 1].despues,
        `la cadena se rompe: ${JSON.stringify(cadena)}`
      );
    }
    assert.equal(final, cadena.at(-1).despues, `la columna dice ${final} y el último renglón otra cosa`);
  });

  test('Z8.2 una corrección mientras el administrador edita por la vía normal', async () => {
    const id = await abrirMinimo('Z8 CRUCE');
    await completar(operaciones, id, { precio_guardia: 400 });
    const [corr, edic] = await Promise.all([
      corregir(operaciones, id, { precio_guardia: 444 }),
      admin.pedir(`/api/servicios/${id}`, { method: 'PATCH', body: JSON.stringify({ precio_guardia: 888 }) }),
    ]);
    const final = (await ficha(id)).precio_guardia;
    const cadena = cadenaDe(id, 'precio_guardia');
    // Uno de los dos puede perder, pero el que quede escrito tiene que ser el
    // que la bitácora dice al final, y el que pierda no puede decir que ganó.
    assert.equal(
      final,
      cadena.at(-1).despues,
      `columna ${final} · bitácora ${JSON.stringify(cadena)} · corrección ${corr.status} · edición ${edic.status}`
    );
  });

  test('Z8.3 el mismo PATCH de corrección dos veces no deja dos renglones', async () => {
    const id = await abrirMinimo('Z8 DOS VECES');
    await completar(operaciones, id, { precio_guardia: 600 });
    const uno = await corregir(operaciones, id, { precio_guardia: 650 });
    assert.equal(uno.status, 200, uno.texto);
    const dos = await corregir(operaciones, id, { precio_guardia: 650 });
    assert.equal(dos.status, 200, dos.texto);
    assert.deepEqual(dos.json.corregidos, {}, 'corregir por el mismo valor no es un hecho');
    assert.equal(renglones(id, 'alta_corregida').length, 1);
    assert.equal((await ficha(id)).precio_guardia, 650);
  });

  test('Z8.4 una corrección que falla a la mitad no deja la ficha a medias', async () => {
    const id = await abrirMinimo('Z8 LOTE MALO');
    await completar(operaciones, id, { precio_guardia: 500, razon_social: 'LOTE SA' });
    const r = await corregir(operaciones, id, { precio_guardia: 600, razon_social: [] });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 500);
    assert.equal(s.razon_social, 'LOTE SA');
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });
});

// --------------------------------------------------- Z9 · el rastro, de verdad

describe('Z9 · el rastro, y el fallo silencioso', () => {
  test('Z9.1 la corrección deja nombre, rol, fecha y el antes de verdad', async () => {
    const id = await abrirMinimo('Z9 RASTRO');
    await completar(ventas, id, { razon_social: 'EQUIVOCADA SA' });
    // Ojo: la llenó ventas, así que la corrige ventas.
    const r = await corregir(ventas, id, { razon_social: 'CORRECTA SA DE CV' });
    assert.equal(r.status, 200, r.texto);

    const llenado = renglones(id, 'alta_completada');
    const arreglo = renglones(id, 'alta_corregida');
    assert.equal(llenado.length, 1, 'el llenado original no se pisa');
    assert.equal(arreglo.length, 1);
    assert.deepEqual(llenado[0].cambios.razon_social, { antes: null, despues: 'EQUIVOCADA SA' });
    assert.deepEqual(arreglo[0].cambios.razon_social, {
      antes: 'EQUIVOCADA SA',
      despues: 'CORRECTA SA DE CV',
    });
    assert.equal(arreglo[0].usuario, 'Ventas de prueba');
    assert.equal(arreglo[0].rol, 'ventas');
    assert.equal(diaOficina(arreglo[0].creado_en), HOY);
    // Y el texto del renglón no puede contar otra historia que el JSON.
    assert.match(arreglo[0].detalle, /«EQUIVOCADA SA» → «CORRECTA SA DE CV»/);
  });

  test('Z9.2 un precio corregido entra en el historial de precios', async () => {
    const id = await abrirMinimo('Z9 HISTORIAL');
    await completar(operaciones, id, { precio_guardia: 9000 });
    await corregir(operaciones, id, { precio_guardia: 900 });
    const filas = conLaBase((db) =>
      db
        .prepare('SELECT precio_anterior, precio_nuevo FROM precios_historial WHERE servicio_id = ? ORDER BY id')
        .all(Number(id))
    );
    assert.equal(filas.length, 2, `historial: ${JSON.stringify(filas)}`);
    assert.equal(filas[1].precio_anterior, 9000);
    assert.equal(filas[1].precio_nuevo, 900);
  });

  test('Z9.3 HALLAZGO · la razón social cambia sin motivo, sin aviso a jurídico y fuera de la tabla de correcciones', async () => {
    /**
     * `razon_social` está en `CAMPOS_BLOQUEADOS` del RBAC a propósito: «el nombre
     * legal del cliente, lo que dice el contrato y lo que va en la factura. Se
     * cambia por corrección —con motivo escrito y registro aparte— y no por la
     * edición corriente de la ficha». `CORRECCION_POR_ROL` la da a jurídico y al
     * administrador, `AREA_DEL_CAMPO` la manda avisar a jurídico, y
     * `corregirServicio()` exige motivo y deja renglón en la tabla
     * `correcciones`.
     *
     * Por el carril nuevo, ventas la cambia el mismo día sin motivo, sin aviso y
     * sin entrar en esa tabla: las tres garantías con las que ese campo se
     * protegía se saltan a la vez.
     */
    const id = await abrirMinimo('Z9 RAZON SOCIAL');
    const antesAvisos = (await avisosDe(juridico)).sinLeer;
    const antesTabla = conLaBase((db) => db.prepare('SELECT COUNT(*) n FROM correcciones').get().n);

    await completar(ventas, id, { razon_social: 'CLIENTE UNO SA' });
    const r = await corregir(ventas, id, { razon_social: 'CLIENTE OTRO SA DE CV' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).razon_social, 'CLIENTE OTRO SA DE CV');

    const despuesAvisos = (await avisosDe(juridico)).sinLeer;
    const despuesTabla = conLaBase((db) => db.prepare('SELECT COUNT(*) n FROM correcciones').get().n);

    assert.ok(
      despuesAvisos > antesAvisos || despuesTabla > antesTabla,
      `HALLAZGO: el nombre legal del cliente cambió por esta vía y jurídico no se enteró ` +
        `(avisos sin leer ${antesAvisos} → ${despuesAvisos}) ni quedó en la tabla de correcciones ` +
        `(${antesTabla} → ${despuesTabla}). El único rastro es un renglón «alta_corregida» de la bitácora.`
    );
  });

  test('Z9.4 corregir por el mismo valor contesta 200 y lo dice', async () => {
    const id = await abrirMinimo('Z9 MISMO VALOR');
    await completar(operaciones, id, { razon_social: 'IGUAL SA' });
    const r = await corregir(operaciones, id, { razon_social: '  IGUAL   SA  ' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, {}, 'y no inventa un hecho');
    assert.equal(renglones(id, 'alta_corregida').length, 0);
    assert.equal((await ficha(id)).razon_social, 'IGUAL SA');
  });

  test('Z9.5 lo que contesta la API es lo que quedó en la base', async () => {
    const id = await abrirMinimo('Z9 SIN SILENCIO');
    await completar(operaciones, id, { precio_guardia: 3333, dias_credito: 10 });
    const r = await corregir(operaciones, id, { precio_guardia: 3030, dias_credito: 15 });
    assert.equal(r.status, 200, r.texto);
    const s = await ficha(id);
    for (const [campo, { despues }] of Object.entries(r.json.corregidos)) {
      assert.equal(s[campo], despues, `la API dijo ${despues} para ${campo} y la base dice ${s[campo]}`);
    }
    assert.equal(Object.keys(r.json.corregidos).length, 2);
  });
});

// ------------------------------------------------------------ Z10 · lo que se ve

describe('Z10 · el camino se ofrece solo donde lleva a alguna parte', () => {
  const BLOQUE = 'Corregir lo que capturaste hoy';
  const panel = async (sesion, id) => comoSeLee((await sesion.pedir(`/estado-fuerza/${id}`)).texto);

  test('Z10.1 lo ve quien capturó, y nadie más en la misma ficha', async () => {
    const id = await abrir(ventas, 'Z10 QUIEN LO VE');
    await completar(ventas, id, { precio_guardia: 4444 });

    assert.match(await panel(ventas, id), new RegExp(BLOQUE));
    for (const [quien, sesion] of [
      ['operaciones', operaciones],
      ['admin', admin],
      ['finanzas', finanzas],
      ['juridico', juridico],
      ['espectador', espectador],
    ]) {
      const html = await panel(sesion, id);
      assert.doesNotMatch(html, new RegExp(BLOQUE), `${quien} ve un bloque que no es suyo`);
      assert.doesNotMatch(html, /id="corregir-precio_guardia"/, `${quien} ve el control`);
    }
  });

  test('Z10.2 el bloque dice qué campo es y lo que dice ahora', async () => {
    const id = await abrirMinimo('Z10 ETIQUETA');
    await completar(operaciones, id, { precio_guardia: 5555 });
    const html = await panel(operaciones, id);
    assert.match(html, /id="corregir-precio_guardia"/);
    assert.match(html, /ahora dice «5555»/);
  });

  test('Z10.3 pasada la medianoche el bloque desaparece', async () => {
    const id = await abrirMinimo('Z10 AYER');
    await completar(operaciones, id, { precio_guardia: 6666 });
    assert.match(await panel(operaciones, id), new RegExp(BLOQUE));
    fechar(id, marcaUtc(AYER, 12));
    assert.doesNotMatch(await panel(operaciones, id), new RegExp(BLOQUE));
  });

  test('Z10.4 en un servicio SUSPENDIDO no hay bloque aunque se haya capturado hoy', async () => {
    const id = await abrirMinimo('Z10 SUSPENDIDO');
    await completar(operaciones, id, { precio_guardia: 7777 });
    await admin.pedir(`/api/servicios/${id}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Parado un mes' }),
    });
    const html = await panel(operaciones, id);
    assert.doesNotMatch(html, new RegExp(BLOQUE));
    assert.doesNotMatch(html, /id="corregir-precio_guardia"/);
  });

  test('Z10.5 cuando ya no falta nada, el camino sigue y no se anuncia un hueco inexistente', async () => {
    const id = await abrirMinimo('Z10 COMPLETO');
    const todo = await completar(operaciones, id, {
      direccion: 'Calle Llena 1',
      supervisor: opciones.supervisores[0],
      gerente: opciones.gerentes[0],
      estado_geo: opciones.estados[0],
      uniforme: opciones.uniformes[0],
      tipo_repse: opciones.tiposRepse[0],
      razon_social: 'COMPLETA SA',
      precio_guardia: 8888,
      esquema_facturacion: 'FIN_MES',
      forma_pago: opciones.formasPago[0],
      dias_credito: 30,
    });
    assert.equal(todo.status, 200, todo.texto);
    const falta = (await admin.pedir(`/api/servicios/${id}`)).json;
    const html = await panel(operaciones, id);
    assert.match(html, new RegExp(BLOQUE), 'el camino se queda el mismo día');
    assert.doesNotMatch(
      html,
      /Falta por capturar/,
      `no debe anunciar huecos cuando no hay: ${JSON.stringify(falta.falta ?? falta.servicio?.falta ?? null)}`
    );
  });

  test('Z10.6 el renglón del estado de fuerza no ofrece un ancla que la ficha no monte', async () => {
    // El servicio del caso anterior ya no tiene huecos: el renglón tiene que
    // apuntar a «#editar» y no a «#completar» para los roles que editan, y para
    // quien no edita, a ninguno de los dos.
    const id = await abrirMinimo('Z10 ANCLA');
    await completar(operaciones, id, { precio_guardia: 9999 });
    const lista = comoSeLee((await operaciones.pedir(`/estado-fuerza?q=Z10 ANCLA`)).texto);
    const anclas = [...lista.matchAll(new RegExp(`/estado-fuerza/${id}#(\\w+)`, 'g'))].map((m) => m[1]);
    const html = await panel(operaciones, id);
    for (const ancla of new Set(anclas)) {
      assert.match(html, new RegExp(`id="${ancla}"`), `el renglón enlaza a #${ancla} y la ficha no lo monta`);
    }
  });
});

// ------------------------------- Z11 · la bitácora sucia, que es donde se apoya

describe('Z11 · una regla de permisos apoyada en un registro histórico', () => {
  test('Z11.1 un renglón ilegible no abre la puerta: se niega, no se asume', async () => {
    const id = await abrirMinimo('Z11 JSON ROTO');
    await completar(operaciones, id, { precio_guardia: 1000 });
    conLaBase((db) =>
      db
        .prepare(
          `UPDATE bitacora SET cambios = '{esto no es json'
            WHERE entidad = 'servicio' AND entidad_id = ? AND accion = 'alta_completada'`
        )
        .run(Number(id))
    );
    const r = await corregir(operaciones, id, { precio_guardia: 1100 });
    assert.equal(r.status, 400, `renglón ilegible → ${r.status} ${r.texto.slice(0, 160)}`);
    assert.equal((await ficha(id)).precio_guardia, 1000);
    // Y la ficha sigue dibujándose, sin bloque.
    const html = comoSeLee((await operaciones.pedir(`/estado-fuerza/${id}`)).texto);
    assert.doesNotMatch(html, /Corregir lo que capturaste hoy/);
  });

  test('Z11.2 un {antes, despues} vacío tampoco: sin valor que comparar, se niega', async () => {
    const id = await abrirMinimo('Z11 SIN DESPUES');
    await completar(operaciones, id, { precio_guardia: 2000 });
    for (const cambios of ['{"precio_guardia":{}}', '{"precio_guardia":null}', '{"precio_guardia":[]}', '{}']) {
      conLaBase((db) =>
        db
          .prepare(
            `UPDATE bitacora SET cambios = ?
              WHERE entidad = 'servicio' AND entidad_id = ? AND accion = 'alta_completada'`
          )
          .run(cambios, Number(id))
      );
      const r = await corregir(operaciones, id, { precio_guardia: 2100 });
      assert.equal(r.status, 400, `cambios ${cambios} → ${r.status} ${r.texto.slice(0, 140)}`);
      assert.equal((await ficha(id)).precio_guardia, 2000);
    }
  });

  test('Z11.3 un renglón de otra operación con la misma clave no da autoría', async () => {
    // El vector del «texto que se parece al de otra operación»: un renglón
    // posterior, de otra acción, que nombra el mismo campo con el mismo valor.
    const id = await abrirMinimo('Z11 DISFRAZ');
    await completar(operaciones, id, { precio_guardia: 3000 });
    const ventasId = conLaBase(
      (db) => db.prepare('SELECT id FROM usuarios WHERE email = ?').get(ROLES.ventas).id
    );
    conLaBase((db) =>
      db
        .prepare(
          `INSERT INTO bitacora (usuario_id, usuario, rol, accion, entidad, entidad_id, detalle, cambios)
           VALUES (?, 'Ventas de prueba', 'ventas', 'condiciones_cobro', 'servicio', ?, 'disfraz',
                   '{"precio_guardia":{"antes":null,"despues":3000}}')`
        )
        .run(ventasId, Number(id))
    );
    const r = await corregir(ventas, id, { precio_guardia: 3100 });
    assert.equal(r.status, 400, `un renglón de otra acción dio autoría: ${r.texto.slice(0, 200)}`);
    assert.equal((await ficha(id)).precio_guardia, 3000);
  });

  test('Z11.4 dos renglones del mismo día: manda el último, no el primero', async () => {
    const id = await abrirMinimo('Z11 DOS RENGLONES');
    await completar(operaciones, id, { precio_guardia: 4000 });
    // Un llenado de ventas, posterior, sobre el mismo campo y con el valor que
    // la columna tiene: si mandara el primero, ventas no debería poder.
    const ventasId = conLaBase(
      (db) => db.prepare('SELECT id FROM usuarios WHERE email = ?').get(ROLES.ventas).id
    );
    conLaBase((db) =>
      db
        .prepare(
          `INSERT INTO bitacora (usuario_id, usuario, rol, accion, entidad, entidad_id, detalle, cambios)
           VALUES (?, 'Ventas de prueba', 'ventas', 'alta_completada', 'servicio', ?, 'segundo',
                   '{"precio_guardia":{"antes":null,"despues":4000}}')`
        )
        .run(ventasId, Number(id))
    );
    // Quien llenó primero ya no manda; quien tiene la última palabra sí.
    const primero = await corregir(operaciones, id, { precio_guardia: 4100 });
    assert.equal(primero.status, 400, `el primer renglón sigue mandando: ${primero.texto.slice(0, 160)}`);
    const ultimo = await corregir(ventas, id, { precio_guardia: 4200 });
    assert.equal(ultimo.status, 200, ultimo.texto);
  });

  test('Z11.5 un renombre de catálogo cierra la ventana, y la pantalla lo sigue', async () => {
    const id = await abrirMinimo('Z11 RENOMBRE');
    const original = opciones.uniformes[0];
    await completar(operaciones, id, { uniforme: original });

    const detalle = (await admin.pedir('/api/catalogos?detalle=1')).json;
    const fila = (detalle.uniforme?.opciones || []).find((o) => o.valor === original);
    assert.ok(fila, `no se encontró «${original}» en el catálogo: ${Object.keys(detalle)}`);
    const nuevo = `${original} RENOMBRADO`;
    const ren = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id: fila.id, valor: nuevo }),
    });
    assert.equal(ren.status, 200, ren.texto);
    assert.equal((await ficha(id)).uniforme, nuevo, 'el renombre repinta la ficha');

    const r = await corregir(operaciones, id, { uniforme: original });
    assert.equal(r.status, 400, `el valor ya no es el que capturó: ${r.texto.slice(0, 200)}`);
    const html = comoSeLee((await operaciones.pedir(`/estado-fuerza/${id}`)).texto);
    assert.doesNotMatch(html, /id="corregir-uniforme"/, 'la pantalla ofrece lo que el servidor niega');
  });

  test('Z11.6 el nombre del campo no entra en el SQL: inyección y mayúsculas', async () => {
    const id = await abrirMinimo('Z11 INYECCION');
    await completar(operaciones, id, { precio_guardia: 5000, razon_social: 'INTACTA SA' });
    const r = await completar(operaciones, id, {
      correcciones: {
        "precio_guardia = 1, estatus = 'BAJA' --": 1,
        'precio_guardia; DROP TABLE servicios;': 1,
        Precio_Guardia: 1,
        'razon_social\u0000': 'X',
        '../../razon_social': 'X',
      },
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, {});
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 5000);
    assert.equal(s.razon_social, 'INTACTA SA');
    assert.equal(s.estatus, 'ACTIVO');
    // Y la tabla sigue en pie.
    assert.equal((await admin.pedir('/api/servicios')).status, 200);
  });

  test('Z11.7 volumen: una bitácora de 6 000 renglones no rompe ni atasca la ficha', async () => {
    const id = await abrirMinimo('Z11 VOLUMEN');
    await completar(operaciones, id, { precio_guardia: 6000 });
    conLaBase((db) => {
      const ins = db.prepare(
        `INSERT INTO bitacora (usuario_id, usuario, rol, accion, entidad, entidad_id, detalle, cambios)
         VALUES (NULL, 'sistema', 'sistema', 'ruido', 'servicio', ?, 'ruido', ?)`
      );
      const tx = db.transaction(() => {
        for (let i = 0; i < 6000; i++) {
          // Mitad con JSON sin el campo, mitad ilegible: las dos se tienen que
          // saltar sin tumbar la ficha ni cambiar la respuesta.
          ins.run(Number(id), i % 2 ? '{"otro_campo":{"antes":1,"despues":2}}' : '{roto');
        }
      });
      tx();
    });

    const t0 = Date.now();
    const html = await operaciones.pedir(`/estado-fuerza/${id}`);
    const msFicha = Date.now() - t0;
    assert.equal(html.status, 200);
    assert.match(comoSeLee(html.texto), /Corregir lo que capturaste hoy/, 'el ruido tapó la autoría');

    const r = await corregir(operaciones, id, { precio_guardia: 6100 });
    assert.equal(r.status, 200, r.texto);
    assert.ok(msFicha < 5000, `la ficha tardó ${msFicha} ms con 6 000 renglones de bitácora`);
  });
});

// ----------------------------- Z12 · lo que el carril acepta y nadie midió

describe('Z12 · lo que el carril acepta sin quejarse', () => {
  let id;
  before(async () => {
    // Z11.5 renombró una opción del catálogo: se vuelve a leer para no capturar
    // contra un valor que ya no existe.
    opciones = (await admin.pedir('/api/catalogos')).json;
    id = await abrirMinimo('Z12 MEDIR');
    const r = await completar(operaciones, id, { precio_guardia: 100, direccion: 'Calle 1', dias_credito: 10 });
    assert.equal(r.status, 200, r.texto);
  });

  test('Z12.1 los números escritos de formas raras, y en qué acaban', async () => {
    const medido = [];
    for (const crudo of ['0x10', '1e3', ' 9,500.50 ', '$7,000', '45.7', '1_000', '+8000', 'Infinity', '7e-3']) {
      const r = await corregir(operaciones, id, { precio_guardia: crudo });
      const s = await ficha(id);
      medido.push(`${JSON.stringify(crudo)} → ${r.status} · columna ${s.precio_guardia}`);
    }
    // No se afirma un valor: se deja medido para el reporte. Lo que sí se exige
    // es que la columna siempre sea un número y nunca basura.
    const s = await ficha(id);
    assert.equal(typeof s.precio_guardia, 'number', `acabó en ${JSON.stringify(s.precio_guardia)}`);
    assert.ok(s.precio_guardia >= 0 && s.precio_guardia <= 10_000_000, `fuera de tope: ${s.precio_guardia}`);
    console.log(`    # Z12.1 medido: ${medido.join(' | ')}`);
  });

  test('Z12.2 un texto de 50 000 caracteres por el carril de la corrección', async () => {
    const propio = await abrirMinimo('Z12 LARGO');
    await completar(operaciones, propio, { direccion: 'Calle 1' });
    const r = await corregir(operaciones, propio, { direccion: 'ñ'.repeat(50_000) });
    const s = await ficha(propio);
    console.log(`    # Z12.2 medido: 50 000 caracteres → ${r.status} · columna de ${String(s.direccion).length}`);
    // Si entra, tiene que entrar entero: truncar en silencio sería lo peor.
    if (r.status === 200) assert.equal(String(s.direccion).length, 50_000);
    else assert.equal(s.direccion, 'Calle 1');
  });

  test('Z12.3 trece campos corregidos de una sola vez, y un solo renglón', async () => {
    const propio = await abrirMinimo('Z12 TODOS');
    const todo = {
      direccion: 'Calle A 1',
      supervisor: opciones.supervisores[0],
      gerente: opciones.gerentes[0],
      estado_geo: opciones.estados[0],
      uniforme: opciones.uniformes[0],
      tipo_repse: opciones.tiposRepse[0],
      razon_social: 'TODOS SA',
      precio_guardia: 111,
      esquema_facturacion: 'FIN_MES',
      forma_pago: opciones.formasPago[0],
      dias_credito: 11,
    };
    const base = await completar(operaciones, propio, todo);
    assert.equal(base.status, 200, base.texto);
    const nuevos = {
      ...todo,
      direccion: 'Calle B 2',
      razon_social: 'TODOS CORREGIDOS SA',
      precio_guardia: 222,
      dias_credito: 22,
      supervisor: opciones.supervisores[1] || opciones.supervisores[0],
    };
    const r = await corregir(operaciones, propio, nuevos);
    assert.equal(r.status, 200, r.texto);
    // Los que no cambiaron no son un hecho; los que sí, en un único renglón.
    assert.equal(Object.keys(r.json.corregidos).length, 5, JSON.stringify(r.json.corregidos));
    assert.equal(renglones(propio, 'alta_corregida').length, 1);
    const s = await ficha(propio);
    for (const [campo, valor] of Object.entries(r.json.corregidos)) {
      assert.equal(String(s[campo]), String(valor.despues), campo);
    }
  });
});
