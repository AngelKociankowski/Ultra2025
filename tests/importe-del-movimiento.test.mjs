/**
 * El importe mensual cuando se mueve la plantilla: se pregunta, no se calcula.
 *
 * El defecto que esto cubre lo reportó operaciones: tres servicios de 2 guardias
 * y $45,356 al mes, a dos se les aplicó una reducción de un guardia, la
 * plantilla bajó a 1 y el importe se quedó en $45,356. Si cobranza factura ese
 * mes, cobra el doble.
 *
 * Y lo que estas pruebas defienden con el mismo cuidado es lo que NO se hizo:
 * recalcular el importe en proporción a los guardias. El bloque `M` lo mide
 * sobre `data/seed.json` en cada corrida, derivando el número de los datos en
 * vez de traerlo escrito a mano —la lección de la decisión 5-bis—, y afirma la
 * conclusión que justifica la decisión: el precio NO sigue a la plantilla, así
 * que el proporcional sería un número equivocado con cara de bueno en la mayoría
 * de los casos.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { arrancar, ROLES } from './servidor.mjs';
import { RESPUESTAS_IMPORTE, proporcionalDeReferencia } from '../lib/importe-del-movimiento.js';

let app;
let admin;
let opciones;

/** Los dos números del reporte de operaciones, para hablar de lo mismo. */
const IMPORTE = 45356;
const SIN_IVA = 39100;

const BASE = () => ({
  zona: opciones.zonas[0],
  asesor: opciones.asesores[0],
  gerente: opciones.gerentes[0],
  supervisor: opciones.supervisores[0],
  estado_geo: opciones.estados[0],
  tipo_repse: opciones.tiposRepse[0],
  uniforme: opciones.uniformes[0],
  forma_pago: opciones.formasPago[0],
  esquema_facturacion: 'INICIO_MES',
  dias_credito: 30,
});

