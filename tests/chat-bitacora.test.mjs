/**
 * La consulta de la Bitácora: espejo de su pantalla, y ni un campo de más.
 *
 * Es la consulta número ocho y entró por una decisión del director que revirtió
 * la decisión 6 del expediente —ahí la bitácora se dejaba fuera del asistente a
 * propósito—. Lo que hay que defender de ella son tres cosas, y las tres se
 * miden corriendo el asistente de verdad y leyendo los bytes que salen hacia el
 * servicio externo:
 *
 *   1. QUE NO ENSANCHE EL PERMISO. La consulta hereda el de la pantalla
 *      `/bitacora`, y eso no se afirma leyendo `lib/rbac.js` —sería el mismo
 *      código diciéndose que sí a sí mismo— sino abriendo la pantalla con los
 *      seis roles y comparando quién la puede abrir contra a quién se le ofrece
 *      la consulta. El guardián del espejo sabe que el permiso existe, no de qué
 *      pantalla salió; esta prueba es justo ese hueco cerrado a mano, una vez.
 *   2. QUE LO QUE VIAJA SEA LO QUE LA PANTALLA PINTA. Un movimiento sembrado
 *      tiene que aparecer en los dos sitios, con el mismo texto.
 *   3. QUE NO VIAJE LO QUE NADIE PIDIÓ. La bitácora registra también el alta de
 *      cuentas de usuario y ese renglón lleva el correo de la persona. No hace
 *      falta para ninguna de las preguntas de esta consulta y sale hacia fuera,
 *      así que se queda; y el antes/después de un precio sigue pasando por el
 *      filtro de `CAMPOS_POR_PERMISO`, que es lo que lo cierra para quien no
 *      entra a «Precios».
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD_TEMPORAL } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

let app;
let doble;
let admin;
let cat;
let PERMISOS;
let HERRAMIENTAS;

/** El servicio sembrado por esta prueba, con un nombre que se puede buscar. */
const sembrado = {};
/** El precio distintivo con el que se mide el filtro de campos. */
const PRECIO_DISTINTIVO = 31417;
/** El correo de la cuenta sembrada, que la pantalla pinta y el modelo no debe recibir. */
const CORREO_SEMBRADO = 'bitacora.espejo@corporativoultra.com';

const comoLaLeeUnaPersona = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/**
 * Corre una consulta por HTTP con el rol que se diga y devuelve lo que salió:
 * los datos y el texto crudo que viajó, para poder buscar en él un campo que no
 * debería estar.
 */
async function correr(sesion, nombre, args) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
  const r = await sesion.pedir('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ pregunta: `corre ${nombre}`, previas: [] }),
  });
  if (r.status !== 200) return { status: r.status, datos: null, crudo: r.texto, rechazo: r.texto };
  const bloques = (doble.peticiones()[1]?.cuerpo?.messages || [])
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  if (!bloques.length) return { status: 200, datos: null, crudo: r.texto, rechazo: 'no volvió ningún resultado' };
  const crudo = String(bloques[0].content);
  if (bloques[0].is_error) return { status: 200, datos: null, crudo, rechazo: crudo };
  const fichas = eventos(r.texto).filter((e) => e.tipo === 'ficha');
  return { status: 200, datos: JSON.parse(crudo).datos, crudo, ficha: fichas[0]?.ficha, rechazo: null };
}

