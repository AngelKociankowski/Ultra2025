/**
 * La comprobación que sostiene la vista por día.
 *
 * Reconstruir el cierre del último corte tiene que dar exactamente lo que ese
 * corte guardó. El corte es la foto contra la que se facturó ese mes: si la
 * reconstrucción no coincide con él, el método está mal y ninguna de las otras
 * pruebas importa.
 *
 * Va en su propio archivo, y no junto a las demás, por una razón que costó un
 * rato entender: cada archivo de pruebas levanta su propia base, y las otras
 * crean servicios de mentira que siguen vivos el día del cierre. Contra ellos,
 * la reconstrucción trae de más justo lo que la prueba acaba de inventar y la
 * comprobación deja de comprobar nada. Aquí no se crea nada: se mira la base
 * como quedó de la carga inicial.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
});

after(async () => {
  await app?.cerrar();
});

describe('el borde del alcance reproduce el corte, sin tocar nada', () => {
  test('mismo número de servicios y de guardias', async () => {
    const limite = (await admin.pedir('/api/estado-fuerza/dia?dia=2026-08-01')).json.limite;
    assert.ok(limite, 'debería haber un corte guardado que marque el alcance');

    const j = (await admin.pedir(`/api/estado-fuerza/dia?dia=${limite}`)).json;
    assert.equal(j.fueraDeAlcance, false, 'el borde está dentro del alcance');
    assert.ok(j.contraste, 'el cierre de un mes se compara contra su corte');

    assert.equal(
      j.contraste.difGuardias,
      0,
      `la reconstrucción del ${limite} difiere del corte en ${j.contraste.difGuardias} guardias`
    );
    assert.equal(
      j.contraste.difServicios,
      0,
      `y en ${j.contraste.difServicios} servicios`
    );
  });

  test('y la pantalla lo dice con todas sus letras', async () => {
    const limite = (await admin.pedir('/api/estado-fuerza/dia?dia=2026-08-01')).json.limite;
    const html = (await admin.pedir(`/estado-fuerza?dia=${limite}`)).texto.replace(/<!--[\s\S]*?-->/g, '');
    assert.match(html, /Cuadra con el corte guardado/);
  });

  test('un día antes del alcance se marca como corto', async () => {
    // Al 31 de marzo faltan diez servicios contra el corte de ese mes: los que
    // se cancelaron antes de que se cargara el histórico ya no están en la base.
    const j = (await admin.pedir('/api/estado-fuerza/dia?dia=2026-03-31')).json;
    assert.equal(j.fueraDeAlcance, true);
    assert.ok(
      j.contraste.difServicios < 0,
      'la reconstrucción antigua tiene que salir corta, no larga'
    );
  });
});
