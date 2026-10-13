/**
 * Las estructuras capturadas, y las puertas que no estaban vigiladas.
 *
 * `tests/captura-unica.test.mjs` prueba el sitio único por los caminos que se
 * conocían, y U1.11 vigila que no aparezca uno nuevo. Esto prueba lo que la
 * unificación se había dejado fuera a propósito y no era benigno: las cuatro
 * estructuras —el desglose de turnos, el desglose por puesto, el equipo y las
 * autorizaciones— y los motivos y fechas que unas cuantas funciones escribían
 * con su propio `String(x).trim()`.
 *
 * El criterio es el de siempre y es el que importa: lo legítimo sigue entrando
 * por cada una, y lo que no es un dato se contesta en vez de guardarse
 * reinterpretado.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let operaciones;
let finanzas;
let cat;

let n = 0;
const unico = (base) => `${base} ${Date.now().toString(36)}${(n += 1)}`;
const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const abrirCrudo = (s, cuerpo) => s.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });

async function abrirId(sesion, base, extra = {}) {
  const r = await abrirCrudo(sesion, {
    tipo: 'APERTURA',
    servicio: unico(base),
    zona: cat.zonas[0],
    asesor: cat.asesores[0],
    turnos: { '24 HRS': 2 },
    ...extra,
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

before(async () => {
  app = await arrancar();
  admin = await app.entrar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  cat = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

// ------------------------------------------------------------------- E1

describe('E1 · el desglose de turnos escribe por el sitio único', () => {
  test('E1.1 lo que una persona captura de verdad sigue entrando', async () => {
    const id = await abrirId(operaciones, 'E1 TURNOS BUENOS', {
      turnos: { '24 HRS': 3, '12X12 L-D': '2' },
    });
    const s = await ficha(id);
    assert.equal(s.total_guardias, 5, 'la suma del desglose manda, y suma bien');
    assert.deepEqual(JSON.parse(s.turnos_json), { '24 HRS': 3, '12X12 L-D': 2 });
  });

  test('E1.2 una jornada en cero o en blanco es «no lleva gente», no un error', async () => {
    const id = await abrirId(operaciones, 'E1 TURNOS CERO', {
      turnos: { '24 HRS': 2, '12X12 L-D': 0, '12X36': '' },
    });
    assert.deepEqual(JSON.parse((await ficha(id)).turnos_json), { '24 HRS': 2 });
  });

  test('E1.3 lo que no es un número de guardias se contesta, y no nace el servicio', async () => {
    const antes = conLaBase((db) => db.prepare('SELECT COUNT(*) n FROM servicios').get().n);
    const casos = [
      ['0x10', /no es un número/],
      ['7e-3', /no es un número/],
      ['1e3', /no es un número/],
      [1e9, /no puede pasar de 10,000/],
      [2.5, /entero/],
      ['3.7', /entero/],
      [-2, /no puede ser negativo/],
      [[], /lista/],
      [{}, /objeto/],
    ];
    for (const [valor, patron] of casos) {
      const r = await abrirCrudo(operaciones, {
        tipo: 'APERTURA',
        servicio: unico('E1 TURNOS MALOS'),
        zona: cat.zonas[0],
        asesor: cat.asesores[0],
        turnos: { '24 HRS': valor },
      });
      assert.equal(r.status, 400, `turnos ${JSON.stringify(valor)} entró: ${r.texto}`);
      assert.match(r.json.error, patron, `el error dice qué le pasa: ${r.texto}`);
      assert.match(r.json.error, /24 HRS/, `y en qué jornada mirar: ${r.texto}`);
    }
    assert.equal(
      conLaBase((db) => db.prepare('SELECT COUNT(*) n FROM servicios').get().n),
      antes,
      'ninguno de los nueve dejó un servicio a medias'
    );
  });

  test('E1.4 el desglose por turno dentro de la jornada, igual', async () => {
    const bueno = await abrirId(operaciones, 'E1 DETALLE BUENO', {
      turnos: { '24 HRS': 2 },
      turnos_detalle: { '24 HRS': { [cat.turnosDia?.[0] || 'DIURNO']: 2 } },
    });
    assert.ok(bueno);

    const r = await abrirCrudo(operaciones, {
      tipo: 'APERTURA',
      servicio: unico('E1 DETALLE MALO'),
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 2 },
      turnos_detalle: { '24 HRS': { [cat.turnosDia?.[0] || 'DIURNO']: '0x2' } },
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /no es un número/);
  });
});

// ------------------------------------------------------------------- E2

describe('E2 · el desglose por puesto escribe dinero por el sitio único', () => {
  const guardar = (id, partidas) =>
    admin.pedir(`/api/servicios/${id}/partidas`, { method: 'PUT', body: JSON.stringify({ partidas }) });

  test('E2.1 un desglose como lo teclea una persona sigue entrando', async () => {
    const id = await abrirId(operaciones, 'E2 PARTIDAS BUENAS', { turnos: { '24 HRS': 3 } });
    const r = await guardar(id, [
      { puesto: cat.puestos[0], turno: '24 HRS', cantidad: 1, precio_unitario: '32,000', sueldo: '$12,000' },
      { puesto: cat.puestos[1], turno: '24 HRS', cantidad: '2', precio_unitario: '21 000' },
    ]);
    assert.equal(r.status, 200, r.texto);
    const s = await ficha(id);
    assert.equal(s.importe_sin_iva, 74000, '32,000 + 2 × 21 000');
    assert.equal(s.importe_factura, 85840, 'y con IVA');
  });

  test('E2.2 lo que no es dinero no llega a la propuesta de factura', async () => {
    const id = await abrirId(operaciones, 'E2 PARTIDAS MALAS');
    for (const [campo, valor, patron] of [
      ['precio_unitario', '0x10', /no es un número/],
      ['precio_unitario', '1e21', /no es un número/],
      ['precio_unitario', '7e-3', /no es un número/],
      ['precio_unitario', '1 2 3', /no es un número/],
      ['precio_unitario', 1e21, /no puede pasar de/],
      ['precio_unitario', -1, /no puede ser negativo/],
      ['sueldo', '0x10', /no es un número/],
      ['cantidad', '2.5', /entero/],
      ['cantidad', 1e9, /no puede pasar de 10,000/],
    ]) {
      const r = await guardar(id, [
        { puesto: cat.puestos[0], cantidad: 1, precio_unitario: 1000, [campo]: valor },
      ]);
      assert.equal(r.status, 400, `${campo} = ${JSON.stringify(valor)} entró: ${r.texto}`);
      assert.match(r.json.error, patron, r.texto);
      assert.match(r.json.error, /Renglón 1/, `el error dice en qué renglón mirar: ${r.texto}`);
    }
    const s = await ficha(id);
    assert.equal(s.importe_sin_iva, null, 'y nada de eso tocó el importe de la ficha');
    assert.equal(s.importe_factura, null);
  });

  test('E2.3 la SUMA de los renglones también lleva tope', async () => {
    /**
     * Cada renglón puede ser válido y la suma no: lo que se escribe en
     * `importe_sin_iva` e `importe_factura` es la suma, que es un número nuevo
     * que ningún renglón es. Cien renglones de un millón son cien millones en la
     * columna que suman el tablero y los cortes.
     */
    const id = await abrirId(operaciones, 'E2 SUMA');
    const muchos = cat.puestos.slice(0, 4).map((puesto) => ({
      puesto,
      cantidad: 500,
      precio_unitario: 9_000_000,
    }));
    assert.ok(muchos.length >= 2, 'hacen falta al menos dos puestos en el catálogo');
    const r = await guardar(id, muchos);
    assert.equal(r.status, 400, `la suma pasó sin tope y dejó ${(await ficha(id)).importe_sin_iva}: ${r.texto}`);
    assert.match(r.json.error, /no puede pasar de/);
    assert.equal((await ficha(id)).importe_sin_iva, null, 'y la ficha no se movió');
  });
});

