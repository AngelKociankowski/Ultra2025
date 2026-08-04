/**
 * Las aperturas que quedaron anotadas sin llegar al estado de fuerza.
 *
 * Vienen de los archivos viejos: el movimiento se capturó en la hoja de
 * aperturas, pero el servicio nunca salió en un corte, así que al importar no
 * hubo a quién amarrarlo. La apertura existe, el servicio no, y sus guardias no
 * suman en ningún lado.
 *
 * Aplicarlas es terminar ese trámite. Sigue siendo una apertura —la única vía
 * de entrada— y por eso se prueba lo mismo que a cualquier otra: quién puede,
 * qué crea, y que no se pueda usar para meter dos veces el mismo servicio.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let juridico;

const pendientes = async () =>
  (await admin.pedir('/api/aperturas')).json.aperturas.filter((a) => !a.servicio_id && a.tipo !== 'INCREMENTO');

const estadoDeFuerza = async () => {
  const r = await admin.pedir('/api/servicios?estatus=ACTIVO');
  return r.json.servicios;
};

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  juridico = await app.entrarYAsentar(ROLES.juridico);
});

after(async () => {
  await app?.cerrar();
});

describe('aplicar una apertura pendiente', () => {
  test('el archivo trae aperturas sin servicio: por eso existe el botón', async () => {
    const lista = await pendientes();
    assert.ok(lista.length > 0, 'debería haber aperturas sin aplicar en los datos importados');
  });

  test('aplicarla crea el servicio y sus guardias empiezan a sumar', async () => {
    const ap = (await pendientes())[0];
    const antes = await estadoDeFuerza();

    const r = await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.folio, ap.folio);
    assert.ok(r.json.servicioId, 'debe devolver el servicio que creó');

    const ficha = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(ficha.servicio, ap.servicio);
    assert.equal(ficha.estatus, 'ACTIVO');
    assert.equal(ficha.total_guardias, ap.guardias);
    assert.equal(ficha.fecha_alta, ap.fecha, 'el servicio nace con la fecha de su apertura, no con la de hoy');
    assert.equal(ficha.apertura_id, ap.id, 'queda amarrado a la apertura que lo originó');

    const despues = await estadoDeFuerza();
    assert.equal(despues.length, antes.length + 1);

    // Y la apertura deja de estar pendiente.
    const sigue = (await pendientes()).some((p) => p.id === ap.id);
    assert.equal(sigue, false);
  });

  test('el desglose por turno de la apertura es el del servicio', async () => {
    const ap = (await pendientes()).find((a) => Object.keys(JSON.parse(a.turnos_json || '{}')).length > 0);
    assert.ok(ap, 'debería haber alguna con desglose capturado');

    const r = await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 200, r.texto);

    const ficha = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.deepEqual(ficha.turnos, JSON.parse(ap.turnos_json));
  });

  test('aplicarla dos veces no duplica el servicio', async () => {
    const ap = (await pendientes())[0];
    const primera = await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(primera.status, 200, primera.texto);

    const segunda = await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(segunda.status, 400);
    assert.match(segunda.json.error, /ya está aplicada/i);

    const conEseNombre = (await estadoDeFuerza()).filter((s) => s.servicio === ap.servicio);
    assert.equal(conEseNombre.length, 1, 'un solo servicio, no dos');
  });

  test('si el servicio ya opera, no abre uno paralelo: manda a ampliarlo', async () => {
    const ap = (await pendientes())[0];
    assert.equal((await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' })).status, 200);

    // Otra apertura anotada para el mismo servicio —el archivo viejo las tiene—
    // no puede volver a darlo de alta.
    const gemela = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: ap.servicio, turnos: { '24 HRS': 1 } }),
    });
    assert.equal(gemela.status, 201);
    const db = await admin.pedir('/api/aperturas');
    const anotada = db.json.aperturas.find((a) => a.id === gemela.json.aperturaId);
    assert.ok(anotada.servicio_id, 'la apertura normal sí crea su servicio');

    // La que se prueba es una pendiente con el mismo nombre: se rechaza.
    const otra = (await pendientes()).find((p) => p.servicio === ap.servicio);
    if (otra) {
      const r = await admin.pedir(`/api/aperturas/${otra.id}/aplicar`, { method: 'POST' });
      assert.equal(r.status, 400);
      assert.match(r.json.error, /ya está activo/i);
    }
  });

  test('una apertura que no existe no se puede aplicar', async () => {
    const r = await admin.pedir('/api/aperturas/999999/aplicar', { method: 'POST' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no existe/i);
  });
});

describe('quién puede aplicarlas', () => {
  test('quien no registra aperturas tampoco las aplica', async () => {
    // Jurídico ve todo y edita contratos, pero el estado de fuerza no lo mueve.
    const ap = (await pendientes())[0];
    const r = await juridico.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 403);

    const sigue = (await pendientes()).some((p) => p.id === ap.id);
    assert.equal(sigue, true, 'la apertura sigue pendiente');
  });

  test('sin sesión, ni eso', async () => {
    const r = await app.anonimo().pedir('/api/aperturas/1/aplicar', { method: 'POST' });
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });
});

describe('la pantalla lo dice', () => {
  test('avisa cuántas aperturas no están sumando y ofrece el botón', async () => {
    const html = (await admin.pedir('/aperturas')).texto;
    assert.match(html, /sin aplicar/i);
    assert.match(html, /Pendiente/);
    assert.match(html, /no están sumando/i);
  });

  test('se pueden ver solo las pendientes, que son las viejas y no caben en la lista completa', async () => {
    const r = await admin.pedir('/aperturas?pendientes=1');
    assert.equal(r.status, 200);
    assert.match(r.texto, /Ver todas/);
    assert.match(r.texto, /Pendiente · Aplicar/);
  });

  test('a jurídico la pantalla le enseña el estado, no el botón', async () => {
    const html = (await juridico.pedir('/aperturas?pendientes=1')).texto;
    assert.match(html, /Sin aplicar/);
    assert.doesNotMatch(html, /Pendiente · Aplicar/);
  });
});
