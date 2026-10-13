/**
 * Las dos clases de apertura pendiente, y por qué no se pueden contar juntas.
 *
 * El plan de este ciclo arrancaba de una afirmación falsa: que la plataforma no
 * puede generar una apertura pendiente nueva, y que por eso las 219 sin aplicar
 * son una cola finita del archivo de la importación que se cierra una vez y no
 * vuelve. `deshacerApertura()` hace exactamente eso —deja `servicio_id` en
 * nulo— y lo hace desde una ruta viva, la de «deshacer una apertura aplicada
 * por error»; `reactivarApertura()` saca una del cajón de las descartadas.
 *
 * Mientras las dos clases se contaran igual, una apertura deshecha hoy con
 * fecha vieja:
 *
 *   · caía en la línea gris que afirma «quedaron sin aplicar al importar el
 *     archivo: describen servicios que ya no operan» —falso para ella—,
 *   · se quedaba fuera del aviso ámbar, que es lo único que se mira,
 *   · y el cierre en lote se la podía llevar con las doscientas del arrastre.
 *
 * O sea: un error de dedo desaparecía sin que nadie lo viera, y sus guardias
 * dejaban de contarse y de cobrarse. Eso es lo que se prueba aquí, con una
 * apertura de 2023 aplicada y deshecha a propósito, que es el caso peor.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

/** Meses hacia atrás que cuentan como «reciente». SUPUESTO: doce. */
const MESES_RECIENTE = 12;

/**
 * El último mes que cuenta como arrastre, calculado aquí a mano y no pedido a la
 * función que lo usa: así se comprueba la regla que decidió el director y no que
 * el código sea consistente consigo mismo.
 */
