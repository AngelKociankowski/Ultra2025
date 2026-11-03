/**
 * El cuadre del estado de fuerza entre dos fechas, y el guardián que lo sostiene.
 *
 * El caso real: el dueño tenía 815 guardias en una fecha, dio de alta 26, y el
 * estado de fuerza decía 850. Sobraban nueve y el asistente no se lo supo
 * explicar. La causa no era un error de cuenta: era que el número puede cambiar
 * sin que ningún movimiento lo cuente, porque la corrección de la ficha escribe
 * la columna del invariante y no crea ningún movimiento.
 *
 * Lo que se mide aquí tiene dos mitades y la primera importa más:
 *
 *   · LEYENDO EL CÓDIGO: que todo sitio que escribe `servicios.total_guardias`
 *     esté declarado en `SITIOS_QUE_MUEVEN_EL_TOTAL` con el término del cuadre
 *     que lo cubre. Hoy son ocho sentencias en cinco funciones. El día que haya
 *     una novena, esto se pone rojo antes de que el cuadre deje de cerrar sin que
 *     nadie sepa por qué. Sin esta mitad, el cuadre sería una resta que funciona
 *     hoy y miente cuando cambie el código.
 *   · CORRIENDO EL ASISTENTE POR HTTP: que la resta cierre exacto cuando tiene
 *     que cerrar, Y QUE AVISE CUANDO NO. Lo segundo se demuestra fabricando el
 *     caso: se escribe la columna por fuera —que es el noveno sitio— y se exige
 *     que el cuadre deje de cerrar y lo diga.
 *
 * Ninguna cifra está escrita a mano: los dos extremos se comprueban contra el
 * HTML de la pantalla de Estado de fuerza, y los términos contra las APIs de
 * Aperturas, Cancelaciones y correcciones.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';
import { arrancarDoble } from './doble-modelo.mjs';
import { escriturasDelTotal, escriturasEnTexto } from './_sitios-del-total.mjs';

let app;
let doble;
let admin;
let cat;
let SITIOS;
let TERMINOS;

const comoLaLeeUnaPersona = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const eventos = (texto) =>
  texto
    .split('\n')
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));

function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Corre una consulta del asistente por HTTP y devuelve los datos que de verdad
 * salieron hacia el servicio externo.
 *
 * Se mide así y no llamando a la función porque lo que importa es lo que viaja:
 * el resultado completo va en la SIGUIENTE petición a la red, y es ahí donde se
 * vería un campo que se queda por el camino.
 */
async function correr(nombre, args, sesion = null) {
  doble.olvidar();
  doble.guionar([{ herramientas: [{ nombre, args }] }, { texto: 'Ahí está.' }]);
  const quien = sesion || admin;
  const r = await quien.pedir('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ pregunta: `corre ${nombre}`, previas: [] }),
  });
  assert.equal(r.status, 200, `${nombre} → ${r.status}: ${r.texto.slice(0, 200)}`);
  const bloques = (doble.peticiones()[1]?.cuerpo?.messages || [])
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  assert.equal(bloques.length, 1, `${nombre}: no volvió exactamente un resultado`);
  assert.notEqual(bloques[0].is_error, true, `${nombre} falló: ${bloques[0].content}`);
  const fichas = eventos(r.texto).filter((e) => e.tipo === 'ficha');
  assert.equal(fichas.length, 1, `${nombre} no dejó ficha`);
  return { datos: JSON.parse(bloques[0].content).datos, ficha: fichas[0].ficha };
}

/** El cuadre entre dos fechas, tal como se lo pide el modelo. */
const cuadre = async (desde, hasta) =>
  (await correr('bitacora', { desde, hasta, cuadrarElEstadoDeFuerza: true })).datos;

/** Los guardias que pinta la pantalla de Estado de fuerza, leídos del HTML. */
async function guardiasEnPantalla(periodo = '') {
  const ruta = periodo ? `/estado-fuerza?periodo=${periodo}` : '/estado-fuerza';
  const html = comoLaLeeUnaPersona((await admin.pedir(ruta)).texto);
  const casa = /([\d,]+)\s*servicios\s*·\s*([\d,]+)\s*guardias/.exec(html);
  assert.ok(casa, `la pantalla ${ruta} no pinta «N servicios · M guardias»`);
  return Number(casa[2].replace(/,/g, ''));
}

