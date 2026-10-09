/**
 * El arrastre de aperturas sin aplicar, y por qué el aviso contaba mal.
 *
 * El hallazgo que motiva todo esto es incómodo. La pantalla de Aperturas abría
 * con una caja ámbar que decía «219 aperturas sin aplicar · 875 guardias que no
 * están sumando», y llevaba meses diciendo lo mismo. No podía bajar: las 219
 * son todas de la importación inicial —`registrarApertura()` siempre crea o
 * amplía un servicio, así que la plataforma no puede generar una apertura
 * pendiente nueva— y las viejas describen servicios que hace años no operan.
 * Aplicarlas inventaría doscientos servicios que no están en la calle; no
 * aplicarlas dejaba el aviso encendido para siempre.
 *
 * El costo no era el aviso: era que enseñaba a pasar por encima de los avisos
 * ámbar, y con él puesto los que sí piden algo se leían igual de poco.
 *
 * Lo que se prueba:
 *   · que el aviso cuente solo lo que todavía se puede atender,
 *   · que lo viejo quede dicho, contado y alcanzable, no escondido,
 *   · que las 219 sigan estando todas, porque esto no borra nada,
 *   · y que el descarte en lote cierre la cola de forma reversible.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let ventas;
let juridico;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

/** Los meses que caen dentro de la ventana de «reciente». SUPUESTO: doce. */
const MESES_RECIENTE = 12;

/**
 * El último mes que cuenta como viejo, calculado aquí a mano.
 *
 * Se repite la cuenta en la prueba a propósito: si se le pidiera el corte a la
 * misma función que lo usa, la prueba pasaría igual con la cuenta mal hecha. Lo
 * que se comprueba es que el corte sea el que la decisión pide —doce meses
 * hacia atrás desde hoy—, no que el código sea consistente consigo mismo.
 */
function corte() {
  const [anio, mes] = HOY.slice(0, 7).split('-').map(Number);
  const total = anio * 12 + (mes - 1) - MESES_RECIENTE;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const periodoDe = (a) => String(a.periodo || a.fecha || a.creado_en || '').slice(0, 7);

/**
 * Las aperturas que quedaron sin servicio y sin descartar.
 *
 * Se piden mes por mes y no de un tirón porque `GET /api/aperturas` sin periodo
 * trae como máximo 500 renglones y en la base hay 516: pedirlas todas juntas
 * dejaba catorce pendientes fuera de la cuenta y la prueba acusaba al corte de
 * un recorte que era de la consulta. Con `?periodo=` no hay tope.
 */
async function pendientes() {
  const out = [];
  for (const periodo of PERIODOS) {
    const r = await admin.pedir(`/api/aperturas?periodo=${periodo}`);
    assert.equal(r.status, 200, r.texto);
    out.push(...r.json.aperturas.filter((a) => !a.servicio_id && !a.descartada));
  }
  return out;
}

/**
 * Los meses que se recorren, generados y no consultados.
 *
 * Sacar la lista de meses de la consulta general tampoco sirve: con el tope de
 * 500 y el orden por fecha descendente, los meses más viejos —que son justo los
 * del arrastre— se quedaban fuera de la lista de meses, no solo de la de
 * renglones. Se genera con margen hacia los dos lados —el archivo más viejo es
 * de junio de 2021 y hay una apertura suelta de ese mes— porque un mes sin
 * aperturas devuelve una lista vacía y no cuesta nada, mientras que un mes
 * fuera del rango sería una apertura pendiente que la prueba no ve.
 */
const PERIODOS = (() => {
  const out = [];
  let [anio, mes] = [2015, 1];
  const [finA, finM] = HOY.slice(0, 7).split('-').map(Number);
  const fin = (finA + 1) * 12 + (finM - 1);
  while (anio * 12 + (mes - 1) <= fin) {
    out.push(`${anio}-${String(mes).padStart(2, '0')}`);
    if (++mes > 12) {
      mes = 1;
      anio += 1;
    }
  }
  return out;
})();

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
});

after(async () => {
  await app?.cerrar();
});

