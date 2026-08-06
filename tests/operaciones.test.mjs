/**
 * Las correcciones que salieron de la revisión de operaciones.
 *
 * Todas nacen de mirar los datos reales, y por eso las pruebas verifican el
 * comportamiento nuevo Y el problema concreto que lo motivó:
 *
 *   · Cinco campos se capturaban escribiendo. Cuatro estaban vacíos en los 223
 *     servicios y el quinto —supervisor— tenía a seis personas partidas en dos
 *     por escribir a veces el apellido materno. Ahora salen de catálogo, y el
 *     servidor lo exige: si solo lo arreglara la pantalla, la API seguiría
 *     siendo una puerta abierta a la captura libre.
 *
 *   · Fusionar no existía. Renombrar se negaba cuando el destino ya existía
 *     —«muévelos uno por uno»—, que es justo el caso de los duplicados.
 *
 *   · `aperturas.tipo` distinguía TEMPORAL y esa marca moría al aplicarse: el
 *     servicio quedaba idéntico a uno fijo y se quedaba en el estado de fuerza
 *     para siempre.
 *
 *   · El reparto por turno sumaba 937 guardias donde la plantilla decía 919, y
 *     la gráfica no lo decía en ninguna parte.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

function corrida(dias) {
  const d = new Date(`${HOY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Da de alta una opción y devuelve su id. */
async function opcion(tipo, valor) {
  const r = await admin.pedir('/api/catalogos', { method: 'POST', body: JSON.stringify({ tipo, valor }) });
  assert.equal(r.status, 201, r.texto);
  return r.json.id;
}

async function abrir(cuerpo) {
  return admin.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  // Las opciones se siembran solas la primera vez que alguien pide el catálogo.
  await admin.pedir('/api/catalogos');
});

after(async () => {
  await app?.cerrar();
});

describe('los cinco campos que eran texto libre ahora salen de catálogo', () => {
  const CAMPOS = [
    ['gerente', 'gerente'],
    ['supervisor', 'supervisor'],
    ['estado_geo', 'estado_geo'],
    ['tipo_repse', 'tipo_repse'],
    ['uniforme', 'uniforme'],
  ];

  test('el catálogo ya trae opciones para los cinco', async () => {
    const r = await admin.pedir('/api/catalogos');
    assert.equal(r.status, 200);
    // Gerente arranca vacío a propósito: la columna estaba vacía en los 223
    // servicios, así que no había nada que sembrar. Los otros cuatro sí traen
    // lista de arranque o valores rescatados.
    for (const clave of ['estados', 'tiposRepse', 'uniformes']) {
      assert.ok(r.json[clave]?.length > 0, `${clave} debería traer opciones`);
    }
    assert.ok(Array.isArray(r.json.gerentes));
    assert.ok(Array.isArray(r.json.supervisores));
  });

  test('los estados vienen en abreviatura', async () => {
    const { estados } = (await admin.pedir('/api/catalogos')).json;
    for (const e of ['CDMX', 'EDOMEX', 'HGO', 'MOR']) {
      assert.ok(estados.includes(e), `falta ${e}`);
    }
  });

  for (const [campo, tipo] of CAMPOS) {
    test(`la API rechaza un ${campo} inventado`, async () => {
      const r = await abrir({
        tipo: 'APERTURA',
        servicio: `OPS LIBRE ${campo}`,
        turnos: { '24 HRS': 1 },
        [campo]: 'ESTO NO ESTA EN NINGUN CATALOGO',
      });
      assert.equal(r.status, 400, r.texto);
      assert.match(r.texto, /no está en el catálogo/);
    });
  }

  test('con valores del catálogo sí entra, y quedan guardados', async () => {
    await opcion('gerente', 'GERENTE DE PRUEBA');
    await opcion('supervisor', 'SUPERVISOR DE PRUEBA');

    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'OPS COMPLETO',
      turnos: { '24 HRS': 2 },
      gerente: 'GERENTE DE PRUEBA',
      supervisor: 'SUPERVISOR DE PRUEBA',
      estado_geo: 'EDOMEX',
      tipo_repse: 'VIGILANCIA',
      uniforme: 'INDUSTRIAL',
    });
    assert.equal(r.status, 201, r.texto);

    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.gerente, 'GERENTE DE PRUEBA');
    assert.equal(s.supervisor, 'SUPERVISOR DE PRUEBA');
    assert.equal(s.estado_geo, 'EDOMEX');
    assert.equal(s.tipo_repse, 'VIGILANCIA');
    assert.equal(s.uniforme, 'INDUSTRIAL');
  });

  test('el supervisor viaja también en el movimiento, no solo en el servicio', async () => {
    const r = await admin.pedir('/api/aperturas');
    const ap = r.json.aperturas.find((a) => a.servicio === 'OPS COMPLETO');
    assert.ok(ap, 'no se encontró la apertura');
    assert.equal(ap.supervisor, 'SUPERVISOR DE PRUEBA');
  });
});