const abrir = (cuerpo) => admin.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });

before(async () => {
  doble = await arrancarDoble([{ texto: 'Listo.' }]);
  // Los topes muy altos: aquí se corren muchas consultas y el tope de preguntas
  // cortaría la medición a media prueba.
  app = await arrancar({ env: { ...doble.env, CHAT_TOPE_PREGUNTAS: '100000', CHAT_TOPE_CENTAVOS: '1000000' } });
  admin = await app.entrarYAsentar(ROLES.admin);
  cat = (await admin.pedir('/api/catalogos')).json;

  const { register } = await import('node:module');
  register(new URL('./_resolver-sin-extension.mjs', import.meta.url));
  const m = await import(new URL('../lib/cuadre.js', import.meta.url).href);
  SITIOS = m.SITIOS_QUE_MUEVEN_EL_TOTAL;
  TERMINOS = m.TERMINOS_DEL_CUADRE;
});

after(async () => {
  await app?.cerrar();
  await doble?.cerrar();
});

// ─────────────────────────────────────────────────────────────────────────────
// G · el guardián, leyendo el código
// ─────────────────────────────────────────────────────────────────────────────

describe('G · todo sitio que mueve el total está declarado en el cuadre', () => {
  test('G1 el censo del código no encuentra ninguna escritura sin declarar', () => {
    const medidas = escriturasDelTotal();
    assert.ok(medidas.length > 0, 'el censo no encontró ninguna escritura: no estaría midiendo nada');

    const declaradas = new Set(SITIOS.map((s) => s.funcion));
    const huerfanas = medidas
      .filter((e) => !declaradas.has(e.funcion))
      .map((e) => `${e.archivo}:${e.linea} → ${e.funcion}() con ${e.forma}`);
    assert.deepEqual(
      huerfanas,
      [],
      'estos sitios escriben «servicios.total_guardias» y no están declarados en ' +
        'SITIOS_QUE_MUEVEN_EL_TOTAL de lib/cuadre.js, así que el cuadre del estado de fuerza dejaría de ' +
        `cerrar sin que nada dijera por qué: ${huerfanas.join(' · ')}`
    );
  });

  test('G2 las cuentas cuadran: tantas sentencias declaradas como medidas', () => {
    /**
     * No basta con que la FUNCIÓN esté declarada: una sentencia nueva dentro de
     * una función que ya está en la lista también mueve el número, y es la forma
     * más silenciosa de que entre.
     */
    const medidasPorFuncion = new Map();
    for (const e of escriturasDelTotal()) {
      medidasPorFuncion.set(e.funcion, (medidasPorFuncion.get(e.funcion) || 0) + 1);
    }
    const desajustes = [];
    for (const sitio of SITIOS) {
      const medidas = medidasPorFuncion.get(sitio.funcion) || 0;
      if (medidas !== sitio.sentencias) {
        desajustes.push(`${sitio.funcion}(): declara ${sitio.sentencias} sentencias y el código tiene ${medidas}`);
      }
    }
    assert.deepEqual(desajustes, [], `el censo declarado no coincide con el código: ${desajustes.join(' · ')}`);
  });

  test('G3 cada sitio declarado dice a qué término del cuadre alimenta, y el término existe', () => {
    const malos = SITIOS.filter((s) => !TERMINOS.includes(s.termino)).map((s) => `${s.funcion} → ${s.termino}`);
    assert.deepEqual(malos, [], `estos sitios dicen alimentar un término que el cuadre no tiene: ${malos.join(' · ')}`);
    // Y los tres términos están cubiertos: si uno se quedara sin ningún sitio,
    // sería un término que no explica nada.
    for (const termino of TERMINOS) {
      assert.ok(
        SITIOS.some((s) => s.termino === termino),
        `el término «${termino}» del cuadre no lo alimenta ningún sitio del código`
      );
    }
    // Y el hallazgo que trajo el encargo, escrito donde se puede comprobar: hay
    // un sitio que mueve el número sin dejar movimiento.
    const sinMovimiento = SITIOS.filter((s) => /NINGÚN movimiento/i.test(s.rastro));
    assert.ok(
      sinMovimiento.length > 0,
      'ningún sitio declara que no deja movimiento, y el caso de los nueve guardias salió justo de uno'
    );
  });

  test('G4 el guardián muerde: una escritura nueva sin declarar se caza', () => {
    /**
     * La prueba de la prueba. Se le pasan por delante las tres formas en que una
     * escritura nueva puede entrar y se exige que el censo las vea, sin tocar
     * `lib/`.
     */
    const formas = [
      [
        'un UPDATE nuevo en una función nueva',
        `function ajustarPlantillaDeGolpe(db, id, n) {
           db.prepare('UPDATE servicios SET total_guardias = ? WHERE id = ?').run(n, id);
         }`,
      ],
      [
        'un INSERT nuevo que trae la columna',
        `function sembrarServicio(db) {
           db.prepare('INSERT INTO servicios (servicio, total_guardias) VALUES (?,?)').run('X', 3);
         }`,
      ],
      [
        'la escritura armada con las columnas que cambiaron',
        `function tocarPorColumnas(sets, n) {
           sets.total_guardias = n;
         }`,
      ],
    ];
    const declaradas = new Set(SITIOS.map((s) => s.funcion));
    for (const [que, codigo] of formas) {
      const cazadas = escriturasEnTexto('lib/inventado.js', codigo);
      assert.ok(cazadas.length > 0, `el censo dejó pasar ${que}`);
      assert.ok(
        cazadas.every((c) => !declaradas.has(c.funcion)),
        `${que}: el censo la cazó pero la daría por declarada`
      );
    }
  });

  test('G5 y no muerde lo que no debe: un comentario que la nombra ni una lectura', () => {
    // El archivo está lleno de SQL citado en prosa —la cabecera de
    // `normalizarTurnos()` nombra la columna para explicar por qué se valida— y
    // contar una explicación como si fuera una escritura dejaría el censo
    // mintiendo por el otro lado.
    const inocentes = [
      ['un comentario que cita la columna', '// por aquí se escribía servicios.total_guardias sin pasar por el sitio único'],
      ['un bloque que la cita', '/* UPDATE servicios SET total_guardias = ? era lo que había antes */'],
      ['una lectura', "db.prepare('SELECT COUNT(*) n, SUM(total_guardias) g FROM servicios').get();"],
      ['un UPDATE de servicios que no la toca', "db.prepare('UPDATE servicios SET zona = ? WHERE id = ?').run(z, id);"],
      ['un UPDATE de otra tabla que sí la nombraría', "db.prepare('UPDATE snapshots SET total_guardias = ? WHERE id = ?').run(n, id);"],
    ];
    for (const [que, codigo] of inocentes) {
      assert.deepEqual(
        escriturasEnTexto('lib/inventado.js', codigo),
        [],
        `el censo cazó ${que}, que no escribe la columna del estado de fuerza`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C · el cuadre, corriendo el asistente por HTTP
// ─────────────────────────────────────────────────────────────────────────────

describe('C · la resta cierra, y los dos extremos son los de sus pantallas', () => {
  test('C1 sobre la base sin tocar, el cuadre cierra y no se inventa ningún extremo', async () => {
    const datos = await cuadre('2026-08-01', new Date().toISOString().slice(0, 10));
    const c = datos.cuadreDelEstadoDeFuerza;
    assert.ok(c, 'se pidió el cuadre y no viajó');
    assert.equal(c.sePuede, true, `el cuadre no se pudo hacer: ${c.porQueNo}`);

    // Los dos extremos, contra el HTML de la pantalla de Estado de fuerza. Es la
    // comprobación que de verdad importa: el asistente tiene que cuadrar con su
    // pantalla espejo, y estos dos números son los que la pantalla pinta arriba.
    const periodoDelCorte = c.alInicio.fecha.slice(0, 7);
    assert.equal(
      c.alInicio.guardias,
      await guardiasEnPantalla(periodoDelCorte),
      `el extremo de arranque no es el que pinta /estado-fuerza?periodo=${periodoDelCorte}`
    );
    assert.equal(
      c.alFinal.guardias,
      await guardiasEnPantalla(),
      'el extremo de cierre no es el que pinta la pantalla de Estado de fuerza'
    );

    assert.equal(c.residuo, 0, `el cuadre de la base sin tocar deja ${c.residuo} guardias sin explicar`);
    assert.equal(c.cuadra, true);
    assert.equal(c.diferenciaDeGuardias, c.sumaDeLoExplicado, 'la resta no es la suma de los términos');
    // Y la foto de arranque es una que no se mueve: contra una reconstrucción,
    // una corrección de hoy cambiaría el pasado y el término de correcciones no
    // tendría contra qué medirse.
    assert.equal(c.alInicio.congelada, true, 'el extremo de arranque no es una foto guardada');
  });

  test('C2 el caso de los nueve guardias: las altas y la corrección dan EXACTAMENTE la diferencia', async () => {
    /**
     * El caso del dueño, reproducido con los datos de la plataforma: tantas altas
     * y una corrección que suma guardias sin dejar movimiento. Lo que se afirma no
     * es ninguna cifra escrita aquí: es que los términos del cuadre son los que
     * dicen las APIs de Aperturas y de correcciones, y que su suma es la
     * diferencia entre los dos extremos hasta el último guardia.
     */
    const antes = (await cuadre('2026-08-01', new Date().toISOString().slice(0, 10))).cuadreDelEstadoDeFuerza;

    // Las altas: una por cada zona del catálogo, para no escribir un número.
    for (const [i, zona] of cat.zonas.entries()) {
      const r = await abrir({
        tipo: 'APERTURA',
        servicio: `CUADRE NUEVE ALTA ${i + 1}`,
        zona,
        asesor: cat.asesores[0],
        turnos: { '24 HRS': 1 },
      });
      assert.equal(r.status, 201, r.texto);
    }

    // La corrección: nueve guardias que el desglose nunca dijo, sobre un servicio
    // que ya estaba antes de la ventana. Es el sitio que no deja movimiento.
    const viejos = (await admin.pedir('/api/servicios')).json.servicios.filter(
      (s) => s.fecha_alta && s.fecha_alta < antes.alInicio.fecha && Object.keys(s.turnos || {}).length === 1
    );
    assert.ok(viejos.length > 0, 'no hay ningún servicio anterior al corte con un solo turno: no se puede medir');
    const victima = viejos[0];
    const jornada = Object.keys(victima.turnos)[0];
    const corregida = await admin.pedir(`/api/servicios/${victima.id}/correccion`, {
      method: 'POST',
      body: JSON.stringify({
        total_guardias: victima.total_guardias + 9,
        turnos: { [jornada]: victima.turnos[jornada] + 9 },
        motivo: 'La plantilla real traía nueve guardias más desde el alta y nunca se capturó.',
      }),
    });
    assert.equal(corregida.status, 201, corregida.texto);

    const c = (await cuadre('2026-08-01', new Date().toISOString().slice(0, 10))).cuadreDelEstadoDeFuerza;

    // La afirmación de fondo: la suma da exactamente la diferencia.
    assert.equal(
      c.diferenciaDeGuardias,
      c.sumaDeLoExplicado,
      `la diferencia es ${c.diferenciaDeGuardias} y lo explicado ${c.sumaDeLoExplicado}: quedan ${c.residuo} ` +
        'guardias sin explicar'
    );
    assert.equal(c.residuo, 0);
    assert.equal(c.cuadra, true);

    // Y cada término, contra la API que lo publica.
    const aperturas = (await admin.pedir('/api/aperturas')).json.aperturas || [];
    const dentro = aperturas.filter(
      (a) => a.fecha > c.alInicio.fecha && a.fecha <= c.alFinal.fecha && !a.descartada && a.servicio_id
    );
    assert.equal(
      c.altas.movimientos,
      dentro.length,
      `el cuadre cuenta ${c.altas.movimientos} altas aplicadas en la ventana y la API de Aperturas ${dentro.length}`
    );
    assert.equal(
      c.altas.guardias,
      dentro.reduce((a, m) => a + (m.guardias || 0), 0),
      'los guardias de alta del cuadre no son los de la API de Aperturas'
    );

    const registradas = (await admin.pedir(`/api/servicios/${victima.id}/correccion`)).json.correcciones;
    const delNumero = registradas.filter((x) => x.guardias_despues !== x.guardias_antes);
    assert.equal(
      c.correcciones.guardias,
      delNumero.reduce((a, x) => a + (x.guardias_despues - x.guardias_antes), 0),
      'los guardias de corrección del cuadre no son los que registró la propia corrección'
    );
    assert.ok(c.correcciones.guardias > 0, 'la corrección no movió el número: el caso no se reprodujo');

    // Y el detalle que explica el número, que es lo que faltaba: la lista nombra
    // la corrección, con su antes, su después y quién la hizo.
    const renglon = datosDeLaCorreccion(c, await cuadre('2026-08-01', new Date().toISOString().slice(0, 10)));
    assert.ok(renglon, 'el cuadre no trae el detalle de las correcciones que suma');
    assert.equal(renglon.diferencia, c.correcciones.guardias);
    assert.ok(renglon.usuario, 'el detalle no dice quién hizo la corrección');
    assert.ok(renglon.motivo, 'el detalle no dice por qué se hizo');
    assert.equal(renglon.servicio_id, victima.id);
  });

  test('C3 una baja entra por su propio término y el cuadre sigue cerrando', async () => {
    const servicios = (await admin.pedir('/api/servicios')).json.servicios;
    const victima = servicios.find((s) => s.servicio.startsWith('CUADRE NUEVE ALTA'));
    assert.ok(victima, 'no hay un servicio sembrado que cancelar');

    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: victima.id,
        motivo: cat.motivosBaja[0],
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const c = (await cuadre('2026-08-01', new Date().toISOString().slice(0, 10))).cuadreDelEstadoDeFuerza;
    assert.equal(c.bajas.guardias, victima.total_guardias, 'la baja no entró por el término de bajas');
    assert.equal(c.residuo, 0, `la baja dejó ${c.residuo} guardias sin explicar`);
    assert.equal(c.cuadra, true);
  });
});

describe('C · y cuando NO cierra, lo dice', () => {
  test('C4 un noveno sitio que escribe la columna por fuera: el cuadre deja de cerrar y lo nombra', async () => {
    /**
     * El requisito duro del encargo, demostrado fabricando el caso: se escribe
     * `servicios.total_guardias` por fuera de los sitios declarados —que es lo
     * que haría una función nueva que nadie declaró— y se exige que el cuadre
     * deje de cerrar y lo diga.
     *
     * Un cuadre que no cierra y se calla es peor que no tenerlo: sería otra cifra
     * con cara de buena.
     */
    const victima = (await admin.pedir('/api/servicios')).json.servicios.find((s) =>
      s.servicio.startsWith('CUADRE NUEVE ALTA')
    );
    assert.ok(victima, 'no hay un servicio sembrado al que moverle el número por fuera');

    const antes = (await cuadre('2026-08-01', new Date().toISOString().slice(0, 10))).cuadreDelEstadoDeFuerza;
    assert.equal(antes.cuadra, true, 'el cuadre ya no cerraba antes de romperlo: la prueba no mediría nada');

    const porFuera = 7;
    conLaBase((db) =>
      db
        .prepare('UPDATE servicios SET total_guardias = total_guardias + ? WHERE id = ?')
        .run(porFuera, victima.id)
    );
    try {
      const roto = (await cuadre('2026-08-01', new Date().toISOString().slice(0, 10))).cuadreDelEstadoDeFuerza;
      assert.equal(roto.cuadra, false, 'el cuadre siguió diciendo que cierra con el número movido por fuera');
      assert.equal(
        roto.residuo,
        roto.diferenciaDeGuardias - roto.sumaDeLoExplicado,
        'el residuo no es lo que la suma no explica'
      );
      assert.equal(
        roto.residuo - antes.residuo,
        porFuera,
        `se movieron ${porFuera} guardias por fuera y el residuo creció ${roto.residuo - antes.residuo}`
      );
      // Y los tres términos siguen diciendo lo mismo: el residuo NO se repartió
      // entre ellos para que la resta saliera redonda.
      assert.equal(roto.altas.guardias, antes.altas.guardias, 'el residuo se le cargó a las altas');
      assert.equal(roto.bajas.guardias, antes.bajas.guardias, 'el residuo se le cargó a las bajas');
      assert.equal(
        roto.correcciones.guardias,
        antes.correcciones.guardias,
        'el residuo se le cargó a las correcciones'
      );
      // Y lo dice con palabras hacia el modelo, no solo con un número.
      const datos = await cuadre('2026-08-01', new Date().toISOString().slice(0, 10));
      assert.match(
        datos.cuadreDelEstadoDeFuerzaQueCuenta,
        /residuo/i,
        'nada le dice al modelo qué es «residuo», así que un cuadre roto se leería como uno bueno'
      );
      assert.ok(roto.pistasDelResiduo, 'no viajan las pistas que permiten nombrar el residuo');
    } finally {
      conLaBase((db) =>
        db
          .prepare('UPDATE servicios SET total_guardias = total_guardias - ? WHERE id = ?')
          .run(porFuera, victima.id)
      );
    }

    // Y suelta: deshecho el apaño, el cuadre vuelve a cerrar. Sin esto, «deja de
    // cerrar» podría ser un cuadre que nunca cierra.
    const sano = (await cuadre('2026-08-01', new Date().toISOString().slice(0, 10))).cuadreDelEstadoDeFuerza;
    assert.equal(sano.cuadra, true, 'el cuadre no volvió a cerrar al deshacer la escritura de fuera');
  });

  test('C5 una fecha sin foto no se inventa: dice entre qué fechas sí se puede', async () => {
    // La primera foto es el corte más viejo que haya. Antes de ella no hay nada
    // que no se mueva, y un número reconstruido de entonces se queda corto sin
    // avisar: la respuesta es decirlo, no dar la cifra.
    const datos = await cuadre('1999-01-01', '1999-12-31');
    const c = datos.cuadreDelEstadoDeFuerza;
    assert.equal(c.sePuede, false, 'se cuadró contra una foto que no existe');
    assert.match(c.porQueNo, /foto/i);
    assert.ok(
      datos.fotosDelEstadoDeFuerzaTotal > 0,
      'no se ofrece ninguna fecha con foto, así que quien pregunta se queda sin saber qué pedir'
    );
    assert.ok(datos.fotosDelEstadoDeFuerza.every((f) => f.fecha && f.fuente));
  });

  test('C6 una fecha que no es una fecha no revienta, y la respuesta dice qué se contestó', async () => {
    /**
     * «El mes pasado» no es una fecha, y lo que NO se puede hacer es adivinar
     * cuál era: se contesta con las fotos que hay y la respuesta lo DICE. Es la
     * misma regla con la que la consulta de movimientos trata un mes que no se
     * entiende, y por la misma razón: cambiar la pregunta en silencio es el
     * defecto que esta plataforma lleva meses cerrando.
     */
    const datos = await cuadre('el mes pasado', 'hoy');
    assert.match(datos.avisoDelPeriodo || '', /no se entendió/, 'se ignoró un extremo sin decirlo');
    assert.match(datos.avisoDelPeriodo || '', /AAAA-MM-DD/, 'el aviso no dice cómo se pide una fecha');

    const c = datos.cuadreDelEstadoDeFuerza;
    assert.equal(c.sePuede, true, c.porQueNo);
    assert.ok(c.alInicio.fecha && c.alFinal.fecha, 'no se dice con qué fotos se contestó');
    assert.equal(c.cuadra, true);

    // Y el aviso no repite el texto que vino de fuera: ese texto lo elige el
    // servicio externo y un aviso con él dentro sería texto de fuera viajando con
    // cara de hecho del servidor.
    assert.ok(!JSON.stringify(datos).includes('el mes pasado'), 'el texto de fuera volvió dentro de la respuesta');
  });

  test('C7 sin fechas, cuadra entre las dos fotos más recientes y dice cuáles son', async () => {
    const c = (await correr('bitacora', { cuadrarElEstadoDeFuerza: true })).datos.cuadreDelEstadoDeFuerza;
    assert.equal(c.sePuede, true, c.porQueNo);
    assert.equal(c.alFinal.fuente, 'estado de fuerza vigente');
    assert.match(c.alInicio.fuente, /corte guardado de/);
    assert.ok(c.alInicio.fecha < c.alFinal.fecha);
  });
});

/** El renglón de la corrección que el cuadre suma, buscado por su diferencia. */
function datosDeLaCorreccion(c, datos) {
  return (datos.correccionesDelPeriodo || []).find((x) => x.diferencia === c.correcciones.guardias) || null;
}