// ------------------------------------------------------------------- E3

describe('E3 · el equipo y las autorizaciones', () => {
  test('E3.1 el equipo que se entrega entra, y lo que no es una cantidad no', async () => {
    const id = await abrirId(operaciones, 'E3 EQUIPO BUENO', {
      equipo: { patrulla: 1, radio: '4', lamparas: 0, inventado: 9 },
    });
    const fila = conLaBase((db) =>
      db.prepare('SELECT equipo_json FROM aperturas WHERE servicio_id = ?').get(Number(id))
    );
    assert.deepEqual(
      JSON.parse(fila.equipo_json),
      { patrulla: 1, radio: 4 },
      'los ceros no se guardan y una llave que no es un renglón de la hoja tampoco'
    );

    for (const [valor, patron] of [
      ['0x10', /no es un número/],
      [1e9, /no puede pasar de 10,000/],
      [2.5, /entero/],
      [-1, /no puede ser negativo/],
    ]) {
      const r = await abrirCrudo(operaciones, {
        tipo: 'APERTURA',
        servicio: unico('E3 EQUIPO MALO'),
        zona: cat.zonas[0],
        asesor: cat.asesores[0],
        turnos: { '24 HRS': 1 },
        equipo: { patrulla: valor },
      });
      assert.equal(r.status, 400, `equipo ${JSON.stringify(valor)} entró: ${r.texto}`);
      assert.match(r.json.error, patron, r.texto);
    }
  });

  test('E3.2 `aut_json` guarda las firmas que existen y nada más', async () => {
    const id = await abrirId(operaciones, 'E3 AUT', {
      aut: {
        ventas: true,
        juridico: 1,
        contraloria: false,
        inventada: 'x'.repeat(200_000),
        __proto__: { polucion: 1 },
      },
    });
    const fila = conLaBase((db) =>
      db.prepare('SELECT aut_json FROM aperturas WHERE servicio_id = ?').get(Number(id))
    );
    assert.deepEqual(
      JSON.parse(fila.aut_json),
      { ventas: 1, juridico: 1 },
      'las firmadas, sin las no firmadas y sin la llave que no es una autorización'
    );
    assert.ok(fila.aut_json.length < 200, `la columna guardó ${fila.aut_json.length} caracteres`);
  });
});

