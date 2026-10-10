/**
 * Corregir el dato propio, el mismo día: la única grieta autorizada en «solo de
 * vacío a valor».
 *
 * La regla dura dice que completar un alta es llenar un hueco y que cambiar un
 * dato ya escrito es una edición con sus permisos de siempre. El costo era real:
 * ventas teclea 95000 donde iban 9500 y el precio de ese cliente solo lo puede
 * arreglar el administrador, por teléfono. La decisión fue abrir el caso en que
 * la regla estorba —corregir el error propio recién hecho— y nada más:
 *
 *   1. Solo el dato que ESA persona llenó. El de otro y el que vino de la
 *      importación siguen intocables por esta vía.
 *   2. Solo el mismo día natural de la Ciudad de México, no veinticuatro horas
 *      móviles: «el mismo día» tiene que significar lo que significa en la
 *      oficina.
 *   3. Con nombre y fecha, y sin pisar el registro del llenado: la corrección es
 *      un hecho nuevo y tiene que poderse leer qué decía antes y qué dice ahora.
 *   4. Pedida por su nombre, en `correcciones`. Un PATCH suelto con otro valor
 *      sigue contestando «ya tenía valor», que es la mitad de esta prueba.
 *
 * Las marcas de tiempo se mueven en la bitácora a propósito: es la única forma
 * de probar «ayer» y «el filo de la medianoche» sin mentirle al reloj del
 * proceso, y es justo donde vive el dato del que depende la regla.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const EN_MEXICO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** El día de la operación, que es el único «hoy» que cuenta aquí. */
const HOY = EN_MEXICO.format(new Date());

/** El día de la oficina al que pertenece una marca UTC de la base. */
const diaDeLaOficina = (marcaUtc) => EN_MEXICO.format(new Date(`${marcaUtc.replace(' ', 'T')}Z`));

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
function marcaUtc(diaOficina, hora, minuto = 0) {
  const [a, m, d] = diaOficina.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d, hora + DESFASE, minuto, 0));
  return t.toISOString().slice(0, 19).replace('T', ' ');
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
let juridico;
let opciones;

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

const corregir = (sesion, id, correcciones) => completar(sesion, id, { correcciones });

async function abrirMinimo(nombre, extra = {}) {
  const r = await operaciones.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombre,
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
      ...extra,
    }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

/** La base del servidor de prueba, para mover las marcas de tiempo. */
function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const renglones = (id, accion) =>
  conLaBase((db) =>
    db
      .prepare(
        `SELECT accion, usuario, rol, detalle, cambios, creado_en FROM bitacora
          WHERE entidad = 'servicio' AND entidad_id = ? AND (? IS NULL OR accion = ?)
          ORDER BY id`
      )
      .all(Number(id), accion ?? null, accion ?? null)
      .map((r) => ({ ...r, cambios: JSON.parse(r.cambios || 'null') }))
  );

