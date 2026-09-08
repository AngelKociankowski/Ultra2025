/**
 * Avisos: que una corrección vuelva a quien capturó el dato.
 *
 * La observación que lo pidió trae su propio ejemplo: en un servicio se
 * anexaron dos guardias de incremento con la jornada equivocada. Alguien lo
 * corrige, el dato queda bien, y la persona que lo tecleó no se entera nunca —y
 * la siguiente vez lo captura igual—. Una corrección que no vuelve a quien se
 * equivocó arregla el dato y deja intacta la causa.
 *
 * Todo esto ya quedaba en la bitácora. La diferencia no es el registro sino a
 * quién va dirigido: una bitácora se consulta cuando ya sabes qué buscas, y
 * nadie la abre por si acaso.
 *
 * Lo que se prueba, en orden de importancia:
 *
 *   · Que llegue a quien capturó y al área del dato.
 *   · Que NO le llegue a quien hizo la corrección. Un buzón que se llena de lo
 *     que uno mismo acaba de hacer deja de leerse, y ahí se acaba el invento.
 *   · Que nadie vea los avisos de otro.
 *   · Que el aviso diga el antes y el después, no solo «te corrigieron algo».
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let operaciones;
let juridico;
let ventas;

const avisosDe = async (sesion) => (await sesion.pedir('/api/avisos')).json;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  ventas = await app.entrarYAsentar(ROLES.ventas);
});

after(async () => {
  await app?.cerrar();
});

/** Da de alta un servicio con la sesión que se le pase: esa es «quien capturó». */
async function abrirCon(sesion, nombre, cuerpo = {}) {
  const r = await sesion.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ servicio: nombre, fecha: '2026-07-08', guardias: 4, ...cuerpo }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

function corregir(sesion, id, cuerpo) {
  return sesion.pedir(`/api/servicios/${id}/correccion`, { method: 'POST', body: JSON.stringify(cuerpo) });
}

describe('a quién le llega', () => {
  test('a quien capturó el servicio', async () => {
    const id = await abrirCon(ventas, 'AVISO PARA QUIEN CAPTURÓ');
    const antes = (await avisosDe(ventas)).sinLeer;

    const r = await corregir(admin, id, {
      total_guardias: 9,
      motivo: 'Se capturaron 4 guardias y en el alta iban 9.',
    });
    assert.equal(r.status, 201, r.texto);

    const despues = await avisosDe(ventas);
    assert.equal(despues.sinLeer, antes + 1, 'a quien lo capturó tiene que llegarle');
    const aviso = despues.avisos[0];
    assert.match(aviso.titulo, /AVISO PARA QUIEN CAPTURÓ/);
    assert.equal(aviso.entidad, 'servicio');
    assert.equal(aviso.entidad_id, id);
  });

  test('y dice el antes y el después, no solo que hubo un cambio', async () => {
    // Es lo único que permite juzgar si la corrección entendió bien lo que uno
    // quiso poner. «Te corrigieron algo» no sirve para nada.
    const { avisos } = await avisosDe(ventas);
    const aviso = avisos.find((a) => /AVISO PARA QUIEN CAPTURÓ/.test(a.titulo));
    assert.match(aviso.cuerpo, /Guardias/);
    assert.match(aviso.cuerpo, /«4»/);
    assert.match(aviso.cuerpo, /«9»/);
    assert.match(aviso.cuerpo, /Motivo:/);
  });

  test('al área dueña del dato: la razón social es de jurídico', async () => {
    const id = await abrirCon(ventas, 'AVISO PARA EL ÁREA', { razon_social: 'MAL ESCRITA' });
    const antes = (await avisosDe(juridico)).sinLeer;

    const r = await corregir(admin, id, {
      razon_social: 'BIEN ESCRITA S.A. DE C.V.',
      motivo: 'El acta constitutiva dice otra cosa.',
    });
    assert.equal(r.status, 201, r.texto);

    assert.equal((await avisosDe(juridico)).sinLeer, antes + 1, 'jurídico es el área de ese dato');
  });

  test('la plantilla es de operaciones, no de jurídico', async () => {
    const id = await abrirCon(admin, 'AVISO SOLO A OPERACIONES');
    const antesOps = (await avisosDe(operaciones)).sinLeer;
    const antesJur = (await avisosDe(juridico)).sinLeer;

    await corregir(admin, id, { total_guardias: 7, motivo: 'La plantilla real es de siete.' });

    assert.equal((await avisosDe(operaciones)).sinLeer, antesOps + 1);
    assert.equal((await avisosDe(juridico)).sinLeer, antesJur, 'a jurídico no le toca este dato');
  });

  test('a quien hizo la corrección NO le llega, aunque él lo hubiera capturado', async () => {
    // Ya lo sabe. Un buzón lleno de lo que uno mismo acaba de hacer deja de
    // leerse, y entonces el día que trae algo tampoco se lee.
    const id = await abrirCon(operaciones, 'AVISO QUE NO SE MANDA SOLO');
    const antes = (await avisosDe(operaciones)).sinLeer;

    const r = await corregir(operaciones, id, {
      total_guardias: 5,
      motivo: 'Me equivoqué yo al capturarlo.',
    });
    assert.equal(r.status, 201, r.texto);

    assert.equal((await avisosDe(operaciones)).sinLeer, antes, 'se avisó a sí mismo');
  });
});