// ------------------------------------------------------------------- E4

describe('E4 · los motivos y las fechas que se escribían a mano', () => {
  test('E4.1 suspender: el motivo lleva tope y la fecha tiene que ser una fecha', async () => {
    const id = await abrirId(operaciones, 'E4 SUSPENDER');
    const suspender = (cuerpo) =>
      admin.pedir(`/api/servicios/${id}/suspension`, { method: 'POST', body: JSON.stringify(cuerpo) });

    const largo = await suspender({ motivo: 'x'.repeat(501), desde: '2026-05-01' });
    assert.equal(largo.status, 400, largo.texto);
    const mala = await suspender({ motivo: 'El cliente lo pidió por escrito.', desde: 'mañana' });
    assert.equal(mala.status, 400, `«mañana» no es una fecha: ${mala.texto}`);
    assert.equal((await ficha(id)).estatus, 'ACTIVO', 'y el servicio no se suspendió a medias');

    const bien = await suspender({ motivo: 'El cliente lo pidió por escrito.', desde: '2026-05-01' });
    assert.equal(bien.status, 200, bien.texto);
    const s = await ficha(id);
    assert.equal(s.estatus, 'SUSPENDIDO');
    assert.equal(s.suspendido_desde, '2026-05-01');
  });

  test('E4.2 descartar una apertura: el motivo pasa por el sitio único', async () => {
    const pendientes = await admin.pedir('/api/aperturas?periodo=2023-04');
    const ap = (pendientes.json.aperturas || []).find((a) => !a.servicio_id && !a.descartada);
    assert.ok(ap, 'hacen falta aperturas pendientes del archivo');

    const descartar = (motivo) =>
      admin.pedir(`/api/aperturas/${ap.id}/descartar`, { method: 'POST', body: JSON.stringify({ motivo }) });

    assert.equal((await descartar('x'.repeat(501))).status, 400, 'un motivo de 501 caracteres');
    assert.equal((await descartar({ a: 1 })).status, 400, 'un objeto no es un motivo');
    assert.equal(
      conLaBase((db) => db.prepare('SELECT descartada FROM aperturas WHERE id = ?').get(ap.id).descartada),
      0,
      'y la apertura sigue a la vista de quien tiene que decidir'
    );
    assert.equal((await descartar('No se va a aplicar: el cliente nunca arrancó.')).status, 200);
  });

  test('E4.3 cancelar una factura: el motivo también', async () => {
    const id = await abrirId(operaciones, 'E4 FACTURA', { precio_guardia: '1000' });
    const f = await finanzas.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: id,
        periodo: '2027-05',
        importe: '5,000',
        guardias: 2,
        fecha_factura: '2027-05-31',
      }),
    });
    assert.equal(f.status, 201, f.texto);
    const facturaId = f.json.factura?.id ?? f.json.id;

    // Cancelar una factura es del administrador: finanzas la emite y la corrige.
    const cancelar = (motivo) =>
      admin.pedir('/api/facturas', {
        method: 'PATCH',
        body: JSON.stringify({ id: facturaId, cancelar: motivo }),
      });
    assert.equal((await cancelar('x'.repeat(501))).status, 400);
    const bien = await cancelar('Se emitió con el periodo equivocado.');
    assert.equal(bien.status, 200, bien.texto);
  });
});