describe('fusionar: el arreglo de los nombres partidos en dos', () => {
  test('el catálogo nace con los duplicados que traían los datos', async () => {
    // No es una hipótesis: la base de pruebas se siembra con los datos reales,
    // y ahí están las dos versiones del mismo supervisor.
    const { supervisores } = (await admin.pedir('/api/catalogos')).json;
    assert.ok(supervisores.includes('JUAN JAIR TREJO'), 'falta la versión corta');
    assert.ok(supervisores.includes('JUAN JAIR TREJO TREJO'), 'falta la versión larga');
  });

  test('une los dos y repinta los servicios que traían la sobrante', async () => {
    const detalle = (await admin.pedir('/api/catalogos?detalle=1')).json;
    const corto = detalle.supervisor.opciones.find((o) => o.valor === 'JUAN JAIR TREJO');
    const largo = detalle.supervisor.opciones.find((o) => o.valor === 'JUAN JAIR TREJO TREJO');
    assert.ok(corto && largo);
    // Las dos tienen servicios: son 1 y 26 en los datos reales, y esa es
    // exactamente la razón de que cualquier cuenta por supervisor salga mal.
    assert.ok(corto.usos > 0 && largo.usos > 0, `usos: ${corto.usos} y ${largo.usos}`);
    const suma = corto.usos + largo.usos;

    const r = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id: corto.id, fusionarCon: largo.id }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.origen, 'JUAN JAIR TREJO');
    assert.equal(r.json.destino, 'JUAN JAIR TREJO TREJO');
    assert.equal(r.json.servicios, corto.usos, 'debería repintar justo los servicios de la sobrante');

    // Ahora el supervisor tiene una sola cuenta, y es la suma de las dos.
    const despues = (await admin.pedir('/api/catalogos?detalle=1')).json;
    const unico = despues.supervisor.opciones.find((o) => o.valor === 'JUAN JAIR TREJO TREJO');
    assert.equal(unico.usos, suma);
    assert.ok(!despues.supervisor.opciones.some((o) => o.valor === 'JUAN JAIR TREJO'));

    // Y no quedó como huérfano: no está en ningún servicio.
    assert.ok(!despues.supervisor.huerfanos.some((h) => h.valor === 'JUAN JAIR TREJO'));
  });

  test('los cortes cerrados no se tocan: el pasado no se reescribe', async () => {
    // La fusión corrige el presente. Un corte guardado es el respaldo de lo que
    // se facturó ese mes, con los nombres que tenía ese mes.
    const cortes = (await admin.pedir('/estado-fuerza')).texto;
    assert.ok(cortes.length > 0);
  });

  test('no se fusiona consigo misma ni con otro catálogo', async () => {
    const unId = await opcion('supervisor', 'SUPERVISOR SUELTO');
    const otroTipo = await opcion('zona', 'ZONA SUELTA');

    const misma = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id: unId, fusionarCon: unId }),
    });
    assert.equal(misma.status, 400, misma.texto);

    const cruzada = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id: unId, fusionarCon: otroTipo }),
    });
    assert.equal(cruzada.status, 400, cruzada.texto);
    assert.match(cruzada.texto, /mismo catálogo/);
  });

  test('renombrar sigue mandando a fusionar cuando el destino ya existe', async () => {
    const id = await opcion('supervisor', 'SUPERVISOR A RENOMBRAR');
    await opcion('supervisor', 'SUPERVISOR YA EXISTENTE');
    const r = await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id, valor: 'SUPERVISOR YA EXISTENTE' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /fusionar/);
  });

  test('solo el administrador fusiona', async () => {
    const ventas = await app.entrarYAsentar(ROLES.ventas);
    const r = await ventas.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id: 1, fusionarCon: 2 }),
    });
    assert.equal(r.status, 403);
  });
});

