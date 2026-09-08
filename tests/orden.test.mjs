/**
 * El orden de la lista del estado de fuerza.
 *
 * Se reportó que «no existe un orden alfabético en el orden de los servicios».
 * Y era cierto de una manera que no se ve de inmediato: la lista sí estaba
 * ordenada, pero primero por zona y luego por nombre. Para quien busca un
 * servicio en la pantalla completa eso es lo mismo que no tener orden —la A
 * aparece cuatro veces, una por zona— y para encontrar algo hay que saber de
 * antemano en qué zona está, que es justo lo que uno no sabe cuando busca.
 *
 * Ahora se ordena por nombre, con las reglas del español. Dos casos que un
 * ORDER BY de SQLite hace mal, porque compara byte por byte:
 *
 *   · Los acentos. «ÁLVARO» se iría después de la Z.
 *   · Los números dentro del nombre. «PROQUIGAMA 107» se iría antes que
 *     «PROQUIGAMA 67B», porque compara el «1» contra el «6» como si fueran
 *     letras.
 *
 * La zona no se pierde: sigue teniendo su propio filtro, que es donde sirve.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

const COMPARADOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

async function activos(query = '') {
  const r = await admin.pedir(`/api/servicios?estatus=ACTIVO${query}`);
  assert.equal(r.status, 200, r.texto);
  return r.json.servicios;
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
});

describe('los servicios salen en orden alfabético', () => {
  test('de la A a la Z, sin agrupar por zona', async () => {
    const lista = await activos();
    assert.ok(lista.length > 50, 'hace falta una lista de verdad para probar esto');

    const nombres = lista.map((s) => s.servicio);
    const ordenados = [...nombres].sort(COMPARADOR.compare);
    assert.deepEqual(nombres, ordenados, 'la lista no viene alfabética');
  });

  test('la zona ya no manda en el orden', async () => {
    // La prueba de que se dejó de agrupar: si siguiera agrupando, todos los de
    // una zona irían seguidos y la zona cambiaría pocas veces. Alfabético puro,
    // cambia constantemente.
    const lista = await activos();
    const zonas = lista.map((s) => s.zona || '');
    let cambios = 0;
    for (let i = 1; i < zonas.length; i++) if (zonas[i] !== zonas[i - 1]) cambios++;
    assert.ok(
      cambios > new Set(zonas).size,
      `la zona solo cambia ${cambios} veces para ${new Set(zonas).size} zonas: sigue agrupando`
    );
  });

  test('los números dentro del nombre se ordenan como números', async () => {
    // El caso real: PROQUIGAMA 67B tiene que ir antes que PROQUIGAMA 107.
    const lista = await activos();
    const proqui = lista.map((s) => s.servicio).filter((n) => n.startsWith('PROQUIGAMA '));
    if (proqui.length < 2) return; // la base de prueba cambió; no hay nada que fijar
    const i67 = proqui.findIndex((n) => n.includes('67B'));
    const i107 = proqui.findIndex((n) => n.includes('107'));
    if (i67 >= 0 && i107 >= 0) {
      assert.ok(i67 < i107, `«67B» quedó después de «107»: ${proqui.join(' | ')}`);
    }
  });

  test('con un filtro puesto, lo que queda sigue en orden', async () => {
    const lista = await activos('&zona=NORTE');
    const nombres = lista.map((s) => s.servicio);
    assert.deepEqual(nombres, [...nombres].sort(COMPARADOR.compare));
  });

  test('los cancelados van después de los activos', async () => {
    // Lo que se opera es lo activo; el histórico va al final.
    const r = await admin.pedir('/api/servicios');
    const estatus = r.json.servicios.map((s) => s.estatus);
    const ultimoActivo = estatus.lastIndexOf('ACTIVO');
    const primerNoActivo = estatus.findIndex((e) => e !== 'ACTIVO');
    if (primerNoActivo >= 0 && ultimoActivo >= 0) {
      assert.ok(primerNoActivo > ultimoActivo, 'un no-activo se coló entre los activos');
    }
  });
});
