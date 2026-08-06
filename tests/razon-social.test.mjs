/**
 * La razón social: quién la cambia y dónde se ve.
 *
 * Es el nombre legal del cliente —el del contrato y el de la factura—, no el
 * corto con el que lo nombra operaciones. De 217 servicios activos, 193 la
 * traen distinta de su nombre: «AGATHA» factura como «ADMINISTRADORA GRUPO
 * ADCCO, AC». Quien persigue un pago habla con el segundo, no con el primero.
 *
 * Dos cambios, y los dos se prueban por su borde:
 *
 *   · Se corrige, no se edita. Pasó de la edición corriente de la ficha —donde
 *     cualquier admin la cambiaba sin dejar rastro del porqué— a la corrección,
 *     que exige motivo escrito y queda registrada aparte.
 *
 *   · La corrigen jurídico y el administrador, y nadie más. Pero no corrigen lo
 *     mismo: jurídico entra SOLO por la razón social. Darle la corrección
 *     entera le dejaría mover la plantilla y revivir servicios dados de baja,
 *     que no es lo que se pidió.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let juridico;
let finanzas;
let operaciones;
let servicioId;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const fichaDe = async (sesion, id) => (await sesion.pedir(`/api/servicios/${id}`)).json.servicio;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);

  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: 'RS CLIENTE CORTO',
      razon_social: 'NOMBRE MAL ESCRITO SA DE CV',
      turnos: { '24 HRS': 3 },
    }),
  });
  assert.equal(r.status, 201, r.texto);
  servicioId = r.json.servicioId;
});

after(async () => {
  await app?.cerrar();
});

describe('ya no se cambia por la edición corriente', () => {
  test('el PATCH de la ficha la rechaza, aunque sea el administrador', async () => {
    const r = await admin.pedir(`/api/servicios/${servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ razon_social: 'POR LA PUERTA DE ATRAS SA' }),
    });
    assert.equal(r.status, 403, r.texto);

    const s = await fichaDe(admin, servicioId);
    assert.equal(s.razon_social, 'NOMBRE MAL ESCRITO SA DE CV', 'no se movió');
  });

  test('mandarla junto con otro campo no la cuela', async () => {
    const r = await admin.pedir(`/api/servicios/${servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ direccion: 'CALLE NUEVA 1', razon_social: 'COLADA SA DE CV' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.rechazados.includes('razon_social'), 'debería decir que la rechazó');

    const s = await fichaDe(admin, servicioId);
    assert.equal(s.direccion, 'CALLE NUEVA 1', 'lo que sí puede, se guarda');
    assert.equal(s.razon_social, 'NOMBRE MAL ESCRITO SA DE CV', 'lo que no, no');
  });
});

describe('jurídico la corrige', () => {
  test('con motivo escrito, y queda registrada', async () => {
    const r = await juridico.pedir(`/api/servicios/${servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({
        motivo: 'El acta constitutiva dice otra cosa',
        razon_social: 'ADMINISTRADORA GRUPO ADCCO, A.C.',
      }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.ok(r.json.cambios.razon_social, 'el cambio viene en la respuesta');

    const s = await fichaDe(admin, servicioId);
    assert.equal(s.razon_social, 'ADMINISTRADORA GRUPO ADCCO, A.C.');
  });

  test('sin motivo no se guarda', async () => {
    const r = await juridico.pedir(`/api/servicios/${servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ razon_social: 'SIN EXPLICAR SA' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /motivo/i);
  });

  test('la corrección aparece en la bitácora con quién y por qué', async () => {
    const html = comoSeLee((await admin.pedir('/bitacora')).texto);
    assert.match(html, /razón social/i);
    assert.match(html, /acta constitutiva/i);
  });
});

describe('jurídico NO corrige lo demás', () => {
  const rechazado = async (cuerpo, donde) => {
    const r = await juridico.pedir(`/api/servicios/${servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'quiero cambiar esto', ...cuerpo }),
    });
    assert.equal(r.status, 403, `${donde} debería rechazarse y devolvió ${r.status}: ${r.texto?.slice(0, 140)}`);
    return r;
  };

  test('no mueve la plantilla', async () => {
    const r = await rechazado({ total_guardias: 99 }, 'total de guardias');
    assert.match(r.json.error, /solo puede corregir: razon_social/);

    const s = await fichaDe(admin, servicioId);
    assert.equal(s.total_guardias, 3, 'la plantilla no se movió');
  });

  test('no cambia el nombre del servicio', async () => {
    await rechazado({ servicio: 'OTRO NOMBRE' }, 'nombre');
    assert.equal((await fichaDe(admin, servicioId)).servicio, 'RS CLIENTE CORTO');
  });

  test('no toca turnos, fecha de alta ni estatus', async () => {
    await rechazado({ turnos: { '12 HRS': 3 } }, 'turnos');
    await rechazado({ fecha_alta: '2020-01-01' }, 'fecha de alta');
    await rechazado({ estatus: 'ACTIVO' }, 'estatus');
  });

  test('mandar la razón social junto con un campo prohibido tumba todo', async () => {
    // No se ignora el campo de más en silencio: eso haría creer que se guardó
    // la corrección completa cuando solo pasó la mitad.
    const r = await rechazado({ razon_social: 'MEDIO GUARDADA SA', total_guardias: 50 }, 'la mezcla');
    assert.match(r.json.error, /No puede tocar: total_guardias/);

    const s = await fichaDe(admin, servicioId);
    assert.equal(s.razon_social, 'ADMINISTRADORA GRUPO ADCCO, A.C.', 'ni siquiera la parte permitida');
    assert.equal(s.total_guardias, 3);
  });

  test('su pantalla le dice qué alcance tiene', async () => {
    // El formulario va cerrado por omisión, así que sus campos no están en el
    // HTML hasta que alguien lo abre: probar las etiquetas ahí no probaría
    // nada. Lo que sí se pinta siempre es el aviso de alcance, y ese solo
    // aparece cuando el rol está limitado a la razón social.
    const html = comoSeLee((await juridico.pedir(`/estado-fuerza/${servicioId}`)).texto);
    assert.match(html, /Corregir captura/);
    assert.match(html, /Tu rol corrige la razón social/);
  });
});

describe('el administrador sigue corrigiendo todo', () => {
  test('la razón social y la plantilla, en la misma corrección', async () => {
    const r = await admin.pedir(`/api/servicios/${servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({
        motivo: 'se capturó mal el alta completa',
        razon_social: 'RAZON DEFINITIVA SA DE CV',
        turnos: { '24 HRS': 5 },
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const s = await fichaDe(admin, servicioId);
    assert.equal(s.razon_social, 'RAZON DEFINITIVA SA DE CV');
    assert.equal(s.total_guardias, 5);
  });

  test('a él no le sale el aviso de alcance limitado', async () => {
    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${servicioId}`)).texto);
    assert.match(html, /Corregir captura/);
    assert.doesNotMatch(html, /Tu rol corrige la razón social/);
  });
});

describe('nadie más entra', () => {
  test('finanzas y operaciones no corrigen', async () => {
    for (const [quien, sesion] of [['finanzas', finanzas], ['operaciones', operaciones]]) {
      const r = await sesion.pedir(`/api/servicios/${servicioId}/correccion`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'a ver si puedo', razon_social: 'NO DEBERIA SA' }),
      });
      assert.equal(r.status, 403, `${quien} no debería poder`);
    }
    assert.equal((await fichaDe(admin, servicioId)).razon_social, 'RAZON DEFINITIVA SA DE CV');
  });

  test('tampoco por el PATCH de la ficha', async () => {
    const r = await finanzas.pedir(`/api/servicios/${servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ razon_social: 'NI POR AQUI SA' }),
    });
    assert.equal(r.status, 403);
  });
});

describe('en cobranza sale el nombre legal, no solo el corto', () => {
  before(async () => {
    await admin.pedir(`/api/servicios/${servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 40000, esquema_facturacion: 'MES_VENCIDO', dias_credito: 30 }),
    });
  });

  test('en «por facturar» va debajo del servicio', async () => {
    const html = comoSeLee((await admin.pedir('/cobranza')).texto);
    assert.match(html, /RS CLIENTE CORTO/);
    assert.match(html, /RAZON DEFINITIVA SA DE CV/);
  });

  test('y en las facturas emitidas también', async () => {
    const periodo = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .slice(0, 7);

    const f = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: servicioId,
        periodo,
        fecha_factura: `${periodo}-05`,
        importe: 40000,
      }),
    });
    assert.equal(f.status, 201, f.texto);

    const html = comoSeLee((await admin.pedir(`/cobranza?periodo=${periodo}`)).texto);
    const emitidas = html.slice(html.indexOf('Emitidas') >= 0 ? html.indexOf('Emitidas') : 0);
    assert.match(emitidas, /RAZON DEFINITIVA SA DE CV/);
  });

  test('cuando la razón social es igual al nombre, no se repite', async () => {
    // Repetir el mismo texto dos veces solo alarga el renglón.
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'RS IGUALITO',
        razon_social: 'RS IGUALITO',
        turnos: { '12 HRS': 1 },
      }),
    });
    assert.equal(r.status, 201, r.texto);
    await admin.pedir(`/api/servicios/${r.json.servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 5000 }),
    });

    const html = comoSeLee((await admin.pedir('/cobranza')).texto);
    const i = html.indexOf('RS IGUALITO');
    assert.notEqual(i, -1);
    const renglon = html.slice(i, i + 400);
    assert.equal(renglon.split('RS IGUALITO').length - 1, 1, 'debería salir una sola vez en su renglón');
  });
});
