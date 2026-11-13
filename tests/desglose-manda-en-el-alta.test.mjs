/**
 * Las dos puertas que escriben la plantilla contestan igual a la misma
 * contradicción.
 *
 * El defecto medido: al EDITAR un servicio, si el desglose por jornada suma una
 * cosa y el total dice otra, se rechaza con todas sus letras. Al DAR DE ALTA, el
 * desglose ganaba en silencio y el total escrito ni se miraba. Las dos puertas
 * escriben la misma columna del invariante —`servicios.total_guardias`— y que una
 * contradicción pase por una y no por la otra es exactamente cómo aparece un
 * número que después nadie entiende: quien capturó cree que quedó su total, la
 * plataforma guardó la suma, y la diferencia no deja rastro en ningún sitio
 * porque no hubo error ni movimiento.
 *
 * Lo que se mide aquí no es que el alta rechace: es que las dos puertas DIGAN LO
 * MISMO. El mensaje de la edición no se escribe en esta prueba —se le pide a la
 * plataforma y se compara contra el del alta—, así que si mañana alguien cambia
 * uno de los dos textos, esto se pone rojo en vez de dejar las dos puertas
 * contestando parecido.
 *
 * Y la mitad que importa tanto como la otra: el caso legítimo sigue pasando.
 * Cuando solo viene el desglose y no un total aparte, su suma ES el total, que es
 * como manda la rejilla del formulario.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let cat;

const unico = (base) => `${base} ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const abrir = (cuerpo) => admin.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });

const abrirCon = (extra) =>
  abrir({ tipo: 'APERTURA', servicio: unico('DESGLOSE MANDA'), zona: cat.zonas[0], asesor: cat.asesores[0], ...extra });

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const corregir = (id, cuerpo) =>
  admin.pedir(`/api/servicios/${id}/correccion`, { method: 'POST', body: JSON.stringify(cuerpo) });

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  cat = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

describe('el total escrito y el desglose tienen que coincidir en las dos puertas', () => {
  test('la edición rechaza la contradicción, que es el comportamiento de referencia', async () => {
    // Se mide primero porque es el que no cambia: es la vara con la que se mide
    // el alta en la prueba siguiente.
    const r = await abrirCon({ turnos: { '24 HRS': 4 } });
    assert.equal(r.status, 201, r.texto);

    const mal = await corregir(r.json.servicioId, {
      turnos: { '24 HRS': 4 },
      total_guardias: 9,
      motivo: 'Prueba de coherencia entre el total y el desglose al editar.',
    });
    assert.equal(mal.status, 400, mal.texto);
    assert.match(mal.json.error, /Deben coincidir/);
  });

  test('el alta rechaza la MISMA contradicción, con el MISMO mensaje que la edición', async () => {
    /**
     * El mensaje del alta se compara contra el de la edición pedido a la propia
     * plataforma, no contra un texto escrito aquí. Es la única forma de afirmar
     * «dicen lo mismo» que siga siendo verdad cuando alguien reescriba uno de los
     * dos.
     */
    const sembrado = await abrirCon({ turnos: { '24 HRS': 4 } });
    assert.equal(sembrado.status, 201, sembrado.texto);
    const alEditar = await corregir(sembrado.json.servicioId, {
      turnos: { '24 HRS': 4 },
      total_guardias: 9,
      motivo: 'Prueba de coherencia entre el total y el desglose al editar.',
    });
    assert.equal(alEditar.status, 400, alEditar.texto);

    const alDarDeAlta = await abrirCon({ turnos: { '24 HRS': 4 }, guardias: 9 });
    assert.equal(
      alDarDeAlta.status,
      400,
      `el alta aceptó un total que contradice su desglose: ${alDarDeAlta.texto.slice(0, 300)}`
    );
    assert.equal(
      alDarDeAlta.json.error,
      alEditar.json.error,
      'las dos puertas rechazan la misma contradicción con dos mensajes distintos'
    );
  });

  test('y no se queda nada a medias: el servicio rechazado no existe', async () => {
    // Un alta rechazada después de haber creado el servicio sería peor que el
    // defecto: quien captura leería «error» con el servicio ya en el estado de
    // fuerza y lo volvería a intentar.
    const nombre = unico('DESGLOSE MANDA RECHAZADA');
    const activosAntes = (await admin.pedir('/api/servicios')).json.servicios.length;
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: nombre,
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 4 },
      guardias: 9,
    });
    assert.equal(r.status, 400, r.texto);

    const busca = await admin.pedir(`/api/servicios?q=${encodeURIComponent(nombre)}&estatus=TODOS`);
    assert.equal(busca.json.servicios.length, 0, 'el alta rechazada dejó el servicio creado');
    assert.equal(
      (await admin.pedir('/api/servicios')).json.servicios.length,
      activosAntes,
      'el alta rechazada dejó un servicio de más en el estado de fuerza'
    );
  });
});

describe('el caso legítimo no se rompe: cuando solo viene el desglose, su suma es el total', () => {
  test('solo desglose: el total es su suma, y la suma la dice la plataforma', async () => {
    const turnos = { '24 HRS': 3, [cat.turnos[1] || '24 HRS']: 2 };
    const esperado = Object.values(turnos).reduce((a, b) => a + b, 0);
    const r = await abrirCon({ turnos });
    assert.equal(r.status, 201, r.texto);
    const s = await ficha(r.json.servicioId);
    assert.equal(s.total_guardias, esperado, 'la suma del desglose dejó de ser el total');
  });

  test('solo total, sin desglose: entra tal cual', async () => {
    const r = await abrirCon({ guardias: 6 });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(r.json.servicioId)).total_guardias, 6);
  });

  test('los dos, y coinciden: entra, porque no hay nada que contradecir', async () => {
    const r = await abrirCon({ turnos: { '24 HRS': 5 }, guardias: 5 });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(r.json.servicioId)).total_guardias, 5);
  });

  test('el total escrito como texto, igual al desglose: coincide y entra', async () => {
    // El formulario manda cadenas. Comparar el texto contra el número sin pasar
    // por el sitio único habría convertido un alta buena en un rechazo.
    const r = await abrirCon({ turnos: { '24 HRS': 5 }, guardias: '5' });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(r.json.servicioId)).total_guardias, 5);
  });

  test('un cero escrito en el total con desglose puesto no es una contradicción', async () => {
    // Un cero y un blanco son «no se capturó un total aparte», que es como la
    // rejilla manda el formulario entero: el desglose manda y no hay conflicto.
    for (const vacio of [0, '', null]) {
      const r = await abrirCon({ turnos: { '24 HRS': 2 }, guardias: vacio });
      assert.equal(r.status, 201, `con guardias «${String(vacio)}» el alta contestó ${r.status}: ${r.texto.slice(0, 200)}`);
      assert.equal((await ficha(r.json.servicioId)).total_guardias, 2);
    }
  });
});

describe('el incremento es la misma puerta y la misma regla', () => {
  test('un incremento con total contradictorio también se rechaza', async () => {
    const r = await abrirCon({ turnos: { '24 HRS': 4 } });
    assert.equal(r.status, 201, r.texto);
    const antes = (await ficha(r.json.servicioId)).total_guardias;

    const inc = await abrir({
      tipo: 'INCREMENTO',
      servicio_id: r.json.servicioId,
      turnos: { '24 HRS': 2 },
      guardias: 7,
    });
    assert.equal(inc.status, 400, inc.texto);
    assert.match(inc.json.error, /Deben coincidir/);
    assert.equal(
      (await ficha(r.json.servicioId)).total_guardias,
      antes,
      'el incremento rechazado movió la plantilla igual'
    );
  });
});