let n = 0;
/** Un servicio nuevo de `guardias` guardias, con su importe mensual capturado. */
async function servicioCon(guardias, { importe = IMPORTE, sinIva = SIN_IVA } = {}) {
  const nombre = `MOVIMIENTO IMPORTE ${++n}`;
  const alta = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ ...BASE(), tipo: 'APERTURA', servicio: nombre, guardias, fecha: '2026-10-01' }),
  });
  assert.equal(alta.status, 201, alta.texto);
  if (importe !== null) {
    const r = await admin.pedir(`/api/servicios/${alta.json.servicioId}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: importe, ...(sinIva === null ? {} : { importe_sin_iva: sinIva }) }),
    });
    assert.equal(r.status, 200, r.texto);
  }
  return { id: alta.json.servicioId, nombre, aperturaId: alta.json.aperturaId, folio: alta.json.folio };
}

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const reducir = (id, guardias, extra = {}) =>
  admin.pedir('/api/cancelaciones', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'REDUCCION',
      servicio_id: id,
      motivo: opciones.motivosBaja[0],
      guardias,
      fecha: '2026-10-10',
      ...extra,
    }),
  });

const ampliar = (id, guardias, extra = {}) =>
  admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ ...BASE(), tipo: 'INCREMENTO', servicio_id: id, guardias, fecha: '2026-10-11', ...extra }),
  });

const cancelar = (id, extra = {}) =>
  admin.pedir('/api/cancelaciones', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'CANCELACION',
      servicio_id: id,
      motivo: opciones.motivosBaja[0],
      fecha: '2026-10-10',
      ...extra,
    }),
  });

/** La bitácora, que es donde vive el «quién, cuándo y de cuánto a cuánto». */
const bitacora = async () => (await admin.pedir('/bitacora')).texto;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  opciones = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

// ---------------------------------------------------------------------------
// M · la medición que prohíbe el proporcional, derivada de los datos
// ---------------------------------------------------------------------------

describe('M · el precio NO sigue a la plantilla, medido sobre el histórico', () => {
  /**
   * Los cambios de plantilla mes a mes de los 33 cortes importados.
   *
   * El criterio está escrito aquí porque el resultado depende de él, y porque
   * medirlo mal es como se llega a conclusiones falsas sobre estos datos.
   *
   * Los cortes **repiten el nombre del servicio**: lo dice `scripts/seed.mjs`
   * —«cada renglón del corte es un servicio, aunque dos compartan nombre: la
   * hoja repite el sitio cuando tiene bloques de turnos distintos o razones
   * sociales diferentes»— y se mide: en cada uno de los 33 cortes hay nombres
   * repetidos, de 2 a 18 según el mes (lo imprime `M3`).
   * Emparejar dos meses solo por el nombre inventa
   * cambios de plantilla que nunca pasaron, porque compara un renglón de un mes
   * con OTRO servicio del mes siguiente. Así nacen los dos casos que el encargo
   * cita por su nombre, y que no resisten mirarlos de cerca —queda documentado
   * en `M3`—.
   *
   * Así que se emparejan solo las identidades inequívocas: `servicio` +
   * `razon_social` que aparece **una sola vez** en los dos meses seguidos. Es
   * conservador —deja fuera los grupos ambiguos en vez de adivinar— y cada
   * cambio que cuenta es un cambio que de verdad le pasó a un servicio.
   */
  const cambios = (() => {
    const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
    const meses = Object.keys(seed.snapshots).sort();
    const grupos = (mes) => {
      const m = new Map();
      for (const r of seed.snapshots[mes]) {
        const k = `${r.servicio}||${r.razon_social}`;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      }
      return m;
    };
    const out = [];
    for (let i = 1; i < meses.length; i += 1) {
      const previo = grupos(meses[i - 1]);
      for (const [k, filasB] of grupos(meses[i])) {
        const filasA = previo.get(k);
        if (!filasA || filasA.length !== 1 || filasB.length !== 1) continue;
        const [a] = filasA;
        const [b] = filasB;
        const ga = Number(a.total_guardias);
        const gb = Number(b.total_guardias);
        if (!Number.isFinite(ga) || !Number.isFinite(gb) || ga === gb) continue;
        out.push({
          nombre: b.servicio,
          razonSocial: b.razon_social,
          mesA: meses[i - 1],
          mesB: meses[i],
          ga,
          gb,
          ia: a.importe_factura,
          ib: b.importe_factura,
        });
      }
    }
    return out;
  })();

  /**
   * Y la clasificación. Solo los cambios en que se puede medir: importe conocido
   * y mayor que cero en los dos meses. Donde el importe no estaba capturado no
   * hay nada que decir sobre cómo se movió, y contarlos como «no se movió»
   * —nulo contra nulo— mezclaría «el precio es fijo» con «nadie lo capturó», que
   * son dos cosas distintas y es justo la distinción que esta plataforma cuida.
   */
  const medibles = cambios.filter((c) => c.ia != null && c.ib != null && Number(c.ia) > 0 && c.ga > 0);
  const clasificados = { igual: 0, proporcional: 0, otra: 0 };
  for (const c of medibles) {
    const ia = Number(c.ia);
    const ib = Number(c.ib);
    const esperado = (ia * c.gb) / c.ga;
    if (ib === ia) clasificados.igual += 1;
    // Un 1 % de tolerancia sobre el proporcional, para no llamar «otra cantidad»
    // a un redondeo de centavos. Se comprobó que el reparto no cambia entre el
    // 0.1 % y el 2 %.
    else if (Math.abs(ib - esperado) <= Math.abs(esperado) * 0.01) clasificados.proporcional += 1;
    else clasificados.otra += 1;
  }

  test('M1 el proporcional sería minoría: la mayoría de los cambios no lo siguen', () => {
    console.log(
      `    # M1 cambios de plantilla en identidades inequívocas: ${cambios.length}; medibles (importe en los ` +
        `dos meses): ${medibles.length} — igual ${clasificados.igual} · proporcional ` +
        `${clasificados.proporcional} · otra cantidad ${clasificados.otra}`
    );
    assert.ok(medibles.length >= 50, `hacen falta datos para medir esto, hubo ${medibles.length}`);
    // La afirmación que sostiene la decisión: el proporcional es la respuesta
    // menos frecuente de las tres, no la más.
    assert.ok(
      clasificados.proporcional < clasificados.igual,
      `el proporcional (${clasificados.proporcional}) tendría que ser menos que «no se movió» (${clasificados.igual})`
    );
    assert.ok(
      clasificados.proporcional < clasificados.otra,
      `el proporcional (${clasificados.proporcional}) tendría que ser menos que «otra cantidad» (${clasificados.otra})`
    );
    assert.ok(
      clasificados.proporcional / medibles.length < 0.34,
      'si el proporcional acertara en un tercio o más de los casos, esta decisión habría que repensarla'
    );
  });

  test('M2 los dos casos que lo explican, los dos reales e inequívocos', () => {
    /**
     * Precio fijo con la plantilla dando un salto de ida y vuelta: JAMES WATT
     * (STERIGENICS) pasó de 10 a 3 guardias y volvió de 3 a 10 al mes
     * siguiente, con el importe clavado en $189,508.45 las dos veces. Es la
     * forma exacta que el encargo le atribuía a MIYANA AMENIDADES —y que MIYANA
     * no tiene: ver `M3`—, pero aquí sí es un solo servicio.
     */
    const watt = cambios.filter((c) => c.nombre === 'JAMES WATT');
    assert.ok(watt.length >= 2, 'faltan los dos meses de JAMES WATT');
    assert.deepEqual(
      watt.map((c) => [c.ga, c.gb]),
      [[10, 3], [3, 10]],
      'la plantilla bajó a un tercio y volvió'
    );
    for (const c of watt) {
      assert.equal(Number(c.ia), 189508.45);
      assert.equal(Number(c.ib), 189508.45, `${c.mesA}→${c.mesB}: el importe no se movió`);
    }

    /**
     * Y otra escala, en el sentido que más desmiente al proporcional: AD BOSQUES
     * pasó de 23 a 19 guardias —BAJÓ la plantilla— y su importe SUBIÓ de
     * $401,451.67 a $477,502.40. El proporcional habría escrito $331,634: casi
     * 146 mil pesos menos de lo que de verdad se cobró, y en la dirección
     * contraria.
     */
    const bosques = cambios.find((c) => c.nombre === 'AD BOSQUES' && c.ga === 23 && c.gb === 19);
    assert.ok(bosques, 'falta el cambio de AD BOSQUES de 23 a 19 guardias');
    assert.equal(Number(bosques.ia), 401451.67);
    assert.equal(Number(bosques.ib), 477502.4, 'con menos guardias, más importe');
    assert.equal(
      proporcionalDeReferencia({ importe: bosques.ia, guardiasAntes: 23, guardiasDespues: 19 }),
      331633.99,
      'y lo que el proporcional habría escrito, que no es lo que pasó'
    );
  });

  test('M3 por qué los nombres repetidos obligan a medir así', () => {
    /**
     * Esta prueba deja clavado el error de medición, porque es el que produjo
     * los dos ejemplos del encargo y el que va a volver si alguien mide esto
     * otra vez por el nombre a secas.
     *
     *   · «DOWNTOWN, de 4 a 17 guardias, subió a $373,456 cuando lo
     *     proporcional eran $321,300» no es un servicio que creció: son DOS
     *     servicios distintos con el mismo nombre —CONDOMINIO DOWNTOWN SANTA FE
     *     TORRE III, con 4 guardias, y ASOCIACION DE CONDOMINOS DOWNTOWN SANTA
     *     FE, con 17—. Ninguno de los dos cambió de plantilla ese mes.
     *   · «MIYANA AMENIDADES pasó de 42 a 2 guardias y volvió a 42 con el mismo
     *     importe» tampoco: el renglón de 42 guardias está igual los cuatro
     *     meses, y en 2026-06 aparece ADEMÁS un renglón de 2 guardias.
     *
     * Las dos conclusiones del encargo siguen en pie —hay precio fijo y hay
     * otra escala, lo prueba `M2`—; los dos ejemplos con los que se ilustraban,
     * no.
     */
    const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
    const filas = (mes, nombre) => seed.snapshots[mes].filter((r) => r.servicio === nombre);

    const repetidos = Object.keys(seed.snapshots).map((mes) => {
      const cuenta = new Map();
      for (const r of seed.snapshots[mes]) cuenta.set(r.servicio, (cuenta.get(r.servicio) || 0) + 1);
      return [...cuenta.values()].filter((v) => v > 1).length;
    });
    console.log(
      `    # M3 nombres repetidos por corte: de ${Math.min(...repetidos)} a ${Math.max(...repetidos)} en cada uno ` +
        'de los 33 cortes'
    );
    assert.ok(Math.min(...repetidos) > 0, 'en todos los cortes hay nombres repetidos');

    // DOWNTOWN: dos servicios, cada uno con su plantilla estable.
    const d10 = filas('2024-10', 'DOWNTOWN');
    const d11 = filas('2024-11', 'DOWNTOWN');
    assert.equal(d10.length, 2, 'DOWNTOWN son dos renglones en 2024-10');
    assert.equal(d11.length, 2);
    for (const mes of [d10, d11]) {
      assert.deepEqual(
        mes.map((r) => r.total_guardias).sort((a, b) => a - b),
        [4, 17],
        'las dos plantillas son las mismas los dos meses: ninguna se movió'
      );
    }
    const torre10 = d10.find((r) => r.total_guardias === 4);
    const torre11 = d11.find((r) => r.total_guardias === 4);
    assert.equal(Number(torre10.importe_factura), 75600);
    assert.equal(Number(torre11.importe_factura), 87696, 'el de 4 guardias subió de precio sin cambiar de plantilla');

    // MIYANA: el renglón de 42 no se mueve; el de 2 es otro renglón.
    for (const mes of ['2026-05', '2026-06', '2026-07']) {
      const con42 = filas(mes, 'MIYANA AMENIDADES').filter((r) => r.total_guardias === 42);
      assert.equal(con42.length, 1, `en ${mes} sigue habiendo un renglón de 42 guardias`);
      assert.equal(Number(con42[0].importe_factura), 1049800);
    }
    assert.equal(filas('2026-06', 'MIYANA AMENIDADES').length, 2, 'en 2026-06 hay un renglón de más, no un cambio');
  });
});