/** Mueve el llenado de un campo a otra hora de la oficina. */
function fecharLlenado(id, marca) {
  const movidas = conLaBase(
    (db) =>
      db
        .prepare(
          `UPDATE bitacora SET creado_en = ?
            WHERE entidad = 'servicio' AND entidad_id = ? AND accion IN ('alta_completada','alta_corregida')`
        )
        .run(marca, Number(id)).changes
  );
  assert.ok(movidas > 0, 'no había renglón de llenado que mover');
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  opciones = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

describe('la marca de tiempo que decide, leída en la zona de la oficina', () => {
  test('las marcas que la prueba fabrica caen en el día que dicen', () => {
    // Si esto falla, lo demás no prueba nada: las dos marcas del filo son la
    // prueba de que la regla mira el día natural de México y no la cadena UTC.
    assert.equal(diaDeLaOficina(marcaUtc(HOY, 10, 5)), HOY);
    assert.equal(diaDeLaOficina(marcaUtc(AYER, 23, 50)), AYER, 'anoche a las 23:50 sigue siendo ayer');
    assert.equal(diaDeLaOficina(marcaUtc(HOY, 19)), HOY, 'hoy a las 19:00 sigue siendo hoy');
    // Y el filo de verdad: esas dos marcas caen en días UTC que engañan.
    assert.equal(marcaUtc(AYER, 23, 50).slice(0, 10), HOY, 'para el servidor ya es hoy, en la oficina no');
    assert.equal(marcaUtc(HOY, 19).slice(0, 10), MANANA, 'para el servidor ya es mañana, en la oficina no');
  });
});

describe('quien llenó el dato lo corrige el mismo día', () => {
  test('el precio se corrige y se puede leer qué decía antes', async () => {
    const id = await abrirMinimo('CORREGIR PRECIO');
    const lleno = await completar(operaciones, id, { precio_guardia: 95000 });
    assert.equal(lleno.status, 200, lleno.texto);
    assert.equal(lleno.json.llenados.precio_guardia.despues, 95000);

    const r = await corregir(operaciones, id, { precio_guardia: 9500 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, { precio_guardia: { antes: 95000, despues: 9500 } });
    assert.deepEqual(r.json.llenados, {}, 'corregir no es llenar');
    assert.equal((await ficha(id)).precio_guardia, 9500);
  });

  test('el llenado original no se pisa: son dos renglones, no uno', async () => {
    const id = await abrirMinimo('CORREGIR RASTRO');
    await completar(operaciones, id, { razon_social: 'LEGAL EQUIVOCADA SA' });
    await corregir(operaciones, id, { razon_social: 'LEGAL CORRECTA SA DE CV' });

    const bitacora = renglones(id);
    const llenado = bitacora.filter((b) => b.accion === 'alta_completada');
    const arreglo = bitacora.filter((b) => b.accion === 'alta_corregida');
    assert.equal(llenado.length, 1, 'el llenado sigue ahí');
    assert.equal(arreglo.length, 1, 'y la corrección es un renglón nuevo');

    // El llenado conserva lo que se capturó mal, que es lo que explica por qué
    // hubo que corregir.
    assert.deepEqual(llenado[0].cambios.razon_social, { antes: null, despues: 'LEGAL EQUIVOCADA SA' });
    // Y la corrección dice qué decía antes y qué dice ahora.
    assert.deepEqual(arreglo[0].cambios.razon_social, {
      antes: 'LEGAL EQUIVOCADA SA',
      despues: 'LEGAL CORRECTA SA DE CV',
    });
    assert.equal(arreglo[0].usuario, 'Operaciones de prueba', 'con nombre');
    assert.equal(arreglo[0].rol, 'operaciones');
    assert.equal(diaDeLaOficina(arreglo[0].creado_en), HOY, 'y con fecha');
    assert.match(arreglo[0].detalle, /LEGAL EQUIVOCADA SA.*LEGAL CORRECTA SA DE CV/);
  });

  test('un precio corregido deja renglón en el historial de precios', async () => {
    /**
     * Por lo mismo que lo deja el llenado: si la corrección no entrara en el
     * historial, la única lista que contesta «¿por qué este cliente paga esto?»
     * seguiría afirmando el importe que se acaba de desmentir.
     */
    const id = await abrirMinimo('CORREGIR HISTORIAL');
    await completar(operaciones, id, { precio_guardia: 13250 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 12350 })).status, 200);

    const historial = conLaBase((db) =>
      db
        .prepare(
          `SELECT precio_anterior, precio_nuevo, usuario FROM precios_historial
            WHERE servicio_id = ? ORDER BY id`
        )
        .all(id)
    );
    assert.deepEqual(
      historial.map((h) => [h.precio_anterior, h.precio_nuevo]),
      [[null, 13250], [13250, 12350]],
      'el llenado y su corrección, los dos en la misma lista'
    );
    assert.equal(historial[1].usuario, 'Operaciones de prueba');

    // Y la pantalla enseña los dos renglones, no uno.
    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    const i = html.indexOf('Precio y su historia');
    assert.notEqual(i, -1);
    const bloque = html.slice(i, html.indexOf('</section>', i));
    assert.doesNotMatch(bloque, /Todavía no se le ha movido el precio/);
    assert.equal(bloque.match(/editado en la ficha/g)?.length, 2);
  });

  test('dos correcciones seguidas del mismo día, y la cadena se lee entera', async () => {
    const id = await abrirMinimo('CORREGIR DOS VECES');
    await completar(operaciones, id, { dias_credito: 300 });
    assert.equal((await corregir(operaciones, id, { dias_credito: 30 })).status, 200);
    const segunda = await corregir(operaciones, id, { dias_credito: 15 });
    assert.equal(segunda.status, 200, segunda.texto);
    assert.deepEqual(segunda.json.corregidos, { dias_credito: { antes: 30, despues: 15 } });
    assert.equal((await ficha(id)).dias_credito, 15);

    const arreglos = renglones(id, 'alta_corregida');
    assert.equal(arreglos.length, 2, 'dos hechos, dos renglones');
    assert.deepEqual(
      arreglos.map((a) => [a.cambios.dias_credito.antes, a.cambios.dias_credito.despues]),
      [[300, 30], [30, 15]]
    );
  });

  test('corregir por el mismo valor no es un hecho y no deja renglón', async () => {
    const id = await abrirMinimo('CORREGIR IGUAL');
    await completar(operaciones, id, { direccion: 'Av. Siempre Viva 742' });
    const r = await corregir(operaciones, id, { direccion: 'Av. Siempre Viva 742' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, {});
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });

  test('corregir un dato no toca los demás, ni los que todavía faltan', async () => {
    const id = await abrirMinimo('CORREGIR SOLO UNO');
    await completar(operaciones, id, { precio_guardia: 8000, direccion: 'Calle 1' });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 8500 })).status, 200);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 8500);
    assert.equal(s.direccion, 'Calle 1');
    assert.equal(s.razon_social, null, 'lo que seguía vacío sigue vacío');
  });
});

