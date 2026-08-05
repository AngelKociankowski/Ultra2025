/**
 * La pantalla de jurídico.
 *
 * Lo que se prueba aquí no es que la tabla se pinte, sino las tres decisiones
 * que la sostienen y que serían fáciles de romper sin notarlo:
 *
 *   1. El estado del contrato se CALCULA contra el día de hoy. Si algún día se
 *      guardara en una columna, un contrato que venció ayer seguiría diciendo
 *      «vigente» hasta que alguien lo tocara.
 *   2. La ven todos, la modifica jurídico. Es la primera pantalla de la
 *      plataforma con esa combinación, y el borde entre las dos cosas es
 *      exactamente donde se cuelan los errores de permisos.
 *   3. Un servicio suspendido sigue contando para jurídico. Su contrato no se
 *      congela porque el servicio esté en pausa: la vigencia corre igual y al
 *      reactivarlo puede arrancar sin papel.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES, PASSWORD, PASSWORD_TEMPORAL } from './servidor.mjs';

let app;
let admin;
let juridico;
let ventas;
let miron;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

/** Una fecha corrida N días respecto de hoy, en AAAA-MM-DD. */
function corrida(dias) {
  const d = new Date(`${HOY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Un servicio por cada estado posible, para poder afirmar cosas sobre cada uno.
const CASOS = {
  sinContrato: { nombre: 'JUR SIN PAPEL', contrato: null },
  vencido: { nombre: 'JUR YA VENCIO', contrato: { tiene_contrato: 1, fecha_vencimiento_contrato: corrida(-40) } },
  porVencer: { nombre: 'JUR CASI VENCE', contrato: { tiene_contrato: 1, fecha_vencimiento_contrato: corrida(30) } },
  sinFecha: { nombre: 'JUR SIN VIGENCIA', contrato: { tiene_contrato: 1 } },
  vigente: { nombre: 'JUR TRANQUILO', contrato: { tiene_contrato: 1, fecha_vencimiento_contrato: corrida(400) } },
};

const ids = {};

async function abrir(nombre, guardias = 2) {
  const r = await admin.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'APERTURA', servicio: nombre, turnos: { '24 HRS': guardias } }),
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  ventas = await app.entrarYAsentar(ROLES.ventas);

  const CORREO = 'mirajuridico@corporativoultra.com';
  await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email: CORREO, nombre: 'Mirón', rol: 'espectador', password: PASSWORD_TEMPORAL }),
  });
  const primera = await app.entrar(CORREO, PASSWORD_TEMPORAL);
  await primera.pedir('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ actual: PASSWORD_TEMPORAL, nueva: PASSWORD }),
  });
  miron = await app.entrar(CORREO, PASSWORD);

  for (const [clave, caso] of Object.entries(CASOS)) {
    ids[clave] = await abrir(caso.nombre);
    await admin.pedir(`/api/servicios/${ids[clave]}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 10000 }),
    });
    if (caso.contrato) {
      const r = await juridico.pedir(`/api/servicios/${ids[clave]}`, {
        method: 'PATCH',
        body: JSON.stringify(caso.contrato),
      });
      assert.equal(r.status, 200, r.texto);
    }
  }
});

after(async () => {
  await app?.cerrar();
});

/**
 * El bloque de HTML de un renglón de la tabla.
 *
 * Se corta desde «Cartera de contratos» a propósito: un servicio puede salir
 * antes, en el panel de contradicciones, y buscar la primera aparición en toda
 * la página traía ese otro bloque —donde por supuesto no hay ninguna etiqueta
 * de estado— y la prueba fallaba culpando a la tabla.
 */
function renglon(html, nombre) {
  const tabla = html.indexOf('Cartera de contratos');
  assert.notEqual(tabla, -1, 'No se encontró la tabla en la pantalla');
  const i = html.indexOf(nombre, tabla);
  assert.notEqual(i, -1, `No apareció «${nombre}» en la tabla`);
  return html.slice(i, i + 1800);
}

