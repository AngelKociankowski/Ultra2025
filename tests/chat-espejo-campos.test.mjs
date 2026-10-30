/**
 * El espejo, campo por campo: un dato que esa persona no puede leer con su
 * nombre en ninguna pantalla a la que entre no sale por el chat.
 *
 * `tests/chat-espejo.test.mjs` vigila la frontera de las CONSULTAS: cada una
 * declara un permiso y no se le ofrece ni se le ejecuta a quien no lo tenga. Eso
 * dejaba un hueco un piso más abajo, y se encontró usándolo:
 * `ficha_de_servicio` declara `permiso: 'ver'` —la ficha de un servicio la abren
 * los seis roles— y entregaba `precio_guardia`. Medido contra la plataforma, con
 * el precio puesto en una cifra que no sale de ningún otro sitio: la etiqueta
 * «Precio por guardia» solo aparece en la pantalla «Precios» y en el bloque
 * editable del administrador dentro de la ficha. A jurídico y a operaciones, que
 * en «Precios» leen «Sin permiso», el chat les contestaba el precio con su
 * nombre. El contrato es ser espejo de lo que la persona ve CON SU NOMBRE, y ahí
 * no lo era.
 *
 * Lo que este guardián cierra: el MECANISMO. El filtro vive en un solo sitio
 * —`ejecutar()`, la misma cerradura que comprueba el permiso— y se mide corriendo
 * las siete consultas con los seis roles, leyendo los bytes que el servidor le
 * devolvió al servicio externo. No hay forma de que una consulta se olvide de
 * filtrar lo suyo, porque ninguna filtra: filtra la cerradura.
 *
 * Lo que NO cierra, y es lo honesto decirlo: que la declaración esté COMPLETA.
 * Nadie puede comprobar que no falte un campo, porque saber de qué pantalla es
 * cada campo pediría leer `app/` con un analizador que adivina, o inventar la
 * tabla de «qué campo ve cada rol» que el plan prohíbe expresamente —y con razón:
 * una tabla así queda más cerrada que las pantallas en unos sitios y más abierta
 * en otros, y nadie la actualiza—. Así que la clase entera sigue abierta por ese
 * lado, con su síntoma: se nota al usarlo, cuando el chat contesta con su nombre
 * algo que la pestaña no abre.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. La mitad que corre las consultas
 * levanta la aplicación compilada; sin recompilar mide el código anterior.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
import { PERMISOS } from '../lib/rbac.js';

let app;
let doble;
let CAMPOS_POR_PERMISO;
let HERRAMIENTAS;

const sesiones = {};
const CORREO_ESPECTADOR = 'espectador@corporativoultra.com';

/** El precio que se le pone al servicio sembrado: no sale de ningún otro sitio. */
const PRECIO_DISTINTIVO = 7777.77;
/** El servicio sembrado por esta prueba. */
const sembrado = {};

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/**
 * Corre una consulta con ese rol y devuelve lo que de verdad viajó al servicio
 * externo, más el canal.
 *
 * Se mide en los bytes de la SIGUIENTE petición a la red y no llamando a la
 * función, porque el resultado de una consulta viaja ahí: es donde se vería un
 * campo que no debía salir.
 */
async function correr(rol, nombre, args = {}) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
  const r = await sesiones[rol].pedir('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ pregunta: `corre ${nombre}`, previas: [] }),
  });
  if (r.status !== 200) return { status: r.status, datos: null, crudo: '' };

  const bloques = (doble.peticiones()[1]?.cuerpo?.messages || [])
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  assert.equal(bloques.length, 1, `${rol}/${nombre}: no volvió exactamente un resultado`);
  const esError = bloques[0].is_error === true;
  return {
    status: 200,
    error: esError,
    // El crudo es lo que de verdad salió: aquí se busca el campo y el valor.
    crudo: String(bloques[0].content),
    datos: esError ? null : JSON.parse(bloques[0].content).datos,
    fichas: eventos(r.texto).filter((e) => e.tipo === 'ficha').map((e) => e.ficha),
  };
}