describe('solo el dato propio', () => {
  test('el dato que llenó otra persona no se corrige por esta vía', async () => {
    const id = await abrirMinimo('CORREGIR AJENO');
    await completar(operaciones, id, { razon_social: 'DE OPERACIONES SA' });

    const r = await corregir(ventas, id, { razon_social: 'DE VENTAS SA' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo capturó Operaciones de prueba/);
    assert.match(r.json.error, /cada quien corrige su propio dato/i);
    assert.equal((await ficha(id)).razon_social, 'DE OPERACIONES SA', 'y no se escribió nada');
    assert.equal(renglones(id, 'alta_corregida').length, 0);
  });

  test('ni el administrador, que tampoco lo llenó', async () => {
    // El admin sí puede cambiarlo, pero por «Editar», que es donde quedan sus
    // permisos de siempre. Esta vía es solo para el autor del dato.
    const id = await abrirMinimo('CORREGIR ADMIN AJENO');
    await completar(operaciones, id, { precio_guardia: 7000 });
    const r = await corregir(admin, id, { precio_guardia: 1 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /lo capturó Operaciones de prueba/);
    assert.equal((await ficha(id)).precio_guardia, 7000);
  });

  test('el dato de otro disfrazado de propio: si el admin lo editó, ya no es tuyo', async () => {
    /**
     * El vector serio. Operaciones llena el precio hoy, el administrador lo
     * edita desde la ficha, y operaciones pide «corregir mi dato»: el valor que
     * hay ya no es el suyo, y dejarlo pasar sería deshacer la edición del
     * administrador por la puerta de las correcciones.
     */
    const id = await abrirMinimo('CORREGIR TRAS EDICION');
    await completar(operaciones, id, { precio_guardia: 5000 });
    const edicion = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ precio_guardia: 6000 }),
    });
    assert.equal(edicion.status, 200, edicion.texto);

    const r = await corregir(operaciones, id, { precio_guardia: 5500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /editando la ficha/);
    assert.equal((await ficha(id)).precio_guardia, 6000, 'la edición del administrador se queda');
  });

  test('si otro camino pisó el dato, tampoco es tuyo aunque lo llenaras hoy', async () => {
    /**
     * «Aplicar condiciones de cobro» pisa el esquema, los días de crédito y la
     * forma de pago de los servicios que se le marquen, y se apunta en la
     * bitácora como un solo movimiento de configuración —sin un renglón por
     * servicio ni por campo—. Si la corrección solo preguntara «¿quién lo
     * escribió?», quien llenó los días de crédito por la mañana estaría
     * corrigiendo por la tarde el número que puso finanzas.
     */
    const id = await abrirMinimo('CORREGIR TRAS CONDICIONES');
    await completar(operaciones, id, { dias_credito: 15 });

    const finanzas = await app.entrarYAsentar(ROLES.finanzas);
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

    const r = await corregir(operaciones, id, { dias_credito: 20 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya no dice lo que tú capturaste \(«15»\)/);
    assert.equal((await ficha(id)).dias_credito, 45, 'lo que puso finanzas se queda');
    // Y la pantalla deja de ofrecerlo, que es la otra mitad de la regla.
    const html = comoSeLee((await operaciones.pedir(`/estado-fuerza/${id}`)).texto);
    assert.doesNotMatch(html, /id="corregir-dias_credito"/);
  });

  test('un dato que ya venía cargado de la importación no se corrige', async () => {
    const lista = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    const viejo = lista.find((s) => s.razon_social && s.estatus === 'ACTIVO');
    assert.ok(viejo, 'la base sembrada trae servicios con razón social');

    const r = await corregir(operaciones, viejo.id, { razon_social: 'REESCRITA SA' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya venía cargado/);
    assert.equal((await ficha(viejo.id)).razon_social, viejo.razon_social);
  });

  test('ni lo que nació con la apertura, que tampoco pasó por el panel', async () => {
    // La zona la escribió la apertura, no un llenado de hueco: cambiarla es una
    // edición. Es el mismo caso que el dato de la importación.
    const id = await abrirMinimo('CORREGIR ZONA DE APERTURA');
    const r = await corregir(operaciones, id, { zona: opciones.zonas[1] });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya venía cargado/);
    assert.equal((await ficha(id)).zona, opciones.zonas[0]);
  });
});

