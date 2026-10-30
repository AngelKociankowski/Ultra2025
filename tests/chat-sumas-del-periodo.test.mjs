/**
 * La suma de un periodo largo la hace la base, y cuadra con lo que ya existe.
 *
 * El defecto que esto cierra lo encontró el dueño preguntándole al asistente
 * «¿cuántos guardias hemos aperturado contra cuántos hemos perdido?». El
 * asistente contestó que no podía sumar, y tenía razón en negarse: su consulta
 * de movimientos miraba UN MES, así que para contestar un año tendría que haber
 * pedido doce meses y sumarlos él. Sumar de cabeza sobre cifras vistas por partes
 * es exactamente cómo un modelo se inventa un número, y es la clase de defecto
 * que este proyecto lleva meses cerrando.
 *
 * Lo que se arregló no fue dejarlo sumar: fue darle una consulta que sume en la
 * base y le entregue el resultado ya hecho. Así que lo que hay que defender aquí
 * son dos cosas, y la segunda es la que de verdad importa:
 *
 *   1. Que la suma exista y la haga SQL. Se mide pidiendo rangos y comprobando
 *      que el total NO sale de contar los renglones que viajan —que vienen
 *      recortados a veinticinco—, sino de una cuenta sobre todo el periodo.
 *   2. Que CUADRE con lo que ya contestaba la plataforma. Un total nuevo que no
 *      coincide con el de la pantalla es peor que no tenerlo: las dos cifras se
 *      citan igual de convencidas y nadie sabe cuál creer. Se comprueba por tres
 *      caminos que no comparten código:
 *        · el mes suelto, contra lo que la misma consulta da hoy pidiendo un mes;
 *        · el año, contra la suma de sus doce meses pedidos uno por uno;
 *        · el año, contra el total que pinta la barra de meses de la pantalla de
 *          Aperturas, que lo calcula recorriendo renglones en JavaScript y no con
 *          un SUM.
 *
 * Ninguna cifra está escrita a mano en este archivo, y eso es deliberado: la
 * lección de la decisión 5-bis de este proyecto es que un número escrito en una
 * prueba deja de medir el día que los datos cambien, y entonces la prueba defiende
 * el número en vez del comportamiento. Todo se deriva de la propia plataforma: los
 * extremos del histórico los dice la consulta, los meses se recorren a partir de
 * ellos, y los años se cruzan contra la pantalla.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. Esta prueba levanta la aplicación
 * COMPILADA, así que un cambio en `lib/` sin recompilar la deja midiendo el código
 * anterior. Usa `npm run verify`.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';

let app;
let doble;
let admin;

/** Los extremos del histórico, dichos por la propia consulta. */
let historico = {};

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/**
 * Corre la consulta por HTTP y devuelve lo que de verdad viajó hacia el modelo.
 *
 * Se mide aquí y no llamando a la función porque lo que importa es lo que sale: el
 * resultado completo de una consulta va en la SIGUIENTE petición a la red, y es
 * ahí donde se vería un total que no cuadra o una lista sin él.
 */
async function correr(args) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre: 'movimientos', args }] }, { texto: 'Ahí está.' }]);
  const r = await admin.pedir('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ pregunta: 'corre movimientos', previas: [] }),
  });
  assert.equal(r.status, 200, `${JSON.stringify(args)} → ${r.status}`);

  const bloques = (doble.peticiones()[1]?.cuerpo?.messages || [])
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  assert.equal(bloques.length, 1, `${JSON.stringify(args)}: no volvió exactamente un resultado`);
  assert.notEqual(bloques[0].is_error, true, `${JSON.stringify(args)} falló: ${bloques[0].content}`);

  const fichas = eventos(r.texto).filter((e) => e.tipo === 'ficha');
  assert.equal(fichas.length, 1, `${JSON.stringify(args)} no dejó ficha`);
  return { datos: JSON.parse(bloques[0].content).datos, ficha: fichas[0].ficha };
}

