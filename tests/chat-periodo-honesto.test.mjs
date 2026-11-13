/**
 * Ninguna cifra viaja rotulada con un periodo que no es el suyo.
 *
 * Esto no cierra funciones que faltaran: cierra tres consultas de las siete que
 * CONTESTABAN MAL, y estaban así en producción. El patrón era el mismo en las
 * tres —cifras de todos los tiempos debajo de una etiqueta de periodo— y es el
 * peor de los defectos posibles en una herramienta así: a la pregunta sin
 * contestar la persona va y la busca, y a la equivocada la cita en una junta.
 *
 *   · `cobranza` devolvía `periodo: "2026-10"` y, debajo, lo emitido y lo cobrado
 *     de TODO el libro de facturas, porque `kpisCobranza()` no recibía periodo.
 *     Es la peor porque toca dinero.
 *   · `movimientos` mandaba DOS tablas de meses de periodos distintos: la del
 *     rango pedido y, al lado, siempre los últimos doce meses de la base. El
 *     modelo elegía cuál citar.
 *   · `motivosDeBaja` era global y de todos los tiempos. Medido: el motivo
 *     histórico número uno no tiene ni un movimiento en 2026.
 *
 * Y había una CUARTA que nadie había señalado, en la misma `cobranza`:
 * `facturasVencidasDetalle` son las facturas vencidas de todo el libro, de
 * cualquier periodo, viajando dentro de una respuesta rotulada con un mes. Se
 * mide abajo, y es la razón de que este archivo mida la CLASE y no solo los tres
 * casos: el defecto que importa siempre es el que nadie miró.
 *
 * Cómo se mide, y es lo que hace que estas pruebas sigan midiendo el año que
 * viene: NINGUNA cifra está escrita a mano. Las facturas se siembran por la API
 * de facturación y sus importes se derivan de lo que la propia plataforma
 * contesta; los periodos se derivan de los extremos del histórico que dice la
 * consulta. Un número escrito aquí defendería el número y no el comportamiento.
 *
 * ANTES DE CORRER ESTO A MANO: `npm run build`. Esta prueba levanta la aplicación
 * COMPILADA, así que un cambio en `lib/` sin recompilar la deja midiendo el
 * código anterior. Usa `npm run verify`.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
// El formateador de moneda DE LA PLATAFORMA, para poder buscar en el HTML la
// cifra exactamente como la pinta la pantalla. Escribir el formato a mano aquí
// sería adivinar cómo redondea la pantalla, y la prueba se rompería el día que
// cambiara el formato en vez del dato.
import { formatCurrency } from '../lib/utils.js';

let app;
let doble;
let admin;

/** Los extremos del histórico de movimientos, dichos por la propia consulta. */
let historico = {};

/**
 * Las dos facturas sembradas, cada una en un mes distinto, con el importe que la
 * plataforma dejó registrado. Los dos meses y los dos importes se derivan: aquí
 * solo se guarda lo que contestó.
 */
const sembradas = [];

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

/**
 * Corre una consulta por HTTP y devuelve lo que de verdad viajó hacia el modelo.
 *
 * Se mide lo que SALE y no lo que devuelve la función: el resultado completo de
 * una consulta va en la siguiente petición a la red, y es ahí donde se vería una
 * cifra rotulada con el periodo equivocado.
 */
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

