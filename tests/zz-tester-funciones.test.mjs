/**
 * Tester · la tanda de «las funciones del asistente»: tres correcciones y cuatro
 * funciones nuevas, atacadas contra los criterios de `.ciclo/plan-funciones.md`
 * y no contra lo que el reporte del coder dice que hizo.
 *
 * El hueco que esta tanda dejó abierto y que el propio coder declaró: su
 * guardián nuevo comprueba que la etiqueta de periodo VIAJE, no que sea VERDAD.
 * Si un texto promete «del periodo» y la consulta de debajo no filtra, pasa en
 * verde. Así que aquí la etiqueta se ataca por su verdad: cada consulta se corre
 * con DOS periodos distintos y se exige que lo que dice ser del periodo CAMBIE y
 * lo que dice ser global NO cambie; y cada cifra nueva se mide contra la pantalla
 * de la que la consulta es espejo, leyendo el HTML.
 *
 * Ninguna cifra está escrita a mano. Los periodos salen de los extremos del
 * histórico que declara la propia consulta; los importes, de lo que la plataforma
 * contestó al registrar una factura o al suspender un servicio; los cuadres, del
 * HTML de la pantalla espejo con el formateador de la propia plataforma. Una
 * cifra escrita aquí caduca y acusa al código de un error que está en la prueba.
 *
 * Las pruebas NO llaman al servicio externo: usan el doble que ya existe, así que
 * lo que se afirma son los bytes que habrían salido a la red.
 *
 * LAS ROJAS SON HALLAZGOS, no un archivo a medio escribir. Cada una lleva en su
 * nombre el número del hallazgo del reporte `.ciclo/tester-funciones.md`:
 *
 *   H1 Bloqueante · «cobranza.faltaPorFacturar» viaja con cuatro de sus cinco
 *      campos en nulo, y el mismo asistente contesta otra cosa para esos campos.
 *   H2 Bloqueante · el desglose por zona emite un grupo «SIN ZONA» cuyo número la
 *      pantalla espejo contesta en cero: el criterio de F1 (tercer camino) falla.
 *   H3 Alto · «estado_de_un_dia» afirma «exacto» y deja ficha de una cifra que el
 *      propio resultado marca fuera de alcance.
 *   H4 Medio · un mes que no existe viaja como el periodo de la respuesta, y la
 *      ficha lo afirma; el extremo de un rango sí lo rechaza con aviso.
 *   H5 Medio · el horizonte de un mes, pedido un día 31, corta en el mes que
 *      viene del que viene.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. Esto levanta la aplicación
 * COMPILADA, así que un cambio en `lib/` sin recompilar mide el código anterior.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD_TEMPORAL } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
// Los formateadores DE LA PLATAFORMA, para buscar en el HTML la cifra
// exactamente como la pinta la pantalla. Escribir el formato a mano sería
// adivinar cómo redondea, y la prueba se rompería el día que cambiara el formato
// en vez del dato.
import { formatCurrency, formatNumber } from '../lib/utils.js';

let app;
let doble;
let admin;

/** Los extremos del histórico, dichos por la propia consulta. */
let historico = {};
/** Un servicio cualquiera con el que sembrar, tomado de la plataforma. */
let servicios = [];
/** Las dos facturas sembradas, con el importe que la plataforma registró. */
const sembradas = [];

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/** React deja comentarios entre expresiones: se quitan para leer como una persona. */
const comoLaLeeUnaPersona = (texto) => texto.replace(/<!--[\s\S]*?-->/g, '');

/**
 * Corre una consulta por HTTP y devuelve lo que de verdad viajó hacia el modelo.
 *
 * Se mide lo que SALE y no lo que devuelve la función: el resultado completo va
 * en la siguiente petición a la red, y es ahí donde se ve una cifra rotulada con
 * el periodo equivocado o un campo que llegó en nulo.
 */
async function correr(nombre, args = {}, cliente = admin) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
  const r = await cliente.pedir('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ pregunta: `corre ${nombre}`, previas: [] }),
  });
  assert.equal(r.status, 200, `${nombre} ${JSON.stringify(args)} → ${r.status}: ${r.texto}`);

  const bloques = (doble.peticiones()[1]?.cuerpo?.messages || [])
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  assert.equal(bloques.length, 1, `${nombre}: no volvió exactamente un resultado`);
  assert.notEqual(bloques[0].is_error, true, `${nombre} falló: ${bloques[0].content}`);

  const fichas = eventos(r.texto).filter((e) => e.tipo === 'ficha');
  assert.equal(fichas.length, 1, `${nombre} no dejó ficha`);
  return { datos: JSON.parse(bloques[0].content).datos, ficha: fichas[0].ficha, bytes: bloques[0].content };
}

/** Lo mismo, pero sin exigir que la consulta haya salido bien. */
async function correrAunqueFalle(nombre, args = {}, cliente = admin) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
  const r = await cliente.pedir('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ pregunta: `corre ${nombre}`, previas: [] }),
  });
  if (r.status !== 200) return { estado: r.status, datos: null, rechazo: r.texto.slice(0, 300) };
  const bloques = (doble.peticiones()[1]?.cuerpo?.messages || [])
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  if (!bloques.length) return { estado: 200, datos: null, rechazo: 'no volvió resultado' };
  if (bloques[0].is_error) return { estado: 200, datos: null, rechazo: String(bloques[0].content) };
  return { estado: 200, datos: JSON.parse(bloques[0].content).datos, rechazo: null };
}

/** Un mes 'AAAA-MM' corrido N meses. */
function mesMas(mes, n) {
  const [anio, m] = mes.split('-').map(Number);
  const total = anio * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Suma una columna de una lista de renglones. */
const suma = (lista, columna) => lista.reduce((a, x) => a + (Number(x[columna]) || 0), 0);

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  // Los topes muy altos: este archivo corre muchas consultas y el tope de
  // veinticinco preguntas lo cortaría a media comprobación.
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '100000000' },
  });
  admin = await app.entrarYAsentar(ROLES.admin);

  historico = (await correr('movimientos', { todoElHistorico: true })).datos;
  servicios = (await correr('buscar_servicio', { texto: '' })).datos.servicios;
  assert.ok(servicios.length >= 4, 'no hay servicios con los que medir');

  // Dos facturas en dos meses distintos, por la API de facturación: la tabla
  // `facturas` llega vacía del sembrado y sin ellas «lo del periodo» y «lo de la
  // cartera» valdrían cero las dos y nada distinguiría un filtro que funciona.
  const base = historico.hayMovimientosHasta;
  for (let i = 0; i < 2; i += 1) {
    const periodo = i === 0 ? base : mesMas(base, -3);
    const importe = 98765.43 + i * 50000;
    const r = await admin.pedir('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        servicio_id: servicios[i].id,
        periodo,
        fecha_factura: `${periodo}-15`,
        importe,
        guardias: 1,
        dias_credito: 30,
      }),
    });
    assert.equal(r.status, 201, `no se pudo sembrar la factura de ${periodo}: ${r.texto}`);
    sembradas.push({ periodo, importe });
  }
  assert.notEqual(sembradas[0].periodo, sembradas[1].periodo, 'las dos facturas cayeron en el mismo mes');
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

// ═══════════════════════════════════════════════════════════════════════════════
// T1 · La VERDAD de la etiqueta, que es el hueco que la tanda declaró abierto
// ═══════════════════════════════════════════════════════════════════════════════