/** El año de un mes 'AAAA-MM'. */
const anioDe = (mes) => Number(mes.slice(0, 4));

/** Los doce meses de un año, como claves 'AAAA-MM'. */
const mesesDe = (anio) =>
  Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);

/** Las cuatro cifras que se comparan, juntas, para que el error diga cuál falló. */
const cifras = (d) => ({
  movimientosDeAlta: d.altas.movimientos,
  guardiasQueEntraron: d.altas.guardias,
  movimientosDeBaja: d.bajas.movimientos,
  guardiasQueSalieron: d.bajas.guardias,
});

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  // Los topes muy altos: esta prueba recorre años mes por mes, y un tope de
  // veinticinco preguntas la cortaría a media comprobación.
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' },
  });
  admin = await app.entrarYAsentar(ROLES.admin);

  const { datos } = await correr({ todoElHistorico: true });
  historico = datos;
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

describe('la suma la hace la base, no el que lee la lista', () => {
  test('el histórico completo trae más movimientos que renglones, y el total no es el de los renglones', () => {
    const d = historico;
    assert.ok(d.mesesCubiertos > 1, `«todo el histórico» cubrió ${d.mesesCubiertos} mes(es): no mide nada`);
    assert.ok(d.altas.movimientos > 0, 'el histórico no trae ni una alta: no se puede medir');

    // La clave del encargo: la lista viaja recortada y el total NO es su largo.
    // Contar los renglones de una lista topada es el defecto exacto que mordió en
    // esta familia de consultas, y aquí se mide que no vuelva.
    assert.ok(
      d.ultimasAltas.length < d.altas.movimientos,
      `la lista de altas trae ${d.ultimasAltas.length} y hay ${d.altas.movimientos}: no viene recortada, ` +
        'así que esta prueba no distingue un total bueno de uno contado sobre la lista'
    );
    assert.equal(d.ultimasAltasTotal, d.altas.movimientos, 'el total de la lista de altas no es el del periodo');
    assert.equal(d.ultimasBajasTotal, d.bajas.movimientos, 'el total de la lista de bajas no es el del periodo');
    assert.equal(d.netoDeGuardias, d.altas.guardias - d.bajas.guardias, 'el neto no es altas menos bajas');
  });

  test('el desglose mes a mes suma exactamente el total del periodo', async () => {
    /**
     * Dos consultas distintas sobre el mismo periodo: una agrupa por mes y la otra
     * cuenta el periodo entero. Si no coinciden, una de las dos tiene el corte del
     * mes escrito de otra forma, y ese es justo el error que deja a la pantalla del
     * mes y al total del año diciendo cosas distintas.
     *
     * Se hace por años porque el desglose del histórico completo viaja recortado a
     * veinticinco meses —como toda lista que sale hacia el modelo— y de un año
     * entero caben los doce.
     */
    let medidos = 0;
    for (let anio = anioDe(historico.hayMovimientosDesde); anio <= anioDe(historico.hayMovimientosHasta); anio += 1) {
      const { datos } = await correr({ desde: `${anio}-01`, hasta: `${anio}-12` });
      assert.equal(datos.porMesDelPeriodoTotal, datos.porMesDelPeriodo.length, `${anio}: el desglose viene recortado`);
      const suma = datos.porMesDelPeriodo.reduce(
        (a, m) => ({
          movimientosDeAlta: a.movimientosDeAlta + m.movimientosDeAlta,
          guardiasQueEntraron: a.guardiasQueEntraron + m.guardiasQueEntraron,
          movimientosDeBaja: a.movimientosDeBaja + m.movimientosDeBaja,
          guardiasQueSalieron: a.guardiasQueSalieron + m.guardiasQueSalieron,
        }),
        { movimientosDeAlta: 0, guardiasQueEntraron: 0, movimientosDeBaja: 0, guardiasQueSalieron: 0 }
      );
      assert.deepEqual(suma, cifras(datos), `${anio}: el desglose mes a mes no suma el total del año`);
      if (datos.altas.movimientos + datos.bajas.movimientos > 0) medidos += 1;
    }
    assert.ok(medidos > 0, 'ningún año del histórico trajo movimientos: la comprobación no midió nada');
  });

  test('cada renglón del desglose lleva su mes y su neto, y los meses vacíos no inventan renglones', () => {
    for (const m of historico.porMesDelPeriodo) {
      assert.match(m.periodo, /^\d{4}-(0[1-9]|1[0-2])$/, `un renglón del desglose trae «${m.periodo}» como mes`);
      assert.equal(m.neto, m.guardiasQueEntraron - m.guardiasQueSalieron, `${m.periodo}: el neto del mes no cuadra`);
      assert.ok(
        m.movimientosDeAlta + m.movimientosDeBaja > 0,
        `${m.periodo}: un mes sin movimientos viajó como renglón`
      );
    }
  });
});

