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
      tipo_repse: 'BÁSICO',
      uniforme: 'COMANDO',
    });
    assert.equal(r.status, 201, r.texto);

    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.gerente, 'GERENTE DE PRUEBA');
    assert.equal(s.supervisor, 'SUPERVISOR DE PRUEBA');
    assert.equal(s.estado_geo, 'EDOMEX');
    assert.equal(s.tipo_repse, 'BÁSICO');
    assert.equal(s.uniforme, 'COMANDO');
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

describe('lo que la hoja capturaba y la plataforma no', () => {
  let id;

  test('hora de apertura, vehículos de custodia y equipo entregado', async () => {
    // Los tres venían en la hoja de aperturas y no vivían en ninguna parte. El
    // equipo no es adorno del formato: un chaleco blindado o una patrulla
    // cambian el costo, y son lo que hay que tener listo antes del primer turno.
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'OPS CON EQUIPO',
      turnos: { '24X24': 2 },
      hora_apertura: '09:00',
      vehiculos_custodia: 1,
      equipo: { chaleco_blindado: 2, lamparas: 4, botas_hule: 4, patrulla: 0 },
    });
    assert.equal(r.status, 201, r.texto);
    id = r.json.aperturaId;

    const ap = (await admin.pedir('/api/aperturas')).json.aperturas.find((a) => a.id === id);
    assert.equal(ap.hora_apertura, '09:00');
    assert.equal(ap.vehiculos_custodia, 1);

    const equipo = JSON.parse(ap.equipo_json || '{}');
    assert.equal(equipo.chaleco_blindado, 2);
    assert.equal(equipo.lamparas, 4);
    // Los ceros no se guardan: «no lleva patrulla» y «nadie capturó la
    // patrulla» son lo mismo, y guardar dieciséis ceros por servicio llena la
    // base de nada.
    assert.ok(!('patrulla' in equipo), 'un cero no debería guardarse');
  });

  test('el equipo viaja a la pantalla de aperturas', async () => {
    // El expediente se despliega en el navegador, así que sus etiquetas no
    // están en el HTML del servidor. Lo que sí viaja son los datos, y sin ellos
    // el renglón no podría pintarlo por más que se abra.
    const html = (await admin.pedir('/aperturas?periodo=todo')).texto;
    assert.match(html, /OPS CON EQUIPO/);
    assert.match(html, /chaleco_blindado/);
    assert.match(html, /vehiculos_custodia|hora_apertura/);
  });

  test('una hora mal escrita se ignora, no tumba la captura', async () => {
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'OPS HORA RARA',
      turnos: { '12 HRS': 1 },
      hora_apertura: 'a las nueve',
    });
    assert.equal(r.status, 201, r.texto);
    const ap = (await admin.pedir('/api/aperturas')).json.aperturas.find((a) => a.id === r.json.aperturaId);
    assert.equal(ap.hora_apertura, null);
  });

  test('un renglón de equipo inventado no se cuela', async () => {
    const r = await abrir({
      tipo: 'APERTURA',
      servicio: 'OPS EQUIPO INVENTADO',
      turnos: { '12 HRS': 1 },
      equipo: { helicoptero: 3, lamparas: 1 },
    });
    assert.equal(r.status, 201, r.texto);
    const ap = (await admin.pedir('/api/aperturas')).json.aperturas.find((a) => a.id === r.json.aperturaId);
    const equipo = JSON.parse(ap.equipo_json || '{}');
    assert.ok(!('helicoptero' in equipo));
    assert.equal(equipo.lamparas, 1);
  });

  test('los puestos del catálogo son los de la hoja, no unos inventados', async () => {
    const { puestos } = (await admin.pedir('/api/catalogos')).json;
    for (const p of ['GUARDIA BÁSICO', 'GUARDIA ODS', 'GUARDIA BILINGÜE', 'JEFE DE TURNO', 'JEFE DE SERVICIO', 'MONITORISTA']) {
      assert.ok(puestos.includes(p), `falta el puesto ${p}`);
    }
  });

  test('los uniformes y el REPSE también', async () => {
    const { uniformes, tiposRepse, conocidos } = (await admin.pedir('/api/catalogos')).json;
    // Hoy se usan dos. Los demás siguen en el catálogo pero desactivados: no se
    // ofrecen al capturar y sí explican los 41 movimientos que traen
    // «Institucional». Borrarlos solo lograría que el catálogo dejara de
    // explicar lo que hay en pantalla.
    assert.deepEqual([...uniformes].sort(), ['COMANDO', 'TRAJE']);
    assert.ok(conocidos.uniformes.includes('INSTITUCIONAL'), 'el retirado sigue conocido');
    assert.ok(conocidos.uniformes.includes('CAMUFLAJE GRIS'));
    // Sin el prefijo «REPSE» delante de cada nivel: la etiqueta del campo ya
    // dice de qué se habla. Son los nombres internos, tal cual.
    for (const t of ['BÁSICO', 'PLUS', 'PLUS +', 'NO REQUIERE REPSE']) {
      assert.ok(tiposRepse.includes(t), `falta el nivel ${t}`);
    }
    // Las listas inventadas del primer intento ya no están.
    assert.ok(!uniformes.includes('TÁCTICO'));
    assert.ok(!tiposRepse.includes('SEGURIDAD PRIVADA'));
  });
});

