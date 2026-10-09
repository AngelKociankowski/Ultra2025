/**
 * Las dos listas largas dejan de ser veinte pantallas, y sus totales no mienten.
 *
 * El estado de fuerza dibujaba sus 217 renglones de un tirón y «Por facturar»
 * de cobranza sus 219: llegar al final de cualquiera de las dos era desplazarse
 * veinte pantallas, y buscar un servicio que empieza por T era hacerlo a ojo.
 *
 * El arreglo tiene una trampa conocida y es la mitad de lo que se prueba aquí:
 * si se paginara en la consulta, el encabezado pasaría a contar la página. El
 * estado de fuerza diría «50 servicios · 212 guardias» y quien entra a mirar
 * cuántos guardias hay en la calle leería el total de una página. Así que la
 * pantalla recibe la lista completa, saca de ahí los totales y el reparto por
 * turno, y solo recorta lo que dibuja.
 *
 * Lo mismo en cobranza con el buscador: la lista llega entera y lo que se
 * recorta es lo que se pinta, porque buscar a un cliente que está en el renglón
 * ciento ochenta es justo lo que se hace cuando hay que facturarle aparte.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;
let activos;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const POR_PAGINA = 50;

/** Cuántos renglones de la tabla trae esta página del estado de fuerza. */
function filas(html) {
  const tabla = html.indexOf('Factura de');
  assert.notEqual(tabla, -1, 'no se encontró la tabla');
  return new Set([...html.slice(tabla).matchAll(/href="\/estado-fuerza\/(\d+)"/g)].map((m) => m[1])).size;
}

/**
 * El trozo de HTML de la sección «Por facturar», hasta donde empieza la
 * siguiente.
 *
 * Se corta por el título de la sección de abajo y se exige encontrarlo: sin
 * eso, un `indexOf` que falla devuelve −1, `slice` lo interpreta como «hasta el
 * penúltimo carácter» y la prueba acaba mirando la página entera —incluida la
 * carga de datos que React deja al final, donde están los 219 servicios.
 */
function seccionPorFacturar(html) {
  const i = html.indexOf('Por facturar —');
  assert.notEqual(i, -1, 'no se encontró la sección «Por facturar»');
  // «Cartera vencida» siempre se dibuja; la conciliación de abajo desaparece
  // cuando el mes no tiene facturas, así que no sirve de límite.
  const fin = html.indexOf('Cartera vencida', i);
  assert.notEqual(fin, -1, 'no se encontró dónde termina la sección');
  return html.slice(i, fin);
}

const encabezado = (html) => {
  const m = html.match(/([\d,]+) servicios · ([\d,]+) guardias/);
  assert.ok(m, 'no se pudo leer el encabezado');
  return { servicios: Number(m[1].replace(/,/g, '')), guardias: Number(m[2].replace(/,/g, '')) };
};

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  activos = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;
});

after(async () => {
  await app?.cerrar();
});

