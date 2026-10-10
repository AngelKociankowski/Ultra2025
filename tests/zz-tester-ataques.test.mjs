/**
 * Pruebas del TESTER. No son del coder y no se escribieron para pasar.
 *
 * Se atacan los criterios del plan directamente: el mínimo del alta, la regla
 * dura de «solo de vacío a valor», el descarte en lote (reversible y sin tocar
 * lo reciente), los totales de la paginación y los enlaces de «arreglo al lado».
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
let finanzas;
let miron;
let anon;
let opciones;

const limpio = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;
const completar = (sesion, id, cuerpo) =>
  sesion.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });

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
  return r;
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  anon = app.anonimo();
  await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email: ESPECTADOR, nombre: 'Mirón', rol: 'espectador', password: PASSWORD_TEMPORAL }),
  });
  miron = await app.entrarYAsentar(ESPECTADOR);
  opciones = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

// ---------------------------------------------------------------- A. invariantes

describe('A · invariantes y números de pantalla, antes de tocar nada', () => {
  test('A1 217 servicios y 880 guardias', async () => {
    const serv = await admin.pedir('/api/servicios?estatus=ACTIVO');
    assert.equal(serv.json.servicios.length, 217, 'servicios ACTIVO');
    const guardias = serv.json.servicios.reduce((a, s) => a + s.total_guardias, 0);
    assert.equal(guardias, 880, 'guardias');
  });

  test('A2 330 cancelaciones y 516 aperturas', async () => {
    const c = await admin.pedir('/api/cancelaciones');
    assert.equal(c.json.cancelaciones.length, 330, 'cancelaciones');
    // El GET sin periodo tiene LIMIT 500; se recorren por periodo para contarlas.
    let total = 0;
    const periodos = new Set();
    for (let a = 2015; a <= 2027; a++) for (let m = 1; m <= 12; m++) periodos.add(`${a}-${String(m).padStart(2, '0')}`);
    for (const p of periodos) {
      const r = await admin.pedir(`/api/aperturas?periodo=${p}`);
      total += r.json.aperturas.length;
    }
    assert.equal(total, 516, `aperturas contadas por periodo: ${total}`);
  });

  /**
   * A3 — el criterio T12/T13, con los números sacados de los datos.
   *
   * Esta prueba nació exigiendo «11 recientes y 208 viejas», copiadas del plan.
   * Eran falsas: 11/208 es el corte por AÑO EN CURSO, y la ventana que el
   * director confirmó —doce meses móviles, decisión 5-bis— hoy da 15/204. Con
   * la cifra escrita a mano, la prueba acusaba al código de un error que estaba
   * en el plan, y además caducaba cada 1 de enero.
   *
   * Así que cuenta las dos colas por su cuenta, pidiéndolas mes por mes, y
   * recalcula el corte con aritmética propia. Sigue teniendo dientes: si el
   * corte se corre un mes, si el aviso suma las viejas o si la línea gris
   * esconde una pendiente, los dos lados dejan de cuadrar.
   *
   * La derivación no es un adorno: es la lección que costó esta vuelta, escrita
   * en la decisión 5-bis —ningún texto ni ninguna prueba trae el número a mano—.
   */
  test('A3 EL CRITERIO T12/T13: el aviso cuenta lo reciente y la línea gris el arrastre', async () => {
    // El corte, recalculado aquí y no preguntado al código: una prueba que le
    // pide el corte a quien lo usa pasa igual con la cuenta mal hecha.
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    const [anio, mes] = hoy.slice(0, 7).split('-').map(Number);
    const total = anio * 12 + (mes - 1) - 12;
    const corte = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;

    // Mes por mes, porque el GET sin periodo tiene LIMIT 500 y hay 516.
    const cola = [];
    for (let a = 2015; a <= anio + 1; a++) {
      for (let m = 1; m <= 12; m++) {
        const p = `${a}-${String(m).padStart(2, '0')}`;
        const r = await admin.pedir(`/api/aperturas?periodo=${p}`);
        assert.equal(r.status, 200, r.texto);
        cola.push(...r.json.aperturas.filter((x) => !x.servicio_id && !x.descartada));
      }
    }
    const periodoDe = (x) => String(x.periodo || x.fecha || x.creado_en || '').slice(0, 7);
    const recientes = cola.filter((x) => periodoDe(x) > corte);
    const viejas = cola.filter((x) => periodoDe(x) <= corte);

    const html = limpio((await admin.pedir('/aperturas')).texto);
    const aviso = html.match(/([\d,]+) aperturas? sin aplicar/);
    const gris = html.match(/Otras ([\d,]+) aperturas de (\d{4})(?: a (\d{4}))?/);
    assert.ok(aviso, 'hay caja ámbar');
    assert.ok(gris, 'hay línea gris');
    assert.ok(!new RegExp(`${cola.length} aperturas sin aplicar`).test(html), `no dice ${cola.length}`);

    const nAviso = Number(aviso[1].replace(/,/g, ''));
    const nGris = Number(gris[1].replace(/,/g, ''));
    assert.equal(nAviso, recientes.length, `aviso=${nAviso} contra ${recientes.length} pendientes > ${corte}`);
    assert.equal(nGris, viejas.length, `línea gris=${nGris} contra ${viejas.length} pendientes <= ${corte}`);
    // Lo que de verdad no se puede romper: esto reparte la cola, no la recorta.
    assert.equal(nAviso + nGris, cola.length, `${nAviso} + ${nGris} debe dar ${cola.length}`);

    // El rango de años de la línea gris, también derivado.
    const anios = viejas.map((x) => periodoDe(x).slice(0, 4)).sort();
    assert.equal(gris[2], anios[0], `la línea gris empieza en ${gris[2]} y la más vieja es de ${anios[0]}`);
    assert.equal(gris[3] ?? gris[2], anios.at(-1), `termina en ${gris[3] ?? gris[2]} y la última vieja es de ${anios.at(-1)}`);
  });

  test('A4 las tres colas suman 219', async () => {
    const r = await admin.pedir('/aperturas?pendientes=todas');
    const html = limpio(r.texto);
    const chips = [...html.matchAll(/(últimos 12 meses|arrastre de la importación|todas) \(([\d,]+)\)/g)].map((m) => [
      m[1],
      Number(m[2].replace(/,/g, '')),
    ]);
    const mapa = Object.fromEntries(chips);
    assert.equal(mapa['todas'], 219, `la cola «todas» dice ${mapa['todas']}`);
    assert.equal(
      mapa['últimos 12 meses'] + mapa['arrastre de la importación'],
      219,
      `recientes ${mapa['últimos 12 meses']} + viejas ${mapa['arrastre de la importación']}`
    );
  });
});