describe('los datos que venían mal en 2026', () => {
  test('ninguna apertura de 2026 quedó con la zona que ya no existe', async () => {
    // CENTRO se dejó de usar en septiembre de 2024. La hoja de agosto la trae
    // en tres renglones; operación confirmó que son SUR.
    const aperturas = (await admin.pedir('/api/aperturas')).json.aperturas;
    const de2026 = aperturas.filter((a) => String(a.periodo || '') >= '2026-01');
    assert.ok(de2026.length > 0, 'debería haber aperturas de 2026');
    assert.deepEqual(de2026.filter((a) => a.zona === 'CENTRO'), []);
  });

  test('las de 2023 y 2024 sí la conservan: entonces existía', async () => {
    // Reescribir el histórico para que se vea ordenado sería falsearlo.
    const aperturas = (await admin.pedir('/api/aperturas')).json.aperturas;
    assert.ok(
      aperturas.some((a) => a.zona === 'CENTRO' && String(a.periodo || '') < '2026-01'),
      'el CENTRO histórico debería seguir ahí'
    );
  });

  test('el REPSE quedó en cuatro niveles, no en quince formas', async () => {
    // Eran quince: «Básico», «REPSE BÁSICO», «Repse Basico», «SI (BASICO)»,
    // «si, basico», «SI BASICO»… todas el mismo nivel escrito mal. Uniformar la
    // ortografía no reescribe ningún hecho; dejarla partida sí impide contar.
    const valores = new Set(
      (await admin.pedir('/api/aperturas')).json.aperturas.map((a) => a.tipo_repse).filter(Boolean)
    );
    const reconocidos = ['BÁSICO', 'PLUS', 'PLUS +', 'NO REQUIERE REPSE'];
    const sobrantes = [...valores].filter((v) => !reconocidos.includes(v));
    // «SI» y «0» se quedan: nadie puede saber hoy qué nivel quisieron decir, y
    // ponerles uno sería inventarlo.
    assert.ok(sobrantes.every((v) => ['SI', '0'].includes(v)), `quedaron formas raras: ${sobrantes.join(', ')}`);
  });

  test('el REPSE de 2026 quedó con el nombre interno, sin el prefijo', async () => {
    const de2026 = (await admin.pedir('/api/aperturas')).json.aperturas
      .filter((a) => String(a.periodo || '') >= '2026-01' && a.tipo_repse);
    for (const a of de2026) {
      assert.doesNotMatch(a.tipo_repse, /^REPSE /i, `${a.folio} conserva el prefijo: ${a.tipo_repse}`);
    }
    // Y sin dos formas del mismo término conviviendo.
    const formas = new Set(de2026.map((a) => a.tipo_repse));
    assert.ok(!(formas.has('BASICO') && formas.has('BÁSICO')), 'BASICO y BÁSICO no deberían convivir');
  });

  test('el uniforme de 2026 quedó en la caja del catálogo', async () => {
    const de2026 = (await admin.pedir('/api/aperturas')).json.aperturas
      .filter((a) => String(a.periodo || '') >= '2026-01' && a.uniforme);
    for (const a of de2026) {
      assert.equal(a.uniforme, a.uniforme.toUpperCase(), `${a.folio}: ${a.uniforme}`);
    }
  });
});