describe('estado de fuerza: se pagina al dibujar, no al consultar', () => {
  test('la primera página dibuja 50 y dice de cuántos', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    assert.equal(filas(html), POR_PAGINA);
    assert.match(html, new RegExp(`1 a ${POR_PAGINA} de ${activos.length}`));
  });

  test('el encabezado sigue contando los 217 y todos sus guardias', async () => {
    /**
     * Es el error clásico de paginar y la razón del contrato: la cabecera pasa a
     * contar la página. Aquí se comprueba contra la API, que no pagina.
     */
    const html = comoSeLee((await admin.pedir('/estado-fuerza')).texto);
    const esperado = {
      servicios: activos.length,
      guardias: activos.reduce((t, s) => t + (s.total_guardias || 0), 0),
    };
    assert.deepEqual(encabezado(html), esperado);
    assert.ok(esperado.servicios > POR_PAGINA, 'hacen falta más de una página para probar esto');
  });

  test('la última página trae el resto y el encabezado no se mueve', async () => {
    const paginas = Math.ceil(activos.length / POR_PAGINA);
    const resto = activos.length - (paginas - 1) * POR_PAGINA;
    const html = comoSeLee((await admin.pedir(`/estado-fuerza?pagina=${paginas}`)).texto);
    assert.equal(filas(html), resto);
    assert.equal(encabezado(html).servicios, activos.length);
  });

  test('una página fuera de rango se trae a la última, no a una tabla vacía', async () => {
    // Un `?pagina=99` no es un error del que haya que avisar: es un enlace
    // viejo, o un filtro que dejó menos páginas de las que había.
    const paginas = Math.ceil(activos.length / POR_PAGINA);
    const resto = activos.length - (paginas - 1) * POR_PAGINA;
    const html = comoSeLee((await admin.pedir('/estado-fuerza?pagina=99')).texto);
    assert.equal(filas(html), resto);
    assert.doesNotMatch(html, /Ningún servicio coincide con los filtros/);
  });

  test('una página que no es un número tampoco rompe nada', async () => {
    const r = await admin.pedir('/estado-fuerza?pagina=lo-que-sea');
    assert.equal(r.status, 200);
    assert.equal(filas(comoSeLee(r.texto)), POR_PAGINA);
  });

  test('paginar conserva los demás filtros', async () => {
    const zona = activos.find((s) => s.zona)?.zona;
    assert.ok(zona);
    const deLaZona = activos.filter((s) => s.zona === zona).length;

    const primera = comoSeLee((await admin.pedir(`/estado-fuerza?zona=${encodeURIComponent(zona)}`)).texto);
    assert.equal(encabezado(primera).servicios, deLaZona, 'el encabezado cuenta la zona entera');

    if (deLaZona > POR_PAGINA) {
      assert.match(primera, new RegExp(`zona=${encodeURIComponent(zona)}&amp;pagina=2`), 'el enlace lleva la zona');
      const segunda = comoSeLee(
        (await admin.pedir(`/estado-fuerza?zona=${encodeURIComponent(zona)}&pagina=2`)).texto
      );
      assert.equal(encabezado(segunda).servicios, deLaZona, 'y en la segunda página tampoco cambia');
    }
  });

  test('el CSV del corte sigue trayendo todos los servicios', async () => {
    // La descarga no se pagina: es el respaldo de lo que hay, y un CSV de
    // cincuenta renglones sería un respaldo falso.
    const r = await admin.pedir('/api/cortes/actual');
    assert.equal(r.status, 200);
    const renglones = r.texto.trim().split('\n').length - 1;
    assert.ok(
      renglones >= activos.length,
      `el CSV trajo ${renglones} renglones y hay ${activos.length} servicios activos`
    );
  });

  test('el paginador desaparece cuando todo cabe en una página', async () => {
    const html = comoSeLee((await admin.pedir('/estado-fuerza?q=NO EXISTE ESTE SERVICIO')).texto);
    assert.doesNotMatch(html, /a \d+ de \d+/, 'sin renglones no hay nada que paginar');
    assert.match(html, /Ningún servicio coincide con los filtros/);
  });
});

describe('cobranza: «Por facturar» se dibuja por tandas', () => {
  let pendientes;

  before(async () => {
    const r = await finanzas.pedir('/api/facturas?pendientes=1');
    assert.equal(r.status, 200, r.texto);
    pendientes = r.json;
  });

  test('el HTML inicial no trae más de 40 renglones y dice cuántas faltan', async () => {
    const html = comoSeLee((await finanzas.pedir('/cobranza')).texto);
    const seccion = seccionPorFacturar(html);

    // Cada renglón de la tabla lleva el botón «Facturar» de su fila.
    const renglones = (seccion.match(/>Facturar</g) || []).length;
    assert.ok(renglones > 0, 'tiene que haber pendientes para probar esto');
    assert.ok(renglones <= 40, `se pintaron ${renglones} renglones y el tope es 40`);
    assert.match(seccion, /Mostrar \d+ más/);
    assert.match(seccion, /faltan \d+ por pintar/);
  });

  test('el encabezado de la sección cuenta todos los pendientes, no los 40', async () => {
    const html = comoSeLee((await finanzas.pedir('/cobranza')).texto);
    const seccion = seccionPorFacturar(html);
    const m = seccion.match(/(\d+) pendientes? · (\d+) ya facturado/);
    assert.ok(m, 'no se pudo leer el conteo de la sección');
    assert.ok(Number(m[1]) > 40, `el conteo dice ${m[1]} y debería ser el total, no la tanda`);
  });

  test('el buscador trabaja sobre la lista completa y no sobre la tanda', async () => {
    /**
     * Es lo que impide que esto sea un error grave en lugar de una comodidad. Si
     * se buscara entre los cuarenta pintados, el buscador diría «ningún
     * pendiente coincide» de un cliente que sí está en la lista, y la pantalla
     * afirmaría que ya se le facturó.
     *
     * Se busca un servicio que la primera tanda NO alcanza a pintar: el orden
     * de la lista es alfabético, así que se toma uno del final.
     */
    const lista = pendientes.porFacturar;
    assert.ok(lista.length > 40, `hacen falta más de 40 pendientes y hay ${lista.length}`);
    const tarde = lista[lista.length - 1];

    const inicial = comoSeLee((await finanzas.pedir('/cobranza')).texto);
    assert.ok(
      !seccionPorFacturar(inicial).includes(tarde.servicio),
      `«${tarde.servicio}» no debería estar pintado en la primera tanda`
    );

    // El buscador es del navegador, así que lo que se comprueba por HTTP es que
    // el dato viaja completo al cliente: el servicio que no se pinta sí está en
    // la carga de la página, que es de donde el buscador lo va a sacar.
    assert.ok(inicial.includes(tarde.servicio), 'el servicio tiene que viajar en la página aunque no se pinte');
  });
});
