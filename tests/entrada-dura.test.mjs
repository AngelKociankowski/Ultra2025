/**
 * Lo que la plataforma acepta por escrito, y lo que convertía en silencio.
 *
 * Son dos defectos de la misma familia, los dos encontrados atacando las rutas
 * que el ciclo anterior estrenó:
 *
 *   1. **Pertenencia mal preguntada.** La validación del esquema de facturación
 *      era `if (valor && !ESQUEMAS[valor]) throw`, y `ESQUEMAS` es un objeto
 *      literal: `ESQUEMAS['__proto__']`, `['constructor']`, `['toString']`,
 *      `['valueOf']`, `['hasOwnProperty']` e `['isPrototypeOf']` son todos
 *      truthy, así que el `throw` no ocurría nunca. El valor se guardaba con un
 *      200 y después `programaDe()` —que traía el mismo guardia— le proponía a
 *      cobranza una factura a mes vencido, con fecha de emisión y de vencimiento
 *      que nadie eligió. El patrón seguro ya existía en el repo:
 *      `exigirDelCatalogo()` compara contra un `Set`, y por eso zona, asesor o
 *      uniforme sí rechazaban `__proto__` desde el primer día.
 *
 *   2. **Conversión en silencio.** Los campos de texto pasaban por
 *      `String(crudo ?? '')` y los importes por `numOrNull`, así que un objeto
 *      acababa guardado como razón social «[object Object]», un arreglo como
 *      dirección «x,y», y `[]` como precio por guardia **cero** —que la
 *      plataforma lee como servicio de cortesía—. Lo peor no es el dato malo: es
 *      que un cero capturado sí es una respuesta, así que el campo pasaba a «ya
 *      lo tenía» y por esa vía el hueco quedaba cerrado para siempre.
 *
 * Y de paso lo que no se entendía se tiraba sin avisar: `'abc'` devolvía 200 con
 * cero datos capturados y sin decir por qué. El fallo silencioso es el peor de
 * todos porque no se descubre hasta que alguien busca el dato y no está.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';

const ESPECTADOR = 'espectador@corporativoultra.com';
const HEREDADAS = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];

let app;
let admin;
let operaciones;
let ventas;
let miron;
let opciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

async function abrirMinimo(nombre, extra = {}) {
  const r = await operaciones.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombre,
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
      ...extra,
    }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  opciones = (await admin.pedir('/api/catalogos')).json;

  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email: ESPECTADOR, nombre: 'Mirón', rol: 'espectador', password: PASSWORD_TEMPORAL }),
  });
  assert.equal(alta.status, 201, alta.texto);
  const primera = await app.entrar(ESPECTADOR, PASSWORD_TEMPORAL);
  await primera.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });
  miron = await app.entrar(ESPECTADOR, PASSWORD);
});

after(async () => {
  await app?.cerrar();
});

describe('el esquema de facturación se comprueba por pertenencia, no por lectura', () => {
  test('las claves heredadas de Object.prototype no pasan por ninguno de los cuatro caminos', async () => {
    for (const valor of HEREDADAS) {
      // 1) al completar el alta
      const id = await abrirMinimo(`ESQ COMPLETAR ${valor}`);
      const r1 = await completar(operaciones, id, { esquema_facturacion: valor });
      assert.equal(r1.status, 400, `completar con «${valor}» → ${r1.status}`);
      assert.equal((await ficha(id)).esquema_facturacion, null, `«${valor}» se guardó al completar`);

      // 2) al registrar la apertura
      const r2 = await operaciones.pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({
          tipo: 'APERTURA',
          servicio: `ESQ APERTURA ${valor}`,
          zona: opciones.zonas[0],
          asesor: opciones.asesores[0],
          turnos: { '24 HRS': 1 },
          esquema_facturacion: valor,
        }),
      });
      assert.equal(r2.status, 400, `apertura con «${valor}» → ${r2.status} ${r2.texto.slice(0, 160)}`);

      // 3) al editar la ficha
      const r3 = await admin.pedir(`/api/servicios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ esquema_facturacion: valor }),
      });
      assert.equal(r3.status, 400, `editar con «${valor}» → ${r3.status}`);
      assert.equal((await ficha(id)).esquema_facturacion, null);

      // 4) al aplicar condiciones de cobro en bloque
      const r4 = await admin.pedir('/api/facturas/condiciones', {
        method: 'POST',
        body: JSON.stringify({ esquema_facturacion: valor, dias_credito: 30, alcance: 'seleccion', ids: [id] }),
      });
      assert.equal(r4.status, 400, `condiciones con «${valor}» → ${r4.status}`);
    }
  });

  test('y un esquema de verdad sigue entrando', async () => {
    const id = await abrirMinimo('ESQ BUENO');
    const r = await completar(operaciones, id, { esquema_facturacion: 'QUINCENAL' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).esquema_facturacion, 'QUINCENAL');
  });

  test('cobranza no le propone factura a un servicio con esquema que no existe', async () => {
    // Aunque alguien lo haya metido por SQL: el guardia de `programaDe()`
    // pregunta por pertenencia, así que un esquema inventado no cae al último
    // caso —mes vencido— con una fecha que nadie eligió.
    const r = await admin.pedir('/api/facturas/condiciones', {
      method: 'POST',
      body: JSON.stringify({ esquema_facturacion: 'INVENTADO', dias_credito: 30, alcance: 'sin_condiciones' }),
    });
    assert.equal(r.status, 400, r.texto);
  });
});

describe('completar el alta: un valor que no es texto ni número no es una respuesta', () => {
  test('un objeto no acaba como razón social y una lista no acaba como dirección', async () => {
    const id = await abrirMinimo('ENTRADA OBJETO');
    const r = await completar(operaciones, id, { razon_social: { a: 1 } });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /texto o número/i);

    const r2 = await completar(operaciones, id, { direccion: ['x', 'y'] });
    assert.equal(r2.status, 400, r2.texto);

    const s = await ficha(id);
    assert.equal(s.razon_social, null, `quedó «${s.razon_social}»`);
    assert.equal(s.direccion, null, `quedó «${s.direccion}»`);

    // Y como no se escribió nada, el dato de verdad sí entra después. Era la
    // mitad grave del defecto: «[object Object]» cerraba el hueco.
    const bueno = await completar(operaciones, id, { razon_social: 'ÑOÑO Y CÍA S.A. de C.V.' });
    assert.equal(bueno.status, 200, bueno.texto);
    assert.equal((await ficha(id)).razon_social, 'ÑOÑO Y CÍA S.A. de C.V.');
  });

  test('un arreglo vacío no es un precio de cero', async () => {
    const id = await abrirMinimo('ENTRADA ARREGLO');
    const r = await completar(operaciones, id, { precio_guardia: [], dias_credito: [] });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, null, 'un cero que nadie escribió cierra el hueco para siempre');
    assert.equal(s.dias_credito, null);
  });

  test('un cero escrito sí es una respuesta y se guarda', async () => {
    // La otra cara: hay servicios de cortesía y clientes de contado.
    const id = await abrirMinimo('ENTRADA CERO');
    const r = await completar(operaciones, id, { precio_guardia: 0, dias_credito: 0 });
    assert.equal(r.status, 200, r.texto);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 0);
    assert.equal(s.dias_credito, 0);
  });

  test('un número que no se entiende se contesta, no se tira', async () => {
    const id = await abrirMinimo('ENTRADA ABC');
    const r = await completar(operaciones, id, { precio_guardia: 'abc' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /no es un número/i);
    assert.equal((await ficha(id)).precio_guardia, null);
  });

  test('importes y días llevan tope de cordura', async () => {
    const id = await abrirMinimo('ENTRADA TOPES');
    const caro = await completar(operaciones, id, { precio_guardia: 1e21 });
    assert.equal(caro.status, 400, caro.texto);
    const plazo = await completar(operaciones, id, { dias_credito: '1,234.56' });
    assert.equal(plazo.status, 400, `1235 días de crédito son tres años: ${plazo.texto}`);

    const s = await ficha(id);
    assert.equal(s.precio_guardia, null);
    assert.equal(s.dias_credito, null);

    // Y lo que cabe en un rango razonable entra igual que antes.
    const bien = await completar(operaciones, id, { precio_guardia: '1,234.56', dias_credito: '30' });
    assert.equal(bien.status, 200, bien.texto);
    const t = await ficha(id);
    assert.equal(t.precio_guardia, 1234.56);
    assert.equal(t.dias_credito, 30);
  });

  test('un cuerpo que no es un objeto se contesta con 400 y no con 200 ni con 500', async () => {
    const id = await abrirMinimo('ENTRADA CUERPO');
    for (const cuerpo of ['"texto"', 'null', '123', '[]']) {
      const r = await operaciones.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: cuerpo });
      assert.equal(r.status, 400, `cuerpo ${cuerpo} → ${r.status} ${r.texto.slice(0, 160)}`);
      // «texto» se recorría carácter por carácter: la respuesta decía
      // rechazados:['0','1','2','3','4'] con un 200.
      assert.ok(!/rechazados/.test(r.texto), `cuerpo ${cuerpo}: ${r.texto.slice(0, 160)}`);
    }
    const lote = await operaciones.pedir('/api/aperturas/descartar-lote', { method: 'POST', body: 'null' });
    assert.equal(lote.status, 400, `el lote con cuerpo null → ${lote.status}`);
  });

  test('no se completa un servicio que ya no opera', async () => {
    /**
     * La restricción vivía solo en la pantalla —el panel se monta si el servicio
     * está ACTIVO—, así que por API se podía escribir el precio y las
     * condiciones de cobro de un cliente dado de baja, y de paso quedaba un
     * renglón en el historial de precios de un servicio cancelado: una historia
     * que nunca ocurrió.
     */
    const id = await abrirMinimo(`ENTRADA BAJA ${Date.now()}`);
    const baja = await operaciones.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: id,
        fecha: '2026-10-09',
        motivo: opciones.motivosBaja[0],
      }),
    });
    assert.equal(baja.status, 201, baja.texto);
    assert.equal((await ficha(id)).estatus, 'BAJA');

    const r = await completar(operaciones, id, { direccion: 'ESCRITO EN UN SERVICIO DE BAJA', precio_guardia: 555 });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(id);
    assert.equal(s.direccion, null);
    assert.equal(s.precio_guardia, null);

    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    const i = html.indexOf('Precio y su historia');
    assert.notEqual(i, -1);
    assert.match(
      html.slice(i, i + 3000),
      /Todavía no se le ha movido el precio/,
      'ni renglón en el historial de precios de un servicio cancelado'
    );
  });

  test('un suspendido tampoco', async () => {
    const id = await abrirMinimo(`ENTRADA SUSPENDIDO ${Date.now()}`);
    const sus = await admin.pedir(`/api/servicios/${id}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'La obra se detuvo dos meses', desde: '2026-10-01' }),
    });
    assert.equal(sus.status, 200, sus.texto);

    const r = await completar(ventas, id, { razon_social: 'MIENTRAS ESTABA PARADO SA' });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).razon_social, null);
  });
});

describe('una marca sin destino se queda como texto', () => {
  let bajaId;

  before(async () => {
    bajaId = await abrirMinimo(`MARCA SIN DESTINO ${Date.now()}`);
    const baja = await operaciones.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: bajaId,
        fecha: '2026-10-09',
        motivo: opciones.motivosBaja[0],
      }),
    });
    assert.equal(baja.status, 201, baja.texto);
  });

  test('el renglón de un servicio de baja señala el hueco sin prometer el arreglo', async () => {
    // Su ficha no monta `#completar` ni `#editar` —los dos piden ACTIVO—, así
    // que el enlace dejaba a quien lo seguía arriba de la ficha, sin arreglo y
    // sin explicación.
    const lista = comoSeLee((await admin.pedir('/estado-fuerza?estatus=BAJA&q=MARCA SIN DESTINO')).texto);
    assert.match(lista, /faltan \d+ datos?/, 'la etiqueta sigue estando: el hueco es real');
    assert.ok(!lista.includes(`/estado-fuerza/${bajaId}#completar`), 'y no enlaza a un ancla que la ficha no trae');
    assert.ok(!lista.includes(`/estado-fuerza/${bajaId}#editar`));

    const f = (await admin.pedir(`/estado-fuerza/${bajaId}`)).texto;
    assert.ok(!f.includes('id="completar"'), 'comprobado contra la ficha, no contra el código');
    assert.ok(!f.includes('id="editar"'));
  });

  test('cada rol solo ve los anclajes que su propia ficha monta', async () => {
    const malos = [];
    for (const [nombre, sesion] of [
      ['admin', admin],
      ['operaciones', operaciones],
      ['ventas', ventas],
      ['espectador', miron],
    ]) {
      const lista = await sesion.pedir('/estado-fuerza');
      const anclas = [
        ...new Set(
          [...comoSeLee(lista.texto).matchAll(/href="\/estado-fuerza\/(\d+)#(completar|editar|corregir)"/g)].map(
            (m) => `${m[1]}#${m[2]}`
          )
        ),
      ];
      for (const a of anclas.slice(0, 8)) {
        const [id, ancla] = a.split('#');
        const f = await sesion.pedir(`/estado-fuerza/${id}`);
        if (!f.texto.includes(`id="${ancla}"`)) {
          malos.push(`${nombre}: el renglón enlaza a /estado-fuerza/${id}#${ancla} y su ficha no lo trae`);
        }
      }
    }
    assert.deepEqual(malos, [], malos.join('\n'));
  });

  test('el desglose por jornada solo se ofrece a quien puede corregir', async () => {
    // `CorreccionServicio` se monta con permiso `corregir` —admin y
    // operaciones—, así que para ventas, finanzas, jurídico y el espectador el
    // enlace a `#corregir` no llevaba a ningún arreglo.
    for (const [nombre, sesion] of [
      ['ventas', ventas],
      ['espectador', miron],
    ]) {
      const html = comoSeLee((await sesion.pedir('/estado-fuerza')).texto);
      assert.ok(!/#corregir"/.test(html), `${nombre} no corrige nada y se le ofrecía el enlace`);
    }
    // Y a quien sí puede no se le quitó: el renglón sin desglose le sigue
    // llevando a la corrección. Se comprueba sobre un servicio del que se sabe
    // que su ficha monta el bloque.
    const unId = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios[0].id;
    assert.match((await admin.pedir(`/estado-fuerza/${unId}`)).texto, /id="corregir"/);
    assert.ok(!(await miron.pedir(`/estado-fuerza/${unId}`)).texto.includes('id="corregir"'));
  });
});

