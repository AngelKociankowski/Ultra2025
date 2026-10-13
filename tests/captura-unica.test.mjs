/**
 * Un solo sitio que diga qué puede valer un dato capturado.
 *
 * Tres vueltas de este ciclo encontraron hallazgos de la misma clase, y el
 * diagnóstico no era que hubiera cuatro defectos: era que la verdad sobre qué
 * puede valer un dato estaba escrita en cuatro sitios —`numOrNull()`, las tres
 * ramas de `actualizarServicio()`, `numeroCapturado()` del panel del alta, y casi
 * nada en `registrarCorreccion()`—, así que endurecer una puerta dejaba las de al
 * lado abiertas.
 *
 * Por eso estas pruebas están escritas al revés de lo normal: no prueban un
 * camino, prueban LA MISMA COSA POR TODOS LOS CAMINOS A LA VEZ. Cada caso se
 * manda por los cuatro —registrar la apertura, editar la ficha, completar el
 * hueco, corregir— y se exige la misma respuesta. Si mañana alguien vuelve a
 * meter una interpretación propia en uno de ellos, el caso se cae por ese camino
 * y la prueba dice por cuál.
 *
 *   U1. Lo que puede valer un dato, por los cuatro caminos.
 *   U2. El precio vive en dos lugares, y la ficha y el total del mes dicen lo
 *       mismo después de arreglarlo por cada camino que lo cambia.
 *   U3. El aviso a jurídico: por qué no se avisa en el primer llenado.
 *   U4. La pantalla dice lo que el servidor rechazó, también al llenar.
 *
 * Como el resto de las pruebas de esta carpeta, van contra el servidor de verdad.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';
/**
 * Importados y no copiados: qué campos existen y quién puede escribirlos vive en
 * el RBAC, y una prueba que vuelva a escribir esa lista deja de avisar el día que
 * cambie. Solo `lib/rbac.js`, que no importa nada: los demás módulos de `lib`
 * usan rutas sin extensión —las resuelve Next— y no se pueden cargar desde una
 * prueba suelta. Los campos que se completan se leen del panel de verdad, que es
 * mejor fuente todavía.
 */
import { GRUPOS_CAMPOS, CAMPOS_CORREGIBLES } from '../lib/rbac.js';

/** Los topes medidos. Los decide `lib/captura.js`; aquí se escriben para medir. */
const TOPE_TEXTO = 500;
const TOPE_IMPORTE = 10_000_000;

const RAIZ = path.resolve(import.meta.dirname, '..');

let app;
let admin;
let operaciones;
let ventas;
let juridico;
let opciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
const corregirPropio = (sesion, id, correcciones, motivo) =>
  completar(sesion, id, motivo === undefined ? { correcciones } : { correcciones, motivo });