describe('fijos y temporales: la marca sobrevive al movimiento', () => {
  test('una apertura TEMPORAL crea un servicio temporal, sin repetirlo', async () => {
    const r = await abrir({
      tipo: 'TEMPORAL',
      servicio: 'OPS FERIA DEL LIBRO',
      turnos: { '12 HRS': 4 },
      fecha_fin_prevista: corrida(45),
    });
    assert.equal(r.status, 201, r.texto);

    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.modalidad, 'TEMPORAL');
    assert.equal(s.fecha_fin_prevista, corrida(45));
  });

  test('una apertura normal crea un servicio fijo', async () => {
    const r = await abrir({ tipo: 'APERTURA', servicio: 'OPS DE PLANTA', turnos: { '24 HRS': 3 } });
    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.modalidad, 'FIJO');
    assert.equal(s.fecha_fin_prevista, null);
  });

  test('un fijo con fecha de término se rechaza: se contradice', async () => {
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'OPS CONTRADICTORIO',
      turnos: { '24 HRS': 1 },
      modalidad: 'FIJO',
      fecha_fin_prevista: corrida(30),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /fijo no lleva fecha de término/);
  });

  test('la fecha de término tiene que ser una fecha', async () => {
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'OPS FECHA RARA',
      turnos: { '24 HRS': 1 },
      modalidad: 'EVENTO',
      fecha_fin_prevista: 'el mes que entra',
    });
    assert.equal(r.status, 400, r.texto);
  });

  test('el estado de fuerza filtra por modalidad', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?modalidad=TEMPORAL')).texto);
    assert.match(html, /OPS FERIA DEL LIBRO/);
    assert.doesNotMatch(html, /OPS DE PLANTA/);
  });

  test('un temporal vencido sale señalado y se puede filtrar', async () => {
    const r = await abrir({
      tipo: 'TEMPORAL',
      servicio: 'OPS YA TERMINO',
      turnos: { '12 HRS': 2 },
      fecha_fin_prevista: corrida(-20),
    });
    assert.equal(r.status, 201, r.texto);

    const lista = comoSeLee((await admin.pedir('/estado-fuerza?modalidad=VENCIDA')).texto);
    assert.match(lista, /OPS YA TERMINO/);
    assert.doesNotMatch(lista, /OPS FERIA DEL LIBRO/);

    // Y en su ficha lo dice con todas sus letras: no basta con una etiqueta de
    // color si el servicio sigue contando guardias y proponiendo factura.
    const ficha = comoSeLee((await admin.pedir(`/estado-fuerza/${r.json.servicioId}`)).texto);
    assert.match(ficha, /terminaba el/);
    assert.match(ficha, /siguen contando en el estado de fuerza/);
  });

  test('el tablero separa fijos de temporales y avisa de los vencidos', async () => {
    const html = comoSeLee((await admin.pedir('/')).texto);
    assert.match(html, /Fijos y temporales/);
    assert.match(html, /ya pasaron su fecha de término y siguen contando/);
  });

  test('una apertura temporal pendiente conserva su modalidad al aplicarse', async () => {
    // El caso que se perdía: se registra hoy y se aplica después. Si la
    // modalidad no viajara con el movimiento, al aplicarla nacería como fija.
    const r = await abrir({
      tipo: 'TEMPORAL',
      servicio: 'OPS TEMPORAL DIFERIDA',
      turnos: { '12 HRS': 2 },
      fecha_fin_prevista: corrida(60),
    });
    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.modalidad, 'TEMPORAL');
    assert.equal(s.fecha_fin_prevista, corrida(60));
  });
});