// ------------------------------------------------------------------- E5

describe('E5 · las sospechas del reporte, resueltas corriéndolas', () => {
  test('E5.1 un valor que no cambia se escribe con la forma de la columna', async () => {
    /**
     * `exigirDato()` devolvía `actual` verbatim cuando el valor no cambiaba,
     * incluido su tipo. Hoy todos los llamadores pasan `actual` leído de la base,
     * así que no había camino por el que pasara nada; lo que se fija aquí es que
     * mandar el mismo número como cadena deje un número en la columna, no la
     * cadena.
     */
    const id = await abrirId(operaciones, 'E5 ECO', { precio_guardia: 9500 });
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ precio_guardia: '9500', direccion: 'Calle Nueva 1' }),
    });
    assert.equal(r.status, 200, r.texto);
    const fila = conLaBase((db) =>
      db.prepare('SELECT typeof(precio_guardia) AS t, precio_guardia FROM servicios WHERE id = ?').get(Number(id))
    );
    assert.equal(fila.precio_guardia, 9500);
    assert.notEqual(fila.t, 'text', `la columna quedó de tipo ${fila.t}`);
  });

  test('E5.2 por turnos y por partidas ya no entra basura que después se acepte para siempre', async () => {
    /**
     * El atajo por `actual` acepta sin volver a juzgar lo que la columna ya
     * tiene, y eso es intencional: un servicio viejo con una zona retirada no
     * puede obligar a arreglarla para guardar otra cosa. La sospecha era el caso
     * combinado: basura que entra por `turnos` o por `partidas` y queda aceptada
     * para siempre por «Editar». Se cierra por donde entraba.
     */
    const id = await abrirId(operaciones, 'E5 COMBINADO');
    const porTurnos = await abrirCrudo(operaciones, {
      tipo: 'INCREMENTO',
      servicio_id: id,
      turnos: { '24 HRS': 1e9 },
    });
    assert.equal(porTurnos.status, 400, porTurnos.texto);

    const porPartidas = await admin.pedir(`/api/servicios/${id}/partidas`, {
      method: 'PUT',
      body: JSON.stringify({ partidas: [{ puesto: cat.puestos[0], cantidad: 1, precio_unitario: '1e21' }] }),
    });
    assert.equal(porPartidas.status, 400, porPartidas.texto);

    const s = await ficha(id);
    assert.equal(s.total_guardias, 2, 'la plantilla es la que se capturó');
    assert.equal(s.importe_factura, null, 'y no hay un importe que «Editar» tenga que volver a aceptar');
  });

  test('E5.3 el plazo de más de 365 días: lo que de verdad se captura sigue entrando', async () => {
    /**
     * `registrarFactura()` rechaza un plazo sobre 365 días, donde antes lo
     * aceptaba. El plazo más largo capturado en los datos de verdad son 21 días,
     * así que lo que hay que comprobar es que lo real entra y que el absurdo se
     * contesta: 366 días de crédito es un año y un día de plazo.
     */
    const id = await abrirId(operaciones, 'E5 PLAZO', { precio_guardia: '1000' });
    const facturar = (dias, periodo) =>
      finanzas.pedir('/api/facturas', {
        method: 'POST',
        body: JSON.stringify({
          servicio_id: id,
          periodo,
          importe: '5,000',
          guardias: 2,
          fecha_factura: `${periodo}-15`,
          dias_credito: dias,
        }),
      });
    assert.equal((await facturar('21', '2027-06')).status, 201, 'el plazo más largo que existe en los datos');
    assert.equal((await facturar('0', '2027-07')).status, 201, 'y de contado');
    assert.equal((await facturar('365', '2027-08')).status, 201, 'el tope exacto');
    const pasado = await facturar('366', '2027-09');
    assert.equal(pasado.status, 400, pasado.texto);
    assert.match(pasado.json.error, /no puede pasar de 365/);
  });
});