describe('clasifica cada contrato por lo que es hoy', () => {
  test('los cinco estados salen en la pantalla', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico')).texto);
    assert.match(renglon(html, CASOS.sinContrato.nombre), /Sin contrato/);
    assert.match(renglon(html, CASOS.vencido.nombre), /Vencido/);
    assert.match(renglon(html, CASOS.porVencer.nombre), /Por vencer/);
    assert.match(renglon(html, CASOS.sinFecha.nombre), /Sin vigencia/);
    assert.match(renglon(html, CASOS.vigente.nombre), /Vigente/);
  });

  test('dice cuánto lleva vencido, no solo la fecha', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico')).texto);
    assert.match(renglon(html, CASOS.vencido.nombre), /venció hace/);
  });

  test('el estado no se guarda: cambia solo con mover la fecha', async () => {
    // El mismo servicio, sin tocar nada más que su vigencia, pasa de vigente a
    // vencido. Si el estado viviera en una columna esto no ocurriría hasta que
    // alguien la actualizara a mano.
    const r = await juridico.pedir(`/api/servicios/${ids.vigente}`, {
      method: 'PATCH',
      body: JSON.stringify({ fecha_vencimiento_contrato: corrida(-1) }),
    });
    assert.equal(r.status, 200, r.texto);

    const html = comoSeLee((await juridico.pedir('/juridico?estado=VENCIDO')).texto);
    assert.match(html, new RegExp(CASOS.vigente.nombre));

    await juridico.pedir(`/api/servicios/${ids.vigente}`, {
      method: 'PATCH',
      body: JSON.stringify({ fecha_vencimiento_contrato: corrida(400) }),
    });
  });

  test('el que vence hoy no cuenta como vencido', async () => {
    const id = await abrir('JUR VENCE HOY');
    await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 1, fecha_vencimiento_contrato: HOY }),
    });
    // Un contrato vale el día en que expira: contarlo como vencido adelanta un
    // día el problema y manda a jurídico a renegociar algo que todavía cubre.
    const porVencer = comoSeLee((await juridico.pedir('/juridico?estado=POR_VENCER')).texto);
    assert.match(porVencer, /JUR VENCE HOY/);
    const vencidos = comoSeLee((await juridico.pedir('/juridico?estado=VENCIDO')).texto);
    assert.doesNotMatch(vencidos, /JUR VENCE HOY/);
  });
});

describe('los filtros aíslan de verdad', () => {
  test('filtrar por estado deja solo ese estado', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico?estado=SIN_CONTRATO')).texto);
    assert.match(html, new RegExp(CASOS.sinContrato.nombre));
    assert.doesNotMatch(html, new RegExp(CASOS.vigente.nombre));
    assert.doesNotMatch(html, new RegExp(CASOS.porVencer.nombre));
  });

  test('filtrar por texto busca también en las notas de jurídico', async () => {
    await juridico.pedir(`/api/servicios/${ids.vencido}`, {
      method: 'PATCH',
      body: JSON.stringify({ comentarios_contrato: 'Pendiente firma del apoderado' }),
    });
    const html = comoSeLee((await juridico.pedir('/juridico?q=apoderado')).texto);
    assert.match(html, new RegExp(CASOS.vencido.nombre));
    assert.doesNotMatch(html, new RegExp(CASOS.vigente.nombre));
  });

  test('filtrar por expediente separa a los que no tienen el PDF', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico?pdf=con')).texto);
    // Ninguno de los de prueba tiene PDF cargado, así que la lista sale vacía y
    // lo dice, en lugar de enseñar todo como si el filtro no existiera.
    assert.match(html, /Ningún servicio cumple con esos filtros/);
  });

  test('un estado inventado en la URL no rompe ni vacía la pantalla', async () => {
    const r = await juridico.pedir('/juridico?estado=LO_QUE_SEA');
    assert.equal(r.status, 200);
    assert.match(comoSeLee(r.texto), new RegExp(CASOS.sinContrato.nombre));
  });
});

describe('el subtotal es el de lo filtrado, no el de todo', () => {
  test('al filtrar, las cifras del encabezado bajan', async () => {
    const todos = comoSeLee((await juridico.pedir('/juridico')).texto);
    const soloSin = comoSeLee((await juridico.pedir('/juridico?estado=SIN_CONTRATO')).texto);
    const leer = (html) => Number(/Filtrado: |Total: /.test(html) && html.match(/(?:Filtrado|Total): <\/?[^>]*>?([\d,]+) servicio/)?.[1]?.replace(/,/g, ''));
    const a = leer(todos);
    const b = leer(soloSin);
    assert.ok(a > 0 && b > 0, `no se pudieron leer los subtotales (${a}, ${b})`);
    assert.ok(b < a, `el subtotal filtrado (${b}) debería ser menor que el total (${a})`);
  });
});

