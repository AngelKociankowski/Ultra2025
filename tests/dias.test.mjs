/**
 * El estado de fuerza a una fecha.
 *
 * Lo que se prueba aquí no es que la pantalla pinte una fecha: es que el número
 * que enseña se pueda defender. Un estado de fuerza con día invita a creerle
 * sin preguntar, y esa confianza hay que ganarla o no darla.
 *
 * Por eso la prueba que más importa no es ninguna de las de comportamiento sino
 * la de contraste: reconstruir el último día de un mes cerrado tiene que dar lo
 * mismo que el corte que se guardó ese mes. Si eso deja de cuadrar, el método
 * está mal y todo lo demás sobra.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

async function abrir(cuerpo) {
  return admin.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
});

describe('el conjunto de servicios de un día sale de sus fechas', () => {
  test('un servicio no aparece en un día anterior a su alta', async () => {
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'DIA RECIEN ABIERTO',
      fecha: '2026-06-15',
      turnos: { '24 HRS': 3 },
    });
    assert.equal(r.status, 201, r.texto);

    const nombres = async (d) =>
      (await admin.pedir(`/api/estado-fuerza/dia?dia=${d}`)).json.servicios.map((x) => x.servicio);

    assert.ok(!(await nombres('2026-06-14')).includes('DIA RECIEN ABIERTO'), 'el 14 todavía no existía');
    assert.ok((await nombres('2026-06-15')).includes('DIA RECIEN ABIERTO'), 'el 15 ya estaba montado');
  });

  test('un servicio deja de contar el día de su baja, no al siguiente', async () => {
    // La convención: la fecha de alta cuenta y la de baja no. Encadenando días
    // así ninguno se cuenta dos veces ni se queda sin contar, que es lo que
    // pasaría el día en que un servicio se cancela y otro entra en su lugar.
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'DIA QUE SE FUE',
      fecha: '2026-05-02',
      turnos: { '24 HRS': 2 },
    });
    const id = r.json.servicioId;
    const c = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: id,
        guardias: 2,
        fecha: '2026-06-20',
        motivo: 'FIN DE CONTRATO',
      }),
    });
    assert.equal(c.status, 201, c.texto);

    // Se comprueba contra la API y no contra el HTML: la pantalla repite el
    // texto buscado en el resumen de filtros —«Estás viendo una parte: …»— así
    // que buscar el nombre en la página lo encuentra aunque el renglón no esté.
    const nombres = async (d) =>
      (await admin.pedir(`/api/estado-fuerza/dia?dia=${d}`)).json.servicios.map((x) => x.servicio);

    assert.ok((await nombres('2026-06-19')).includes('DIA QUE SE FUE'), 'la víspera seguía');
    assert.ok(!(await nombres('2026-06-20')).includes('DIA QUE SE FUE'), 'el día de la baja ya no cuenta');
  });
});

describe('la plantilla se revierte hasta donde alcanza, y se dice hasta dónde', () => {
  test('un incremento posterior no cuenta en el día anterior', async () => {
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'DIA CRECIO',
      fecha: '2026-04-01',
      turnos: { '24 HRS': 4 },
    });
    const id = r.json.servicioId;
    const inc = await abrir({
      tipo: 'INCREMENTO',
      servicio_id: id,
      fecha: '2026-06-10',
      turnos: { '24 HRS': 6 },
    });
    assert.equal(inc.status, 201, inc.texto);

    // Hoy son 10; antes del incremento eran 4.
    const ahora = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(ahora.total_guardias, 10);

    const r2 = await admin.pedir('/api/estado-fuerza/dia?dia=2026-06-09');
    assert.equal(r2.status, 200, r2.texto);
    const antes = r2.json.servicios.find((s) => s.servicio === 'DIA CRECIO');
    assert.ok(antes, 'debería salir en el día anterior');
    assert.equal(antes.total_guardias, 4, 'el incremento del 10 no había pasado');
    assert.equal(antes.plantilla_ajustada, -6);
    assert.equal(antes.plantilla_hoy, 10);
  });

  test('la respuesta dice a cuántos se les ajustó y a cuántos no', async () => {
    const r = await admin.pedir('/api/estado-fuerza/dia?dia=2026-06-09');
    assert.equal(r.status, 200);
    const e = r.json.exactitud;
    assert.equal(e.conjunto, 'exacto');
    assert.ok(e.ajustados >= 1, 'al menos el del incremento');
    assert.equal(e.ajustados + e.sinAjustar, r.json.servicios.length);
  });
});

/**
 * La comprobación de fondo —que el borde del alcance reproduce el corte— vive
 * en `dias.corte.test.mjs`, sobre una base sin tocar. Aquí no puede: los
 * servicios que estas mismas pruebas inventan siguen vivos el 31 de julio y
 * engordarían el total justo con lo que la prueba acaba de crear.
 */