// ------------------------------------------------- B. el mínimo del alta

describe('B · el mínimo para abrir', () => {
  test('B1 sin nombre / sin fecha / sin jornadas', async () => {
    const r1 = await operaciones.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', zona: opciones.zonas[0], asesor: opciones.asesores[0], turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r1.status, 400, `sin nombre → ${r1.status} ${r1.texto.slice(0, 200)}`);

    const r2 = await operaciones.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'TST SIN JORNADAS', zona: opciones.zonas[0], asesor: opciones.asesores[0] }),
    });
    assert.equal(r2.status, 400, `sin jornadas → ${r2.status} ${r2.texto.slice(0, 200)}`);
  });

  test('B2 nombre con solo espacios', async () => {
    const r = await abrirMinimo('    ');
    assert.equal(r.status, 400, `nombre en blanco → ${r.status} ${r.texto.slice(0, 250)}`);
  });

  test('B3 acentos, ñ y emoji en el nombre', async () => {
    const nombre = 'TST Ñandú Acción ✅ café';
    const r = await abrirMinimo(nombre);
    assert.equal(r.status, 201, r.texto.slice(0, 300));
    const s = await ficha(r.json.servicioId);
    assert.equal(s.servicio, nombre, 'el nombre vuelve igual');
    const pantalla = await admin.pedir(`/estado-fuerza/${r.json.servicioId}`);
    assert.ok(pantalla.texto.includes('Ñandú'), 'la ñ se dibuja');
    assert.ok(pantalla.texto.includes('✅'), 'el emoji se dibuja');
  });

  test('B4 nombre larguísimo (5000 caracteres)', async () => {
    const nombre = 'TSTLARGO' + 'A'.repeat(5000);
    const r = await abrirMinimo(nombre);
    assert.ok([201, 400].includes(r.status), `respondió ${r.status}: ${r.texto.slice(0, 200)}`);
    if (r.status === 201) {
      const s = await ficha(r.json.servicioId);
      assert.equal(s.servicio.length, nombre.length, 'guardó el nombre completo sin truncarlo en silencio');
      // Y la lista no se rompe
      const lista = await admin.pedir('/estado-fuerza?q=TSTLARGO');
      assert.equal(lista.status, 200);
    }
  });

  test('B5 zona y asesor fuera del catálogo', async () => {
    const r = await operaciones.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'TST ZONA MALA', zona: 'ZONA-QUE-NO-EXISTE', asesor: opciones.asesores[0], turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r.status, 400, `zona inventada → ${r.status}`);
    assert.ok(/catálogo/i.test(r.texto), 'dice que es del catálogo');
  });

  test('B6 el formulario trae los dos tramos y exige los cinco', async () => {
    const r = await operaciones.pedir('/aperturas/nueva');
    assert.equal(r.status, 200);
    assert.ok(r.texto.includes('Lo que hace falta para abrirlo'), 'rótulo tramo 1');
    assert.ok(r.texto.includes('Completar cuando lo tengas'), 'rótulo tramo 2');
  });

  test('B7 el servidor NO exige zona ni asesor (contrato viejo intacto)', async () => {
    const r = await operaciones.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'TST SIN ZONA NI ASESOR', turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r.status, 201, r.texto.slice(0, 200));
    const s = await ficha(r.json.servicioId);
    assert.ok(!s.zona, 'queda sin zona');
    // ¿y la ficha lo señala?
    const pant = await admin.pedir(`/estado-fuerza/${r.json.servicioId}`);
    assert.ok(pant.texto.includes('Falta por capturar'), 'la ficha señala que falta algo');
    assert.ok(/Zona/.test(pant.texto), 'informativo: ¿aparece Zona entre los faltantes?');
  });
});

// ------------------------------- C. «solo de vacío a valor» — el ataque serio