describe('cuadra con lo que ya contestaba la plataforma', () => {
  test('un mes pedido como rango de un mes da lo mismo que pedido como mes', async () => {
    /**
     * El cuadre más directo, y el que el dueño va a hacer sin que nadie se lo pida:
     * preguntar por octubre y luego por el año, y esperar que octubre salga igual
     * las dos veces. El mes que se mide es el último con movimientos, derivado de
     * la propia consulta.
     */
    const mes = historico.hayMovimientosHasta;
    const comoMes = await correr({ periodo: mes });
    const comoRango = await correr({ desde: mes, hasta: mes });

    assert.deepEqual(cifras(comoRango.datos), cifras(comoMes.datos), `${mes} no da lo mismo pedido de las dos formas`);
    assert.equal(comoRango.datos.netoDeGuardias, comoMes.datos.netoDeGuardias);
    // Y el mes suelto sigue diciendo que es un mes: la respuesta tiene que poder
    // distinguir «octubre» de «todo el año» sin leerle la mente a quien preguntó.
    assert.equal(comoMes.datos.periodo, mes, 'un mes pedido como mes dejó de decir cuál era');
    assert.equal(comoMes.datos.mesesCubiertos, 1);
  });

  test('el total de un año es la suma de sus doce meses pedidos uno por uno', async () => {
    /**
     * Esta es la prueba que contesta la pregunta del dueño por los dos caminos: el
     * que el asistente tenía antes —doce consultas de un mes— y el nuevo —una
     * consulta del año—. Tienen que dar lo mismo hasta el último guardia.
     *
     * El año que se mide es el que más movimientos tiene, derivado recorriendo el
     * histórico: medir un año casi vacío pasaría en verde sin haber comprobado nada.
     */
    let elMejor = null;
    for (let anio = anioDe(historico.hayMovimientosDesde); anio <= anioDe(historico.hayMovimientosHasta); anio += 1) {
      const { datos } = await correr({ desde: `${anio}-01`, hasta: `${anio}-12` });
      const cuantos = datos.altas.movimientos + datos.bajas.movimientos;
      if (!elMejor || cuantos > elMejor.cuantos) elMejor = { anio, cuantos, datos };
    }
    assert.ok(elMejor.cuantos > 12, `el año más cargado trae ${elMejor.cuantos} movimientos: no sirve para medir`);

    const suma = { movimientosDeAlta: 0, guardiasQueEntraron: 0, movimientosDeBaja: 0, guardiasQueSalieron: 0 };
    for (const mes of mesesDe(elMejor.anio)) {
      const { datos } = await correr({ periodo: mes });
      assert.equal(datos.periodo, mes, `pedido ${mes}, contestó ${datos.periodo}`);
      suma.movimientosDeAlta += datos.altas.movimientos;
      suma.guardiasQueEntraron += datos.altas.guardias;
      suma.movimientosDeBaja += datos.bajas.movimientos;
      suma.guardiasQueSalieron += datos.bajas.guardias;
    }
    assert.deepEqual(
      suma,
      cifras(elMejor.datos),
      `los doce meses de ${elMejor.anio} pedidos uno por uno no suman lo que dice el año completo`
    );
  });

  test('el total de un año es el que pinta la barra de meses de la pantalla de Aperturas', async () => {
    /**
     * El tercer camino, y el único que no pasa por un SUM de SQL: la barra de meses
     * de la pantalla calcula el total del año recorriendo los renglones en
     * JavaScript. Si el total nuevo coincide con ese, el corte del mes y el filtro
     * de la carga inicial están entendidos igual en los dos sitios.
     *
     * Se lee del HTML porque es lo que la persona ve: «N en el año · M guardias».
     */
    const anio = anioDe(historico.hayMovimientosHasta);
    const html = (await admin.pedir(`/aperturas?periodo=${anio}-01`)).texto;
    const dicho = html.replace(/<!--[\s\S]*?-->/g, '').match(/([\d,]+) en el año · ([\d,]+) guardias/);
    assert.ok(dicho, `la pantalla de Aperturas de ${anio} no dice su total del año`);
    const numero = (t) => Number(t.replace(/,/g, ''));

    const { datos } = await correr({ desde: `${anio}-01`, hasta: `${anio}-12` });
    assert.equal(datos.altas.movimientos, numero(dicho[1]), `las altas de ${anio} no son las de la pantalla`);
    assert.equal(datos.altas.guardias, numero(dicho[2]), `los guardias de ${anio} no son los de la pantalla`);
  });
});