// ---------------------------------------------------------------------------
// T1 · el movimiento pregunta por el importe
// ---------------------------------------------------------------------------

describe('T1 · la reducción pregunta, y las tres respuestas hacen lo que dicen', () => {
  test('T1.1 el defecto reportado: con el importe real, la ficha queda coherente', async () => {
    const s = await servicioCon(2);
    const r = await reducir(s.id, 1, { importe: 'NUEVO', importe_factura: 22678 });
    assert.equal(r.status, 201, r.texto);

    const f = await ficha(s.id);
    assert.equal(f.total_guardias, 1, 'la plantilla bajó');
    assert.equal(f.importe_factura, 22678, 'y el importe ya no cobra los dos guardias');
    // El sin IVA se mueve en la misma proporción y conserva la razón del
    // servicio: 39,100 × 22,678 / 45,356 = 19,550.
    assert.equal(f.importe_sin_iva, 19550, 'el importe sin IVA acompañó en la misma proporción');
  });

  test('T1.2 «no cambia» es una sola acción, deja el importe intacto y deja constancia', async () => {
    const s = await servicioCon(2);
    const r = await reducir(s.id, 1, { importe: 'SIN_CAMBIO' });
    assert.equal(r.status, 201, r.texto);

    const f = await ficha(s.id);
    assert.equal(f.total_guardias, 1);
    assert.equal(f.importe_factura, IMPORTE, 'los contratos de precio fijo existen y son el caso común');
    assert.equal(f.importe_sin_iva, SIN_IVA);

    // Y se puede distinguir de «nadie contestó»: el renglón del movimiento lo
    // dice. Sin esto, confirmar un precio fijo y olvidarse se leerían igual.
    assert.match(
      await bitacora(),
      new RegExp(`${s.nombre}[^<]*importe mensual confirmado sin cambio`),
      'el movimiento tiene que registrar que alguien lo miró y lo confirmó'
    );
  });

  test('T1.3 «no lo sé ahora» vacía el importe en vez de dejar el viejo', async () => {
    const s = await servicioCon(2);
    const r = await reducir(s.id, 1, { importe: 'SE_DESCONOCE' });
    assert.equal(r.status, 201, r.texto, 'el movimiento se registra igual: pasó en la calle');

    const f = await ficha(s.id);
    assert.equal(f.total_guardias, 1);
    assert.equal(f.importe_factura, null, 'el número viejo no se queda: se queda el hueco');
    assert.equal(f.importe_sin_iva, null);
  });

  test('T1.4 y si no se contesta nada, tampoco se queda el viejo', async () => {
    /**
     * La respuesta a la tensión del encargo. El formulario exige contestar; lo
     * que entra por la API sin contestar se trata como «no lo sé», que es la
     * única respuesta que no puede ser falsa. Lo que NO se hace es ninguna de
     * las dos cosas malas: ni rechazar el movimiento —se perdería un cambio de
     * plantilla que ya pasó— ni dejar el importe viejo callado.
     */
    const s = await servicioCon(2);
    const r = await reducir(s.id, 1);
    assert.equal(r.status, 201, r.texto, 'el movimiento no se bloquea nunca');

    const f = await ficha(s.id);
    assert.equal(f.total_guardias, 1);
    assert.notEqual(f.importe_factura, IMPORTE, 'el defecto reportado era justo esto');
    assert.equal(f.importe_factura, null);
  });

  test('T1.5 el hueco se ve, y en los sitios que ya existían para verlo', async () => {
    /**
     * Es la condición de que «no lo sé ahora» sea una respuesta aceptable: no
     * puede acabar en un hueco silencioso. Se comprueba en las dos pantallas
     * donde la plataforma ya señalaba un importe que falta, sin inventar aviso
     * nuevo —que es lo que el director descartó—.
     */
    const s = await servicioCon(2);
    assert.equal((await reducir(s.id, 1, { importe: 'SE_DESCONOCE' })).status, 201);

    // 1) El filtro de servicios sin importe del estado de fuerza, que es a donde
    //    lleva el recuadro «Servicios sin facturar» del tablero.
    const sinFacturar = (await admin.pedir('/estado-fuerza?facturado=no')).texto;
    assert.ok(sinFacturar.includes(s.nombre), 'el servicio tiene que salir en la lista de los que no tienen importe');

    // 2) Y en «Por facturar», donde la propuesta llega en cero y el renglón lo
    //    dice en ámbar en vez de proponer una cifra.
    const pendientes = (await admin.pedir('/cobranza?periodo=2026-10')).texto;
    assert.ok(pendientes.includes(s.nombre), 'el servicio sigue activo, así que sigue por facturar');
    // Las comillas del payload que Next manda al navegador vienen escapadas; se
    // desescapan para poder preguntar por el renglón de ESTE servicio y no por
    // un «importe 0» de cualquier otro.
    assert.match(
      pendientes.replace(/\\"/g, '"'),
      new RegExp(`"servicio":"${s.nombre}"[^}]*"importe":0[,}]`),
      'y su propuesta de importe llega en cero, para que cobranza lo escriba antes de emitir'
    );
    assert.match(pendientes, /falta capturarlo/, 'la pantalla marca en ámbar los importes que faltan');
  });

  test('T1.6 el importe escrito pasa por el sitio único, y nada queda a medias', async () => {
    // `'0x10'` entraba como 16 pesos antes de que hubiera un solo sitio que
    // dijera qué puede valer un dato. Por esta puerta no entra.
    for (const malo of ['0x10', '1e21', '1 2 3', 'mañana', 20000000, -100, [45356], { v: 1 }]) {
      const s = await servicioCon(2);
      const r = await reducir(s.id, 1, { importe: 'NUEVO', importe_factura: malo });
      assert.equal(r.status, 400, `«${JSON.stringify(malo)}» no debería entrar: ${r.texto}`);

      const f = await ficha(s.id);
      assert.equal(f.total_guardias, 2, 'y el movimiento no se registró a medias');
      assert.equal(f.importe_factura, IMPORTE);
    }
  });

  test('T1.7 decir «queda en otra cantidad» y no mandarla no guarda ninguna estimación', async () => {
    /**
     * Es la comprobación de que el proporcional nunca se escribe solo. Si el
     * servidor lo usara como valor por omisión, aquí quedaría 22,678 —el
     * proporcional de 2 a 1 guardia— y nadie lo habría mirado.
     */
    const s = await servicioCon(2);
    const r = await reducir(s.id, 1, { importe: 'NUEVO' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /no llegó ninguna/);

    const f = await ficha(s.id);
    assert.equal(f.importe_factura, IMPORTE, 'nada se escribió');
    assert.equal(f.total_guardias, 2, 'ni el movimiento');
  });

  test('T1.8 una respuesta que no es ninguna de las tres se rechaza', async () => {
    const s = await servicioCon(2);
    const r = await reducir(s.id, 1, { importe: 'PROPORCIONAL' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /PROPORCIONAL/);
    assert.equal((await ficha(s.id)).total_guardias, 2);
  });

  test('T1.9 a un servicio sin importe capturado no se le pregunta nada', async () => {
    // El precio se cierra a veces después del alta y no debe frenar el registro
    // de lo que ya opera (decisión 1). Sin número viejo no hay nada que mienta.
    const s = await servicioCon(2, { importe: null });
    const r = await reducir(s.id, 1);
    assert.equal(r.status, 201, r.texto);
    const f = await ficha(s.id);
    assert.equal(f.total_guardias, 1);
    assert.equal(f.importe_factura, null);
  });

  test('T1.10 queda registrado quién, cuándo y de cuánto a cuánto', async () => {
    const s = await servicioCon(2);
    assert.equal((await reducir(s.id, 1, { importe: 'NUEVO', importe_factura: 22678 })).status, 201);

    // En la bitácora, con el folio y el antes/después.
    const html = await bitacora();
    const i = html.indexOf('el importe mensual pasó de');
    assert.notEqual(i, -1, 'falta el renglón del cambio de importe');
    const renglon = html.slice(Math.max(0, i - 600), i + 300);
    assert.match(renglon, /45356/, 'de cuánto');
    assert.match(renglon, /22678/, 'a cuánto');
    assert.match(renglon, /CA-2026-\d+/, 'con el folio del movimiento que lo cambió');
    assert.match(renglon, /Ángel Kociankowski/, 'y quién');

    // Y en el libro de cambios de precio, que es donde se ven los de la revisión
    // anual: un importe que cambió por un movimiento tiene que estar ahí también
    // o esa pantalla deja de ser el registro de los cambios de precio.
    const precios = (await admin.pedir('/precios')).texto;
    const j = precios.indexOf(s.nombre);
    assert.notEqual(j, -1, 'el servicio tiene que aparecer en Precios');
    assert.match(precios, /de plantilla/, 'el motivo dice por dónde entró el cambio');
  });

  test('T1.11 el incremento pregunta igual: es el mismo defecto con el signo cambiado', async () => {
    const sube = await servicioCon(2);
    const r = await ampliar(sube.id, 3, { importe: 'NUEVO', importe_factura: 100000 });
    assert.equal(r.status, 201, r.texto);
    const f = await ficha(sube.id);
    assert.equal(f.total_guardias, 5);
    assert.equal(f.importe_factura, 100000, 'dejarlo en 45,356 con cinco guardias cobra de menos');

    // Y las otras dos respuestas valen igual.
    const fijo = await servicioCon(2);
    assert.equal((await ampliar(fijo.id, 3, { importe: 'SIN_CAMBIO' })).status, 201);
    assert.equal((await ficha(fijo.id)).importe_factura, IMPORTE);

    const sinSaber = await servicioCon(2);
    assert.equal((await ampliar(sinSaber.id, 3, { importe: 'SE_DESCONOCE' })).status, 201);
    assert.equal((await ficha(sinSaber.id)).importe_factura, null);
  });

  test('T1.12 una apertura nueva no pregunta: su importe se captura con el alta', async () => {
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ ...BASE(), tipo: 'APERTURA', servicio: 'ALTA SIN PREGUNTA', guardias: 3, fecha: '2026-10-01' }),
    });
    assert.equal(alta.status, 201, alta.texto);
    assert.equal((await ficha(alta.json.servicioId)).importe_factura, null, 'nace sin importe, como siempre');
  });
});

