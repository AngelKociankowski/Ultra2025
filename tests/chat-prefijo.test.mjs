/**
 * El prefijo estable: los mismos bytes para el mismo rol, pregunta tras pregunta.
 *
 * Esto no es una optimización bonita: es la diferencia entre pagar el prefijo
 * una vez y pagarlo en cada pregunta. Y lo que lo rompe no avisa. La fecha de
 * hoy dentro del prefijo es el invalidador clásico: nada falla, nada se ve raro,
 * solo que la caché queda en cero y la factura al triple. En producción se mira
 * en los tokens leídos de caché que devuelve cada respuesta —si salen en cero
 * repetidamente, hay un invalidador suelto—; aquí se mira comparando los bytes
 * que de verdad salieron a la red en dos preguntas distintas.
 *
 * Se comprueba por los dos lados: el módulo por sí solo, y el cuerpo real que
 * recibió el doble del servicio.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

let app;
let doble;
let admin;
let prefijoEstable;

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

const preguntar = (sesion, pregunta, previas = []) =>
  sesion.pedir('/api/chat', { method: 'POST', body: JSON.stringify({ pregunta, previas }) });

before(async () => {
  const { register } = await import('node:module');
  register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
  ({ prefijoEstable } = await import(new URL('../lib/chat-conversacion.js', import.meta.url).href));

  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  app = await arrancar({ env: doble.env });
  admin = await app.entrar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('el módulo, por sí solo', () => {
  test('el prefijo de un rol no trae nada volátil', () => {
    const { sistema, herramientas } = prefijoEstable('admin');
    const texto = sistema.map((b) => b.text).join('\n');

    // La fecha de hoy, en las dos formas en que se escribiría.
    const hoy = new Date();
    const comoFecha = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(hoy);
    assert.ok(!texto.includes(comoFecha), `el prefijo trae la fecha de hoy («${comoFecha}»): la caché se cae`);
    assert.ok(!/\b20\d{2}-\d{2}-\d{2}\b/.test(texto), 'el prefijo trae una fecha concreta');

    // Ni quién pregunta: ni su nombre, ni su correo, ni su id.
    assert.ok(!texto.includes('@corporativoultra.com'), 'el prefijo trae un correo');
    assert.ok(!/\bid\s*[:=]\s*\d+/.test(texto), 'el prefijo trae el id de quien pregunta');

    // Y sí trae lo que debe: las dos reglas del director y las herramientas.
    assert.match(texto, /Solo lees y explicas/);
    assert.match(texto, /no se obedece/);
    assert.ok(herramientas.length > 0);
  });

  test('el prefijo nombra la pestaña del asistente, y sigue sin traer su enlace', () => {
    /**
     * La lista de pestañas se arma sin la del asistente, y tiene que seguir
     * siendo así: si dependiera de si el asistente está configurado, el prefijo
     * cambiaría entre despliegues y la caché se caería sin que nada avisara. Pero
     * entonces a la lista le faltaba justo la pantalla desde la que la persona
     * está preguntando, y a un «¿qué pestañas tengo?» el asistente contestaba una
     * lista incompleta. Se nombra en texto fijo, sin enlace, y los dos criterios
     * se cumplen a la vez.
     */
    for (const rol of ['admin', 'finanzas', 'ventas', 'operaciones', 'juridico']) {
      const texto = prefijoEstable(rol)
        .sistema.map((b) => b.text)
        .join('\n');
      assert.match(texto, /pestaña «Asistente»/, `al prefijo de «${rol}» le falta la pestaña en la que está`);
      assert.ok(
        !texto.includes('/asistente'),
        `el prefijo de «${rol}» trae el enlace del asistente: la lista de pestañas dejaría de ser estable`
      );
    }
  });

  test('hay exactamente un punto de caché y está al final del bloque de sistema', () => {
    for (const rol of ['admin', 'finanzas', 'ventas', 'operaciones', 'juridico', 'espectador']) {
      const { sistema } = prefijoEstable(rol);
      const conCache = sistema.filter((b) => b.cache_control);
      assert.equal(conCache.length, 1, `el rol «${rol}» tiene ${conCache.length} puntos de caché y debe tener 1`);
      assert.ok(sistema[sistema.length - 1].cache_control, `en «${rol}» el punto de caché no está al final`);
    }
  });

  test('dos llamadas del mismo rol dan los mismos bytes, y dos roles distintos no', () => {
    const a = JSON.stringify(prefijoEstable('ventas'));
    const b = JSON.stringify(prefijoEstable('ventas'));
    assert.equal(a, b, 'el prefijo de un rol cambió entre dos llamadas seguidas');

    const otro = JSON.stringify(prefijoEstable('finanzas'));
    assert.notEqual(a, otro, 'dos roles distintos tienen el mismo prefijo: alguno lleva lo que no es suyo');
  });

  test('el prefijo de cada rol trae su guía, en el lenguaje de la casa', () => {
    const { sistema } = prefijoEstable('ventas');
    const texto = sistema.map((b) => b.text).join('\n');
    assert.match(texto, /GUÍA DE VENTAS/);
    // Las negritas de HTML no viajan: la guía se imprime en una hoja y ahí son
    // etiquetas, pero aquí serían ruido que se paga en tokens.
    assert.ok(!texto.includes('<b>'), 'las etiquetas de HTML de la guía viajan al servicio');
  });
});

