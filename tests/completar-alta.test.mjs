/**
 * Terminar de capturar un alta que se abrió con lo mínimo.
 *
 * Es la otra mitad de haber partido el alta en dos, y sin ella la primera no
 * vale nada: antes de esto los campos operativos —dirección, precio, uniforme,
 * estado— vivían en el grupo `operativo` del RBAC, que es de administrador
 * solamente, así que ventas y operaciones podían abrir un servicio con cinco
 * datos y después no tenían por dónde volver a entrar a completarlo.
 * «Completar cuando lo tengas» significaba «pídele al administrador que lo
 * complete», y entonces no se completa.
 *
 * Abrir un permiso siempre regala más de lo que se pidió si no se acota, así
 * que la mitad de esta prueba es negativa: un campo fuera de la lista, un campo
 * que ya tiene valor, un valor que no está en el catálogo y los roles que no
 * registran aperturas. Si cualquiera de esas cuatro se abriera, esto habría
 * dejado de ser «llenar un hueco» para convertirse en una puerta de edición sin
 * reglas de rol.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';

const ESPECTADOR = 'espectador@corporativoultra.com';

let app;
let admin;
let operaciones;
let ventas;
let juridico;
let miron;
let opciones;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

/** Abre un servicio con lo mínimo, como lo haría operaciones. */
async function abrirMinimo(nombre, extra = {}) {
  const r = await operaciones.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'APERTURA',
      servicio: nombre,
      zona: opciones.zonas[0],
      asesor: opciones.asesores[0],
      turnos: { '24 HRS': 2 },
      ...extra,
    }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  opciones = (await admin.pedir('/api/catalogos')).json;

  // El espectador no viene en el equipo base del arranque: se da de alta aquí
  // porque es el rol que mejor prueba que esto no se abrió de más.
  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({
      email: ESPECTADOR,
      nombre: 'Espectador de prueba',
      rol: 'espectador',
      password: PASSWORD_TEMPORAL,
    }),
  });
  assert.equal(alta.status, 201, alta.texto);
  const primera = await app.entrar(ESPECTADOR, PASSWORD_TEMPORAL);
  await primera.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });
  miron = await app.entrar(ESPECTADOR, PASSWORD);
});

after(async () => {
  await app?.cerrar();
});

