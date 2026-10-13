/**
 * Lo que el tester encontró en la corrección del mismo día, cerrado.
 *
 * Tres cosas se prueban aquí, y las tres son del reporte del tester:
 *
 *   A1. Un campo cuyo cambio YA estaba gobernado por el control de la corrección
 *       —motivo escrito, renglón en la tabla `correcciones` y aviso al área
 *       dueña— no se salta ese control por el carril del mismo día: pasa por él.
 *       Hoy ese campo es la razón social, el nombre legal con el que se factura.
 *       La lista no se escribe aquí: se deriva del RBAC, igual que en el código.
 *
 *   M1. La ventana del «mismo día» se ancla al LLENADO y no al último renglón,
 *       así que una corrección no la vuelve a abrir ni la corre al día
 *       siguiente, y la decisión y el renglón que la registra hablan del mismo
 *       instante.
 *
 *   B1-B3. Los topes de cordura de los textos, los números tal como los teclea
 *       una persona, y el motivo con el que un precio entra en su historial.
 *
 * Como el resto de las pruebas de esta carpeta, van contra el servidor de verdad:
 * la regla vive repartida entre la ruta, el RBAC y `lib/servicios.js`, y solo así
 * se comprueba que no se pueda entrar por otro lado.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';
// Importado y no copiado: la verdad de qué campos tienen régimen propio vive en
// el RBAC, y una prueba que la vuelva a escribir deja de avisar el día que
// cambie.
import { CAMPOS_BLOQUEADOS, CAMPOS_CORREGIBLES, AREA_DEL_CAMPO } from '../lib/rbac.js';

/**
 * Los campos cuyo cambio está gobernado por el control de la corrección: la
 * edición corriente los tiene bloqueados y la corrección es la vía por la que sí
 * se cambian. Es la misma derivación que hace `lib/servicios.js`.
 */
const GOBERNADOS = CAMPOS_CORREGIBLES.filter((c) => CAMPOS_BLOQUEADOS.includes(c));

const EN_MEXICO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const HOY = EN_MEXICO.format(new Date());
const diaOficina = (marca) => EN_MEXICO.format(new Date(`${String(marca).replace(' ', 'T')}Z`));
/** Cuántas horas va el servidor por delante de la oficina. Medido, no escrito. */
const DESFASE = (() => {
  const ahora = new Date();
  const alla = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const aqui = new Date(ahora.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((aqui - alla) / 3_600_000);
})();
/** Una marca UTC como la que guarda la base, para una hora de la oficina. */
function marcaUtc(dia, hora, minuto = 0, segundo = 0) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, hora + DESFASE, minuto, segundo)).toISOString().slice(0, 19).replace('T', ' ');
}
const correrDias = (dia, n) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const AYER = correrDias(HOY, -1);

let app;
let admin;
let operaciones;
let ventas;
let juridico;
let opciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
const corregir = (sesion, id, correcciones, motivo) =>
  completar(sesion, id, motivo === undefined ? { correcciones } : { correcciones, motivo });
const avisosDe = async (sesion) => (await sesion.pedir('/api/avisos')).json;
const panelDe = async (sesion, id) => comoSeLee((await sesion.pedir(`/estado-fuerza/${id}`)).texto);