// ------------------------------------------------------------------- E6

describe('E6 · ningún círculo de importaciones en lib/', () => {
  test('E6.1 no hay un solo círculo, y no solo el que se movió', () => {
    /**
     * Los esquemas salieron a `lib/esquemas.js` para romper
     * `facturacion ⇄ captura`, con el motivo escrito de que es «la clase de
     * dependencia que funciona hasta el día que cambia el orden en que se evalúan
     * los módulos». Quedaba otro igual, solo movido de sitio:
     * `captura → comentarios → servicios → captura`, porque `comentarios.js`
     * tomaba los errores de `servicios.js` —que los reexporta— en vez de de
     * `lib/errores.js`, que es donde viven y que no importa nada.
     *
     * Esta prueba no comprueba ESE círculo: comprueba que no hay ninguno. Un
     * círculo roto a mano vuelve a aparecer en otro sitio, y entonces el motivo
     * escrito sigue siendo cierto y la plataforma sigue expuesta.
     */
    const archivos = fs.readdirSync(new URL('../lib/', import.meta.url)).filter((f) => f.endsWith('.js'));
    const existe = new Set(archivos);
    const importaciones = (archivo) => {
      const texto = fs.readFileSync(new URL(`../lib/${archivo}`, import.meta.url), 'utf8');
      return [...texto.matchAll(/from\s+'\.\/([\w-]+)'/g)]
        .map((m) => `${m[1]}.js`)
        .filter((f) => existe.has(f));
    };
    const mapa = new Map(archivos.map((a) => [a, importaciones(a)]));

    const circulos = new Set();
    const bajar = (archivo, ruta) => {
      if (ruta.includes(archivo)) {
        circulos.add([...ruta.slice(ruta.indexOf(archivo)), archivo].join(' → '));
        return;
      }
      for (const destino of mapa.get(archivo) || []) bajar(destino, [...ruta, archivo]);
    };
    for (const archivo of archivos) bajar(archivo, []);

    assert.deepEqual([...circulos], [], `círculos de importación en lib/: ${[...circulos].join(' · ')}`);
  });
});

