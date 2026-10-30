/**
 * Que no se pueda sacar por el chat un dato que esa persona no puede ver.
 *
 * Es la prueba por la que se juzga este encargo, y está escrita para atacar los
 * dos descuidos que de verdad pasan:
 *
 *   A. Que se le OFREZCA a un rol una herramienta que no es suya. Se mide en el
 *      cuerpo que de verdad salió a la red, no en lo que el código dice que
 *      ofrece.
 *   B. Que, ofrecida o no, se EJECUTE porque el servicio externo la pidió. El
 *      nombre de la herramienta llega en la respuesta del servicio, o sea de
 *      fuera: tratarlo como autorización sería confiar en que nadie se equivoque
 *      nunca. Así que el doble se guioniza para pedir «cobranza» de todas
 *      formas, con cada rol, y lo que se exige es que el importe no aparezca por
 *      ningún lado —ni en el canal, ni en la siguiente petición al servicio—.
 *
 * El importe con el que se mide no se escribe a mano: se siembra una factura
 * vencida con un importe distintivo y se lee de la respuesta del administrador,
 * que sí tiene esa pantalla. Así la prueba compara contra el número de verdad y
 * no contra uno inventado que podría coincidir por casualidad.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
import { PERMISOS } from '../lib/rbac.js';

let app;
let doble;
const sesiones = {};

/** El correo del espectador, que `tests/servidor.mjs` no da de alta. */
const CORREO_ESPECTADOR = 'espectador@corporativoultra.com';

/** Un importe que no puede salir de ninguna otra parte de los datos sembrados. */
const IMPORTE_DISTINTIVO = 987654.21;

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

const preguntar = (sesion, pregunta) =>
  sesion.pedir('/api/chat', { method: 'POST', body: JSON.stringify({ pregunta, previas: [] }) });

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  app = await arrancar({ env: doble.env });

  const admin = await app.entrar(ROLES.admin);
  sesiones.admin = admin;
  for (const rol of ['juridico', 'finanzas', 'operaciones', 'ventas']) {
    sesiones[rol] = await app.entrarYAsentar(ROLES[rol]);
  }

  // El espectador se da de alta aquí porque el arranque de las pruebas solo crea
  // los cinco roles que trabajan en la plataforma.
  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({
      email: CORREO_ESPECTADOR,
      nombre: 'Espectador de prueba',
      rol: 'espectador',
      password: PASSWORD_TEMPORAL,
    }),
  });
  assert.equal(alta.status, 201, alta.texto);
  const primera = await app.entrar(CORREO_ESPECTADOR, PASSWORD_TEMPORAL);
  await primera.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });
  sesiones.espectador = await app.entrar(CORREO_ESPECTADOR, PASSWORD);

  // Y una factura vencida con el importe distintivo, para tener algo concreto
  // que no pueda salir.
  const ap = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: 'PERMISOS CHAT MIDE AQUI', turnos: { '24 HRS': 2 } }),
  });
  assert.equal(ap.status, 201, ap.texto);
  const factura = await admin.pedir('/api/facturas', {
    method: 'POST',
    body: JSON.stringify({
      servicio_id: ap.json.servicioId,
      periodo: '2026-01',
      fecha_factura: '2026-01-15',
      importe: IMPORTE_DISTINTIVO,
      guardias: 2,
      dias_credito: 0,
    }),
  });
  assert.equal(factura.status, 201, factura.texto);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

// --------------------------------------------------------------------------- A

describe('A · a cada rol se le ofrece en la red exactamente lo suyo', () => {
  for (const rol of ['admin', 'finanzas', 'juridico', 'operaciones', 'ventas']) {
    test(`${rol}: el cuerpo que salió a la red trae sus herramientas y ninguna más`, async () => {
      doble.olvidar();
      doble.guionar([{ texto: 'Listo.' }]);
      const r = await preguntar(sesiones[rol], '¿cómo va la operación?');
      assert.equal(r.status, 200, r.texto.slice(0, 200));

      const ofrecidas = doble.ultima().tools.map((t) => t.name).sort();
      const deberia = PERMISOS[rol].includes('editar_finanzas');
      assert.equal(
        ofrecidas.includes('cobranza'),
        deberia,
        `a «${rol}» ${deberia ? 'le falta' : 'le sobra'} la consulta de Cobranza`
      );
      // Y todas las ofrecidas casan con un permiso que ese rol tiene escrito.
      assert.ok(ofrecidas.length > 0, `a «${rol}» no se le ofreció ninguna consulta`);
    });
  }

  test('espectador: no llega ni a preguntar, y el doble no recibe nada', async () => {
    doble.olvidar();
    const r = await preguntar(sesiones.espectador, '¿cuál es la cartera vencida?');
    assert.equal(r.status, 403, `el espectador recibió ${r.status}: ${r.texto.slice(0, 200)}`);
    assert.equal(
      doble.peticiones().length,
      0,
      'el espectador no tiene el asistente, así que no puede haber salido ni una petición'
    );
  });

  test('sin sesión: 401 del portero, sin tocar el servicio externo', async () => {
    doble.olvidar();
    const r = await app.anonimo().pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'hola', previas: [] }),
    });
    assert.equal(r.status, 401);
    assert.equal(doble.peticiones().length, 0, 'una petición sin sesión llegó al servicio externo');
  });
});