describe('T1 · la etiqueta de periodo no solo viaja: es verdad', () => {
  /**
   * El guardián que el coder no pudo escribir, y que es el que de verdad cierra
   * la clase.
   *
   * El suyo exige que CADA lista traiga un «qué cuenta» con una palabra de
   * alcance dentro. El mío no mira el texto: mira el COMPORTAMIENTO. Se corre la
   * consulta con dos periodos distintos y se parte el resultado en dos montones:
   *
   *   · lo que NO se movió tiene que DESMENTIR el periodo con palabras —«no son
   *     del periodo», «todos los tiempos», «de HOY», «toda la cartera»—, o es una
   *     cifra de otro alcance debajo de la etiqueta de este;
   *   · lo que PROMETE ser del periodo tiene que haberse movido, o ser cero las
   *     dos veces, que es la única forma honesta de no moverse.
   *
   * Se exentan las claves que declaran el periodo mismo y los extremos del
   * histórico: su trabajo es decir hasta dónde hay datos, y perseguirlas sería
   * perseguir la etiqueta en vez del dato.
   */
  const DESMIENTE =
    /no (son|es)( las| los)? del periodo|todos los tiempos|de cualquier periodo|de HOY|toda la cartera|sin importar el periodo|que hay en la base/i;
  const PROMETE = /del periodo|de ESE mes|de ese mes|del mes|del día|de ese día|dentro del periodo/i;

  /**
   * Las hojas del resultado, cada una con la etiqueta que le toca.
   *
   * La etiqueta se hereda del contenedor más cercano que tenga una, que es el
   * patrón con el que se arregló `cobranza` —un rótulo por grupo en vez de uno
   * por cifra— y con el que `motivosDeBaja` conserva la forma del Tablero.
   */
  function hojas(valor, ruta, etiqueta, acc) {
    if (Array.isArray(valor)) {
      acc.push({ ruta, valor: JSON.stringify(valor), etiqueta });
      return acc;
    }
    if (valor && typeof valor === 'object') {
      for (const [clave, dentro] of Object.entries(valor)) {
        if (clave.endsWith('QueCuenta') || clave.endsWith('Total')) continue;
        const propia = valor[`${clave}QueCuenta`];
        hojas(dentro, ruta ? `${ruta}.${clave}` : clave, typeof propia === 'string' ? propia : etiqueta, acc);
      }
      return acc;
    }
    acc.push({ ruta, valor: JSON.stringify(valor), etiqueta });
    return acc;
  }

  const esCero = (v) => v === '0' || v === '[]' || v === 'null' || v === 'false' || v === '""';

  async function medir(nombre, a, b, exentas) {
    const ra = await correr(nombre, a);
    const rb = await correr(nombre, b);
    const deA = hojas(ra.datos, '', null, []);
    const deB = new Map(hojas(rb.datos, '', null, []).map((x) => [x.ruta, x]));
    const quietasSinDesmentir = [];
    const prometenYNoSeMueven = [];
    let comparadas = 0;
    for (const x of deA) {
      if (exentas.some((e) => x.ruta === e || x.ruta.startsWith(`${e}.`))) continue;
      const y = deB.get(x.ruta);
      if (!y) continue;
      comparadas += 1;
      if (x.valor !== y.valor || esCero(x.valor)) continue;
      const et = x.etiqueta || '';
      if (!DESMIENTE.test(et)) {
        quietasSinDesmentir.push(`${nombre}:${x.ruta} = ${x.valor.slice(0, 60)} → «${et.slice(0, 110)}»`);
      }
      if (PROMETE.test(et) && !DESMIENTE.test(et)) {
        prometenYNoSeMueven.push(`${nombre}:${x.ruta} = ${x.valor.slice(0, 60)} → «${et.slice(0, 110)}»`);
      }
    }
    assert.ok(comparadas > 10, `${nombre}: solo se compararon ${comparadas} hojas, la medición no mide nada`);
    return { quietasSinDesmentir, prometenYNoSeMueven, ra, rb };
  }

  test('T1.1 «movimientos»: lo que no se mueve al cambiar de año lo dice con palabras', async () => {
    const primero = historico.hayMovimientosDesde.slice(0, 4);
    const ultimo = historico.hayMovimientosHasta.slice(0, 4);
    assert.notEqual(primero, ultimo, 'el histórico cabe en un año: la medición no distingue nada');
    const r = await medir(
      'movimientos',
      { desde: `${primero}-01`, hasta: `${primero}-12` },
      { desde: `${ultimo}-01`, hasta: `${ultimo}-12` },
      ['periodo', 'desde', 'hasta', 'mesesCubiertos', 'hayMovimientosDesde', 'hayMovimientosHasta', 'avisoDelPeriodo']
    );
    assert.deepEqual(
      r.prometenYNoSeMueven,
      [],
      `hay cifras que PROMETEN ser del periodo y no cambian al cambiar el periodo:\n${r.prometenYNoSeMueven.join('\n')}`
    );
    assert.deepEqual(
      r.quietasSinDesmentir,
      [],
      `hay cifras que no cambian con el periodo y no desmienten el periodo con palabras:\n${r.quietasSinDesmentir.join('\n')}`
    );
  });

  test('T1.2 «cobranza»: con dos meses sembrados, lo del mes se mueve y lo de la cartera no', async () => {
    const r = await medir(
      'cobranza',
      { periodo: sembradas[0].periodo },
      { periodo: sembradas[1].periodo },
      ['periodo']
    );
    // `delPeriodo.facturas` sale 1 las dos veces porque se sembró una factura en
    // cada mes: coincidencia, no defecto, y se demuestra que es coincidencia
    // mirando el importe, que sí se mueve.
    const soloElConteo = r.quietasSinDesmentir.every((q) => /delPeriodo\.facturas|yaFacturadosDelPeriodo/.test(q));
    assert.ok(
      soloElConteo,
      `hay cifras de «cobranza» quietas al cambiar de mes y sin desmentir el periodo:\n${r.quietasSinDesmentir.join('\n')}`
    );
    assert.notEqual(
      r.ra.datos.delPeriodo.emitido,
      r.rb.datos.delPeriodo.emitido,
      'lo emitido «del periodo» no se mueve al cambiar el periodo'
    );
    assert.equal(
      r.ra.datos.deTodaLaCartera.emitido,
      r.rb.datos.deTodaLaCartera.emitido,
      'lo emitido «de toda la cartera» se mueve con el periodo'
    );
    // Y que cada una es la que se cree, derivado de lo que registró la API.
    assert.equal(r.ra.datos.delPeriodo.emitido, sembradas[0].importe);
    assert.equal(r.rb.datos.delPeriodo.emitido, sembradas[1].importe);
    assert.equal(r.ra.datos.deTodaLaCartera.emitido, sembradas[0].importe + sembradas[1].importe);
  });

  test('T1.3 ROJA · HALLAZGO H3 (Alto) · «estado_de_un_dia» dice «exacto» de una fecha fuera de alcance', async () => {
    /**
     * La sexta de la clase, y la encontró esta medición.
     *
     * `estado_de_un_dia` es una de las siete y va rotulada con `dia`. Pedida una
     * fecha anterior a donde llega la reconstrucción, contesta una cifra que no
     * es la de ese día —se queda con los servicios cuya fecha de alta ya existía,
     * que son un puñado— y al mismo tiempo AFIRMA `exactitud.conjunto: "exacto"`,
     * que es una cadena escrita a mano y que no depende de la fecha.
     *
     * Y la ficha —el recuadro «De dónde salió esto», lo único del canal que el
     * modelo no puede escribir y que existe para ser la prueba de que el número
     * es real— dice «Guardias el AAAA-MM-DD: N» sin una palabra de que la cifra
     * se queda corta. `fueraDeAlcance: true` viaja en los datos, así que no es
     * «sin avisar» y por eso no es Bloqueante; lo que sí es, es que dos etiquetas
     * del mismo resultado se contradicen y la que avala la cifra es la que calla.
     */
    const fuera = await correr('estado_de_un_dia', { dia: `${historico.hayMovimientosDesde}-15` });
    const dentro = await correr('estado_de_un_dia', { dia: `${historico.hayMovimientosHasta}-15` });

    assert.equal(fuera.datos.fueraDeAlcance, true, 'esa fecha no cae fuera de alcance: la medición no mide nada');
    assert.equal(dentro.datos.fueraDeAlcance, false, 'la fecha de control también cae fuera: no hay con qué comparar');
    assert.ok(
      fuera.datos.guardiasEnLaCalleEseDia < dentro.datos.guardiasEnLaCalleEseDia,
      'las dos fechas dan lo mismo: la medición no distingue la reconstrucción corta'
    );

    // Lo que falla: «exacto» para las dos, y una ficha sin aviso para la corta.
    assert.notEqual(
      fuera.datos.exactitud.conjunto,
      dentro.datos.exactitud.conjunto,
      `«exactitud.conjunto» dice «${fuera.datos.exactitud.conjunto}» tanto de ${fuera.datos.dia} —que el propio ` +
        `resultado marca fueraDeAlcance y de la que solo pudo reconstruir ${fuera.datos.serviciosEnLaCalleEseDia} ` +
        `servicios de los ${dentro.datos.serviciosEnLaCalleEseDia} que hay— como de ${dentro.datos.dia}. Es una ` +
        'cadena escrita a mano que no depende de la fecha, y contradice a «fueraDeAlcance» en el mismo resultado'
    );
    assert.match(
      `${fuera.ficha.dato} ${fuera.ficha.valor}`,
      /corto|fuera de alcance|reconstrucci|no es de fiar/i,
      `la ficha de una fecha fuera de alcance dice «${fuera.ficha.dato}: ${fuera.ficha.valor}» y nada más. El ` +
        'recuadro que existe para avalar la cifra avala una cifra que el propio resultado declara corta'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2 · C1 · cobranza contra su pantalla, y el renglón que viaja en nulos
// ═══════════════════════════════════════════════════════════════════════════════

describe('T2 · C1 · cobranza: las dos cifras y los renglones que viajan', () => {
  test('T2.1 los nombres planos de antes no están, y las dos cifras cuadran con la pantalla', async () => {
    const mes = sembradas[0].periodo;
    const { datos } = await correr('cobranza', { periodo: mes });
    for (const clave of ['emitido', 'cobrado', 'carteraVencida', 'porVencer', 'pendienteTotal']) {
      assert.ok(!Object.hasOwn(datos, clave), `«${clave}» sigue suelto en el primer nivel`);
    }
    const html = comoLaLeeUnaPersona((await admin.pedir(`/cobranza?periodo=${mes}`)).texto);
    const delMes = formatCurrency(datos.delPeriodo.emitido);
    const deLaCartera = formatCurrency(datos.deTodaLaCartera.emitido);
    assert.notEqual(delMes, deLaCartera, 'las dos cifras se pintan igual: la comprobación no distingue');
    assert.ok(html.includes(delMes), `la pantalla de Cobranza de ${mes} no pinta ${delMes}`);
    assert.ok(html.includes(deLaCartera), `la pantalla de Cobranza no pinta ${deLaCartera}`);
  });

  test('T2.2 ROJA · HALLAZGO H1 (Bloqueante) · «faltaPorFacturar» viaja en nulos y el asistente se contradice', async () => {
    /**
     * El fallo silencioso de esta tanda, y toca dinero.
     *
     * El §6.7 del plan dejó esta lista fuera de alcance con una afirmación: «las
     * dos listas se quedan donde están, cada una ya dice qué cuenta». No está
     * bien. El recorte pide `['id','servicio','total_guardias','importe_factura',
     * 'esquema_facturacion']` y los renglones de `pendientesDeFacturar()` se
     * llaman `servicio_id`, `plantilla` e `importe`. `saneado(undefined)` devuelve
     * nulo, así que CUATRO de los cinco campos de cada renglón salen en nulo —el
     * id entre ellos— y nada en el resultado dice que falte algo.
     *
     * Por qué es Bloqueante y no una molestia:
     *
     *   · el MISMO asistente, preguntado por `ficha_de_servicio` del mismo
     *     servicio, contesta un `importe_factura` y un `total_guardias` de verdad.
     *     Dos respuestas contradictorias para el mismo campo, y una es falsa.
     *   · la pantalla de Cobranza —su espejo, y lo que el «qué cuenta» invoca—
     *     pinta ese importe en el renglón. El asistente dice nulo donde la
     *     pantalla dice una cifra.
     *   · sin `id` el modelo no puede encadenar a la ficha ni armar un enlace, y
     *     la única salida que le queda es describir la lista como si esos
     *     servicios no tuvieran importe capturado.
     */
    const mes = sembradas[0].periodo;
    const { datos } = await correr('cobranza', { periodo: mes });
    assert.ok(datos.faltaPorFacturar.length > 0, `${mes} no trae pendientes: la medición no mide nada`);

    // Se busca el mismo servicio por su nombre y se le pide la ficha: ese es el
    // segundo camino, y es el que demuestra que el nulo es falso y no un hueco
    // de la base.
    const renglon = datos.faltaPorFacturar[0];
    const encontrado = (await correr('buscar_servicio', { texto: renglon.servicio })).datos.servicios[0];
    assert.ok(encontrado, `«${renglon.servicio}» no se encuentra por nombre: cambiar de testigo`);
    const ficha = (await correr('ficha_de_servicio', { id: encontrado.id })).datos;
    assert.ok(
      Number(ficha.importe_factura) > 0 && Number(ficha.total_guardias) > 0,
      `«${renglon.servicio}» no trae importe ni plantilla en su ficha: cambiar de testigo`
    );

    const enNulo = Object.entries(renglon)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    assert.deepEqual(
      enNulo,
      [],
      `el renglón de «${renglon.servicio}» en «faltaPorFacturar» viaja con ${enNulo.length} de sus ` +
        `${Object.keys(renglon).length} campos en nulo (${enNulo.join(', ')}), y la ficha del mismo servicio ` +
        `—id ${encontrado.id}— contesta total_guardias ${ficha.total_guardias} e importe_factura ` +
        `${ficha.importe_factura}. El asistente se contradice y nada en el resultado avisa`
    );
  });

  test('T2.3 lo que la pantalla de Cobranza sí pinta de ese renglón, para que conste el espejo', async () => {
    // La otra mitad del hallazgo H1: la cifra que el asistente manda en nulo es
    // la que la pantalla espejo pinta con su etiqueta.
    const mes = sembradas[0].periodo;
    const { datos } = await correr('cobranza', { periodo: mes });
    const renglon = datos.faltaPorFacturar[0];
    const encontrado = (await correr('buscar_servicio', { texto: renglon.servicio })).datos.servicios[0];
    const ficha = (await correr('ficha_de_servicio', { id: encontrado.id })).datos;
    const html = comoLaLeeUnaPersona((await admin.pedir(`/cobranza?periodo=${mes}`)).texto);
    assert.ok(
      html.includes(formatCurrency(ficha.importe_factura)),
      `la pantalla de Cobranza de ${mes} no pinta ${formatCurrency(ficha.importe_factura)}: sin eso el espejo ` +
        'de este renglón no se puede afirmar'
    );
  });

  test('T2.4 la cuarta y la quinta del defecto siguen desmentidas al cambiar de mes', async () => {
    const a = await correr('cobranza', { periodo: sembradas[0].periodo });
    const b = await correr('cobranza', { periodo: sembradas[1].periodo });
    assert.equal(a.datos.facturasVencidasDetalleTotal, b.datos.facturasVencidasDetalleTotal);
    assert.match(a.datos.facturasVencidasDetalleQueCuenta, /NO son las del periodo/i);
    assert.equal(a.datos.sinCondicionesDeCobro, b.datos.sinCondicionesDeCobro);
    assert.match(a.datos.sinCondicionesDeCobroQueCuenta, /no son del periodo/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T3 · C2 y C3 contra sus pantallas
// ═══════════════════════════════════════════════════════════════════════════════

describe('T3 · C2 y C3 · una sola tabla de meses, y los motivos del periodo', () => {
  test('T3.1 ninguna clave «porPeriodo», y ningún mes ni ninguna FECHA fuera del rango', async () => {
    /**
     * El barrido de C2 persigue cadenas con forma AAAA-MM. Los renglones de
     * `ultimasAltas` y `ultimasBajas` traen `fecha`, que es AAAA-MM-DD y por tanto
     * se le escapa. Aquí se persiguen las dos formas, en todo el resultado.
     */
    const anio = historico.hayMovimientosDesde.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    assert.deepEqual(
      Object.keys(datos).filter((k) => k.startsWith('porPeriodo')),
      [],
      'siguen viajando dos tablas de meses en la misma respuesta'
    );

    const fuera = [];
    const recorrer = (valor, ruta) => {
      if (Array.isArray(valor)) return valor.forEach((v, i) => recorrer(v, `${ruta}[${i}]`));
      if (valor && typeof valor === 'object') {
        return Object.entries(valor).forEach(([k, v]) => {
          const declara = valor[`${k}QueCuenta`];
          if (typeof declara === 'string' && /no (son|es) (las )?del periodo/i.test(declara)) return;
          recorrer(v, ruta ? `${ruta}.${k}` : k);
        });
      }
      if (typeof valor !== 'string') return;
      const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(valor)
        ? valor
        : /^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(valor)
          ? valor.slice(0, 7)
          : null;
      if (mes && (mes < datos.desde || mes > datos.hasta)) fuera.push(`${ruta} = ${valor}`);
    };
    const { desde, hasta, hayMovimientosDesde, hayMovimientosHasta, periodo, ...resto } = datos;
    recorrer(resto, '');
    assert.deepEqual(
      fuera,
      [],
      `pedido ${datos.desde}–${datos.hasta}, viajan meses o fechas de otro periodo:\n${fuera.join('\n')}`
    );
  });

  test('T3.2 los motivos del periodo cambian con el periodo y los pinta la pantalla de Cancelaciones', async () => {
    // El mes con más bajas, derivado del propio histórico.
    const conBajas = historico.porMesDelPeriodo
      .filter((m) => m.movimientosDeBaja > 0)
      .sort((a, b) => b.guardiasQueSalieron - a.guardiasQueSalieron)[0];
    assert.ok(conBajas, 'no hay ni un mes con bajas');
    const mes = conBajas.periodo;

    const unMes = await correr('movimientos', { desde: mes, hasta: mes });
    const todo = await correr('movimientos', { todoElHistorico: true });
    assert.notDeepEqual(
      unMes.datos.motivosDelPeriodo,
      todo.datos.motivosDelPeriodo,
      'los motivos «del periodo» son los mismos para un mes y para todo el histórico'
    );
    assert.equal(unMes.datos.motivosDelPeriodoTotal, unMes.datos.motivosDelPeriodo.length, `${mes}: lista recortada`);

    const html = comoLaLeeUnaPersona((await admin.pedir(`/cancelaciones?periodo=${mes}`)).texto);
    const comoEnPantalla = (t) =>
      t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    for (const m of unMes.datos.motivosDelPeriodo) {
      assert.ok(
        html.includes(comoEnPantalla(m.motivo)),
        `el asistente dice que en ${mes} hubo bajas por «${m.motivo}» y la pantalla de ese mes no lo pinta`
      );
    }
  });

  test('T3.3 la suma de los motivos del periodo más las sin motivo no pasa de las bajas del periodo', async () => {
    const anio = historico.hayMovimientosHasta.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    assert.equal(datos.motivosDelPeriodoTotal, datos.motivosDelPeriodo.length, 'la lista viene recortada');
    assert.ok(
      suma(datos.motivosDelPeriodo, 'guardias') <= datos.bajas.guardias,
      `los motivos suman ${suma(datos.motivosDelPeriodo, 'guardias')} y las bajas del periodo son ${datos.bajas.guardias}`
    );
    assert.ok(
      suma(datos.motivosDelPeriodo, 'movimientos') + datos.bajasDelPeriodoSinMotivo === datos.bajas.movimientos,
      `los movimientos con motivo (${suma(datos.motivosDelPeriodo, 'movimientos')}) más los sin motivo ` +
        `(${datos.bajasDelPeriodoSinMotivo}) no son las bajas del periodo (${datos.bajas.movimientos})`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T4 · F1 · zona y asesor dentro del rango
// ═══════════════════════════════════════════════════════════════════════════════

describe('T4 · F1 · el desglose por zona y por asesor', () => {
  test('T4.1 cuando la lista viene completa, el desglose suma EXACTAMENTE las altas y las bajas', async () => {
    /**
     * Se recorren todos los años del histórico y se mide solo donde la lista
     * viene completa: sumar una lista recortada no puede dar el total, y exigirlo
     * ahí acusaría al código de un error que estaría en la prueba.
     */
    let aniosMedidos = 0;
    const primero = Number(historico.hayMovimientosDesde.slice(0, 4));
    const ultimo = Number(historico.hayMovimientosHasta.slice(0, 4));
    for (let anio = primero; anio <= ultimo; anio += 1) {
      const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
      for (const cual of ['porZonaDelPeriodo', 'porAsesorDelPeriodo']) {
        if (datos[`${cual}Total`] !== datos[cual].length) continue;
        if (datos[cual].length === 0) continue;
        aniosMedidos += 1;
        assert.equal(suma(datos[cual], 'altasGuardias'), datos.altas.guardias, `${anio} ${cual}: altas en guardias`);
        assert.equal(suma(datos[cual], 'bajasGuardias'), datos.bajas.guardias, `${anio} ${cual}: bajas en guardias`);
        assert.equal(
          suma(datos[cual], 'altasMovimientos'),
          datos.altas.movimientos,
          `${anio} ${cual}: altas en movimientos`
        );
        assert.equal(
          suma(datos[cual], 'bajasMovimientos'),
          datos.bajas.movimientos,
          `${anio} ${cual}: bajas en movimientos`
        );
        assert.equal(suma(datos[cual], 'neto'), datos.netoDeGuardias, `${anio} ${cual}: el neto`);
      }
    }
    assert.ok(aniosMedidos >= 3, `solo se pudieron medir ${aniosMedidos} desgloses completos`);
  });

  test('T4.2 cuando la lista viene recortada, suma MENOS y el total dice cuántas hay', async () => {
    const { datos } = await correr('movimientos', { todoElHistorico: true });
    let recortadas = 0;
    for (const cual of ['porZonaDelPeriodo', 'porAsesorDelPeriodo']) {
      if (datos[`${cual}Total`] === datos[cual].length) continue;
      recortadas += 1;
      assert.ok(datos[`${cual}Total`] > datos[cual].length, `${cual}: el total no es mayor que los renglones`);
      /**
       * Recortada, la lista NO puede sumar los cuatro conceptos.
       *
       * No se exige que falten bajas en concreto: la lista va ordenada por
       * `bajasGuardias DESC`, así que los renglones que se caen son justo los que
       * tienen cero bajas y la columna de bajas puede seguir sumando el total. Lo
       * que no puede pasar es que sumen TODOS los conceptos: alguno tiene que
       * quedarse corto, porque se perdieron renglones de verdad.
       */
      const cuadranTodos = ['altasGuardias', 'bajasGuardias', 'altasMovimientos', 'bajasMovimientos'].every(
        (c) =>
          suma(datos[cual], c) ===
          (c.startsWith('altas') ? datos.altas : datos.bajas)[c.endsWith('Guardias') ? 'guardias' : 'movimientos']
      );
      assert.ok(!cuadranTodos, `${cual}: la lista viene recortada y aun así cuadran los cuatro conceptos`);
      assert.match(datos[`${cual}QueCuenta`], /trae \d+ de \d+/, `${cual}: el aviso de recorte no viaja`);
    }
    assert.ok(recortadas > 0, 'ningún desglose viene recortado con todo el histórico: no se mide el recorte');
  });

  test('T4.3 ROJA · HALLAZGO H2 (Bloqueante) · «SIN ZONA» no se puede comprobar en la pantalla espejo', async () => {
    /**
     * El criterio de aceptación de F1, al pie de la letra: «Medido contra un
     * tercer camino que no comparte código: pedir el mismo rango con el filtro
     * `zona` de la pantalla de Aperturas da el mismo número para esa zona».
     *
     * Se cumple para TODA zona de verdad —medido abajo, zona por zona— y NO se
     * cumple para el grupo `SIN ZONA`, que no es una zona de la base: lo inventa
     * el `COALESCE(NULLIF(TRIM(m.zona), ''), 'SIN ZONA')` de `AGRUPABLES` para los
     * movimientos que no traen zona capturada. La pantalla filtra por `m.zona = ?`
     * con el texto literal, así que ese filtro no casa con ninguno de esos
     * renglones y la pantalla contesta cero.
     *
     * Por qué es Bloqueante y no cosmético: el asistente afirma un renglón del
     * desglose con nombre, movimientos y guardias, y la pantalla de la que dice
     * ser espejo contesta otra cosa para el mismo nombre. El equipo ve los dos y
     * no sabe cuál creer, que es exactamente el defecto que esta plataforma lleva
     * meses cerrando. Y no es un caso raro: en el mes medido es el segundo grupo
     * por guardias de alta.
     */
    // El mes en que el grupo «SIN ZONA» se lleva más guardias de alta, derivado
    // del propio histórico: así la medición se hace donde más pesa el defecto.
    let mejor = null;
    for (const m of historico.porMesDelPeriodo) {
      const r = await correr('movimientos', { periodo: m.periodo });
      const z = r.datos.porZonaDelPeriodo.find((x) => x.clave === 'SIN ZONA');
      if (z && z.altasGuardias > 0 && (!mejor || z.altasGuardias > mejor.sinZona.altasGuardias)) {
        mejor = { mes: m.periodo, zonas: r.datos.porZonaDelPeriodo, sinZona: z };
      }
    }
    assert.ok(mejor, 'ningún mes trae el grupo «SIN ZONA» con guardias de alta: la medición no mide nada');
    const sinZona = mejor.sinZona;

    const html = comoLaLeeUnaPersona(
      (await admin.pedir(`/aperturas?periodo=${mejor.mes}&zona=${encodeURIComponent(sinZona.clave)}`)).texto
    );
    assert.ok(
      html.includes(`+${formatNumber(sinZona.altasGuardias)}`),
      `el asistente dice que en ${mejor.mes} la zona «${sinZona.clave}» tuvo ${sinZona.altasGuardias} guardias de ` +
        `alta en ${sinZona.altasMovimientos} movimientos, y la pantalla de Aperturas con ese mismo filtro de zona ` +
        'pinta +0 y «no hay movimientos». La consulta emite un grupo que la pantalla espejo no sabe filtrar'
    );
  });

  test('T4.4 toda zona DE VERDAD cuadra con Aperturas y con Cancelaciones, renglón por renglón', async () => {
    // El tercer camino que el criterio de F1 pide, pasado por todas las zonas
    // reales del mes: la pantalla suma recorriendo renglones en JavaScript y la
    // consulta con un SUM, así que no comparten código.
    let mejor = null;
    for (const m of historico.porMesDelPeriodo) {
      const r = await correr('movimientos', { periodo: m.periodo });
      if (!mejor || r.datos.porZonaDelPeriodo.length > mejor.zonas.length) {
        mejor = { mes: m.periodo, zonas: r.datos.porZonaDelPeriodo };
      }
      if (mejor.zonas.length >= 6) break;
    }
    const reales = mejor.zonas.filter((z) => z.clave !== 'SIN ZONA');
    assert.ok(reales.length >= 3, `solo hay ${reales.length} zonas reales en ${mejor.mes}`);
    for (const z of reales) {
      const aperturas = comoLaLeeUnaPersona(
        (await admin.pedir(`/aperturas?periodo=${mejor.mes}&zona=${encodeURIComponent(z.clave)}`)).texto
      );
      const cancelaciones = comoLaLeeUnaPersona(
        (await admin.pedir(`/cancelaciones?periodo=${mejor.mes}&zona=${encodeURIComponent(z.clave)}`)).texto
      );
      assert.ok(
        aperturas.includes(`+${formatNumber(z.altasGuardias)}`),
        `${mejor.mes} · ${z.clave}: el asistente dice +${z.altasGuardias} y Aperturas no lo pinta`
      );
      assert.ok(
        cancelaciones.includes(`−${formatNumber(z.bajasGuardias)}`),
        `${mejor.mes} · ${z.clave}: el asistente dice −${z.bajasGuardias} y Cancelaciones no lo pinta`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T5 · Las dos clases de asesor
// ═══════════════════════════════════════════════════════════════════════════════

describe('T5 · las dos clases de asesor no se cruzaron', () => {
  test('T5.1 cada una dice cuál es, y no dan lo mismo donde no deben', async () => {
    const mov = (await correr('movimientos', { todoElHistorico: true })).datos;
    const res = (await correr('resumen_operacion', {})).datos;

    // Que no se cruzaron de nombre: `movimientos` no estrena `porAsesor`.
    assert.ok(
      !Object.hasOwn(mov, 'porAsesor'),
      '«movimientos» estrenó la clave «porAsesor», que es la de «quién atiende más»'
    );
    assert.ok(!Object.hasOwn(res, 'porAsesorDelPeriodo'), '«resumen_operacion» estrenó la clave del otro desglose');

    // Que cada una dice qué cuenta y manda a la otra.
    assert.match(mov.porAsesorDelPeriodoQueCuenta, /asesor anotado en el movimiento/i);
    assert.match(mov.porAsesorDelPeriodoQueCuenta, /porAsesor/);
    assert.match(res.porAsesorQueCuenta, /de HOY/i);
    assert.match(res.porAsesorQueCuenta, /porAsesorDelPeriodo/);

    // Que de verdad son dos preguntas distintas: el reparto no coincide.
    const deMovimientos = mov.porAsesorDelPeriodo.map((a) => a.clave);
    const deHoy = res.porAsesor.map((a) => a.asesor);
    assert.notDeepEqual(
      deMovimientos.slice(0, 5),
      deHoy.slice(0, 5),
      'los cinco primeros de los dos desgloses son los mismos y en el mismo orden: o los datos lo quieren ' +
        'así, o las dos consultas están contestando la misma pregunta con dos nombres'
    );
    assert.ok(
      mov.porAsesorDelPeriodoTotal !== res.porAsesorTotal,
      `los dos cuentan ${res.porAsesorTotal} asesores: si siempre coinciden, una de las dos no está mirando ` +
        'lo que dice mirar'
    );
  });

  test('T5.2 «porAsesor» coincide uno a uno y en su orden con lo que pinta el Tablero', async () => {
    const res = (await correr('resumen_operacion', {})).datos;
    const html = comoLaLeeUnaPersona((await admin.pedir('/')).texto);
    const enPantalla = [
      ...html.matchAll(
        /truncate max-w-\[140px\]">([^<]*)<\/td><td class="py-1\.5 text-right text-slate-400">(\d+)<\/td><td class="py-1\.5 text-right text-white">([\d,]+)<\/td>/g
      ),
    ].map((m) => ({ asesor: m[1], servicios: Number(m[2]), guardias: Number(m[3].replace(/,/g, '')) }));
    assert.ok(enPantalla.length >= 5, `el Tablero solo pintó ${enPantalla.length} asesores: no hay con qué cuadrar`);

    // La pantalla enseña los primeros; el asistente manda todos los que caben.
    // Se comparan los que la pantalla sí pinta, uno a uno y en su orden.
    for (let i = 0; i < enPantalla.length; i += 1) {
      assert.deepEqual(
        { asesor: res.porAsesor[i].asesor, servicios: res.porAsesor[i].servicios, guardias: res.porAsesor[i].guardias },
        enPantalla[i],
        `el renglón ${i + 1} de «Asesores por guardias» no es el mismo en el Tablero y en el asistente`
      );
    }
    // Y la cifra suelta que explica que la columna pueda sumar más que la
    // operación viaja, porque `conSuTotal` la perdería al mapear los renglones.
    assert.ok(Number.isInteger(res.asesoresCompartidos), '«asesoresCompartidos» no viaja');
    assert.ok(res.porAsesorTotal >= res.porAsesor.length, 'el total de asesores es menor que los renglones');
  });

  test('T5.3 el total de asesores es el de un camino propio que no comparte código', async () => {
    const res = (await correr('resumen_operacion', {})).datos;
    const activos = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    const distintos = new Set();
    for (const s of activos) {
      let lista = [];
      try {
        lista = JSON.parse(s.asesores_json || '[]');
      } catch {
        lista = [];
      }
      if (!lista.length) lista = [String(s.asesor || '').trim() || 'SIN ASESOR'];
      for (const n of lista) distintos.add(n || 'SIN ASESOR');
    }
    assert.equal(
      res.porAsesorTotal,
      distintos.size,
      `el asistente dice ${res.porAsesorTotal} asesores y la lista completa de servicios activos trae ` +
        `${distintos.size} distintos`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T6 · F2 · estatus y agregados contra Estado de fuerza
// ═══════════════════════════════════════════════════════════════════════════════

describe('T6 · F2 · el estatus y el valor de lo que se encontró', () => {
  /** El renglón de arriba de Estado de fuerza, leído del HTML. */
  async function renglonDeArriba(consulta) {
    const html = comoLaLeeUnaPersona((await admin.pedir(`/estado-fuerza${consulta}`)).texto);
    const m = html.match(/([\d,]+) servicios · ([\d,]+) guardias · ([^<]+) facturación/);
    assert.ok(m, `la pantalla de Estado de fuerza${consulta} no pinta su renglón de arriba`);
    return { servicios: m[1], guardias: m[2], importe: m[3] };
  }

  test('T6.1 un estatus que no se entiende cae en ACTIVO y no en una búsqueda más ancha', async () => {
    const base = await correr('buscar_servicio', { texto: '' });
    for (const estatus of ['OTRO', '', "ACTIVO' OR 1=1 --", 'SELECT * FROM servicios', 123, null, 'añó', '🙂']) {
      const r = await correr('buscar_servicio', { texto: '', estatus });
      assert.equal(
        r.datos.encontrados,
        base.datos.encontrados,
        `con estatus ${JSON.stringify(estatus)} se encontraron ${r.datos.encontrados} y con el de siempre ` +
          `${base.datos.encontrados}: un texto de fuera abrió la búsqueda`
      );
      assert.ok(
        r.datos.buscadoSoloEntre.includes('ACTIVO'),
        `con estatus ${JSON.stringify(estatus)} el resultado dice «${r.datos.buscadoSoloEntre}»`
      );
      // Y el texto de fuera no viaja dentro del resultado ni de la ficha.
      if (typeof estatus === 'string' && estatus.trim()) {
        assert.ok(!JSON.stringify(r.datos).includes(estatus), `el texto de fuera «${estatus}» viajó en el resultado`);
        assert.ok(!JSON.stringify(r.ficha).includes(estatus), `el texto de fuera «${estatus}» viajó en la ficha`);
      }
    }
    /**
     * El único caso que la coerción de JavaScript sí deja pasar, medido aparte
     * para que quede dicho y no tapado: una LISTA de un elemento se colapsa a su
     * texto —`String(['TODOS'])` es `'TODOS'`— y abre la búsqueda. No se cuenta
     * como hallazgo porque el esquema de la consulta declara `type: 'string'` con
     * `strict: true`, así que el servicio externo no puede mandar una lista; pero
     * la lista cerrada se come la coerción y conviene saberlo.
     */
    const lista = await correr('buscar_servicio', { texto: '', estatus: ['TODOS'] });
    assert.ok(
      lista.datos.buscadoSoloEntre.includes('cualquier estatus'),
      `una lista de un elemento no se colapsó como se midió: «${lista.datos.buscadoSoloEntre}»`
    );
  });

  test('T6.2 un suspendido desde la pantalla de operaciones: no aparece entre los activos y sí con su estatus', async () => {
    const victima = servicios[3];
    const r = await admin.pedir(`/api/servicios/${victima.id}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Prueba del tester: suspensión temporal', desde: `${sembradas[0].periodo}-01` }),
    });
    assert.equal(r.status, 200, `no se pudo suspender por el camino de la vida real: ${r.texto}`);

    const entreActivos = await correr('buscar_servicio', { texto: victima.servicio });
    assert.equal(entreActivos.datos.encontrados, 0, 'el suspendido sigue apareciendo entre los activos');
    assert.ok(entreActivos.datos.buscadoSoloEntre.includes('ACTIVO'), entreActivos.datos.buscadoSoloEntre);

    const conEstatus = await correr('buscar_servicio', { texto: victima.servicio, estatus: 'SUSPENDIDO' });
    assert.equal(conEstatus.datos.encontrados, 1, 'con estatus SUSPENDIDO no lo encuentra');
    assert.deepEqual(conEstatus.datos.servicios.map((s) => s.estatus), ['SUSPENDIDO'], 'el estatus no viaja en el renglón');
    assert.ok(conEstatus.datos.buscadoSoloEntre.includes('SUSPENDIDO'), conEstatus.datos.buscadoSoloEntre);

    const todos = await correr('buscar_servicio', { texto: victima.servicio, estatus: 'TODOS' });
    assert.equal(todos.datos.encontrados, 1, 'con estatus TODOS no lo encuentra');
  });

  test('T6.3 los agregados del filtro son el renglón que pinta la pantalla, con los tres estatus', async () => {
    // Depende de T6.2: el suspendido es el que hace que ACTIVO y TODOS difieran,
    // y sin esa diferencia la comprobación no distinguiría nada.
    const casos = [
      [{ texto: '' }, ''],
      [{ texto: '', estatus: 'SUSPENDIDO' }, '?estatus=SUSPENDIDO'],
      [{ texto: '', estatus: 'TODOS' }, '?estatus='],
    ];
    const vistos = new Set();
    for (const [args, consulta] of casos) {
      const { datos } = await correr('buscar_servicio', args);
      const pantalla = await renglonDeArriba(consulta);
      assert.deepEqual(
        pantalla,
        {
          servicios: formatNumber(datos.agregadosDelFiltro.servicios),
          guardias: formatNumber(datos.agregadosDelFiltro.guardias),
          importe: formatCurrency(datos.agregadosDelFiltro.importe),
        },
        `${JSON.stringify(args)}: el asistente y el renglón de arriba de Estado de fuerza no dicen lo mismo`
      );
      vistos.add(JSON.stringify(pantalla));
    }
    assert.equal(vistos.size, 3, 'los tres filtros pintan el mismo renglón: la comprobación no distingue');
  });

  test('T6.4 los agregados se suman sobre el conjunto completo y no sobre los renglones que viajan', async () => {
    const { datos } = await correr('buscar_servicio', { texto: '', estatus: 'TODOS' });
    assert.ok(datos.serviciosTotal > datos.servicios.length, 'la lista no viene recortada: no se mide nada');
    assert.ok(
      datos.agregadosDelFiltro.guardias > suma(datos.servicios, 'total_guardias'),
      `los agregados dicen ${datos.agregadosDelFiltro.guardias} guardias y los renglones que viajan suman ` +
        `${suma(datos.servicios, 'total_guardias')}: el agregado se está contando sobre la lista recortada`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T7 · F4 · el horizonte de contratos
// ═══════════════════════════════════════════════════════════════════════════════

describe('T7 · F4 · el horizonte de vencimientos', () => {
  /** Lo que el Tablero pinta en sus dos renglones de contratos. */
  async function delTablero() {
    const html = comoLaLeeUnaPersona((await admin.pedir('/')).texto);
    return {
      porVencer: Number((html.match(/Vencen en 90 días<\/p><span class="text-xs text-slate-500">(\d+)</) || [])[1]),
      vencidos: Number((html.match(/Ya vencidos<\/p><span class="text-xs text-slate-500">(\d+)</) || [])[1]),
    };
  }

  test('T7.1 sin argumento, el total es el que el Tablero pinta y el corte son 90 días', async () => {
    const { datos } = await correr('contratos', {});
    const tablero = await delTablero();
    assert.ok(Number.isInteger(tablero.porVencer), 'el Tablero no pinta «Vencen en 90 días»');
    assert.equal(
      datos.vencenEnElHorizonteTotal,
      tablero.porVencer,
      'el asistente y el Tablero no dicen el mismo número de contratos por vencer'
    );
    assert.equal(datos.yaVencidosTotal, tablero.vencidos, 'el asistente y el Tablero no dicen los mismos ya vencidos');
    assert.equal(datos.horizonteMeses, null, 'sin argumento «horizonteMeses» no va en nulo');
    assert.deepEqual(Object.keys(datos).filter((k) => k.startsWith('vencenEn90')), [], 'quedó la clave vieja');
    // La fecha exacta del corte, que es lo que el coder añadió: tiene que ser la
    // que da la plataforma para noventa días y no la de tres meses de calendario.
    const hoy = new Date(`${datos.horizonteHasta}T00:00:00Z`);
    assert.ok(!Number.isNaN(hoy.valueOf()), `«horizonteHasta» no es una fecha: ${datos.horizonteHasta}`);
    assert.match(datos.horizonteQueCuenta, /90 días/, datos.horizonteQueCuenta);
  });

  test('T7.2 con 24 meses el total crece, ninguna fecha se sale del corte y ya no dice «90 días»', async () => {
    const corto = await correr('contratos', {});
    const largo = await correr('contratos', { mesesDeHorizonte: 24 });
    assert.ok(
      largo.datos.vencenEnElHorizonteTotal > corto.datos.vencenEnElHorizonteTotal,
      'con 24 meses el total no crece'
    );
    assert.equal(largo.datos.horizonteMeses, 24);
    assert.ok(largo.datos.horizonteHasta > corto.datos.horizonteHasta, 'el corte no se movió');
    for (const s of largo.datos.vencenEnElHorizonte) {
      assert.ok(
        s.fecha_vencimiento_contrato <= largo.datos.horizonteHasta,
        `viaja un vencimiento el ${s.fecha_vencimiento_contrato} y el corte que declara es ${largo.datos.horizonteHasta}`
      );
    }
    assert.ok(!JSON.stringify(largo.datos).includes('90 día'), 'con 24 meses el resultado sigue diciendo «90 días»');
    // Los ya vencidos no dependen del horizonte, y el resultado lo dice.
    assert.equal(largo.datos.yaVencidosTotal, corto.datos.yaVencidosTotal, 'los ya vencidos se movieron con el horizonte');
    assert.match(largo.datos.horizonteQueCuenta, /no depende/i, largo.datos.horizonteQueCuenta);
  });

  test('T7.3 un horizonte imposible cae en el de siempre, sin reventar y sin que el texto de fuera viaje', async () => {
    const corto = await correr('contratos', {});
    for (const meses of [0, -5, 37, 999, 3.7, 'doce', null, true, '24', [], {}]) {
      const r = await correrAunqueFalle('contratos', { mesesDeHorizonte: meses });
      assert.equal(r.estado, 200, `con mesesDeHorizonte ${JSON.stringify(meses)} la consulta reventó: ${r.rechazo}`);
      assert.ok(r.datos, `con mesesDeHorizonte ${JSON.stringify(meses)} no volvió resultado: ${r.rechazo}`);
      assert.equal(
        r.datos.vencenEnElHorizonteTotal,
        corto.datos.vencenEnElHorizonteTotal,
        `con mesesDeHorizonte ${JSON.stringify(meses)} el horizonte cambió`
      );
      assert.equal(r.datos.horizonteMeses, null, `con ${JSON.stringify(meses)} «horizonteMeses» no va en nulo`);
      // Solo se persigue el texto que NO podría salir de la plataforma: una
      // cadena de dígitos como «24» aparece dentro de cualquier año o importe, y
      // perseguirla sería perseguir una coincidencia.
      if (typeof meses === 'string' && !/^\d+$/.test(meses)) {
        assert.ok(!JSON.stringify(r.datos).includes(meses), `el texto de fuera «${meses}» viajó en el resultado`);
      }
    }
  });

  test('T7.4 pedir meses da lo que promete: cada horizonte contiene al anterior', async () => {
    let previo = null;
    for (const meses of [1, 3, 6, 12, 24, 36]) {
      const { datos } = await correr('contratos', { mesesDeHorizonte: meses });
      assert.equal(datos.horizonteMeses, meses);
      assert.match(datos.vencenEnElHorizonteQueCuenta, new RegExp(`${meses} meses`), datos.vencenEnElHorizonteQueCuenta);
      if (previo) {
        assert.ok(
          datos.vencenEnElHorizonteTotal >= previo.total,
          `${meses} meses dan ${datos.vencenEnElHorizonteTotal} y ${previo.meses} daban ${previo.total}`
        );
        assert.ok(datos.horizonteHasta > previo.hasta, `${meses} meses cortan antes que ${previo.meses}`);
      }
      previo = { meses, total: datos.vencenEnElHorizonteTotal, hasta: datos.horizonteHasta };
    }
  });

  test('T7.5 ROJA · HALLAZGO H5 (Medio) · el horizonte de un mes corta en el mes que viene del que viene', async () => {
    /**
     * `contratosPorVencerEnMeses` calcula el corte con `date('now','+N month')`.
     * SQLite normaliza los desbordes, así que pedido un día 29, 30 o 31 el corte
     * de UN mes se va al mes siguiente al siguiente: medido hoy, el corte de un
     * mes cae el día 1 del mes que viene del que viene.
     *
     * No es un número equivocado hoy —`horizonteHasta` dice la fecha exacta, que
     * es justo lo que el coder añadió, y hoy no hay ningún contrato en el
     * desborde— pero sí es un horizonte que no es el que se pidió: «¿qué vence el
     * mes que viene?» abarca hasta el primero del otro. Un contrato que venza ahí
     * entraría en una lista rotulada «dentro de los próximos 1 meses», y el texto
     * de al lado sería falso. Es un defecto latente del borde de mes, no del dato.
     */
    const uno = await correr('contratos', { mesesDeHorizonte: 1 });
    const hoy = uno.ficha.consultado.slice(0, 10);
    const [anio, mes] = hoy.split('-').map(Number);
    // El último día del mes que viene, calculado con el calendario y no a mano.
    const finDelMesQueViene = new Date(Date.UTC(anio, mes + 1, 0)).toISOString().slice(0, 10);
    assert.ok(
      uno.datos.horizonteHasta <= finDelMesQueViene,
      `pedido un horizonte de 1 mes el ${hoy}, el corte que el resultado declara es ${uno.datos.horizonteHasta}, ` +
        `que se pasa del último día del mes que viene (${finDelMesQueViene}). Pedido en un día 29, 30 o 31 ` +
        'el desborde de calendario de SQLite manda el corte al mes siguiente al siguiente'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T8 · Rangos y meses que no existen
// ═══════════════════════════════════════════════════════════════════════════════

describe('T8 · los rangos: nada revienta y la respuesta dice qué cubrió', () => {
  test('T8.1 invertido, vacío, de un mes, anterior, futuro, enorme, con inyección y con emojis', async () => {
    const primero = historico.hayMovimientosDesde;
    const ultimo = historico.hayMovimientosHasta;
    const casos = [
      ['invertido', { desde: ultimo, hasta: primero }],
      ['vacío', { desde: '', hasta: '' }],
      ['de un mes', { periodo: ultimo }],
      ['anterior a los datos', { desde: '1990-01', hasta: '1990-12' }],
      ['futuro', { desde: '2099-01', hasta: '2099-12' }],
      ['enorme', { desde: '1900-01', hasta: '2099-12' }],
      ['histórico completo', { todoElHistorico: true }],
      ['con inyección', { desde: "2023-01' OR 1=1 --", hasta: ultimo }],
      ['con acentos', { periodo: 'añó-ñn' }],
      ['con emojis', { periodo: '🙂🙂-01' }],
      ['tipo número', { periodo: 202610 }],
      ['tipo nulo', { desde: null, hasta: null }],
      ['tipo objeto', { desde: { a: 1 } }],
      ['histórico de texto', { todoElHistorico: 'sí' }],
    ];
    for (const [nombre, args] of casos) {
      const r = await correrAunqueFalle('movimientos', args);
      assert.equal(r.estado, 200, `«${nombre}» reventó: ${r.rechazo}`);
      assert.ok(r.datos, `«${nombre}» no volvió resultado: ${r.rechazo}`);
      // La respuesta tiene que decir qué cubrió DE VERDAD, siempre.
      assert.match(r.datos.desde, /^\d{4}-\d{2}$/, `«${nombre}»: «desde» no es un mes`);
      assert.match(r.datos.hasta, /^\d{4}-\d{2}$/, `«${nombre}»: «hasta» no es un mes`);
      assert.ok(r.datos.desde <= r.datos.hasta, `«${nombre}»: el rango salió al revés en el resultado`);
      assert.ok(Number.isInteger(r.datos.mesesCubiertos) && r.datos.mesesCubiertos >= 1, `«${nombre}»: meses raros`);
      /**
       * El texto de fuera no viaja en el aviso.
       *
       * Solo se persigue el que NO es un mes válido: un «desde» que sí es un mes
       * el servidor lo corrige y lo nombra —«el rango venía al revés, de A a B»—
       * y eso es el servidor hablando de su propio dato corregido, no texto de
       * fuera colado con cara de hecho.
       */
      for (const valor of Object.values(args)) {
        if (typeof valor !== 'string' || !valor.trim()) continue;
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) continue;
        assert.ok(
          !String(r.datos.avisoDelPeriodo || '').includes(valor),
          `«${nombre}»: el aviso repite el texto que llegó de fuera («${valor}»)`
        );
      }
    }
  });

  test('T8.2 el rango al revés se voltea y lo dice; el extremo que no se entiende se abre y lo dice', async () => {
    const primero = historico.hayMovimientosDesde;
    const ultimo = historico.hayMovimientosHasta;
    const volteado = await correr('movimientos', { desde: ultimo, hasta: primero });
    assert.equal(volteado.datos.desde, primero);
    assert.equal(volteado.datos.hasta, ultimo);
    assert.match(volteado.datos.avisoDelPeriodo, /al revés/i, volteado.datos.avisoDelPeriodo);

    const roto = await correr('movimientos', { desde: '2026-13', hasta: '2026-13' });
    assert.equal(roto.datos.desde, primero, 'el extremo que no se entiende no se abrió al primer mes con datos');
    assert.equal(roto.datos.hasta, ultimo);
    assert.match(roto.datos.avisoDelPeriodo, /no se entendió/i, roto.datos.avisoDelPeriodo);
  });

  test('T8.3 ROJA · HALLAZGO H4 (Medio) · un mes que no existe viaja como el periodo, y la ficha lo avala', async () => {
    /**
     * La diferencia que el coder anotó y pidió juzgar: el extremo de un rango
     * rechaza `2026-13` con un aviso —medido en T8.2— y el mes suelto lo acepta.
     *
     * Juicio: no es defendible como está. El `mesValido` de arriba lo justifica
     * con que «un 2026-13 como mes suelto se contesta con cero movimientos, que
     * es la verdad de un mes que no existe», y eso solo se sostiene si la
     * respuesta DICE que el mes no existe. No lo dice: el aviso que sale es «no
     * hubo ningún movimiento en el periodo cubierto», que se lee como un mes real
     * y vacío. Y lo peor es la ficha —el recuadro que el modelo no puede
     * escribir y que existe para avalar la cifra—: dice «Guardias que entraron y
     * salieron en 0000-01: +0 / −0», avalando un periodo que no puede existir.
     *
     * No es Bloqueante porque el cero es cierto y nadie cita un cero; es Medio
     * porque incumple el criterio «que la respuesta diga qué cubrió de verdad» en
     * un camino cuando el camino hermano sí lo cumple.
     */
    for (const periodo of ['2026-13', '2026-00', '0000-01', '9999-12']) {
      const mov = await correr('movimientos', { periodo });
      assert.notEqual(
        mov.datos.periodo,
        periodo,
        `«${periodo}» no es un mes que exista y viaja como el periodo de la respuesta; la ficha dice ` +
          `«${mov.ficha.dato}: ${mov.ficha.valor}», y el aviso —«${mov.datos.avisoDelPeriodo}»— no dice que el ` +
          'mes no exista. El mismo texto como extremo de un rango sí se rechaza con aviso (T8.2)'
      );
    }
  });

  test('T8.4 el histórico completo cubre más meses que un año y los totales son los de la plataforma', async () => {
    const todo = await correr('movimientos', { todoElHistorico: true });
    const anio = await correr('movimientos', {
      desde: `${historico.hayMovimientosHasta.slice(0, 4)}-01`,
      hasta: `${historico.hayMovimientosHasta.slice(0, 4)}-12`,
    });
    assert.ok(todo.datos.porMesDelPeriodoTotal > anio.datos.porMesDelPeriodoTotal, 'el histórico no trae más meses');

    // Los totales, contra las APIs de la propia plataforma.
    const cancelaciones = (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length;
    assert.equal(
      todo.datos.bajas.movimientos,
      cancelaciones,
      `el asistente cuenta ${todo.datos.bajas.movimientos} bajas de todos los tiempos y la API de ` +
        `cancelaciones trae ${cancelaciones}`
    );
    assert.equal(todo.datos.ultimasBajasTotal, cancelaciones, 'el total de la lista de bajas no es el de la API');
    assert.ok(
      todo.datos.ultimasBajas.length < todo.datos.ultimasBajasTotal,
      'la lista no viene recortada: no se mide que el total salga de otra consulta'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T9 · Lo de siempre: permisos, llave, solo lectura, totales, invariantes
// ═══════════════════════════════════════════════════════════════════════════════

describe('T9 · permisos, llave, solo lectura y los invariantes', () => {
  test('T9.1 los seis roles: las mismas siete, los mismos permisos, el espectador fuera', async () => {
    const r = await admin.pedir('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify({
        email: 'espectador@corporativoultra.com',
        nombre: 'Espectador de prueba',
        rol: 'espectador',
        password: PASSWORD_TEMPORAL,
      }),
    });
    assert.ok(r.status === 201 || r.status === 409, `no se pudo dar de alta al espectador: ${r.status} ${r.texto}`);

    const siete = [
      'resumen_operacion',
      'buscar_servicio',
      'ficha_de_servicio',
      'movimientos',
      'estado_de_un_dia',
      'contratos',
      'cobranza',
    ];
    const conCobranza = new Set(['admin', 'finanzas']);

    for (const [rol, email] of Object.entries(ROLES)) {
      const cliente = await app.entrarYAsentar(email);
      // Lo que se le OFRECE al modelo, leído de los bytes que salieron.
      doble.olvidar();
      doble.guionar([{ texto: 'hola' }]);
      const saludo = await cliente.pedir('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ pregunta: 'hola', previas: [] }),
      });
      assert.equal(saludo.status, 200, `${rol} no pudo preguntar: ${saludo.texto}`);
      const ofrecidas = (doble.peticiones()[0]?.cuerpo?.tools || []).map((t) => t.name);
      assert.deepEqual(
        ofrecidas,
        conCobranza.has(rol) ? siete : siete.filter((n) => n !== 'cobranza'),
        `a ${rol} se le ofrecen otras consultas`
      );
      // Y la cerradura de verdad: se piden las siete de todas formas.
      for (const nombre of siete) {
        const args =
          nombre === 'buscar_servicio'
            ? { texto: 'a' }
            : nombre === 'ficha_de_servicio'
              ? { id: servicios[0].id }
              : nombre === 'estado_de_un_dia'
                ? { dia: `${historico.hayMovimientosHasta}-15` }
                : {};
        const r2 = await correrAunqueFalle(nombre, args, cliente);
        if (nombre === 'cobranza' && !conCobranza.has(rol)) {
          assert.equal(r2.datos, null, `${rol} obtuvo cobranza y no debería`);
          assert.match(r2.rechazo, /Cobranza/, `${rol}: el rechazo no dice en qué pantalla se ve el dato`);
        } else {
          assert.ok(r2.datos, `${rol} no pudo correr ${nombre}: ${r2.rechazo}`);
        }
      }
    }

    // El espectador, fuera del asistente entero.
    const espectador = await app.entrarYAsentar('espectador@corporativoultra.com');
    const fuera = await espectador.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'hola', previas: [] }),
    });
    assert.equal(fuera.status, 403, 'el espectador entró al asistente');
  });

  test('T9.2 la llave sale solo hacia el servidor del servicio: ni al navegador ni al canal', async () => {
    const llave = doble.env.ANTHROPIC_API_KEY;
    doble.olvidar();
    doble.guionar([{ herramientas: [{ nombre: 'resumen_operacion', args: {} }] }, { texto: 'listo' }]);
    const r = await admin.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'hola', previas: [] }),
    });
    assert.ok(!r.texto.includes(llave), 'la llave viajó por el canal hacia el navegador');
    assert.ok(
      JSON.stringify(doble.peticiones()[0].cabeceras).includes(llave),
      'la llave no viajó hacia el servicio: la comprobación no mide nada'
    );
    for (const ruta of ['/asistente', '/', '/cobranza']) {
      const html = (await admin.pedir(ruta)).texto;
      assert.ok(!html.includes(llave), `la llave se pinta en ${ruta}`);
    }
  });

  test('T9.3 toda lista que sale lleva su total y dice qué cuenta, en las siete', async () => {
    const casos = [
      ['resumen_operacion', {}],
      ['buscar_servicio', { texto: '' }],
      ['ficha_de_servicio', { id: servicios[0].id }],
      ['movimientos', { todoElHistorico: true }],
      ['estado_de_un_dia', { dia: `${historico.hayMovimientosHasta}-15` }],
      ['contratos', { mesesDeHorizonte: 24 }],
      ['cobranza', { periodo: sembradas[0].periodo }],
    ];
    const faltas = [];
    for (const [nombre, args] of casos) {
      const { datos } = await correr(nombre, args);
      const recorrer = (objeto, ruta) => {
        if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return;
        for (const [clave, valor] of Object.entries(objeto)) {
          const aqui = ruta ? `${ruta}.${clave}` : clave;
          if (Array.isArray(valor)) {
            if (!Number.isInteger(objeto[`${clave}Total`])) faltas.push(`${nombre}:${aqui} sin total`);
            if (!String(objeto[`${clave}QueCuenta`] || '').trim()) faltas.push(`${nombre}:${aqui} sin «qué cuenta»`);
            else if (!/trae \d+ de \d+/.test(objeto[`${clave}QueCuenta`])) {
              faltas.push(`${nombre}:${aqui} no dice cuántos de cuántos trae`);
            }
            continue;
          }
          recorrer(valor, aqui);
        }
      };
      recorrer(datos, '');
    }
    assert.deepEqual(faltas, [], `hay listas saliendo hacia el modelo sin su total:\n${faltas.join('\n')}`);
  });

  test('T9.4 nada escribe: correr las siete dos veces no mueve los invariantes', async () => {
    const antes = {
      servicios: (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios,
      cancelaciones: (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length,
    };
    const casos = [
      ['resumen_operacion', {}],
      ['buscar_servicio', { texto: '', estatus: 'TODOS' }],
      ['ficha_de_servicio', { id: servicios[0].id }],
      ['movimientos', { todoElHistorico: true }],
      ['estado_de_un_dia', { dia: `${historico.hayMovimientosHasta}-15` }],
      ['contratos', { mesesDeHorizonte: 36 }],
      ['cobranza', { periodo: sembradas[0].periodo }],
    ];
    const primeraVuelta = [];
    for (const [n, a] of casos) primeraVuelta.push(JSON.stringify((await correr(n, a)).datos));
    for (let i = 0; i < casos.length; i += 1) {
      const otra = JSON.stringify((await correr(casos[i][0], casos[i][1])).datos);
      assert.equal(otra, primeraVuelta[i], `${casos[i][0]} contesta distinto la segunda vez`);
    }

    const despues = {
      servicios: (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios,
      cancelaciones: (await admin.pedir('/api/cancelaciones')).json.cancelaciones.length,
    };
    assert.equal(despues.servicios.length, antes.servicios.length, 'el número de servicios activos cambió');
    assert.equal(
      suma(despues.servicios, 'total_guardias'),
      suma(antes.servicios, 'total_guardias'),
      'los guardias cambiaron al preguntarle al asistente'
    );
    assert.equal(despues.cancelaciones, antes.cancelaciones, 'las cancelaciones cambiaron');
  });

  test('T9.5 el servicio externo cae y se corta: el servidor sigue en pie y la siguiente respuesta es la buena', async () => {
    doble.olvidar();
    doble.guionar([{ estado: 500, error: 'se cayó' }]);
    const caida = await admin.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'y si falla', previas: [] }),
    });
    assert.equal(caida.status, 200, 'una falla del servicio externo tira la petición');
    assert.ok(eventos(caida.texto).some((e) => e.tipo === 'error'), 'la caída no deja evento de error');
    assert.ok(!eventos(caida.texto).some((e) => e.tipo === 'ficha'), 'una caída dejó ficha: avalaría una cifra que no hubo');

    doble.olvidar();
    doble.guionar([{ cortar: true, texto: 'lo que alcancé a decir' }]);
    const cortada = await admin.pedir('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ pregunta: 'y si se corta', previas: [] }),
    });
    assert.equal(cortada.status, 200);
    assert.ok(eventos(cortada.texto).some((e) => e.tipo === 'error'), 'una respuesta cortada no avisa');

    // Y después de las dos fallas, la respuesta de verdad sigue siendo la de verdad.
    const buena = await correr('resumen_operacion', {});
    const activos = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    assert.equal(buena.datos.serviciosActivos, activos.length, 'tras una falla el asistente cuenta otros servicios');
    assert.equal(buena.datos.guardias, suma(activos, 'total_guardias'), 'tras una falla cuenta otros guardias');
  });

  test('T9.6 diez preguntas a la vez: ninguna se cruza con otra ni tira el servidor', async () => {
    doble.olvidar();
    // Un guion de un solo turno con texto: así cada petición recibe lo mismo sin
    // depender del orden en que lleguen, que es lo que se quiere medir aquí.
    doble.guionar([{ texto: 'a la vez' }]);
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        admin.pedir('/api/chat', { method: 'POST', body: JSON.stringify({ pregunta: `simultánea ${i}`, previas: [] }) })
      )
    );
    for (const r of respuestas) assert.equal(r.status, 200, `una de las diez simultáneas salió ${r.status}`);
    const buena = await correr('movimientos', { todoElHistorico: true });
    assert.deepEqual(buena.datos.bajas, historico.bajas, 'tras diez preguntas a la vez las cifras se movieron');
  });
});
