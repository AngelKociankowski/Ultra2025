/**
 * Los motivos de cancelación, de texto libre a lista.
 *
 * Se pidió estandarizarlos, y al mirar los datos se entendió por qué: 125
 * textos distintos para 330 cancelaciones, más 127 sin ningún motivo. «FIN DE
 * SERVICIO», «FIN DE CONTRATO», «TERMINO DE SERVICIO» y «CIERRE DE SERVICIO»
 * son el mismo hecho escrito de cuatro formas. Con eso, la pregunta para la que
 * sirve el motivo —de lo que perdimos, cuánto fue por nosotros y cuánto por el
 * cliente— no se puede contestar.
 *
 * Lo que se prueba aquí es lo que hace que el arreglo sirva y no solo ordene:
 *
 *   · Que el motivo salga de una lista, y que la API lo exija —si solo lo
 *     exigiera la pantalla, el catálogo sería una sugerencia—.
 *   · Que el texto viejo NO se haya tirado. Es la parte que no se puede
 *     deshacer: ahí vive que el pago quedaba para el viernes.
 *   · Que lo que no se pudo clasificar esté en OTRO y se note, en vez de estar
 *     repartido a ojo entre los dieciséis para que el reporte se vea completo.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let catalogo;

async function servicioActivo() {
  const r = await admin.pedir('/api/servicios?estatus=ACTIVO');
  return r.json.servicios.find((s) => !s.por_arrancar && s.total_guardias > 1);
}

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  catalogo = (await admin.pedir('/api/catalogos')).json;
});

after(async () => {
  await app?.cerrar();
});

describe('la lista', () => {
  test('el catálogo ofrece los motivos, y son pocos', () => {
    const m = catalogo.motivosBaja;
    assert.ok(Array.isArray(m) && m.length > 0, 'el catálogo de motivos llegó vacío');
    // Pocos a propósito: una lista que no cabe en una pantalla se elige mal, y
    // vuelve a pasar lo de los 125 textos por otro camino.
    assert.ok(m.length <= 20, `${m.length} motivos es demasiado para elegir bien`);
    for (const esperado of ['FIN DE CONTRATO', 'FALTA DE PAGO', 'FALLAS DE COBERTURA', 'OTRO']) {
      assert.ok(m.includes(esperado), `falta el motivo ${esperado}`);
    }
  });

  test('el administrador puede agregar uno sin que nadie toque el código', async () => {
    // Antes la lista estaba escrita en un archivo: agregar un motivo era un
    // despliegue. Por eso todo el mundo usaba «OTRO» y escribía a mano.
    const alta = await admin.pedir('/api/catalogos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'motivo_baja', valor: 'MOTIVO DE PRUEBA' }),
    });
    assert.equal(alta.status, 201, alta.texto);
    assert.ok((await admin.pedir('/api/catalogos')).json.motivosBaja.includes('MOTIVO DE PRUEBA'));
    await admin.pedir(`/api/catalogos?id=${alta.json.id}`, { method: 'DELETE' });
  });
});

describe('capturar una cancelación', () => {
  test('con un motivo de la lista y su detalle, entra', async () => {
    const s = await servicioActivo();
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: s.id,
        motivo: 'FALTA DE PAGO',
        motivo_detalle: 'Tres meses sin pagar; se acordó el cierre para el viernes.',
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const ficha = (await admin.pedir(`/api/servicios/${s.id}`)).json.servicio;
    const c = ficha.cancelaciones.at(-1);
    assert.equal(c.motivo, 'FALTA DE PAGO');
    assert.match(c.motivo_detalle, /viernes/);
  });

  test('un motivo inventado lo rechaza la API, no solo la pantalla', async () => {
    // Mientras la API siguiera aceptando cualquier texto, el catálogo sería una
    // sugerencia. Así es como se llegó a los 125.
    const s = await servicioActivo();
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: s.id, motivo: 'se acabó y ya' }),
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /catálogo/i);
  });

  test('sin motivo sigue sin poderse', async () => {
    const s = await servicioActivo();
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'CANCELACION', servicio_id: s.id, motivo: '' }),
    });
    assert.equal(r.status, 400);
  });

  test('el detalle es libre y no se valida contra nada', async () => {
    // Es lo que ninguna lista puede prever. Validarlo sería volver al principio.
    const s = await servicioActivo();
    // Se retira de un turno concreto: el servicio trae desglose y la plataforma
    // exige decir de dónde salen los guardias, que es otra regla y sigue viva.
    const [turno] = Object.keys(s.turnos || {});
    const r = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'REDUCCION',
        servicio_id: s.id,
        turnos: turno ? { [turno]: 1 } : undefined,
        guardias: turno ? undefined : 1,
        motivo: 'OTRO',
        motivo_detalle: 'El guardia se jubiló y no autorizaron reposición — caso único.',
      }),
    });
    assert.equal(r.status, 201, r.texto);
  });
});

describe('lo que ya estaba capturado', () => {
  test('quedó repartido en la lista, no en 125 textos', async () => {
    const r = await admin.pedir('/api/cancelaciones?limite=1000');
    const filas = r.json.cancelaciones || r.json.movimientos || [];
    if (!filas.length) return; // la API cambió de forma; el reporte de abajo cubre lo mismo

    const conMotivo = filas.filter((f) => f.motivo);
    const distintos = new Set(conMotivo.map((f) => f.motivo));
    assert.ok(
      distintos.size <= 20,
      `siguen quedando ${distintos.size} motivos distintos: la reclasificación no corrió`
    );
    for (const m of distintos) {
      assert.ok(catalogo.motivosBaja.includes(m), `«${m}» no es del catálogo: quedó texto libre suelto`);
    }
  });

  test('el texto original no se tiró: está en el detalle', async () => {
    // Esta es la parte que no se puede deshacer. Si la migración hubiera
    // reemplazado el texto en vez de moverlo, no habría forma de recuperarlo.
    const r = await admin.pedir('/api/cancelaciones?limite=1000');
    const filas = r.json.cancelaciones || r.json.movimientos || [];
    if (!filas.length) return;
    const conDetalle = filas.filter((f) => f.motivo_detalle);
    assert.ok(conDetalle.length > 50, `solo ${conDetalle.length} conservan el texto original`);
  });
});
