/**
 * Aperturas y cancelaciones vistas por mes.
 *
 * Antes las dos pantallas eran una lista de los últimos 400 renglones. Con
 * quinientas aperturas de tres años, saber qué pasó en agosto era ir bajando
 * hasta que las fechas cambiaran de mes, y las tres preguntas que cualquiera
 * hace —cuántas fueron, cuántos guardias, cuánto dinero— no se contestaban en
 * ningún lado.
 *
 * Se prueba que el corte por mes sea de verdad —que un movimiento de julio no
 * se cuele en agosto—, que los totales sumen, que se pueda ver todo lo
 * capturado de cada movimiento, y la regla de siempre: mirar es de todos,
 * mover el estado de fuerza es de quien tiene el permiso.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let juridico;
let ventas;

const comoSeLee = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const hoyEnMexico = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  ventas = await app.entrarYAsentar(ROLES.ventas);
});

after(async () => {
  await app?.cerrar();
});

describe('el mes manda', () => {
  test('la pantalla abre en el mes en curso', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas')).texto);
    const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const mes = MESES[Number(hoyEnMexico().slice(5, 7))];
    assert.match(html, new RegExp(`Movimientos en ${mes} de ${hoyEnMexico().slice(0, 4)}`, 'i'));
  });

  test('un movimiento de otro mes no se cuela en el mes escogido', async () => {
    const julio = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'SOLO EN JULIO', fecha: '2026-07-09', turnos: { '24 HRS': 3 } }),
    });
    assert.equal(julio.status, 201, julio.texto);

    const enJulio = comoSeLee((await admin.pedir('/aperturas?periodo=2026-07')).texto);
    assert.match(enJulio, /SOLO EN JULIO/);

    const enAgosto = comoSeLee((await admin.pedir('/aperturas?periodo=2026-08')).texto);
    assert.doesNotMatch(enAgosto, /SOLO EN JULIO/);
  });

  test('un mes sin nada lo dice, en lugar de enseñar el mes de al lado', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2019-02')).texto);
    assert.match(html, /No hubo movimientos en este mes/);
  });

  test('«todo el histórico» sigue estando para buscar un folio viejo', async () => {
    const r = await admin.pedir('/aperturas?periodo=todo');
    assert.equal(r.status, 200);
    assert.match(comoSeLee(r.texto), /todo el histórico/i);
  });

  test('el calendario del año lleva la cuenta de cada mes', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2026-03')).texto);
    assert.match(html, /Movimientos de 2026/);
    assert.match(html, /guardias/);
    // marzo de 2026 trae movimientos en el archivo
    assert.match(html, /Mar/);
  });

  test('las altas técnicas de la carga inicial no se cuentan como movimientos', async () => {
    // Son 217 apuntes de que el servicio ya existía al arrancar. Si contaran,
    // su mes aparecería con doscientas aperturas que en la calle no pasaron.
    const { aperturas } = (await admin.pedir('/api/aperturas')).json;
    const tecnicas = aperturas.filter((a) => a.carga_inicial === 1);
    assert.ok(tecnicas.length > 0, 'el archivo trae altas técnicas');

    const periodo = (tecnicas[0].periodo || tecnicas[0].fecha || '').slice(0, 7);
    const html = comoSeLee((await admin.pedir(`/aperturas?periodo=${periodo}`)).texto);
    assert.doesNotMatch(html, new RegExp(tecnicas[0].folio));
  });
});

describe('los totales del mes', () => {
  test('cuenta movimientos, guardias y dinero de lo que sí tiene precio', async () => {
    const nombres = ['TOTALES UNO', 'TOTALES DOS'];
    for (const [i, n] of nombres.entries()) {
      const r = await admin.pedir('/api/aperturas', {
        method: 'POST',
        body: JSON.stringify({
          tipo: 'APERTURA',
          servicio: n,
          fecha: '2019-05-10',
          turnos: { '24 HRS': 2 },
          precio_guardia: 10000 * (i + 1),
        }),
      });
      assert.equal(r.status, 201, r.texto);
    }

    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2019-05')).texto);
    assert.match(html, /Movimientos en mayo de 2019/);
    assert.match(html, /\+4/, 'los cuatro guardias de los dos movimientos');
    // 2 × 10,000 + 2 × 20,000 = 60,000
    assert.match(html, /\$60,000/);
  });

  test('lo que no tiene precio no se suma a escondidas: se dice cuántos son', async () => {
    await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'SIN PRECIO MAYO 2019', fecha: '2019-05-11', turnos: { '24 HRS': 1 } }),
    });
    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2019-05')).texto);
    assert.match(html, /sin precio para calcular|no traen precio capturado/i);
  });

  test('el mes enseña el neto contra el otro lado', async () => {
    // El «creció 46» va dentro de un <strong>, así que se comprueban las dos
    // mitades por separado en lugar de pelear con la etiqueta de en medio.
    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2026-03')).texto);
    assert.match(html, /el estado de fuerza/);
    assert.match(html, /creció|bajó/);
    assert.match(html, /guardias cancelados el mismo mes/);
    assert.match(html, /Ver las cancelaciones/);
  });

  test('cancelaciones enseña lo que quedó por cobrar al cerrar', async () => {
    const html = comoSeLee((await admin.pedir('/cancelaciones?periodo=2026-03')).texto);
    assert.match(html, /Por cobrar al cerrar/);
    assert.match(html, /Guardias retirados/);
  });

  test('el desglose por tipo separa una apertura nueva de una ampliación', async () => {
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'DESGLOSE POR TIPO', fecha: '2019-06-02', turnos: { '24 HRS': 2 } }),
    });
    assert.equal(alta.status, 201);
    const inc = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'INCREMENTO',
        servicio_id: alta.json.servicioId,
        fecha: '2019-06-20',
        turnos: { '24 HRS': 1 },
      }),
    });
    assert.equal(inc.status, 201, inc.texto);

    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2019-06')).texto);
    assert.match(html, /APERTURA/);
    assert.match(html, /INCREMENTO/);
  });
});

describe('la información completa de cada movimiento', () => {
  test('el renglón trae lo que se capturó, aunque no quepa en una columna', async () => {
    const r = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'APERTURA',
        servicio: 'EXPEDIENTE COMPLETO',
        razon_social: 'EXPEDIENTE COMPLETO SA DE CV',
        direccion: 'CALLE DE LA PRUEBA 123',
        fecha: '2019-07-15',
        turnos: { '24 HRS': 2, '12 HRS': 1 },
        precio_guardia: 15000,
        sueldo_base: 8000,
        bono: 500,
        uniforme: 'Institucional',
        gerente: 'GERENTE DE PRUEBA',
        tipo_repse: 'Repse Basico',
        esquema_facturacion: 'MES_VENCIDO',
        dias_credito: 30,
        comentarios: 'Este comentario tiene que verse al abrir el renglón.',
      }),
    });
    assert.equal(r.status, 201, r.texto);

    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2019-07')).texto);
    // El expediente se pinta con la tabla, así que su contenido viaja en el HTML
    for (const dato of [
      'EXPEDIENTE COMPLETO SA DE CV',
      'CALLE DE LA PRUEBA 123',
      'GERENTE DE PRUEBA',
      'Repse Basico',
      'Institucional',
      'Este comentario tiene que verse',
    ]) {
      assert.match(html, new RegExp(dato.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `falta «${dato}»`);
    }
  });

  test('el desglose por turno del movimiento se ve en la lista', async () => {
    const html = comoSeLee((await admin.pedir('/aperturas?periodo=2019-07')).texto);
    assert.match(html, /24 HRS/);
    assert.match(html, /12 HRS/);
  });

  test('una cancelación enseña su motivo completo', async () => {
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'SE VA CON MOTIVO', fecha: '2019-08-01', turnos: { '24 HRS': 2 } }),
    });
    const baja = await admin.pedir('/api/cancelaciones', {
      method: 'POST',
      body: JSON.stringify({
        tipo: 'CANCELACION',
        servicio_id: alta.json.servicioId,
        fecha: '2019-08-20',
        motivo: 'El cliente cerró la sucursal y no habrá reposición en otra plaza',
      }),
    });
    assert.equal(baja.status, 201, baja.texto);

    const html = comoSeLee((await admin.pedir('/cancelaciones?periodo=2019-08')).texto);
    assert.match(html, /El cliente cerró la sucursal/);
  });
});

describe('mirar es de todos, mover no', () => {
  test('jurídico ve las dos pantallas completas', async () => {
    for (const ruta of ['/aperturas', '/cancelaciones']) {
      const r = await juridico.pedir(ruta);
      assert.equal(r.status, 200, `${ruta} debería verse`);
      assert.match(comoSeLee(r.texto), /Movimientos de \d{4}/);
    }
  });

  test('a jurídico no se le ofrecen los botones de captura', async () => {
    const ap = comoSeLee((await juridico.pedir('/aperturas')).texto);
    assert.doesNotMatch(ap, /Nueva apertura/);
    assert.doesNotMatch(ap, /Pendiente · Aplicar/);

    const can = comoSeLee((await juridico.pedir('/cancelaciones')).texto);
    assert.doesNotMatch(can, /Movimiento de guardias/);
  });

  test('y por la API tampoco: mirar no da permiso de escribir', async () => {
    const r = await juridico.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'JURIDICO NO ABRE', turnos: { '24 HRS': 1 } }),
    });
    assert.equal(r.status, 403);
  });

  test('a ventas sí se le ofrecen', async () => {
    assert.match(comoSeLee((await ventas.pedir('/aperturas')).texto), /Nueva apertura/);
    assert.match(comoSeLee((await ventas.pedir('/cancelaciones')).texto), /Movimiento de guardias/);
  });
});