describe('el formulario de alta exige sus cinco datos', () => {
  test('la rejilla de jornadas también lleva required', async () => {
    // Era el quinto dato del mínimo y el único que el navegador no frenaba:
    // solo lo paraban el JavaScript del botón y el servidor.
    const html = (await operaciones.pedir('/aperturas/nueva')).texto;
    const i = html.indexOf('Guardias por jornada');
    assert.notEqual(i, -1, 'no se encontró la rejilla');
    const bloque = html.slice(i, i + 1500);
    assert.match(bloque, /required/, 'la rejilla no exige nada mientras esté vacía');
  });
});

describe('el paginador conserva los filtros que la pantalla respeta, y no los demás', () => {
  /**
   * Los destinos de la pantalla, no el HTML entero: la URL que pidió el
   * navegador aparece también en los datos que React deja al final del
   * documento, y eso no es un enlace que nadie pueda seguir.
   */
  const destinos = (html) => [...comoSeLee(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  test('un parámetro que la pantalla descartó no viaja a la página siguiente', async () => {
    // `falta=1` dentro de un corte cerrado no filtra ni etiqueta —el pasado no
    // se edita—, así que arrastrarlo en los enlaces del paginador prometía un
    // filtro que esa pantalla no aplica.
    const r = await admin.pedir('/estado-fuerza?periodo=2026-03&falta=1');
    assert.match(comoSeLee(r.texto), /corte de marzo 2026/);
    const malos = destinos(r.texto).filter((h) => h.includes('falta=1'));
    assert.deepEqual(malos, [], `enlaces con un filtro que la pantalla descartó: ${malos.join(' · ')}`);
  });

  test('y el que sí está puesto se conserva', async () => {
    const r = await admin.pedir('/estado-fuerza?falta=1');
    assert.ok(
      destinos(r.texto).some((h) => h.includes('falta=1') && h.includes('pagina=')),
      'paginar dentro de un filtro no lo puede perder'
    );
  });
});