async function abrir(sesion, nombre) {
  const r = await sesion.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: `${nombre} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
    }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const correccionesDe = (id) =>
  conLaBase((db) =>
    db
      .prepare('SELECT motivo, usuario, cambios FROM correcciones WHERE servicio_id = ? ORDER BY id')
      .all(Number(id))
      .map((c) => ({ ...c, cambios: JSON.parse(c.cambios || '{}') }))
  );

const renglones = (id, accion = null) =>
  conLaBase((db) =>
    db
      .prepare(
        `SELECT accion, usuario, rol, detalle, cambios, creado_en FROM bitacora
          WHERE entidad = 'servicio' AND entidad_id = ? AND (? IS NULL OR accion = ?)
          ORDER BY id`
      )
      .all(Number(id), accion, accion)
      .map((r) => ({ ...r, cambios: JSON.parse(r.cambios || 'null') }))
  );

const historialDe = (id) =>
  conLaBase((db) =>
    db
      .prepare('SELECT motivo, precio_anterior, precio_nuevo, usuario FROM precios_historial WHERE servicio_id = ? ORDER BY id')
      .all(Number(id))
  );

/** Mueve a otra hora los renglones que se le digan. */
function fechar(id, marca, acciones) {
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

// ------------------------------------------------------------------------- A1

describe('A1 · un campo con régimen propio pasa por su control, no se lo salta', () => {
  test('A1.1 la lista de campos afectados se deriva del RBAC, y se dice cuál es', async () => {
    // Si algún día otro campo completable entra en ese régimen, esta prueba lo
    // enseña en el mensaje y las de abajo lo tratan igual, sin tocar nada.
    const id = await abrir(operaciones, 'A1 DERIVADA');
    const html = await panelDe(operaciones, id);
    const completables = [...html.matchAll(/id="completar-([a-z_]+)"/g)].map((m) => m[1]);
    const afectados = completables.filter((c) => GOBERNADOS.includes(c));

    assert.ok(completables.length > 0, 'el panel tiene que ofrecer los huecos');
    assert.deepEqual(
      afectados,
      completables.filter((c) => CAMPOS_BLOQUEADOS.includes(c) && CAMPOS_CORREGIBLES.includes(c)),
      'la derivación es la intersección, y nada más'
    );
    assert.ok(
      afectados.includes('razon_social'),
      `los campos completables con régimen propio son: ${afectados.join(', ') || 'ninguno'}`
    );
    console.log(`    # A1.1 campos completables con régimen propio: ${afectados.join(', ')}`);
    for (const c of afectados) {
      assert.ok((AREA_DEL_CAMPO[c] || []).length > 0, `«${c}» está gobernado y no tiene área a la que avisar`);
    }
  });

  test('A1.2 ventas corrige la razón social que capturó, y el control deja su rastro entero', async () => {
    const id = await abrir(ventas, 'A1 RASTRO');
    const avisosAntes = (await avisosDe(juridico)).sinLeer;

    assert.equal((await completar(ventas, id, { razon_social: 'CLIENTE UNO SA' })).status, 200);
    const r = await corregir(ventas, id, { razon_social: 'CLIENTE OTRO SA DE CV' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.corregidos, {
      razon_social: { antes: 'CLIENTE UNO SA', despues: 'CLIENTE OTRO SA DE CV' },
    });
    assert.equal((await ficha(id)).razon_social, 'CLIENTE OTRO SA DE CV');

    // 1. El renglón en la tabla de correcciones, con su motivo y su autor.
    const filas = correccionesDe(id);
    assert.equal(filas.length, 1, `renglones en «correcciones»: ${JSON.stringify(filas)}`);
    assert.deepEqual(filas[0].cambios.razon_social, {
      antes: 'CLIENTE UNO SA',
      despues: 'CLIENTE OTRO SA DE CV',
    });
    assert.equal(filas[0].usuario, 'Ventas de prueba');
    assert.ok(filas[0].motivo.length >= 5, 'un renglón de corrección sin motivo no explica nada');

    // 2. El aviso a jurídico, que es el área del dato.
    assert.equal((await avisosDe(juridico)).sinLeer, avisosAntes + 1, 'jurídico es el área de la razón social');
    const aviso = (await avisosDe(juridico)).avisos[0];
    assert.match(aviso.cuerpo, /Razón social/);
    assert.match(aviso.cuerpo, /CLIENTE OTRO SA DE CV/);
    assert.match(aviso.cuerpo, /Motivo:/);

    // 3. Y el rastro que ya tenía el carril: el llenado intacto y la corrección
    //    en su propio renglón, con nombre, rol y el antes de verdad.
    assert.equal(renglones(id, 'alta_completada').length, 1, 'el llenado no se pisa');
    const arreglo = renglones(id, 'alta_corregida');
    assert.equal(arreglo.length, 1);
    assert.deepEqual(arreglo[0].cambios.razon_social, {
      antes: 'CLIENTE UNO SA',
      despues: 'CLIENTE OTRO SA DE CV',
    });
    assert.equal(arreglo[0].rol, 'ventas');
  });

  test('A1.3 el motivo escrito es el que se guarda; sin motivo se guarda lo que pasó', async () => {
    const conMotivo = await abrir(operaciones, 'A1 MOTIVO');
    await completar(operaciones, conMotivo, { razon_social: 'MAL TECLEADA SA' });
    const r = await corregir(
      operaciones,
      conMotivo,
      { razon_social: 'BIEN TECLEADA SA DE CV' },
      'El acta constitutiva dice otra cosa.'
    );
    assert.equal(r.status, 200, r.texto);
    assert.equal(correccionesDe(conMotivo)[0].motivo, 'El acta constitutiva dice otra cosa.');

    const sinMotivo = await abrir(operaciones, 'A1 SIN MOTIVO');
    await completar(operaciones, sinMotivo, { razon_social: 'OTRA MAL SA' });
    assert.equal((await corregir(operaciones, sinMotivo, { razon_social: 'OTRA BIEN SA' })).status, 200);
    const motivo = correccionesDe(sinMotivo)[0].motivo;
    assert.match(motivo, /mismo día/, `el motivo tiene que decir qué pasó: «${motivo}»`);
    assert.match(motivo, /capturó el dato/);
  });

  test('A1.4 un campo sin régimen propio se corrige como siempre: sin motivo, sin renglón y sin aviso', async () => {
    const id = await abrir(operaciones, 'A1 CORRIENTE');
    const avisosAntes = (await avisosDe(juridico)).sinLeer;
    await completar(operaciones, id, { precio_guardia: 95000, direccion: 'Calle Uno 1' });
    const r = await corregir(operaciones, id, { precio_guardia: 9500, direccion: 'Calle Uno 2' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(correccionesDe(id).length, 0, 'el precio no tiene régimen propio: no va a esa tabla');
    assert.equal((await avisosDe(juridico)).sinLeer, avisosAntes, 'ni se le avisa a nadie');
    assert.equal(renglones(id, 'alta_corregida').length, 1, 'y sigue dejando su renglón de bitácora');
  });

  test('A1.5 el renglón formal no le quita la autoría: la segunda corrección del día entra', async () => {
    const id = await abrir(ventas, 'A1 DOS VECES');
    await completar(ventas, id, { razon_social: 'PRIMERA SA' });
    assert.equal((await corregir(ventas, id, { razon_social: 'SEGUNDA SA' })).status, 200);
    const dos = await corregir(ventas, id, { razon_social: 'TERCERA SA' });
    assert.equal(dos.status, 200, dos.texto);
    assert.deepEqual(dos.json.corregidos.razon_social, { antes: 'SEGUNDA SA', despues: 'TERCERA SA' });
    assert.equal(correccionesDe(id).length, 2, 'y cada una deja su renglón');
  });

  test('A1.6 la pantalla pide el motivo solo donde hace falta, y dice por qué', async () => {
    const conRazon = await abrir(ventas, 'A1 PANTALLA RS');
    await completar(ventas, conRazon, { razon_social: 'PARA LA PANTALLA SA' });
    const conMotivo = await panelDe(ventas, conRazon);
    assert.match(conMotivo, /id="corregir-razon_social"/);
    assert.match(conMotivo, /id="corregir-motivo"/, 'la razón social exige motivo: la caja tiene que estar');
    assert.match(conMotivo, /registro de correcciones/);
    assert.match(conMotivo, /se le avisa a Jurídico/, 'y dice a quién se le avisa, que es por qué se pide');

    const soloPrecio = await abrir(ventas, 'A1 PANTALLA PRECIO');
    await completar(ventas, soloPrecio, { precio_guardia: 1234 });
    const sinMotivo = await panelDe(ventas, soloPrecio);
    assert.match(sinMotivo, /id="corregir-precio_guardia"/);
    assert.doesNotMatch(sinMotivo, /id="corregir-motivo"/, 'un campo corriente no pide explicaciones');
  });

  test('A1.7 la vía de siempre no se aflojó: jurídico sigue sin poder corregir sin motivo', async () => {
    const id = await abrir(operaciones, 'A1 VIA DE SIEMPRE');
    await completar(operaciones, id, { razon_social: 'DE OPERACIONES SA' });
    const r = await juridico.pedir(`/api/servicios/${id}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ razon_social: 'SIN EXPLICAR SA' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /motivo/i);
    assert.equal((await ficha(id)).razon_social, 'DE OPERACIONES SA');
  });
});

// ------------------------------------------------------------------------- M1

describe('M1 · la ventana se ancla al llenado y no rueda', () => {
  test('M1.1 el llenado de ayer no se corrige hoy, aunque la corrección dejara renglón hoy', async () => {
    // El estado que una corrección guardada en el filo de la medianoche dejaba:
    // el llenado fechado ayer y su corrección ya del lado de hoy.
    const id = await abrir(operaciones, 'M1 FILO');
    await completar(operaciones, id, { precio_guardia: 8000 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 8100 })).status, 200);
    fechar(id, marcaUtc(AYER, 23, 59, 59), ['alta_completada']);
    fechar(id, marcaUtc(HOY, 0, 0, 0), ['alta_corregida']);

    const r = await corregir(operaciones, id, { precio_guardia: 1 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER} y hoy es ${HOY}`));
    assert.equal((await ficha(id)).precio_guardia, 8100, 'y no se escribió nada');
  });

  test('M1.2 una corrección no reabre la ventana: lo que manda es el día del llenado', async () => {
    // Misma jugada sin tocar la corrección: basta con que el LLENADO sea de ayer.
    // Antes, el renglón de la corrección daba autoría Y fecha, así que la ventana
    // se podía encadenar noche tras noche sobre un dato cada vez más viejo.
    const id = await abrir(operaciones, 'M1 CADENA');
    await completar(operaciones, id, { precio_guardia: 1000 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 1100 })).status, 200);
    fechar(id, marcaUtc(AYER, 10), ['alta_completada']);

    const r = await corregir(operaciones, id, { precio_guardia: 1200 });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, new RegExp(`se capturó el ${AYER}`));
    assert.equal((await ficha(id)).precio_guardia, 1100);
    // Y la pantalla deja de ofrecerlo, que es la otra mitad: un camino que se ve
    // y no lleva a ninguna parte es peor que no verlo.
    assert.doesNotMatch(await panelDe(operaciones, id), /id="corregir-precio_guardia"/);
  });

  test('M1.3 lo de hoy sigue corrigiéndose, dos veces si hace falta', async () => {
    const id = await abrir(operaciones, 'M1 HOY');
    await completar(operaciones, id, { precio_guardia: 300 });
    assert.equal((await corregir(operaciones, id, { precio_guardia: 30 })).status, 200);
    const dos = await corregir(operaciones, id, { precio_guardia: 15 });
    assert.equal(dos.status, 200, dos.texto);
    assert.equal((await ficha(id)).precio_guardia, 15);
    assert.equal(renglones(id, 'alta_corregida').length, 2);
  });

  test('M1.4 la decisión y el registro hablan del mismo instante', async () => {
    /**
     * La regla lee el reloj para decidir y el renglón lo leía otra vez para
     * fecharse. Entre lo uno y lo otro puede cambiar el día de la oficina, y
     * entonces la bitácora queda diciendo algo que la regla que la escribió no
     * habría aceptado. Ahora el instante se lee una vez: los dos renglones de una
     * misma petición —el llenado y la corrección— llevan la misma marca, que es
     * lo que se puede comprobar sin ponerse a las 23:59:59.
     */
    const id = await abrir(operaciones, 'M1 UN SOLO RELOJ');
    await completar(operaciones, id, { precio_guardia: 500 });
    const r = await completar(operaciones, id, {
      direccion: 'Calle del Reloj 1',
      correcciones: { precio_guardia: 550 },
    });
    assert.equal(r.status, 200, r.texto);

    const todos = renglones(id);
    const llenado = todos.filter((b) => b.accion === 'alta_completada').at(-1);
    const arreglo = todos.filter((b) => b.accion === 'alta_corregida').at(-1);
    assert.equal(arreglo.creado_en, llenado.creado_en, 'el mismo instante para los dos hechos');
    assert.equal(diaOficina(arreglo.creado_en), HOY, 'y es el día con el que se decidió');
  });
});