describe('quien abrió el servicio lo puede terminar', () => {
  test('operaciones llena el precio y el esquema, y la ficha los devuelve', async () => {
    const id = await abrirMinimo('COMPLETAR UNO');

    const r = await completar(operaciones, id, { precio_guardia: 11500, esquema_facturacion: 'MES_VENCIDO' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(Object.keys(r.json.llenados).sort(), ['esquema_facturacion', 'precio_guardia']);
    assert.equal(r.json.llenados.precio_guardia.antes, null, 'nació vacío: eso es lo que lo hace un hueco');
    assert.equal(r.json.llenados.precio_guardia.despues, 11500);
    assert.deepEqual(r.json.yaTenian, []);
    assert.deepEqual(r.json.rechazados, []);

    const s = await ficha(id);
    assert.equal(s.precio_guardia, 11500);
    assert.equal(s.esquema_facturacion, 'MES_VENCIDO');
  });

  test('ventas también: es quien suele traer las condiciones de cobro', async () => {
    const id = await abrirMinimo('COMPLETAR VENTAS');
    const r = await completar(ventas, id, { forma_pago: opciones.formasPago[0], dias_credito: 30 });
    assert.equal(r.status, 200, r.texto);
    const s = await ficha(id);
    assert.equal(s.forma_pago, opciones.formasPago[0]);
    assert.equal(s.dias_credito, 30);
  });

  test('un cero es una respuesta y se guarda como cero', async () => {
    // Clientes de contado: cero días de crédito. Si se guardara como nulo, el
    // campo seguiría pidiéndose para siempre.
    const id = await abrirMinimo('COMPLETAR CON CERO');
    const r = await completar(operaciones, id, { dias_credito: 0 });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.llenados.dias_credito.despues, 0);
    assert.equal((await ficha(id)).dias_credito, 0);
  });
});

describe('solo de vacío a valor', () => {
  test('el mismo campo mandado dos veces no se sobreescribe', async () => {
    /**
     * Es la regla dura. Llenar un hueco es terminar la captura; cambiar un valor
     * ya escrito es editar, y editar tiene sus permisos de siempre. Sin esta
     * línea, «completar» sería una forma de que cualquiera que registra
     * aperturas cambiara el precio de un cliente sin dejar rastro de edición.
     */
    const id = await abrirMinimo('COMPLETAR DOS VECES');

    assert.equal((await completar(operaciones, id, { precio_guardia: 8000 })).status, 200);

    const segunda = await completar(operaciones, id, { precio_guardia: 99999 });
    assert.equal(segunda.status, 200, segunda.texto);
    assert.deepEqual(segunda.json.yaTenian, ['precio_guardia']);
    assert.deepEqual(segunda.json.llenados, {});

    assert.equal((await ficha(id)).precio_guardia, 8000, 'se queda el primero');
  });

  test('un campo fuera de la lista llega en rechazados y no toca la base', async () => {
    // Rechazado y no ignorado en silencio: callarlo haría creer a quien capturó
    // que su dato se guardó.
    const id = await abrirMinimo('COMPLETAR FUERA DE LISTA');
    const antes = await ficha(id);

    const r = await completar(operaciones, id, {
      total_guardias: 99,
      estatus: 'BAJA',
      nomina_total: 50000,
      direccion: 'Calle Real 10',
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.rechazados.sort(), ['estatus', 'nomina_total', 'total_guardias']);
    assert.deepEqual(Object.keys(r.json.llenados), ['direccion'], 'lo que sí era completable, sí entró');

    const despues = await ficha(id);
    assert.equal(despues.total_guardias, antes.total_guardias);
    assert.equal(despues.estatus, 'ACTIVO');
    assert.equal(despues.nomina_total, antes.nomina_total);
    assert.equal(despues.direccion, 'Calle Real 10');
  });

  test('guardar en blanco no hace nada ni dice que hizo algo', async () => {
    const id = await abrirMinimo('COMPLETAR EN BLANCO');
    const r = await completar(operaciones, id, { direccion: '', uniforme: '' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.llenados, {});
    assert.equal((await ficha(id)).direccion, null);
  });
});

describe('los valores de catálogo se siguen exigiendo', () => {
  test('una zona que no está en el catálogo responde 400 con el mensaje del catálogo', async () => {
    // Que el formulario sea una lista desplegable no basta: llegar por la API no
    // puede ser la forma de volver a la captura libre, que es como se acabaron
    // teniendo seis supervisores partidos en doce renglones.
    const id = await abrirMinimo('COMPLETAR ZONA MALA', { zona: undefined, asesor: undefined });
    assert.ok(!(await ficha(id)).zona, 'nació sin zona: por eso es completable');

    const r = await completar(operaciones, id, { zona: 'ZONA QUE NO EXISTE' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /no está en el catálogo de zonas/i);
    assert.ok(!(await ficha(id)).zona, 'y no se guardó nada');
  });

  test('un esquema de facturación inventado también', async () => {
    const id = await abrirMinimo('COMPLETAR ESQUEMA MALO');
    const r = await completar(operaciones, id, { esquema_facturacion: 'CUANDO_SE_PUEDA' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /esquema de facturación/i);
  });
});

describe('quién no puede', () => {
  test('jurídico recibe 403', async () => {
    const id = await abrirMinimo('COMPLETAR JURIDICO');
    const r = await completar(juridico, id, { direccion: 'No debería entrar' });
    assert.equal(r.status, 403, r.texto);
    assert.equal((await ficha(id)).direccion, null);
  });

  test('el espectador también', async () => {
    const id = await abrirMinimo('COMPLETAR ESPECTADOR');
    const r = await completar(miron, id, { direccion: 'Tampoco' });
    assert.equal(r.status, 403, r.texto);
    assert.equal((await ficha(id)).direccion, null);
  });

  test('sin sesión, ni eso', async () => {
    const id = await abrirMinimo('COMPLETAR ANONIMO');
    const r = await completar(app.anonimo(), id, { direccion: 'Menos' });
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });

  test('un servicio que no existe responde 400 y no 500', async () => {
    const r = await completar(operaciones, 999999, { direccion: 'A ningún lado' });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /no existe/i);
  });
});

describe('queda rastro de cada llenado', () => {
  test('la bitácora del servicio trae alta_completada con los campos', async () => {
    // Abrir el permiso sin dejar rastro sería regalarlo. Cada hueco llenado
    // queda con nombre, fecha y el antes/después.
    const id = await abrirMinimo('COMPLETAR CON BITACORA');
    assert.equal((await completar(operaciones, id, { uniforme: opciones.uniformes[0] })).status, 200);

    const s = await ficha(id);
    const renglon = s.bitacora.find((b) => b.accion === 'alta_completada');
    assert.ok(renglon, 'tiene que haber un renglón de alta_completada');
    assert.match(renglon.detalle, /uniforme/);
    assert.equal(renglon.rol, 'operaciones');
  });

  test('llenar el precio deja renglón en el historial de precios', async () => {
    /**
     * Un precio que nace fuera de su historial empieza la historia en la nada:
     * el primer renglón sería el primer aumento, y el precio de partida no
     * estaría en ninguna lista. La respuesta a «¿por qué este cliente paga
     * esto?» tiene que ser una sola lista.
     */
    const id = await abrirMinimo('COMPLETAR PRECIO HISTORIAL');
    assert.equal((await completar(operaciones, id, { precio_guardia: 13250 })).status, 200);

    const html = comoSeLee((await admin.pedir(`/estado-fuerza/${id}`)).texto);
    const i = html.indexOf('Precio y su historia');
    assert.notEqual(i, -1);
    const bloque = html.slice(i, i + 3000);
    assert.doesNotMatch(bloque, /Todavía no se le ha movido el precio/, 'el historial no puede estar vacío');
    assert.match(bloque, /editado en la ficha/, 'y el renglón es del mismo tipo que una edición manual');
    assert.match(bloque, /Operaciones de prueba/, 'con quién lo capturó');
  });
});

describe('el panel de la ficha', () => {
  test('guardar desde la ficha deja el panel con un faltante menos', async () => {
    const id = await abrirMinimo('COMPLETAR DESDE FICHA');

    const html = comoSeLee((await operaciones.pedir(`/estado-fuerza/${id}`)).texto);
    assert.match(html, /id="completar"/);
    assert.match(html, /Falta por capturar/);

    /**
     * Se cuenta desde el renglón del estado de fuerza y no desde el panel: es
     * la misma cifra vista desde los dos sitios, así que si una se moviera sin
     * la otra esto lo diría. La etiqueta del renglón es `faltan N datos`.
     */
    const cuantos = async () => {
      const lista = comoSeLee((await operaciones.pedir('/estado-fuerza?q=COMPLETAR DESDE FICHA')).texto);
      const m = lista.match(/faltan (\d+) datos?/);
      assert.ok(m, 'el renglón tiene que decir cuántos datos faltan');
      return Number(m[1]);
    };

    const antes = await cuantos();
    assert.equal((await completar(operaciones, id, { uniforme: opciones.uniformes[0] })).status, 200);
    const despues = await cuantos();
    assert.equal(despues, antes - 1, `de ${antes} a ${despues}`);
  });

  test('a jurídico el panel le enseña la lista y no los campos', async () => {
    // Saber qué le falta a un servicio le sirve a cualquiera que lo consulte: es
    // la explicación de por qué cobranza no puede facturarlo. Llenarlo es de
    // quien lo abrió.
    const id = await abrirMinimo('COMPLETAR PANEL JURIDICO');
    const html = comoSeLee((await juridico.pedir(`/estado-fuerza/${id}`)).texto);
    const i = html.indexOf('Falta por capturar');
    assert.notEqual(i, -1, 'el panel se ve');
    const bloque = html.slice(i, i + 2500);
    assert.doesNotMatch(bloque, /<input/, 'sin campos');
    assert.doesNotMatch(bloque, /Guardar lo que capturé/, 'y sin botón de guardar');
    assert.match(bloque, /Los capturan ventas, operaciones o el administrador/);
  });
});