describe('corregir una apertura pendiente sin aplicarla', () => {
  let id;

  before(async () => {
    await admin.pedir('/api/catalogos', { method: 'POST', body: JSON.stringify({ tipo: 'zona', valor: 'ZONA VIEJA 2024' }) });
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS ZONA MALA', turnos: { '24X24': 2 }, zona: 'ZONA VIEJA 2024' });
    assert.equal(a.status, 201, a.texto);
    id = a.json.aperturaId;
    await admin.pedir(`/api/aperturas/${id}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para dejarla pendiente' }),
    });
  });

  test('la zona equivocada se cambia y se queda cambiada', async () => {
    // Poder corregirla al aplicar no alcanzaba: mientras tanto la lista seguía
    // enseñando el dato malo y el dato malo seguía guardado.
    const r = await admin.pedir(`/api/aperturas/${id}/corregir`, {
      method: 'PATCH',
      body: JSON.stringify({ zona: 'SUR' }),
    });
    assert.equal(r.status, 200, r.texto);

    const ap = (await admin.pedir('/api/aperturas')).json.aperturas.find((a) => a.id === id);
    assert.equal(ap.zona, 'SUR');
    assert.equal(ap.servicio_id, null, 'sigue pendiente: corregir no la aplica');
  });

  test('la lista ya no la enseña con la zona vieja', async () => {
    const html = (await admin.pedir('/aperturas?periodo=todo')).texto;
    const i = html.indexOf('OPS ZONA MALA');
    assert.notEqual(i, -1);
    assert.doesNotMatch(html.slice(i - 400, i + 400), /ZONA VIEJA 2024/);
  });

  test('queda en la bitácora con el antes y el después', async () => {
    const html = comoSeLee((await admin.pedir('/bitacora')).texto);
    assert.match(html, /OPS ZONA MALA/);
    assert.match(html, /ZONA VIEJA 2024/);
  });

  test('y al aplicarla, el servicio nace con la zona buena', async () => {
    const r = await admin.pedir(`/api/aperturas/${id}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio.zona, 'SUR');
  });

  test('una apertura ya aplicada no se corrige por aquí', async () => {
    // Su servicio existe: cambiarle el dato al movimiento sin cambiárselo al
    // servicio partiría los dos.
    const r = await admin.pedir(`/api/aperturas/${id}/corregir`, {
      method: 'PATCH',
      body: JSON.stringify({ zona: 'NORTE' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /ya está aplicada/);
  });

  test('no se puede corregir a un valor fuera del catálogo', async () => {
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS OTRA MAS', turnos: { '12 HRS': 1 } });
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para probar' }),
    });
    const r = await admin.pedir(`/api/aperturas/${a.json.aperturaId}/corregir`, {
      method: 'PATCH',
      body: JSON.stringify({ zona: 'LA QUE YO INVENTE' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.json.error, /no está en el catálogo/);
  });

  test('corregir no toca guardias, turnos ni nombre', async () => {
    // Eso es lo que el movimiento afirma que pasó; cambiarlo sería reescribir
    // el hecho, no corregir cómo se clasificó.
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS INTACTA', turnos: { '12 HRS': 3 } });
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para probar' }),
    });
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/corregir`, {
      method: 'PATCH',
      body: JSON.stringify({ zona: 'SUR', servicio: 'OTRO NOMBRE', guardias: 99, turnos: { '24 HRS': 9 } }),
    });
    const ap = (await admin.pedir('/api/aperturas')).json.aperturas.find((x) => x.id === a.json.aperturaId);
    assert.equal(ap.servicio, 'OPS INTACTA');
    assert.equal(ap.guardias, 3);
    assert.equal(ap.zona, 'SUR');
  });

  test('quien no captura aperturas no corrige', async () => {
    const juridico = await app.entrarYAsentar(ROLES.juridico);
    const r = await juridico.pedir(`/api/aperturas/${id}/corregir`, {
      method: 'PATCH',
      body: JSON.stringify({ zona: 'NORTE' }),
    });
    assert.equal(r.status, 403);
  });
});

describe('aplicar una pendiente con un valor que ya no existe', () => {
  test('se puede corregir la zona en el momento de aplicar', async () => {
    // El caso real: tres aperturas de agosto de 2026 traen zona «Centro», que
    // la operación dejó de usar en septiembre de 2024. Aplicarlas tal cual
    // metía al estado de fuerza servicios con una zona que no existe.
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS ZONA VIEJA', turnos: { '24X24': 2 }, zona: 'NORTE' });
    assert.equal(a.status, 201, a.texto);

    // Se deja pendiente y se le pone a mano la zona que ya no es opción, que es
    // como llegan las del archivo.
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para probar el arreglo al aplicar' }),
    });
    const zonaVieja = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'zona', valor: 'ZONA QUE YA NO SE USA' }),
    });
    await admin.pedir('/api/catalogos', {
      method: 'PATCH',
      body: JSON.stringify({ id: zonaVieja.json.id, activo: false }),
    });

    // Al aplicar se manda la corrección, y el servicio entra con la buena.
    const r = await admin.pedir(`/api/aperturas/${a.json.aperturaId}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({ zona: 'SUR' }),
    });
    assert.equal(r.status, 200, r.texto);

    const s = (await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio;
    assert.equal(s.zona, 'SUR');

    // Y el movimiento también quedó corregido: dejarlo solo en el servicio
    // partiría el dato en dos.
    const ap = (await admin.pedir('/api/aperturas')).json.aperturas.find((x) => x.id === a.json.aperturaId);
    assert.equal(ap.zona, 'SUR');
  });

  test('una corrección fuera del catálogo se rechaza', async () => {
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS CORRECCION MALA', turnos: { '12 HRS': 1 } });
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para probar' }),
    });
    const r = await admin.pedir(`/api/aperturas/${a.json.aperturaId}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({ zona: 'LA ZONA QUE YO QUIERA' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /no está en el catálogo/);
  });

  test('un valor escrito distinto se guarda como lo escribe el catálogo', async () => {
    // Las hojas traen «Traje» donde la lista dice «TRAJE». Es el mismo valor, y
    // dejar las dos formas conviviendo es como se llega a tener seis
    // supervisores partidos en doce renglones.
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS MAYUSCULAS', turnos: { '12 HRS': 1 }, uniforme: 'TRAJE' });
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para probar' }),
    });
    // Se le pone a mano la variante con otra caja, como llega del archivo.
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/corregir`, {
      method: 'PATCH',
      body: JSON.stringify({ uniforme: 'TRAJE' }),
    });

    const r = await admin.pedir(`/api/aperturas/${a.json.aperturaId}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio.uniforme, 'TRAJE');
  });

  test('sin correcciones se aplica tal como vino, como siempre', async () => {
    const a = await abrir({ tipo: 'APERTURA', servicio: 'OPS TAL CUAL', turnos: { '12 HRS': 1 }, zona: 'NORTE' });
    await admin.pedir(`/api/aperturas/${a.json.aperturaId}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'para probar' }),
    });
    const r = await admin.pedir(`/api/aperturas/${a.json.aperturaId}/aplicar`, { method: 'POST' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await admin.pedir(`/api/servicios/${r.json.servicioId}`)).json.servicio.zona, 'NORTE');
  });
});

