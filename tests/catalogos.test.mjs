/**
 * Catálogos de captura: zonas, asesores y turnos.
 *
 * Lo que se prueba aquí es que el catálogo mande de verdad. Que sea una lista
 * desplegable bonita en pantalla no sirve de nada si el servidor sigue
 * aceptando cualquier texto por la API: la captura libre volvería por la puerta
 * de atrás y con ella el mismo asesor escrito de tres maneras, que es justo lo
 * que este cambio viene a evitar.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let ventas;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  ventas = await app.entrarYAsentar(ROLES.ventas);
});

after(async () => {
  await app?.cerrar();
});

/** Lo que los formularios ofrecen hoy. */
async function catalogo(cliente) {
  const r = await cliente.pedir('/api/catalogos');
  assert.equal(r.status, 200);
  return r.json;
}

/** El id de una opción, que solo viaja en la vista de administrador. */
async function idDeOpcion(tipo, valor) {
  const r = await admin.pedir('/api/catalogos?detalle=1');
  assert.equal(r.status, 200);
  const fila = r.json[tipo].opciones.find((o) => o.valor === valor);
  assert.ok(fila, `«${valor}» no aparece en el catálogo de ${tipo}`);
  return fila.id;
}

async function abrirServicio(nombre, cuerpo = {}) {
  const r = await ventas.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombre,
      fecha: '2026-07-15',
      ...cuerpo,
    }),
  });
  assert.equal(r.status, 201, `no se pudo abrir ${nombre}: ${r.texto}`);
  return r.json;
}

async function verServicio(id) {
  const r = await ventas.pedir(`/api/servicios/${id}`);
  assert.equal(r.status, 200);
  return r.json.servicio;
}

describe('arranque', () => {
  test('el catálogo se siembra con lo que ya trae el estado de fuerza', async () => {
    const c = await catalogo(admin);
    assert.ok(c.zonas.length > 0, 'debería haber zonas sembradas');
    assert.ok(c.asesores.length > 0, 'debería haber asesores sembrados');
    assert.ok(c.turnos.includes('12X12 L-D'), 'los turnos base deben estar');
  });

  test('cualquier rol que capture puede leerlo', async () => {
    const c = await catalogo(ventas);
    assert.ok(Array.isArray(c.zonas) && Array.isArray(c.turnos));
  });

  test('el catálogo completo, con ids y usos, es solo del administrador', async () => {
    const mio = await admin.pedir('/api/catalogos?detalle=1');
    assert.equal(mio.status, 200);
    assert.ok(Array.isArray(mio.json.zona.opciones));

    const ajeno = await ventas.pedir('/api/catalogos?detalle=1');
    assert.equal(ajeno.status, 403);
  });
});

describe('solo el administrador lo alimenta', () => {
  test('ventas no puede agregar', async () => {
    const r = await ventas.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'zona', valor: 'ZONA PIRATA' }),
    });
    assert.equal(r.status, 403);
    const c = await catalogo(admin);
    assert.ok(!c.zonas.includes('ZONA PIRATA'));
  });

  test('ventas no puede desactivar ni borrar', async () => {
    const id = await idDeOpcion('turno', '12X12 L-D');

    const patch = await ventas.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id, activo: false }),
    });
    assert.equal(patch.status, 403);

    const del = await ventas.pedir(`/api/catalogos?id=${id}`, { method: 'DELETE' });
    assert.equal(del.status, 403);

    const c = await catalogo(admin);
    assert.ok(c.turnos.includes('12X12 L-D'), 'el turno sigue intacto');
  });
});

describe('altas', () => {
  test('una zona nueva queda disponible para capturar', async () => {
    const r = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'zona', valor: '  Zona   Bajío  ' }),
    });
    assert.equal(r.status, 201);
    // se guarda sin espacios de más: la normalización es del servidor, no de la
    // pantalla, para que no dependa de por dónde se capturó
    assert.equal(r.json.valor, 'Zona Bajío');

    const c = await catalogo(ventas);
    assert.ok(c.zonas.includes('Zona Bajío'));
  });

  test('los turnos se guardan siempre en mayúsculas', async () => {
    const r = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'turno', valor: '6x18 l-d' }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.valor, '6X18 L-D');
  });

  test('no se repite una opción que ya existe', async () => {
    const r = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'turno', valor: '6X18 L-D' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /ya está en el catálogo/);
  });

  test('un catálogo inventado se rechaza', async () => {
    const r = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'supervisor', valor: 'QUIEN SEA' }),
    });
    assert.equal(r.status, 400);
  });

  test('un nombre de una sola letra se rechaza', async () => {
    const r = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'asesor', valor: 'X' }),
    });
    assert.equal(r.status, 400);
  });
});

