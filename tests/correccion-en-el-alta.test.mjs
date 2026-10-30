/**
 * Corregir el mismo día lo que se tecleó en la PANTALLA DE ALTA.
 *
 * La excepción del mismo día ya existía: quien llenó un hueco del alta puede
 * corregir ese dato el mismo día natural de la Ciudad de México, con su nombre y
 * la fecha, y sin pisar el rastro de la captura original. Lo que se midió es que
 * no cubría el caso más común. Quedó funcionando solo si el dato se capturó
 * DESPUÉS, desde la ficha del servicio; si la persona lo teclea en la pantalla
 * de alta —que es donde se captura casi todo, porque ahí mismo abajo está
 * «completar cuando lo tengas»—, cinco minutos después la plataforma le
 * contestaba «no lo llenó nadie desde la plataforma: ya venía cargado» y la
 * mandaba a pedirle una edición al administrador.
 *
 * Eran dos cosas mal: no se podía corregir, y el mensaje le echaba la culpa a la
 * importación de un número que ella acababa de teclear.
 *
 * La decisión del director, con sus palabras: *la misma regla —dato propio, el
 * mismo día, con nombre y fecha— deja de importar en qué pantalla se escribió*.
 * Lo que cambia es SOLO el origen; nada más se ensancha:
 *
 *   1. Un dato tecleado en el alta cuenta igual que uno llenado después: su
 *      autor es quien lo escribió y su día es el día en que se escribió.
 *   2. La regla dura sigue intacta: el dato de otra persona y el que vino de la
 *      importación inicial siguen intocables por esta vía, y pasado el día
 *      natural vuelve a ser una edición con sus permisos de siempre.
 *   3. Los campos gobernados siguen gobernados: la razón social pasa por
 *      `registrarCorreccion()` —renglón en `correcciones` y aviso a jurídico—.
 *   4. El mensaje de rechazo distingue los tres casos: lo escribió otra
 *      persona, lo escribiste tú pero otro día, o de verdad vino de la
 *      importación.
 *   5. El rastro no se pierde, y un precio corregido sigue entrando en el
 *      historial de precios.
 *
 * Y la interacción que es el riesgo real: al abrir un servicio por el alta se
 * escriben muchas columnas de golpe, y el movimiento de apertura guarda además
 * sus propias copias del precio y de los guardias, que `montoDe()` PREFIERE.
 * `C6` mide que la ficha y el total del mes no puedan quedar en desacuerdo
 * después de corregir un precio capturado en el alta.
 *
 * Las marcas de tiempo de la bitácora se mueven a propósito: es la única forma
 * de probar «ayer» y «el filo de la medianoche» sin mentirle al reloj del
 * proceso, y es justo donde vive el dato del que depende la regla.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES, PASSWORD_TEMPORAL } from './servidor.mjs';

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const EN_MEXICO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** El día de la operación, que es el único «hoy» que cuenta aquí. */
const HOY = EN_MEXICO.format(new Date());
const diaOficina = (marca) => EN_MEXICO.format(new Date(`${marca.replace(' ', 'T')}Z`));

/**
 * Cuántas horas va el servidor por delante de la oficina. Medido y no escrito a
 * mano: si la zona cambiara, la prueba sigue midiendo la regla y no el número.
 */