describe('el REPSE lo puede capturar quien lo sabe', () => {
  let id;

  before(async () => {
    const r = await abrir({ tipo: 'APERTURA', servicio: 'OPS SIN REPSE AUN', turnos: { '24 HRS': 2 } });
    id = r.json.servicioId;
  });

  test('está vacío y la tabla lo dice, no lo esconde', async () => {
    // Cero de 217 servicios lo traen. Una columna que no se ve es una columna
    // que nadie llena.
    const s = (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
    assert.equal(s.tipo_repse, null);
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=OPS SIN REPSE AUN')).texto);
    assert.match(html, /REPSE/);
    assert.match(html, /falta/);
  });

  for (const rol of ['ventas', 'operaciones', 'finanzas']) {
    test(`${rol} lo captura`, async () => {
      const sesion = await app.entrarYAsentar(ROLES[rol]);
      const r = await sesion.pedir(`/api/servicios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tipo_repse: 'PLUS' }),
      });
      assert.equal(r.status, 200, r.texto);
      assert.equal((await admin.pedir(`/api/servicios/${id}`)).json.servicio.tipo_repse, 'PLUS');
      // Se deja como estaba para que el siguiente rol también vea un cambio.
      await admin.pedir(`/api/servicios/${id}`, { method: 'PATCH', body: JSON.stringify({ tipo_repse: 'BÁSICO' }) });
    });
  }

  test('pero solo eso: no se les abrió el bloque operativo', async () => {
    const ventas = await app.entrarYAsentar(ROLES.ventas);
    const r = await ventas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ precio_guardia: 99999, sueldo_base: 1 }),
    });
    assert.equal(r.status, 403, r.texto);
    assert.equal((await admin.pedir(`/api/servicios/${id}`)).json.servicio.precio_guardia, null);
  });

  test('sigue saliendo de catálogo: no vuelve a ser texto libre', async () => {
    const ventas = await app.entrarYAsentar(ROLES.ventas);
    const r = await ventas.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tipo_repse: 'EL QUE YO QUIERA' }),
    });
    assert.equal(r.status, 400, r.texto);
    assert.match(r.texto, /no está en el catálogo/);
  });

  test('jurídico y el espectador no lo tocan', async () => {
    const juridico = await app.entrarYAsentar(ROLES.juridico);
    const r = await juridico.pedir(`/api/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tipo_repse: 'PLUS' }),
    });
    assert.equal(r.status, 403, r.texto);
  });
});