function corte() {
  const [anio, mes] = HOY.slice(0, 7).split('-').map(Number);
  const total = anio * 12 + (mes - 1) - MESES_RECIENTE;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const periodoDe = (a) => String(a.periodo || a.fecha || a.creado_en || '').slice(0, 7);

/** Los meses que se recorren, generados con margen a los dos lados. */
const PERIODOS = (() => {
  const out = [];
  let [anio, mes] = [2015, 1];
  const [finA, finM] = HOY.slice(0, 7).split('-').map(Number);
  const fin = (finA + 1) * 12 + (finM - 1);
  while (anio * 12 + (mes - 1) <= fin) {
    out.push(`${anio}-${String(mes).padStart(2, '0')}`);
    if (++mes > 12) {
      mes = 1;
      anio += 1;
    }
  }
  return out;
})();

/** Los números que la pantalla de Aperturas enseña hoy. */
function loQueDicePantalla(html) {
  const limpio = comoSeLee(html);
  const aviso = limpio.match(/([\d,]+) apertura[s]? sin aplicar · ([\d,]+) guardias/);
  const gris = limpio.match(/Otras ([\d,]+) aperturas/);
  const n = (v) => (v ? Number(v.replace(/,/g, '')) : null);
  return {
    recientes: n(aviso?.[1]),
    guardias: n(aviso?.[2]),
    viejas: n(gris?.[1]),
  };
}

describe('una apertura devuelta por la plataforma no es arrastre del archivo', () => {
  let app;
  let admin;

  /** Una pendiente del archivo con fecha vieja: la del lado del arrastre. */
  const unaVieja = async () => {
    const r = await admin.pedir('/api/aperturas?periodo=2023-04');
    const ap = r.json.aperturas.find((a) => !a.servicio_id && !a.descartada);
    assert.ok(ap, 'hacen falta pendientes de 2023-04 para probar esto');
    return ap;
  };

  before(async () => {
    app = await arrancar();
    admin = await app.entrarYAsentar(ROLES.admin);
  });

  after(async () => {
    await app?.cerrar();
  });

  test('deshacer una apertura vieja la saca de la lista gris y la pone en el aviso', async () => {
    const antes = loQueDicePantalla((await admin.pedir('/aperturas')).texto);
    const ap = await unaVieja();

    // Se aplica —crea su servicio— y se deshace, que es la secuencia de quien
    // se equivocó al aplicarla.
    const aplicada = await admin.pedir(`/api/aperturas/${ap.id}/aplicar`, { method: 'POST' });
    assert.equal(aplicada.status, 200, aplicada.texto);
    const deshecha = await admin.pedir(`/api/aperturas/${ap.id}/deshacer`, {
      method: 'POST',
      body: JSON.stringify({ motivo: 'Se aplicó por error: el servicio no existe en la calle' }),
    });
    assert.equal(deshecha.status, 200, deshecha.texto);

    const despues = loQueDicePantalla((await admin.pedir('/aperturas')).texto);
    assert.equal(
      despues.recientes,
      antes.recientes + 1,
      'la devuelta tiene que aparecer en el aviso aunque su periodo sea de 2023'
    );
    assert.equal(despues.guardias, antes.guardias + (ap.guardias || 0), 'con sus guardias');
    assert.equal(
      despues.viejas,
      antes.viejas - 1,
      'y salir de la línea gris, que afirma que son del archivo y ya no operan'
    );

    // Y en las listas, no solo en los números.
    const recientes = comoSeLee((await admin.pedir('/aperturas?pendientes=1')).texto);
    assert.ok(recientes.includes(ap.folio), `${ap.folio} debería estar en la cola de las recientes`);
    const viejas = comoSeLee((await admin.pedir('/aperturas?pendientes=viejas')).texto);
    assert.ok(!viejas.includes(ap.folio), `${ap.folio} ya no es arrastre de la importación`);
  });

  test('el cierre en lote no se la puede llevar', async () => {
    const devuelta = (await admin.pedir('/api/aperturas?periodo=2023-04')).json.aperturas.find(
      (a) => !a.servicio_id && !a.descartada && a.devuelta_a_la_cola
    );
    assert.ok(devuelta, 'la de la prueba anterior tiene que seguir marcada como devuelta');

    const r = await admin.pedir('/api/aperturas/descartar-lote', {
      method: 'POST',
      body: JSON.stringify({ ids: [devuelta.id], motivo: 'Cerrando el arrastre de la importación' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.descartadas, 0, 'una devuelta por la plataforma no es arrastre');
    assert.match(r.json.fallidas[0].error, /devolvió la plataforma/i);

    const sigue = (await admin.pedir('/api/aperturas?periodo=2023-04')).json.aperturas.find(
      (a) => a.id === devuelta.id
    );
    assert.equal(sigue.descartada, 0, 'y sigue pendiente, a la vista de quien tiene que decidir');
  });

  test('el cierre en lote tampoco alcanza a las recientes del archivo', async () => {
    /**
     * Es el otro lado de la misma regla, y vivía solo en la pantalla: el lote se
     * ofrece en `?pendientes=viejas` y en ninguna otra cola, pero por API se
     * podían cerrar de un golpe las que el aviso ámbar está pidiendo que alguien
     * atienda.
     */
    const reciente = (await admin.pedir('/api/aperturas?periodo=2026-08')).json.aperturas.find(
      (a) => !a.servicio_id && !a.descartada
    );
    assert.ok(reciente, 'hacen falta pendientes recientes para probar esto');

    const r = await admin.pedir('/api/aperturas/descartar-lote', {
      method: 'POST',
      body: JSON.stringify({ ids: [reciente.id], motivo: 'Cerrando el arrastre de la importación' }),
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.descartadas, 0);
    assert.match(r.json.fallidas[0].error, /arrastre de la importación/i);
  });

  test('devolver una descartada a la cola la deja a la vista y no en el arrastre', async () => {
    // Si se quedara sin la marca, una descartada de 2023 reaparecería en la
    // línea gris de donde la acaban de sacar, y el siguiente cierre en lote la
    // volvería a cerrar sin que nadie la hubiera mirado.
    const ap = (await admin.pedir('/api/aperturas?periodo=2023-05')).json.aperturas.find(
      (a) => !a.servicio_id && !a.descartada
    );
    assert.ok(ap, 'hacen falta pendientes de 2023-05');

    assert.equal(
      (
        await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
          method: 'POST',
          body: JSON.stringify({ motivo: 'La importación trajo servicios que ya no operan' }),
        })
      ).status,
      200
    );
    const antes = loQueDicePantalla((await admin.pedir('/aperturas')).texto);

    const vuelta = await admin.pedir(`/api/aperturas/${ap.id}/descartar`, { method: 'DELETE' });
    assert.equal(vuelta.status, 200, vuelta.texto);

    const despues = loQueDicePantalla((await admin.pedir('/aperturas')).texto);
    assert.equal(despues.recientes, antes.recientes + 1, 'la devuelta se cuenta en el aviso');
    assert.equal(despues.viejas, antes.viejas, 'y no vuelve al arrastre');
  });

  test('el aviso dice que ahí dentro hay devueltas, en vez de llamarlas recientes', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas')).texto);
    assert.match(html, /que la plataforma devolvió a la cola/);
    assert.match(html, /sin importar su fecha/);
  });

  test('la puerta a las descartadas sigue estando sin aperturas recientes', async () => {
    /**
     * El enlace «N descartadas» vivía dentro de la caja ámbar, que solo se
     * dibuja si hay pendientes recientes. Con el arrastre abierto y cero
     * recientes no había forma de llegar a las descartadas más que escribiendo
     * la URL, y ahí es donde están las que alguien acaba de cerrar en lote.
     */
    /**
     * Se recorren los meses de uno en uno porque `GET /api/aperturas` sin
     * periodo trae como máximo 500 renglones y en la base hay 516: pedirlas de
     * un tirón deja catorce fuera de la cuenta.
     */
    const pendientes = [];
    for (const periodo of PERIODOS) {
      const r = await admin.pedir(`/api/aperturas?periodo=${periodo}`);
      pendientes.push(
        ...r.json.aperturas.filter(
          (a) => !a.servicio_id && !a.descartada && (a.devuelta_a_la_cola || periodoDe(a) > corte())
        )
      );
    }
    assert.ok(pendientes.length > 0, 'hacen falta recientes que cerrar');

    // Las recientes se cierran una por una: el lote no las alcanza, que es justo
    // la regla de la prueba de arriba.
    for (const ap of pendientes) {
      const r = await admin.pedir(`/api/aperturas/${ap.id}/descartar`, {
        method: 'POST',
        body: JSON.stringify({ motivo: 'Revisada una por una: no se aplica' }),
      });
      assert.equal(r.status, 200, `${ap.folio}: ${r.texto}`);
    }

    const html = comoSeLee((await admin.pedir('/aperturas')).texto);
    const quedan = loQueDicePantalla(html);
    assert.equal(quedan.recientes, null, 'sin recientes no hay caja ámbar');
    assert.ok(quedan.viejas > 0, 'pero el arrastre sigue abierto');
    assert.match(html, /ver las [\d,]+ descartadas/, 'y la puerta a las descartadas sigue abierta');
  });
});

describe('la migración sobre una base con el esquema viejo', () => {
  let app;
  let admin;

  before(async () => {
    /**
     * Se siembra con el esquema de hoy y se le quita la columna nueva: así queda
     * exactamente la base que tiene el cliente antes de desplegar esto. Si la
     * migración no corriera, la aplicación no arrancaría —todas las consultas de
     * pendientes nombran la columna— y esta prueba lo diría en el `before`.
     */
    app = await arrancar({
      prepararBase: (ruta) => {
        const db = new Database(ruta);
        db.exec('ALTER TABLE aperturas DROP COLUMN devuelta_a_la_cola');
        const columnas = db.prepare('PRAGMA table_info(aperturas)').all().map((c) => c.name);
        assert.ok(!columnas.includes('devuelta_a_la_cola'), 'la base de prueba quedó con el esquema viejo');
        db.close();
      },
    });
    admin = await app.entrarYAsentar(ROLES.admin);
  });

  after(async () => {
    await app?.cerrar();
  });

  test('arranca, la columna vuelve y ninguna apertura nace marcada', async () => {
    const r = await admin.pedir('/aperturas');
    assert.equal(r.status, 200, 'la aplicación arranca sobre la base vieja');

    const db = new Database(`${app.carpetaDatos}/prueba.db`, { readonly: true });
    try {
      const columnas = db.prepare('PRAGMA table_info(aperturas)').all().map((c) => c.name);
      assert.ok(columnas.includes('devuelta_a_la_cola'), 'la migración puso la columna');
      const { total, marcadas } = db
        .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(devuelta_a_la_cola), 0) AS marcadas FROM aperturas')
        .get();
      assert.equal(total, 516, 'las 516 aperturas del archivo siguen ahí');
      assert.equal(marcadas, 0, 'y ninguna se acusa de haber sido devuelta por la plataforma');
    } finally {
      db.close();
    }
  });

  test('y la pantalla cuenta lo mismo que sobre una base nueva', async () => {
    const dice = loQueDicePantalla((await admin.pedir('/aperturas')).texto);
    assert.ok(dice.recientes > 0, `el aviso cuenta ${dice.recientes}`);
    assert.ok(dice.viejas > 0, `la línea gris cuenta ${dice.viejas}`);
    assert.equal(dice.recientes + dice.viejas, 219, 'y las dos colas siguen sumando las 219 del archivo');
  });
});