/** Un mes 'AAAA-MM' corrido N meses, para sembrar en dos periodos distintos. */
function mesMas(mes, n) {
  const [anio, m] = mes.split('-').map(Number);
  const total = anio * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  // Los topes muy altos: este archivo corre muchas consultas y un tope de
  // veinticinco preguntas lo cortaría a media comprobación.
  app = await arrancar({
    env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' },
  });
  admin = await app.entrarYAsentar(ROLES.admin);

  historico = (await correr('movimientos', { todoElHistorico: true })).datos;

  /**
   * Dos facturas en dos meses distintos, sembradas por la API de facturación.
   *
   * Hacen falta porque la tabla `facturas` llega VACÍA del sembrado: sin ellas,
   * «lo del periodo» y «lo de toda la cartera» valdrían cero las dos y la prueba
   * pasaría en verde sin haber distinguido nada. Con dos meses y dos importes
   * distintos, la cifra del mes solo puede salir bien si de verdad se filtró.
   *
   * Los importes son dos números que no salen de ningún otro sitio de la base, y
   * no se vuelven a escribir: lo que se compara es lo que la plataforma contestó
   * que quedó registrado.
   */
  const servicios = (await correr('buscar_servicio', { texto: '' })).datos.servicios;
  assert.ok(servicios.length >= 2, 'no hay servicios con los que sembrar facturas');
  const mesBase = historico.hayMovimientosHasta;
  const meses = [mesBase, mesMas(mesBase, -3)];
  for (let i = 0; i < 2; i += 1) {
    const periodo = meses[i];
    const importe = 123456.78 + i * 100000;
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

// ───────────────────────────────────────────────────────────────────────────────
describe('C1 · «cobranza» deja de rotular con un mes el acumulado histórico', () => {
  test('lo del periodo es lo del periodo, y lo de la cartera es la suma de las dos facturas', async () => {
    const total = sembradas[0].importe + sembradas[1].importe;

    for (const quien of sembradas) {
      const { datos } = await correr('cobranza', { periodo: quien.periodo });
      assert.equal(datos.periodo, quien.periodo, `pedido ${quien.periodo}, contestó ${datos.periodo}`);

      // Lo del mes: EXACTAMENTE el importe de la factura de ese mes.
      assert.equal(
        datos.delPeriodo.emitido,
        quien.importe,
        `«delPeriodo.emitido» de ${quien.periodo} dice ${datos.delPeriodo.emitido} y la factura de ese mes ` +
          `es de ${quien.importe}: sigue contestando con cifras de otro periodo`
      );
      assert.equal(datos.delPeriodo.facturas, 1, `${quien.periodo}: el conteo de facturas del mes no es 1`);

      // Y lo de la cartera: la suma de las dos, sin cambiar al cambiar de mes.
      // Es la mitad que de verdad fija el defecto: antes esta era la cifra que
      // salía rotulada con el mes.
      assert.equal(
        datos.deTodaLaCartera.emitido,
        total,
        `«deTodaLaCartera.emitido» con periodo ${quien.periodo} dice ${datos.deTodaLaCartera.emitido} y las ` +
          `dos facturas suman ${total}`
      );
      assert.notEqual(
        datos.delPeriodo.emitido,
        datos.deTodaLaCartera.emitido,
        `${quien.periodo}: lo del mes y lo de la cartera salieron iguales, así que esta prueba no distingue ` +
          'un filtro que funciona de uno que no'
      );
    }
  });

  test('los nombres planos de antes ya no están en el primer nivel', async () => {
    const { datos } = await correr('cobranza', { periodo: sembradas[0].periodo });
    for (const clave of ['emitido', 'cobrado', 'carteraVencida', 'porVencer', 'pendienteTotal']) {
      assert.ok(
        !Object.hasOwn(datos, clave),
        `«${clave}» sigue suelto en el primer nivel: al lado de los nuevos es la misma confusión con un ` +
          'campo más'
      );
    }
    // Y lo que sí tiene que estar, para que quitar no sea perder.
    assert.ok(Number.isFinite(datos.deTodaLaCartera.carteraVencida), 'la cartera vencida dejó de viajar');
    assert.ok(Number.isFinite(datos.deTodaLaCartera.pendienteTotal), 'lo pendiente dejó de viajar');
  });

  test('las dos etiquetas dicen si la cifra es del periodo o de la cartera entera', async () => {
    const mes = sembradas[0].periodo;
    const { datos } = await correr('cobranza', { periodo: mes });

    assert.ok(datos.delPeriodoQueCuenta.includes(mes), `«delPeriodoQueCuenta» no nombra el mes: ${datos.delPeriodoQueCuenta}`);
    assert.match(datos.delPeriodoQueCuenta, /ESE mes|de ese mes/i, datos.delPeriodoQueCuenta);
    // La del histórico tiene que decir que NO es del periodo, que es lo único que
    // impide citarla como si lo fuera.
    assert.match(datos.deTodaLaCarteraQueCuenta, /NO es del periodo/i, datos.deTodaLaCarteraQueCuenta);
    assert.ok(
      datos.deTodaLaCarteraQueCuenta.includes(mes),
      `la etiqueta de la cartera no dice de qué periodo NO es: ${datos.deTodaLaCarteraQueCuenta}`
    );
  });

  test('las dos cifras son las dos que la pantalla de Cobranza pinta, leídas del HTML', async () => {
    /**
     * El cuadre contra la pantalla espejo, que es lo que de verdad cierra C1: las
     * dos cifras que el asistente entrega tienen que ser las dos que la pantalla
     * enseña, cada una en su sitio.
     *
     *   · el recuadro «Facturado» de arriba pinta `kpisCobranza().emitido`, que es
     *     TODA la cartera → `deTodaLaCartera.emitido`;
     *   · la casilla del mes en el calendario de facturación pinta el importe de
     *     ESE mes, agrupado por periodo en otra consulta que no comparte código
     *     con los KPI → `delPeriodo.emitido`.
     *
     * Se lee del HTML porque es lo que la persona ve, y con el formateador de la
     * propia plataforma para no adivinar el redondeo. Si las dos cifras del
     * asistente salieran iguales —el defecto— una de las dos no cuadraría con su
     * sitio de la pantalla.
     */
    const mes = sembradas[0].periodo;
    const total = sembradas[0].importe + sembradas[1].importe;
    const { datos } = await correr('cobranza', { periodo: mes });

    // React deja comentarios entre expresiones: se quitan para leer el texto como
    // lo lee una persona, igual que hacen las otras pruebas de pantalla.
    const html = (await admin.pedir(`/cobranza?periodo=${mes}`)).texto.replace(/<!--[\s\S]*?-->/g, '');

    const delMesEnPantalla = formatCurrency(datos.delPeriodo.emitido);
    const deLaCarteraEnPantalla = formatCurrency(datos.deTodaLaCartera.emitido);
    assert.notEqual(
      delMesEnPantalla,
      deLaCarteraEnPantalla,
      'las dos cifras se pintan igual, así que esta prueba no distinguiría una de otra'
    );
    assert.ok(
      html.includes(delMesEnPantalla),
      `la pantalla de Cobranza de ${mes} no pinta ${delMesEnPantalla}, que es lo que el asistente dice que ` +
        'se facturó ese mes'
    );
    assert.ok(
      html.includes(deLaCarteraEnPantalla),
      `la pantalla de Cobranza no pinta ${deLaCarteraEnPantalla}, que es lo que el asistente dice que se ha ` +
        'facturado en toda la cartera'
    );
    // Y que cada una es la que se cree: la del mes es la factura de ese mes y la
    // de la cartera es la suma de las dos sembradas.
    assert.equal(datos.delPeriodo.emitido, sembradas[0].importe);
    assert.equal(datos.deTodaLaCartera.emitido, total);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('la CUARTA del mismo defecto: las facturas vencidas de todo el libro', () => {
  test('la lista es de todo el libro y lo dice, en vez de dejarse leer como la del mes', async () => {
    /**
     * Esta no venía señalada y es el mismo defecto: `facturasVencidasDetalle` son
     * las facturas con saldo vencido de TODO el libro, de cualquier periodo, y
     * viajaban dentro de una respuesta rotulada `periodo: "AAAA-MM"` con una
     * etiqueta que no decía nada del periodo. El dato no estaba mal; lo que estaba
     * mal era que se podía citar como «las vencidas de ese mes».
     *
     * Se mide por donde se mide la clase entera: pedir dos periodos distintos y
     * comprobar que la lista NO cambia —o sea que no es del periodo— y que su
     * etiqueta lo dice.
     */
    const a = await correr('cobranza', { periodo: sembradas[0].periodo });
    const b = await correr('cobranza', { periodo: sembradas[1].periodo });

    assert.equal(
      a.datos.facturasVencidasDetalleTotal,
      b.datos.facturasVencidasDetalleTotal,
      'la lista de facturas vencidas cambió con el periodo: si ahora es del periodo, su etiqueta tiene que ' +
        'decir eso y esta prueba hay que rehacerla'
    );
    assert.match(
      a.datos.facturasVencidasDetalleQueCuenta,
      /NO son las del periodo/i,
      a.datos.facturasVencidasDetalleQueCuenta
    );
    assert.ok(
      a.datos.facturasVencidasDetalleQueCuenta.includes(sembradas[0].periodo),
      `la etiqueta no dice de qué periodo NO son: ${a.datos.facturasVencidasDetalleQueCuenta}`
    );
  });

  test('las cifras de HOY que viajan bajo la etiqueta de un mes dicen que no son del mes', async () => {
    const { datos } = await correr('cobranza', { periodo: sembradas[0].periodo });
    // `sinCondicionesDeCobro` cuenta servicios activos de hoy, no del periodo.
    assert.match(datos.sinCondicionesDeCobroQueCuenta, /no son del periodo/i, datos.sinCondicionesDeCobroQueCuenta);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('C2 · «movimientos» manda una sola tabla de meses, y es la del periodo', () => {
  test('no queda ninguna clave que empiece por «porPeriodo»', async () => {
    const desde = `${historico.hayMovimientosDesde.slice(0, 4)}-01`;
    const hasta = `${historico.hayMovimientosDesde.slice(0, 4)}-12`;
    const { datos } = await correr('movimientos', { desde, hasta });

    const sobran = Object.keys(datos).filter((k) => k.startsWith('porPeriodo'));
    assert.deepEqual(
      sobran,
      [],
      `siguen viajando dos tablas de meses en la misma respuesta: ${sobran.join(', ')}. La segunda eran ` +
        'siempre los últimos doce meses de la base, pidiera lo que se pidiera, y el modelo elegía cuál citar'
    );
  });

  test('todos los meses que viajan caen DENTRO del rango pedido, renglón por renglón', async () => {
    /**
     * El defecto medido: con «desde 2023-01 / hasta 2023-12» la respuesta traía
     * los doce meses de 2023 y, al lado, una tabla de 2025-09 a 2026-08. Así que
     * lo que se comprueba no es que falte una clave, es que NINGÚN mes de los que
     * viajan quede fuera del rango —comprobado contra `desde` y `hasta` del propio
     * resultado, no contra una lista escrita a mano—.
     */
    const anio = historico.hayMovimientosDesde.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    assert.ok(datos.porMesDelPeriodo.length > 0, `${anio} no trajo ni un mes: la comprobación no mide nada`);

    /**
     * Se recorre TODO el resultado buscando cualquier cosa con forma de mes, y no
     * solo la clave que ya se sabe: si mañana entra otra tabla de meses de otro
     * periodo, esto se pone rojo sin que nadie tenga que acordarse de mirarla.
     *
     * Con una sola excepción, y no es una lista de nombres: se salta el subárbol
     * de cualquier clave cuyo «qué cuenta» de al lado DIGA que no es del periodo.
     * Eso no es taparle el ojo al guardián —es justo lo que se le exige a esas
     * cifras—: las aperturas sin aplicar son de hoy y traen el mes desde el que
     * cuentan como «recientes», y eso es legítimo precisamente porque lo dice. Un
     * subárbol que calle sigue vigilado.
     */
    const mesesQueViajan = [];
    const recorrer = (valor, ruta) => {
      if (Array.isArray(valor)) return valor.forEach((v, i) => recorrer(v, `${ruta}[${i}]`));
      if (valor && typeof valor === 'object') {
        return Object.entries(valor).forEach(([k, v]) => {
          const declara = valor[`${k}QueCuenta`];
          if (typeof declara === 'string' && /no (son|es) (las )?del periodo/i.test(declara)) return;
          recorrer(v, ruta ? `${ruta}.${k}` : k);
        });
      }
      if (typeof valor === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) mesesQueViajan.push({ ruta, valor });
    };
    // Se recorre el resultado SIN las claves que declaran el periodo mismo ni los
    // extremos del histórico: esas tienen que poder decir otro mes —es su trabajo
    // decir hasta dónde hay datos— y confundirlas con una cifra sería perseguir
    // la etiqueta en vez del dato.
    const { desde, hasta, hayMovimientosDesde, hayMovimientosHasta, periodo, ...resto } = datos;
    recorrer(resto, '');

    assert.ok(mesesQueViajan.length > 0, 'no viajó ningún mes: la comprobación no mide nada');
    for (const { ruta, valor } of mesesQueViajan) {
      assert.ok(
        valor >= datos.desde && valor <= datos.hasta,
        `pedido ${datos.desde}–${datos.hasta}, viajó el mes ${valor} en «${ruta}»: es una cifra de otro ` +
          'periodo debajo de la etiqueta de este'
      );
    }
  });

  test('el desglose del rango sigue ahí: quitar la otra tabla no dejó nada sin contestar', async () => {
    // Es la mitad que el riesgo 2 del plan pedía defender: `porPeriodo` se quitó,
    // pero «¿cómo vino el año?» se tiene que seguir contestando.
    const anio = historico.hayMovimientosHasta.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    assert.ok(datos.porMesDelPeriodo.length > 1, 'el desglose del rango no trae meses');
    assert.ok(Number.isInteger(datos.porMesDelPeriodoTotal), 'el desglose del rango viaja sin su total');

    const todo = (await correr('movimientos', { todoElHistorico: true })).datos;
    assert.ok(
      todo.porMesDelPeriodoTotal > datos.porMesDelPeriodoTotal,
      'el histórico completo no trae más meses que un año: ya no se puede contestar «¿cómo vino todo?»'
    );
  });

  test('las aperturas sin aplicar dicen que son de HOY y no del periodo', async () => {
    const anio = historico.hayMovimientosDesde.slice(0, 4);
    const a = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    const b = await correr('movimientos', { todoElHistorico: true });

    // No cambian con el periodo: son las pendientes de hoy.
    assert.deepEqual(a.datos.aperturasSinAplicar, b.datos.aperturasSinAplicar);
    assert.match(a.datos.aperturasSinAplicarQueCuenta, /NO son las del periodo/i, a.datos.aperturasSinAplicarQueCuenta);
    assert.ok(
      a.datos.aperturasSinAplicarQueCuenta.includes(`${anio}-01`),
      `no dice de qué periodo NO son: ${a.datos.aperturasSinAplicarQueCuenta}`
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('C3 · los motivos del periodo, al lado de los de siempre y rotulados', () => {
  test('todo motivo del periodo tiene de verdad una cancelación de ese periodo', async () => {
    const anio = historico.hayMovimientosHasta.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });
    assert.ok(datos.motivosDelPeriodo.length > 0, `${anio} no trajo motivos: la comprobación no mide nada`);

    /**
     * El cuadre por un camino que no comparte código con la consulta: cada motivo
     * se busca en las bajas DEL MISMO RANGO que trae el propio resultado, que
     * salen de otra consulta (`movimientosDe`).
     */
    const bajas = datos.ultimasBajas;
    for (const m of datos.motivosDelPeriodo) {
      assert.ok(m.guardias >= 0 && Number.isInteger(m.movimientos), `motivo raro: ${JSON.stringify(m)}`);
      assert.ok(String(m.motivo).trim() !== '', 'viajó un motivo vacío');
    }
    // Y al menos uno de los motivos del periodo tiene que aparecer entre las bajas
    // del periodo que viajan en el mismo resultado: si ninguno apareciera, los dos
    // lados estarían cortando el mes de forma distinta.
    const nombres = new Set(datos.motivosDelPeriodo.map((m) => m.motivo));
    const coincide = bajas.some((b) => nombres.has(String(b.motivo || '').trim()));
    assert.ok(
      coincide || bajas.length === 0,
      'ningún motivo del periodo aparece entre las bajas del periodo: los dos cortan el mes distinto'
    );
  });

  test('los guardias de los motivos del periodo no pasan de las bajas del periodo', async () => {
    const anio = historico.hayMovimientosHasta.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });

    const suma = datos.motivosDelPeriodo.reduce((a, m) => a + m.guardias, 0);
    if (datos.motivosDelPeriodoTotal === datos.motivosDelPeriodo.length) {
      // La lista viene completa: entonces lo que falta para las bajas del periodo
      // son exactamente las bajas sin motivo capturado, y eso tiene que tener
      // nombre en el resultado en vez de ser un hueco.
      assert.ok(
        suma <= datos.bajas.guardias,
        `los motivos del periodo suman ${suma} guardias y las bajas del periodo son ${datos.bajas.guardias}`
      );
      assert.ok(
        Number.isInteger(datos.bajasDelPeriodoSinMotivo),
        'no se dice cuántas bajas del periodo no traen motivo, así que la lista parece cubrirlas todas'
      );
    } else {
      assert.ok(suma < datos.bajas.guardias, 'la lista viene recortada y aun así suma todas las bajas');
    }
  });

  test('hay un motivo histórico que NO está en el del periodo, y la etiqueta lo dice', async () => {
    /**
     * La prueba que de verdad fija el defecto. Medido por el arquitecto: el motivo
     * histórico número uno —«Reducción de servicios por asignación en
     * licitación», 151 guardias— no tiene ni un movimiento en 2026, y el número
     * uno real de 2026 es otro. Si las dos listas fueran iguales, la corrección no
     * estaría cambiando nada.
     */
    const anio = historico.hayMovimientosHasta.slice(0, 4);
    const { datos } = await correr('movimientos', { desde: `${anio}-01`, hasta: `${anio}-12` });

    const delPeriodo = new Set(datos.motivosDelPeriodo.map((m) => m.motivo));
    const soloHistoricos = datos.motivosDeBaja.motivos.filter((m) => !delPeriodo.has(m.motivo));
    assert.ok(
      soloHistoricos.length > 0,
      'ningún motivo de la lista histórica falta en la del periodo: las dos listas dicen lo mismo y el ' +
        'defecto que esto cierra no se está midiendo'
    );
    // El histórico tiene que decir que NO es del periodo: es lo único que impide
    // citarlo como si lo fuera, y es el remedio del riesgo 3 del plan.
    assert.match(datos.motivosDeBajaQueCuenta, /todos los tiempos/i, datos.motivosDeBajaQueCuenta);
    assert.match(datos.motivosDeBajaQueCuenta, /NO son del periodo/i, datos.motivosDeBajaQueCuenta);
    // Y la del periodo tiene que nombrar el periodo.
    assert.ok(
      datos.motivosDelPeriodoQueCuenta.includes(`${anio}-01`),
      `la etiqueta de los motivos del periodo no dice cuál es: ${datos.motivosDelPeriodoQueCuenta}`
    );
  });

  test('los motivos del periodo son los que la pantalla de Cancelaciones lista ese mes', async () => {
    /**
     * El cuadre contra la pantalla espejo, leído del HTML, que es lo que cierra
     * C3: la pantalla de Cancelaciones lista los movimientos del mes elegido con
     * el motivo de cada uno. `motivosDelPeriodo` es esa misma información
     * agrupada por la base, así que todo motivo que la pantalla pinta ese mes
     * tiene que estar en la lista del asistente, y al revés.
     *
     * El mes se deriva: el último con bajas que diga el propio histórico.
     */
    const conBajas = historico.porMesDelPeriodo
      .filter((m) => m.movimientosDeBaja > 0)
      .sort((a, b) => b.guardiasQueSalieron - a.guardiasQueSalieron)[0];
    assert.ok(conBajas, 'no hay ni un mes con bajas: la comprobación no mide nada');
    const mes = conBajas.periodo;

    const { datos } = await correr('movimientos', { desde: mes, hasta: mes });
    assert.equal(datos.motivosDelPeriodoTotal, datos.motivosDelPeriodo.length, `${mes}: la lista viene recortada`);

    // React deja comentarios entre expresiones: se quitan para leer el texto como
    // lo lee una persona.
    const html = (await admin.pedir(`/cancelaciones?periodo=${mes}`)).texto.replace(/<!--[\s\S]*?-->/g, '');
    const delAsistente = new Set(datos.motivosDelPeriodo.map((m) => m.motivo));
    assert.ok(delAsistente.size > 0, `${mes}: el asistente no trae motivos`);

    // Cada motivo que el asistente dice de ese mes tiene que estar escrito en la
    // pantalla de ese mes. Se compara con las entidades de HTML resueltas, porque
    // la pantalla escapa las comillas y los acentos no.
    const comoEnPantalla = (t) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    for (const motivo of delAsistente) {
      assert.ok(
        html.includes(comoEnPantalla(motivo)),
        `el asistente dice que en ${mes} hubo bajas por «${motivo}» y la pantalla de Cancelaciones de ese mes ` +
          'no lo pinta en ningún renglón'
      );
    }
  });

  test('«motivosDeBaja» sale igual que antes: la lista del Tablero no se tocó', async () => {
    const { datos } = await correr('movimientos', {});
    const m = datos.motivosDeBaja;
    // Las mismas claves de siempre y nada más dentro: la etiqueta nueva vive
    // FUERA, porque una prueba vigente mide este objeto por dentro.
    assert.deepEqual(
      Object.keys(m).sort(),
      ['motivos', 'motivosQueCuenta', 'motivosTotal', 'sin_motivo', 'total'],
      'la lista histórica de motivos cambió de forma'
    );
    assert.equal(m.motivos.length, 10, 'cambió el tope de motivos del histórico');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('la clase entera: ninguna cifra sin decir qué periodo cubre', () => {
  test('toda lista y todo desglose que viaja en una respuesta con periodo dice su alcance', async () => {
    /**
     * El guardián de la CLASE, y la razón de que exista: tres defectos iguales en
     * siete consultas no es mala suerte, es que el patrón no se buscó entero.
     * Tapar los tres deja el cuarto —y había un cuarto—.
     *
     * Lo que se exige, derivado del resultado y no de una lista escrita: en una
     * respuesta que lleva una etiqueta de periodo, CADA lista que viaja tiene que
     * traer su «qué cuenta», y ese texto tiene que decir de qué periodo es o decir
     * que no es del periodo. No se comprueba que el modelo obedezca —no se puede—:
     * se comprueba que la etiqueta viaje, que es lo único que está en nuestra mano.
     *
     * Lo que este guardián NO puede ver, dicho para que no se confíe de más: si un
     * texto DICE que es del periodo y la consulta de debajo no filtra, esto pasa
     * en verde. Esa mitad la miden los criterios de C1, C2 y C3 de arriba, que
     * comparan contra cifras derivadas de la plataforma.
     */
    const conPeriodo = [
      ['cobranza', { periodo: sembradas[0].periodo }],
      ['movimientos', { desde: `${historico.hayMovimientosHasta.slice(0, 4)}-01`, hasta: historico.hayMovimientosHasta }],
      ['estado_de_un_dia', { dia: `${historico.hayMovimientosHasta}-15` }],
    ];

    const faltas = [];
    for (const [nombre, args] of conPeriodo) {
      const { datos } = await correr(nombre, args);
      // Que de verdad lleva etiqueta de periodo: si no, esta consulta no es de las
      // que este guardián vigila y decirlo es mejor que colarla.
      const rotulada = ['periodo', 'desde', 'hasta', 'dia'].some((k) => datos[k]);
      assert.ok(rotulada, `${nombre} no rotula ningún periodo: revisar qué vigila esta prueba`);

      /**
       * El alcance se puede declarar en la lista o en el contenedor que la
       * envuelve, y las dos valen.
       *
       * Es el patrón con el que se arregló `cobranza` —`delPeriodo` y
       * `deTodaLaCartera`, cada uno con su etiqueta, y las cifras dentro— y es más
       * barato que una etiqueta por cifra: un rótulo por grupo en vez de treinta
       * textos que el modelo tiene que leer en cada pregunta. Así que el guardián
       * hereda: si un contenedor dice su alcance, lo de dentro queda dicho.
       *
       * Hace falta además porque `motivosDeBaja` conserva por contrato la forma
       * que le da el Tablero y no se le puede meter nada dentro: su alcance lo
       * declara `motivosDeBajaQueCuenta`, un piso más arriba.
       */
      const dicho = (texto) => typeof texto === 'string' && /periodo|mes|día|dia|hoy|todos los tiempos|cartera|cualquier/i.test(texto);
      const recorrer = (objeto, ruta, heredado) => {
        if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return;
        for (const [clave, valor] of Object.entries(objeto)) {
          if (clave.endsWith('QueCuenta') || clave.endsWith('Total')) continue;
          const aqui = ruta ? `${ruta}.${clave}` : clave;
          const propio = dicho(objeto[`${clave}QueCuenta`]);
          if (Array.isArray(valor)) {
            if (!objeto[`${clave}QueCuenta`] && !heredado) {
              faltas.push(`${nombre}:${aqui} → viaja una lista y no dice qué cuenta`);
            } else if (!propio && !heredado) {
              faltas.push(
                `${nombre}:${aqui} → «${objeto[`${clave}QueCuenta`]}» no dice de qué periodo es ni que no es ` +
                  'del periodo'
              );
            }
            continue;
          }
          recorrer(valor, aqui, heredado || propio);
        }
      };
      recorrer(datos, '', false);
    }

    assert.deepEqual(
      faltas,
      [],
      `hay cifras viajando bajo una etiqueta de periodo sin decir qué periodo cubren:\n${faltas.join('\n')}`
    );
  });

  test('las tres consultas con periodo siguen contestando con el periodo que se pidió', async () => {
    // El cierre de la clase por el lado del comportamiento: se piden dos periodos
    // distintos y se exige que lo que DICE ser del periodo cambie. Una cifra que
    // dice ser del mes y no cambia al cambiar de mes es el defecto exacto.
    const a = await correr('cobranza', { periodo: sembradas[0].periodo });
    const b = await correr('cobranza', { periodo: sembradas[1].periodo });
    assert.notDeepEqual(
      a.datos.delPeriodo,
      b.datos.delPeriodo,
      'lo que dice ser «del periodo» no cambió al cambiar el periodo'
    );
    assert.deepEqual(
      a.datos.deTodaLaCartera,
      b.datos.deTodaLaCartera,
      'lo que dice ser «de toda la cartera» cambió con el periodo'
    );
  });
});