/** Si ese rol puede abrir la pantalla de la Bitácora, medido en su HTML. */
async function abreLaPantalla(sesion) {
  const html = comoLaLeeUnaPersona((await sesion.pedir('/bitacora')).texto);
  const sinPermiso = /Sin permiso/.test(html) && /no tiene acceso a la bitácora/.test(html);
  return !sinPermiso;
}

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  app = await arrancar({ env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' } });
  admin = await app.entrarYAsentar(ROLES.admin);
  cat = (await admin.pedir('/api/catalogos')).json;

  const { register } = await import('node:module');
  register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
  ({ PERMISOS } = await import('../lib/rbac.js'));
  ({ HERRAMIENTAS } = await import(new URL('../lib/chat-herramientas.js', import.meta.url).href));

  // Un servicio propio, para que el filtro por servicio tenga algo que encontrar
  // que no se confunda con los 217 de la carga inicial.
  sembrado.nombre = 'BITACORA ESPEJO MIDE AQUI';
  const alta = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: sembrado.nombre,
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 2 },
    }),
  });
  assert.equal(alta.status, 201, alta.texto);
  sembrado.id = alta.json.servicioId;

  // Una edición del precio por guardia: deja un renglón «editar» en la bitácora
  // con el antes y el después del campo que `CAMPOS_POR_PERMISO` cierra.
  const editado = await admin.pedir(`/api/servicios/${sembrado.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ precio_guardia: PRECIO_DISTINTIVO }),
  });
  assert.equal(editado.status, 200, editado.texto);

  // Una corrección de la plantilla: es el movimiento que no deja rastro en
  // ninguna pantalla de movimientos, y la pregunta que trajo esta consulta.
  sembrado.motivoCorreccion = 'La plantilla real eran cinco guardias desde el alta y se capturaron dos.';
  const corregido = await admin.pedir(`/api/servicios/${sembrado.id}/correccion`, {
    method: 'POST',
    body: JSON.stringify({
      total_guardias: 5,
      turnos: { '24 HRS': 5 },
      motivo: sembrado.motivoCorreccion,
    }),
  });
  assert.equal(corregido.status, 201, corregido.texto);

  // Y una cuenta de usuario, cuyo renglón lleva el correo de la persona.
  const cuenta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({
      email: CORREO_SEMBRADO,
      nombre: 'Bitácora de prueba',
      rol: 'espectador',
      password: PASSWORD_TEMPORAL,
    }),
  });
  assert.ok(cuenta.status === 201 || cuenta.status === 409, `no se pudo dar de alta la cuenta: ${cuenta.texto}`);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('B · el espejo: la consulta la tiene quien abre la pantalla, y nadie más', () => {
  test('B1 la consulta declara el permiso de la pantalla «/bitacora»', () => {
    const h = HERRAMIENTAS.find((x) => x.nombre === 'bitacora');
    assert.ok(h, 'la consulta de la bitácora no está declarada');
    assert.equal(h.pantalla, 'Bitácora');
    assert.equal(h.enlace, '/bitacora');
    assert.equal(h.permiso, 'bitacora');
  });

  test('B2 los cinco roles: quien abre la pantalla recibe la consulta, y al revés', async () => {
    /**
     * Esto es el hueco que el guardián del espejo dice no cubrir: él sabe que el
     * permiso de una consulta existe, no de qué pantalla salió. Aquí se cierra
     * midiendo las dos cosas por separado y comparándolas: se abre `/bitacora`
     * con cada rol y se mira si la pantalla contesta «Sin permiso», y se pregunta
     * al asistente y se mira si la consulta viaja en las definiciones.
     */
    let laAbreAlguien = false;
    let laTieneCerradaAlguien = false;
    for (const [rol, email] of Object.entries(ROLES)) {
      const sesion = await app.entrarYAsentar(email);
      const abre = await abreLaPantalla(sesion);

      doble.olvidar();
      doble.guionar([{ texto: 'hola' }]);
      const saludo = await sesion.pedir('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ pregunta: 'hola', previas: [] }),
      });
      assert.equal(saludo.status, 200, `${rol} no pudo preguntar: ${saludo.texto}`);
      const ofrecidas = (doble.peticiones()[0]?.cuerpo?.tools || []).map((t) => t.name);

      assert.equal(
        ofrecidas.includes('bitacora'),
        abre,
        abre
          ? `${rol} abre la pantalla de la Bitácora y el asistente no le ofrece la consulta: el espejo quedó MÁS cerrado`
          : `${rol} NO abre la pantalla de la Bitácora y el asistente le ofrece la consulta: el espejo quedó MÁS abierto`
      );
      if (abre) laAbreAlguien = true;
      else laTieneCerradaAlguien = true;
    }
    // Las dos mitades que hacen honesto el verde: si nadie la abriera, o la
    // abrieran todos, la comparación de arriba sería verdad trivial.
    assert.ok(laAbreAlguien, 'ningún rol abre la pantalla: la comparación no mide nada');
    assert.ok(laTieneCerradaAlguien, 'todos los roles la abren: la comparación no mide nada');
  });

  test('B3 el rechazo dice a quién pedirle el dato, derivado de la tabla de permisos', async () => {
    const sinBitacora = Object.keys(ROLES).filter((rol) => !PERMISOS[rol].includes('bitacora'));
    assert.ok(sinBitacora.length > 0, 'todos los roles tienen la bitácora: no hay nada que rechazar');
    for (const rol of sinBitacora) {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await correr(sesion, 'bitacora', {});
      assert.equal(r.datos, null, `${rol} obtuvo la bitácora y no entra a su pantalla`);
      assert.match(r.rechazo, /Bitácora/, `${rol}: el rechazo no dice en qué pantalla se ve el dato`);
      // Y a quién pedírselo: no «el administrador y finanzas», que es lo que
      // decía cuando la única consulta cerrada era la de Cobranza.
      for (const quien of ['Administrador', 'Jurídico', 'Finanzas']) {
        assert.match(r.rechazo, new RegExp(quien, 'i'), `${rol}: el rechazo no nombra a ${quien}`);
      }
    }
  });
});

describe('B · lo que viaja es lo que la pantalla pinta', () => {
  test('B4 la corrección sembrada sale en la consulta y en la pantalla, con el mismo texto', async () => {
    const { datos } = await correr(admin, 'bitacora', { servicio: sembrado.nombre, accion: 'correccion' });
    assert.ok(datos.renglones.length > 0, 'la corrección sembrada no sale en la consulta');
    const renglon = datos.renglones[0];
    assert.equal(renglon.accion, 'correccion');
    assert.equal(renglon.servicioId, sembrado.id, 'el renglón no lleva al servicio por su id');
    assert.ok(renglon.usuario, 'el renglón no dice quién lo hizo');
    assert.ok(renglon.rol, 'el renglón no dice con qué rol se hizo');

    const html = comoLaLeeUnaPersona((await admin.pedir('/bitacora')).texto);
    assert.ok(
      html.includes(sembrado.nombre),
      'la pantalla no pinta el servicio de la corrección: no se puede comparar contra ella'
    );
    // El detalle que viaja es el que la pantalla pinta. Se compara por el motivo,
    // que es la parte que escribió una persona y la que de verdad explica.
    assert.ok(
      renglon.detalle.includes(sembrado.motivoCorreccion),
      `el detalle que viaja no es el de la pantalla: «${renglon.detalle}»`
    );
    assert.ok(html.includes(sembrado.motivoCorreccion), 'la pantalla no pinta el motivo de la corrección');
  });

  test('B5 el total es el de la base y no el de los renglones que viajan', async () => {
    const todo = await correr(admin, 'bitacora', {});
    assert.ok(
      todo.datos.renglonesTotal > todo.datos.renglones.length,
      `la bitácora trae ${todo.datos.renglonesTotal} renglones y ninguno se recortó: la prueba no mide nada`
    );
    assert.match(
      todo.datos.renglonesQueCuenta,
      new RegExp(`${todo.datos.renglones.length} de ${todo.datos.renglonesTotal}`),
      `lo que dice que cuenta no dice cuántos trae: «${todo.datos.renglonesQueCuenta}»`
    );

    // Y el filtro de verdad filtra: por acción, el total baja y todo renglón que
    // viaja es de esa acción.
    const acciones = todo.datos.accionesQueHay;
    assert.ok(acciones.length > 1, 'la bitácora solo tiene una clase de registro: el filtro no se puede medir');
    const una = acciones.find((a) => a.renglones < todo.datos.renglonesTotal && a.renglones > 0);
    assert.ok(una, 'no hay una acción que filtre de verdad');
    const filtrado = await correr(admin, 'bitacora', { accion: una.accion });
    assert.equal(
      filtrado.datos.renglonesTotal,
      una.renglones,
      `el filtro por «${una.accion}» dice ${filtrado.datos.renglonesTotal} y el censo de la base ${una.renglones}`
    );
    assert.ok(filtrado.datos.renglones.every((r) => r.accion === una.accion), 'el filtro dejó pasar otra acción');
  });

  test('B6 el filtro por fechas se aplica, y un extremo que no es fecha se dice', async () => {
    const todo = await correr(admin, 'bitacora', {});
    const hoy = new Date().toISOString().slice(0, 10);
    const deHoy = await correr(admin, 'bitacora', { desde: hoy, hasta: hoy });
    assert.ok(deHoy.datos.renglonesTotal > 0, 'nada se registró hoy: el filtro de fechas no se puede medir');
    assert.ok(
      deHoy.datos.renglonesTotal < todo.datos.renglonesTotal,
      'el filtro por fechas no quitó nada: la bitácora sembrada arranca con la carga inicial'
    );
    assert.equal(deHoy.datos.desde, hoy);
    assert.equal(deHoy.datos.hasta, hoy);

    const raro = await correr(admin, 'bitacora', { desde: 'la semana pasada' });
    assert.equal(raro.datos.desde, null, 'un extremo que no es fecha viajó como si lo fuera');
    assert.match(raro.datos.avisoDelPeriodo || '', /no se entendió/);
    assert.ok(!raro.crudo.includes('la semana pasada'), 'el texto de fuera volvió dentro de la respuesta');
  });
});

describe('B · lo que NO viaja, y por qué', () => {
  test('B7 el correo de una cuenta de usuario se queda en la pantalla', async () => {
    /**
     * La pantalla sí lo pinta, a los mismos tres roles. Lo que se afirma no es
     * que el dato esté escondido: es que no SALE de la plataforma hacia un
     * servicio externo, porque ninguna pregunta de esta consulta lo necesita.
     */
    const html = comoLaLeeUnaPersona((await admin.pedir('/bitacora')).texto);
    assert.ok(
      html.includes(CORREO_SEMBRADO),
      'la pantalla no pinta el correo de la cuenta sembrada: la comparación no mide nada'
    );

    const r = await correr(admin, 'bitacora', { accion: 'crear_usuario' });
    assert.ok(r.datos.renglones.length > 0, 'el alta de la cuenta no salió en la consulta: no se mide nada');
    assert.ok(!r.crudo.includes(CORREO_SEMBRADO), 'el correo de la persona viajó hacia el servicio externo');
    // Y no se calla el hueco: se dice que ese detalle no viaja, para que el
    // asistente pueda mandar a la pantalla en vez de dar por hecho que no existe.
    for (const renglon of r.datos.renglones) {
      assert.equal(renglon.entidad, 'usuario');
      assert.match(renglon.detalle, /se lee en la pantalla/);
    }
    assert.match(r.datos.renglonesQueNoTraenDetalle, /correo/i);
    // Y el id de la cuenta tampoco: no lleva a ninguna consulta de las que hay.
    assert.ok(r.datos.renglones.every((x) => x.servicioId === null));
  });

  test('B8 el precio por guardia pasa por el filtro de su pantalla, también dentro de un cambio', async () => {
    /**
     * El filtro de `CAMPOS_POR_PERMISO` va por nombre de llave a cualquier
     * profundidad, y por eso el antes/después de un cambio viaja como OBJETO y no
     * como el texto JSON que guarda la columna: dentro de una cadena, el filtro no
     * ve nada y el precio habría cruzado la frontera dentro de un renglón de la
     * bitácora.
     *
     * Jurídico entra a la Bitácora y NO entra a «Precios»; finanzas entra a las
     * dos. Se mide la diferencia entre los dos, que es lo único que demuestra que
     * el filtro está haciendo algo.
     */
    const conPrecios = Object.keys(ROLES).filter(
      (rol) => PERMISOS[rol].includes('bitacora') && PERMISOS[rol].includes('precios')
    );
    const sinPrecios = Object.keys(ROLES).filter(
      (rol) => PERMISOS[rol].includes('bitacora') && !PERMISOS[rol].includes('precios')
    );
    assert.ok(conPrecios.length > 0 && sinPrecios.length > 0, 'no hay los dos lados: la medición no mide nada');

    for (const rol of conPrecios) {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await correr(sesion, 'bitacora', { servicio: sembrado.nombre, accion: 'editar' });
      assert.ok(r.datos, `${rol}: la consulta falló: ${r.rechazo}`);
      assert.ok(
        r.crudo.includes('"precio_guardia"') && r.crudo.includes(String(PRECIO_DISTINTIVO)),
        `${rol} entra a «Precios» y el cambio del precio no le llegó: el espejo quedó MÁS cerrado que la pantalla`
      );
    }
    for (const rol of sinPrecios) {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await correr(sesion, 'bitacora', { servicio: sembrado.nombre, accion: 'editar' });
      assert.ok(r.datos, `${rol}: la consulta falló: ${r.rechazo}`);
      /**
       * Se mide la llave y el valor, con el mismo criterio que el guardián de
       * `chat-espejo-campos`: la llave entre comillas y la cifra.
       *
       * Lo que SÍ viaja —y es correcto— es el nombre de la columna dentro del
       * texto del detalle: «SERVICIO — precio_guardia». Es literalmente lo que la
       * columna «Detalle» de la pantalla «Bitácora» le pinta a ese mismo rol, así
       * que cerrarlo dejaría el asistente más cerrado que la pantalla. Lo que no
       * puede cruzar es el dato: el antes y el después del precio.
       */
      assert.ok(
        !r.crudo.includes('"precio_guardia"'),
        `${rol} no entra a «Precios» y el cambio del precio viajó en un renglón de la bitácora`
      );
      assert.ok(
        !r.crudo.includes(String(PRECIO_DISTINTIVO)),
        `${rol} no entra a «Precios» y el valor del precio viajó igual, con otro nombre`
      );
      assert.match(r.crudo, /noSaleTodo/, `${rol}: se le quitó un campo sin decírselo`);
    }
  });

  test('B9 un «cambios» que no se puede leer no tumba la consulta', async () => {
    // La bitácora es un libro de años y un renglón viejo mal formado no puede
    // dejar sin respuesta a quien pregunta. El renglón se planta con la base, que
    // es la única forma de tener uno así.
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(`${app.carpetaDatos}/prueba.db`);
    db.pragma('busy_timeout = 5000');
    try {
      db.prepare(
        `INSERT INTO bitacora (usuario_id, usuario, rol, accion, entidad, entidad_id, detalle, cambios)
         VALUES (NULL, 'sistema', 'sistema', 'editar', 'servicio', ?, 'renglón con cambios ilegibles', '{esto no es json')`
      ).run(sembrado.id);
    } finally {
      db.close();
    }

    const r = await correr(admin, 'bitacora', { servicio: sembrado.nombre, accion: 'editar' });
    assert.ok(r.datos, `la consulta se cayó con un «cambios» ilegible: ${r.rechazo}`);
    const ilegible = r.datos.renglones.find((x) => x.detalle === 'renglón con cambios ilegibles');
    assert.ok(ilegible, 'el renglón ilegible no viajó');
    assert.equal(ilegible.cambios, null, 'un «cambios» ilegible viajó como si se hubiera leído');
  });
});

describe('B · solo lectura', () => {
  test('B10 correr la consulta dos veces no mueve ningún invariante', async () => {
    const antes = {
      servicios: (await admin.pedir('/api/servicios')).json.servicios.length,
      cancelaciones: (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length,
      bitacora: (await correr(admin, 'bitacora', {})).datos.renglonesTotal,
    };
    const hoy = new Date().toISOString().slice(0, 10);
    await correr(admin, 'bitacora', { cuadrarElEstadoDeFuerza: true });
    await correr(admin, 'bitacora', { servicio: sembrado.nombre, desde: hoy, hasta: hoy });
    const despues = {
      servicios: (await admin.pedir('/api/servicios')).json.servicios.length,
      cancelaciones: (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length,
      bitacora: (await correr(admin, 'bitacora', {})).datos.renglonesTotal,
    };
    assert.deepEqual(despues, antes, 'preguntar por la bitácora movió algo de la plataforma');
  });
});