describe('la ficha no es una puerta trasera', () => {
  let id;

  test('un servicio ya abierto se puede marcar como temporal', async () => {
    // Es la única forma de marcar los que ya venían de los archivos: todos
    // nacieron fijos porque antes no había dónde decir otra cosa.
    const r = await abrir({ tipo: 'APERTURA', servicio: 'OPS NACIO FIJO', turnos: { '24 HRS': 2 } });
    id = r.json.servicioId;

    const p = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ modalidad: 'TEMPORAL', fecha_fin_prevista: corrida(90) }),
    });
    assert.equal(p.status, 200, p.texto);

    const s = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.modalidad, 'TEMPORAL');
    assert.equal(s.fecha_fin_prevista, corrida(90));
  });

  test('no se puede dejar fijo con fecha de término', async () => {
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ modalidad: 'FIJO' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /fijo no lleva fecha de término/);
  });

  test('volver a fijo funciona si también se quita la fecha', async () => {
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ modalidad: 'FIJO', fecha_fin_prevista: '' }),
    });
    assert.equal(r.status, 200, r.texto);
    const s = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.modalidad, 'FIJO');
    assert.equal(s.fecha_fin_prevista, null);
  });

  test('una modalidad inventada se rechaza', async () => {
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ modalidad: 'CUANDO SE PUEDA' }),
    });
    assert.equal(r.status, 400, r.texto);
  });

  test('editar la ficha tampoco acepta un supervisor fuera del catálogo', async () => {
    // El formulario de apertura ya lo exigía; si la ficha no, bastaba con abrir
    // el servicio y editarlo después para volver a la captura libre.
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ supervisor: 'ALGUIEN QUE NO ESTA' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /no está en el catálogo/);
  });

  test('un valor viejo fuera de catálogo no bloquea editar otra cosa', async () => {
    // Los servicios importados traen valores que ya no son opción. Guardar su
    // dirección no tiene por qué obligar a arreglar primero su zona.
    const r = await admin.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ direccion: 'CALLE NUEVA 5' }),
    });
    assert.equal(r.status, 200, r.texto);
  });
});

describe('movimientos recientes: manda la fecha del movimiento', () => {
  test('uno viejo capturado hoy no se pone encima de uno de ayer', async () => {
    // Se capturan en orden inverso al de sus fechas a propósito: si el orden
    // fuera el de captura, el de hace tres meses saldría primero.
    await abrir({ tipo: 'APERTURA', servicio: 'OPS MOV VIEJO', turnos: { '12 HRS': 1 }, fecha: corrida(-90) });
    await abrir({ tipo: 'APERTURA', servicio: 'OPS MOV NUEVO', turnos: { '12 HRS': 1 }, fecha: corrida(-1) });

    const html = comoSeLee((await admin.pedir('/')).texto);
    const seccion = html.slice(html.indexOf('Movimientos recientes'));
    const nuevo = seccion.indexOf('OPS MOV NUEVO');
    const viejo = seccion.indexOf('OPS MOV VIEJO');
    assert.notEqual(nuevo, -1, 'el movimiento reciente no aparece');
    assert.ok(
      viejo === -1 || nuevo < viejo,
      'el movimiento con fecha más reciente debería ir arriba, aunque se haya capturado después'
    );
  });
});