describe('el turno capturado tiene que estar en el catálogo', () => {
  test('una apertura con un turno inventado se rechaza entera', async () => {
    const r = await ventas.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'PRUEBA TURNO INVENTADO',
        fecha: '2026-07-15',
        turnos: { '99X99': 4 },
        guardias: 4,
      }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no está en el catálogo/);

    // y el servicio no quedó a medias en el estado de fuerza
    const lista = await ventas.pedir('/api/servicios?q=PRUEBA TURNO INVENTADO');
    assert.equal(lista.json.servicios.length, 0);
  });

  test('con el turno dado de alta, la misma apertura pasa', async () => {
    const { servicioId } = await abrirServicio('PRUEBA TURNO NUEVO', {
      turnos: { '6X18 L-D': 4 },
      guardias: 4,
    });
    const s = await verServicio(servicioId);
    assert.equal(s.total_guardias, 4);
    assert.deepEqual(s.turnos, { '6X18 L-D': 4 });
  });
});

describe('renombrar corrige también lo ya capturado', () => {
  test('la zona cambia en el catálogo y en los servicios que la traen', async () => {
    const { servicioId } = await abrirServicio('PRUEBA ZONA RENOMBRADA', {
      zona: 'Zona Bajío',
      turnos: { '12 HRS': 3 },
      guardias: 3,
    });

    const id = await idDeOpcion('zona', 'Zona Bajío');
    const r = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id, valor: 'ZONA BAJÍO' }),
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.servicios >= 1, 'debió corregir el servicio que la traía');

    assert.equal((await verServicio(servicioId)).zona, 'ZONA BAJÍO');

    const c = await catalogo(admin);
    assert.ok(c.zonas.includes('ZONA BAJÍO'));
    assert.ok(!c.zonas.includes('Zona Bajío'));
  });

  test('renombrar un turno mueve el desglose sin cambiar el total', async () => {
    const { servicioId } = await abrirServicio('PRUEBA TURNO RENOMBRADO', {
      turnos: { '6X18 L-D': 5 },
      guardias: 5,
    });

    const id = await idDeOpcion('turno', '6X18 L-D');
    const r = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id, valor: '6X18 L-S' }),
    });
    assert.equal(r.status, 200);

    const s = await verServicio(servicioId);
    assert.equal(s.total_guardias, 5, 'el total no se mueve al renombrar');
    assert.deepEqual(s.turnos, { '6X18 L-S': 5 });
  });

  test('renombrar a un nombre que ya existe se rechaza', async () => {
    const id = await idDeOpcion('turno', '6X18 L-S');
    const r = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id, valor: '12 HRS' }),
    });
    assert.equal(r.status, 400);
  });
});

describe('desactivar y borrar', () => {
  test('una opción en uso no se puede borrar', async () => {
    const id = await idDeOpcion('turno', '6X18 L-S');
    const r = await admin.pedir(`/api/catalogos?id=${id}`, { method: 'DELETE' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /No se puede borrar/);
  });

  test('desactivarla la quita de la captura sin frenar a quien ya la trae', async () => {
    const id = await idDeOpcion('turno', '6X18 L-S');
    const r = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id, activo: false }),
    });
    assert.equal(r.status, 200);

    const c = await catalogo(ventas);
    assert.ok(!c.turnos.includes('6X18 L-S'), 'ya no se ofrece al capturar');

    // pero el servicio que lo trae sigue moviéndose: una disminución tiene que
    // poder nombrar el turno que ese servicio ya tiene capturado.
    const lista = await ventas.pedir('/api/servicios?q=PRUEBA TURNO RENOMBRADO');
    const servicio = lista.json.servicios[0];
    const baja = await ventas.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'REDUCCION',
        servicio_id: servicio.id,
        motivo: 'REDUCCIÓN DE PLANTILLA',
        fecha: '2026-07-20',
        turnos: { '6X18 L-S': 2 },
        guardias: 2,
      }),
    });
    assert.equal(baja.status, 201, baja.texto);
    assert.equal((await verServicio(servicio.id)).total_guardias, 3);
  });

  test('una opción que nadie usa sí se borra', async () => {
    const alta = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'asesor', valor: 'ASESOR DE PRUEBA' }),
    });
    assert.equal(alta.status, 201);

    const r = await admin.pedir(`/api/catalogos?id=${alta.json.id}`, { method: 'DELETE' });
    assert.equal(r.status, 200);

    const c = await catalogo(admin);
    assert.ok(!c.asesores.includes('ASESOR DE PRUEBA'));
  });
});

test('los movimientos del catálogo quedan en la bitácora', async () => {
  const r = await admin.pedir('/bitacora');
  assert.equal(r.status, 200);
  for (const accion of ['catalogo_alta', 'catalogo_renombrar', 'catalogo_desactivar', 'catalogo_baja']) {
    assert.match(r.texto, new RegExp(accion), `falta ${accion} en la bitácora`);
  }
});
