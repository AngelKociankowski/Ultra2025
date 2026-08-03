/**
 * Comentarios sobre un servicio.
 *
 * Son notas del equipo: cualquiera con sesión escribe, nadie edita lo que
 * escribió otro, y borrar solo el autor o un administrador.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let srv;
const s = {};

before(async () => {
  srv = await arrancar();
  for (const [rol, email] of Object.entries(ROLES)) s[rol] = await srv.entrarYAsentar(email);
});
after(async () => srv?.cerrar());

const SERVICIO = 5;

describe('escribir notas', () => {
  test('los cinco roles pueden comentar: una nota no cambia el estado de fuerza', async () => {
    for (const rol of Object.keys(ROLES)) {
      const r = await s[rol].pedir(`/api/servicios/${SERVICIO}/comentarios`, {
        method: 'POST',
        body: JSON.stringify({ texto: `Nota de ${rol}` }),
      });
      assert.equal(r.status, 201, `${rol} debe poder comentar`);
      assert.equal(r.json.comentario.rol, rol, 'queda firmada con el rol de quien la escribió');
      assert.ok(r.json.comentario.creado_en, 'y con la fecha');
    }
  });

  test('salen de la más nueva a la más vieja', async () => {
    const r = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`);
    assert.equal(r.status, 200);
    assert.equal(r.json.comentarios.length, 5);
    assert.equal(r.json.comentarios[0].texto, 'Nota de ventas', 'la última escrita va primero');
  });

  test('una nota vacía no se guarda', async () => {
    for (const texto of ['', '   ', '\n\n']) {
      const r = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`, {
        method: 'POST',
        body: JSON.stringify({ texto }),
      });
      assert.equal(r.status, 400, `"${texto}" no debe pasar`);
      assert.match(r.json.error, /vac/i);
    }
  });

  test('una nota kilométrica se rechaza en vez de truncarse', async () => {
    const r = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto: 'x'.repeat(2001) }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /2000/);
  });

  test('no se comenta un servicio que no existe', async () => {
    const r = await s.admin.pedir('/api/servicios/999999/comentarios', {
      method: 'POST',
      body: JSON.stringify({ texto: 'hola' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no existe/i);
  });

  test('sin sesión no se lee ni se escribe', async () => {
    assert.equal((await srv.anonimo().pedir(`/api/servicios/${SERVICIO}/comentarios`)).status, 401);
    assert.equal(
      (await srv.anonimo().pedir(`/api/servicios/${SERVICIO}/comentarios`, {
        method: 'POST',
        body: JSON.stringify({ texto: 'colado' }),
      })).status,
      401
    );
  });
});

describe('borrar notas', () => {
  test('un comentario no se edita', async () => {
    const lista = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`);
    const c = lista.json.comentarios[0];
    const r = await s.admin.pedir(`/api/comentarios/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ texto: 'otra cosa' }),
    });
    assert.equal(r.status, 405);
    assert.match(r.json.error, /no se edita/i);
  });

  test('nadie borra la nota de otro', async () => {
    const lista = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`);
    const deVentas = lista.json.comentarios.find((c) => c.rol === 'ventas');
    const r = await s.operaciones.pedir(`/api/comentarios/${deVentas.id}`, { method: 'DELETE' });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /quien lo escribió|quien escribió/i);
  });

  test('el autor sí borra la suya', async () => {
    const lista = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`);
    const deVentas = lista.json.comentarios.find((c) => c.rol === 'ventas');
    const r = await s.ventas.pedir(`/api/comentarios/${deVentas.id}`, { method: 'DELETE' });
    assert.equal(r.status, 200);

    const despues = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`);
    assert.ok(!despues.json.comentarios.some((c) => c.id === deVentas.id));
  });

  test('el administrador puede borrar la de cualquiera, y queda en la bitácora', async () => {
    const lista = await s.admin.pedir(`/api/servicios/${SERVICIO}/comentarios`);
    const ajena = lista.json.comentarios.find((c) => c.rol === 'juridico');
    const r = await s.admin.pedir(`/api/comentarios/${ajena.id}`, { method: 'DELETE' });
    assert.equal(r.status, 200);

    const bit = await s.admin.pedir('/bitacora');
    assert.match(bit.texto, /Borró un comentario/);
  });

  test('borrar una nota que ya no está no truena', async () => {
    const r = await s.admin.pedir('/api/comentarios/999999', { method: 'DELETE' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no existe/i);
  });
});

describe('las notas no tocan el estado de fuerza', () => {
  test('comentar no mueve guardias ni estatus', async () => {
    const antes = await s.admin.pedir(`/api/servicios/${SERVICIO}`);
    await s.ventas.pedir(`/api/servicios/${SERVICIO}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ texto: 'El cliente pidió cambiar el horario del turno de noche.' }),
    });
    const despues = await s.admin.pedir(`/api/servicios/${SERVICIO}`);
    assert.equal(despues.json.servicio.total_guardias, antes.json.servicio.total_guardias);
    assert.equal(despues.json.servicio.estatus, antes.json.servicio.estatus);
  });
});

describe('ids que no existen', () => {
  test('pedir el hilo de un servicio inexistente da 404, no una lista vacía', async () => {
    for (const id of ['abc', '-1', '999999']) {
      const r = await s.admin.pedir(`/api/servicios/${id}/comentarios`);
      assert.equal(r.status, 404, `id "${id}" debe dar 404 (dio ${r.status})`);
    }
  });
});
