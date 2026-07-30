/**
 * Permisos por rol, y sobre todo: permisos por CAMPO.
 *
 * Lo que se prueba aquí no es que cada pantalla esté escondida, sino que el
 * servidor rechace campo por campo. Si jurídico manda contrato y factura en la
 * misma petición, se aplica el contrato y la factura vuelve en `rechazados`.
 */

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD } from './servidor.mjs';

let srv;
const s = {};

before(async () => {
  srv = await arrancar();
  for (const [rol, email] of Object.entries(ROLES)) s[rol] = await srv.entrarYAsentar(email);
});
after(async () => srv?.cerrar());

describe('acceso', () => {
  test('sin sesión no se lee nada', async () => {
    const r = await srv.anonimo().pedir('/api/servicios');
    assert.equal(r.status, 401);
  });

  test('una contraseña incorrecta no entra', async () => {
    const r = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ROLES.admin, password: 'incorrecta' }),
    });
    assert.equal(r.status, 401);
  });

  test('los cinco roles consultan la base completa', async () => {
    for (const rol of Object.keys(ROLES)) {
      const r = await s[rol].pedir('/api/servicios');
      assert.equal(r.status, 200, `${rol} debe poder consultar`);
      assert.ok(r.json.servicios.length > 100, `${rol} ve el estado de fuerza`);
    }
  });
});

describe('quién registra movimientos', () => {
  const puede = ['admin', 'operaciones', 'ventas'];
  const noPuede = ['juridico', 'finanzas'];

  for (const rol of puede) {
    test(`${rol} registra aperturas y cancelaciones`, async () => {
      const a = await s[rol].pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({ servicio: `PRUEBA ${rol.toUpperCase()}`, tipo: 'APERTURA', guardias: 2 }),
      });
      assert.equal(a.status, 201);

      const c = await s[rol].pedir('/api/cancelaciones', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: a.json.servicioId, motivo: 'PRUEBA' }),
      });
      assert.equal(c.status, 201);
    });
  }

  for (const rol of noPuede) {
    test(`${rol} no registra movimientos`, async () => {
      const a = await s[rol].pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({ servicio: 'NO DEBE ENTRAR', tipo: 'APERTURA', guardias: 1 }),
      });
      assert.equal(a.status, 403);

      const c = await s[rol].pedir('/api/cancelaciones', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: 1, motivo: 'PRUEBA' }),
      });
      assert.equal(c.status, 403);
    });
  }
});