const editar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
const correccionFormal = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/correccion`, { method: 'POST', body: JSON.stringify(cuerpo) });

let n = 0;
const nombreUnico = (base) => `${base} ${Date.now().toString(36)}${(n += 1)}`;

async function abrir(sesion, base, extra = {}) {
  const r = await sesion.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombreUnico(base),
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
      ...extra,
    }),
  });
  return r;
}

/** Abre un servicio y devuelve su id, exigiendo que se pudiera abrir. */
async function abrirId(sesion, base, extra = {}) {
  const r = await abrir(sesion, base, extra);
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const aperturasDe = (servicioId) =>
  conLaBase((db) =>
    db
      .prepare('SELECT id, folio, precio_guardia, guardias, periodo FROM aperturas WHERE servicio_id = ? ORDER BY id')
      .all(Number(servicioId))
  );

/** El «Valor mensual que entra» que la pantalla de Aperturas enseña para ese mes. */
async function totalDelMes(periodo) {
  const r = await admin.pedir(`/aperturas?periodo=${periodo}`);
  assert.equal(r.status, 200);
  const html = comoSeLee(r.texto);
  const m = html.match(/Valor mensual que entra<\/p>[\s\S]{0,300}?>(\$[\d,.]+)</);
  assert.ok(m, `no se encontró el total del mes en la pantalla de /aperturas?periodo=${periodo}`);
  return Number(m[1].replace(/[$,]/g, ''));
}

const pesos = (v) => Number(v) || 0;

before(async () => {
  app = await arrancar();
  admin = await app.entrar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  opciones = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app.cerrar();
});

// ------------------------------------------------------------------- U1

describe('U1 · lo que puede valer un dato, por los cuatro caminos', () => {
  /**
   * Las formas que `Number()` entiende y nadie teclea.
   *
   * Medidas por el manager contra el servidor: `'0x10'` entraba como 16 pesos y
   * `'7e-3'` como 0.007, las dos con 200 y contadas como dato capturado.
   */
  const NO_SON_NUMEROS = ['0x10', '1e3', '7e-3', '+8000', '1,2,3'];
  /** Y las que una persona sí escribe, que tienen que seguir entrando. */
  const SI_SON_NUMEROS = [
    ['1,234.56', 1234.56],
    ['  42  ', 42],
    ['0', 0],
  ];
  /** Lo que no es ni texto ni número, y nunca puede acabar en nulo ni en cero. */
  const NO_SON_DATOS = [[], {}, true, false, ['9500']];

  test('U1.1 registrar la apertura: lo que nadie teclea se rechaza, y no nace el servicio', async () => {
    for (const crudo of NO_SON_NUMEROS) {
      const r = await abrir(operaciones, 'U1 APERTURA', { precio_guardia: crudo });
      assert.equal(r.status, 400, `«${crudo}» → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.match(r.json.error, /no es un número/, `«${crudo}»`);
    }
    for (const crudo of NO_SON_DATOS) {
      const r = await abrir(operaciones, 'U1 APERTURA TIPO', { precio_guardia: crudo });
      assert.equal(r.status, 400, `${JSON.stringify(crudo)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    // Y lo que sí se teclea entra, con su valor exacto, en la ficha y en el
    // movimiento: son las dos columnas donde vive el precio.
    for (const [crudo, esperado] of SI_SON_NUMEROS) {
      const id = await abrirId(operaciones, 'U1 APERTURA BUENA', { precio_guardia: crudo });
      assert.equal((await ficha(id)).precio_guardia, esperado, `«${crudo}» en la ficha`);
      assert.equal(aperturasDe(id)[0].precio_guardia, esperado, `«${crudo}» en el movimiento`);
    }
  });

  test('U1.2 editar la ficha: el camino del administrador, que era el más abierto', async () => {
    const id = await abrirId(admin, 'U1 EDITAR', { precio_guardia: 7000 });
    for (const crudo of NO_SON_NUMEROS) {
      const r = await editar(admin, id, { precio_guardia: crudo });
      assert.equal(r.status, 400, `«${crudo}» → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.match(r.json.error, /no es un número/, `«${crudo}»`);
      assert.equal((await ficha(id)).precio_guardia, 7000, `«${crudo}» movió la columna`);
    }
    for (const crudo of NO_SON_DATOS) {
      const r = await editar(admin, id, { precio_guardia: crudo });
      assert.equal(r.status, 400, `${JSON.stringify(crudo)} → ${r.status} ${r.texto.slice(0, 160)}`);
      // Ni un nulo ni un cero en silencio: el precio sigue siendo el que era.
      assert.equal(
        (await ficha(id)).precio_guardia,
        7000,
        `${JSON.stringify(crudo)} dejó el precio en «${(await ficha(id)).precio_guardia}»`
      );
    }
    for (const [crudo, esperado] of SI_SON_NUMEROS) {
      const r = await editar(admin, id, { precio_guardia: crudo });
      assert.equal(r.status, 200, `«${crudo}» → ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, esperado, `«${crudo}»`);
    }
  });

  test('U1.3 completar el hueco del alta', async () => {
    for (const crudo of NO_SON_NUMEROS) {
      const id = await abrirId(operaciones, 'U1 COMPLETAR');
      const r = await completar(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 400, `«${crudo}» → ${r.status} ${r.texto.slice(0, 160)}`);
      // Y el hueco sigue abierto, que es la mitad grave del defecto: un cero que
      // nadie escribió lo cerraba para siempre.
      assert.equal((await ficha(id)).precio_guardia, null, `«${crudo}»`);
    }
    for (const crudo of NO_SON_DATOS) {
      const id = await abrirId(operaciones, 'U1 COMPLETAR TIPO');
      const r = await completar(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 400, `${JSON.stringify(crudo)} → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, null, JSON.stringify(crudo));
    }
    for (const [crudo, esperado] of SI_SON_NUMEROS) {
      const id = await abrirId(operaciones, 'U1 COMPLETAR BUENO');
      const r = await completar(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 200, `«${crudo}» → ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, esperado, `«${crudo}»`);
    }
  });

  test('U1.4 corregir el dato propio el mismo día', async () => {
    const id = await abrirId(operaciones, 'U1 PROPIA');
    assert.equal((await completar(operaciones, id, { precio_guardia: 7000 })).status, 200);
    for (const crudo of NO_SON_NUMEROS) {
      const r = await corregirPropio(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 400, `«${crudo}» → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, 7000, `«${crudo}»`);
    }
    for (const crudo of NO_SON_DATOS) {
      const r = await corregirPropio(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 400, `${JSON.stringify(crudo)} → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, 7000, JSON.stringify(crudo));
    }
    for (const [crudo, esperado] of SI_SON_NUMEROS) {
      const r = await corregirPropio(operaciones, id, { precio_guardia: crudo });
      assert.equal(r.status, 200, `«${crudo}» → ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).precio_guardia, esperado, `«${crudo}»`);
    }
  });

  test('U1.5 la corrección formal, que era la que no tenía casi nada', async () => {
    // El precio no es corregible por esta vía; el total de guardias sí, y es un
    // número capturado igual que el precio. Era el camino donde `'0x10'` entraba
    // como 16 guardias.
    const id = await abrirId(operaciones, 'U1 FORMAL');
    const motivo = 'La plantilla se capturó mal.';
    for (const crudo of NO_SON_NUMEROS) {
      const r = await correccionFormal(admin, id, { total_guardias: crudo, motivo });
      assert.equal(r.status, 400, `«${crudo}» → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).total_guardias, 2, `«${crudo}» movió la plantilla`);
    }
    for (const crudo of NO_SON_DATOS) {
      const r = await correccionFormal(admin, id, { total_guardias: crudo, motivo });
      assert.equal(r.status, 400, `${JSON.stringify(crudo)} → ${r.status} ${r.texto.slice(0, 160)}`);
      assert.equal((await ficha(id)).total_guardias, 2, JSON.stringify(crudo));
    }
    // Y un número escrito a mano, con espacios de más, entra: es el mismo lector.
    // El desglose va con él porque el servicio lo tiene capturado y los dos
    // tienen que cuadrar, que es una regla aparte y sigue valiendo.
    const bien = await correccionFormal(admin, id, { total_guardias: '  4  ', turnos: { '24 HRS': 4 }, motivo });
    assert.equal(bien.status, 201, bien.texto);
    assert.equal((await ficha(id)).total_guardias, 4);
  });

  test('U1.6 el cero escrito a propósito se guarda por los cuatro caminos', async () => {
    // Hay servicios de cortesía y clientes de contado: el cero es una respuesta,
    // y lo único que no cuenta es el hueco.
    const porApertura = await abrirId(operaciones, 'U1 CERO APERTURA', { precio_guardia: 0, dias_credito: 0 });
    assert.equal((await ficha(porApertura)).precio_guardia, 0);
    assert.equal((await ficha(porApertura)).dias_credito, 0);

    const porCompletar = await abrirId(operaciones, 'U1 CERO COMPLETAR');
    assert.equal((await completar(operaciones, porCompletar, { precio_guardia: 0, dias_credito: 0 })).status, 200);
    assert.equal((await ficha(porCompletar)).precio_guardia, 0);
    assert.equal((await ficha(porCompletar)).dias_credito, 0);

    const porCorregir = await abrirId(operaciones, 'U1 CERO CORREGIR');
    assert.equal((await completar(operaciones, porCorregir, { precio_guardia: 500 })).status, 200);
    const c = await corregirPropio(operaciones, porCorregir, { precio_guardia: 0 });
    assert.equal(c.status, 200, c.texto);
    assert.equal((await ficha(porCorregir)).precio_guardia, 0, 'un servicio de cortesía es un dato, no un hueco');

    const porEditar = await abrirId(admin, 'U1 CERO EDITAR', { precio_guardia: 900 });
    assert.equal((await editar(admin, porEditar, { precio_guardia: 0 })).status, 200);
    assert.equal((await ficha(porEditar)).precio_guardia, 0);
  });

  test('U1.7 los textos llevan tope por los cuatro caminos, y avisan en vez de recortar', async () => {
    const largo = 'ñ'.repeat(50_000);
    const justo = 'A'.repeat(TOPE_TEXTO);

    // 1) Registrar la apertura.
    const r1 = await abrir(operaciones, 'U1 TEXTO APERTURA', { direccion: largo });
    assert.equal(r1.status, 400, r1.texto.slice(0, 200));
    assert.match(r1.json.error, /50,000 caracteres/);
    assert.match(r1.json.error, /no se recorta en silencio/i);

    // 2) Editar la ficha. Es el camino que el manager midió: una dirección de
    //    50 000 caracteres se guardaba entera.
    const id = await abrirId(admin, 'U1 TEXTO EDITAR', { direccion: 'Calle Corta 1' });
    const r2 = await editar(admin, id, { direccion: largo });
    assert.equal(r2.status, 400, r2.texto.slice(0, 200));
    assert.equal((await ficha(id)).direccion, 'Calle Corta 1', 'ni entero ni recortado: no entró');
    assert.equal((await editar(admin, id, { direccion: justo })).status, 200, 'lo que cabe sigue entrando');
    assert.equal((await ficha(id)).direccion.length, TOPE_TEXTO);

    // 3) Completar el hueco y 4) corregir el dato propio.
    const otro = await abrirId(operaciones, 'U1 TEXTO COMPLETAR');
    assert.equal((await completar(operaciones, otro, { direccion: largo })).status, 400);
    assert.equal((await ficha(otro)).direccion, null);
    assert.equal((await completar(operaciones, otro, { direccion: 'Calle Buena 2' })).status, 200);
    assert.equal((await corregirPropio(operaciones, otro, { direccion: largo })).status, 400);
    assert.equal((await ficha(otro)).direccion, 'Calle Buena 2');

    // Y la corrección formal, con el campo que le toca.
    const formal = await abrirId(operaciones, 'U1 TEXTO FORMAL');
    assert.equal((await completar(operaciones, formal, { razon_social: 'CORTA SA' })).status, 200);
    const r4 = await correccionFormal(admin, formal, { razon_social: largo, motivo: 'A ver si cabe.' });
    assert.equal(r4.status, 400, r4.texto.slice(0, 200));
    assert.equal((await ficha(formal)).razon_social, 'CORTA SA');
  });

  test('U1.8 la cadena vacía no borra la razón social de un cliente', async () => {
    // Era el hueco de la corrección formal: `razon_social: ''` dejaba en nulo el
    // nombre legal con el que se le factura, con un 200 y sin pedirlo nadie.
    const id = await abrirId(operaciones, 'U1 NO BORRA');
    assert.equal((await completar(operaciones, id, { razon_social: 'CLIENTE CON NOMBRE SA' })).status, 200);

    for (const vacio of ['', '   ', '\t\n ']) {
      const r = await correccionFormal(admin, id, { razon_social: vacio, motivo: 'La quiero quitar.' });
      assert.equal(r.status, 400, `${JSON.stringify(vacio)} → ${r.status} ${r.texto.slice(0, 200)}`);
      assert.match(r.json.error, /no lo borra/, `${JSON.stringify(vacio)}`);
      assert.equal(
        (await ficha(id)).razon_social,
        'CLIENTE CON NOMBRE SA',
        `${JSON.stringify(vacio)} borró la razón social`
      );
    }
    // Y jurídico, que es quien de verdad usa esta vía, tampoco puede.
    const j = await correccionFormal(juridico, id, { razon_social: '', motivo: 'Se va el cliente.' });
    assert.equal(j.status, 400, j.texto.slice(0, 200));
    assert.equal((await ficha(id)).razon_social, 'CLIENTE CON NOMBRE SA');

    // Cambiarla sí se puede: lo que no se puede es dejarla en blanco.
    const bien = await correccionFormal(admin, id, {
      razon_social: 'CLIENTE CON OTRO NOMBRE SA DE CV',
      motivo: 'El contrato dice otra cosa.',
    });
    assert.equal(bien.status, 201, bien.texto);
    assert.equal((await ficha(id)).razon_social, 'CLIENTE CON OTRO NOMBRE SA DE CV');
  });

  test('U1.9 el tope de los importes vale por los cuatro, y el negativo tiene su mensaje', async () => {
    const id = await abrirId(admin, 'U1 TOPES', { precio_guardia: 1000 });
    for (const [camino, enviar] of [
      ['editar', (v) => editar(admin, id, { precio_guardia: v })],
      ['apertura', (v) => abrir(operaciones, 'U1 TOPES AP', { precio_guardia: v })],
    ]) {
      const caro = await enviar(TOPE_IMPORTE + 1);
      assert.equal(caro.status, 400, `${camino} con el tope pasado → ${caro.status}`);
      assert.match(caro.json.error, /no puede pasar de/, camino);
      const negativo = await enviar(-5);
      assert.equal(negativo.status, 400, `${camino} con negativo → ${negativo.status}`);
      assert.match(negativo.json.error, /no puede ser negativo/, camino);
    }
    assert.equal((await ficha(id)).precio_guardia, 1000, 'nada de eso movió la columna');

    // Y el resultado del servicio sí acepta el negativo, porque un servicio
    // puede dar pérdida: es la única excepción y está medida en los datos.
    const r = await editar(admin, id, { resultado_servicio: -54_875.76 });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).resultado_servicio, -54_875.76);
  });

  test('U1.10 NINGÚN campo escribible se queda fuera del único sitio', async () => {
    /**
     * La prueba de que hay UN sitio, y no solo de que ese sitio funciona.
     *
     * No se comprueba campo a campo con una lista escrita aquí: se derivan los
     * campos escribibles de donde viven —los grupos del RBAC, los corregibles del
     * RBAC y los huecos que el panel de verdad ofrece— y a cada uno se le manda
     * una LISTA, que no es una respuesta a ninguna pregunta de captura. Si alguno
     * contesta 200, es que ese campo tiene su propia interpretación de lo que
     * llega y la verdad volvió a repartirse. El valor es el mismo para todos a
     * propósito: lo que se mide es la puerta, no el campo.
     */
    const sinValorSuelto = (c) => !['turnos', 'estatus'].includes(c);
    const escapados = [];
    const revisar = async (campo, etiqueta, enviar) => {
      const r = await enviar();
      if (r.status !== 400) escapados.push(`${etiqueta}:${campo} → ${r.status}`);
    };

    // 1) Todo lo que el RBAC deja editar en la ficha, por el camino de «Editar».
    //    `estatus` y `turnos` no están en ningún grupo: la edición los tiene
    //    bloqueados y eso no cambia.
    const editables = [...new Set(Object.values(GRUPOS_CAMPOS).flatMap((g) => g.campos))];
    const paraEditar = await abrirId(admin, 'U1 TODOS EDITAR');
    for (const campo of editables) {
      await revisar(campo, 'editar', () => editar(admin, paraEditar, { [campo]: [] }));
    }

    // 2) Todos los huecos que el panel ofrece de verdad, leídos del HTML.
    const paraCompletar = await abrirId(operaciones, 'U1 TODOS COMPLETAR');
    const panel = comoSeLee((await operaciones.pedir(`/estado-fuerza/${paraCompletar}`)).texto);
    const completables = [...new Set([...panel.matchAll(/id="completar-([a-z_]+)"/g)].map((m) => m[1]))];
    assert.ok(completables.length > 0, 'el panel tiene que ofrecer los huecos');
    for (const campo of completables) {
      await revisar(campo, 'completar', () => completar(operaciones, paraCompletar, { [campo]: [] }));
    }

    // 3) Y todo lo que se arregla por la corrección formal.
    const paraCorregir = await abrirId(operaciones, 'U1 TODOS CORREGIR');
    for (const campo of CAMPOS_CORREGIBLES.filter(sinValorSuelto)) {
      await revisar(campo, 'corrección', () =>
        correccionFormal(admin, paraCorregir, { [campo]: [], motivo: 'Una lista no es un dato.' })
      );
    }

    assert.deepEqual(
      escapados,
      [],
      `estos campos aceptaron una lista en vez de un dato: ${escapados.join(' · ')}`
    );
    console.log(
      `    # U1.10 puertas comprobadas: ${editables.length} al editar, ${completables.length} al completar, ` +
        `${CAMPOS_CORREGIBLES.filter(sinValorSuelto).length} al corregir`
    );
  });
});

