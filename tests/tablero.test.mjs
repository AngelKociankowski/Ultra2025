/**
 * Los recuadros del tablero: que digan qué están contando.
 *
 * Se preguntó, de «Sin contrato» y «Sin facturar», si el número eran servicios
 * o guardias. Que haya que preguntarlo es el problema entero: un número del que
 * no se sabe la unidad no se puede usar para decidir nada, y estos dos son de
 * los que se miran para repartir el trabajo de la semana.
 *
 * Contaban servicios, y se quedan contando servicios —cambiar el número habría
 * roto la comparación con lo que la gente ya trae en la cabeza—. Lo que cambia
 * es que ahora el título lo dice, y debajo va también el peso en guardias:
 * veinte servicios sin contrato no son lo mismo si son veinte porterías de un
 * guardia que si uno de ellos es un CEDIS de sesenta.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let html;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  html = (await admin.pedir('/')).texto;
});

after(async () => {
  await app?.cerrar();
});

describe('los recuadros dicen qué cuentan', () => {
  test('el título dice «servicios», no solo «sin contrato»', () => {
    assert.match(html, /Servicios sin contrato/);
    assert.match(html, /Servicios sin facturar/);
  });

  test('y debajo va el peso en guardias', () => {
    // Dos veces: una por recuadro.
    const veces = (html.match(/guardias · /g) || []).length;
    assert.ok(veces >= 2, `esperaba el desglose en guardias en los dos recuadros, salió ${veces} vez/veces`);
  });

  test('el número de arriba sigue siendo el de servicios', async () => {
    // Lo que se comprueba es que el recuadro no cambió de unidad al cambiar de
    // título: quien lo lleva mirando meses tiene que seguir viendo lo mismo.
    const servicios = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
    const sinContrato = servicios.filter((s) => !s.tiene_contrato && !s.por_arrancar).length;
    assert.ok(sinContrato > 0, 'hace falta al menos uno sin contrato para probar esto');
    assert.match(html, new RegExp(`Servicios sin contrato[\\s\\S]{0,400}?>${sinContrato}<`));
  });

  test('«Guardias en operación» sigue contando guardias', () => {
    assert.match(html, /Guardias en operación/);
  });
});
