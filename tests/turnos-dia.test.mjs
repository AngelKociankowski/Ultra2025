/**
 * El turno del día, y los asesores que son más de uno.
 *
 * Dos observaciones de la revisión del sistema que resultaron ser la misma
 * clase de problema: un dato que la operación necesita y que no cabía en
 * ningún campo, así que acababa metido a la fuerza donde se pudiera.
 *
 * TURNOS. La plataforma preguntaba la jornada —12X36, 24 HRS— y le llamaba
 * «turno». Se pidió lo que faltaba: matutino, nocturno y mixto. No es lo mismo:
 * la jornada es el patrón de días y el turno es la hora, y una plantilla de
 * 12X36 puede ser toda diurna o mitad y mitad.
 *
 * ASESORES. El campo aceptaba uno. En los datos hay dos renglones del catálogo
 * que son dos personas juntas —«ARMANDO LOPEZ MAURICIO VALENZUELA» y «MAURICIO
 * VALENZUELA/ARMANDO LOPEZ», los mismos dos en distinto orden— y cinco
 * servicios con una barra en medio del nombre.
 *
 * Lo que más se cuida aquí es que los dos datos sean OPCIONALES. Hay 217
 * servicios capturados sin ellos; exigirlos convertiría cualquier captura en
 * una discusión sobre algo que quizá quien la hace no sabe en ese momento, y
 * dejaría en falta a toda la operación de golpe.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let catalogo;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  catalogo = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

const abrir = (cuerpo) =>
  admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ fecha: '2026-07-08', ...cuerpo }),
  });

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

describe('el catálogo de turnos', () => {
  test('trae los tres que se pidieron', () => {
    assert.deepEqual([...catalogo.turnosDia].sort(), ['MATUTINO', 'MIXTO', 'NOCTURNO']);
  });

  test('las jornadas siguen siendo las suyas, en su propia lista', () => {
    // La confusión que originó todo esto: lo que la plataforma llamaba «turno»
    // era la jornada. Son dos listas y no se mezclan.
    assert.ok(catalogo.turnos.includes('12X36'), 'las jornadas siguen en su lista');
    assert.ok(!catalogo.turnos.includes('NOCTURNO'), 'un turno se coló entre las jornadas');
    assert.ok(!catalogo.turnosDia.includes('12X36'), 'una jornada se coló entre los turnos');
  });
});

describe('capturar el turno de cada jornada', () => {
  test('se guarda y se lee de vuelta', async () => {
    const r = await abrir({
      servicio: 'TURNOS PARTIDOS',
      turnos: { '12X36': 8 },
      turnos_detalle: { '12X36': { MATUTINO: 5, NOCTURNO: 3 } },
    });
    assert.equal(r.status, 201, r.texto);

    const s = await ficha(r.json.servicioId);
    assert.equal(s.total_guardias, 8);
    assert.deepEqual(s.turnosDetalle, { '12X36': { MATUTINO: 5, NOCTURNO: 3 } });
  });

  test('es opcional: sin él, el servicio entra igual', async () => {
    // Es la regla que hace que esto se pueda estrenar sin frenar la operación.
    const r = await abrir({ servicio: 'SIN TURNO CAPTURADO', turnos: { '24 HRS': 4 } });
    assert.equal(r.status, 201, r.texto);
    const s = await ficha(r.json.servicioId);
    assert.equal(s.total_guardias, 4);
    assert.deepEqual(s.turnosDetalle, {});
  });

  test('si no cuadra con la jornada, se rechaza', async () => {
    // Un servicio cuya jornada dice ocho y cuyo turno suma seis afirma dos
    // plantillas distintas. Es la misma clase de dato que hace que el reparto
    // del tablero deje de coincidir con el estado de fuerza sin avisar.
    const r = await abrir({
      servicio: 'TURNOS QUE NO CUADRAN',
      turnos: { '12X36': 8 },
      turnos_detalle: { '12X36': { MATUTINO: 5, NOCTURNO: 1 } },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /suma 6/);
    assert.match(r.json.error, /8 guardias/);
  });

  test('un turno inventado no entra', async () => {
    const r = await abrir({
      servicio: 'TURNO INVENTADO',
      turnos: { '12X36': 2 },
      turnos_detalle: { '12X36': { VESPERTINO: 2 } },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /catálogo/i);
  });

  test('una jornada que el servicio no tiene, tampoco', async () => {
    const r = await abrir({
      servicio: 'JORNADA QUE NO EXISTE AQUI',
      turnos: { '12X36': 2 },
      turnos_detalle: { '24 HRS': { NOCTURNO: 2 } },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /24 HRS/);
  });
});

describe('el reparto por turno en el tablero', () => {
  test('suma lo capturado y dice cuánto falta', async () => {
    // Lo segundo importa más que lo primero al principio: con 217 servicios ya
    // dentro sin este dato, un panel que enseñara solo lo capturado daría
    // porcentajes impecables sobre una porción mínima de la operación.
    const html = (await admin.pedir('/')).texto;
    assert.match(html, /Guardias por turno/);
    assert.match(html, /por capturar el turno|Todavía no se ha capturado/);
  });

  test('las jornadas se llaman jornadas en el tablero', async () => {
    const html = (await admin.pedir('/')).texto;
    assert.match(html, /Guardias por jornada/);
  });
});

describe('varios asesores en un servicio', () => {
  const [uno, dos] = ['CARLOS LOAIZA', 'MIGUEL TORRES'];

  test('se capturan y se leen los dos', async () => {
    const r = await abrir({
      servicio: 'SERVICIO A DOS MANOS',
      guardias: 3,
      asesor: uno,
      asesores: [dos],
    });
    assert.equal(r.status, 201, r.texto);

    const s = await ficha(r.json.servicioId);
    assert.deepEqual(s.asesores, [uno, dos]);
    assert.equal(s.asesor, uno, 'el primero se queda en la columna de siempre');
  });

  test('el filtro encuentra al segundo, no solo al principal', async () => {
    // Sin esto, «ver lo de Miguel» dejaría fuera justo los servicios que
    // comparte, que son los que más fácil se pierden de vista.
    const r = await admin.pedir(`/api/servicios?estatus=ACTIVO&asesor=${encodeURIComponent(dos)}`);
    assert.equal(r.status, 200);
    assert.ok(
      r.json.servicios.some((s) => s.servicio === 'SERVICIO A DOS MANOS'),
      'el servicio compartido no salió al filtrar por el segundo asesor'
    );
  });

  test('un asesor repetido no se guarda dos veces', async () => {
    const r = await abrir({
      servicio: 'ASESOR REPETIDO',
      guardias: 2,
      asesor: uno,
      asesores: [uno, uno],
    });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual((await ficha(r.json.servicioId)).asesores, [uno]);
  });

  test('un asesor fuera del catálogo se rechaza, como el principal', async () => {
    const r = await abrir({
      servicio: 'ASESOR INVENTADO',
      guardias: 2,
      asesor: uno,
      asesores: ['QUIEN SEA'],
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /catálogo/i);
  });

  test('sin lista, el servicio queda con su único asesor', async () => {
    const r = await abrir({ servicio: 'ASESOR SOLITARIO', guardias: 2, asesor: uno });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual((await ficha(r.json.servicioId)).asesores, [uno]);
  });
});