describe('la comprobación contra el corte guardado', () => {
  test('a media quincena no se compara contra nada: el corte no dice eso', async () => {
    // Comparar el día 12 contra la foto de fin de mes daría una diferencia que
    // no es un error, y presentarla como tal enseñaría a desconfiar del aviso.
    const r = await admin.pedir('/api/estado-fuerza/dia?dia=2026-08-05');
    assert.equal(r.json.contraste, null);
  });

  test('la pantalla enseña el resultado de la comprobación', async () => {
    const limite = (await admin.pedir('/api/estado-fuerza/dia?dia=2026-08-01')).json.limite;
    const html = comoSeLee((await admin.pedir(`/estado-fuerza?dia=${limite}`)).texto);
    assert.match(html, /corte guardado de/);
  });

  test('una fecha fuera de alcance lo dice y manda al corte, en vez de dar el número', async () => {
    // Al 31 de marzo la reconstrucción da diez servicios menos que el corte de
    // ese mes, porque los cancelados de entonces ya no están en la base.
    // Presentarlo como un dato sería dar una cifra que nadie puede defender.
    const j = (await admin.pedir('/api/estado-fuerza/dia?dia=2026-03-31')).json;
    assert.equal(j.fueraDeAlcance, true);

    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=2026-03-31')).texto);
    assert.match(html, /se queda corto y no hay que usarlo/);
    assert.match(html, /Ver el corte de 2026-03/);
  });
});

describe('la pantalla dice de dónde sale el número', () => {
  test('explica qué parte es exacta y cuál no', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=2026-06-15')).texto);
    assert.match(html, /De dónde sale este número/);
    assert.match(html, /Qué servicios estaban en la calle/);
    assert.match(html, /llevan la plantilla de hoy/);
  });

  test('enseña lo que se movió ese día', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=2026-06-20')).texto);
    assert.match(html, /Lo que se movió ese día/);
    assert.match(html, /DIA QUE SE FUE/);
  });

  test('un día sin movimiento lo dice en vez de dejar el hueco', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=2026-06-18')).texto);
    assert.match(html, /Ese día no entró ni salió nada/);
  });

  test('avisa de que es una reconstrucción y no se edita', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=2026-06-15')).texto);
    assert.match(html, /es una reconstrucción y no se edita/);
  });
});

describe('la fecha se valida', () => {
  test('una fecha imposible no pasa por buena', async () => {
    // 2026-02-31 tiene la forma correcta y no existe. Sin comprobarlo, SQLite
    // la compara como texto y devuelve un resultado con toda naturalidad.
    const r = await admin.pedir('/api/estado-fuerza/dia?dia=2026-02-31');
    assert.equal(r.status, 400, r.texto);
  });

  test('una fecha con otra forma se ignora y se ve el mes en curso', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=hace+dos+martes')).texto);
    assert.doesNotMatch(html, /De dónde sale este número/);
    assert.match(html, /en curso/);
  });
});

describe('el archivo que se baja es el que se vio', () => {
  test('el CSV del día trae la columna del ajuste', async () => {
    const r = await admin.pedir('/api/cortes/actual?dia=2026-06-09');
    assert.equal(r.status, 200);
    assert.match(r.texto, /Ajuste aplicado a la plantilla/);
    assert.match(r.headers.get('content-disposition'), /estado-fuerza-2026-06-09\.csv/);
  });

  test('el CSV del mes en curso no la trae: no hay nada que ajustar', async () => {
    const r = await admin.pedir('/api/cortes/actual');
    assert.doesNotMatch(r.texto, /Ajuste aplicado a la plantilla/);
  });
});
