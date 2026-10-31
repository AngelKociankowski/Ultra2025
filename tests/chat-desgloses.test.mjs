/**
 * Las cuatro funciones que el trabajo diario de este equipo obliga a preguntar y
 * el asistente no podía contestar.
 *
 * Ninguna es una consulta nueva: las cuatro son un argumento o un campo más sobre
 * las SIETE que ya existen, y eso no es ahorro de trabajo. Tres pruebas vigentes
 * fijan el inventario en siete, y una consulta nueva sobre una pantalla con
 * permiso propio entra sin que el guardián del espejo sepa de qué pantalla salió
 * ese permiso. Un argumento sobre una consulta que ya existe hereda un espejo ya
 * verificado.
 *
 *   · F1 `movimientos`: altas y bajas por zona y por asesor dentro del rango.
 *     Lo pregunta ventas («¿cuánto he abierto yo este año?») y el dueño («¿qué
 *     zona nos está costando?»).
 *   · F2 `buscar_servicio`: el filtro de estatus y los agregados del filtro.
 *     Hoy contestaba «no existe» de un cliente suspendido, y un «no» con cara de
 *     verdad no lo verifica nadie.
 *   · F3 `resumen_operacion`: el ranking de asesores, la única cifra que el
 *     Tablero pinta y su propio espejo no traía.
 *   · F4 `contratos`: el horizonte en meses. La guía de jurídico dice que el
 *     valor de su pantalla es «saber con meses de anticipación».
 *
 * Qué se defiende aquí, y es lo mismo en las cuatro: que el desglose CUADRE con
 * el total y con la pantalla espejo. Un desglose que no suma el total de arriba es
 * peor que no tenerlo —las dos cifras se citan igual de convencidas y nadie sabe
 * cuál creer— y una cifra que no es la de la pantalla rompe el contrato del
 * asistente, que es ser espejo de lo que la persona ve navegando.
 *
 * NINGUNA cifra está escrita a mano. Los rangos se derivan de los extremos del
 * histórico que dice la consulta, los asesores y las zonas de lo que trae el
 * resultado, y los cuadres se leen del HTML de la pantalla. Un número escrito aquí
 * defendería el número y no el comportamiento.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. Esta prueba levanta la aplicación
 * COMPILADA, así que un cambio en `lib/` sin recompilar la deja midiendo el
 * código anterior. Usa `npm run verify`.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
// El formateador de números DE LA PLATAFORMA, para buscar en el HTML la cifra
// exactamente como la pinta la pantalla en vez de adivinar su formato.
import { formatNumber } from '../lib/utils.js';

let app;
let doble;
let admin;

/** Los extremos del histórico de movimientos, dichos por la propia consulta. */
let historico = {};
/** El servicio que esta prueba suspende, para medir el filtro de estatus. */
const suspendido = {};

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/** Corre una consulta por HTTP y devuelve lo que de verdad viajó hacia el modelo. */
async function correr(nombre, args = {}) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
  const r = await admin.pedir('/api/chat', {
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
  return { datos: JSON.parse(bloques[0].content).datos, ficha: fichas[0].ficha };
}

/** El HTML de una pantalla como lo lee una persona: sin los comentarios de React. */
async function pantalla(ruta) {
  const r = await admin.pedir(ruta);
  assert.equal(r.status, 200, `${ruta} → ${r.status}`);
  return r.texto.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Un año del histórico cuyos dos desgloses vienen COMPLETOS.
 *
 * Hace falta derivarlo y no elegirlo a mano: el desglose viaja recortado a
 * veinticinco renglones como toda lista que sale hacia el modelo, y sumar una
 * lista recortada no puede dar el total. Así que se busca un año en el que la
 * lista entera quepa —`Total` igual al número de renglones— y que además tenga
 * movimientos, porque un año vacío pasaría en verde sin comprobar nada.
 */
async function anioMedible() {
  const primero = Number(historico.hayMovimientosDesde.slice(0, 4));
  const ultimo = Number(historico.hayMovimientosHasta.slice(0, 4));
  for (let anio = ultimo; anio >= primero; anio -= 1) {
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    const completas =
      datos.porZonaDelPeriodoTotal === datos.porZonaDelPeriodo.length &&
      datos.porAsesorDelPeriodoTotal === datos.porAsesorDelPeriodo.length;
    if (completas && datos.altas.movimientos + datos.bajas.movimientos > 0) return { anio, datos };
  }
  throw new Error('ningún año del histórico trae los dos desgloses completos: no se puede medir el cuadre');
}

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  // Los topes muy altos: este archivo recorre años y corre muchas consultas, y un
  // tope de veinticinco preguntas lo cortaría a media comprobación.
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' },
  });
  admin = await app.entrarYAsentar(ROLES.admin);

  historico = (await correr('movimientos', { todoElHistorico: true })).datos;

  /**
   * Un servicio suspendido DESDE LA PANTALLA de operaciones, no tocando la base.
   *
   * Es la única forma honesta de medir F2: el defecto es que el asistente
   * contestaba «no lo encontré» de un cliente que navegando sí aparece, así que
   * el servicio tiene que llegar a suspendido por el mismo camino por el que
   * llega en la vida real. Se suspende en el arranque y todo lo que se mide
   * después —incluido lo que pinta la pantalla— se lee en ese mismo estado, para
   * que el asistente y la pantalla no estén mirando dos fotos distintas.
   */
  const activos = (await correr('buscar_servicio', { texto: '' })).datos.servicios;
  assert.ok(activos.length > 0, 'no hay servicios activos con los que medir');
  /**
   * El servicio se elige por su NOMBRE y no por su posición: hace falta un trozo
   * de nombre con el que la caja de buscar pueda encontrarlo, y el primero de la
   * lista puede llamarse «3G CATERING», cuyo primer trozo son dos caracteres. Se
   * toma la palabra más larga del nombre más largo, todo derivado de lo que
   * contestó la plataforma.
   */
  const palabraMasLarga = (nombre) =>
    String(nombre || '')
      .trim()
      .split(/\s+/)
      .sort((a, b) => b.length - a.length)[0] || '';
  const elegido = activos
    .map((s) => ({ ...s, trozo: palabraMasLarga(s.servicio) }))
    .sort((a, b) => b.trozo.length - a.trozo.length)[0];
  assert.ok(elegido.trozo.length >= 4, `ningún servicio activo tiene un nombre con el que buscar`);

  const r = await admin.pedir(`/api/servicios/${elegido.id}/suspension`, {
    method: 'POST',
    body: JSON.stringify({ motivo: 'El cliente pidió pausa mientras renueva el contrato' }),
  });
  assert.equal(r.status, 200, `no se pudo suspender el servicio ${elegido.id}: ${r.texto}`);
  suspendido.id = elegido.id;
  suspendido.servicio = elegido.servicio;
  suspendido.trozo = elegido.trozo;
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