describe('T1b · la pantalla: la estimación se enseña, no se guarda', () => {
  const fuente = fs.readFileSync(
    new URL('../app/(app)/cancelaciones/nueva/FormMovimiento.js', import.meta.url),
    'utf8'
  );

  test('T1b.1 la pregunta y sus tres respuestas salen del mismo sitio que las exige el servidor', () => {
    // Escritas dos veces, la pantalla ofrecería una respuesta que el motor no
    // conoce. Es el patrón del 11 contra 15: un dato que se da por único.
    assert.match(fuente, /RESPUESTAS_IMPORTE/, 'la pantalla pinta las respuestas desde la constante compartida');
    assert.deepEqual(Object.keys(RESPUESTAS_IMPORTE), ['SIN_CAMBIO', 'NUEVO', 'SE_DESCONOCE']);
    for (const r of Object.values(RESPUESTAS_IMPORTE)) {
      assert.ok(r.boton && r.etiqueta && r.ayuda, 'cada respuesta se explica en pantalla');
    }
  });

  test('T1b.2 nada nace preseleccionado ni prellenado', () => {
    assert.match(
      fuente,
      /const \[respuestaImporte, setRespuestaImporte\] = useState\(''\)/,
      'ninguna de las tres puede venir elegida de fábrica'
    );
    assert.match(
      fuente,
      /const \[importeNuevo, setImporteNuevo\] = useState\(''\)/,
      'el campo del importe nace vacío'
    );
  });

  test('T1b.3 la referencia nunca llega al campo ni a un botón que la copie', () => {
    /**
     * Es el requisito duro: el proporcional se muestra como referencia y nunca
     * prellenado de forma que se guarde sin que alguien lo mire. Si aceptarlo
     * costara un clic igual que confirmar un precio fijo, la respuesta
     * equivocada saldría tan barata como la correcta.
     */
    assert.doesNotMatch(fuente, /setImporteNuevo\(\s*referencia/, 'nada copia la estimación al campo');
    assert.doesNotMatch(fuente, /value=\{\s*referencia/, 'ni la pinta como valor del campo');
    assert.doesNotMatch(fuente, /importeNuevo\s*\|\|\s*referencia/, 'ni la usa como valor por omisión');
    // Y se dice que es una estimación, con esas palabras.
    assert.match(fuente, /estimación/);
  });

  test('T1b.4 la pantalla del movimiento sigue en pie', async () => {
    const html = (await admin.pedir('/cancelaciones/nueva')).texto;
    assert.match(html, /Movimiento de guardias/);
    // Los tres modos siguen ofreciéndose: la pregunta del importe no se comió
    // ninguno.
    for (const m of ['Ampliación', 'Disminución', 'Cancelación total']) {
      assert.ok(html.includes(m), `falta el modo «${m}»`);
    }
  });

  test('T1b.5 el proporcional de referencia es el proporcional, y nada más', () => {
    assert.equal(proporcionalDeReferencia({ importe: 45356, guardiasAntes: 2, guardiasDespues: 1 }), 22678);
    assert.equal(proporcionalDeReferencia({ importe: 75600, guardiasAntes: 4, guardiasDespues: 17 }), 321300);
    // Y no inventa cuando no hay de dónde: sin importe, sin plantilla previa o
    // con la plantilla en cero no hay proporcional que proponer.
    assert.equal(proporcionalDeReferencia({ importe: 0, guardiasAntes: 2, guardiasDespues: 1 }), null);
    assert.equal(proporcionalDeReferencia({ importe: 45356, guardiasAntes: 0, guardiasDespues: 1 }), null);
    assert.equal(proporcionalDeReferencia({ importe: 45356, guardiasAntes: 2, guardiasDespues: 0 }), null);
  });
});

// ---------------------------------------------------------------------------
// T2 · el importe viejo no llega a cobranza sin que nadie lo sepa
// ---------------------------------------------------------------------------

describe('T2 · la cancelación total: dónde acaba su importe', () => {
  let cancelado;

  before(async () => {
    cancelado = await servicioCon(2);
    const r = await cancelar(cancelado.id);
    assert.equal(r.status, 201, r.texto);
  });

  test('T2.1 el estado medido: BAJA, cero guardias y el importe intacto', async () => {
    const f = await ficha(cancelado.id);
    assert.equal(f.estatus, 'BAJA');
    assert.equal(f.total_guardias, 0);
    assert.equal(f.importe_factura, IMPORTE, 'el último importe acordado se conserva a propósito');
  });

  test('T2.2 NO aparece en «Por facturar» ni en la plantilla de carga', async () => {
    // La consulta que lo excluye es `estatus = 'ACTIVO'` en
    // `pendientesDeFacturar()` y en `plantillaDeCarga()`.
    const cobranza = (await admin.pedir('/cobranza?periodo=2026-10')).texto;
    assert.ok(!cobranza.includes(cancelado.nombre), 'un servicio dado de baja no se propone para facturar');
    const inicio = (await admin.pedir('/cobranza/inicio')).texto;
    assert.ok(!inicio.includes(cancelado.nombre));
  });

  test('T2.3 ni suma en ningún total de dinero: el tablero baja exactamente su importe', async () => {
    /**
     * Medido y no leído: se abre otro servicio con importe, se lee la
     * facturación mensual del tablero, se cancela, y se vuelve a leer. Si el
     * importe de un servicio en BAJA siguiera sumando, la cifra no se movería.
     */
    const leer = async () => {
      const html = (await admin.pedir('/')).texto;
      const m = /Facturación mensual<\/p>\s*<p[^>]*>\$([\d,]+)/.exec(html);
      assert.ok(m, 'no se encontró la facturación mensual del tablero');
      return Number(m[1].replace(/,/g, ''));
    };

    const s = await servicioCon(2, { importe: 100000, sinIva: null });
    const antes = await leer();
    assert.equal((await cancelar(s.id)).status, 201);
    const despues = await leer();
    assert.equal(antes - despues, 100000, 'el importe del servicio dado de baja dejó de sumar');
  });

  test('T2.4 ni en los repartos por zona, por modalidad o por asesor', async () => {
    // Las tres consultas filtran `estatus = 'ACTIVO'`, igual que el tablero. Se
    // comprueba por la pantalla que las enseña.
    const html = (await admin.pedir('/')).texto;
    const ocurrencias = (html.match(new RegExp(cancelado.nombre, 'g')) || []).length;
    const movimientos = html.indexOf('Movimientos recientes');
    assert.ok(movimientos !== -1);
    /**
     * Si aparece, solo puede ser en «Movimientos recientes» —que es la lista de
     * lo que pasó, no un total de dinero— y después de ese título.
     */
    if (ocurrencias > 0) {
      assert.ok(
        html.indexOf(cancelado.nombre) > movimientos,
        'un servicio en BAJA solo puede salir en la lista de movimientos, no en los recuadros de dinero'
      );
    }
    const estadoFuerza = (await admin.pedir('/estado-fuerza')).texto;
    assert.ok(!estadoFuerza.includes(cancelado.nombre), 'ni en el estado de fuerza');
    const juridico = (await admin.pedir('/juridico')).texto;
    assert.ok(!juridico.includes(cancelado.nombre), 'ni en la cartera de jurídico, que excluye las bajas');
  });

  test('T2.5 la puerta que SÍ estaba abierta era la del valor mensual del mes', async () => {
    /**
     * El importe viejo no llegaba a «Por facturar», pero sí a un total de
     * dinero: `montoDe()` de `lib/movimientos.js` reparte el importe de la ficha
     * entre los guardias que QUEDAN, así que con la ficha vieja una reducción de
     * 1 de 2 guardias decía que se iba el importe entero, y el mismo servicio
     * seguía contando ese importe completo. Medido antes de la pregunta: tres
     * servicios de 2 guardias y $45,356 daban «valor mensual que se va $90,712».
     *
     * Con la pregunta contestada, los dos lados suman lo que había: lo que se va
     * más lo que queda es el importe original.
     */
    const s = await servicioCon(2, { importe: 60000, sinIva: null });
    assert.equal((await reducir(s.id, 1, { importe: 'NUEVO', importe_factura: 30000 })).status, 201);

    const f = await ficha(s.id);
    const cancelaciones = (await admin.pedir('/cancelaciones?periodo=2026-10')).texto;
    const i = cancelaciones.indexOf(s.nombre);
    assert.notEqual(i, -1);
    const renglon = cancelaciones.slice(i, i + 900);
    assert.match(renglon, /\$30,000/, 'lo que se va es el importe que dejó de cobrarse');
    assert.equal(
      Number(f.importe_factura) + 30000,
      60000,
      'lo que se va más lo que queda es lo que había: antes daba el doble'
    );
  });

  test('T2.6 la misma puerta por el lado de Aperturas: el mes deja de contar el doble', async () => {
    /**
     * Medido antes de la pregunta, sobre tres servicios de 2 guardias y $45,356:
     * la pantalla de Aperturas decía «valor mensual que entra $181,424» y la de
     * Cancelaciones «$90,712», porque `montoDe()` repartía el importe viejo de
     * la ficha entre los guardias que QUEDABAN. El movimiento de apertura de un
     * servicio reducido llegaba a cobrar el doble de lo que entró.
     *
     * Con el importe contestado, el valor mensual de la apertura vuelve a ser el
     * del mes en que entró: con el importe por 1 guardia en $30,000, los 2 que
     * abrieron valen $60,000, que es lo que valían.
     */
    const s = await servicioCon(2, { importe: 60000, sinIva: null });
    assert.equal((await reducir(s.id, 1, { importe: 'NUEVO', importe_factura: 30000 })).status, 201);

    const aperturas = (await admin.pedir('/aperturas?periodo=2026-10')).texto;
    const i = aperturas.indexOf(s.nombre);
    assert.notEqual(i, -1, 'su apertura es de este mes');
    const renglon = aperturas.slice(i, i + 900);
    assert.match(renglon, /\$60,000/, 'el valor mensual de la apertura es el de su mes');
    assert.doesNotMatch(renglon, /\$120,000/, 'y no el doble, que es lo que daba con el importe viejo');
  });

  test('T2.7 y «no lo sé» deja el movimiento sin cifra en vez de con una falsa', async () => {
    const s = await servicioCon(2, { importe: 60000, sinIva: null });
    assert.equal((await reducir(s.id, 1, { importe: 'SE_DESCONOCE' })).status, 201);
    const cancelaciones = (await admin.pedir('/cancelaciones?periodo=2026-10')).texto;
    const i = cancelaciones.indexOf(s.nombre);
    assert.notEqual(i, -1);
    assert.doesNotMatch(
      cancelaciones.slice(i, i + 900),
      /\$60,000|\$30,000/,
      'sin importe en la ficha no hay valor mensual que inventarle al movimiento'
    );
  });
});

// ---------------------------------------------------------------------------
// T3 · el otro factor: las copias del movimiento
// ---------------------------------------------------------------------------

describe('T3 · un cambio de plantilla no reescribe lo que entró ese mes', () => {
  const aperturasDe = async (servicioId) =>
    (await admin.pedir('/api/aperturas')).json.aperturas.filter((a) => a.servicio_id === servicioId);

  test('T3.1 tras una reducción, la copia del movimiento sigue diciendo lo de su mes', async () => {
    /**
     * La diferencia es legítima y está escrita en `alinearGuardiasDelMovimiento()`:
     * la copia se alinea cuando el número estaba MAL —una corrección— y nunca
     * cuando la plantilla se movió de verdad. El total de un mes se cobra a lo
     * que había ese mes, así que un cambio de hoy no puede reescribir 2023.
     */
    const s = await servicioCon(3);
    assert.equal((await reducir(s.id, 1, { importe: 'SIN_CAMBIO' })).status, 201);

    const [apertura] = await aperturasDe(s.id);
    assert.equal(apertura.guardias, 3, 'la apertura sigue diciendo los 3 que entraron');
    assert.equal((await ficha(s.id)).total_guardias, 2, 'y la ficha los 2 que quedan');
    assert.equal(apertura.precio_guardia, null, 'el precio por guardia del movimiento tampoco se toca');

    // Y la cuenta cuadra: lo que entró menos lo que se retiró es lo que hay. Es
    // la comprobación de que la diferencia entre la copia y la ficha es la
    // legítima —el movimiento de la reducción— y no una copia desalineada.
    const { cancelaciones } = (await admin.pedir('/api/cancelaciones')).json;
    const retirados = cancelaciones
      .filter((c) => c.servicio_id === s.id)
      .reduce((a, c) => a + Number(c.guardias), 0);
    assert.equal(apertura.guardias - retirados, 2, 'entraron 3, se retiró 1, quedan 2');
  });

  test('T3.2 tras un incremento, cada movimiento guarda su propio trozo', async () => {
    const s = await servicioCon(2);
    assert.equal((await ampliar(s.id, 3, { importe: 'SIN_CAMBIO' })).status, 201);

    const movs = await aperturasDe(s.id);
    assert.equal(movs.length, 2, 'la apertura y el incremento');
    const porTipo = Object.fromEntries(movs.map((m) => [m.tipo, m.guardias]));
    assert.equal(porTipo.APERTURA, 2);
    assert.equal(porTipo.INCREMENTO, 3);
    assert.equal(
      movs.reduce((a, m) => a + m.guardias, 0),
      (await ficha(s.id)).total_guardias,
      'y la suma de los trozos es la plantilla de hoy'
    );
  });

  test('T3.3 lo que SÍ alinea sigue alineando: una corrección de la plantilla', async () => {
    /**
     * El contraste importa: si esta prueba se pusiera verde al mismo tiempo que
     * T3.1, querría decir que la distinción entre «el número estaba mal» y «la
     * plantilla se movió» se perdió. Es el arreglo del ciclo pasado y tiene que
     * seguir vivo.
     */
    const s = await servicioCon(4);
    const r = await admin.pedir(`/api/servicios/${s.id}/correccion`, {
      method: 'POST',
      body: JSON.stringify({
        total_guardias: 2,
        motivo: 'Se capturaron cuatro y en la calle siempre fueron dos.',
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const [apertura] = await aperturasDe(s.id);
    assert.equal(apertura.guardias, 2, 'la copia del movimiento se alineó: también estaba mal');
    assert.equal((await ficha(s.id)).total_guardias, 2);
  });

  test('T3.4 el precio por guardia: la copia y la ficha siguen de acuerdo', async () => {
    /**
     * El otro factor de `montoDe()`, que es `precio_guardia × guardias`. Lo que
     * el encargo pide comprobar: que un cambio de plantilla no deje la copia del
     * movimiento peleada con la ficha.
     *
     * Y no la deja, porque no toca ninguna de las dos: lo que cuesta cada
     * guardia no depende de cuántos haya. Es justo el dato que no cambia cuando
     * cambian los otros dos, y por eso el valor mensual del movimiento de
     * apertura sigue siendo el de su mes.
     */
    const s = await servicioCon(3);
    const arreglo = await admin.pedir(`/api/servicios/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ precio_guardia: 9500 }),
    });
    assert.equal(arreglo.status, 200, arreglo.texto);
    // Arreglarlo por «Editar» alineó la copia del movimiento: es el arreglo del
    // ciclo pasado y tiene que seguir vivo para que esta prueba diga algo.
    const [antes] = await aperturasDe(s.id);
    assert.equal(antes.precio_guardia, 9500, 'la copia quedó alineada al arreglar la ficha');

    assert.equal((await reducir(s.id, 1, { importe: 'NUEVO', importe_factura: 30000 })).status, 201);

    const f = await ficha(s.id);
    const [despues] = await aperturasDe(s.id);
    assert.equal(f.precio_guardia, 9500, 'la ficha conserva el precio unitario');
    assert.equal(despues.precio_guardia, 9500, 'y la copia del movimiento dice lo mismo: siguen de acuerdo');
    assert.equal(despues.guardias, 3, 'con los guardias de su mes, que son un hecho cerrado');
    assert.equal(f.importe_factura, 30000);
  });
});