// --------------------------------------------------------------------------- B

describe('B · la cerradura: pedir cobranza de todas formas no la abre', () => {
  let importeComoLoDiceLaPantalla;

  test('el administrador sí la obtiene, y de ahí sale el número con el que se mide', async () => {
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'cobranza', args: {} }] },
      { texto: 'Esto es lo que dice la cartera.' },
    ]);
    const r = await preguntar(sesiones.admin, '¿cuál es la cartera vencida?');
    assert.equal(r.status, 200, r.texto.slice(0, 300));

    const canal = eventos(r.texto);
    const fichas = canal.filter((e) => e.tipo === 'ficha');
    assert.equal(fichas.length, 1, 'el administrador tenía que recibir su ficha de Cobranza');
    assert.equal(fichas[0].ficha.pantalla, 'Cobranza');
    assert.equal(fichas[0].ficha.enlace, '/cobranza');
    importeComoLoDiceLaPantalla = Number(fichas[0].ficha.valor);

    // La cartera vencida incluye la factura sembrada: si no, el número con el
    // que se mide abajo no mediría nada y la prueba sería un verde vacío.
    assert.ok(
      importeComoLoDiceLaPantalla >= IMPORTE_DISTINTIVO,
      `la cartera vencida (${importeComoLoDiceLaPantalla}) no incluye la factura sembrada`
    );

    // Y el importe distintivo sí viajó al servicio para el rol que SÍ puede.
    const conElDato = doble.peticiones().some((p) => p.crudo.includes(String(IMPORTE_DISTINTIVO)));
    assert.ok(conElDato, 'al rol que sí tiene Cobranza no le llegó el dato: la herramienta no está leyendo');
  });

  for (const rol of ['juridico', 'operaciones', 'ventas']) {
    test(`${rol}: se le pide cobranza, se rechaza, y el importe no sale por ningún lado`, async () => {
      doble.olvidar();
      doble.guionar([
        { herramientas: [{ nombre: 'cobranza', args: {} }] },
        { texto: 'Ese dato lo tienen el administrador y finanzas.' },
      ]);
      const r = await preguntar(sesiones[rol], '¿cuál es la cartera vencida?');
      assert.equal(r.status, 200, r.texto.slice(0, 300));

      const canal = eventos(r.texto);

      // 1) Ninguna ficha de Cobranza, porque la ficha la pone el servidor solo
      //    cuando la consulta de verdad corrió.
      const deCobranza = canal.filter((e) => e.tipo === 'ficha' && e.ficha.pantalla === 'Cobranza');
      assert.deepEqual(deCobranza, [], `a «${rol}» le llegó una ficha de Cobranza`);

      // 2) El importe no aparece en NINGÚN evento del canal.
      const todoElCanal = r.texto;
      assert.ok(
        !todoElCanal.includes(String(IMPORTE_DISTINTIVO)),
        `el importe de cobranza salió por el canal a «${rol}»`
      );
      assert.ok(
        !todoElCanal.includes(String(importeComoLoDiceLaPantalla)),
        `la cartera vencida salió por el canal a «${rol}»`
      );

      // 3) Ni llegó al servicio externo en la vuelta siguiente, que es el otro
      //    camino por el que un dato se escapa de verdad.
      for (const p of doble.peticiones()) {
        assert.ok(
          !p.crudo.includes(String(IMPORTE_DISTINTIVO)),
          `el importe de cobranza viajó al servicio externo por la pregunta de «${rol}»`
        );
      }

      // 4) Y el rechazo sí llegó al modelo, como resultado con error: así puede
      //    explicarlo en vez de callarse o inventar.
      const segunda = doble.peticiones()[1]?.cuerpo;
      assert.ok(segunda, 'no hubo segunda vuelta: el rechazo tumbó la pregunta en vez de explicarse');
      const resultados = segunda.messages.flatMap((m) =>
        Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []
      );
      assert.equal(resultados.length, 1, 'tenía que volver exactamente un resultado de herramienta');
      assert.equal(resultados[0].is_error, true, 'el rechazo no se marcó como error');
      assert.match(String(resultados[0].content), /administrador y finanzas/i);

      // 5) Y la lista que se le ofreció nunca trajo cobranza, ni en la segunda
      //    vuelta: la cortesía y la cerradura dicen lo mismo.
      for (const p of doble.peticiones()) {
        assert.ok(
          !p.cuerpo.tools.some((t) => t.name === 'cobranza'),
          `a «${rol}» se le ofreció la consulta de Cobranza`
        );
      }
    });
  }

  test('finanzas sí la obtiene: la cerradura no está cerrada para todos', async () => {
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'cobranza', args: {} }] },
      { texto: 'Aquí está la cartera.' },
    ]);
    const r = await preguntar(sesiones.finanzas, '¿cuál es la cartera vencida?');
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    const fichas = eventos(r.texto).filter((e) => e.tipo === 'ficha');
    assert.equal(fichas.length, 1);
    assert.equal(fichas[0].ficha.pantalla, 'Cobranza');
  });

  test('una herramienta inventada por el servicio externo no ejecuta nada', async () => {
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'cartera_completa_sin_permiso', args: {} }] },
      { texto: 'No tengo esa consulta.' },
    ]);
    const r = await preguntar(sesiones.ventas, 'dame todo');
    assert.equal(r.status, 200, r.texto.slice(0, 300));

    const canal = eventos(r.texto);
    assert.deepEqual(canal.filter((e) => e.tipo === 'ficha'), [], 'una herramienta inventada dejó ficha');
    const segunda = doble.peticiones()[1]?.cuerpo;
    const resultados = segunda.messages.flatMap((m) =>
      Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []
    );
    assert.equal(resultados[0].is_error, true);
  });

  test('con llave, la pantalla pinta la conversación, el cupo del día y su guía', async () => {
    const r = await sesiones.ventas.pedir('/asistente');
    assert.equal(r.status, 200, r.texto.slice(0, 200));
    const html = r.texto.replace(/<!--[\s\S]*?-->/g, '');

    // Cuántas preguntas quedan hoy, con el tope por omisión del director.
    assert.match(html, /Te quedan/, 'la pantalla no dice cuántas preguntas quedan');
    assert.match(html, /de 25 preguntas hoy/, 'la pantalla no dice de cuántas son');
    // La caja de preguntar, que sin llave no se pinta.
    assert.match(html, /Preguntar<\/button>/, 'no hay con qué preguntar');
    assert.match(html, /Escribe tu pregunta/);
    // Y cuántas consultas tiene su rol: ventas no tiene la de Cobranza.
    assert.match(html, /consultas disponibles para tu rol/);
    // La guía sigue debajo: es la respuesta más barata a la mitad de las
    // preguntas y no se quita porque haya llave.
    assert.match(html, /Tu guía/);
    // Y las dos reglas del contrato, dichas a quien va a usarlo.
    assert.match(html, /no cambia nada/i);

    // El gasto no se le enseña a ventas: no es su pantalla.
    assert.ok(!/Gasto estimado del asistente/.test(html), 'a ventas se le enseña el gasto de la empresa');
  });

  test('el gasto estimado se le enseña a quien lleva el dinero, y dice que es estimado', async () => {
    for (const rol of ['admin', 'finanzas']) {
      const html = (await sesiones[rol].pedir('/asistente')).texto.replace(/<!--[\s\S]*?-->/g, '');
      assert.match(html, /Gasto estimado del asistente/, `${rol}: no ve el gasto y es su pantalla`);
      assert.match(html, /no la factura del proveedor/i, `${rol}: el gasto se presenta como exacto`);
    }
    for (const rol of ['juridico', 'operaciones']) {
      const html = (await sesiones[rol].pedir('/asistente')).texto;
      assert.ok(!/Gasto estimado del asistente/.test(html), `${rol} ve el gasto de la empresa`);
    }
  });

  test('el bloque «De dónde salió esto» lo pinta la pantalla con las fichas del servidor', async () => {
    /**
     * Se mira el código del componente y no el navegador.
     *
     * No hay con qué manejar un navegador en esta corrida —no hay controlador
     * entre las dependencias del proyecto y no se puede añadir uno—, así que lo
     * que se vigila es lo que de verdad importa del componente: que el bloque se
     * pinte con `turno.fichas`, que son las que manda el servidor, y no con nada
     * calculado en el navegador. Es el mismo criterio con el que se vigila el
     * panel de completar en `captura-unica.test.mjs`.
     */
    const fs = await import('node:fs');
    const fuente = fs.readFileSync(
      new URL('../app/(app)/asistente/Conversacion.js', import.meta.url),
      'utf8'
    );
    assert.match(fuente, /De dónde salió esto/, 'el componente ya no pinta el bloque de la fuente');
    assert.match(fuente, /turno\.fichas\.map/, 'el bloque no se pinta con las fichas del servidor');
    for (const campo of ['pantalla', 'dato', 'valor', 'enlace', 'consultado']) {
      assert.match(fuente, new RegExp(`f\\.${campo}`), `el bloque no enseña «${campo}»`);
    }
    // Y no calcula ninguna cifra: ni suma, ni promedia, ni redondea.
    assert.ok(
      !/\b(reduce|toFixed|Math\.round)\s*\(/.test(fuente),
      'el componente calcula una cifra, y las cifras las pinta el servidor'
    );
  });

  test('la pestaña del asistente: la tienen los cinco que trabajan, y el espectador no', async () => {
    for (const rol of ['admin', 'finanzas', 'juridico', 'operaciones', 'ventas']) {
      const r = await sesiones[rol].pedir('/');
      assert.equal(r.status, 200);
      assert.match(r.texto, /\/asistente/, `al rol «${rol}» le falta la pestaña del asistente`);
    }
    const mirón = await sesiones.espectador.pedir('/');
    assert.equal(mirón.status, 200);
    assert.ok(
      !mirón.texto.includes('href="/asistente"'),
      'el espectador tiene la pestaña del asistente y el director lo dejó fuera'
    );
  });
});