const DESFASE = (() => {
  const ahora = new Date();
  const alla = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const aqui = new Date(ahora.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((aqui - alla) / 3_600_000);
})();

/** Una marca como la que guarda la base (UTC) para una hora de la oficina. */
function marcaUtc(dia, hora, minuto = 0, segundo = 0) {
  const [a, m, d] = dia.split('-').map(Number);
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

const ESPECTADOR = 'mirona-alta@corporativoultra.com';

let app;
let admin;
let operaciones;
let ventas;
let finanzas;
let juridico;
let espectador;
let opciones;

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

/** La corrección se pide por su nombre, que es la mitad de la defensa. */
const corregir = (sesion, id, correcciones, extra = {}) =>
  completar(sesion, id, { correcciones, ...extra });

const editar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

let n = 0;
const nombreUnico = (base) => `${base} ${Date.now().toString(36)}${(n += 1)}`;

/**
 * Abre un servicio por la pantalla de alta, con lo que se le diga capturado
 * DESDE ESA PANTALLA.
 *
 * Es la diferencia entera de este archivo: `extra` viaja en el cuerpo de
 * `POST /api/aperturas`, que es lo que manda el formulario del alta. Nada se
 * completa después.
 */
async function abrirConDatos(sesion, base, extra = {}) {
  const r = await sesion.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombreUnico(base),
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
      ...extra,
    }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

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

/**
 * Mueve a otra hora el renglón del ALTA, que es donde se ancla la ventana de un
 * dato tecleado en esa pantalla.
 */
function fecharAlta(id, marca) {
  const movidas = conLaBase(
    (db) =>
      db
        .prepare(
          `UPDATE bitacora SET creado_en = ?
            WHERE entidad = 'servicio' AND entidad_id = ? AND accion = 'apertura'`
        )
        .run(marca, Number(id)).changes
  );
  assert.ok(movidas > 0, 'no había renglón de alta que mover');
  return movidas;
}

const aperturasDe = (servicioId) =>
  conLaBase((db) =>
    db
      .prepare('SELECT id, folio, precio_guardia, guardias, periodo FROM aperturas WHERE servicio_id = ? ORDER BY id')
      .all(Number(servicioId))
  );

const correccionesDe = (servicioId) =>
  conLaBase((db) =>
    db
      .prepare('SELECT motivo, cambios, usuario FROM correcciones WHERE servicio_id = ? ORDER BY id')
      .all(Number(servicioId))
      .map((c) => ({ ...c, cambios: JSON.parse(c.cambios || '{}') }))
  );

const historialDe = (servicioId) =>
  conLaBase((db) =>
    db
      .prepare(
        `SELECT precio_anterior, precio_nuevo, motivo, usuario FROM precios_historial
          WHERE servicio_id = ? ORDER BY id`
      )
      .all(Number(servicioId))
  );

const avisosDe = async (sesion) => (await sesion.pedir('/api/avisos')).json;

/** El «Valor mensual que entra» que la pantalla de Aperturas enseña para ese mes. */
async function totalDelMes(periodo) {
  const r = await admin.pedir(`/aperturas?periodo=${periodo}`);
  assert.equal(r.status, 200);
  const html = comoSeLee(r.texto);
  const m = html.match(/Valor mensual que entra<\/p>[\s\S]{0,300}?>(\$[\d,.]+)</);
  assert.ok(m, `no se encontró el total del mes en /aperturas?periodo=${periodo}`);
  return Number(m[1].replace(/[$,]/g, ''));
}

/** Un mes propio para cada caso, para que el total sea solo del servicio que se mide. */
const unMesVacio = (() => {
  let i = 0;
  return () => `2028-${String((i += 1)).padStart(2, '0')}`;
})();

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
      nombre: 'Mirona del alta',
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

// ------------------------------------------------------- C0 · la línea base

describe('C0 · la base que este cambio no debía mover', () => {
  test('C0.1 las fixtures de tiempo caen en el día de la oficina que dicen', () => {
    // Si esto falla, los filos de la medianoche de C3 no prueban nada.
    assert.equal(diaOficina(marcaUtc(HOY, 10, 5)), HOY);
    assert.equal(diaOficina(marcaUtc(AYER, 23, 50)), AYER, 'anoche a las 23:50 sigue siendo ayer');
    assert.equal(diaOficina(marcaUtc(HOY, 19)), HOY, 'hoy a las 19:00 sigue siendo hoy');
    assert.equal(marcaUtc(AYER, 23, 50).slice(0, 10), HOY, 'para el servidor ya es hoy, en la oficina no');
    assert.equal(marcaUtc(HOY, 19).slice(0, 10), MANANA, 'para el servidor ya es mañana, en la oficina no');
  });

  test('C0.2 los invariantes sembrados siguen donde estaban', async () => {
    const todos = (await admin.pedir('/api/servicios')).json.servicios;
    assert.equal(todos.length, 217, `servicios activos: ${todos.length}`);
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, /217 servicios/);
    assert.match(html, /880 guardias/);
    const movimientos = conLaBase((db) => ({
      aperturas: db.prepare('SELECT COUNT(*) AS n FROM aperturas').get().n,
      cancelaciones: db.prepare('SELECT COUNT(*) AS n FROM cancelaciones').get().n,
    }));
    assert.equal(movimientos.aperturas, 516, `aperturas: ${movimientos.aperturas}`);
    assert.equal(movimientos.cancelaciones, 330, `cancelaciones: ${movimientos.cancelaciones}`);
  });
});

// ------------------------------- C1 · el caso que el manager reprodujo a mano

describe('C1 · el caso reproducido: ventas abre con el precio mal y lo arregla', () => {
  test('C1.1 el precio tecleado en el alta se corrige el mismo día', async () => {
    /**
     * Palabra por palabra el caso medido: «ventas abre un servicio con el precio
     * en 95,000, quiere dejarlo en 9,500, y la plataforma dice no». Nada se
     * completa después: el 95,000 viaja en el cuerpo del alta.
     */
    const id = await abrirConDatos(ventas, 'ALTA PRECIO', { precio_guardia: 95000 });
    assert.equal((await ficha(id)).precio_guardia, 95000, 'el alta escribió el precio');

    const r = await corregir(ventas, id, { precio_guardia: 9500 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, { precio_guardia: { antes: 95000, despues: 9500 } });
    assert.deepEqual(r.json.llenados, {}, 'corregir no es llenar');
    assert.deepEqual(r.json.yaTenian, [], 'y no es un hueco que «ya tenía valor»');
    assert.equal((await ficha(id)).precio_guardia, 9500);
  });

  test('C1.2 el rastro: el renglón del alta se queda y la corrección es uno nuevo', async () => {
    const id = await abrirConDatos(ventas, 'ALTA RASTRO', { precio_guardia: 95000 });
    assert.equal((await corregir(ventas, id, { precio_guardia: 9500 })).status, 200);

    const bitacora = renglones(id);
    const alta = bitacora.filter((b) => b.accion === 'apertura');
    const arreglo = bitacora.filter((b) => b.accion === 'alta_corregida');
    assert.equal(alta.length, 1, 'el alta sigue siendo un solo renglón');
    assert.equal(arreglo.length, 1, 'y la corrección es un renglón nuevo');

    // El renglón del alta conserva lo que se capturó mal, que es lo que explica
    // por qué hubo que corregir.
    assert.deepEqual(alta[0].cambios.precio_guardia, { antes: null, despues: 95000 });
    assert.match(alta[0].detalle, /\+2 guardias/, 'y sigue siendo el renglón del alta, no otro');
    // Y la corrección dice qué decía antes y qué dice ahora, con nombre y fecha.
    assert.deepEqual(arreglo[0].cambios.precio_guardia, { antes: 95000, despues: 9500 });
    assert.equal(arreglo[0].usuario, 'Ventas de prueba', 'con nombre');
    assert.equal(arreglo[0].rol, 'ventas');
    assert.equal(diaOficina(arreglo[0].creado_en), HOY, 'y con fecha');
    assert.match(arreglo[0].detalle, /«95000» → «9500»/);
  });

  test('C1.3 y entra en el historial de precios, con el motivo de su vía', async () => {
    const id = await abrirConDatos(ventas, 'ALTA HISTORIAL', { precio_guardia: 13250 });
    assert.equal((await corregir(ventas, id, { precio_guardia: 12350 })).status, 200);

    const historial = historialDe(id);
    assert.deepEqual(
      historial.map((h) => [h.precio_anterior, h.precio_nuevo]),
      [[13250, 12350]],
      'el precio corregido tiene que verse en la única lista que explica qué paga el cliente'
    );
    assert.equal(historial[0].usuario, 'Ventas de prueba');
    assert.match(historial[0].motivo, /Corregido el mismo día por quien lo capturó/);
    // Y el motivo no afirma una pantalla que nadie comprobó.
    assert.doesNotMatch(historial[0].motivo, /panel|pantalla/i);
  });

  test('C1.4 el camino se ve en la ficha de quien lo capturó, y no en la de los demás', async () => {
    const BLOQUE = 'Corregir lo que capturaste hoy';
    const panel = async (sesion, id) => comoSeLee((await sesion.pedir(`/estado-fuerza/${id}`)).texto);
    const id = await abrirConDatos(ventas, 'ALTA PANTALLA', { precio_guardia: 7777, direccion: 'Av. Alta 1' });

    const mio = await panel(ventas, id);
    assert.match(mio, new RegExp(BLOQUE), 'quien lo tecleó en el alta sí');
    assert.match(mio, /id="corregir-precio_guardia"/);
    assert.match(mio, /ahora dice «7777»/);
    assert.match(mio, /id="corregir-direccion"/, 'y los demás datos que escribió en esa misma pantalla');

    for (const [quien, sesion] of [
      ['operaciones', operaciones],
      ['admin', admin],
      ['finanzas', finanzas],
      ['juridico', juridico],
      ['espectador', espectador],
    ]) {
      const ajeno = await panel(sesion, id);
      assert.doesNotMatch(ajeno, new RegExp(BLOQUE), `${quien} ve un bloque que no es suyo`);
      assert.doesNotMatch(ajeno, /id="corregir-precio_guardia"/, `${quien} ve el control`);
    }
  });
});

// --------------------------------------------- C2 · solo el dato propio

describe('C2 · lo que tecleó otra persona en el alta no se corrige', () => {
  test('C2.1 el precio que escribió ventas en el alta no lo corrige operaciones', async () => {
    const id = await abrirConDatos(ventas, 'ALTA AJENO', { precio_guardia: 8000 });
    const r = await corregir(operaciones, id, { precio_guardia: 9000 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo capturó Ventas de prueba al abrir el servicio/);
    assert.match(r.json.error, /cada quien corrige su propio dato/i);
    assert.equal((await ficha(id)).precio_guardia, 8000, 'y no se escribió nada');
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });

  test('C2.2 ni el administrador, que tampoco lo escribió', async () => {
    const id = await abrirConDatos(ventas, 'ALTA AJENO ADMIN', { precio_guardia: 7000 });
    const r = await corregir(admin, id, { precio_guardia: 1 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo capturó Ventas de prueba al abrir el servicio/);
    assert.equal((await ficha(id)).precio_guardia, 7000);
  });

  test('C2.3 cada quien lo suyo en el mismo servicio: el alta de uno y el hueco del otro', async () => {
    /**
     * El servicio es de ventas —ella lo abrió y escribió el precio—, y
     * operaciones llenó después un hueco que el alta dejó. Ninguno de los dos
     * hereda el dato del otro, en la misma ficha y el mismo día.
     */
    const id = await abrirConDatos(ventas, 'ALTA MIXTO', { precio_guardia: 5000 });
    assert.equal((await completar(operaciones, id, { direccion: 'Calle de Operaciones 1' })).status, 200);

    // Primero los dos «no», con el dato todavía como lo escribió su autor: así
    // el mensaje nombra la pantalla por la que entró de verdad.
    const ajeno = await corregir(operaciones, id, { precio_guardia: 1 });
    assert.equal(ajeno.status, 400, ajeno.texto);
    assert.match(ajeno.json.error, /lo capturó Ventas de prueba al abrir el servicio/);

    const suyoNo = await corregir(ventas, id, { direccion: 'Calle de Ventas 2' });
    assert.equal(suyoNo.status, 400, suyoNo.texto);
    assert.match(suyoNo.json.error, /lo capturó Operaciones de prueba al completar el alta/);

    // Y después los dos «sí», cada uno sobre lo suyo.
    assert.equal((await corregir(ventas, id, { precio_guardia: 5500 })).status, 200, 'su precio, sí');
    assert.equal(
      (await corregir(operaciones, id, { direccion: 'Calle de Operaciones 3' })).status,
      200,
      'su dirección, sí'
    );

    const s = await ficha(id);
    assert.equal(s.precio_guardia, 5500);
    assert.equal(s.direccion, 'Calle de Operaciones 3');
  });

  test('C2.4 el dato de otro disfrazado de propio: si el admin lo editó, ya no es tuyo', async () => {
    /**
     * El vector serio, ahora por la puerta del alta. Ventas teclea el precio al
     * abrir, el administrador lo edita desde la ficha, y ventas pide «corregir
     * mi dato»: el valor que hay ya no es el suyo, y dejarlo pasar sería
     * deshacer la edición del administrador por la puerta de las correcciones.
     */
    const id = await abrirConDatos(ventas, 'ALTA TRAS EDICION', { precio_guardia: 5000 });
    assert.equal((await editar(admin, id, { precio_guardia: 6000 })).status, 200);

    const r = await corregir(ventas, id, { precio_guardia: 5500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /editando la ficha/);
    assert.equal((await ficha(id)).precio_guardia, 6000, 'la edición del administrador se queda');
  });

  test('C2.5 si otro camino pisó el dato, tampoco es tuyo aunque lo escribieras hoy', async () => {
    /**
     * «Aplicar condiciones de cobro» pisa el esquema, los días de crédito y la
     * forma de pago sin dejar renglón por servicio. El dato que hay ya no es el
     * que tecleó el alta, así que no es su dato.
     */
    const id = await abrirConDatos(ventas, 'ALTA TRAS CONDICIONES', { dias_credito: 15 });
    const lote = await finanzas.pedir('/api/facturas/condiciones', {
      method: 'POST',
      body: JSON.stringify({
        alcance: 'seleccion',
        ids: [id],
        esquema_facturacion: 'MES_VENCIDO',
        dias_credito: 45,
        forma_pago: opciones.formasPago[0],
      }),
    });
    assert.equal(lote.status, 200, lote.texto);
    assert.equal((await ficha(id)).dias_credito, 45);

    const r = await corregir(ventas, id, { dias_credito: 20 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya no dice lo que tú capturaste \(«15»\)/);
    assert.equal((await ficha(id)).dias_credito, 45, 'lo que puso finanzas se queda');
  });
});

// -------------------------------------- C3 · lo que vino de la importación

describe('C3 · la importación inicial sigue intocable', () => {
  test('C3.1 un dato de los 217 no se corrige, con ningún rol que capture', async () => {
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
        assert.match(r.json.error, /ya venía cargado de la importación inicial/);
      }
    }
    const s = await ficha(viejo.id);
    assert.equal(s.razon_social, viejo.razon_social, 'y nada se escribió');
    assert.equal(s.supervisor, viejo.supervisor);
  });

  test('C3.2 el renglón del alta de la carga inicial no da autoría: no lleva cambios', async () => {
    /**
     * Es la razón por la que la importación queda fuera sin ninguna marca que
     * haya que mantener al día. La carga inicial y `aplicarApertura()` apuntan
     * su renglón con la MISMA acción que el alta —`apertura`—, pero sin
     * `cambios`, y la autoría solo se lee de los renglones que lo llevan. Si
     * algún día la carga empezara a escribir `cambios`, esta prueba lo dice.
     */
    // Los de la carga se identifican por su movimiento —`carga_inicial = 1`— y
    // no por su posición en la lista, que para cuando corre esto ya trae los
    // servicios que abrieron las pruebas de arriba.
    const carga = conLaBase((db) => ({
      servicios: db
        .prepare('SELECT COUNT(*) AS n FROM aperturas WHERE carga_inicial = 1 AND servicio_id IS NOT NULL')
        .get().n,
      conAutoria: db
        .prepare(
          `SELECT COUNT(*) AS n FROM bitacora b
            WHERE b.entidad = 'servicio' AND b.cambios IS NOT NULL
              AND b.entidad_id IN (SELECT servicio_id FROM aperturas WHERE carga_inicial = 1)`
        )
        .get().n,
    }));
    assert.equal(carga.servicios, 217, `servicios de la carga inicial: ${carga.servicios}`);
    assert.equal(carga.conAutoria, 0, 'ninguno de los 217 puede tener autoría de captura');
  });

  test('C3.3 una apertura del archivo que se aplica tampoco da autoría', async () => {
    /**
     * Aplicar una apertura pendiente copia al estado de fuerza un dato que trajo
     * la importación: no lo escribió nadie desde la plataforma, aunque quien
     * aplica sí apretó un botón. El dato es del archivo, así que sigue siendo
     * una edición.
     */
    const pendiente = conLaBase((db) =>
      db
        .prepare(
          `SELECT a.id, a.servicio, a.direccion, a.guardias
             FROM aperturas a
            WHERE a.servicio_id IS NULL AND a.descartada = 0 AND a.tipo <> 'INCREMENTO'
              AND a.guardias > 0 AND a.direccion IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.estatus <> 'BAJA' AND s.servicio = a.servicio)
            LIMIT 1`
        )
        .get()
    );
    assert.ok(pendiente, 'la base sembrada trae aperturas del archivo sin aplicar');

    const r = await admin.pedir(`/api/aperturas/${pendiente.id}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 200, r.texto);
    const servicioId = r.json.servicioId;

    const malo = await corregir(admin, servicioId, { direccion: 'CALLE APLICADA 1' });
    assert.equal(malo.status, 400, malo.texto);
    assert.match(malo.json.error, /ya venía cargado de la importación inicial/);
    assert.equal((await ficha(servicioId)).direccion, pendiente.direccion);
  });
});

// ------------------------------------------- C4 · el mismo día natural

describe('C4 · solo el mismo día natural de la Ciudad de México', () => {
  test('C4.1 al día siguiente ya no se puede, y el mensaje lo dice con claridad', async () => {
    const id = await abrirConDatos(ventas, 'ALTA AYER', { precio_guardia: 4000 });
    fecharAlta(id, marcaUtc(AYER, 12));

    const r = await corregir(ventas, id, { precio_guardia: 4500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo escribiste tú, pero no hoy/);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER} y hoy es ${HOY}`));
    assert.match(r.json.error, /solo vale el mismo día/);
    assert.match(r.json.error, /Pasada la medianoche se cambia desde «Editar»/);
    // Y no se le echa la culpa a la importación de algo que ella escribió.
    assert.doesNotMatch(r.json.error, /ya venía cargado/);
    assert.equal((await ficha(id)).precio_guardia, 4000);
  });

  test('C4.2 anoche a las 23:50 es ayer, aunque para el servidor ya fuera hoy', async () => {
    const id = await abrirConDatos(ventas, 'ALTA FILO CERRADO', { precio_guardia: 3000 });
    const anoche = marcaUtc(AYER, 23, 50);
    assert.equal(anoche.slice(0, 10), HOY, 'la fixture tiene que engañar a quien mire la cadena UTC');
    fecharAlta(id, anoche);

    const r = await corregir(ventas, id, { precio_guardia: 3500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER}`));
    assert.equal((await ficha(id)).precio_guardia, 3000);
  });

  test('C4.3 hoy a las 19:00 sigue siendo hoy, aunque para el servidor ya sea mañana', async () => {
    const id = await abrirConDatos(ventas, 'ALTA FILO ABIERTO', { precio_guardia: 2000 });
    const tarde = marcaUtc(HOY, 19);
    assert.equal(tarde.slice(0, 10), MANANA, 'la fixture tiene que engañar a quien mire la cadena UTC');
    fecharAlta(id, tarde);

    const r = await corregir(ventas, id, { precio_guardia: 2500 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, { precio_guardia: { antes: 2000, despues: 2500 } });
  });

  test('C4.4 una corrección no reabre la ventana del alta', async () => {
    /**
     * La ventana se ancla al día en que se ESCRIBIÓ el dato, no al último
     * renglón. Si se midiera desde el último, una corrección guardada en el filo
     * de la medianoche la correría al día siguiente, encadenable noche tras
     * noche. Es la misma regla que ya valía para el llenado, ahora comprobada
     * para el alta.
     */
    const id = await abrirConDatos(ventas, 'ALTA CADENA', { precio_guardia: 1000 });
    assert.equal((await corregir(ventas, id, { precio_guardia: 1100 })).status, 200);
    fecharAlta(id, marcaUtc(AYER, 23, 59, 59));

    const r = await corregir(ventas, id, { precio_guardia: 1200 });
    assert.equal(r.status, 400, `el alta es de ayer: la ventana está cerrada (status ${r.status})`);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER}`));
    assert.equal((await ficha(id)).precio_guardia, 1100, 'y se queda en la última corrección válida');
  });

  test('C4.5 pasada la medianoche el bloque desaparece de la ficha', async () => {
    const BLOQUE = 'Corregir lo que capturaste hoy';
    const panel = async () => comoSeLee((await ventas.pedir(`/estado-fuerza/${id}`)).texto);
    const id = await abrirConDatos(ventas, 'ALTA PANTALLA AYER', { precio_guardia: 6000 });
    assert.match(await panel(), new RegExp(BLOQUE));

    fecharAlta(id, marcaUtc(AYER, 12));
    const despues = await panel();
    assert.doesNotMatch(despues, new RegExp(BLOQUE), 'lo de ayer ya no se ofrece');
    assert.match(despues, /Falta por capturar/, 'y lo que falta se sigue pudiendo capturar');
  });
});

// ------------------------------- C5 · el mensaje distingue los tres casos

describe('C5 · el mensaje de rechazo dice la verdad', () => {
  test('C5.1 los tres «no» se distinguen, y ninguno acusa a la importación de lo recién tecleado', async () => {
    /**
     * Es el punto 5 del contrato. El mensaje tenía una sola salida para los tres
     * casos —«ya venía cargado»— porque la bitácora no sabía quién había escrito
     * un dato del alta. Los tres llevan a sitios distintos, así que el mensaje
     * tiene que decir cuál es.
     */
    // Caso 1 · lo escribió otra persona.
    const deOtro = await abrirConDatos(ventas, 'ALTA MSG AJENO', { precio_guardia: 100 });
    const ajeno = await corregir(operaciones, deOtro, { precio_guardia: 200 });

    // Caso 2 · lo escribiste tú, pero otro día.
    const deAyer = await abrirConDatos(ventas, 'ALTA MSG AYER', { precio_guardia: 300 });
    fecharAlta(deAyer, marcaUtc(AYER, 9));
    const viejo = await corregir(ventas, deAyer, { precio_guardia: 400 });

    // Caso 3 · de verdad vino de la importación.
    const lista = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    const importado = lista.find((s) => s.razon_social);
    const cargado = await corregir(admin, importado.id, { razon_social: 'DE LA CARGA SA' });

    for (const r of [ajeno, viejo, cargado]) assert.equal(r.status, 400, r.texto);

    const mensajes = [ajeno.json.error, viejo.json.error, cargado.json.error];
    assert.equal(new Set(mensajes).size, 3, `los tres «no» dicen lo mismo:\n${mensajes.join('\n')}`);

    // Cada uno nombra su caso…
    assert.match(ajeno.json.error, /lo capturó Ventas de prueba al abrir el servicio/);
    assert.match(viejo.json.error, /lo escribiste tú, pero no hoy/);
    assert.match(cargado.json.error, /no lo escribió nadie desde la plataforma/);
    assert.match(cargado.json.error, /ya venía cargado de la importación inicial/);

    // …y solo el tercero habla de la importación. Esto es el defecto reportado:
    // la plataforma le contestaba «ya venía cargado» a quien acababa de teclear
    // el número y la mandaba a pedir una edición que no necesitaba.
    assert.doesNotMatch(ajeno.json.error, /ya venía cargado|importación/);
    assert.doesNotMatch(viejo.json.error, /ya venía cargado|importación/);

    // Y cada uno dice a dónde ir.
    for (const m of mensajes) assert.match(m, /Editar/);
  });

  test('C5.2 el mensaje nombra la pantalla que la bitácora apuntó, y solo esa', async () => {
    // Tres orígenes, tres frases. La del alta es la que no existía.
    const delAlta = await abrirConDatos(ventas, 'ALTA MSG ORIGEN', { precio_guardia: 500 });
    assert.equal((await completar(ventas, delAlta, { direccion: 'Calle Origen 1' })).status, 200);

    const porAlta = await corregir(operaciones, delAlta, { precio_guardia: 600 });
    assert.match(porAlta.json.error, / al abrir el servicio:/);

    const porHueco = await corregir(operaciones, delAlta, { direccion: 'Calle Origen 2' });
    assert.match(porHueco.json.error, / al completar el alta:/);

    assert.equal((await corregir(ventas, delAlta, { direccion: 'Calle Origen 3' })).status, 200);
    const trasCorregir = await corregir(operaciones, delAlta, { direccion: 'Calle Origen 4' });
    assert.match(trasCorregir.json.error, / corrigiéndolo ese mismo día:/);
  });
});

// ----------------------------- C6 · los campos gobernados siguen gobernados

describe('C6 · la razón social capturada en el alta pasa por el control de siempre', () => {
  test('C6.1 corregirla el mismo día deja renglón en «correcciones» y avisa a jurídico', async () => {
    /**
     * Es el punto 3 del contrato, y es el que no se puede aflojar: la razón
     * social sale de la intersección «se completa ∩ está bloqueado ∩ es
     * corregible», así que su corrección entra por `registrarCorreccion()` —la
     * misma función que usa jurídico— aunque la pida ventas por autoría propia.
     * Quien se equivocó sigue pudiendo arreglar su error de dedo; lo que no pasa
     * es que el nombre legal con el que se factura cambie sin que jurídico se
     * entere.
     */
    const antes = (await avisosDe(juridico)).sinLeer;
    const id = await abrirConDatos(ventas, 'ALTA RAZON SOCIAL', { razon_social: 'LEGAL EQUIVOCADA SA' });

    const r = await corregir(ventas, id, { razon_social: 'LEGAL CORRECTA SA DE CV' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).razon_social, 'LEGAL CORRECTA SA DE CV');

    const formales = correccionesDe(id);
    assert.equal(formales.length, 1, 'la corrección de la razón social deja su renglón formal');
    assert.deepEqual(formales[0].cambios.razon_social, {
      antes: 'LEGAL EQUIVOCADA SA',
      despues: 'LEGAL CORRECTA SA DE CV',
    });
    assert.equal(formales[0].usuario, 'Ventas de prueba');
    assert.match(formales[0].motivo, /mismo día/, 'y el motivo dice qué pasó, sin inventar la pantalla');

    const despues = (await avisosDe(juridico)).sinLeer;
    assert.equal(despues, antes + 1, 'a jurídico tiene que llegarle');
  });

  test('C6.2 el motivo escrito manda, y un campo sin régimen propio no pide ninguno', async () => {
    const id = await abrirConDatos(ventas, 'ALTA MOTIVO', {
      razon_social: 'CON MOTIVO MALA SA',
      precio_guardia: 1111,
    });
    const conMotivo = await corregir(
      ventas,
      id,
      { razon_social: 'CON MOTIVO BUENA SA' },
      { motivo: 'El acta dice otra cosa: me comí una palabra al teclear.' }
    );
    assert.equal(conMotivo.status, 200, conMotivo.texto);
    assert.match(correccionesDe(id)[0].motivo, /me comí una palabra/);

    // El precio no tiene régimen propio: se corrige sin motivo, sin renglón
    // formal y sin aviso. Que la razón social los exija y el precio no es la
    // diferencia que había que conservar.
    assert.equal((await corregir(ventas, id, { precio_guardia: 1222 })).status, 200);
    assert.equal(correccionesDe(id).length, 1, 'el precio no deja renglón formal');
  });

  test('C6.3 la pantalla pide el motivo solo donde hace falta, y dice a quién se avisa', async () => {
    const id = await abrirConDatos(ventas, 'ALTA PIDE MOTIVO', { razon_social: 'PIDE MOTIVO SA' });
    const html = comoSeLee((await ventas.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /id="corregir-razon_social"/);
    assert.match(html, /id="corregir-motivo"/, 'un campo gobernado pide explicación');
    assert.match(html, /se le avisa a Jurídico/, 'y dice a quién, que es por qué la pide');
  });
});

// ------------------- C7 · la ficha y el total del mes no pueden discrepar

describe('C7 · la ficha y el total del mes, después de corregir el precio del alta', () => {
  /** Lo que la ficha dice y lo que el total del mes suma, para compararlos. */
  async function laFichaYElTotal(id, periodo) {
    const s = await ficha(id);
    const movimientos = aperturasDe(id);
    return {
      precioFicha: Number(s.precio_guardia) || 0,
      precioMovimiento: Number(movimientos[0].precio_guardia) || 0,
      guardias: movimientos[0].guardias,
      total: await totalDelMes(periodo),
    };
  }

  test('C7.1 corregir el precio tecleado en el alta mueve también la copia del movimiento', async () => {
    /**
     * El riesgo real de este encargo. El alta escribe el precio en DOS sitios
     * —la ficha y su propio movimiento— y `montoDe()` prefiere el del
     * movimiento, porque el total de un mes se cobra al precio de ese mes. Si la
     * corrección del mismo día solo arreglara la ficha, el servicio diría 9,500
     * y la pantalla de Aperturas seguiría sumando 95,000: un reporte de dinero
     * que enseña un número desmentido sin avisar.
     */
    const periodo = unMesVacio();
    const id = await abrirConDatos(ventas, 'ALTA TOTAL', {
      fecha: `${periodo}-12`,
      precio_guardia: 95000,
    });
    const malo = await laFichaYElTotal(id, periodo);
    assert.equal(malo.precioMovimiento, 95000, 'el movimiento nació con la copia del precio mal tecleado');
    assert.equal(malo.total, 95000 * malo.guardias, 'y el mes ya lo cuenta');

    assert.equal((await corregir(ventas, id, { precio_guardia: 9500 })).status, 200);

    const d = await laFichaYElTotal(id, periodo);
    assert.equal(d.precioFicha, 9500, 'la ficha');
    assert.equal(d.precioMovimiento, 9500, 'y la copia del movimiento, que es la que lee el total');
    assert.equal(
      d.total,
      9500 * d.guardias,
      `la ficha dice 9,500 × ${d.guardias} y el mes suma ${d.total} (antes ${malo.total})`
    );
  });

  test('C7.2 y la alineación deja renglón, para que el número que cambió se pueda explicar', async () => {
    const periodo = unMesVacio();
    const id = await abrirConDatos(ventas, 'ALTA TOTAL RASTRO', {
      fecha: `${periodo}-03`,
      precio_guardia: 44000,
    });
    assert.equal((await corregir(ventas, id, { precio_guardia: 4400 })).status, 200);

    const renglon = conLaBase((db) =>
      db
        .prepare(
          `SELECT b.detalle FROM bitacora b
             JOIN aperturas a ON a.id = b.entidad_id
            WHERE b.accion = 'precio_movimiento' AND b.entidad = 'apertura' AND a.servicio_id = ?
            ORDER BY b.id DESC LIMIT 1`
        )
        .get(Number(id))
    );
    assert.ok(renglon, 'la alineación no dejó renglón en la bitácora');
    assert.match(renglon.detalle, /se alineó con la ficha/);
    assert.match(renglon.detalle, /«44000» → «4400»/);
    assert.match(renglon.detalle, /Corregido el mismo día por quien lo capturó/);

    // Y el renglón va al movimiento, no al servicio: si fuera del servicio le
    // robaría la autoría del precio a quien lo capturó y le cerraría la ventana.
    assert.equal(
      renglones(id).filter((r) => r.accion === 'precio_movimiento').length,
      0,
      'la alineación no puede apuntarse en la bitácora del servicio'
    );
    assert.equal((await corregir(ventas, id, { precio_guardia: 4500 })).status, 200, 'la ventana sigue abierta');
  });

  test('C7.3 un precio CERO tecleado en el alta se corrige, y el cero no es un hueco', async () => {
    /**
     * Un cero es una respuesta —hay servicios de cortesía— y la plataforma lo
     * lee así en todas partes. Al corregirlo, la copia del movimiento tiene que
     * seguirlo: nulo y cero son dos respuestas distintas, y confundirlas es lo
     * que reescribía el cero PACTADO de un mes cerrado.
     */
    const periodo = unMesVacio();
    const id = await abrirConDatos(ventas, 'ALTA CERO', { fecha: `${periodo}-08`, precio_guardia: 0 });
    const r = await corregir(ventas, id, { precio_guardia: 8500 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, { precio_guardia: { antes: 0, despues: 8500 } });

    const d = await laFichaYElTotal(id, periodo);
    assert.equal(d.precioFicha, 8500);
    assert.equal(d.precioMovimiento, 8500);
    assert.equal(d.total, 8500 * d.guardias);
  });
});

// ------------------------------------------------------- C8 · los seis roles

describe('C8 · los seis roles: nadie gana un permiso que no tenía', () => {
  test('C8.1 los tres que registran aperturas corrigen lo suyo; los otros tres no entran', async () => {
    /**
     * El permiso de entrada es el mismo que ya tenía el llenado —`apertura`, o
     * sea admin, operaciones y ventas— y no se tocó. Quien no abre servicios no
     * puede tener un dato propio del alta que corregir, así que para él esta vía
     * ni existe.
     */
    for (const [rol, sesion] of [
      ['admin', admin],
      ['operaciones', operaciones],
      ['ventas', ventas],
    ]) {
      const id = await abrirConDatos(sesion, `ALTA ROL ${rol.toUpperCase()}`, { precio_guardia: 1000 });
      const r = await corregir(sesion, id, { precio_guardia: 1500 });
      assert.equal(r.status, 200, `${rol} → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, 1500);
    }

    // Los otros tres no abren servicios, así que se les prueba sobre uno ajeno.
    const ajeno = await abrirConDatos(ventas, 'ALTA ROL SIN PERMISO', { precio_guardia: 2000 });
    for (const [rol, sesion, esperado] of [
      ['finanzas', finanzas, 403],
      ['juridico', juridico, 403],
      ['espectador', espectador, 403],
    ]) {
      const r = await corregir(sesion, ajeno, { precio_guardia: 1 });
      assert.equal(r.status, esperado, `${rol} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    const sinSesion = await corregir(app.anonimo(), ajeno, { precio_guardia: 1 });
    assert.ok([401, 302, 307].includes(sinSesion.status), `sin sesión → ${sinSesion.status}`);
    assert.equal((await ficha(ajeno)).precio_guardia, 2000, 'y nada se escribió');
  });

  test('C8.2 abrir por el alta no le da a nadie un campo que su rol no editaba', async () => {
    /**
     * La otra mitad de «nadie gana un permiso»: el alcance de esta vía son los
     * campos completables, y ni uno más. `total_guardias`, `estatus` y el nombre
     * del servicio son corregibles por la vía FORMAL —con motivo y renglón— y
     * siguen fuera de aquí aunque el alta los haya escrito.
     */
    const id = await abrirConDatos(ventas, 'ALTA FUERA DE ALCANCE', { precio_guardia: 3000 });
    const antes = await ficha(id);
    const r = await completar(ventas, id, {
      correcciones: { total_guardias: 99, estatus: 'BAJA', servicio: 'RENOMBRADO POR VENTAS' },
    });
    assert.equal(r.status, 200, r.texto);
    for (const campo of ['total_guardias', 'estatus', 'servicio']) {
      assert.ok(r.json.rechazados.includes(campo), `${campo} tenía que salir en rechazados`);
    }
    assert.deepEqual(r.json.corregidos, {});
    const despues = await ficha(id);
    assert.equal(despues.total_guardias, antes.total_guardias);
    assert.equal(despues.estatus, 'ACTIVO');
    assert.equal(despues.servicio, antes.servicio);
  });

  test('C8.3 jurídico sigue entrando por su puerta, y sigue necesitando motivo', async () => {
    // La vía de siempre no se aflojó por abrir la del alta.
    const id = await abrirConDatos(ventas, 'ALTA VIA JURIDICO', { razon_social: 'DE VENTAS SA' });
    const sinMotivo = await juridico.pedir(`/api/servicios/${id}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ razon_social: 'SIN EXPLICAR SA' }),
    });
    assert.equal(sinMotivo.status, 400, sinMotivo.texto);
    assert.match(sinMotivo.json.error, /motivo/i);

    const conMotivo = await juridico.pedir(`/api/servicios/${id}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ razon_social: 'LA DEL CONTRATO SA', motivo: 'El acta constitutiva dice esta.' }),
    });
    assert.equal(conMotivo.status, 201, conMotivo.texto);
    assert.equal((await ficha(id)).razon_social, 'LA DEL CONTRATO SA');
  });
});

// --------------------------------------------------- C9 · intentos de romperlo

describe('C9 · intentos de romperlo', () => {
  test('C9.1 dos correcciones seguidas del mismo día sobre un dato del alta', async () => {
    const id = await abrirConDatos(ventas, 'ALTA DOS VECES', { dias_credito: 300 });
    assert.equal((await corregir(ventas, id, { dias_credito: 30 })).status, 200);
    const segunda = await corregir(ventas, id, { dias_credito: 15 });
    assert.equal(segunda.status, 200, segunda.texto);
    assert.deepEqual(segunda.json.corregidos, { dias_credito: { antes: 30, despues: 15 } });
    assert.equal((await ficha(id)).dias_credito, 15);

    const arreglos = renglones(id, 'alta_corregida');
    assert.equal(arreglos.length, 2, 'dos hechos, dos renglones');
    assert.deepEqual(
      arreglos.map((a) => [a.cambios.dias_credito.antes, a.cambios.dias_credito.despues]),
      [[300, 30], [30, 15]]
    );
    // Y el renglón del alta sigue diciendo lo que se tecleó, que es el principio
    // de la cadena.
    assert.deepEqual(renglones(id, 'apertura')[0].cambios.dias_credito, { antes: null, despues: 300 });
  });

  test('C9.2 tipos equivocados y topes: se contesta y no se escribe nada', async () => {
    const id = await abrirConDatos(ventas, 'ALTA TIPOS', {
      precio_guardia: 1234.5,
      razon_social: 'TIPOS SA',
      dias_credito: 30,
      uniforme: opciones.uniformes[0],
    });

    const casos = [
      [{ razon_social: [] }, /se captura como texto o número/],
      [{ razon_social: {} }, /se captura como texto o número/],
      [{ razon_social: true }, /se captura como texto o número/],
      [{ precio_guardia: 'carísimo' }, /no es un número/],
      [{ precio_guardia: '0x10' }, /no es un número/],
      [{ precio_guardia: '1 2 3' }, /no es un número/],
      [{ precio_guardia: 1e9 }, /no puede pasar de/],
      [{ precio_guardia: -5 }, /no puede ser negativo/],
      [{ dias_credito: 4000 }, /no puede pasar de 365/],
      [{ dias_credito: 1.5 }, /número entero/],
      [{ uniforme: 'UNIFORME QUE NO EXISTE' }, /no está en el catálogo/i],
      [{ razon_social: '' }, /no lo borra/],
      [{ razon_social: '   ' }, /no lo borra/],
      [{ razon_social: null }, /no lo borra/],
      [{ razon_social: 'x'.repeat(501) }, /el tope son 500/],
    ];
    for (const [correcciones, mensaje] of casos) {
      const antes = await ficha(id);
      const r = await corregir(ventas, id, correcciones);
      assert.equal(r.status, 400, `${JSON.stringify(correcciones)} → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.match(r.json.error, mensaje);
      const despues = await ficha(id);
      for (const campo of Object.keys(correcciones)) {
        assert.deepEqual(despues[campo], antes[campo], `${campo} cambió con ${JSON.stringify(correcciones)}`);
      }
    }
    // Y nada quedó a medias: la ficha sigue siendo la que el alta escribió.
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 1234.5);
    assert.equal(s.razon_social, 'TIPOS SA');
    assert.equal(s.dias_credito, 30);
  });

  test('C9.3 un lote con una corrección mala no guarda la buena', async () => {
    const id = await abrirConDatos(ventas, 'ALTA LOTE', { precio_guardia: 500, razon_social: 'LOTE SA' });
    const r = await corregir(ventas, id, { precio_guardia: 600, razon_social: [] });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 500, 'la buena tampoco entró');
    assert.equal(s.razon_social, 'LOTE SA');
    assert.equal(correccionesDe(id).length, 0, 'ni el renglón formal de la razón social');
  });

  test('C9.4 un servicio que ya no está activo no se corrige, aunque se tecleara hoy', async () => {
    const BLOQUE = 'Corregir lo que capturaste hoy';
    // Dado de baja.
    const baja = await abrirConDatos(ventas, 'ALTA DE BAJA', { precio_guardia: 5500 });
    const can = await ventas.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: baja,
        fecha: HOY,
        motivo: opciones.motivosBaja[0],
      }),
    });
    assert.equal(can.status, 201, can.texto);
    const r = await corregir(ventas, baja, { precio_guardia: 1 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya no se le captura el alta/);
    assert.equal((await ficha(baja)).precio_guardia, 5500);
    assert.doesNotMatch(comoSeLee((await ventas.pedir(`/estado-fuerza/${baja}`)).texto), new RegExp(BLOQUE));

    // Suspendido: sigue existiendo, pero está en pausa.
    const pausa = await abrirConDatos(ventas, 'ALTA SUSPENDIDO', { precio_guardia: 6600 });
    const sus = await admin.pedir(`/api/servicios/${pausa}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Parado un mes por obra' }),
    });
    assert.equal(sus.status, 200, sus.texto);
    const r2 = await corregir(ventas, pausa, { precio_guardia: 1 });
    assert.equal(r2.status, 400, r2.texto);
    assert.equal((await ficha(pausa)).precio_guardia, 6600);
    assert.doesNotMatch(comoSeLee((await ventas.pedir(`/estado-fuerza/${pausa}`)).texto), new RegExp(BLOQUE));
  });

  test('C9.5 un incremento no le da autoría a nadie sobre las columnas del servicio', async () => {
    /**
     * Un incremento suma guardias y mezcla el desglose: no escribe el precio ni
     * la razón social ni las condiciones de cobro del servicio. Si su renglón
     * reclamara autoría, quien registra una ampliación hoy podría «corregir» el
     * precio que otro tecleó en el alta de 2023.
     */
    const id = await abrirConDatos(ventas, 'ALTA INCREMENTO', { precio_guardia: 7000 });
    fecharAlta(id, marcaUtc(AYER, 10));

    const inc = await operaciones.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'INCREMENTO',
        servicio_id: id,
        zona: opciones.zonas[0],
        asesor: opciones.asesores[0],
        turnos: { '24 HRS': 1 },
        importe: 'SIN_CAMBIO',
      }),
    });
    assert.equal(inc.status, 201, inc.texto);

    const r = await corregir(operaciones, id, { precio_guardia: 1 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo capturó Ventas de prueba al abrir el servicio/);
    assert.equal((await ficha(id)).precio_guardia, 7000);

    // Y el renglón del incremento no reclama ninguna columna.
    const delIncremento = renglones(id).filter((b) => b.accion === 'incremento');
    assert.equal(delIncremento.length, 1);
    assert.equal(delIncremento[0].cambios, null, 'un incremento no apunta autoría de captura');
  });

  test('C9.6 lo que el alta dejó vacío sigue siendo un hueco: se llena, no se corrige', async () => {
    const id = await abrirConDatos(ventas, 'ALTA HUECO', { precio_guardia: 9000 });
    const vacio = await corregir(ventas, id, { direccion: 'Calle Imposible 1' });
    assert.equal(vacio.status, 400, vacio.texto);
    assert.match(vacio.json.error, /todavía está vacío: eso se llena, no se corrige/);

    // Y su autoría es de quien lo llene, no del alta: operaciones lo llena y lo
    // corrige, y ventas —que abrió el servicio— no puede.
    assert.equal((await completar(operaciones, id, { direccion: 'Calle Llenada 2' })).status, 200);
    assert.equal((await corregir(operaciones, id, { direccion: 'Calle Llenada 3' })).status, 200);
    const deVentas = await corregir(ventas, id, { direccion: 'Calle de Ventas 4' });
    assert.equal(deVentas.status, 400, deVentas.texto);
    assert.equal((await ficha(id)).direccion, 'Calle Llenada 3');
  });

  test('C9.7 la regla general sigue en pie: un PATCH suelto no corrige nada', async () => {
    /**
     * La excepción es estrecha y NOMBRADA. Un cuerpo suelto con otro valor sigue
     * siendo un intento de llenar un hueco, y sigue contestando «ya tenía
     * valor», también para los datos del alta. Si no, un doble clic del
     * formulario podría sobrescribir el precio de un cliente.
     */
    const id = await abrirConDatos(ventas, 'ALTA SIN PEDIRLO', { precio_guardia: 8000 });
    const r = await completar(ventas, id, { precio_guardia: 99999 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.yaTenian, ['precio_guardia']);
    assert.deepEqual(r.json.llenados, {});
    assert.deepEqual(r.json.corregidos, {});
    assert.equal((await ficha(id)).precio_guardia, 8000);

    // Y el mismo campo como hueco y como corrección a la vez se rechaza.
    const dos = await completar(ventas, id, {
      precio_guardia: 1,
      correcciones: { precio_guardia: 2 },
    });
    assert.equal(dos.status, 400, dos.texto);
    assert.match(dos.json.error, /llegó como hueco y como corrección/);
    assert.equal((await ficha(id)).precio_guardia, 8000);
  });

  test('C9.8 corregir por el mismo valor no es un hecho y no deja renglón', async () => {
    const id = await abrirConDatos(ventas, 'ALTA IGUAL', { direccion: 'Av. Siempre Viva 742' });
    const r = await corregir(ventas, id, { direccion: 'Av. Siempre Viva 742' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, {});
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });

  test('C9.9 un renglón de alta ilegible no abre la puerta: se niega, no se asume', async () => {
    /**
     * La regla se apoya en un registro histórico, así que hay que decir qué pasa
     * cuando ese registro está sucio. Un `cambios` que no se puede leer no dice
     * nada de nadie: se niega, y la ficha sigue dibujándose.
     */
    const id = await abrirConDatos(ventas, 'ALTA JSON ROTO', { precio_guardia: 1000 });
    for (const sucio of ['{esto no es json', '{"precio_guardia":{}}', '{"precio_guardia":null}', '{}']) {
      conLaBase((db) =>
        db
          .prepare(
            `UPDATE bitacora SET cambios = ?
              WHERE entidad = 'servicio' AND entidad_id = ? AND accion = 'apertura'`
          )
          .run(sucio, Number(id))
      );
      const r = await corregir(ventas, id, { precio_guardia: 1100 });
      assert.equal(r.status, 400, `cambios ${sucio} → ${r.status} ${r.texto.slice(0, 140)}`);
      assert.equal((await ficha(id)).precio_guardia, 1000);
      const html = await ventas.pedir(`/estado-fuerza/${id}`);
      assert.equal(html.status, 200, 'la ficha tiene que seguir dibujándose');
    }
  });

  test('C9.10 dos correcciones a la vez sobre el mismo dato del alta: ninguna se pierde', async () => {
    const id = await abrirConDatos(ventas, 'ALTA CARRERA', { precio_guardia: 100 });
    const [a, b] = await Promise.all([
      corregir(ventas, id, { precio_guardia: 200 }),
      corregir(ventas, id, { precio_guardia: 300 }),
    ]);
    assert.equal(a.status, 200, a.texto);
    assert.equal(b.status, 200, b.texto);
    const final = (await ficha(id)).precio_guardia;
    assert.ok([200, 300].includes(final), `quedó ${final}`);
    assert.equal(renglones(id, 'alta_corregida').length, 2, 'las dos son legítimas y las dos quedan escritas');
  });
});