describe('un servicio suspendido sigue siendo asunto de jurídico', () => {
  test('la pausa no lo saca de la cartera de contratos', async () => {
    const id = await abrir('JUR EN PAUSA');
    await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 1, fecha_vencimiento_contrato: corrida(-10) }),
    });
    const r = await admin.pedir(`/api/servicios/${id}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'el cliente paró tres meses' }),
    });
    assert.equal(r.status, 200, r.texto);

    // Sale, y sale marcado: su vigencia siguió corriendo mientras estuvo
    // parado, y al reactivarlo arrancaría sin contrato.
    const html = comoSeLee((await juridico.pedir('/juridico?estado=VENCIDO')).texto);
    assert.match(html, /JUR EN PAUSA/);
    assert.match(renglon(html, 'JUR EN PAUSA'), /suspendido/);
  });

  test('una baja sí desaparece: su contrato ya no hay que renovarlo', async () => {
    const id = await abrir('JUR SE FUE');
    await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 1, fecha_vencimiento_contrato: corrida(-10) }),
    });
    const c = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'cerró la sucursal' }),
    });
    assert.equal(c.status, 201, c.texto);

    const html = comoSeLee((await juridico.pedir('/juridico')).texto);
    assert.doesNotMatch(html, /JUR SE FUE/);
  });
});

describe('la ven todos, la modifica jurídico', () => {
  test('ventas y el espectador entran y leen la cartera', async () => {
    for (const [quien, sesion] of [['ventas', ventas], ['espectador', miron]]) {
      const r = await sesion.pedir('/juridico');
      assert.equal(r.status, 200, `${quien} debería poder ver la pantalla`);
      assert.match(comoSeLee(r.texto), new RegExp(CASOS.sinContrato.nombre));
    }
  });

  test('a quien no puede editar no se le ofrecen los campos', async () => {
    const html = comoSeLee((await miron.pedir('/juridico')).texto);
    assert.match(html, /solo jurídico y el administrador la modifican/i);
  });

  test('ventas no puede tocar el contrato aunque vea la pantalla', async () => {
    const r = await ventas.pedir(`/api/servicios/${ids.sinContrato}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 1, fecha_vencimiento_contrato: corrida(365) }),
    });
    assert.equal(r.status, 403, r.texto);

    // Y el dato no se movió: el rechazo no es solo del mensaje.
    const s = (await admin.pedir(`/api/servicios/${ids.sinContrato}`)).json.servicio;
    assert.equal(s.tiene_contrato, 0);
  });

  test('jurídico sí guarda, y la pantalla lo refleja', async () => {
    const r = await juridico.pedir(`/api/servicios/${ids.sinContrato}`, {
      method: 'PATCH',
      body: JSON.stringify({
        tiene_contrato: 1,
        fecha_contrato: corrida(-5),
        fecha_vencimiento_contrato: corrida(500),
        condiciones_comerciales: 'A los 20 días de cada mes',
      }),
    });
    assert.equal(r.status, 200, r.texto);

    const html = comoSeLee((await juridico.pedir('/juridico?estado=VIGENTE')).texto);
    assert.match(html, new RegExp(CASOS.sinContrato.nombre));

    // Se deshace, para no arrastrar el cambio a las pruebas de abajo.
    await juridico.pedir(`/api/servicios/${ids.sinContrato}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 0, fecha_contrato: null, fecha_vencimiento_contrato: null }),
    });
  });
});

describe('las contradicciones se enseñan, no se corrigen solas', () => {
  test('un «sin contrato» con fecha aparece señalado', async () => {
    const id = await abrir('JUR SE CONTRADICE');
    // Primero se captura la fecha con el contrato marcado, y luego se desmarca:
    // así queda el mismo enredo que trae el archivo original.
    await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 1, fecha_vencimiento_contrato: corrida(200) }),
    });
    await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tiene_contrato: 0 }),
    });

    const html = comoSeLee((await juridico.pedir('/juridico')).texto);
    assert.match(html, /capturas que se contradicen/);
    assert.match(html, /JUR SE CONTRADICE/);

    // Y el propio renglón de la tabla lo dice, no solo el panel de arriba: sin
    // eso se lee como un contrato en orden hasta 2027.
    assert.match(renglon(html, 'JUR SE CONTRADICE'), /pero dice no tener contrato/);

    // Y no se «arregló» por su cuenta: la palomita sigue como la dejaron.
    const s = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.tiene_contrato, 0);
    assert.ok(s.fecha_vencimiento_contrato);
  });
});

describe('el archivo que se lleva a la junta', () => {
  test('el CSV trae el estado ya resuelto y respeta el filtro', async () => {
    const r = await juridico.pedir('/api/juridico/export?estado=SIN_CONTRATO');
    assert.equal(r.status, 200);
    assert.match(r.texto, /Estado del contrato/);
    assert.match(r.texto, new RegExp(CASOS.sinContrato.nombre));
    assert.doesNotMatch(r.texto, new RegExp(CASOS.vigente.nombre));
  });

  test('baja como archivo y no como página', async () => {
    const r = await juridico.pedir('/api/juridico/export');
    assert.match(r.headers.get('content-disposition') || '', /attachment; filename="contratos-/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  test('el espectador también puede bajarlo: es consulta', async () => {
    assert.equal((await miron.pedir('/api/juridico/export')).status, 200);
  });
});

describe('la pestaña está donde debe', () => {
  test('a todos los roles les aparece en el menú', async () => {
    for (const sesion of [admin, juridico, ventas, miron]) {
      assert.match(comoSeLee((await sesion.pedir('/')).texto), />Jurídico</);
    }
  });
});