describe('la cola se parte por antigüedad, y la suma no cambia', () => {
  test('la carga trae las 219 pendientes con sus 875 guardias', async () => {
    // El punto de partida, para que lo que sigue se pueda leer. Si este número
    // cambiara, lo que falla es la siembra y no el corte.
    const lista = await pendientes();
    assert.equal(lista.length, 219);
    assert.equal(
      lista.reduce((t, a) => t + (a.guardias || 0), 0),
      875
    );
  });

  test('el aviso cuenta las recientes y no las 219', async () => {
    const lista = await pendientes();
    const limite = corte();
    const recientes = lista.filter((a) => periodoDe(a) > limite);
    const guardias = recientes.reduce((t, a) => t + (a.guardias || 0), 0);
    assert.ok(recientes.length > 0, 'hacen falta pendientes recientes para probar esto');
    assert.ok(recientes.length < lista.length, 'y algunas viejas, o no habría nada que partir');

    const html = comoSeLee((await admin.pedir('/aperturas')).texto);
    assert.match(
      html,
      new RegExp(`${recientes.length} aperturas sin aplicar`),
      `el aviso debería contar ${recientes.length}`
    );
    assert.doesNotMatch(html, /219 aperturas sin aplicar/, 'y no el total del arrastre');
    assert.match(html, new RegExp(`${guardias} guardias que no están sumando`));

    // Las dos expresiones que ya buscaba tests/pendientes.test.mjs: el texto se
    // conserva palabra por palabra porque está bien escrito y la operación ya
    // lo tiene leído.
    assert.match(html, /sin aplicar/i);
    assert.match(html, /no están sumando/i);
  });

  test('lo viejo se dice en una línea aparte, con su cuenta y su enlace', async () => {
    const lista = await pendientes();
    const limite = corte();
    const viejas = lista.filter((a) => periodoDe(a) <= limite);

    const html = comoSeLee((await admin.pedir('/aperturas')).texto);
    assert.match(html, new RegExp(`Otras ${viejas.length} aperturas`));
    assert.match(html, /quedaron sin aplicar al importar el archivo/);
    assert.match(html, /describen servicios que ya no operan/);
    assert.match(html, /\/aperturas\?pendientes=viejas/, 'y se puede llegar a ellas');

    // Los años salen de los datos. Si estuvieran escritos a mano, la línea
    // mentiría el día que alguien descarte las más viejas.
    const anios = viejas.map(periodoDe).sort();
    assert.match(html, new RegExp(`de ${anios[0].slice(0, 4)} a ${anios[anios.length - 1].slice(0, 4)}`));
  });

  test('las 219 siguen alcanzables: esto no borra ni esconde nada', async () => {
    const lista = await pendientes();
    const limite = corte();
    const recientes = lista.filter((a) => periodoDe(a) > limite).length;
    const viejas = lista.length - recientes;

    // La pantalla ofrece las tres colas con su número, para que el total no se
    // pierda de vista aunque el aviso cuente solo una parte.
    const html = comoSeLee((await admin.pedir('/aperturas?pendientes=1')).texto);
    assert.match(html, new RegExp(`últimos ${MESES_RECIENTE} meses \\(${recientes}\\)`));
    assert.match(html, new RegExp(`arrastre de la importación \\(${viejas}\\)`));
    assert.match(html, new RegExp(`todas \\(${lista.length}\\)`));
  });
});

describe('las tres colas traen lo que dicen', () => {
  const folios = (html) => [...html.matchAll(/>(AP-\d{4}-\d+)/g)].map((m) => m[1]);

  test('?pendientes=1 trae solo las recientes, con sus botones', async () => {
    const lista = await pendientes();
    const limite = corte();
    const esperadas = new Set(lista.filter((a) => periodoDe(a) > limite).map((a) => a.folio));

    const html = comoSeLee((await admin.pedir('/aperturas?pendientes=1')).texto);
    const salieron = new Set(folios(html));
    for (const folio of esperadas) assert.ok(salieron.has(folio), `falta ${folio}`);
    const viejas = lista.filter((a) => periodoDe(a) <= limite);
    for (const a of viejas) assert.ok(!salieron.has(a.folio), `${a.folio} es vieja y no debería estar`);

    assert.match(html, />Aplicar</);
    assert.match(html, />Descartar</);
  });

  test('?pendientes=viejas trae las de antes del corte', async () => {
    const lista = await pendientes();
    const limite = corte();
    const viejas = lista.filter((a) => periodoDe(a) <= limite);

    const html = comoSeLee((await admin.pedir('/aperturas?pendientes=viejas')).texto);
    const salieron = new Set(folios(html));
    // La tabla del histórico tiene tope de 400 renglones; se comprueba que lo
    // que salió sea del lado viejo y que haya salido la mayoría.
    assert.ok(salieron.size >= Math.min(viejas.length, 200), `salieron ${salieron.size} de ${viejas.length}`);
    const porFolio = new Map(lista.map((a) => [a.folio, a]));
    for (const folio of salieron) {
      assert.ok(periodoDe(porFolio.get(folio)) <= limite, `${folio} no es del lado viejo`);
    }
  });

  test('?pendientes=todas trae las 219', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas?pendientes=todas')).texto);
    assert.equal(new Set(folios(html)).size, 219);
  });

  test('un valor inventado en la URL no deja la pantalla a medias', async () => {
    const r = await admin.pedir('/aperturas?pendientes=lo-que-sea');
    assert.equal(r.status, 200);
    // Se cae al mes en curso, que es la vista de siempre.
    assert.match(comoSeLee(r.texto), /Movimientos de \d{4}/);
  });

  test('jurídico no ve botones en ninguna de las tres', async () => {
    for (const cola of ['1', 'viejas', 'todas']) {
      const html = comoSeLee((await juridico.pedir(`/aperturas?pendientes=${cola}`)).texto);
      assert.doesNotMatch(html, />Aplicar</, `en ?pendientes=${cola}`);
      assert.doesNotMatch(html, />Descartar</, `en ?pendientes=${cola}`);
      assert.doesNotMatch(html, /Cerrar el arrastre de una vez/, `en ?pendientes=${cola}`);
    }
  });
});