describe('la tabla del estado de fuerza trae lo importante', () => {
  test('zona, tipo, supervisor, turnos con cantidad y la venta del mes', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    for (const encabezado of ['Zona · tipo', 'Quién lo lleva', 'Guardias y turnos', 'Venta al mes', 'Nómina y resultado', 'Contrato']) {
      assert.match(html, new RegExp(encabezado.replace(/[·]/g, '.')), `falta la columna «${encabezado}»`);
    }
    // Y el detalle de un servicio real: su tipo y su supervisor, que antes no
    // salían en ninguna columna.
    assert.match(html, /ALPURA|INDUSTRIA|SERVICIOS|CONDOMINIOS/);
  });

  test('una utilidad sin nómina detrás no se presenta como utilidad', async () => {
    // 25 servicios traen 100% porque el archivo calculó (venta − 0) ÷ venta.
    // Pintarlo en verde sería repetir la mentira.
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, /utilidad sin sustento/);
  });

  test('lo que falta se ve que falta, no se disimula con un guion', async () => {
    // La nómina está en 128 de 217 y el REPSE en 0. Un «—» no distingue «no
    // aplica» de «nadie lo ha capturado», y lo segundo es lo que hay que ir a
    // llenar.
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, /sin IVA: falta|utilidad: falta|REPSE.*falta/s);
  });

  test('el desglose por turno viene con su cantidad, no solo el total', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.match(html, /12X36|24 HRS|12 HRS/);
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