// ------------------------------------------------------------------- U2

describe('U2 · el precio vive en dos lugares, y los dos dicen lo mismo', () => {
  /**
   * Los meses se eligen vacíos a propósito.
   *
   * El total del mes es la suma de TODOS los movimientos de ese mes, así que
   * sobre un mes compartido la prueba mediría también las aperturas de los demás
   * casos. La importación no dejó ningún movimiento posterior a agosto de 2026,
   * así que 2027 está entero libre y cada caso se queda con su propio mes.
   */
  const unMesVacio = (() => {
    let i = 0;
    return () => `2027-${String((i += 1)).padStart(2, '0')}`;
  })();

  /** Lo que la ficha dice y lo que el total del mes suma, para compararlos. */
  async function laFichaYElTotal(id, periodo) {
    const s = await ficha(id);
    const movimientos = aperturasDe(id);
    return {
      precioFicha: pesos(s.precio_guardia),
      precioMovimiento: pesos(movimientos[0].precio_guardia),
      guardias: movimientos[0].guardias,
      total: await totalDelMes(periodo),
    };
  }

  test('U2.1 el precio que se completa después: la ficha y el total del mes coinciden', async () => {
    const periodo = unMesVacio();
    const id = await abrirId(operaciones, 'U2 COMPLETAR', { fecha: `${periodo}-15` });
    assert.equal(await totalDelMes(periodo), 0, 'el mes arranca vacío y sin precio no hay monto');

    assert.equal((await completar(operaciones, id, { precio_guardia: 9500 })).status, 200);
    const d = await laFichaYElTotal(id, periodo);
    assert.equal(d.precioFicha, 9500);
    assert.equal(d.precioMovimiento, 9500, 'el movimiento se quedó sin el precio que se acabó de capturar');
    assert.equal(d.total, 9500 * d.guardias, `la ficha dice 9500 × ${d.guardias} y el mes suma ${d.total}`);
  });

  test('U2.2 el precio corregido el mismo día por quien lo capturó', async () => {
    // El caso de verdad del carril: ventas llena el hueco con 95,000 en vez de
    // 9,500 y lo arregla minutos después, desde el mismo panel.
    const periodo = unMesVacio();
    const id = await abrirId(ventas, 'U2 PROPIA', { fecha: `${periodo}-10` });
    assert.equal((await completar(ventas, id, { precio_guardia: 95000 })).status, 200);
    const malo = await laFichaYElTotal(id, periodo);
    assert.equal(malo.total, 95000 * malo.guardias, 'el mes ya cuenta el precio mal tecleado');

    const arreglo = await corregirPropio(ventas, id, { precio_guardia: 9500 });
    assert.equal(arreglo.status, 200, arreglo.texto);
    const d = await laFichaYElTotal(id, periodo);
    assert.equal(d.precioFicha, 9500);
    assert.equal(d.precioMovimiento, 9500);
    assert.equal(d.total, 9500 * d.guardias, `la ficha dice 9500 y el mes suma ${d.total}`);
  });

  test('U2.3 el precio arreglado por «Editar»: el caso que el manager midió', async () => {
    const periodo = unMesVacio();
    const id = await abrirId(admin, 'U2 EDITAR', { fecha: `${periodo}-20`, precio_guardia: 95000 });
    const antes = await laFichaYElTotal(id, periodo);
    assert.equal(antes.total, 95000 * antes.guardias, 'el mes arranca contando el precio mal tecleado');

    const r = await editar(admin, id, { precio_guardia: 9500 });
    assert.equal(r.status, 200, r.texto);

    const d = await laFichaYElTotal(id, periodo);
    assert.equal(d.precioFicha, 9500, 'la ficha');
    assert.equal(d.precioMovimiento, 9500, 'la copia del movimiento, que era la que se quedaba atrás');
    assert.equal(
      d.total,
      9500 * d.guardias,
      `la ficha dice 9,500 y la pantalla de Aperturas suma ${d.total} (antes seguía diciendo ${antes.total})`
    );

    // Y queda explicado: un número que cambió en un reporte cerrado tiene que
    // poderse rastrear.
    const bitacora = conLaBase((db) =>
      db
        .prepare("SELECT detalle FROM bitacora WHERE accion = 'precio_movimiento' ORDER BY id DESC LIMIT 1")
        .get()
    );
    assert.ok(bitacora, 'la alineación no dejó renglón en la bitácora');
    assert.match(bitacora.detalle, /se alineó con la ficha/);
    assert.match(bitacora.detalle, /«95000» → «9500»/);
  });

  test('U2.4 un aumento de precio NO reescribe el total de un mes ya cerrado', async () => {
    /**
     * La otra mitad de la decisión, y la que explica por qué la copia se queda.
     *
     * El movimiento guarda lo que se pactó ESE día. Una revisión anual aplicada
     * hoy sube el precio del cliente de hoy en adelante; el «valor mensual que
     * entró» de su mes de alta es un hecho cerrado y no puede moverse.
     */
    const periodo = unMesVacio();
    const id = await abrirId(admin, 'U2 AUMENTO', { fecha: `${periodo}-05`, precio_guardia: 10000 });
    const antes = await laFichaYElTotal(id, periodo);
    assert.equal(antes.total, 10000 * antes.guardias);

    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({
        ids: [id],
        ajuste: { tipo: 'PORCENTAJE', valor: 10 },
        motivo: 'Revisión anual del contrato.',
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const s = await ficha(id);
    assert.equal(pesos(s.precio_guardia), 11000, 'la ficha sube: es el precio de hoy en adelante');
    assert.equal(
      pesos(aperturasDe(id)[0].precio_guardia),
      10000,
      'el movimiento conserva el precio que se pactó ese día'
    );
    assert.equal(
      await totalDelMes(periodo),
      antes.total,
      'el total de un mes cerrado no se reescribe porque el precio suba después'
    );
  });

  test('U2.5 un movimiento que guardó otro precio es su propio registro y no se pisa', async () => {
    /**
     * Solo se alinea el movimiento cuya copia sigue diciendo lo que la ficha
     * decía antes. Si guarda otro número es porque ese día se pactó otro precio,
     * y eso no es una copia desactualizada: es un hecho.
     */
    const periodo = unMesVacio();
    const id = await abrirId(admin, 'U2 DOS PRECIOS', { fecha: `${periodo}-01`, precio_guardia: 8000 });
    // Una ampliación del mismo servicio pactada a otro precio, el mismo mes.
    const inc = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'INCREMENTO',
        servicio_id: id,
        turnos: { '24 HRS': 1 },
        fecha: `${periodo}-20`,
        precio_guardia: 12000,
      }),
    });
    assert.equal(inc.status, 201, inc.texto);

    assert.equal((await editar(admin, id, { precio_guardia: 8500 })).status, 200);
    const movimientos = aperturasDe(id);
    assert.equal(pesos(movimientos[0].precio_guardia), 8500, 'la copia que decía lo mismo se alineó');
    assert.equal(pesos(movimientos[1].precio_guardia), 12000, 'la que pactó otro precio se queda como estaba');
  });
});