describe('solo el mismo día natural de la Ciudad de México', () => {
  test('pasada la medianoche ya no se puede, y el mensaje lo dice', async () => {
    const id = await abrirMinimo('CORREGIR AYER');
    await completar(operaciones, id, { precio_guardia: 4000 });
    fecharLlenado(id, marcaUtc(AYER, 12));

    const r = await corregir(operaciones, id, { precio_guardia: 4500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER} y hoy es ${HOY}`));
    assert.match(r.json.error, /solo vale el mismo día/);
    assert.match(r.json.error, /Pasada la medianoche se cambia desde «Editar»/);
    assert.equal((await ficha(id)).precio_guardia, 4000);
  });

  test('anoche a las 23:50 es ayer, aunque para el servidor ya fuera hoy', async () => {
    /**
     * El filo de la medianoche, por el lado que se cierra. La base guarda UTC:
     * las 23:50 de anoche en la oficina se guardaron con la fecha de HOY. Una
     * regla que comparara cadenas de la base contra el día de la oficina diría
     * «es de hoy» y dejaría corregir lo de anoche.
     */
    const id = await abrirMinimo('CORREGIR FILO CERRADO');
    await completar(operaciones, id, { precio_guardia: 3000 });
    const anoche = marcaUtc(AYER, 23, 50);
    assert.equal(anoche.slice(0, 10), HOY, 'la fixture tiene que engañar al que mire la cadena');
    fecharLlenado(id, anoche);

    const r = await corregir(operaciones, id, { precio_guardia: 3500 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER}`));
    assert.equal((await ficha(id)).precio_guardia, 3000);
  });

  test('hoy a las 19:00 sigue siendo hoy, aunque para el servidor ya sea mañana', async () => {
    // El mismo filo por el lado que se abre: a partir de las 18:00 de la oficina
    // el servidor ya cambió de día, y quien captura a esa hora tiene el mismo
    // derecho a corregir que quien capturó por la mañana.
    const id = await abrirMinimo('CORREGIR FILO ABIERTO');
    await completar(operaciones, id, { precio_guardia: 2000 });
    const tarde = marcaUtc(HOY, 19);
    assert.equal(tarde.slice(0, 10), MANANA, 'la fixture tiene que engañar al que mire la cadena');
    fecharLlenado(id, tarde);

    const r = await corregir(operaciones, id, { precio_guardia: 2500 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, { precio_guardia: { antes: 2000, despues: 2500 } });
  });
});