// ───────────────────────────────────────────────────────────────────────────────
describe('F1 · altas y bajas por zona y por asesor dentro del rango', () => {
  test('el desglose por zona suma EXACTAMENTE las altas y las bajas del periodo', async () => {
    const { anio, datos } = await anioMedible();
    assert.ok(datos.porZonaDelPeriodo.length > 1, `${anio}: una sola zona, el cuadre no mide reparto`);

    const suma = datos.porZonaDelPeriodo.reduce(
      (a, z) => ({
        altasMovimientos: a.altasMovimientos + z.altasMovimientos,
        altasGuardias: a.altasGuardias + z.altasGuardias,
        bajasMovimientos: a.bajasMovimientos + z.bajasMovimientos,
        bajasGuardias: a.bajasGuardias + z.bajasGuardias,
      }),
      { altasMovimientos: 0, altasGuardias: 0, bajasMovimientos: 0, bajasGuardias: 0 }
    );
    assert.deepEqual(
      suma,
      {
        altasMovimientos: datos.altas.movimientos,
        altasGuardias: datos.altas.guardias,
        bajasMovimientos: datos.bajas.movimientos,
        bajasGuardias: datos.bajas.guardias,
      },
      `${anio}: el desglose por zona no suma el total del periodo, así que una de las dos cifras corta el ` +
        'mes de otra forma y las dos se van a citar igual de convencidas'
    );
  });

  test('el desglose por asesor suma EXACTAMENTE las altas y las bajas del periodo', async () => {
    const { anio, datos } = await anioMedible();
    assert.ok(datos.porAsesorDelPeriodo.length > 1, `${anio}: un solo asesor, el cuadre no mide reparto`);

    const suma = datos.porAsesorDelPeriodo.reduce(
      (a, x) => ({
        altasGuardias: a.altasGuardias + x.altasGuardias,
        bajasGuardias: a.bajasGuardias + x.bajasGuardias,
      }),
      { altasGuardias: 0, bajasGuardias: 0 }
    );
    assert.deepEqual(
      suma,
      { altasGuardias: datos.altas.guardias, bajasGuardias: datos.bajas.guardias },
      `${anio}: el desglose por asesor no suma el total del periodo`
    );
    // Y el neto de cada renglón es su alta menos su baja, no otra cuenta.
    for (const x of datos.porAsesorDelPeriodo) {
      assert.equal(x.neto, x.altasGuardias - x.bajasGuardias, `el neto de «${x.clave}» no cuadra`);
    }
  });

  test('una zona del desglose da lo mismo que el filtro de zona de la pantalla de Aperturas', async () => {
    /**
     * El tercer camino, y el que de verdad cierra el cuadre: no comparte código
     * con el desglose. La pantalla de Aperturas calcula el total de su filtro
     * recorriendo los renglones en JavaScript (`resumirlos`), no con un SUM, así
     * que si las dos cifras coinciden es que el corte del mes, el filtro de la
     * carga inicial y el nombre de la zona están entendidos igual en los dos
     * sitios.
     *
     * Se mide sobre UN MES porque es lo que la pantalla sabe filtrar, y el mes se
     * deriva: el del desglose con más altas.
     */
    const { datos: delHistorico } = await correr('movimientos', { todoElHistorico: true });
    const mesConMas = delHistorico.porMesDelPeriodo
      .filter((m) => m.movimientosDeAlta > 0)
      .sort((a, b) => b.guardiasQueEntraron - a.guardiasQueEntraron)[0];
    assert.ok(mesConMas, 'no hay ni un mes con altas: la comprobación no mide nada');

    const { datos } = await correr('movimientos', { desde: mesConMas.periodo, hasta: mesConMas.periodo });
    assert.equal(datos.porZonaDelPeriodoTotal, datos.porZonaDelPeriodo.length, 'el desglose del mes viene recortado');
    const conAltas = datos.porZonaDelPeriodo.filter((z) => z.altasGuardias > 0);
    assert.ok(conAltas.length > 0, `${mesConMas.periodo}: ninguna zona con altas`);

    let medidas = 0;
    for (const z of conAltas) {
      // «SIN ZONA» es la etiqueta que pone el desglose a lo que viene vacío, y la
      // pantalla no tiene un filtro para eso: se salta diciéndolo, en vez de
      // inventarle un filtro que la pantalla no ofrece.
      if (z.clave === 'SIN ZONA') continue;
      const html = await pantalla(
        `/aperturas?periodo=${mesConMas.periodo}&zona=${encodeURIComponent(z.clave)}`
      );
      // La pantalla pinta «+N» guardias del filtro, con el formato de la casa.
      const esperado = `+${formatNumber(z.altasGuardias)}`;
      assert.ok(
        html.includes(esperado),
        `la pantalla de Aperturas de ${mesConMas.periodo} filtrada por «${z.clave}» no pinta ${esperado}, ` +
          'que es lo que el desglose del asistente dice de esa zona'
      );
      medidas += 1;
    }
    assert.ok(medidas > 0, 'ninguna zona se pudo cruzar contra la pantalla');
  });

  test('los dos desgloses dicen qué cuentan, y el de asesor dice QUÉ asesor', async () => {
    const { datos } = await correr('movimientos', { todoElHistorico: true });
    assert.match(datos.porZonaDelPeriodoQueCuenta, /zonas con movimientos/i, datos.porZonaDelPeriodoQueCuenta);
    // La distinción que el director decidió y que no se puede perder: este cuenta
    // al asesor del MOVIMIENTO, y «quién atiende más» es otra pregunta con otro
    // nombre. Confundirlas sería contestar otra cosa sin decirlo.
    assert.match(
      datos.porAsesorDelPeriodoQueCuenta,
      /asesor anotado en el movimiento/i,
      datos.porAsesorDelPeriodoQueCuenta
    );
    assert.match(datos.porAsesorDelPeriodoQueCuenta, /porAsesor/, datos.porAsesorDelPeriodoQueCuenta);
    // Y los dos nombres de clave son distintos, que es la otra mitad del remedio.
    assert.ok(Object.hasOwn(datos, 'porAsesorDelPeriodo'), 'el desglose del periodo cambió de nombre');
    assert.ok(!Object.hasOwn(datos, 'porAsesor'), '«movimientos» estrenó la clave de «quién atiende más»');
  });

  test('desglosar por una columna que no está en la lista cerrada lanza', async () => {
    /**
     * El nombre de la columna NO puede venir de fuera, y la lista cerrada es lo
     * que lo impide. Se prueba contra la función porque `por` es interno: el
     * asistente no lo expone en ningún esquema, y es justamente así como debe
     * quedar. Lanzar y no devolver una lista vacía es a propósito: un desglose
     * vacío se lee como «no hubo movimientos», que es una respuesta falsa.
     */
    const { register } = await import('node:module');
    register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
    const { movimientosAgrupados, AGRUPABLES_VALIDOS } = await import(
      new URL('../lib/movimientos.js', import.meta.url).href
    );

    assert.deepEqual(AGRUPABLES_VALIDOS, ['zona', 'asesor', 'tipo'], 'cambió la lista cerrada de agrupables');
    for (const malo of ['servicio', 'guardias; DROP TABLE aperturas', '', null, undefined, 'ZONA']) {
      assert.throws(
        () => movimientosAgrupados('2026-01', '2026-12', malo),
        /No se puede desglosar/,
        `se aceptó «${malo}» como columna de agrupación`
      );
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('F2 · «buscar_servicio»: el estatus y el valor de lo que se encontró', () => {
  test('un suspendido no sale entre los activos, y la respuesta dice entre quiénes miró', async () => {
    const { datos } = await correr('buscar_servicio', { texto: suspendido.trozo });
    const salio = datos.servicios.some((s) => s.id === suspendido.id);
    assert.ok(
      !salio,
      `el servicio suspendido ${suspendido.id} salió en la búsqueda entre activos: la prueba no distingue nada`
    );
    assert.match(datos.buscadoSoloEntre, /ACTIVO/, datos.buscadoSoloEntre);
    // Y dice cómo pedir los otros: sin eso, el «no lo encontré» sigue siendo un
    // «no» con cara de verdad.
    assert.match(datos.sinBuscarEntre, /SUSPENDIDO/, datos.sinBuscarEntre);
  });

  test('pidiendo SUSPENDIDO sí sale, y la respuesta lo dice', async () => {
    const { datos, ficha } = await correr('buscar_servicio', {
      texto: suspendido.trozo,
      estatus: 'SUSPENDIDO',
    });
    const fila = datos.servicios.find((s) => s.id === suspendido.id);
    assert.ok(fila, `el servicio ${suspendido.id} no sale ni pidiendo los suspendidos`);
    // El estatus viaja en el renglón: sin él, un suspendido y uno en la calle se
    // leen igual, y el suspendido trae importes de un contrato en pausa.
    assert.equal(fila.estatus, 'SUSPENDIDO', 'el renglón no dice que está suspendido');
    assert.match(datos.buscadoSoloEntre, /SUSPENDIDO/, datos.buscadoSoloEntre);
    // La ficha de procedencia también lo dice, y la escribe el servidor.
    assert.match(ficha.dato, /SUSPENDIDO/, ficha.dato);
    assert.ok(!ficha.dato.includes(suspendido.trozo), 'la ficha llevó el texto de búsqueda que eligió el modelo');
  });

  test('un estatus que no se entiende se trata como los activos, y se dice', async () => {
    // Un filtro que no se entendió NO puede acabar en una búsqueda más ancha en
    // silencio: eso convertiría un texto de fuera en permiso para ver lo que no
    // se pidió.
    const { datos } = await correr('buscar_servicio', { texto: suspendido.trozo, estatus: 'LO QUE SEA' });
    assert.match(datos.buscadoSoloEntre, /ACTIVO/, datos.buscadoSoloEntre);
    assert.ok(!datos.servicios.some((s) => s.id === suspendido.id), 'un estatus raro abrió la búsqueda');
    assert.ok(!JSON.stringify(datos).includes('LO QUE SEA'), 'el texto que vino de fuera viajó en el resultado');
  });

  test('los agregados son del filtro completo, no de los renglones que viajan', async () => {
    const { datos } = await correr('buscar_servicio', { texto: '' });
    assert.ok(
      datos.serviciosTotal > datos.servicios.length,
      `la búsqueda trajo ${datos.serviciosTotal} servicios y viajan ${datos.servicios.length}: no viene ` +
        'recortada, así que esta prueba no distingue un agregado bueno de uno sumado sobre la lista'
    );

    const sumaDeLosQueViajan = datos.servicios.reduce((a, s) => a + (s.total_guardias || 0), 0);
    assert.ok(
      datos.agregadosDelFiltro.guardias > sumaDeLosQueViajan,
      `los agregados dicen ${datos.agregadosDelFiltro.guardias} guardias y los renglones que viajan suman ` +
        `${sumaDeLosQueViajan}: el agregado se está sumando sobre la lista recortada y da de menos`
    );
    assert.equal(datos.agregadosDelFiltro.servicios, datos.serviciosTotal, 'el agregado cuenta otros servicios');
    assert.match(datos.agregadosDelFiltroQueCuenta, /no sobre los renglones que viajan/i, datos.agregadosDelFiltroQueCuenta);
  });

  test('los agregados son el renglón que pinta la pantalla de Estado de fuerza', async () => {
    /**
     * El cuadre contra la pantalla espejo, leído del HTML: la pantalla pinta
     * arriba «N servicios · M guardias · $X facturación» de su filtro completo, y
     * lo calcula recorriendo los renglones en JavaScript. Si el agregado del
     * asistente coincide, los dos entienden el filtro igual.
     */
    const { datos } = await correr('buscar_servicio', { texto: '' });
    const html = await pantalla('/estado-fuerza');
    const dicho = html.match(/([\d,]+) servicios · ([\d,]+) guardias/);
    assert.ok(dicho, 'la pantalla de Estado de fuerza no pinta su renglón de totales');
    const numero = (t) => Number(t.replace(/,/g, ''));

    assert.equal(
      datos.agregadosDelFiltro.servicios,
      numero(dicho[1]),
      'los servicios que cuenta el asistente no son los que pinta la pantalla'
    );
    assert.equal(
      datos.agregadosDelFiltro.guardias,
      numero(dicho[2]),
      'los guardias que cuenta el asistente no son los que pinta la pantalla'
    );
  });

  test('con TODOS se miran todos los estatus, y el agregado crece con ellos', async () => {
    const activos = (await correr('buscar_servicio', { texto: '' })).datos;
    const todos = (await correr('buscar_servicio', { texto: '', estatus: 'TODOS' })).datos;
    assert.ok(
      todos.agregadosDelFiltro.servicios > activos.agregadosDelFiltro.servicios,
      'buscar entre TODOS no trae más servicios que buscar entre los activos'
    );
    assert.match(todos.buscadoSoloEntre, /cualquier estatus/i, todos.buscadoSoloEntre);
    // Y avisa de lo que el riesgo de abrirlo trae: un dado de baja arrastra
    // importes y condiciones de un contrato que ya no existe.
    assert.match(todos.sinBuscarEntre, /baja/i, todos.sinBuscarEntre);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('F3 · el ranking de asesores en el espejo del Tablero', () => {
  test('el total es el número de asesores distintos con servicios activos', async () => {
    /**
     * El conteo se cruza contra un camino propio: la lista completa de servicios
     * activos que entrega la API de servicios, contando los asesores distintos
     * aquí. No comparte código con `rankingAsesores()`.
     */
    const { datos } = await correr('resumen_operacion', {});
    const r = await admin.pedir('/api/servicios?estatus=ACTIVO');
    assert.equal(r.status, 200, r.texto);

    const distintos = new Set();
    for (const s of r.json.servicios) {
      let lista = [];
      try {
        lista = JSON.parse(s.asesores_json || '[]');
      } catch {
        lista = [];
      }
      if (!lista.length) lista = [String(s.asesor || '').trim() || 'SIN ASESOR'];
      for (const nombre of lista) distintos.add(nombre || 'SIN ASESOR');
    }

    assert.ok(distintos.size > 1, 'hay un solo asesor en la operación: el ranking no mide nada');
    assert.equal(
      datos.porAsesorTotal,
      distintos.size,
      `el asistente dice ${datos.porAsesorTotal} asesores y la cartera de activos tiene ${distintos.size}`
    );
  });

  test('los asesores y sus guardias son uno a uno los que pinta el Tablero', async () => {
    /**
     * El cuadre con la pantalla espejo, leído del HTML: el Tablero pinta
     * «Asesores por guardias» con el nombre, los servicios y los guardias de cada
     * uno. La pantalla enseña los diez primeros y el asistente manda veinticinco,
     * así que se comprueban uno a uno los que la pantalla sí pinta —en su orden— y
     * se exige que coincidan los dos números de cada renglón.
     */
    const { datos } = await correr('resumen_operacion', {});
    const html = await pantalla('/');
    const bloque = html.split('Asesores por guardias')[1];
    assert.ok(bloque, 'el Tablero no pinta el panel «Asesores por guardias»');
    // Solo el cuerpo de esa tabla, hasta que arranca el panel siguiente.
    const cuerpo = bloque.split('</table>')[0];

    const filas = [...cuerpo.matchAll(
      /<td[^>]*>([^<]+)<\/td><td[^>]*>([\d,]+)<\/td><td[^>]*>([\d,]+)<\/td>/g
    )].map((m) => ({
      asesor: m[1].trim(),
      servicios: Number(m[2].replace(/,/g, '')),
      guardias: Number(m[3].replace(/,/g, '')),
    }));
    assert.ok(filas.length > 1, `el panel del Tablero no dio renglones legibles (${filas.length})`);

    for (let i = 0; i < filas.length; i += 1) {
      const delChat = datos.porAsesor[i];
      assert.ok(delChat, `el Tablero pinta ${filas.length} asesores y el asistente manda ${datos.porAsesor.length}`);
      assert.equal(delChat.asesor, filas[i].asesor, `el asesor ${i + 1} del Tablero no es el del asistente`);
      assert.equal(
        delChat.guardias,
        filas[i].guardias,
        `«${filas[i].asesor}»: el Tablero pinta ${filas[i].guardias} guardias y el asistente ${delChat.guardias}`
      );
      assert.equal(delChat.servicios, filas[i].servicios, `«${filas[i].asesor}»: los servicios no coinciden`);
    }
  });

  test('avisa de que un servicio compartido cuenta entero para cada asesor', async () => {
    const { datos } = await correr('resumen_operacion', {});
    assert.match(datos.porAsesorQueCuenta, /cuenta ENTERO para cada asesor/i, datos.porAsesorQueCuenta);
    assert.match(datos.porAsesorQueCuenta, /más que la operación/i, datos.porAsesorQueCuenta);
    // Y dice que es otra pregunta que la de las altas y bajas por asesor.
    assert.match(datos.porAsesorQueCuenta, /porAsesorDelPeriodo/, datos.porAsesorQueCuenta);
    /**
     * `compartidos` viaja aparte y no se perdió.
     *
     * Es el cuidado que el plan midió: `rankingAsesores()` cuelga `compartidos`
     * como PROPIEDAD DEL ARRAY, no como renglón, y el sitio único de las listas
     * mapea los renglones, así que esa propiedad se habría perdido en silencio.
     * Es justo lo que explica que la columna pueda sumar más que la operación.
     */
    assert.ok(
      Number.isInteger(datos.asesoresCompartidos),
      `«asesoresCompartidos» no viajó como número: ${datos.asesoresCompartidos}. Es la propiedad que el ` +
        'sitio único de las listas pierde si no se lee antes'
    );
    assert.match(datos.asesoresCompartidosQueCuenta, /más de un asesor/i, datos.asesoresCompartidosQueCuenta);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('F4 · el horizonte de vencimientos, en meses', () => {
  test('sin argumento son los mismos 90 días de siempre, los que pinta el Tablero', async () => {
    /**
     * El criterio que importa de F4: sin pedir nada, la respuesta no cambia. Se
     * cruza contra el Tablero, que pinta «Vencen en 90 días» con su propia cuenta.
     *
     * Y por eso el horizonte por omisión siguen siendo 90 DÍAS y no «tres meses»:
     * se midió que no son lo mismo —hoy se diferencian en dos contratos, porque
     * `+90 day` y `+3 month` caen en fechas distintas— y cambiar de unidad por
     * omisión habría movido en silencio la cifra que el asistente ya daba.
     */
    const { datos } = await correr('contratos', {});
    const html = await pantalla('/');
    const dicho = html.match(/Vencen en 90 días<\/p>\s*<span[^>]*>([\d,]+)<\/span>/);
    assert.ok(dicho, 'el Tablero no pinta su cuenta de «Vencen en 90 días»');
    const delTablero = Number(dicho[1].replace(/,/g, ''));

    assert.ok(delTablero > 0, 'el Tablero no tiene ni un contrato por vencer: la comprobación no mide nada');
    assert.equal(
      datos.vencenEnElHorizonteTotal,
      delTablero,
      `el asistente dice ${datos.vencenEnElHorizonteTotal} contratos por vencer y el Tablero ${delTablero}: ` +
        'el horizonte por omisión cambió de lo que era'
    );
    // Y lo dice: sin horizonte pedido, el campo va en nulo en vez de decir «3»,
    // que sería redondear el calendario en una etiqueta.
    assert.equal(datos.horizonteMeses, null, 'sin pedir meses, el resultado afirma un número de meses');
    assert.match(datos.horizonteQueCuenta, /90 días/, datos.horizonteQueCuenta);
  });

  test('con 24 meses el total crece y ninguna fecha se sale del horizonte', async () => {
    const corto = (await correr('contratos', {})).datos;
    const { datos } = await correr('contratos', { mesesDeHorizonte: 24 });

    assert.ok(
      datos.vencenEnElHorizonteTotal > corto.vencenEnElHorizonteTotal,
      `con 24 meses salen ${datos.vencenEnElHorizonteTotal} y con el horizonte de siempre ` +
        `${corto.vencenEnElHorizonteTotal}: el argumento no está haciendo nada`
    );
    assert.equal(datos.horizonteMeses, 24, 'el resultado no dice el horizonte que se pidió');
    assert.match(datos.horizonteHasta, /^\d{4}-\d{2}-\d{2}$/, datos.horizonteHasta);

    // NINGUNA fecha fuera, comprobada contra el corte que el propio resultado
    // declara y no contra una fecha escrita a mano.
    const hoy = new Date().toISOString().slice(0, 10);
    for (const s of datos.vencenEnElHorizonte) {
      assert.ok(
        s.fecha_vencimiento_contrato >= hoy && s.fecha_vencimiento_contrato <= datos.horizonteHasta,
        `viajó un contrato que vence el ${s.fecha_vencimiento_contrato}, fuera del horizonte que dice cubrir ` +
          `(${hoy} a ${datos.horizonteHasta})`
      );
    }
  });

  test('ninguna clave ni ninguna cadena dice «90 días» cuando el horizonte no es ése', async () => {
    const { datos } = await correr('contratos', { mesesDeHorizonte: 24 });
    const texto = JSON.stringify(datos);
    assert.ok(
      !/90\s*d[ií]as/i.test(texto),
      'con un horizonte de 24 meses el resultado sigue diciendo «90 días» en algún sitio: es una etiqueta ' +
        'que miente, que es justo lo que esta vuelta viene a quitar'
    );
    assert.ok(!Object.hasOwn(datos, 'vencenEn90Dias'), 'la clave vieja sigue ahí con un horizonte de 24 meses');
    assert.ok(!Object.hasOwn(datos, 'vencenEn90DiasTotal'), 'el total de la clave vieja sigue ahí');
  });

  test('un horizonte imposible se trata como si no se hubiera pedido', async () => {
    // Lo que llega de fuera se acota antes de usarlo, y lo que no se entiende cae
    // en el caso de siempre: ni revienta ni abre un horizonte que nadie pidió.
    const siempre = (await correr('contratos', {})).datos;
    for (const meses of [0, -5, 999, 3.7, 'doce', null]) {
      const { datos } = await correr('contratos', { mesesDeHorizonte: meses });
      assert.equal(
        datos.vencenEnElHorizonteTotal,
        siempre.vencenEnElHorizonteTotal,
        `«${meses}» como horizonte cambió la respuesta en vez de caer en el de siempre`
      );
      assert.ok(!JSON.stringify(datos).includes('doce'), 'el texto que vino de fuera viajó en el resultado');
    }
  });

  test('los ya vencidos no dependen del horizonte: ya pasaron', async () => {
    const corto = (await correr('contratos', {})).datos;
    const largo = (await correr('contratos', { mesesDeHorizonte: 36 })).datos;
    assert.equal(
      corto.yaVencidosTotal,
      largo.yaVencidosTotal,
      'los contratos ya vencidos cambiaron al mover el horizonte hacia delante'
    );
    assert.match(largo.horizonteQueCuenta, /yaVencidos/, largo.horizonteQueCuenta);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('el inventario sigue en siete y nada de esto escribe', () => {
  test('las cuatro funciones son argumentos y campos, no consultas nuevas', async () => {
    /**
     * No duplica las tres pruebas que fijan el inventario —esas siguen en verde
     * sin tocarlas— sino que comprueba lo que a este plan le toca: que las cuatro
     * funciones llegaron por donde se dijo. Si alguna hubiera necesitado una
     * consulta número ocho, eso era un desvío y no una licencia.
     */
    const { register } = await import('node:module');
    register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
    const { HERRAMIENTAS } = await import(new URL('../lib/chat-herramientas.js', import.meta.url).href);

    assert.equal(HERRAMIENTAS.length, 7, 'el inventario de consultas dejó de ser siete');
    const porNombre = Object.fromEntries(HERRAMIENTAS.map((h) => [h.nombre, h]));
    // Los dos argumentos nuevos, cada uno en la consulta que ya existía.
    assert.ok(porNombre.buscar_servicio.esquema.properties.estatus, '«buscar_servicio» no estrenó «estatus»');
    assert.ok(porNombre.contratos.esquema.properties.mesesDeHorizonte, '«contratos» no estrenó el horizonte');
    // Y los dos que son campos y no argumentos: ni «movimientos» ni
    // «resumen_operacion» estrenan nada que haya que pedir.
    assert.deepEqual(
      Object.keys(porNombre.movimientos.esquema.properties).sort(),
      ['desde', 'hasta', 'periodo', 'todoElHistorico'],
      '«movimientos» estrenó un argumento que el plan no pedía'
    );
    assert.deepEqual(
      Object.keys(porNombre.resumen_operacion.esquema.properties),
      [],
      '«resumen_operacion» estrenó un argumento'
    );
    // Los siete permisos, intactos: ninguna función nueva amplió una frontera.
    assert.deepEqual(
      HERRAMIENTAS.map((h) => h.permiso),
      ['ver', 'ver', 'ver', 'ver', 'ver', 'ver', 'editar_finanzas'],
      'cambió el permiso de alguna consulta'
    );
  });
});
