/**
 * El inicio de sesión y el alta de usuarios.
 *
 * La plataforma arranca con una sola cuenta: el primer administrador. Todo el
 * resto del equipo entra porque él lo dio de alta, y nadie se queda operando
 * con la contraseña que le escribió otra persona.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';

let srv;
let admin;

before(async () => {
  srv = await arrancar();
  admin = await srv.entrar(ROLES.admin, PASSWORD);
});
after(async () => srv?.cerrar());

describe('el primer administrador', () => {
  test('el alta inicial crea la cuenta de Ángel como administrador', async () => {
    const r = await admin.pedir('/api/usuarios');
    assert.equal(r.status, 200);
    const angel = r.json.usuarios.find((u) => u.email === 'angelk@corporativoultra.com');
    assert.ok(angel, 'existe la cuenta del administrador inicial');
    assert.equal(angel.rol, 'admin');
    assert.equal(angel.activo, 1);
  });

  test('no se siembran cuentas de demostración', async () => {
    const r = await admin.pedir('/api/usuarios');
    // Los otros cuatro existen porque este arranque los dio de alta a propósito.
    const creadosPorElAdmin = r.json.usuarios.filter((u) => u.email !== 'angelk@corporativoultra.com');
    assert.equal(creadosPorElAdmin.length, 4, 'solo están los que creó el administrador');
    assert.ok(
      !r.json.usuarios.some((u) => u.email === 'admin@corporativoultra.com'),
      'la vieja cuenta genérica de administrador ya no se siembra'
    );
  });
});

describe('el administrador da de alta al equipo', () => {
  const nuevo = {
    email: 'supervisor.prueba@corporativoultra.com',
    nombre: 'Supervisor de prueba',
    rol: 'operaciones',
    password: PASSWORD_TEMPORAL,
  };

  test('se crea con el rol que le toca', async () => {
    const r = await admin.pedir('/api/usuarios', { method: 'POST', body: JSON.stringify(nuevo) });
    assert.equal(r.status, 201);
    assert.ok(r.json.id);
  });

  test('no se repite un correo', async () => {
    const r = await admin.pedir('/api/usuarios', { method: 'POST', body: JSON.stringify(nuevo) });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /ya existe/i);
  });

  test('la contraseña nace prestada y la plataforma lo dice', async () => {
    const r = await admin.pedir('/api/usuarios');
    const u = r.json.usuarios.find((x) => x.email === nuevo.email);
    assert.equal(u.debe_cambiar_password, 1);
  });

  test('quien la trae prestada solo puede llegar a Mi cuenta', async () => {
    const c = await srv.entrar(nuevo.email, PASSWORD_TEMPORAL);

    for (const ruta of ['/', '/estado-fuerza', '/aperturas']) {
      const r = await c.pedir(ruta);
      assert.ok(
        [302, 307].includes(r.status),
        `${ruta} debe redirigir mientras la contraseña sea prestada (dio ${r.status})`
      );
      assert.match(r.headers.get('location') || '', /\/cuenta/);
    }

    const cuenta = await c.pedir('/cuenta');
    assert.equal(cuenta.status, 200, 'Mi cuenta sí abre');
    assert.match(cuenta.texto, /Pon tu contraseña para continuar/);
  });

  test('al poner la suya, se abre la plataforma', async () => {
    const c = await srv.entrar(nuevo.email, PASSWORD_TEMPORAL);
    const cambio = await c.pedir('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: 'ClavePropia2026' }),
    });
    assert.equal(cambio.status, 200);

    const ya = await srv.entrar(nuevo.email, 'ClavePropia2026');
    const tablero = await ya.pedir('/');
    assert.equal(tablero.status, 200, 'ya no lo redirige');

    const lista = await admin.pedir('/api/usuarios');
    const u = lista.json.usuarios.find((x) => x.email === nuevo.email);
    assert.equal(u.debe_cambiar_password, 0, 'la contraseña ya es suya');
  });

  test('si el admin la restablece, vuelve a quedar prestada', async () => {
    const lista = await admin.pedir('/api/usuarios');
    const u = lista.json.usuarios.find((x) => x.email === nuevo.email);

    const r = await admin.pedir('/api/usuarios', {
      method: 'PATCH',
      body: JSON.stringify({ id: u.id, password: 'OtraTemporal2026' }),
    });
    assert.equal(r.status, 200);

    const despues = await admin.pedir('/api/usuarios');
    assert.equal(
      despues.json.usuarios.find((x) => x.email === nuevo.email).debe_cambiar_password,
      1,
      'quien la restablece no es su dueño'
    );
  });

  test('una cuenta desactivada deja de entrar', async () => {
    const lista = await admin.pedir('/api/usuarios');
    const u = lista.json.usuarios.find((x) => x.email === nuevo.email);

    await admin.pedir('/api/usuarios', { method: 'PATCH', body: JSON.stringify({ id: u.id, activo: false }) });

    const r = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: nuevo.email, password: 'OtraTemporal2026' }),
    });
    assert.equal(r.status, 401);
  });

  test('el admin no puede desactivarse a sí mismo', async () => {
    const lista = await admin.pedir('/api/usuarios');
    const yo = lista.json.usuarios.find((x) => x.email === ROLES.admin);
    const r = await admin.pedir('/api/usuarios', {
      method: 'PATCH',
      body: JSON.stringify({ id: yo.id, activo: false }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /tu propia cuenta/i);
  });
});

describe('el login dice a dónde ir', () => {
  test('con la contraseña prestada, manda a Mi cuenta', async () => {
    const r = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'destino.prueba@corporativoultra.com',
        password: PASSWORD_TEMPORAL,
        destino: '/estado-fuerza',
      }),
    });
    // La cuenta se crea aquí mismo para no depender del orden de las pruebas.
    if (r.status === 401) {
      await admin.pedir('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          email: 'destino.prueba@corporativoultra.com',
          nombre: 'Destino de prueba',
          rol: 'ventas',
          password: PASSWORD_TEMPORAL,
        }),
      });
    }
    const r2 = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'destino.prueba@corporativoultra.com',
        password: PASSWORD_TEMPORAL,
        destino: '/estado-fuerza',
      }),
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.destino, '/cuenta', 'ignora el destino pedido mientras la contraseña sea prestada');
  });

  test('con la propia, respeta a dónde iba', async () => {
    const r = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ROLES.admin, password: PASSWORD, destino: '/estado-fuerza' }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.destino, '/estado-fuerza');
  });

  test('un destino externo no se obedece', async () => {
    const r = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ROLES.admin, password: PASSWORD, destino: 'https://otro-sitio.example' }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.destino, '/', 'solo se aceptan rutas propias');
  });
});