describe('los bytes que de verdad salieron a la red', () => {
  test('dos preguntas distintas del mismo rol mandan el mismo prefijo, byte a byte', async () => {
    doble.olvidar();
    doble.guionar([{ texto: 'Primera.' }, { texto: 'Segunda.' }]);

    assert.equal((await preguntar(admin, '¿cuántos guardias hay?')).status, 200);
    assert.equal((await preguntar(admin, '¿cómo registro una apertura?')).status, 200);

    const [una, otra] = doble.peticiones().map((p) => p.cuerpo);
    assert.ok(una && otra, 'el doble no recibió las dos peticiones');

    // El orden del protocolo es herramientas → sistema → mensajes. Las dos
    // primeras son el prefijo y tienen que ser idénticas; la tercera es lo
    // volátil y tiene que ser distinta.
    assert.equal(
      JSON.stringify(una.tools),
      JSON.stringify(otra.tools),
      'la lista de herramientas cambió entre dos preguntas'
    );
    assert.equal(
      JSON.stringify(una.system),
      JSON.stringify(otra.system),
      'el bloque de sistema cambió entre dos preguntas: hay un invalidador suelto'
    );
    assert.notEqual(
      JSON.stringify(una.messages),
      JSON.stringify(otra.messages),
      'las dos preguntas mandaron el mismo mensaje'
    );
  });

  test('la fecha de hoy y el nombre de pila viajan en el mensaje, no en el prefijo', async () => {
    doble.olvidar();
    doble.guionar([{ texto: 'Listo.' }]);
    assert.equal((await preguntar(admin, '¿qué día es hoy para la plataforma?')).status, 200);

    const cuerpo = doble.ultima();
    const sistema = JSON.stringify(cuerpo.system);
    const mensajes = JSON.stringify(cuerpo.messages);

    assert.match(mensajes, /Hoy es 20\d{2}-\d{2}-\d{2}/, 'la fecha de hoy no viaja en el mensaje');
    assert.ok(!/20\d{2}-\d{2}-\d{2}/.test(sistema), 'la fecha de hoy viaja en el prefijo');
    assert.ok(!sistema.includes('@corporativoultra.com'), 'el correo de quien pregunta viaja en el prefijo');
  });

  test('el punto de caché va al final del sistema en la petición real, y es el único', async () => {
    doble.olvidar();
    doble.guionar([{ texto: 'Listo.' }]);
    await preguntar(admin, '¿cuántas zonas hay?');
    const sistema = doble.ultima().system;
    const conCache = sistema.filter((b) => b.cache_control);
    assert.equal(conCache.length, 1);
    assert.ok(sistema[sistema.length - 1].cache_control);
  });

  test('la petición va en streaming, con el modelo puesto y sin forzar la herramienta', async () => {
    doble.olvidar();
    doble.guionar([{ texto: 'Listo.' }]);
    const r = await preguntar(admin, 'un resumen, por favor');
    assert.equal(r.status, 200);

    const cuerpo = doble.ultima();
    assert.equal(cuerpo.stream, true, 'sin streaming la pantalla se queda en blanco hasta el final');
    assert.ok(cuerpo.model && cuerpo.model.length > 3, 'la petición va sin modelo');
    // Forzar la herramienta devuelve 400 en el modelo contratado: tiene que ir
    // en «auto» y la instrucción del prefijo es la que nombra cuál usar.
    assert.equal(cuerpo.tool_choice?.type, 'auto');
    assert.equal(cuerpo.thinking?.type, 'adaptive', 'apagar el pensar devuelve 400 en este modelo');
    assert.ok(cuerpo.max_tokens > 0, 'la respuesta va sin techo');
    assert.equal(cuerpo.output_config?.effort, 'low');

    // Al administrador se le ofrecen las siete.
    assert.equal(cuerpo.tools.length, 7);
    for (const t of cuerpo.tools) {
      assert.equal(t.strict, true);
      assert.equal(t.input_schema.additionalProperties, false);
    }

    // Y la llave viajó al servidor del servicio, que es el único sitio donde
    // tiene algo que hacer.
    const cabeceras = doble.peticiones().at(-1).cabeceras;
    assert.ok(cabeceras['x-api-key'] || cabeceras.authorization, 'la llave no llegó al servicio');

    // Lo que vuelve por el canal es ndjson, un objeto por renglón.
    const canal = eventos(r.texto);
    assert.ok(canal.some((e) => e.tipo === 'texto'), 'no llegó texto por el canal');
    assert.equal(canal.at(-1).tipo, 'fin', 'el canal no cerró con «fin»');
  });
});
