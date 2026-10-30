/**
 * Que no invente una cifra: el texto es prosa, la ficha es el dato.
 *
 * Es el defecto que esta plataforma lleva un mes cerrando, y un chat es el
 * formato que mejor lo disfraza: una cifra inventada llega en una frase bien
 * escrita, sin tabla y sin fuente. La defensa que no depende de que el modelo se
 * porte bien es que el bloque «De dónde salió esto» lo pinta el SERVIDOR con las
 * fichas, no con el texto.
 *
 * Así que esta prueba hace justo lo que no se puede hacer con el servicio de
 * verdad: guioniza el doble para que conteste un número INVENTADO, y exige que
 * la ficha siga diciendo el número que devolvió la consulta. Si el texto y la
 * ficha no coinciden, se ve — y eso es el objetivo, no un defecto.
 *
 * Ninguna cifra de los datos sembrados se escribe a mano en este archivo. Se
 * derivan todas de la API que ya existe, que es la lección de las 15 aperturas.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

let app;
let doble;
let admin;
/** Los guardias activos según la pantalla, para comparar contra la ficha. */
let guardiasDeVerdad;
let serviciosDeVerdad;
/** Un servicio cualquiera de los sembrados, para la consulta de la ficha. */
let idDeUnServicio;

/** Un número que el modelo se inventa, imposible de confundir con un dato. */
const INVENTADO = 999_999;

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
  admin = await app.entrar(ROLES.admin);

  // El número bueno sale de la misma consulta que alimenta el Tablero, pedida
  // por la API que ya existía antes de este encargo.
  const dia = await admin.pedir('/api/estado-fuerza/dia?dia=' + new Date().toISOString().slice(0, 10));
  assert.equal(dia.status, 200, dia.texto.slice(0, 200));
  const tablero = await admin.pedir('/');
  assert.equal(tablero.status, 200);
  // Se lee del propio Tablero para que la comparación sea contra lo que la
  // persona tiene delante, que es lo que el asistente promete copiar.
  const m = tablero.texto.replace(/<!--[\s\S]*?-->/g, '').match(/Servicios activos[\s\S]{0,400}?>([\d,]+)</);
  assert.ok(m, 'no se encontró el conteo de servicios activos en el Tablero');
  serviciosDeVerdad = Number(m[1].replace(/,/g, ''));
  assert.ok(serviciosDeVerdad > 0, 'el Tablero dice cero servicios activos: los datos no se sembraron');

  const lista = await admin.pedir('/api/servicios?estatus=ACTIVO');
  assert.equal(lista.status, 200, lista.texto.slice(0, 200));
  idDeUnServicio = (lista.json.servicios || lista.json)[0].id;
  assert.ok(idDeUnServicio, 'no hay ningún servicio sembrado con el que probar la ficha');
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('la ficha la pone el servidor, no el modelo', () => {
  test('el modelo inventa una cifra y la ficha sigue diciendo la de la consulta', async () => {
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'resumen_operacion', args: {} }] },
      { texto: `Ahora mismo hay ${INVENTADO} guardias repartidos en la operación.` },
    ]);

    const r = await preguntar(admin, '¿cuántos guardias tenemos?');
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    const canal = eventos(r.texto);

    // (a) Se avisó de qué pantalla se estaba leyendo.
    const consultando = canal.filter((e) => e.tipo === 'consultando');
    assert.equal(consultando.length, 1);
    assert.equal(consultando[0].pantalla, 'Tablero');

    // (b) La ficha: pantalla, dato, valor, hora y enlace, puestos por el servidor.
    const fichas = canal.filter((e) => e.tipo === 'ficha');
    assert.equal(fichas.length, 1, 'tenía que llegar exactamente una ficha');
    const f = fichas[0].ficha;
    assert.equal(f.pantalla, 'Tablero');
    assert.equal(f.enlace, '/');
    assert.match(f.consultado, /^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/, `la hora de consulta es «${f.consultado}»`);
    assert.ok(f.dato && f.valor, 'la ficha va sin dato o sin valor');

    // El valor de la ficha es el de la consulta de verdad —se deriva del
    // Tablero, no se escribe aquí— y NO el que inventó el modelo.
    guardiasDeVerdad = Number(String(f.valor).split('·')[1]);
    assert.equal(
      Number(String(f.valor).split('·')[0]),
      serviciosDeVerdad,
      `la ficha dice ${f.valor} servicios y el Tablero dice ${serviciosDeVerdad}`
    );
    assert.ok(!String(f.valor).includes(String(INVENTADO)), 'la ficha repitió la cifra inventada');

    // (c) El texto inventado llegó como texto, y los dos se ven. Que no
    //     coincidan es exactamente lo que hace visible una cifra inventada.
    const texto = canal.filter((e) => e.tipo === 'texto').map((e) => e.texto).join('');
    assert.match(texto, new RegExp(String(INVENTADO)));
    assert.notEqual(
      String(INVENTADO),
      String(guardiasDeVerdad),
      'la cifra inventada y la de verdad coincidieron: la prueba no mediría nada'
    );

    // (d) Y el canal cierra diciendo cuántas preguntas quedan.
    const fin = canal.at(-1);
    assert.equal(fin.tipo, 'fin');
    assert.ok(Number.isInteger(fin.restantes), 'el «fin» no dice cuántas preguntas quedan');
  });

  test('el ciclo completo: herramienta, resultado y texto, en dos vueltas', async () => {
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'buscar_servicio', args: { texto: 'PROQUIGAMA' } }] },
      { texto: 'Te dejo lo que encontré.' },
    ]);
    const r = await preguntar(admin, 'busca PROQUIGAMA');
    assert.equal(r.status, 200, r.texto.slice(0, 300));

    assert.equal(doble.peticiones().length, 2, 'el ciclo tenía que dar dos vueltas');

    // La segunda petición lleva la respuesta anterior y el resultado, en un solo
    // mensaje de usuario: partirlos le enseña al modelo a dejar de pedir varias
    // cosas a la vez.
    const segunda = doble.peticiones()[1].cuerpo;
    const delAsistente = segunda.messages.filter((m) => m.role === 'assistant');
    assert.equal(delAsistente.length, 1);
    const resultados = segunda.messages
      .filter((m) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
    assert.equal(resultados.length, 1);

    // El resultado va etiquetado con su fuente y su hora, como JSON: así un
    // campo de texto no puede parecer un turno de conversación.
    const payload = JSON.parse(resultados[0].content);
    assert.equal(payload.fuente, 'Estado de fuerza');
    assert.match(payload.consultado, /^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.ok('datos' in payload);
  });

  test('varias herramientas en una sola respuesta: todas se ejecutan y todas vuelven juntas', async () => {
    doble.olvidar();
    doble.guionar([
      {
        herramientas: [
          { nombre: 'resumen_operacion', args: {} },
          { nombre: 'contratos', args: {} },
        ],
      },
      { texto: 'Lo junté todo.' },
    ]);
    const r = await preguntar(admin, 'resumen y contratos');
    assert.equal(r.status, 200, r.texto.slice(0, 300));

    const fichas = eventos(r.texto).filter((e) => e.tipo === 'ficha');
    assert.deepEqual(
      fichas.map((e) => e.ficha.pantalla),
      ['Tablero', 'Jurídico'],
      'no llegó una ficha por cada consulta'
    );

    const segunda = doble.peticiones()[1].cuerpo;
    const resultados = segunda.messages
      .filter((m) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
    assert.equal(resultados.length, 2, 'los dos resultados tenían que volver en un solo mensaje');
  });

  test('el ciclo se corta a la tercera vuelta y lo dice, en vez de encadenar consultas', async () => {
    doble.olvidar();
    // Un doble que pide herramienta SIEMPRE: es el caso que sin techo cuesta
    // veinte dólares en una pregunta mal entendida.
    doble.guionar([{ herramientas: [{ nombre: 'resumen_operacion', args: {} }] }]);

    const r = await preguntar(admin, 'pregúntame en círculos');
    assert.equal(r.status, 200, r.texto.slice(0, 300));

    assert.equal(doble.peticiones().length, 3, `el ciclo dio ${doble.peticiones().length} vueltas y el techo es 3`);

    const texto = eventos(r.texto)
      .filter((e) => e.tipo === 'texto')
      .map((e) => e.texto)
      .join('');
    assert.match(texto, /sin vueltas de consulta/i, 'se cortó el ciclo sin decírselo a quien preguntó');
    assert.equal(eventos(r.texto).at(-1).tipo, 'fin');
  });

  test('las siete consultas corren de verdad y cada una deja su ficha', async () => {
    /**
     * Una por una, contra los datos sembrados.
     *
     * Hace falta porque una herramienta que lee mal el resultado de su consulta
     * no falla al compilar ni al declararse: falla la primera vez que alguien la
     * usa, y entonces el asistente contesta «esa consulta no se pudo hacer» sin
     * que nadie sepa por qué. Pasó con una de estas siete al escribirlas.
     */
    const argumentos = {
      resumen_operacion: {},
      buscar_servicio: { texto: 'A' },
      ficha_de_servicio: { id: idDeUnServicio },
      movimientos: {},
      estado_de_un_dia: { dia: new Date().toISOString().slice(0, 10) },
      contratos: {},
      cobranza: {},
    };

    for (const [nombre, args] of Object.entries(argumentos)) {
      doble.olvidar();
      doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
      const r = await preguntar(admin, `corre ${nombre}`);
      assert.equal(r.status, 200, `${nombre} → ${r.status}: ${r.texto.slice(0, 200)}`);

      const canal = eventos(r.texto);
      const fichas = canal.filter((e) => e.tipo === 'ficha');
      assert.equal(fichas.length, 1, `«${nombre}» no dejó ficha: ${r.texto.slice(0, 400)}`);

      // Y el resultado que viajó al servicio trae datos de verdad, no un error.
      const resultados = doble.peticiones()[1].cuerpo.messages
        .filter((m) => m.role === 'user' && Array.isArray(m.content))
        .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
      assert.equal(resultados.length, 1, nombre);
      assert.notEqual(resultados[0].is_error, true, `«${nombre}» devolvió un error: ${resultados[0].content}`);
      const payload = JSON.parse(resultados[0].content);
      assert.ok(payload.datos && Object.keys(payload.datos).length > 0, `«${nombre}» devolvió datos vacíos`);
    }
  });

  test('una cifra sin consulta también deja ficha, y la ficha dice que no hubo consulta', async () => {
    /**
     * El hueco que quedaba: el bloque «De dónde salió esto» solo existía si se
     * había ejecutado una consulta. Si el servicio externo contesta una cifra SIN
     * pedir ninguna, el canal llevaba el texto y cero fichas, y la pantalla
     * pintaba el párrafo a secas — una cifra inventada, bien escrita, con nada
     * debajo que la desmienta. La defensa que no depende de que el modelo se
     * porte bien no se activaba justo cuando más falta hacía.
     */
    doble.olvidar();
    doble.guionar([{ texto: `Ahora mismo hay ${INVENTADO} guardias activos.` }]);
    const r = await preguntar(admin, '¿cuántos guardias hay?');
    assert.equal(r.status, 200, r.texto.slice(0, 300));

    const canal = eventos(r.texto);
    assert.equal(doble.peticiones().length, 1, 'no tenía que haber consultado nada');
    assert.deepEqual(canal.filter((e) => e.tipo === 'consultando'), [], 'no se consultó ninguna pantalla');

    const fichas = canal.filter((e) => e.tipo === 'ficha');
    assert.equal(fichas.length, 1, 'una respuesta con cifras llegó sin su bloque «De dónde salió esto»');
    const f = fichas[0].ficha;
    assert.ok(!String(f.valor).includes(String(INVENTADO)), 'la ficha repitió la cifra inventada');
    // Sin enlace: no hay pantalla de dónde venga, y un enlace diría lo contrario
    // de lo que la ficha dice.
    assert.equal(f.enlace, null, `la ficha de «sin consulta» trae enlace: ${f.enlace}`);
    assert.match(f.dato, /[áéíóúñ]|pantalla/i, `el aviso no está en español: ${f.dato}`);
    assert.equal(canal.at(-1).tipo, 'fin', 'la ficha se colocó después del cierre del canal');
  });

  test('una respuesta sin cifras y sin consulta no estrena recuadro: el aviso no se gasta', async () => {
    // El recuadro es la prueba de que un número es real. Ponerlo debajo de una
    // respuesta que no trae ningún número lo convierte en adorno, y un adorno que
    // sale siempre se deja de leer: es como se pierde la única defensa que hay.
    doble.olvidar();
    doble.guionar([{ texto: 'Eso lo tienen el administrador y finanzas.' }]);
    const r = await preguntar(admin, '¿quién lleva la cobranza?');
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    assert.deepEqual(
      eventos(r.texto).filter((e) => e.tipo === 'ficha'),
      [],
      'una respuesta sin una sola cifra llegó con recuadro de procedencia'
    );
  });

  test('cada ficha trae enlace a una pantalla de la plataforma, armado por el servidor', async () => {
    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'buscar_servicio', args: { texto: 'A' } }] },
      { texto: 'Ahí está.' },
    ]);
    await preguntar(admin, 'busca algo');

    doble.olvidar();
    doble.guionar([
      { herramientas: [{ nombre: 'movimientos', args: {} }] },
      { texto: 'Ahí están los movimientos.' },
    ]);
    const r = await preguntar(admin, '¿qué entró este mes?');
    const f = eventos(r.texto).find((e) => e.tipo === 'ficha').ficha;
    assert.ok(f.enlace.startsWith('/'), `el enlace «${f.enlace}» no es una pantalla de la plataforma`);
    assert.ok(!/javascript:|https?:/i.test(f.enlace), 'un enlace de la ficha apunta fuera de la plataforma');
  });
});