// ------------------------------------------------------------- B1, B2 y B3

describe('los topes de cordura de los textos, y los números a mano', () => {
  test('B2.1 un texto que no es un dato se rechaza avisando, y no se recorta', async () => {
    const id = await abrir(operaciones, 'B2 LARGO');
    const largo = 'ñ'.repeat(50_000);
    const lleno = await completar(operaciones, id, { direccion: largo });
    assert.equal(lleno.status, 400, lleno.texto);
    assert.match(lleno.json.error, /50,000 caracteres/);
    assert.match(lleno.json.error, /no se recorta en silencio/i);
    assert.equal((await ficha(id)).direccion, null, 'ni entero ni recortado: no entró');

    // Y por el carril de la corrección, igual.
    await completar(operaciones, id, { direccion: 'Calle Corta 1' });
    const corregido = await corregir(operaciones, id, { direccion: largo });
    assert.equal(corregido.status, 400, corregido.texto);
    assert.equal((await ficha(id)).direccion, 'Calle Corta 1');
  });

  test('B2.2 lo que cabe en el tope entra igual que antes', async () => {
    const id = await abrir(operaciones, 'B2 JUSTO');
    const justo = 'A'.repeat(500);
    const r = await completar(operaciones, id, { direccion: justo });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).direccion.length, 500);
    const pasado = await corregir(operaciones, id, { direccion: 'B'.repeat(501) });
    assert.equal(pasado.status, 400, pasado.texto);
  });

  test('B2.3 el motivo también lleva tope, y no se convierte lo que no es texto', async () => {
    const id = await abrir(operaciones, 'B2 MOTIVO');
    await completar(operaciones, id, { razon_social: 'CON MOTIVO SA' });
    const largo = await corregir(operaciones, id, { razon_social: 'OTRA SA' }, 'x'.repeat(501));
    assert.equal(largo.status, 400, largo.texto);
    assert.match(largo.json.error, /motivo/);

    const raro = await completar(operaciones, id, {
      correcciones: { razon_social: 'OTRA SA' },
      motivo: { a: 1 },
    });
    assert.equal(raro.status, 400, raro.texto);
    assert.match(raro.json.error, /texto/);
    assert.equal((await ficha(id)).razon_social, 'CON MOTIVO SA', 'y no se guardó nada del lote');
  });

  test('B3.1 las formas que nadie teclea se rechazan avisando', async () => {
    const id = await abrir(operaciones, 'B3 RARO');
    await completar(operaciones, id, { precio_guardia: 7000 });
    for (const crudo of ['0x10', '1e3', '7e-3', '+8000', '1_000', '1,2,3', '--5', '']) {
      const r = await corregir(operaciones, id, { precio_guardia: crudo });
      if (crudo === '') {
        // El blanco tiene su propio mensaje: una corrección cambia, no borra.
        assert.equal(r.status, 400, `«${crudo}» → ${r.status}`);
      } else {
        assert.equal(r.status, 400, `«${crudo}» → ${r.status} ${r.texto.slice(0, 120)}`);
        assert.match(r.json.error, /no es un número/, `«${crudo}»`);
      }
      assert.equal((await ficha(id)).precio_guardia, 7000, `«${crudo}» movió la columna`);
    }
  });

  test('B3.2 lo que una persona escribe de verdad entra, y con su valor', async () => {
    const id = await abrir(operaciones, 'B3 HUMANO');
    await completar(operaciones, id, { precio_guardia: 1, dias_credito: 1 });
    for (const [crudo, esperado] of [
      ['1,234.56', 1234.56],
      ['  42  ', 42],
      ['0', 0],
      ['$7,000', 7000],
      ['45.7', 45.7],
      ['.5', 0.5],
    ]) {
      const r = await corregir(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 200, `«${crudo}» → ${r.texto}`);
      assert.equal((await ficha(id)).precio_guardia, esperado, `«${crudo}»`);
    }
    // Y los topes siguen atajando lo que es un error de dedo, con su mensaje.
    const caro = await corregir(operaciones, id, { precio_guardia: 1e21 });
    assert.equal(caro.status, 400, caro.texto);
    assert.match(caro.json.error, /no puede pasar de/);
    const plazo = await corregir(operaciones, id, { dias_credito: '1,234.56' });
    assert.equal(plazo.status, 400, plazo.texto);
    assert.match(plazo.json.error, /no puede pasar de 365/);
    const negativo = await corregir(operaciones, id, { precio_guardia: -5 });
    assert.equal(negativo.status, 400, negativo.texto);
    assert.match(negativo.json.error, /no puede ser negativo/, 'el negativo tiene su propio mensaje');
  });

  test('B1.1 el historial de precios dice por dónde entró de verdad', async () => {
    const id = await abrir(ventas, 'B1 HISTORIAL');
    await completar(ventas, id, { precio_guardia: 9000 });
    assert.equal((await corregir(ventas, id, { precio_guardia: 900 })).status, 200);

    const filas = historialDe(id);
    assert.equal(filas.length, 2, JSON.stringify(filas));
    assert.match(filas[0].motivo, /completar el alta/, `el llenado: «${filas[0].motivo}»`);
    assert.match(filas[1].motivo, /Corregido el mismo día/, `la corrección: «${filas[1].motivo}»`);
    // Y ninguno de los dos se atribuye al bloque «Editar», que es de administrador.
    for (const f of filas) {
      assert.doesNotMatch(f.motivo, /^Editado desde la ficha/, `«${f.motivo}» no es por donde entró`);
      assert.equal(f.usuario, 'Ventas de prueba');
    }
  });

  test('B1.2 la edición de la ficha sigue diciendo lo suyo', async () => {
    // El motivo de esa puerta no cambió: ahí sí se editó desde la ficha.
    const id = await abrir(ventas, 'B1 EDICION');
    await completar(ventas, id, { precio_guardia: 4000 });
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ precio_guardia: 4500 }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.match(historialDe(id).at(-1).motivo, /^Editado desde la ficha del servicio$/);
  });
});