// ------------------------------------------------------------------- U3

describe('U3 · a quién se le avisa de una razón social, y por qué', () => {
  const avisosDe = async (sesion) => (await sesion.pedir('/api/avisos')).json;

  test('U3.1 el primer llenado no avisa a jurídico, y el cliente nuevo sí le aparece en su cartera', async () => {
    /**
     * La asimetría que quedó de la vuelta pasada, resuelta hacia este lado a
     * propósito y no por olvido. Un aviso dice «esto cambió y alguien tiene que
     * mirarlo»: en un primer llenado no hay dos versiones que puedan contradecir
     * al contrato, la razón social se captura en casi toda alta —está en
     * `PARA_COBRAR`—, y un aviso por cliente nuevo es exactamente el aviso que
     * enseña a ignorar los avisos. La información no se pierde: la cartera de
     * jurídico lista todos los servicios vivos con su razón social.
     */
    const antes = (await avisosDe(juridico)).sinLeer;
    const id = await abrirId(ventas, 'U3 CLIENTE NUEVO');
    const r = await completar(ventas, id, { razon_social: 'U3 CLIENTE NUEVO SA DE CV' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await avisosDe(juridico)).sinLeer, antes, 'el primer llenado no manda aviso');

    const cartera = comoSeLee((await juridico.pedir('/juridico?q=U3%20CLIENTE%20NUEVO')).texto);
    assert.match(cartera, /U3 CLIENTE NUEVO SA DE CV/, 'el nombre legal nuevo le llega por su propia pantalla');

    // Y en cuanto ese nombre CAMBIA, el aviso sale: es el hecho que el aviso
    // existe para detectar.
    const c = await corregirPropio(ventas, id, { razon_social: 'U3 CLIENTE NUEVO SA' }, 'Me equivoqué al teclearla.');
    assert.equal(c.status, 200, c.texto);
    assert.equal((await avisosDe(juridico)).sinLeer, antes + 1, 'un cambio del nombre legal sí se avisa');
  });

  test('U3.2 el motivo automático no afirma de qué pantalla vino', async () => {
    // El renglón se puede generar con una petición HTTP pelada, así que decir
    // «desde el panel de captura del alta» es afirmar algo que nadie comprobó, en
    // el registro cuyo trabajo es explicar los cambios al nombre legal.
    const id = await abrirId(operaciones, 'U3 MOTIVO');
    assert.equal((await completar(operaciones, id, { razon_social: 'U3 MAL SA' })).status, 200);
    assert.equal((await corregirPropio(operaciones, id, { razon_social: 'U3 BIEN SA' })).status, 200);

    const motivo = conLaBase((db) =>
      db.prepare('SELECT motivo FROM correcciones WHERE servicio_id = ? ORDER BY id DESC LIMIT 1').get(id)
    ).motivo;
    assert.match(motivo, /mismo día/, motivo);
    assert.match(motivo, /capturó el dato/, motivo);
    assert.doesNotMatch(motivo, /panel|pantalla|ficha/i, `afirma una procedencia que no sabe: «${motivo}»`);

    // Y el historial de precios, por lo mismo.
    const precio = await abrirId(ventas, 'U3 MOTIVO PRECIO');
    assert.equal((await completar(ventas, precio, { precio_guardia: 900 })).status, 200);
    assert.equal((await corregirPropio(ventas, precio, { precio_guardia: 800 })).status, 200);
    const historial = conLaBase((db) =>
      db.prepare('SELECT motivo FROM precios_historial WHERE servicio_id = ? ORDER BY id').all(precio)
    ).map((f) => f.motivo);
    assert.equal(historial.length, 2, JSON.stringify(historial));
    for (const m of historial) {
      assert.doesNotMatch(m, /panel|pantalla/i, `afirma una procedencia que no sabe: «${m}»`);
    }
  });
});