before(async () => {
  const { register } = await import('node:module');
  register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
  const h = await import(new URL('../lib/chat-herramientas.js', import.meta.url).href);
  ({ CAMPOS_POR_PERMISO, HERRAMIENTAS } = h);

  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' },
  });

  const admin = await app.entrar(ROLES.admin);
  sesiones.admin = admin;
  for (const rol of ['juridico', 'finanzas', 'operaciones', 'ventas']) {
    sesiones[rol] = await app.entrarYAsentar(ROLES[rol]);
  }
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

  // Un servicio con el precio por guardia puesto en la cifra distintiva. Se
  // siembra con una apertura, que es la única entrada al estado de fuerza, y el
  // precio se pone con la edición que solo el administrador tiene.
  const ap = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: 'ESPEJO DE CAMPOS MIDE AQUI', turnos: { '24 HRS': 2 } }),
  });
  assert.equal(ap.status, 201, ap.texto);
  sembrado.id = ap.json.servicioId;
  const patch = await admin.pedir(`/api/servicios/${sembrado.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ precio_guardia: PRECIO_DISTINTIVO }),
  });
  assert.equal(patch.status, 200, patch.texto);

  // Y un cambio de precio aplicado, para que el servicio tenga HISTORIA: ahí el
  // mismo campo viaja dentro de cada renglón de una lista, un nivel más abajo.
  // Sin esto, el filtro podría mirar solo el primer nivel y nadie se enteraría.
  const subida = await admin.pedir('/api/precios', {
    method: 'POST',
    body: JSON.stringify({
      ids: [sembrado.id],
      ajuste: { tipo: 'PORCENTAJE', valor: 10 },
      vigencia: '2026-11',
      motivo: 'revisión de la prueba del espejo de campos',
    }),
  });
  assert.equal(subida.status, 201, subida.texto);
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

// ───────────────────────────────────────────────────────────── la declaración
describe('la declaración se deriva de los permisos de verdad, no de una lista suelta', () => {
  test('cada permiso declarado existe en la tabla de permisos de la plataforma', () => {
    const existen = new Set(Object.values(PERMISOS).flat());
    const inventados = Object.keys(CAMPOS_POR_PERMISO).filter((p) => !existen.has(p));
    assert.deepEqual(
      inventados,
      [],
      `estos campos se guardan detrás de un permiso que no existe, así que no guardan nada: ${inventados.join(', ')}`
    );
  });

  test('cada campo declarado es una columna de verdad de la base', () => {
    // Un campo mal escrito no filtra nada y nadie se enteraría: el resultado
    // seguiría saliendo con el nombre bueno. Se comprueba contra el esquema.
    const esquema = fs.readFileSync(new URL('../lib/schema.sql', import.meta.url), 'utf8');
    const fantasmas = Object.values(CAMPOS_POR_PERMISO)
      .flat()
      .filter((campo) => !new RegExp(`^\\s*${campo}\\s`, 'm').test(esquema));
    assert.deepEqual(
      fantasmas,
      [],
      `estos campos no son columnas de la base, así que el filtro no los encontraría nunca: ${fantasmas.join(', ')}`
    );
  });

  test('ninguna declaración está vacía: una lista vacía es una regla que no existe', () => {
    for (const [permiso, campos] of Object.entries(CAMPOS_POR_PERMISO)) {
      assert.ok(Array.isArray(campos) && campos.length > 0, `«${permiso}» no declara ningún campo`);
    }
  });
});

// ───────────────────────────────────────────── corriendo las siete, por los seis
describe('corriendo las consultas con los seis roles, el campo cruza o no según el permiso', () => {
  test('el precio por guardia llega a quien entra a «Precios» y a nadie más', async () => {
    const campos = CAMPOS_POR_PERMISO.precios;
    assert.ok(campos?.length, 'la declaración de «precios» desapareció y esta prueba dejaría de medir');

    let alguienLoRecibio = false;
    for (const rol of Object.keys(PERMISOS)) {
      const puedeEntrar = PERMISOS[rol].includes('precios');
      const r = await correr(rol, 'ficha_de_servicio', { id: sembrado.id });

      if (rol === 'espectador') {
        // El espectador no tiene el asistente: ni llega a correr nada.
        assert.equal(r.status, 403, `el espectador recibió ${r.status} del asistente`);
        continue;
      }
      assert.equal(r.status, 200, `${rol}: la pregunta contestó ${r.status}`);
      assert.ok(!r.error, `${rol}: la consulta de la ficha falló: ${r.crudo.slice(0, 200)}`);

      const traeElNombre = campos.some((c) => r.crudo.includes(`"${c}"`));
      const traeElValor = r.crudo.includes(String(PRECIO_DISTINTIVO));

      if (puedeEntrar) {
        assert.ok(
          traeElNombre && traeElValor,
          `${rol} entra a «Precios» y el chat le escondió el precio: el espejo quedó MÁS cerrado que la pantalla`
        );
        alguienLoRecibio = true;
      } else {
        assert.ok(
          !traeElNombre,
          `${rol} no entra a «Precios» y el chat le manda ${campos.filter((c) => r.crudo.includes(`"${c}"`)).join(', ')}`
        );
        assert.ok(
          !traeElValor,
          `${rol} no entra a «Precios» y el valor del precio (${PRECIO_DISTINTIVO}) viajó igual, con otro nombre`
        );
        // Y se le dice que falta algo, para que pueda contestar «eso se ve en esa
        // pantalla» en vez de dar por hecho que el dato no existe.
        assert.match(
          r.crudo,
          /noSaleTodo/,
          `${rol}: se le quitó un campo sin decírselo, así que contestaría como si no existiera`
        );
      }
    }

    // La mitad que hace honesto el verde: si nadie recibió el campo, «no cruza»
    // sería verdad trivial y esta prueba no mediría nada.
    assert.ok(
      alguienLoRecibio,
      'ningún rol recibió el precio por guardia: el verde de arriba no demuestra nada'
    );
  });

  test('las siete consultas, con los cinco roles: ningún campo vetado se cuela por otro camino', async () => {
    // El mismo campo viaja en dos sitios de la ficha —suelto y dentro de cada
    // renglón de la historia de precios—, y el día que una consulta nueva lo
    // devuelva, esto lo caza sin que nadie se acuerde de añadirla aquí: la lista
    // de consultas se deriva de las propias herramientas.
    const argumentos = {
      ficha_de_servicio: { id: sembrado.id },
      buscar_servicio: { texto: 'ESPEJO DE CAMPOS' },
    };

    for (const rol of ['admin', 'juridico', 'finanzas', 'operaciones', 'ventas']) {
      const vetados = Object.entries(CAMPOS_POR_PERMISO)
        .filter(([permiso]) => !PERMISOS[rol].includes(permiso))
        .flatMap(([, campos]) => campos);
      if (vetados.length === 0) continue;

      for (const h of HERRAMIENTAS) {
        if (!PERMISOS[rol].includes(h.permiso)) continue;
        const r = await correr(rol, h.nombre, argumentos[h.nombre] || {});
        assert.equal(r.status, 200, `${rol}/${h.nombre}: contestó ${r.status}`);
        if (r.error) continue;
        const colados = vetados.filter((c) => r.crudo.includes(`"${c}"`));
        assert.deepEqual(
          colados,
          [],
          `${rol} recibió por «${h.nombre}» campos de una pantalla que no abre: ${colados.join(', ')}`
        );
      }
    }
  });

  test('el guardián muerde: el filtro quita el campo a cualquier profundidad', async () => {
    /**
     * La demostración de que esto no es un verde hueco. Se le pide la ficha a
     * dos roles con el MISMO servicio: a uno que entra a «Precios» y a uno que
     * no. Si el filtro no estuviera, los dos resultados traerían el campo; si
     * solo mirara el primer nivel, el de dentro del historial se colaría. Lo que
     * se afirma es la diferencia medida entre los dos, no una ausencia suelta.
     */
    const dentro = await correr('ventas', 'ficha_de_servicio', { id: sembrado.id });
    const fuera = await correr('operaciones', 'ficha_de_servicio', { id: sembrado.id });

    const cuantas = (texto, campo) => texto.split(`"${campo}"`).length - 1;
    for (const campo of CAMPOS_POR_PERMISO.precios) {
      assert.equal(
        cuantas(fuera.crudo, campo),
        0,
        `«${campo}» sigue viajando ${cuantas(fuera.crudo, campo)} vez/veces a quien no entra a «Precios»`
      );
    }
    const aVentas = CAMPOS_POR_PERMISO.precios.reduce((a, c) => a + cuantas(dentro.crudo, c), 0);
    assert.ok(
      aVentas >= 2,
      `a ventas, que sí entra a «Precios», le llegaron ${aVentas} apariciones de esos campos: hacen falta al ` +
        'menos dos —el precio suelto y el de dentro de la historia— para que esta prueba demuestre que el ' +
        'filtro mira a cualquier profundidad y no solo el primer nivel'
    );
  });
});