describe('la regla general sigue en pie', () => {
  test('un PATCH suelto con otro valor sigue contestando «ya tenía valor»', async () => {
    /**
     * Es la mitad de la decisión: la excepción es estrecha y NOMBRADA. Si un
     * cuerpo suelto corrigiera, «solo de vacío a valor» habría dejado de existir
     * para quien llenó el hueco, y un doble clic del formulario podría
     * sobrescribir un precio sin que nadie lo pidiera.
     */
    const id = await abrirMinimo('CORREGIR SIN PEDIRLO');
    await completar(operaciones, id, { precio_guardia: 8000 });

    const r = await completar(operaciones, id, { precio_guardia: 99999 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.yaTenian, ['precio_guardia']);
    assert.deepEqual(r.json.llenados, {});
    assert.deepEqual(r.json.corregidos, {});
    assert.equal((await ficha(id)).precio_guardia, 8000);
  });

  test('un campo todavía vacío se sigue llenando como siempre', async () => {
    const id = await abrirMinimo('CORREGIR Y LLENAR');
    await completar(operaciones, id, { precio_guardia: 1000 });
    const r = await completar(operaciones, id, { direccion: 'Calle Nueva 5' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.llenados.direccion, { antes: null, despues: 'Calle Nueva 5' });
    assert.equal((await ficha(id)).direccion, 'Calle Nueva 5');
  });

  test('un campo vacío no se corrige: se llena', async () => {
    const id = await abrirMinimo('CORREGIR VACIO');
    const r = await corregir(operaciones, id, { direccion: 'Calle Imposible 1' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /todavía está vacío: eso se llena, no se corrige/);
    assert.equal((await ficha(id)).direccion, null);
  });

  test('una corrección no borra el dato', async () => {
    const id = await abrirMinimo('CORREGIR A BLANCO');
    await completar(operaciones, id, { direccion: 'Calle 9' });
    // Y nombrar un campo sin traer valor es un error, no un silencio. En el
    // llenado un campo vacío es «el formulario mandó un control que nadie
    // tocó»; aquí el campo se nombró a propósito, así que callarlo dejaría a
    // quien corrige creyendo que borró el dato.
    for (const blanco of ['', '   ', null]) {
      const r = await corregir(operaciones, id, { direccion: blanco });
      assert.equal(r.status, 400, `${JSON.stringify(blanco)} → ${r.status}`);
      assert.match(r.json.error, /no lo borra/);
      assert.equal((await ficha(id)).direccion, 'Calle 9');
    }
  });

  test('quien no registra aperturas tampoco corrige', async () => {
    const id = await abrirMinimo('CORREGIR JURIDICO');
    await completar(operaciones, id, { direccion: 'Calle 2' });
    const r = await corregir(juridico, id, { direccion: 'Calle 3' });
    assert.equal(r.status, 403, r.texto);
    const sinSesion = await corregir(app.anonimo(), id, { direccion: 'Calle 4' });
    assert.ok([401, 307, 302].includes(sinSesion.status), `sin sesión → ${sinSesion.status}`);
    assert.equal((await ficha(id)).direccion, 'Calle 2');
  });

  test('un servicio que ya no opera no se corrige, igual que no se completa', async () => {
    const id = await abrirMinimo('CORREGIR DE BAJA');
    await completar(operaciones, id, { direccion: 'Calle 7' });
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

    const r = await corregir(operaciones, id, { direccion: 'Calle 8' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya no se le captura el alta/);
    assert.equal((await ficha(id)).direccion, 'Calle 7');
  });
});

describe('intentos de romperlo', () => {
  let id;
  before(async () => {
    id = await abrirMinimo('CORREGIR ATAQUES');
    const r = await completar(operaciones, id, {
      precio_guardia: 1234.5,
      razon_social: 'ATAQUES SA',
      dias_credito: 30,
      uniforme: opciones.uniformes[0],
    });
    assert.equal(r.status, 200, r.texto);
  });

  const noDebeCambiar = async (cuerpo, etiqueta) => {
    const antes = await ficha(id);
    const r = await completar(operaciones, id, cuerpo);
    const despues = await ficha(id);
    for (const k of Object.keys(cuerpo.correcciones || {})) {
      assert.deepEqual(despues[k], antes[k], `${etiqueta}: ${k} cambió`);
    }
    return r;
  };

  test('tipos que no son un dato', async () => {
    // `Infinity` no entra en la lista porque JSON no lo sabe escribir: viaja
    // como `null`, y un nulo es «no mandé nada», que ya se prueba aparte.
    for (const valor of [[], {}, ['a'], true, false]) {
      const r = await noDebeCambiar({ correcciones: { razon_social: valor } }, `razon_social = ${JSON.stringify(valor)}`);
      assert.equal(r.status, 400, `${JSON.stringify(valor)} → ${r.status}`);
      assert.match(r.json.error, /se captura como texto o número|tiene que ser un número/);
    }
  });

  test('un número que no se entiende, y los topes de cordura', async () => {
    const malo = await noDebeCambiar({ correcciones: { precio_guardia: 'carísimo' } }, 'texto');
    assert.equal(malo.status, 400);
    assert.match(malo.json.error, /no es un número/);

    const enorme = await noDebeCambiar({ correcciones: { precio_guardia: 1e9 } }, 'tope');
    assert.equal(enorme.status, 400);
    assert.match(enorme.json.error, /no puede pasar de/);

    const dias = await noDebeCambiar({ correcciones: { dias_credito: 4000 } }, 'tope días');
    assert.equal(dias.status, 400);
    assert.match(dias.json.error, /no puede pasar de 365/);

    const negativo = await noDebeCambiar({ correcciones: { precio_guardia: -5 } }, 'negativo');
    assert.equal(negativo.status, 400);
    assert.match(negativo.json.error, /no puede ser negativo/);
  });

  test('el catálogo se sigue exigiendo al corregir', async () => {
    const r = await noDebeCambiar({ correcciones: { uniforme: 'UNIFORME QUE NO EXISTE' } }, 'catálogo');
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no está en el catálogo/i);
  });

  test('«correcciones» que no es un objeto se contesta con 400 y no con 500', async () => {
    for (const cuerpo of [{ correcciones: 'precio_guardia' }, { correcciones: [] }, { correcciones: 7 }]) {
      const r = await completar(operaciones, id, cuerpo);
      assert.equal(r.status, 400, `${JSON.stringify(cuerpo)} → ${r.status} ${r.texto.slice(0, 120)}`);
      assert.match(r.json.error, /objeto con el campo y su valor nuevo/);
    }
  });

  test('campos fuera de la lista, y las claves heredadas', async () => {
    const antes = await ficha(id);
    const r = await completar(operaciones, id, {
      correcciones: { total_guardias: 99, estatus: 'BAJA', servicio: 'RENOMBRADO', __proto__: { x: 1 } },
    });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.rechazados.includes('estatus'), `rechazados: ${JSON.stringify(r.json.rechazados)}`);
    assert.ok(r.json.rechazados.includes('total_guardias'));
    assert.deepEqual(r.json.corregidos, {});
    const despues = await ficha(id);
    assert.equal(despues.total_guardias, antes.total_guardias);
    assert.equal(despues.estatus, antes.estatus);
    assert.equal(despues.servicio, antes.servicio);
  });

  test('el mismo campo como hueco y como corrección a la vez', async () => {
    const r = await completar(operaciones, id, {
      razon_social: 'POR UN LADO SA',
      correcciones: { razon_social: 'POR EL OTRO SA' },
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /llegó como hueco y como corrección/);
    assert.equal((await ficha(id)).razon_social, 'ATAQUES SA');
  });

  test('dos correcciones a la vez sobre el mismo campo: una gana y las dos quedan escritas', async () => {
    const otro = await abrirMinimo('CORREGIR CARRERA ' + Date.now());
    await completar(operaciones, otro, { precio_guardia: 100 });
    const [a, b] = await Promise.all([
      corregir(operaciones, otro, { precio_guardia: 200 }),
      corregir(operaciones, otro, { precio_guardia: 300 }),
    ]);
    assert.equal(a.status, 200, a.texto);
    assert.equal(b.status, 200, b.texto);
    const final = (await ficha(otro)).precio_guardia;
    assert.ok([200, 300].includes(final), `quedó ${final}`);
    // Las dos son del mismo dueño y del mismo día: las dos son legítimas, y las
    // dos quedan en la bitácora. Lo que no puede pasar es que se pierda una.
    assert.equal(renglones(otro, 'alta_corregida').length, 2);
  });

  test('un lote con una corrección mala no guarda la buena', async () => {
    // El mismo criterio que ya tenía el llenado: «No se guardó nada de este
    // lote». A medias es peor, porque quien captura no sabe qué quedó.
    const otro = await abrirMinimo('CORREGIR LOTE ' + Date.now());
    await completar(operaciones, otro, { precio_guardia: 500, razon_social: 'LOTE SA' });
    const r = await corregir(operaciones, otro, { precio_guardia: 600, razon_social: [] });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(otro);
    assert.equal(s.precio_guardia, 500);
    assert.equal(s.razon_social, 'LOTE SA');
  });
});

describe('el camino se ve solo si de verdad lo tiene', () => {
  const BLOQUE = 'Corregir lo que capturaste hoy';
  const panel = async (sesion, id) => comoSeLee((await sesion.pedir(`/estado-fuerza/${id}`)).texto);

  test('quien llenó el dato ve el bloque; los demás no, en la misma ficha', async () => {
    const id = await abrirMinimo('CORREGIR PANTALLA');
    await completar(operaciones, id, { precio_guardia: 6500 });

    assert.match(await panel(operaciones, id), new RegExp(BLOQUE), 'quien lo llenó sí');
    assert.doesNotMatch(await panel(ventas, id), new RegExp(BLOQUE), 'ventas no llenó nada aquí');
    assert.doesNotMatch(await panel(admin, id), new RegExp(BLOQUE), 'el administrador tampoco');
    assert.doesNotMatch(await panel(juridico, id), new RegExp(BLOQUE), 'jurídico menos');
  });

  test('el bloque enseña el campo que es y lo que dice ahora', async () => {
    const id = await abrirMinimo('CORREGIR PANTALLA CAMPO');
    await completar(operaciones, id, { precio_guardia: 7777 });
    const html = await panel(operaciones, id);
    const i = html.indexOf(BLOQUE);
    const bloque = html.slice(i, i + 2500);
    assert.match(bloque, /id="corregir-precio_guardia"/, 'el campo corregible está dibujado');
    assert.match(bloque, /ahora dice «7777»/);
    assert.match(bloque, /Guardar la corrección/);
    // Y no se cuela un campo que no es suyo ni uno que sigue vacío.
    assert.doesNotMatch(bloque, /id="corregir-zona"/, 'la zona la escribió la apertura');
    assert.doesNotMatch(bloque, /id="corregir-razon_social"/, 'la razón social sigue vacía');
  });

  test('pasada la medianoche el bloque desaparece de la ficha', async () => {
    const id = await abrirMinimo('CORREGIR PANTALLA AYER');
    await completar(operaciones, id, { precio_guardia: 6000 });
    assert.match(await panel(operaciones, id), new RegExp(BLOQUE));

    fecharLlenado(id, marcaUtc(AYER, 12));
    const despues = await panel(operaciones, id);
    assert.doesNotMatch(despues, new RegExp(BLOQUE), 'lo de ayer ya no se ofrece');
    assert.match(despues, /Falta por capturar/, 'y lo que falta se sigue pudiendo capturar');
  });

  test('un servicio al que ya no le falta nada conserva el camino el mismo día', async () => {
    /**
     * Es el caso que se escapaba: el panel solo se montaba cuando faltaba algo,
     * así que al llenar el último hueco desaparecía —y con él el único sitio
     * desde donde corregir lo que se acababa de teclear—.
     */
    const id = await abrirMinimo('CORREGIR SIN FALTANTES');
    const todo = {
      direccion: 'Calle Completa 1',
      supervisor: opciones.supervisores[0],
      gerente: opciones.gerentes[0],
      estado_geo: opciones.estados[0],
      uniforme: opciones.uniformes[0],
      tipo_repse: opciones.tiposRepse[0],
      razon_social: 'COMPLETA SA',
      precio_guardia: 9000,
      esquema_facturacion: 'MES_VENCIDO',
      forma_pago: opciones.formasPago[0],
      dias_credito: 30,
    };
    const r = await completar(operaciones, id, todo);
    assert.equal(r.status, 200, r.texto);

    const html = await panel(operaciones, id);
    assert.doesNotMatch(html, /Falta por capturar/, 'ya no falta nada');
    assert.match(html, /id="completar"/, 'pero el ancla del renglón sigue llevando a algún sitio');
    assert.match(html, new RegExp(BLOQUE));

    const arreglo = await corregir(operaciones, id, { precio_guardia: 9900 });
    assert.equal(arreglo.status, 200, arreglo.texto);
    assert.equal((await ficha(id)).precio_guardia, 9900);
  });

  test('en un servicio de baja no hay bloque, aunque se haya llenado hoy', async () => {
    const id = await abrirMinimo('CORREGIR PANTALLA BAJA');
    await completar(operaciones, id, { precio_guardia: 5500 });
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
    assert.doesNotMatch(await panel(operaciones, id), new RegExp(BLOQUE));
  });
});