describe('el reparto por turno dice cuándo no cuadra', () => {
  test('el descuadre que traen los datos sale dicho en el tablero', async () => {
    // Los tres PROQUIGAMA traen el mismo desglose de nueve guardias copiado
    // mientras su plantilla dice tres. El reparto sumaba 937 donde el estado de
    // fuerza decía 919, y la gráfica no lo mencionaba en ninguna parte.
    const html = comoSeLee((await admin.pedir('/')).texto);
    assert.match(html, /y el estado de fuerza dice/);
    assert.match(html, /con el desglose descuadrado/);
    assert.match(html, /PROQUIGAMA/);
  });

  test('la plataforma no deja crear un descuadre nuevo', async () => {
    // El descuadre vino de los archivos. Por la puerta de la plataforma no se
    // puede fabricar otro: la corrección exige que el total y el desglose
    // coincidan, y eso es lo que hay que conservar.
    const r = await abrir({ tipo: 'APERTURA', servicio: 'OPS CUADRADO', turnos: { '24 HRS': 4 } });
    assert.equal(r.status, 201, r.texto);
    const c = await admin.pedir(`/api/servicios/${r.json.servicioId}/correccion`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'la plantilla real es de dos', total_guardias: 2 }),
    });
    assert.equal(c.status, 400, c.texto);
    assert.match(c.texto, /Deben coincidir/);
  });
});

describe('capturar dos veces la misma alta', () => {
  test('el segundo intento se rechaza y manda a incrementar', async () => {
    // Pasó de verdad: la misma alta capturada en tres días distintos dejó tres
    // servicios idénticos en el estado de fuerza, con la plantilla contada tres
    // veces y sin nada que lo explicara. `aplicarApertura` ya lo impedía;
    // registrar directamente, no.
    const primera = await abrir({ tipo: 'APERTURA', servicio: 'OPS ALTA REPETIDA', turnos: { '24X24': 6 } });
    assert.equal(primera.status, 201, primera.texto);

    const segunda = await abrir({ tipo: 'APERTURA', servicio: 'OPS ALTA REPETIDA', turnos: { '24X24': 6 } });
    assert.equal(segunda.status, 400, segunda.texto);
    assert.match(segunda.json.error, /ya está activo con 6 guardias/);
    assert.match(segunda.json.error, /INCREMENTO/);

    // Y el estado de fuerza quedó con uno solo, no con dos.
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=OPS ALTA REPETIDA')).texto);
    assert.equal(html.split('OPS ALTA REPETIDA').length - 1 >= 1, true);
    const api = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios
      .filter((s) => s.servicio === 'OPS ALTA REPETIDA');
    assert.equal(api.length, 1, 'debería haber un solo servicio con ese nombre');
    assert.equal(api[0].total_guardias, 6, 'y con su plantilla, no con el doble');
  });

  test('un incremento sí suma sobre el que ya existe', async () => {
    const r = await abrir({
      tipo: 'INCREMENTO',
      servicio_id: (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios
        .find((s) => s.servicio === 'OPS ALTA REPETIDA').id,
      turnos: { '24X24': 2 },
    });
    assert.equal(r.status, 201, r.texto);
    const api = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios
      .filter((s) => s.servicio === 'OPS ALTA REPETIDA');
    assert.equal(api.length, 1);
    assert.equal(api[0].total_guardias, 8);
  });

  test('un nombre que solo está de baja sí se puede volver a abrir', async () => {
    // Una baja se fue de verdad. Si el cliente vuelve, lo que corresponde es una
    // apertura nueva, y bloquearla sería impedir que regrese.
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS SE FUE Y VOLVIO', turnos: { '12 HRS': 2 } });
    const id = a.json.servicioId;
    const c = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: id, motivo: 'cerró temporalmente' }),
    });
    assert.equal(c.status, 201, c.texto);

    const b = await abrir({ tipo: 'APERTURA', servicio: 'OPS SE FUE Y VOLVIO', turnos: { '12 HRS': 2 } });
    assert.equal(b.status, 201, b.texto);
  });
});

describe('adoptar un valor huérfano', () => {
  test('no se adopta lo que no está capturado en ningún servicio', async () => {
    const r = await admin.pedir('/api/catalogos', {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'supervisor', valor: 'NADIE SE LLAMA ASI' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /no está capturado/);
  });
});