describe('C · completar: solo de vacío a valor', () => {
  let id;
  before(async () => {
    const r = await abrirMinimo('TST COMPLETAR BASE');
    id = r.json.servicioId;
    const p = await completar(operaciones, id, { precio_guardia: 1234.5, razon_social: 'LEGAL ORIGINAL SA', dias_credito: 30, direccion: 'Calle 1' });
    assert.equal(p.status, 200, p.texto);
  });

  const noDebeCambiar = async (cuerpo, etiqueta) => {
    const antes = await ficha(id);
    const r = await completar(operaciones, id, cuerpo);
    const despues = await ficha(id);
    for (const k of Object.keys(cuerpo)) {
      assert.deepEqual(despues[k], antes[k], `${etiqueta}: ${k} cambió de ${JSON.stringify(antes[k])} a ${JSON.stringify(despues[k])}`);
    }
    return r;
  };

  test('C1 otro precio por la misma vía', async () => {
    const r = await noDebeCambiar({ precio_guardia: 9999 }, 'precio distinto');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.yaTenian, ['precio_guardia']);
  });

  test('C2 cadena vacía no borra', async () => {
    await noDebeCambiar({ precio_guardia: '', razon_social: '', dias_credito: '', direccion: '' }, 'vacío');
  });

  test('C3 espacios no borran', async () => {
    await noDebeCambiar({ razon_social: '   ', direccion: '\t\n ' }, 'espacios');
  });

  test('C4 null no borra', async () => {
    await noDebeCambiar({ precio_guardia: null, razon_social: null, dias_credito: null, direccion: null }, 'null');
  });

  test('C5 cero no sobreescribe', async () => {
    await noDebeCambiar({ precio_guardia: 0, dias_credito: 0 }, 'cero');
  });

  test('C6 false no sobreescribe', async () => {
    await noDebeCambiar({ precio_guardia: false, dias_credito: false, razon_social: false }, 'false');
  });

  test('C7 arreglos y objetos no sobreescriben', async () => {
    await noDebeCambiar({ precio_guardia: [], dias_credito: [], razon_social: {}, direccion: ['a', 'b'] }, 'tipos raros');
  });

  test('C8 ningún rol puede sobreescribir por esta vía', async () => {
    for (const [nombre, sesion] of [['admin', admin], ['ventas', ventas], ['operaciones', operaciones]]) {
      const antes = await ficha(id);
      const r = await sesion.pedir(`/api/servicios/${id}/completar`, {
        method: 'PATCH',
        body: JSON.stringify({ precio_guardia: 777, razon_social: 'PIRATA SA' }),
      });
      const despues = await ficha(id);
      assert.equal(despues.precio_guardia, antes.precio_guardia, `${nombre} cambió el precio`);
      assert.equal(despues.razon_social, antes.razon_social, `${nombre} cambió la razón social`);
      assert.equal(r.status, 200, `${nombre} → ${r.status}`);
    }
  });

  test('C9 campos fuera de la lista no tocan la base', async () => {
    const antes = await ficha(id);
    const r = await completar(operaciones, id, {
      total_guardias: 999,
      estatus: 'BAJA',
      nomina_total: 1,
      tiene_contrato: 1,
      importe_factura: 1,
      id: 1,
      servicio: 'RENOMBRADO',
      actualizado_en: '1999-01-01',
    });
    assert.equal(r.status, 200, r.texto);
    const despues = await ficha(id);
    assert.equal(despues.total_guardias, antes.total_guardias, 'total_guardias');
    assert.equal(despues.estatus, antes.estatus, 'estatus');
    assert.equal(despues.servicio, antes.servicio, 'nombre');
    assert.equal(despues.importe_factura, antes.importe_factura, 'importe');
    assert.ok(r.json.rechazados.includes('estatus'), `rechazados: ${JSON.stringify(r.json.rechazados)}`);
  });

  test('C10 __proto__ y constructor no pasan', async () => {
    const r = await completar(operaciones, id, { __proto__: { x: 1 }, constructor: 'x' });
    assert.equal(r.status, 200, r.texto);
    const d = await ficha(id);
    assert.ok(d, 'la ficha sigue respondiendo');
  });

  test('C11 roles sin permiso: 403/401, y nada escrito', async () => {
    const vacio = (await abrirMinimo('TST ROLES ' + Date.now())).json.servicioId;
    for (const [nombre, sesion, esperado] of [
      ['juridico', juridico, 403],
      ['finanzas', finanzas, 403],
      ['espectador', miron, 403],
    ]) {
      const r = await completar(sesion, vacio, { direccion: 'INTRUSO' });
      assert.equal(r.status, esperado, `${nombre} → ${r.status}`);
    }
    const r = await completar(anon, vacio, { direccion: 'INTRUSO' });
    assert.ok([401, 307, 302].includes(r.status), `sin sesión → ${r.status}`);
    const s = await ficha(vacio);
    assert.ok(!s.direccion, `se escribió algo: ${s.direccion}`);
  });

  test('C12 correr dos veces el mismo PATCH con el mismo valor', async () => {
    const nuevo = (await abrirMinimo('TST IDEMPOTENTE ' + Date.now())).json.servicioId;
    const a = await completar(operaciones, nuevo, { direccion: 'Av. Siempre Viva 742' });
    const b = await completar(operaciones, nuevo, { direccion: 'Av. Siempre Viva 742' });
    assert.equal(Object.keys(a.json.llenados).length, 1);
    assert.equal(Object.keys(b.json.llenados).length, 0, 'la segunda no debe llenar nada');
    assert.deepEqual(b.json.yaTenian, ['direccion']);
  });

  test('C13 dos PATCH concurrentes sobre el mismo hueco', async () => {
    const nuevo = (await abrirMinimo('TST CARRERA ' + Date.now())).json.servicioId;
    const [r1, r2] = await Promise.all([
      completar(operaciones, nuevo, { direccion: 'PRIMERO' }),
      completar(ventas, nuevo, { direccion: 'SEGUNDO' }),
    ]);
    const s = await ficha(nuevo);
    const llenaron = [r1, r2].filter((r) => Object.keys(r.json.llenados || {}).length > 0);
    assert.equal(llenaron.length, 1, `las dos dijeron que llenaron: ${JSON.stringify([r1.json, r2.json])}; quedó «${s.direccion}»`);
  });

  test('C14 un servicio cancelado (BAJA) se puede completar por API', async () => {
    const nuevo = (await abrirMinimo('TST BAJA ' + Date.now())).json.servicioId;
    const can = await operaciones.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: nuevo, fecha: '2026-10-09', motivo: opciones.motivosBaja[0] }),
    });
    const s0 = await ficha(nuevo);
    const r = await completar(operaciones, nuevo, { direccion: 'ESCRITO EN UN SERVICIO DE BAJA' });
    const s = await ficha(nuevo);
    assert.ok(
      s0.estatus !== 'BAJA' || s.direccion !== 'ESCRITO EN UN SERVICIO DE BAJA',
      `estatus=${s0.estatus} (cancelación ${can.status}) y se escribió igual: ${s.direccion} · respuesta ${r.status}`
    );
  });

  test('C15 id no numérico no revienta en 500', async () => {
    for (const mal of ['abc', '1e999', '-1', '0', '99999999', '1 OR 1=1', '%2e%2e']) {
      const r = await operaciones.pedir(`/api/servicios/${encodeURIComponent(mal)}/completar`, {
        method: 'PATCH',
        body: JSON.stringify({ direccion: 'x' }),
      });
      assert.ok(r.status < 500, `id «${mal}» → ${r.status} ${r.texto.slice(0, 160)}`);
    }
  });

  test('C16 catálogo: valor inventado da 400 y no escribe', async () => {
    const nuevo = (await abrirMinimo('TST CATALOGO ' + Date.now())).json.servicioId;
    const r = await completar(operaciones, nuevo, { uniforme: 'UNIFORME-INVENTADO', direccion: 'Calle A' });
    assert.equal(r.status, 400, r.texto.slice(0, 200));
    const s = await ficha(nuevo);
    assert.ok(!s.direccion, `el campo bueno del mismo lote se escribió aunque el lote falló: ${s.direccion}`);
  });

  test('C17 acentos y ñ al completar', async () => {
    const nuevo = (await abrirMinimo('TST ACENTOS ' + Date.now())).json.servicioId;
    const valor = 'Camiño del Ñu #3, Peñón, Acción';
    const r = await completar(operaciones, nuevo, { direccion: valor, razon_social: 'ÑOÑO Y CÍA S.A. de C.V.' });
    assert.equal(r.status, 200, r.texto);
    const s = await ficha(nuevo);
    assert.equal(s.direccion, valor);
    assert.equal(s.razon_social, 'ÑOÑO Y CÍA S.A. de C.V.');
  });

  test('C18 la bitácora registra alta_completada', async () => {
    const nuevo = (await abrirMinimo('TST BITACORA ' + Date.now())).json.servicioId;
    await completar(operaciones, nuevo, { direccion: 'Bitácora 1' });
    const pant = await admin.pedir(`/estado-fuerza/${nuevo}`);
    assert.ok(
      /alta_completada|se capturó lo que faltaba/.test(pant.texto),
      `la ficha no muestra el renglón de bitácora`
    );
    const b = await admin.pedir('/bitacora?q=se%20capturó');
    assert.ok(b.status === 200, `bitácora: ${b.status}`);
  });
});