describe('los avisos son de quien son', () => {
  test('cada quien ve solo los suyos', async () => {
    const mios = (await avisosDe(ventas)).avisos;
    const suyos = (await avisosDe(juridico)).avisos;
    const idsMios = new Set(mios.map((a) => a.id));
    for (const a of suyos) {
      assert.ok(!idsMios.has(a.id), 'un aviso apareció en dos buzones distintos');
    }
  });

  test('sin sesión no hay buzón', async () => {
    const r = await app.anonimo().pedir('/api/avisos');
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });

  test('marcar como leído solo afecta a los propios', async () => {
    const antesJuridico = (await avisosDe(juridico)).sinLeer;
    assert.ok(antesJuridico > 0, 'hace falta al menos uno sin leer para probar esto');

    const r = await ventas.pedir('/api/avisos', { method: 'POST', body: JSON.stringify({ todos: true }) });
    assert.equal(r.status, 200);

    assert.equal((await avisosDe(ventas)).sinLeer, 0, 'los propios sí se marcaron');
    assert.equal((await avisosDe(juridico)).sinLeer, antesJuridico, 'los de otro no se tocaron');
  });

  test('el de otro no se puede marcar por id', async () => {
    const ajeno = (await avisosDe(juridico)).avisos.find((a) => !a.leido_en);
    assert.ok(ajeno, 'hace falta un aviso ajeno sin leer');

    const r = await ventas.pedir('/api/avisos', { method: 'POST', body: JSON.stringify({ id: ajeno.id }) });
    assert.equal(r.status, 200);
    assert.equal(r.json.cambiado, false, 'marcó un aviso que no era suyo');
    assert.equal((await avisosDe(juridico)).avisos.find((a) => a.id === ajeno.id).leido_en, null);
  });
});

describe('la pantalla', () => {
  test('el menú enseña el contador cuando hay algo sin leer', async () => {
    const id = await abrirCon(admin, 'AVISO PARA EL CONTADOR');
    await corregir(admin, id, { total_guardias: 3, motivo: 'Para que le llegue a operaciones.' });

    const html = (await operaciones.pedir('/')).texto;
    assert.match(html, /Avisos sin leer/);
  });

  test('la pantalla los lista con el servicio del que hablan', async () => {
    const html = (await operaciones.pedir('/avisos')).texto;
    assert.match(html, /AVISO PARA EL CONTADOR/);
    assert.match(html, /Ver el servicio/);
  });

  test('sin avisos, lo dice y no finge una bandeja llena', async () => {
    await juridico.pedir('/api/avisos', { method: 'POST', body: JSON.stringify({ todos: true }) });
    const limpio = await app.entrarYAsentar(ROLES.finanzas);
    const html = (await limpio.pedir('/avisos')).texto;
    assert.match(html, /No tienes avisos/);
  });
});