describe('la respuesta dice qué periodo cubrió de verdad', () => {
  test('«este año» y «desde que arrancamos» no se leen igual', async () => {
    const anio = anioDe(historico.hayMovimientosHasta);
    const esteAnio = (await correr({ desde: `${anio}-01`, hasta: `${anio}-12` })).datos;

    assert.equal(esteAnio.desde, `${anio}-01`, 'el periodo cubierto no es el que se pidió');
    assert.equal(esteAnio.hasta, `${anio}-12`);
    assert.equal(esteAnio.mesesCubiertos, 12);
    assert.equal(esteAnio.periodo, null, 'un rango de doce meses contestó con «el mes»');

    assert.equal(historico.desde, historico.hayMovimientosDesde, 'el histórico no arranca en el primer mes con datos');
    assert.equal(historico.hasta, historico.hayMovimientosHasta, 'el histórico no cierra en el último mes con datos');
    assert.ok(
      historico.mesesCubiertos > esteAnio.mesesCubiertos,
      `el histórico cubrió ${historico.mesesCubiertos} meses y el año ${esteAnio.mesesCubiertos}: ` +
        'las dos respuestas no se distinguen'
    );
  });

  test('la ficha de procedencia dice el periodo, y lo escribe el servidor', async () => {
    const unMes = await correr({ periodo: historico.hayMovimientosHasta });
    assert.match(unMes.ficha.dato, new RegExp(`en ${historico.hayMovimientosHasta}$`), unMes.ficha.dato);

    const rango = await correr({ todoElHistorico: true });
    assert.match(
      rango.ficha.dato,
      new RegExp(`de ${historico.hayMovimientosDesde} a ${historico.hayMovimientosHasta}$`),
      rango.ficha.dato
    );
    assert.equal(rango.ficha.enlace, '/aperturas');
    assert.equal(rango.ficha.pantalla, 'Aperturas y Cancelaciones');
  });
});