// ------------------------------------------------------------------- E7

describe('E7 · los guardias del movimiento: se alinean los que mentían, no los demás', () => {
  const aperturasDe = (servicioId) =>
    conLaBase((db) =>
      db
        .prepare('SELECT id, folio, tipo, guardias, periodo FROM aperturas WHERE servicio_id = ? ORDER BY id')
        .all(Number(servicioId))
    );
  const corregir = (id, cuerpo) =>
    operaciones.pedir(`/api/servicios/${id}/correccion`, { method: 'POST', body: JSON.stringify(cuerpo) });

  test('E7.1 corregir una plantilla mal capturada deja renglón en la bitácora', async () => {
    const id = await abrirId(operaciones, 'E7 ALINEAR', {
      turnos: { '24 HRS': 20 },
      precio_guardia: '1000',
      fecha: '2026-08-10',
    });
    const r = await corregir(id, {
      total_guardias: '2',
      turnos: { '24 HRS': 2 },
      motivo: 'Se capturaron veinte guardias donde había dos.',
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(aperturasDe(id)[0].guardias, 2);

    const renglon = conLaBase((db) =>
      db
        .prepare("SELECT detalle FROM bitacora WHERE accion = 'guardias_movimiento' ORDER BY id DESC LIMIT 1")
        .get()
    );
    assert.ok(renglon, 'la alineación no dejó renglón en la bitácora');
    assert.match(renglon.detalle, /«20» → «2»/, `el renglón dice el antes y el después: ${renglon?.detalle}`);
  });

  test('E7.2 un crecimiento legítimo NO reescribe el mes viejo', async () => {
    /**
     * Es la razón por la que la copia existe y no se quita: el total de un mes se
     * cobra a lo que había ESE mes. Un servicio que abrió con dos guardias en
     * 2023 y creció a veinte hoy tiene que seguir diciendo dos en 2023, y una
     * corrección de hoy no puede tocarlo: con varios movimientos, ninguno dice la
     * suma y no hay de dónde saber en cuál estaba el dígito de más.
     */
    const id = await abrirId(operaciones, 'E7 CRECIMIENTO', {
      turnos: { '24 HRS': 2 },
      precio_guardia: '1000',
      fecha: '2023-03-10',
    });
    const inc = await abrirCrudo(operaciones, {
      tipo: 'INCREMENTO',
      servicio_id: id,
      turnos: { '24 HRS': 18 },
      fecha: '2026-07-10',
    });
    assert.equal(inc.status, 201, inc.texto);
    assert.equal((await ficha(id)).total_guardias, 20);
    assert.deepEqual(aperturasDe(id).map((m) => m.guardias), [2, 18], 'cada mes guarda lo suyo');

    const r = await corregir(id, {
      total_guardias: '19',
      turnos: { '24 HRS': 19 },
      motivo: 'El incremento de julio fue de diecisiete, no de dieciocho.',
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(id)).total_guardias, 19, 'la ficha se corrige');
    assert.deepEqual(
      aperturasDe(id).map((m) => m.guardias),
      [2, 18],
      'y marzo de 2023 sigue diciendo dos: ningún movimiento decía veinte'
    );
  });

  test('E7.3 un movimiento que dice otra cosa es su propio registro y no se pisa', async () => {
    const id = await abrirId(operaciones, 'E7 OTRO', {
      turnos: { '24 HRS': 5 },
      precio_guardia: '1000',
      fecha: '2026-06-10',
    });
    const r = await corregir(id, {
      total_guardias: '3',
      turnos: { '24 HRS': 3 },
      motivo: 'Eran tres guardias y se capturaron cinco.',
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(aperturasDe(id)[0].guardias, 3, 'el que decía exactamente lo que la ficha decía antes se alinea');
  });
});
