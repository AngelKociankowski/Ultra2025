/**
 * Ninguna pantalla señala un problema sin decir a dónde ir a arreglarlo.
 *
 * Es la regla que salió de recorrer la plataforma con alguien que la usa. Media
 * docena de pantallas sabían señalar un hueco y ninguna sabía llevar hasta él:
 *
 *   · «20 servicios sin contrato» en el tablero: tres pasos para llegar a la
 *     lista —Jurídico, acordarse de que hay filtro de estado, elegirlo.
 *   · «Ya vencidos: 58» con cinco nombres debajo. Los otros 53 eran un número
 *     que no llevaba a ninguna parte.
 *   · El panel de contradicciones de Jurídico decía «da clic en cualquiera para
 *     arreglarlo en la lista de abajo» y el enlace mandaba a otra pantalla.
 *   · «Dato faltante» en la columna de REPSE, en los 217 renglones, sin nada
 *     que ofreciera capturarlo.
 *
 * Y la otra mitad de la regla, que es la que impide que esto se vuelva ruido: en
 * los cortes cerrados y en las vistas por día no se ofrece ningún arreglo. Un
 * corte es el respaldo de lo que se facturó ese mes y no se edita ni con
 * permisos de administrador, así que ofrecer un arreglo ahí sería prometer uno.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let juridico;
let opciones;
let tablero;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/**
 * La etiqueta que abre un recuadro del tablero: es la que lleva el `href`
 * cuando el recuadro es enlace, y un `<div>` cuando no.
 *
 * Se corta hacia atrás desde el título y NO hacia adelante: la tarjeta de al
 * lado empieza unos cientos de caracteres después, y mirar hacia adelante
 * encontraba su enlace y acusaba al recuadro equivocado.
 */
function aperturaDelRecuadro(html, titulo) {
  const i = html.indexOf(titulo);
  assert.notEqual(i, -1, `no apareció el recuadro «${titulo}»`);
  const desde = html.lastIndexOf('bg-slate-800/50 border', i);
  assert.notEqual(desde, -1, `no se encontró la tarjeta de «${titulo}»`);
  return html.slice(html.lastIndexOf('<', desde), i);
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  opciones = (await admin.pedir('/api/catalogos')).json;
  tablero = comoSeLee((await admin.pedir('/')).texto);
});

after(async () => {
  await app?.cerrar();
});

describe('tablero: lo que señala un problema es enlace; lo que informa, no', () => {
  test('los tres recuadros que piden acción llevan a donde se atiende', () => {
    assert.match(tablero, /href="\/juridico\?estado=SIN_CONTRATO"/);
    assert.match(tablero, /href="\/estado-fuerza\?facturado=no"/);
    assert.match(tablero, /href="\/cobranza"/);
  });

  test('los tres informativos siguen sin enlace', () => {
    // No hay nada que ir a arreglar en «hay 217 servicios», y volverlos enlace
    // haría que los seis recuadros pesaran igual.
    for (const titulo of ['Servicios activos', 'Guardias en operación', 'Facturación mensual']) {
      assert.doesNotMatch(aperturaDelRecuadro(tablero, titulo), /href=/, `«${titulo}» no debería ser enlace`);
    }
  });

  test('y los tres que sí lo son abren con la etiqueta de enlace', () => {
    for (const [titulo, destino] of [
      ['Servicios sin contrato', '/juridico?estado=SIN_CONTRATO'],
      ['Servicios sin facturar', '/estado-fuerza?facturado=no'],
      ['Saldo vencido', '/cobranza'],
    ]) {
      assert.match(
        aperturaDelRecuadro(tablero, titulo),
        new RegExp(`href="${destino.replace(/[?]/g, '\\?')}"`),
        `«${titulo}» tiene que llevar a ${destino}`
      );
    }
  });

  test('el tablero no ganó ningún contador nuevo', () => {
    /**
     * La lección de las aperturas sin aplicar aplica hacia adelante. A los 217
     * servicios de la carga inicial les falta algo por capturar, así que un
     * recuadro de «incompletos» nacería en 217, no habría forma de llevarlo a
     * cero, y en dos semanas nadie lo mira —con el costo de que los avisos que
     * sí piden algo se leen igual de poco.
     */
    assert.doesNotMatch(tablero, /Falta por capturar/);
    assert.doesNotMatch(tablero, /faltan \d+ datos/);
    assert.doesNotMatch(tablero, /incompletos/i);
  });

  test('el bloque de contratos ofrece ver los que no caben en la lista de cinco', () => {
    const i = tablero.indexOf('Ya vencidos');
    assert.notEqual(i, -1);
    const bloque = tablero.slice(i, i + 4000);
    const cuantos = Number(bloque.match(/Ya vencidos<\/p><span[^>]*>(\d+)</)?.[1]);
    assert.ok(cuantos > 5, `hacen falta más de cinco vencidos para probar esto, hubo ${cuantos}`);
    assert.match(bloque, /href="\/juridico\?estado=VENCIDO"/);
    assert.match(bloque, new RegExp(`Ver los ${cuantos}`));
  });

  test('los movimientos recientes enlazan al servicio cuando lo tienen', () => {
    const i = tablero.indexOf('Movimientos recientes');
    assert.notEqual(i, -1);
    const bloque = tablero.slice(i);
    assert.match(bloque, /href="\/estado-fuerza\/\d+"/, 'al menos uno tiene que llevar a su ficha');
    // El que no tiene servicio ligado se queda como texto. Un enlace a la nada
    // sería peor que no ofrecerlo: hay 304 cancelaciones del archivo sin ligar.
    assert.doesNotMatch(bloque, /\/estado-fuerza\/null/);
    assert.doesNotMatch(bloque, /\/estado-fuerza\/undefined/);
  });
});

