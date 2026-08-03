/**
 * El desglose por turno, que es la otra mitad de una plantilla.
 *
 * Saber que un servicio tiene doce guardias no dice cómo está armado: doce en
 * 24 HRS y doce en 12X12 son la misma cifra y dos operaciones distintas —otra
 * rotación, otra nómina, otros descansos—. Ese dato ya se guardaba desde la
 * apertura, pero no se veía en ninguna pantalla y se perdía detrás del total.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let ventas;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  ventas = await app.entrarYAsentar(ROLES.ventas);
});

after(async () => {
  await app?.cerrar();
});

/** React parte el texto con comentarios vacíos; se quitan antes de buscar. */
const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

async function abrir(nombre, turnos) {
  const r = await ventas.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, fecha: '2026-07-01', turnos }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

describe('el reparto se ve en la lista', () => {
  test('cada servicio muestra en qué horario está cada guardia', async () => {
    await abrir('TURNOS MIXTOS', { '24 HRS': 4, '12X12 L-D': 2 });

    const r = await ventas.pedir('/api/servicios?q=TURNOS MIXTOS');
    assert.equal(r.json.servicios[0].total_guardias, 6);
    assert.deepEqual(r.json.servicios[0].turnos, { '24 HRS': 4, '12X12 L-D': 2 });

    const html = comoSeLee((await ventas.pedir('/estado-fuerza?q=TURNOS MIXTOS')).texto);
    assert.match(html, /TURNOS MIXTOS/);
    assert.match(html, /24 HRS: 4/, 'el desglose va debajo del total, no escondido');
    assert.match(html, /12X12 L-D: 2/);
  });

  test('el panel suma la operación por modalidad', async () => {
    const html = comoSeLee((await ventas.pedir('/estado-fuerza')).texto);
    assert.match(html, /Guardias por turno/);
    // el estado de fuerza sembrado tiene 24 HRS como turno más numeroso
    assert.match(html, /24 HRS/);
  });
});

describe('se puede ver solo un turno', () => {
  test('filtrar por turno deja los servicios que lo tienen', async () => {
    await abrir('SOLO DOCE POR DOCE', { '12X12 L-D': 3 });

    const r = await ventas.pedir('/api/servicios?turno=12X12 L-D');
    assert.ok(r.json.servicios.length >= 2);
    for (const s of r.json.servicios) {
      assert.ok(s.turnos['12X12 L-D'], `${s.servicio} no tiene ese turno`);
    }
  });

  test('el filtro no confunde un turno con una cantidad', async () => {
    // «12 HRS» no debe traer servicios que tengan 12 guardias en otro turno
    await abrir('DOCE GUARDIAS OTRO TURNO', { '24X48': 12 });

    const r = await ventas.pedir('/api/servicios?turno=12 HRS');
    assert.ok(
      !r.json.servicios.some((s) => s.servicio === 'DOCE GUARDIAS OTRO TURNO'),
      'buscar la llave del JSON, no el texto suelto'
    );
  });

  test('el filtro convive con los demás', async () => {
    const r = await ventas.pedir('/api/servicios?turno=12X12 L-D&estatus=ACTIVO');
    assert.equal(r.status, 200);
    for (const s of r.json.servicios) assert.equal(s.estatus, 'ACTIVO');
  });
});

describe('el expediente del servicio', () => {
  test('muestra el desglose con su reparto', async () => {
    const id = await abrir('TURNOS EN LA FICHA', { '24 HRS': 6, '12 HRS': 2 });
    const html = comoSeLee((await ventas.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /Guardias por turno/);
    assert.match(html, /24 HRS/);
    assert.match(html, /12 HRS/);
    assert.match(html, /2 modalidades/);
  });

  /**
   * El descuadre no se puede provocar por la plataforma —la corrección exige
   * que el total y la suma coincidan, y hace bien— pero sí existe en lo que
   * vino del archivo: tres servicios traen total 3 con un desglose que suma 9.
   * La pantalla tiene que decirlo en vez de enseñar dos cifras que se
   * contradicen sin explicación.
   */
  test('la plataforma no deja descuadrar el total a propósito', async () => {
    const id = await abrir('TURNOS DESCUADRADOS', { '24 HRS': 4 });
    const r = await admin.pedir(`/api/servicios/${id}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'intento de descuadre', total_guardias: 9 }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Deben coincidir/);
  });

  test('avisa del descuadre que venía en el archivo', async () => {
    const todos = (await ventas.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    const torcido = todos.find((s) => {
      const suma = Object.values(s.turnos || {}).reduce((a, b) => a + b, 0);
      return suma > 0 && suma !== s.total_guardias;
    });
    assert.ok(torcido, 'el archivo trae al menos uno así');

    const html = comoSeLee((await ventas.pedir(`/estado-fuerza/${torcido.id}`)).texto);
    assert.match(html, /El desglose suma/);
    assert.match(html, /Corregir captura/);
  });
});