// ------------------------------------------------------------------- U5

describe('U5 · la quinta puerta: el libro de facturas', () => {
  /**
   * El libro de facturas es otra tabla y otro módulo, y tenía su propio lector
   * de números —`Number(v)` dentro de `importeValido()`—, o sea exactamente el
   * defecto de diseño que este ciclo viene a cerrar: endurecer las cuatro puertas
   * del estado de fuerza y dejar la quinta abierta.
   *
   * Y estaba al revés, que es lo que lo hacía peor: medido contra el servidor
   * antes de arreglarlo, `importe: '0x10'` registraba una factura de 16 pesos con
   * un 201, `'1e3'` una de mil y `'7e-3'` una de un centavo; en cambio
   * `'1,234.56'` y `'$7,000'` —lo que una persona teclea copiando de una
   * propuesta— se rechazaban. Tolerante con lo que nadie escribe y estricto con
   * lo que todos escriben, en la tabla del dinero.
   */
  let servicioId;
  before(async () => {
    servicioId = await abrirId(admin, 'U5 FACTURAS');
    assert.equal(
      (await editar(admin, servicioId, { esquema_facturacion: 'MES_VENCIDO', dias_credito: 30 })).status,
      200
    );
  });

  const facturar = (cuerpo) =>
    admin.pedir('/api/facturas', { method: 'POST', body: JSON.stringify({ servicio_id: servicioId, ...cuerpo }) });
  const facturasDe = async () =>
    (await admin.pedir(`/api/facturas?servicio_id=${servicioId}`)).json.facturas;

  test('U5.1 el importe de una factura pasa por el único sitio', async () => {
    let mes = 0;
    const siguienteMes = () => `2027-${String((mes += 1)).padStart(2, '0')}`;

    for (const crudo of ['0x10', '1e3', '7e-3', '+8000', '1,2,3', ['16'], {}, true]) {
      const periodo = siguienteMes();
      const r = await facturar({ periodo, fecha_factura: `${periodo}-15`, importe: crudo, guardias: 2 });
      assert.equal(r.status, 400, `importe ${JSON.stringify(crudo)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    assert.equal((await facturasDe()).length, 0, 'ninguna de esas se registró');

    // Y lo que una persona teclea de verdad entra, que antes NO entraba.
    for (const [crudo, esperado] of [
      ['1,234.56', 1234.56],
      ['$7,000', 7000],
      ['  9500  ', 9500],
    ]) {
      const periodo = siguienteMes();
      const r = await facturar({ periodo, fecha_factura: `${periodo}-15`, importe: crudo, guardias: 2 });
      assert.equal(r.status, 201, `importe «${crudo}» → ${r.status} ${r.texto.slice(0, 160)}`);
      const f = (await facturasDe()).find((x) => x.periodo === periodo);
      assert.equal(f.importe, esperado, `«${crudo}»`);
    }
  });

  test('U5.2 los guardias facturados, el plazo y la fecha, por el mismo sitio', async () => {
    const base = { periodo: '2027-11', fecha_factura: '2027-11-15', importe: 1000 };
    for (const guardias of ['0x10', '1e3', ['3'], -3]) {
      const r = await facturar({ ...base, guardias });
      assert.equal(r.status, 400, `guardias ${JSON.stringify(guardias)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    // El negativo sigue diciendo lo que decía, que es lo que la prueba de
    // conciliación exige: un mensaje nuevo no puede desdecir a uno que ya vive.
    const negativo = await facturar({ ...base, guardias: -3 });
    assert.match(negativo.json.error, /mayor o igual a cero/);

    for (const dias of ['0x10', 4000, -1]) {
      const r = await facturar({ ...base, guardias: 2, dias_credito: dias });
      assert.equal(r.status, 400, `dias_credito ${JSON.stringify(dias)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    for (const fecha of ['15/11/2027', '2027-02-31', 'el martes']) {
      const r = await facturar({ ...base, fecha_factura: fecha, guardias: 2 });
      assert.equal(r.status, 400, `fecha ${JSON.stringify(fecha)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }

    const bien = await facturar({ ...base, guardias: '  2  ', dias_credito: '30' });
    assert.equal(bien.status, 201, bien.texto);
  });

  test('U5.3 corregir una factura ya emitida, por el mismo sitio', async () => {
    const periodo = '2027-12';
    const alta = await facturar({ periodo, fecha_factura: `${periodo}-10`, importe: 5000, guardias: 2 });
    assert.equal(alta.status, 201, alta.texto);
    const id = alta.json.id;

    const corregir = (correccion) =>
      admin.pedir('/api/facturas', { method: 'PATCH', body: JSON.stringify({ id, correccion }) });

    for (const importe of ['0x10', '1e3', ['16']]) {
      const r = await corregir({ importe, motivo: 'El importe estaba mal.' });
      assert.equal(r.status, 400, `importe ${JSON.stringify(importe)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    assert.equal((await facturasDe()).find((f) => f.id === id).importe, 5000, 'nada de eso movió el importe');

    const r = await corregir({ importe: '1,234.56', motivo: 'El contrato dice otro importe.' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await facturasDe()).find((f) => f.id === id).importe, 1234.56);

    // El motivo también: `String({})` dejaba «[object Object]» como explicación.
    const raro = await corregir({ importe: 2000, motivo: { a: 1 } });
    assert.equal(raro.status, 400, raro.texto.slice(0, 160));
    assert.match(raro.json.error, /texto/);
  });
});

// ------------------------------------------------------------------- U4

describe('U4 · la pantalla dice lo que el servidor rechazó, también al llenar', () => {
  test('U4.1 el servidor devuelve «rechazados» en el llenado, no solo en la corrección', async () => {
    const id = await abrirId(operaciones, 'U4 RECHAZADOS');
    const r = await completar(operaciones, id, { direccion: 'Calle 1', estatus: 'BAJA', total_guardias: 99 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.rechazados.sort(), ['estatus', 'total_guardias']);
    assert.equal((await ficha(id)).estatus, 'ACTIVO', 'y no se escribió ninguno');
    assert.equal((await ficha(id)).total_guardias, 2);
  });

  test('U4.2 el panel lee «rechazados» en las dos funciones, no solo en una', async () => {
    /**
     * Se mira el código del componente y no el navegador: no hay con qué
     * manejarlo en esta corrida —no hay controlador de navegador entre las
     * dependencias del proyecto y no se puede añadir uno—, así que lo que se
     * vigila es la asimetría misma, que es lo que se arregló. `corregir()` ya lo
     * leía y `guardar()` no, así que una petición que el servidor rechazaba campo
     * por campo se contestaba con «0 datos capturados».
     */
    const fuente = fs.readFileSync(
      path.join(RAIZ, 'app', '(app)', 'estado-fuerza', '[id]', 'Completar.js'),
      'utf8'
    );
    const cuerpoDe = (nombre) => {
      const desde = fuente.indexOf(`async function ${nombre}(`);
      assert.notEqual(desde, -1, `el componente ya no tiene «${nombre}()»`);
      const resto = fuente.slice(desde);
      // Hasta la siguiente declaración de función, que es donde acaba.
      const hasta = resto.indexOf('\n  async function ', 1);
      return hasta === -1 ? resto.slice(0, resto.indexOf('\n  const aviso =')) : resto.slice(0, hasta);
    };
    for (const nombre of ['guardar', 'corregir']) {
      assert.match(cuerpoDe(nombre), /data\.rechazados/, `«${nombre}()» no lee lo que el servidor rechazó`);
    }
  });
});