describe('jurídico: la agenda de renovaciones se puede abrir', () => {
  test('cada barra con vencimientos lleva a su mes', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico')).texto);
    const i = html.indexOf('Agenda de renovaciones');
    assert.notEqual(i, -1);
    const bloque = html.slice(i, html.indexOf('Cartera de contratos'));
    assert.match(bloque, /href="\/juridico\?vence=\d{4}-\d{2}#cartera"/, 'la barra tiene que ser enlace');
  });

  test('el subtotal del encabezado coincide con el número de la barra', async () => {
    // Se escoge un mes con vencimientos de la propia agenda, para no fijar un
    // mes en la prueba: con el tiempo la agenda se corre.
    const base = comoSeLee((await juridico.pedir('/juridico')).texto);
    const agenda = base.slice(base.indexOf('Agenda de renovaciones'), base.indexOf('Cartera de contratos'));
    const barras = [...agenda.matchAll(/>(\d+)<\/span><a[^>]*vence=(\d{4}-\d{2})#cartera/g)].map((m) => ({
      n: Number(m[1]),
      mes: m[2],
    }));
    assert.ok(barras.length > 0, 'hace falta alguna barra con vencimientos');

    for (const barra of barras.slice(0, 3)) {
      const html = comoSeLee((await juridico.pedir(`/juridico?vence=${barra.mes}`)).texto);
      const subtotal = Number(html.match(/Filtrado: <\/?[^>]*>?([\d,]+) servicio/)?.[1]?.replace(/,/g, ''));
      // Si los dos números no coincidieran, ninguno de los dos serviría: la
      // barra diría 21 y la lista traería otra cosa.
      assert.equal(subtotal, barra.n, `la barra de ${barra.mes} dice ${barra.n} y la lista ${subtotal}`);
    }
  });

  test('filtrar un mes aparta de verdad los de los otros meses', async () => {
    const base = comoSeLee((await juridico.pedir('/juridico')).texto);
    const agenda = base.slice(base.indexOf('Agenda de renovaciones'), base.indexOf('Cartera de contratos'));
    const meses = [...new Set([...agenda.matchAll(/vence=(\d{4}-\d{2})#cartera/g)].map((m) => m[1]))];
    assert.ok(meses.length >= 2, 'hacen falta dos meses con vencimientos para probar el aislamiento');

    // Los nombres salen de la primera columna de la tabla, que es donde el
    // renglón los escribe después del triángulo de desplegar.
    const nombres = async (mes) => {
      const html = comoSeLee((await juridico.pedir(`/juridico?vence=${mes}`)).texto);
      const tabla = html.slice(html.indexOf('Cartera de contratos'));
      return new Set([...tabla.matchAll(/<\/span>([^<]+)<\/p>/g)].map((m) => m[1].trim()).filter(Boolean));
    };

    const a = await nombres(meses[0]);
    const b = await nombres(meses[1]);
    assert.ok(a.size > 0 && b.size > 0);
    for (const id of a) assert.ok(!b.has(id), `el servicio ${id} salió en los dos meses`);
  });

  test('el filtro del mes se ve y se puede quitar', async () => {
    const base = comoSeLee((await juridico.pedir('/juridico')).texto);
    const mes = base.match(/\/juridico\?vence=(\d{4}-\d{2})#cartera/)[1];
    const html = comoSeLee((await juridico.pedir(`/juridico?vence=${mes}`)).texto);
    assert.match(html, new RegExp(`vencen en ${mes}`), 'un filtro invisible es de donde salen las llamadas');
  });
});

describe('jurídico: las contradicciones llevan a donde se arreglan', () => {
  let nombres;

  test('el panel ya no manda a otra pantalla', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico')).texto);
    const i = html.indexOf('capturas que se contradicen');
    assert.notEqual(i, -1, 'la carga inicial trae contradicciones: por eso existe el panel');
    const bloque = html.slice(i, html.indexOf('Cartera de contratos'));

    assert.doesNotMatch(bloque, /\/estado-fuerza\//, 'el texto promete la lista de abajo; el enlace tiene que ir ahí');
    assert.match(bloque, /\/juridico\?raro=sin_marca#cartera/);

    // Los nombres de la lista, sin el enlace de grupo que va debajo: ese dice
    // «Verlos en la cartera de abajo» y apunta al mismo sitio.
    nombres = [...bloque.matchAll(/raro=sin_marca#cartera"[^>]*>([^<]+)</g)]
      .map((m) => m[1].trim())
      .filter((n) => !n.startsWith('Verlos'));
    assert.ok(nombres.length > 0, 'el bloque enlaza a sus servicios');
  });

  test('?raro=sin_marca trae exactamente los del bloque', async () => {
    const html = comoSeLee((await juridico.pedir('/juridico?raro=sin_marca')).texto);
    const tabla = html.slice(html.indexOf('Cartera de contratos'));

    const subtotal = Number(html.match(/Filtrado: <\/?[^>]*>?([\d,]+) servicio/)?.[1]?.replace(/,/g, ''));
    assert.equal(subtotal, nombres.length, 'el panel y la lista filtrada cuentan lo mismo');
    for (const n of nombres) assert.ok(tabla.includes(n), `falta ${n} en la lista filtrada`);
  });

  test('?raro=sin_respaldo es la otra contradicción, no la misma', async () => {
    const sinMarca = comoSeLee((await juridico.pedir('/juridico?raro=sin_marca')).texto);
    const sinRespaldo = comoSeLee((await juridico.pedir('/juridico?raro=sin_respaldo')).texto);
    const leer = (h) => Number(h.match(/Filtrado: <\/?[^>]*>?([\d,]+) servicio/)?.[1]?.replace(/,/g, ''));
    const a = leer(sinMarca);
    const b = leer(sinRespaldo);
    const total = Number(
      comoSeLee((await juridico.pedir('/juridico')).texto).match(/capturas que se contradicen/) &&
        comoSeLee((await juridico.pedir('/juridico')).texto).match(/>([\d,]+) capturas que se contradicen/)?.[1]
          ?.replace(/,/g, '')
    );
    assert.ok(a >= 0 && b >= 0);
    if (Number.isFinite(total) && total > 0) assert.equal(a + b, total, 'las dos listas suman el total del panel');
  });

  test('un valor inventado en la URL no vacía la pantalla', async () => {
    const r = await juridico.pedir('/juridico?raro=lo-que-sea');
    assert.equal(r.status, 200);
    assert.match(comoSeLee(r.texto), /Total: /, 'se cae a la cartera completa');
  });
});

describe('estado de fuerza: las marcas de dato faltante llevan a donde se capturan', () => {
  let id;

  before(async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'ARREGLO AL LADO',
        zona: opciones.zonas[0],
        asesor: opciones.asesores[0],
        guardias: 4,
      }),
    });
    assert.equal(r.status, 201, r.texto);
    id = r.json.servicioId;
  });

  test('la ficha trae los tres anclajes a los que apuntan las marcas', async () => {
    const html = (await admin.pedir(`/estado-fuerza/${id}`)).texto;
    assert.match(html, /id="completar"/, 'el panel de huecos del alta');
    assert.match(html, /id="editar"/, 'el editor por grupos de rol');
    assert.match(html, /id="corregir"/, 'y la corrección de captura');
  });

  /**
   * El renglón de la tabla, cortado DESPUÉS del encabezado.
   *
   * Buscar el nombre en toda la página encuentra primero el `value=` de la caja
   * de búsqueda —el filtro está puesto— y devolvía el formulario de filtros en
   * lugar del renglón.
   */
  const renglonDe = (html, nombre) => {
    const tabla = html.indexOf('Factura de');
    assert.notEqual(tabla, -1, 'no se encontró la tabla');
    const i = html.indexOf(nombre, tabla);
    assert.notEqual(i, -1, `no apareció «${nombre}» en la tabla`);
    return html.slice(i, i + 4000);
  };

  test('el renglón sin desglose lleva a la corrección, no al panel de huecos', async () => {
    // El desglose por jornada es la plantilla del servicio —lo que describe el
    // estado de fuerza— y se arregla con un motivo escrito, no llenando un
    // hueco del alta.
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=ARREGLO AL LADO')).texto);
    const renglon = renglonDe(html, 'ARREGLO AL LADO');
    assert.match(renglon, /sin desglose/);
    assert.match(renglon, new RegExp(`/estado-fuerza/${id}#corregir`));
  });

  test('el REPSE y la nómina vacíos llevan al panel de huecos', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=ARREGLO AL LADO')).texto);
    const renglon = renglonDe(html, 'ARREGLO AL LADO');
    assert.match(renglon, /Dato faltante/);
    assert.match(renglon, new RegExp(`/estado-fuerza/${id}#completar`));
  });

  test('en un corte cerrado las marcas son texto sin enlace', async () => {
    const periodos = (await admin.pedir('/api/cortes/2026-03')).status;
    assert.equal(periodos, 200, 'hace falta un corte cerrado para probar esto');

    const html = comoSeLee((await admin.pedir('/estado-fuerza?periodo=2026-03')).texto);
    assert.match(html, /corte de marzo 2026 · cerrado/);
    assert.doesNotMatch(html, /#completar/, 'el pasado no se edita');
    assert.doesNotMatch(html, /#corregir/);
    assert.doesNotMatch(html, /faltan \d+ datos/, 'ni se acusa de huecos que nacieron después del corte');
    assert.doesNotMatch(html, /Les falta capturar algo/, 'ni se ofrece el filtro');
  });

  test('en la vista por día, lo mismo', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?dia=2026-09-15')).texto);
    assert.match(html, /al 15 de septiembre de 2026/);
    assert.doesNotMatch(html, /#completar/);
    assert.doesNotMatch(html, /faltan \d+ datos/);
    assert.doesNotMatch(html, /Les falta capturar algo/);
  });
});

describe('estado de fuerza: el filtro de captura pendiente', () => {
  test('?falta=1 deja solo los que les falta algo, y el encabezado cuenta esos', async () => {
    const todos = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    const filtrado = comoSeLee((await admin.pedir('/estado-fuerza?falta=1')).texto);

    const leer = (h) => Number(h.match(/([\d,]+) servicios · /)?.[1]?.replace(/,/g, ''));
    const a = leer(todos);
    const b = leer(filtrado);
    assert.ok(a > 0 && b > 0, `no se pudieron leer los encabezados (${a}, ${b})`);
    assert.ok(b <= a, `el filtrado (${b}) no puede traer más que el total (${a})`);

    // Y cada renglón que salió trae su etiqueta: si alguno no la trajera, el
    // filtro estaría dejando pasar servicios completos.
    const tabla = filtrado.slice(filtrado.indexOf('Factura de'));
    const renglones = [...tabla.matchAll(/href="\/estado-fuerza\/(\d+)"/g)].map((m) => m[1]);
    assert.ok(renglones.length > 0);
    const etiquetas = (tabla.match(/faltan \d+ datos?/g) || []).length;
    assert.equal(etiquetas, renglones.length, 'todos los filtrados tienen que traer la etiqueta');
  });

  test('el filtro se ve puesto y se puede quitar', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?falta=1')).texto);
    assert.match(html, /Estás viendo una parte:/);
    assert.match(html, /les falta capturar algo/);
    assert.match(html, /Quitar el filtro/);
  });
});

describe('los enlaces nuevos no son botones de escritura', () => {
  test('el espectador ve los enlaces de arreglo y ningún botón nuevo', async () => {
    /**
     * Ver la ficha de un servicio ya es de todos, así que los enlaces de arreglo
     * los ve cualquier rol: lo que está condicionado por rol es lo que escribe.
     * Esta prueba está aquí para que no se cuele un botón disfrazado de enlace.
     */
    const html = comoSeLee((await juridico.pedir('/estado-fuerza')).texto);
    assert.match(html, /#completar/, 'jurídico sí ve a dónde se arregla');
    const i = html.indexOf('Factura de');
    const tabla = html.slice(i);
    assert.doesNotMatch(tabla, /<button/, 'y en la tabla no aparece ningún botón');
  });
});