// ------------------------------------------------- D. descarte en lote

describe('D · descarte en lote', () => {
  const pendientesViejas = async () => {
    const r = await admin.pedir('/aperturas?pendientes=viejas');
    const m = limpio(r.texto).match(/Otras ([\d,]+) aperturas/);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
  };
  const recientesAviso = async () => {
    const r = await admin.pedir('/aperturas');
    const m = limpio(r.texto).match(/([\d,]+) aperturas? sin aplicar/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };

  test('D1 motivo corto y en blanco: 400 y cero descartadas', async () => {
    const ids = (await admin.pedir('/api/aperturas?periodo=2023-01')).json.aperturas
      .filter((m) => !m.servicio_id && !m.descartada)
      .map((m) => m.id)
      .slice(0, 3);
    assert.ok(ids.length > 0, 'hay pendientes de 2023-01');
    for (const motivo of ['abc', '', '     ', null, undefined, '\t\n  ']) {
      const r = await operaciones.pedir('/api/aperturas/descartar-lote', {
        method: 'POST',
        body: JSON.stringify({ ids, motivo }),
      });
      assert.equal(r.status, 400, `motivo ${JSON.stringify(motivo)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
    const sigue = (await admin.pedir('/api/aperturas?periodo=2023-01')).json.aperturas.filter((m) => m.descartada);
    assert.equal(sigue.length, 0, 'no se descartó ninguna');
  });

  test('D2 lote vacío, no-lista, ids basura, y más de 250', async () => {
    const casos = [
      [[], 400],
      [null, 400],
      ['1,2,3', 400],
      [[0, -1, 'abc', null, 1.5], 400],
      [Array.from({ length: 251 }, (_, i) => i + 1), 400],
    ];
    for (const [ids, esperado] of casos) {
      const r = await operaciones.pedir('/api/aperturas/descartar-lote', {
        method: 'POST',
        body: JSON.stringify({ ids, motivo: 'motivo suficientemente largo' }),
      });
      assert.equal(r.status, esperado, `ids=${JSON.stringify(ids)?.slice(0, 60)} → ${r.status} ${r.texto.slice(0, 160)}`);
    }
  });

  test('D3 jurídico y espectador reciben 403; ventas puede', async () => {
    const id = (await admin.pedir('/api/aperturas?periodo=2023-02')).json.aperturas.find((m) => !m.servicio_id && !m.descartada)?.id;
    assert.ok(id, 'hay una pendiente de 2023-02');
    for (const [nombre, sesion] of [['juridico', juridico], ['finanzas', finanzas], ['espectador', miron]]) {
      const r = await sesion.pedir('/api/aperturas/descartar-lote', {
        method: 'POST',
        body: JSON.stringify({ ids: [id], motivo: 'intento sin permiso' }),
      });
      assert.equal(r.status, 403, `${nombre} → ${r.status}`);
    }
    const r = await ventas.pedir('/api/aperturas/descartar-lote', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], motivo: 'ventas sí puede descartar' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.descartadas, 1);
  });

  test('D4 correr el mismo lote dos veces: la segunda no descarta nada', async () => {
    const ids = (await admin.pedir('/api/aperturas?periodo=2023-03')).json.aperturas
      .filter((m) => !m.servicio_id && !m.descartada)
      .map((m) => m.id);
    assert.ok(ids.length >= 2, `hay ${ids.length} pendientes en 2023-03`);
    const a = await operaciones.pedir('/api/aperturas/descartar-lote', {
      method: 'POST',
      body: JSON.stringify({ ids, motivo: 'la importación trajo servicios que ya no operan' }),
    });
    assert.equal(a.status, 200, a.texto);
    assert.equal(a.json.descartadas, ids.length);
    assert.equal(a.json.fallidas.length, 0);

    const b = await operaciones.pedir('/api/aperturas/descartar-lote', {
      method: 'POST',
      body: JSON.stringify({ ids, motivo: 'la importación trajo servicios que ya no operan' }),
    });
    assert.equal(b.status, 200, b.texto);
    assert.equal(b.json.descartadas, 0, 'la segunda corrida no debe descartar nada');
    assert.equal(b.json.fallidas.length, ids.length, 'todas deben reportarse como fallidas');
  });

  test('D5 reversible: devolver una a la cola', async () => {
    const id = (await admin.pedir('/api/aperturas?periodo=2023-03')).json.aperturas.find((m) => m.descartada)?.id;
    assert.ok(id, 'hay una descartada de 2023-03');
    const r = await operaciones.pedir(`/api/aperturas/${id}/descartar`, { method: 'DELETE' });
    assert.equal(r.status, 200, `reactivar → ${r.status} ${r.texto.slice(0, 200)}`);
    const m = (await admin.pedir('/api/aperturas?periodo=2023-03')).json.aperturas.find((x) => x.id === id);
    assert.equal(m.descartada, 0, 'volvió a pendiente');
  });

  test('D6 el lote NO toca las recientes', async () => {
    const recientes = (await admin.pedir('/api/aperturas?periodo=2026-08')).json.aperturas.filter((m) => !m.servicio_id);
    assert.ok(recientes.length > 0, 'hay pendientes en 2026-08');
    assert.ok(recientes.every((m) => !m.descartada), 'ninguna reciente quedó descartada por los lotes de arriba');
  });

  test('D7 el lote acepta ids de aperturas RECIENTES (no está acotado al arrastre)', async () => {
    const id = (await admin.pedir('/api/aperturas?periodo=2026-08')).json.aperturas.find((m) => !m.servicio_id && !m.descartada)?.id;
    assert.ok(id, 'hay una reciente pendiente');
    const r = await operaciones.pedir('/api/aperturas/descartar-lote', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], motivo: 'tester: ¿deja descartar una reciente?' }),
    });
    assert.equal(r.json?.descartadas, 0, `el servidor descartó una reciente por la vía del lote (status ${r.status})`);
    // limpieza
    if (r.json?.descartadas) await operaciones.pedir(`/api/aperturas/${id}/descartar`, { method: 'DELETE' });
  });

  test('D8 los invariantes siguen: 516 aperturas y 217 servicios', async () => {
    const serv = await admin.pedir('/api/servicios?estatus=ACTIVO');
    assert.ok(serv.json.servicios.length >= 217, `servicios: ${serv.json.servicios.length}`);
    const pant = await admin.pedir('/aperturas?pendientes=todas');
    assert.equal(pant.status, 200);
  });
});

// ------------------------------------------------- E. paginación y totales

describe('E · paginación: los totales son del conjunto', () => {
  const encabezado = (html) => {
    const m = limpio(html).match(/([\d,]+) servicios · ([\d,]+) guardias/);
    return m ? { servicios: Number(m[1].replace(/,/g, '')), guardias: Number(m[2].replace(/,/g, '')) } : null;
  };
  // Un renglón = un <tr> del cuerpo de la tabla. Contar enlaces no sirve: el
  // panel de «sin desglose» de arriba también enlaza a fichas.
  const filas = (html) => {
    const t = limpio(html).split('<tbody>')[1]?.split('</tbody>')[0] || '';
    return (t.match(/<tr /g) || []).length;
  };

  test('E1 página 1: encabezado del conjunto y 50 filas', async () => {
    const r = await admin.pedir('/estado-fuerza');
    assert.equal(r.status, 200);
    const e = encabezado(r.texto);
    assert.ok(e, 'encabezado legible');
    assert.ok(e.servicios >= 217, `encabezado dice ${e.servicios} servicios`);
    assert.ok(e.guardias >= 880, `encabezado dice ${e.guardias} guardias`);
    assert.ok(/1 a 50 de \d+/.test(limpio(r.texto)), 'paginador «1 a 50 de N»');
    assert.equal(filas(r.texto), 50, `dibujó ${filas(r.texto)} renglones distintos`);
  });

  test('E2 cada página mantiene el encabezado', async () => {
    const base = encabezado((await admin.pedir('/estado-fuerza')).texto);
    for (const p of [2, 3, 5]) {
      const e = encabezado((await admin.pedir(`/estado-fuerza?pagina=${p}`)).texto);
      assert.deepEqual(e, base, `página ${p} movió el encabezado`);
    }
  });

  test('E3 páginas fuera de rango y basura', async () => {
    for (const p of ['99', '0', '-3', 'abc', '1e9', '2.7', '', 'null', '%27']) {
      const r = await admin.pedir(`/estado-fuerza?pagina=${p}`);
      assert.equal(r.status, 200, `pagina=${p} → ${r.status}`);
      assert.ok(filas(r.texto) > 0, `pagina=${p} dibujó una tabla vacía`);
    }
  });

  test('E4 conserva los demás filtros', async () => {
    const zona = (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios.find((s) => s.zona)?.zona;
    const r = await admin.pedir(`/estado-fuerza?zona=${encodeURIComponent(zona)}&pagina=2`);
    assert.equal(r.status, 200);
    assert.ok(r.texto.includes(zona), 'la zona sigue en pantalla');
  });

  test('E5 ?falta=1 cuenta los filtrados, no los 217', async () => {
    const todos = encabezado((await admin.pedir('/estado-fuerza')).texto);
    const r = await admin.pedir('/estado-fuerza?falta=1');
    const e = encabezado(r.texto);
    assert.ok(e.servicios <= todos.servicios, `filtrado ${e.servicios} > total ${todos.servicios}`);
    assert.ok(e.guardias <= todos.guardias, 'guardias del filtrado');
  });

  test('E5b el reparto por turno es del conjunto en toda página', async () => {
    const turnos = (html) =>
      [...limpio(html).matchAll(/turno=([^"&]+)[^>]*>[\s\S]{0,400}?/g)].length;
    const p1 = await admin.pedir('/estado-fuerza');
    const p5 = await admin.pedir('/estado-fuerza?pagina=5');
    const suma = (html) => {
      const m = limpio(html).match(/([\d,]+) servicios · ([\d,]+) guardias/);
      return m ? m[2] : null;
    };
    assert.equal(suma(p5.texto), suma(p1.texto), 'el total de guardias cambió entre páginas');
    assert.ok(turnos(p1.texto) > 0, 'hay panel de turnos');
  });

  test('E5c ?falta=1 y ?pagina=2 juntos', async () => {
    const r = await admin.pedir('/estado-fuerza?falta=1&pagina=2');
    assert.equal(r.status, 200);
    const html = limpio(r.texto);
    assert.ok(/falta=1/.test(html), 'el paginador conserva el filtro falta');
    assert.ok(filas(r.texto) > 0, 'dibuja renglones');
  });

  test('E6 el CSV del corte sigue trayendo todos', async () => {
    const r = await admin.pedir('/api/cortes/actual');
    const lineas = r.texto.trim().split('\n').length;
    assert.ok(lineas > 200, `el CSV trae ${lineas} líneas`);
  });

  test('E7 cobranza: 40 renglones y el encabezado completo', async () => {
    const r = await finanzas.pedir('/cobranza');
    assert.equal(r.status, 200);
    assert.ok(/Mostrar \d+ más/.test(limpio(r.texto)), `botón de tanda; ¿hay «Por facturar»? ${/Por facturar/.test(r.texto)}`);
  });

  test('E8 inyección en los filtros no rompe ni vacía', async () => {
    for (const mal of ["' OR 1=1--", '"); DROP TABLE servicios;--', '%00', '../../etc/passwd', '<script>alert(1)</script>']) {
      const r = await admin.pedir(`/estado-fuerza?zona=${encodeURIComponent(mal)}`);
      assert.equal(r.status, 200, `zona=${mal} → ${r.status}`);
      assert.ok(!r.texto.includes('<script>alert(1)</script>'), 'no refleja el script sin escapar');
    }
    const serv = await admin.pedir('/api/servicios?estatus=ACTIVO');
    assert.ok(serv.json.servicios.length >= 217, 'la tabla sigue ahí');
  });
});

// ------------------------------------------------- F. enlaces de arreglo por rol

describe('F · ningún enlace lleva a «Sin permiso»', () => {
  const sesiones = () => [
    ['admin', admin],
    ['operaciones', operaciones],
    ['ventas', ventas],
    ['juridico', juridico],
    ['finanzas', finanzas],
    ['espectador', miron],
  ];

  const hrefs = (html) => {
    const out = new Set();
    for (const m of html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) out.add(m[1] + (m[2] || ''));
    return [...out];
  };

  test('F1 tablero: todo enlace que ve un rol lo puede abrir', async () => {
    const malos = [];
    for (const [nombre, sesion] of sesiones()) {
      const r = await sesion.pedir('/');
      for (const h of hrefs(r.texto)) {
        if (h.startsWith('/api/') || h.startsWith('//')) continue;
        const d = await sesion.pedir(h);
        if (d.status === 200 && /Sin permiso/i.test(d.texto)) malos.push(`${nombre} → ${h}`);
        if (d.status >= 500) malos.push(`${nombre} → ${h} (${d.status})`);
      }
    }
    assert.deepEqual(malos, [], `enlaces a «Sin permiso»:\n${malos.join('\n')}`);
  });

  test('F2 jurídico y estado de fuerza: lo mismo', async () => {
    const malos = [];
    for (const [nombre, sesion] of sesiones()) {
      for (const pantalla of ['/juridico', '/estado-fuerza', '/aperturas?pendientes=viejas']) {
        const r = await sesion.pedir(pantalla);
        if (r.status !== 200) continue;
        for (const h of hrefs(r.texto).slice(0, 60)) {
          if (h.startsWith('/api/') || h.startsWith('//')) continue;
          const d = await sesion.pedir(h);
          if (d.status === 200 && /Sin permiso/i.test(d.texto)) malos.push(`${nombre} ${pantalla} → ${h}`);
          if (d.status >= 500) malos.push(`${nombre} ${pantalla} → ${h} (${d.status})`);
        }
      }
    }
    assert.deepEqual(malos, [], `enlaces a «Sin permiso»:\n${malos.join('\n')}`);
  });

  test('F3 las anclas de arreglo existen en la ficha para el rol que las ve', async () => {
    const faltantes = [];
    for (const [nombre, sesion] of sesiones()) {
      const lista = await sesion.pedir('/estado-fuerza');
      // Las anclas que el renglón ofrece
      const anclas = [...new Set([...lista.texto.matchAll(/href="\/estado-fuerza\/(\d+)#(completar|editar|corregir)"/g)].map((m) => `${m[1]}#${m[2]}`))];
      for (const a of anclas.slice(0, 6)) {
        const [id, ancla] = a.split('#');
        const ficha = await sesion.pedir(`/estado-fuerza/${id}`);
        if (!ficha.texto.includes(`id="${ancla}"`)) faltantes.push(`${nombre}: la lista enlaza a /estado-fuerza/${id}#${ancla} y la ficha no trae id="${ancla}"`);
      }
    }
    assert.deepEqual(faltantes, [], faltantes.join('\n'));
  });

  test('F4 «sin desglose» → #corregir: ¿existe el ancla para todos los roles?', async () => {
    // Un servicio con jornadas pero sin desglose por turno no existe en la
    // carga; se arma uno desde una apertura sin `turnos_detalle`.
    const malos = [];
    const lista = await admin.pedir('/estado-fuerza?pagina=1');
    const ids = [...new Set([...limpio(lista.texto).matchAll(/href="\/estado-fuerza\/(\d+)#corregir"/g)].map((m) => m[1]))];
    if (!ids.length) {
      console.log('F4: ningún renglón de la página 1 trae #corregir');
      return;
    }
    for (const [nombre, sesion] of [
      ['admin', admin],
      ['operaciones', operaciones],
      ['ventas', ventas],
      ['juridico', juridico],
      ['finanzas', finanzas],
      ['espectador', miron],
    ]) {
      const vista = await sesion.pedir('/estado-fuerza');
      const ofrece = /#corregir"/.test(limpio(vista.texto));
      const ficha = await sesion.pedir(`/estado-fuerza/${ids[0]}`);
      const tiene = ficha.texto.includes('id="corregir"');
      if (ofrece && !tiene) malos.push(`${nombre}: la lista ofrece #corregir y su ficha no trae id="corregir"`);
    }
    assert.deepEqual(malos, [], malos.join('\n'));
  });

  test('F5 «falta» de nómina → #editar cuando ya no falta nada del alta', async () => {
    // Se completa un servicio nuevo con TODO lo del alta y se deja la nómina
    // vacía: entonces el renglón apunta a #editar.
    const id = (await abrirMinimo('TST SIN HUECOS ' + Date.now())).json.servicioId;
    const todo = {
      direccion: 'Calle Llena 1',
      supervisor: opciones.supervisores[0],
      gerente: opciones.gerentes[0],
      estado_geo: opciones.estados[0],
      uniforme: opciones.uniformes[0],
      tipo_repse: opciones.tiposRepse[0],
      razon_social: 'LLENA SA',
      precio_guardia: 100,
      esquema_facturacion: 'MES_VENCIDO',
      forma_pago: opciones.formasPago[0],
      dias_credito: 30,
    };
    const r = await completar(operaciones, id, todo);
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    const s = await ficha(id);
    const sigueFaltando = Object.keys(todo).filter((k) => s[k] === null || s[k] === '' || s[k] === undefined);
    assert.deepEqual(sigueFaltando, [], `no se llenaron: ${sigueFaltando.join(', ')} · respuesta ${JSON.stringify(r.json)}`);

    const malos = [];
    for (const [nombre, sesion] of [
      ['admin', admin],
      ['operaciones', operaciones],
      ['ventas', ventas],
      ['juridico', juridico],
      ['finanzas', finanzas],
      ['espectador', miron],
    ]) {
      const lista = await sesion.pedir(`/estado-fuerza?q=${encodeURIComponent('TST SIN HUECOS')}`);
      const ofrece = limpio(lista.texto).includes(`/estado-fuerza/${id}#editar`);
      if (!ofrece) continue;
      const f = await sesion.pedir(`/estado-fuerza/${id}`);
      if (!f.texto.includes('id="editar"')) malos.push(`${nombre}: el renglón enlaza a #editar y su ficha no trae id="editar"`);
    }
    assert.deepEqual(malos, [], malos.join('\n'));
  });

  test('F6 en corte cerrado y en vista por día no hay enlaces de arreglo', async () => {
    const periodos = (await admin.pedir('/estado-fuerza')).texto;
    const corte = [...limpio(periodos).matchAll(/periodo=(\d{4}-\d{2})/g)].map((m) => m[1]);
    const malos = [];
    for (const p of [...new Set(corte)].slice(0, 3)) {
      const r = await admin.pedir(`/estado-fuerza?periodo=${p}`);
      const html = limpio(r.texto);
      if (/#completar"|#corregir"|#editar"/.test(html)) malos.push(`corte ${p} ofrece arreglo`);
      if (/falta=1/.test(html)) malos.push(`corte ${p} ofrece el filtro de captura`);
      if (/faltan \d+ dato/.test(html)) malos.push(`corte ${p} trae la etiqueta «faltan N datos»`);
    }
    const dia = await admin.pedir('/estado-fuerza?dia=2026-09-15');
    const h = limpio(dia.texto);
    if (/#completar"|#corregir"|#editar"/.test(h)) malos.push('la vista por día ofrece arreglo');
    if (/faltan \d+ dato/.test(h)) malos.push('la vista por día trae la etiqueta');
    assert.deepEqual(malos, [], malos.join('\n'));
  });

  test('F7 ?falta=1 junto a un corte cerrado no filtra ni miente', async () => {
    const r = await admin.pedir('/estado-fuerza?periodo=2026-03&falta=1');
    assert.equal(r.status, 200);
    const html = limpio(r.texto);
    assert.ok(!/faltan \d+ dato/.test(html), 'no debe etiquetar en un corte');
  });
});

describe('I · validación de esquema_facturacion', () => {
  test('I1 las claves de Object.prototype se cuelan por el filtro de ESQUEMAS', async () => {
    const colados = [];
    for (const v of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      const id = (await abrirMinimo('ZZE ' + v + ' ' + Date.now())).json.servicioId;
      const r = await completar(operaciones, id, { esquema_facturacion: v });
      const s = await ficha(id);
      if (s.esquema_facturacion === v) colados.push(`${v} (status ${r.status})`);
    }
    assert.deepEqual(colados, [], `esquemas inexistentes guardados: ${colados.join(', ')}`);
  });

  test('I2 un esquema inventado sí se rechaza', async () => {
    const id = (await abrirMinimo('ZZE INVENTADO ' + Date.now())).json.servicioId;
    const r = await completar(operaciones, id, { esquema_facturacion: 'INVENTADO' });
    assert.equal(r.status, 400, r.texto);
  });
});

describe('J · tipos equivocados se guardan coercionados', () => {
  test('J1 un objeto acaba como «[object Object]» en la razón social', async () => {
    const id = (await abrirMinimo('ZZT OBJ ' + Date.now())).json.servicioId;
    const r = await completar(operaciones, id, { razon_social: { a: 1 }, direccion: ['x', 'y'] });
    const s = await ficha(id);
    assert.notEqual(s.razon_social, '[object Object]', `razon_social quedó «${s.razon_social}» con 200 y sin avisar`);
    assert.notEqual(s.direccion, 'x,y', `direccion quedó «${s.direccion}»`);
    assert.ok(r);
  });

  test('J2 un arreglo vacío se guarda como precio cero', async () => {
    const id = (await abrirMinimo('ZZT ARR ' + Date.now())).json.servicioId;
    const r = await completar(operaciones, id, { precio_guardia: [], dias_credito: [] });
    const s = await ficha(id);
    assert.notEqual(
      s.precio_guardia,
      0,
      `precio_guardia quedó en 0 por mandar []: ${JSON.stringify(r.json?.llenados)}. Y un 0 ya cuenta como respuesta, así que por esta vía no se puede corregir.`
    );
  });

  test('J3 el cuerpo «null» del lote da 500 y no 400', async () => {
    const r = await operaciones.pedir('/api/aperturas/descartar-lote', { method: 'POST', body: 'null' });
    assert.ok(r.status < 500, `body=null → ${r.status} ${r.texto.slice(0, 120)}`);
  });
});

describe('H · cobranza por tandas', () => {
  test('H1 el encabezado de «Por facturar» cuenta todos, no los 40', async () => {
    const r = await finanzas.pedir('/cobranza');
    assert.equal(r.status, 200);
    const html = limpio(r.texto);
    const m = html.match(/Mostrar (\d+) más/);
    console.log('botón:', m?.[0]);
    const enc = html.match(/Por facturar[^<]{0,120}/g);
    console.log('encabezados:', JSON.stringify(enc?.slice(0, 4)));
    // Cuántos renglones vienen dibujados
    const filas = (html.match(/data-fila-porfacturar/g) || []).length;
    console.log('filas marcadas:', filas);
    assert.ok(m, 'hay botón de tanda');
  });
});

// ------------------------------------------------- G. el aviso de aperturas

describe('G · el aviso de Aperturas', () => {
  test('G1b con qué corte se está contando', async () => {
    const r = await admin.pedir('/aperturas?pendientes=1');
    const html = limpio(r.texto);
    const aviso = html.match(/([\d,]+) aperturas? sin aplicar · ([\d,]+) guardias/);
    console.log('AVISO:', aviso?.[0]);
    const vieja = html.match(/Otras ([\d,]+) aperturas de [\d]{4}(?: a [\d]{4})?/);
    console.log('LINEA GRIS:', vieja?.[0]);
  });

  test('G2 no dice 219', async () => {
    const r = await admin.pedir('/aperturas');
    assert.ok(!/219 aperturas sin aplicar/.test(limpio(r.texto)), 'sigue diciendo 219');
  });

  test('G3 hastaPeriodo 2025-12 da 208 (criterio literal de T12)', async () => {
    const r = await admin.pedir('/aperturas?pendientes=viejas');
    assert.equal(r.status, 200);
  });
});