describe('permisos por campo', () => {
  test('jurídico edita contrato y nada más', async () => {
    const ok = await s.juridico.pedir('/api/servicios/2', {
      method: 'PATCH',
      body: JSON.stringify({ comentarios_contrato: 'Renovación en proceso' }),
    });
    assert.equal(ok.status, 200);

    const no = await s.juridico.pedir('/api/servicios/2', {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 123456 }),
    });
    assert.equal(no.status, 403);
  });

  test('finanzas edita facturación y no toca contratos', async () => {
    const ok = await s.finanzas.pedir('/api/servicios/2', {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 250000, status_cobranza: 'POR COBRAR' }),
    });
    assert.equal(ok.status, 200);

    const no = await s.finanzas.pedir('/api/servicios/2', {
      method: 'PATCH',
      body: JSON.stringify({ fecha_vencimiento_contrato: '2030-01-01' }),
    });
    assert.equal(no.status, 403);
  });

  test('en una petición mezclada se aplica lo permitido y se rechaza el resto', async () => {
    const r = await s.juridico.pedir('/api/servicios/3', {
      method: 'PATCH',
      body: JSON.stringify({
        // Valor único para que sí cuente como cambio aunque la ficha ya
        // tuviera algo escrito en ese campo.
        condiciones_comerciales: 'A mes vencido — prueba ' + Date.now(),
        importe_factura: 999999,
      }),
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.cambios.condiciones_comerciales, 'el contrato sí se aplicó');
    assert.deepEqual(r.json.rechazados, ['importe_factura'], 'la factura volvió rechazada');

    const s3 = await s.admin.pedir('/api/servicios/3');
    assert.notEqual(s3.json.servicio.importe_factura, 999999, 'la factura no se guardó');
  });

  test('ventas y operaciones no editan la ficha', async () => {
    for (const rol of ['ventas', 'operaciones']) {
      const r = await s[rol].pedir('/api/servicios/2', {
        method: 'PATCH',
        body: JSON.stringify({ importe_factura: 1 }),
      });
      assert.equal(r.status, 403, `${rol} no edita`);
    }
  });

  test('el admin edita los tres bloques a la vez', async () => {
    const r = await s.admin.pedir('/api/servicios/4', {
      method: 'PATCH',
      body: JSON.stringify({
        fecha_vencimiento_contrato: '2027-06-30',
        importe_factura: 260000,
        supervisor: 'J. PEÑA',
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(Object.keys(r.json.cambios).length, 3);
    assert.deepEqual(r.json.rechazados, []);
  });
});

describe('cada cambio queda en la bitácora', () => {
  test('la edición del admin aparece en la pantalla de bitácora', async () => {
    const guardado = await s.admin.pedir('/api/servicios/4');
    assert.equal(guardado.json.servicio.importe_factura, 260000, 'el cambio se guardó');

    // La bitácora no tiene API propia; se renderiza en el servidor, así que se
    // comprueba sobre el HTML de la página.
    // El nombre se toma de la propia cuenta: quién es el administrador
    // depende de quién dio de alta la instalación, no de un literal.
    const lista = await s.admin.pedir('/api/usuarios');
    const yo = lista.json.usuarios.find((u) => u.email === ROLES.admin);

    const pagina = await s.admin.pedir('/bitacora');
    assert.equal(pagina.status, 200);
    assert.ok(pagina.texto.includes(yo.nombre), 'registra quién hizo el cambio');
    assert.match(pagina.texto, /260,?000/, 'registra el valor nuevo');
  });

  test('ventas no ve la bitácora: la página también revisa el permiso', async () => {
    const r = await s.ventas.pedir('/bitacora');
    assert.match(r.texto, /Sin permiso/, 'la página corta antes de listar nada');
    assert.doesNotMatch(r.texto, /Carga inicial/, 'no se filtra ningún renglón del historial');
  });
});

describe('descarga de cortes para facturación', () => {
  test('el CSV del mes en curso sale con encabezados y separador de Excel', async () => {
    const r = await s.finanzas.pedir('/api/cortes/actual');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /estado-fuerza-actual\.csv/);

    const lineas = r.texto.trim().split('\r\n');
    assert.match(lineas[0], /^\uFEFF?Servicio;Razón social;/, 'encabezado con punto y coma');
    assert.ok(lineas.length > 200, 'trae todos los servicios activos');
  });

  test('el CSV de un corte cerrado corresponde a ese mes', async () => {
    const r = await s.admin.pedir('/api/cortes/2026-01');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /estado-fuerza-2026-01\.csv/);
  });

  test('un periodo inexistente o mal escrito no descarga nada', async () => {
    assert.equal((await s.admin.pedir('/api/cortes/1999-01')).status, 404);
    assert.equal((await s.admin.pedir('/api/cortes/enero')).status, 400);
  });

  test('sin sesión no se descarga', async () => {
    const r = await srv.anonimo().pedir('/api/cortes/actual');
    assert.equal(r.status, 401);
  });
});

describe('un corte cerrado no se puede tocar', () => {
  test('no existe ninguna ruta de escritura sobre cortes', async () => {
    for (const metodo of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const r = await s.admin.pedir('/api/cortes/2026-01', { method: metodo, body: '{}' });
      assert.ok(r.status === 405 || r.status === 404, `${metodo} no debe estar permitido (dio ${r.status})`);
    }
  });
});

describe('gestión de usuarios', () => {
  test('solo el admin da de alta usuarios', async () => {
    for (const rol of ['juridico', 'finanzas', 'operaciones', 'ventas']) {
      const r = await s[rol].pedir('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({ email: `x${rol}@corporativoultra.com`, nombre: 'X', rol: 'ventas', password: 'Password123' }),
      });
      assert.equal(r.status, 403, `${rol} no da de alta usuarios`);
    }
  });

  test('una contraseña corta se rechaza', async () => {
    const r = await s.admin.pedir('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify({ email: 'corta@corporativoultra.com', nombre: 'Corta', rol: 'ventas', password: 'abc' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /8 caracteres/);
  });

  test('cualquiera puede cambiar su propia contraseña, y la anterior deja de servir', async () => {
    const nueva = 'MiNuevaClave2026';
    const cambio = await s.ventas.pedir('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ actual: PASSWORD, nueva }),
    });
    assert.equal(cambio.status, 200);

    const vieja = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ROLES.ventas, password: PASSWORD }),
    });
    assert.equal(vieja.status, 401, 'la contraseña anterior ya no entra');

    const buena = await srv.anonimo().pedir('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ROLES.ventas, password: nueva }),
    });
    assert.equal(buena.status, 200);
  });

  test('no se cambia la contraseña sin dar la actual', async () => {
    const r = await s.finanzas.pedir('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ actual: 'loquesea', nueva: 'OtraClave2026' }),
    });
    assert.equal(r.status, 401);
  });
});