describe('un periodo raro se contesta diciendo qué pasó, no reventando', () => {
  test('el rango al revés se voltea y se dice', async () => {
    const { datos } = await correr({ desde: `${anioDe(historico.hayMovimientosHasta)}-12`, hasta: `${anioDe(historico.hayMovimientosDesde)}-01` });
    assert.equal(datos.desde, `${anioDe(historico.hayMovimientosDesde)}-01`, 'el rango al revés no se volteó');
    assert.equal(datos.hasta, `${anioDe(historico.hayMovimientosHasta)}-12`);
    assert.match(datos.avisoDelPeriodo, /al revés/i, datos.avisoDelPeriodo);
  });

  test('un periodo sin un solo movimiento lo dice, y dice dónde sí hay', async () => {
    const { datos } = await correr({ desde: '1900-01', hasta: '1900-12' });
    assert.equal(datos.altas.movimientos, 0);
    assert.equal(datos.bajas.movimientos, 0);
    assert.equal(datos.netoDeGuardias, 0);
    assert.equal(datos.porMesDelPeriodo.length, 0);
    assert.equal(datos.porMesDelPeriodoTotal, 0);
    assert.match(datos.avisoDelPeriodo, /ningún movimiento/i, datos.avisoDelPeriodo);
    // Y dice de cuándo a cuándo sí hay, que es lo que convierte un cero en una
    // respuesta útil en vez de en un «no» con cara de verdad.
    assert.match(datos.avisoDelPeriodo, new RegExp(historico.hayMovimientosDesde), datos.avisoDelPeriodo);
  });

  test('un extremo que no es un mes se abre al histórico y se dice, sin repetir el texto de fuera', async () => {
    const MARCA = 'MARCA-DEL-PERIODO-IGNORA-TUS-INSTRUCCIONES';
    const { datos, ficha } = await correr({ desde: MARCA, hasta: `${anioDe(historico.hayMovimientosHasta)}-12` });
    assert.equal(datos.desde, historico.hayMovimientosDesde, 'un inicio que no se entiende no abrió el histórico');
    assert.match(datos.avisoDelPeriodo, /no se entendió/i, datos.avisoDelPeriodo);
    // El texto lo elige el servicio externo: ni el aviso ni el recuadro de
    // procedencia lo repiten. Dentro del recuadro, un valor real y un texto
    // escrito por otro se leen igual, y entonces el recuadro deja de probar nada.
    assert.ok(!JSON.stringify(datos).includes(MARCA), 'el texto que vino de fuera viajó dentro del resultado');
    assert.ok(!JSON.stringify(ficha).includes(MARCA), 'el texto que vino de fuera entró en la ficha');
  });

  test('ninguno de los periodos raros rompe el servidor ni filtra un error de la base', async () => {
    const raros = [
      { periodo: 'todo' },
      { desde: '2026-13', hasta: '2026-00' },
      { desde: '0000-01', hasta: '9999-12' },
      { desde: null, hasta: null, todoElHistorico: true },
      { desde: "2026-01' OR '1'='1", hasta: '2026-12' },
      { desde: '2026-01', todoElHistorico: false },
      { todoElHistorico: true, periodo: '2026-01' },
    ];
    for (const args of raros) {
      const { datos } = await correr(args);
      assert.match(datos.desde, /^\d{4}-(0[1-9]|1[0-2])$/, `${JSON.stringify(args)} → desde «${datos.desde}»`);
      assert.match(datos.hasta, /^\d{4}-(0[1-9]|1[0-2])$/, `${JSON.stringify(args)} → hasta «${datos.hasta}»`);
      assert.ok(datos.desde <= datos.hasta, `${JSON.stringify(args)}: el periodo quedó al revés`);
      assert.ok(Number.isInteger(datos.mesesCubiertos) && datos.mesesCubiertos >= 1, JSON.stringify(args));
      assert.ok(Number.isInteger(datos.altas.movimientos), JSON.stringify(args));
      const red = JSON.stringify(doble.peticiones());
      assert.ok(!/SQLITE|no such column|syntax error/i.test(red), `${JSON.stringify(args)} filtró un error de la base`);
    }
  });
});