describe('descarte en lote', () => {
  const lote = (sesion, cuerpo) =>
    sesion.pedir('/api/aperturas/descartar-lote', { method: 'POST', body: JSON.stringify(cuerpo) });

  test('un motivo de menos de cinco letras no descarta ninguna', async () => {
    const ids = (await pendientes()).slice(0, 3).map((a) => a.id);
    const r = await lote(admin, { ids, motivo: 'no' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /por qué no se van a aplicar/i);
    const siguen = new Set((await pendientes()).map((a) => a.id));
    for (const id of ids) assert.ok(siguen.has(id), `${id} debería seguir pendiente`);
  });

  test('jurídico recibe 403 y ventas sí puede', async () => {
    const ids = (await pendientes()).slice(0, 2).map((a) => a.id);
    assert.equal((await lote(juridico, { ids, motivo: 'No debería poder' })).status, 403);

    const r = await lote(ventas, { ids, motivo: 'La importación trajo servicios que ya no operan' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.descartadas, 2);
    assert.deepEqual(r.json.fallidas, []);
  });

  test('una que ya no se puede descartar no tumba el resto del lote', async () => {
    const lista = await pendientes();
    const ids = lista.slice(0, 3).map((a) => a.id);
    const motivo = 'Arrastre de la importación inicial';
    // La primera se descarta sola; después se mete en un lote junto con otras
    // dos, y el lote tiene que cerrar esas dos y reportar la repetida.
    assert.equal(
      (await admin.pedir(`/api/aperturas/${ids[0]}/descartar`, { method: 'POST', body: JSON.stringify({ motivo }) }))
        .status,
      200
    );

    const r = await lote(admin, { ids, motivo });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.descartadas, 2);
    assert.equal(r.json.fallidas.length, 1);
    assert.equal(r.json.fallidas[0].id, ids[0]);
    assert.match(r.json.fallidas[0].error, /ya estaba descartada/i);
  });

  test('cerrar el arrastre deja el aviso ámbar contando solo las recientes', async () => {
    /**
     * Es el caso que motivó todo esto. Se descartan las viejas en lotes de 250
     * —el tope de una llamada— con el motivo que la operación decidió, y lo que
     * tiene que quedar es el aviso contando lo que todavía se puede atender y
     * ninguna apertura perdida.
     */
    const limite = corte();
    const lista = await pendientes();
    const viejas = lista.filter((a) => periodoDe(a) <= limite);
    const recientes = lista.filter((a) => periodoDe(a) > limite);
    assert.ok(viejas.length > 0, 'hacen falta viejas que cerrar');

    const motivo = 'La importación trajo movimientos de servicios que ya no operan';
    let cerradas = 0;
    for (let i = 0; i < viejas.length; i += 250) {
      const r = await lote(admin, { ids: viejas.slice(i, i + 250).map((a) => a.id), motivo });
      assert.equal(r.status, 200, r.texto);
      assert.deepEqual(r.json.fallidas, [], 'ninguna debería fallar');
      cerradas += r.json.descartadas;
    }
    assert.equal(cerradas, viejas.length, `se cerraron ${cerradas} de ${viejas.length}`);

    // Lo que queda pendiente son exactamente las recientes.
    const quedan = await pendientes();
    assert.equal(quedan.length, recientes.length);

    const html = comoSeLee((await admin.pedir('/aperturas')).texto);
    assert.match(html, new RegExp(`${recientes.length} aperturas sin aplicar`));
    assert.doesNotMatch(html, /quedaron sin aplicar al importar el archivo/, 'ya no hay arrastre que anunciar');

    // Y ninguna se borró: siguen estando, marcadas como descartadas. Se cuentan
    // mes por mes por el mismo tope de 500 renglones de la consulta general.
    let descartadas = 0;
    for (const periodo of PERIODOS) {
      const r = await admin.pedir(`/api/aperturas?periodo=${periodo}`);
      descartadas += r.json.aperturas.filter((a) => a.descartada).length;
    }
    assert.equal(descartadas, viejas.length + 5, 'las de este lote más las cinco de las pruebas de arriba');
  });

  test('cada una se puede devolver a la cola', async () => {
    // La reversibilidad es lo que hace defendible el descarte en lote. Si no se
    // pudiera volver, cerrar doscientas de un golpe sería irreversible de hecho.
    const descartada = (await admin.pedir('/api/aperturas')).json.aperturas.find((a) => a.descartada);
    assert.ok(descartada);

    const r = await admin.pedir(`/api/aperturas/${descartada.id}/descartar`, { method: 'DELETE' });
    assert.equal(r.status, 200, r.texto);

    assert.ok(
      (await pendientes()).some((a) => a.id === descartada.id),
      'vuelve a estar en la cola de pendientes'
    );
  });

  test('un lote de más de 250 se rechaza entero', async () => {
    const ids = Array.from({ length: 251 }, (_, i) => i + 1);
    const r = await lote(admin, { ids, motivo: 'Arrastre de la importación' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /hasta 250/);
  });

  test('un lote vacío también', async () => {
    const r = await lote(admin, { ids: [], motivo: 'Arrastre de la importación' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /al menos una/i);
  });
});
