/**
 * Ataque a la unificación de la captura (`lib/captura.js`).
 *
 * Este archivo NO prueba lo que el coder dice que hizo: prueba el criterio del
 * plan, corriéndolo. Se borraron seis funciones y se redirigieron siete caminos
 * de escritura, así que lo que más importa no es que lo nuevo rechace basura
 * —eso es fácil— sino que lo legítimo SIGA ENTRANDO por los cuatro caminos, que
 * el candado de la razón social siga cerrado, que el dinero cuadre y que no haya
 * un camino que se saltó el sitio único.
 *
 * Organización:
 *   T1  lo legítimo sigue entrando por los cuatro caminos (regresión)
 *   T2  el candado de la razón social
 *   T3  los seis roles: nadie gana ni pierde permiso
 *   T4  el precio en dos lugares
 *   T5  el dinero: importes, plazos, guardias facturados, corrección
 *   T6  los caminos que NO pasan por el sitio único (hallazgos)
 *   T7  la derivación de las reglas, atacada por su fuente
 *   T8  invariantes y fallo silencioso
 *
 * Las pruebas que quedan ROJAS a propósito llevan «HALLAZGO» en el nombre y
 * corresponden una a una con un hallazgo de `.ciclo/tester-3.md`.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arrancar, ROLES } from './servidor.mjs';
import { GRUPOS_CAMPOS, CAMPOS_BLOQUEADOS, camposEditables } from '../lib/rbac.js';

let app;
let admin;
let operaciones;
let ventas;
let finanzas;
let juridico;
let espectador;
let cat;

const ficha = async (id) => (await admin.pedir(`/api/servicios/${id}`)).json.servicio;

const editar = (s, id, cuerpo) =>
  s.pedir(`/api/servicios/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
const completar = (s, id, cuerpo) =>
  s.pedir(`/api/servicios/${id}/completar`, { method: 'PATCH', body: JSON.stringify(cuerpo) });
const correccionFormal = (s, id, cuerpo) =>
  s.pedir(`/api/servicios/${id}/correccion`, { method: 'POST', body: JSON.stringify(cuerpo) });
const abrirCrudo = (s, cuerpo) => s.pedir('/api/aperturas', { method: 'POST', body: JSON.stringify(cuerpo) });
const cancelar = (s, cuerpo) => s.pedir('/api/cancelaciones', { method: 'POST', body: JSON.stringify(cuerpo) });
const facturar = (s, cuerpo) => s.pedir('/api/facturas', { method: 'POST', body: JSON.stringify(cuerpo) });
const moverFactura = (s, cuerpo) => s.pedir('/api/facturas', { method: 'PATCH', body: JSON.stringify(cuerpo) });
const guardarPartidas = (s, id, partidas) =>
  s.pedir(`/api/servicios/${id}/partidas`, { method: 'PUT', body: JSON.stringify({ partidas }) });

let n = 0;
const unico = (base) => `${base} ${Date.now().toString(36)}${(n += 1)}`;

/** Abre un servicio con lo mínimo y devuelve su id. */
async function abrirId(sesion, base, extra = {}) {
  const r = await abrirCrudo(sesion, {
    tipo: 'APERTURA',
    servicio: unico(base),
    zona: cat.zonas[0],
    asesor: cat.asesores[0],
    turnos: { '24 HRS': 2 },
    ...extra,
  });
  assert.equal(r.status, 201, r.texto);
  return r.json.servicioId;
}

function conLaBase(fn) {
  const db = new Database(`${app.carpetaDatos}/prueba.db`);
  db.pragma('busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const aperturasDe = (servicioId) =>
  conLaBase((db) =>
    db
      .prepare('SELECT id, folio, tipo, precio_guardia, guardias, periodo FROM aperturas WHERE servicio_id = ? ORDER BY id')
      .all(Number(servicioId))
  );

const conteos = () =>
  conLaBase((db) => ({
    servicios: db.prepare("SELECT COUNT(*) n FROM servicios WHERE estatus <> 'BAJA'").get().n,
    guardias: db.prepare("SELECT COALESCE(SUM(total_guardias),0) n FROM servicios WHERE estatus <> 'BAJA'").get().n,
    aperturas: db.prepare('SELECT COUNT(*) n FROM aperturas').get().n,
    cancelaciones: db.prepare('SELECT COUNT(*) n FROM cancelaciones').get().n,
  }));

let base0;

before(async () => {
  app = await arrancar();
  admin = await app.entrar(ROLES.admin);
  operaciones = await app.entrarYAsentar(ROLES.operaciones);
  ventas = await app.entrarYAsentar(ROLES.ventas);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
  juridico = await app.entrarYAsentar(ROLES.juridico);
  // El espectador no viene sembrado: lo da de alta el administrador, como en
  // producción.
  const alta = await admin.pedir('/api/usuarios', {
    method: 'POST',
    body: JSON.stringify({
      email: 'espectador@corporativoultra.com',
      nombre: 'Espectador de prueba',
      rol: 'espectador',
      password: 'UltraGuardias2026',
    }),
  });
  assert.equal(alta.status, 201, alta.texto);
  espectador = await app.entrarYAsentar('espectador@corporativoultra.com');
  cat = (await admin.pedir('/api/catalogos')).json;
  base0 = conteos();
});

after(async () => {
  await app?.cerrar();
});

// ---------------------------------------------------------------------- T0

describe('T0 · la línea base, medida y no creída', () => {
  test('T0.1 los invariantes sembrados son los que el encargo dice', () => {
    assert.deepEqual(base0, { servicios: 217, guardias: 880, aperturas: 516, cancelaciones: 330 });
  });
});

// ---------------------------------------------------------------------- T1

describe('T1 · lo legítimo sigue entrando por los cuatro caminos', () => {
  test('T1.1 apertura: miles con coma, pesos, espacios, acentos, ñ y emoji', async () => {
    const r = await abrirCrudo(ventas, {
      tipo: 'APERTURA',
      servicio: unico('T1 APERTURA LEGÍTIMA ÑOÑO'),
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 3 },
      razon_social: 'Señor Peñón Ñandú, S.A. de C.V. 🎉',
      direccion: 'Av. Insurgentes Sur 1234, Col. Del Valle, Ciudad de México',
      precio_guardia: '1,234.56',
      sueldo_base: '$7,000',
      bono: ' 9 500 ',
      credito_maximo: '1,000,000.00',
      dias_credito: '30',
      esquema_facturacion: 'FIN_MES',
      forma_pago: cat.formasPago[0],
      hora_apertura: '07:00',
      fecha: '2026-03-15',
      vehiculos_custodia: '2',
      comentarios: 'Primer turno\nse monta a las 7.\nContacto: José Muñoz 😀',
    });
    assert.equal(r.status, 201, r.texto);
    const s = await ficha(r.json.servicioId);
    assert.equal(s.razon_social, 'Señor Peñón Ñandú, S.A. de C.V. 🎉');
    assert.equal(s.precio_guardia, 1234.56);
    assert.equal(s.sueldo_base, 7000);
    assert.equal(s.bono, 9500);
    assert.equal(s.credito_maximo, 1000000);
    assert.equal(s.dias_credito, 30);
    assert.equal(s.total_guardias, 3);
  });

  test('T1.2 el cero escrito a propósito entra por los cuatro caminos', async () => {
    // Cortesía: precio cero. Contado: cero días de crédito.
    const porApertura = await abrirId(ventas, 'T1 CERO APERTURA', {
      precio_guardia: '0',
      dias_credito: '0',
    });
    const a = await ficha(porApertura);
    assert.equal(a.precio_guardia, 0, 'un precio de cortesía capturado en la apertura');
    assert.equal(a.dias_credito, 0, 'contado capturado en la apertura');

    // Por «Editar».
    const porEditar = await abrirId(ventas, 'T1 CERO EDITAR', { precio_guardia: '500' });
    const e = await editar(admin, porEditar, { precio_guardia: 0 });
    assert.equal(e.status, 200, e.texto);
    assert.equal((await ficha(porEditar)).precio_guardia, 0);

    // Por el panel del alta (hueco).
    const porCompletar = await abrirId(ventas, 'T1 CERO COMPLETAR');
    const c = await completar(ventas, porCompletar, { precio_guardia: '0', dias_credito: '0' });
    assert.equal(c.status, 200, c.texto);
    assert.deepEqual(Object.keys(c.json.llenados).sort(), ['dias_credito', 'precio_guardia']);
    assert.equal((await ficha(porCompletar)).precio_guardia, 0);

    // Por la corrección propia del mismo día.
    const corr = await completar(ventas, porCompletar, {
      correcciones: { precio_guardia: '0.00' },
      motivo: 'Confirmado como servicio de cortesía con el cliente.',
    });
    assert.equal(corr.status, 200, corr.texto);
    assert.equal((await ficha(porCompletar)).precio_guardia, 0);
  });

  test('T1.3 editar la ficha: miles, pesos, porcentaje, negativo donde toca', async () => {
    const id = await abrirId(ventas, 'T1 EDITAR LEGÍTIMO');
    const r = await editar(admin, id, {
      precio_guardia: '9,500.50',
      sueldo_base: '$6 500',
      bono: '1,000',
      direccion: 'Calzada de Tlalpan 3000, Colonia Churubusco, Coyoacán',
    });
    assert.equal(r.status, 200, r.texto);
    const f = await editar(finanzas, id, {
      importe_factura: '1,434,122.01',
      nomina_total: '957,000',
      resultado_servicio: '-54,875.76',
      pct_utilidad: '-75.46 %',
      dias_credito: '21',
    });
    assert.equal(f.status, 200, f.texto);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, 9500.5);
    assert.equal(s.sueldo_base, 6500);
    assert.equal(s.importe_factura, 1434122.01);
    assert.equal(s.nomina_total, 957000);
    assert.equal(s.resultado_servicio, -54875.76);
    assert.equal(s.pct_utilidad, -75.46);
  });

  test('T1.4 una cancelación con motivo, detalle con emoji y cxc con coma', async () => {
    const id = await abrirId(operaciones, 'T1 CANCELAR LEGÍTIMO', { precio_guardia: '1000' });
    const r = await cancelar(operaciones, {
      tipo: 'CANCELACION',
      servicio_id: id,
      motivo: cat.motivosBaja[0],
      motivo_detalle: 'El cliente cerró la sucursal.\nLo avisó José Muñoz 😔',
      cxc: '1,234.56',
      auditoria: 'Sin faltantes',
      fecha: '2026-04-01',
    });
    assert.equal(r.status, 201, r.texto);
    const fila = conLaBase((db) =>
      db.prepare('SELECT * FROM cancelaciones WHERE servicio_id = ? ORDER BY id DESC').get(Number(id))
    );
    assert.equal(fila.cxc, 1234.56);
    assert.match(fila.motivo_detalle, /😔/);
    assert.match(fila.motivo_detalle, /\n/, 'el párrafo no se aplasta');
  });

  test('T1.5 el libro de facturas: lo que una persona teclea de verdad', async () => {
    const id = await abrirId(ventas, 'T1 FACTURA LEGÍTIMA', { precio_guardia: '5000' });
    const r = await facturar(finanzas, {
      servicio_id: id,
      periodo: '2026-03',
      importe: '1,234.56',
      guardias: '2',
      concepto: 'Marzo — vigilancia ñoña 🎉',
      folio: 'A-001',
      fecha_factura: '2026-03-31',
      dias_credito: '21',
    });
    assert.equal(r.status, 201, r.texto);
    const otra = await facturar(finanzas, {
      servicio_id: id,
      periodo: '2026-04',
      importe: '$7,000',
      guardias: 2,
      fecha_factura: '2026-04-30',
    });
    assert.equal(otra.status, 201, otra.texto);

    const cuenta = await admin.pedir(`/api/facturas?servicio_id=${id}`);
    const importes = cuenta.json.facturas.map((f) => f.importe).sort((a, b) => a - b);
    assert.deepEqual(importes, [1234.56, 7000]);
  });

  test('T1.6 los pagos y el saldo siguen cuadrando', async () => {
    const id = await abrirId(ventas, 'T1 PAGOS', { precio_guardia: '5000' });
    const f = await facturar(finanzas, {
      servicio_id: id,
      periodo: '2026-05',
      importe: '10,000.00',
      guardias: 2,
      fecha_factura: '2026-05-31',
    });
    assert.equal(f.status, 201, f.texto);
    const facturaId = f.json.factura?.id ?? f.json.id;
    assert.ok(facturaId, `la factura devuelve su id: ${f.texto}`);

    const p1 = await moverFactura(finanzas, { id: facturaId, pago: { importe: '4,000', fecha: '2026-06-01' } });
    assert.equal(p1.status, 200, p1.texto);
    const p2 = await moverFactura(finanzas, { id: facturaId, pago: { importe: '$6,000', fecha: '2026-06-02' } });
    assert.equal(p2.status, 200, p2.texto);

    const cuenta = await admin.pedir(`/api/facturas?servicio_id=${id}`);
    const fac = cuenta.json.facturas.find((x) => x.id === facturaId);
    assert.equal(fac.importe, 10000);
    assert.equal(fac.importe_pagado, 10000);
    assert.equal(cuenta.json.resumen.saldo ?? cuenta.json.resumen.pendiente ?? 0, 0, cuenta.texto);
  });

  test('T1.7 fechas y horas como las teclea una persona', async () => {
    const id = await abrirId(ventas, 'T1 FECHAS');
    const ok = await editar(admin, id, { fecha_fin_prevista: '2026-12-31', modalidad: 'TEMPORAL' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await ficha(id)).fecha_fin_prevista, '2026-12-31');

    // Y lo que no es una fecha se contesta, no se guarda a medias.
    for (const mala of ['31/12/2026', '2026-13-01', '2026-02-31', 'mañana']) {
      const r = await editar(admin, id, { fecha_fin_prevista: mala });
      assert.equal(r.status, 400, `«${mala}» no debería entrar: ${r.texto}`);
    }
    assert.equal((await ficha(id)).fecha_fin_prevista, '2026-12-31', 'y la buena sigue ahí');
  });
});

// ---------------------------------------------------------------------- T2

describe('T2 · el candado de la razón social', () => {
  test('T2.1 «» no borra el nombre legal por la corrección formal', async () => {
    const id = await abrirId(ventas, 'T2 RS FORMAL', { razon_social: 'ACME, S.A. de C.V.' });
    for (const vacio of ['', '   ', null]) {
      const r = await correccionFormal(admin, id, {
        razon_social: vacio,
        motivo: 'Intento de borrar el nombre legal.',
      });
      if (vacio === null) {
        // `null` por este carril es «no lo mandó»: no es un borrado.
        assert.ok([200, 400].includes(r.status), r.texto);
      } else {
        assert.equal(r.status, 400, `«${JSON.stringify(vacio)}» no debe borrar: ${r.texto}`);
      }
      assert.equal((await ficha(id)).razon_social, 'ACME, S.A. de C.V.');
    }
  });

  test('T2.2 «» no borra el nombre legal por la corrección propia del mismo día', async () => {
    const id = await abrirId(ventas, 'T2 RS PROPIA', { razon_social: 'ACME DOS, S.A. de C.V.' });
    const r = await completar(ventas, id, {
      correcciones: { razon_social: '' },
      motivo: 'Intento de borrar el nombre legal por el carril propio.',
    });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).razon_social, 'ACME DOS, S.A. de C.V.');
  });

  test('T2.3 una corrección de razón social deja renglón y aviso a jurídico', async () => {
    const id = await abrirId(ventas, 'T2 RS AVISO', { razon_social: 'MAL ESCRITO SA' });
    const antes = (await juridico.pedir('/api/avisos')).json.avisos?.length ?? 0;
    const r = await correccionFormal(admin, id, {
      razon_social: 'BIEN ESCRITO, S.A. de C.V.',
      motivo: 'El contrato dice otro nombre legal.',
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(id)).razon_social, 'BIEN ESCRITO, S.A. de C.V.');

    const renglones = conLaBase((db) =>
      db.prepare('SELECT * FROM correcciones WHERE servicio_id = ?').all(Number(id))
    );
    assert.equal(renglones.length, 1, 'la corrección deja su renglón');
    assert.match(renglones[0].cambios, /razon_social/);

    const despues = (await juridico.pedir('/api/avisos')).json.avisos ?? [];
    assert.ok(despues.length > antes, 'a jurídico se le avisa');
    assert.ok(
      despues.some((a) => String(a.cuerpo || '').includes('BIEN ESCRITO')),
      `el aviso nombra el cambio: ${JSON.stringify(despues.slice(0, 3))}`
    );
  });

  test('T2.4 la razón social sigue fuera de «Editar»', async () => {
    const id = await abrirId(ventas, 'T2 RS EDITAR', { razon_social: 'INTOCABLE SA' });
    const r = await editar(admin, id, { razon_social: 'OTRA SA' });
    assert.equal(r.status, 403, r.texto);
    assert.equal((await ficha(id)).razon_social, 'INTOCABLE SA');
  });
});

// ---------------------------------------------------------------------- T3

describe('T3 · los seis roles: nadie gana ni pierde permiso', () => {
  test('T3.1 cada rol escribe lo suyo y nada más, por «Editar»', async () => {
    const sesiones = { admin, juridico, finanzas, operaciones, ventas, espectador };
    const todos = [...new Set(Object.values(GRUPOS_CAMPOS).flatMap((g) => g.campos))];
    const problemas = [];

    for (const [rol, sesion] of Object.entries(sesiones)) {
      const puede = new Set(camposEditables(rol));
      const id = await abrirId(admin, `T3 ROL ${rol}`);
      for (const campo of todos) {
        // Un valor que es válido para cualquier tipo de control: la pregunta
        // aquí es el permiso, no el valor.
        const r = await editar(sesion, id, { [campo]: null });
        const deberia = puede.has(campo);
        const paso = r.status !== 403;
        if (deberia !== paso) {
          problemas.push(`${rol}/${campo}: ${deberia ? 'debería poder' : 'NO debería poder'} → ${r.status}`);
        }
      }
    }
    assert.deepEqual(problemas, [], problemas.join(' · '));
  });

  test('T3.2 los campos bloqueados siguen bloqueados para todos', async () => {
    const id = await abrirId(admin, 'T3 BLOQUEADOS');
    for (const campo of CAMPOS_BLOQUEADOS) {
      const r = await editar(admin, id, { [campo]: 'x' });
      assert.equal(r.status, 403, `«${campo}» no se edita por PATCH: ${r.texto}`);
    }
  });

  test('T3.3 el espectador y el anónimo no escriben por ningún camino', async () => {
    const id = await abrirId(admin, 'T3 ESPECTADOR');
    const anon = app.anonimo();
    for (const quien of [espectador, anon]) {
      assert.ok([401, 403].includes((await editar(quien, id, { direccion: 'x' })).status));
      assert.ok([401, 403].includes((await completar(quien, id, { precio_guardia: '1' })).status));
      assert.ok([401, 403].includes((await correccionFormal(quien, id, { servicio: 'x', motivo: 'xxxxx' })).status));
      assert.ok([401, 403].includes((await abrirCrudo(quien, { tipo: 'APERTURA', servicio: 'x' })).status));
      assert.ok([401, 403].includes((await facturar(quien, { servicio_id: id })).status));
    }
  });
});

// ---------------------------------------------------------------------- T4

describe('T4 · el precio vive en dos lugares', () => {
  test('T4.1 un arreglo por «Editar» alinea la copia del movimiento', async () => {
    const id = await abrirId(ventas, 'T4 ARREGLO', { precio_guardia: '95000', fecha: '2026-02-10' });
    assert.equal(aperturasDe(id)[0].precio_guardia, 95000);
    const r = await editar(admin, id, { precio_guardia: '9,500' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).precio_guardia, 9500);
    assert.equal(aperturasDe(id)[0].precio_guardia, 9500, 'la copia del movimiento se alineó');
  });

  test('T4.2 un aumento anual NO reescribe los meses viejos', async () => {
    const id = await abrirId(ventas, 'T4 AUMENTO', { precio_guardia: '10000', fecha: '2023-03-10' });
    const r = await admin.pedir('/api/precios', {
      method: 'POST',
      body: JSON.stringify({
        ids: [id],
        ajuste: { tipo: 'PORCENTAJE', valor: 10 },
        vigencia: '2026-10',
        motivo: 'Revisión anual de precios',
      }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(id)).precio_guardia, 11000, 'la ficha sube');
    assert.equal(aperturasDe(id)[0].precio_guardia, 10000, 'marzo de 2023 entró a 10 000 y se queda así');
  });

  test('T4.3 un movimiento con otro precio a propósito no se toca', async () => {
    const id = await abrirId(ventas, 'T4 OTRO PRECIO', { precio_guardia: '9000', fecha: '2026-01-10' });
    // Un incremento que ese día se pactó a otro precio.
    const inc = await abrirCrudo(ventas, {
      tipo: 'INCREMENTO',
      servicio_id: id,
      turnos: { '24 HRS': 1 },
      precio_guardia: '12000',
      fecha: '2026-02-10',
    });
    assert.equal(inc.status, 201, inc.texto);

    const r = await editar(admin, id, { precio_guardia: '9,500' });
    assert.equal(r.status, 200, r.texto);
    const movs = aperturasDe(id);
    assert.equal(movs.find((m) => m.tipo === 'APERTURA').precio_guardia, 9500, 'el que decía lo mismo se alinea');
    assert.equal(
      movs.find((m) => m.tipo === 'INCREMENTO').precio_guardia,
      12000,
      'el que decía otra cosa es su propio registro'
    );
  });

  test('T4.4 HALLAZGO · un movimiento con precio CERO a propósito se reescribe', async () => {
    /**
     * `alinearPrecioDelMovimiento()` compara con
     * `COALESCE(precio_guardia, 0) = COALESCE(?, 0)`, así que «sin capturar»
     * (nulo) y «de cortesía» (cero) son el mismo valor para la consulta. Pero
     * cero NO es lo mismo que nulo en esta plataforma: la cabecera de
     * `lib/captura.js` dice que un cero en el precio «la plataforma lo lee como
     * servicio de cortesía», y el panel del alta cuenta el cero como respuesta.
     *
     * Resultado: una ficha sin precio capturado y un movimiento con cero
     * pactado. Al llenar el hueco de la ficha, el cero del movimiento —que es un
     * hecho de ese mes— se reescribe con el precio nuevo, y el «valor mensual que
     * entra» de ese mes cambia.
     */
    const id = await abrirId(ventas, 'T4 CERO MOVIMIENTO', { precio_guardia: '', fecha: '2026-01-05' });
    assert.equal((await ficha(id)).precio_guardia, null, 'la ficha nace sin precio');

    const inc = await abrirCrudo(ventas, {
      tipo: 'INCREMENTO',
      servicio_id: id,
      turnos: { '24 HRS': 1 },
      precio_guardia: '0',
      fecha: '2026-02-05',
    });
    assert.equal(inc.status, 201, inc.texto);
    const incremento = () => aperturasDe(id).find((m) => m.tipo === 'INCREMENTO');
    assert.equal(incremento().precio_guardia, 0, 'el mes de febrero entró de cortesía');

    const r = await completar(ventas, id, { precio_guardia: '9500' });
    assert.equal(r.status, 200, r.texto);

    assert.equal(
      incremento().precio_guardia,
      0,
      'el cero de febrero es un hecho de febrero y no debería reescribirse al llenar el hueco de la ficha'
    );
  });

  test('T4.5 después de arreglar el precio, la ficha y el movimiento no discrepan', async () => {
    // Por el carril de la corrección propia del mismo día. El precio tiene que
    // haberse LLENADO desde la plataforma para que haya autoría que lo permita:
    // la apertura lo escribe sin dejar renglón de llenado.
    const id = await abrirId(ventas, 'T4 CORRECCIÓN PROPIA', { fecha: '2026-03-05' });
    const lleno = await completar(ventas, id, { precio_guardia: '95000' });
    assert.equal(lleno.status, 200, lleno.texto);
    assert.equal(aperturasDe(id)[0].precio_guardia, 95000, 'el llenado alineó la copia del movimiento');

    const r = await completar(ventas, id, {
      correcciones: { precio_guardia: '9500' },
      motivo: 'Se capturó con un cero de más.',
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await ficha(id)).precio_guardia, 9500);
    assert.equal(aperturasDe(id)[0].precio_guardia, 9500, 'y la corrección del mismo día también');
  });

  test('T4.6 HALLAZGO · el otro factor del total del mes no se alineó: los guardias', async () => {
    /**
     * `montoDe()` es `precio_guardia × guardias`, y las DOS copias viven en el
     * movimiento. Se arregló la del precio y no la de los guardias, así que el
     * mismo defecto sigue abierto por el otro factor: se corrige una plantilla
     * mal capturada —veinte guardias donde había dos—, la ficha dice dos y el
     * «valor mensual que entra» de ese mes sigue cobrando veinte.
     *
     * No es un caso inventado: corregir `total_guardias` es uno de los seis
     * campos de `CAMPOS_CORREGIBLES` y es de lo que operaciones corrige a diario.
     */
    const id = await abrirId(operaciones, 'T4 GUARDIAS DOS LUGARES', {
      turnos: { '24 HRS': 20 },
      precio_guardia: '1000',
      fecha: '2026-08-10',
    });
    assert.equal(aperturasDe(id)[0].guardias, 20);

    const r = await correccionFormal(operaciones, id, {
      total_guardias: '2',
      turnos: { '24 HRS': 2 },
      motivo: 'Se capturaron veinte guardias donde había dos.',
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await ficha(id)).total_guardias, 2, 'la ficha ya dice dos');
    assert.equal(
      aperturasDe(id)[0].guardias,
      2,
      'y la copia del movimiento, que es el otro factor del total del mes, sigue diciendo veinte'
    );
  });
});

// ---------------------------------------------------------------------- T5

describe('T5 · el dinero', () => {
  test('T5.1 la basura ya no entra como importe de factura', async () => {
    const id = await abrirId(ventas, 'T5 BASURA IMPORTE', { precio_guardia: '1000' });
    for (const malo of ['0x10', '7e-3', '1e3', 'abc', [], {}, true]) {
      const r = await facturar(finanzas, {
        servicio_id: id,
        periodo: '2026-07',
        importe: malo,
        fecha_factura: '2026-07-31',
      });
      assert.equal(r.status, 400, `importe ${JSON.stringify(malo)} entró: ${r.texto}`);
    }
    const cuenta = await admin.pedir(`/api/facturas?servicio_id=${id}`);
    assert.equal(cuenta.json.facturas.length, 0, 'no se registró ninguna');
  });

  test('T5.2 HALLAZGO · un importe mal escrito se reinterpreta en silencio', async () => {
    /**
     * `numeroCapturado()` borra `$`, `%` y los espacios EN CUALQUIER POSICIÓN
     * antes de comprobar la forma del número. El propio módulo explica por qué
     * eso está mal —«se comprueban los grupos en vez de borrar las comas y ver
     * qué queda, porque borrarlas hacía que “1,2,3” acabara siendo 123: un
     * número mal escrito reinterpretado en silencio»— y acto seguido lo hace con
     * los otros tres caracteres. «1,2,3» se rechaza; «1 2 3» y «7$000» no.
     */
    const id = await abrirId(ventas, 'T5 REINTERPRETADO', { precio_guardia: '1000' });
    const casos = [
      ['1 2 3', 2026, '08'],
      ['7$000', 2026, '09'],
      ['7%000', 2026, '10'],
    ];
    const entraron = [];
    for (const [malo, , mes] of casos) {
      const r = await facturar(finanzas, {
        servicio_id: id,
        periodo: `2026-${mes}`,
        importe: malo,
        fecha_factura: `2026-${mes}-28`,
      });
      if (r.status === 201) {
        const guardada = conLaBase((db) =>
          db
            .prepare('SELECT importe FROM facturas WHERE servicio_id = ? AND periodo = ?')
            .get(Number(id), `2026-${mes}`)
        );
        entraron.push(`«${malo}» → ${guardada?.importe} pesos`);
      }
    }
    assert.deepEqual(
      entraron,
      [],
      `estos importes mal escritos se guardaron reinterpretados: ${entraron.join(' · ')}`
    );
  });

  test('T5.3 corregir una factura ya emitida: el importe, los guardias y el saldo', async () => {
    const id = await abrirId(ventas, 'T5 CORREGIR FACTURA', { precio_guardia: '1000' });
    const f = await facturar(finanzas, {
      servicio_id: id,
      periodo: '2026-11',
      importe: '10,000',
      guardias: 2,
      concepto: 'Noviembre',
      fecha_factura: '2026-11-30',
    });
    assert.equal(f.status, 201, f.texto);
    const facturaId = f.json.factura?.id ?? f.json.id;

    // Un pago parcial, para que el saldo tenga de dónde desacuadrarse.
    const pago = await moverFactura(finanzas, { id: facturaId, pago: { importe: '3,000', fecha: '2026-12-01' } });
    assert.equal(pago.status, 200, pago.texto);

    // Corregir por debajo de lo pagado no se permite.
    const abajo = await moverFactura(finanzas, {
      id: facturaId,
      correccion: { importe: '2,000', motivo: 'Estaba mal capturado el importe.' },
    });
    assert.equal(abajo.status, 400, abajo.texto);

    const ok = await moverFactura(finanzas, {
      id: facturaId,
      correccion: { importe: '$8,500.50', motivo: 'Estaba mal capturado el importe.' },
    });
    assert.equal(ok.status, 200, ok.texto);

    const cuenta = await admin.pedir(`/api/facturas?servicio_id=${id}`);
    const fac = cuenta.json.facturas.find((x) => x.id === facturaId);
    assert.equal(fac.importe, 8500.5);
    assert.equal(fac.importe_pagado, 3000);
    assert.equal(
      Math.round(((cuenta.json.resumen.saldo ?? cuenta.json.resumen.pendiente) - 5500.5) * 100) / 100,
      0,
      `el saldo cuadra: ${cuenta.texto}`
    );
  });

  test('T5.4 HALLAZGO · corregir los guardias facturados redondea en silencio', async () => {
    /**
     * Antes del cambio, `corregirFactura()` exigía entero:
     * `if (n !== null && (!Number.isInteger(n) || n < 0)) throw`. Ahora pasa por
     * `exigirDato('guardias', …)`, que redondea. «3.7 guardias» se guarda como 4
     * con un 200: un valor cambiado sin avisar en la columna que sirve para
     * contrastar lo facturado contra lo que está en la calle.
     */
    const id = await abrirId(ventas, 'T5 GUARDIAS FRACCIÓN', { precio_guardia: '1000' });
    const f = await facturar(finanzas, {
      servicio_id: id,
      periodo: '2026-06',
      importe: '10,000',
      guardias: 2,
      fecha_factura: '2026-06-30',
    });
    assert.equal(f.status, 201, f.texto);
    const facturaId = f.json.factura?.id ?? f.json.id;

    const r = await moverFactura(finanzas, {
      id: facturaId,
      correccion: { guardias: '3.7', motivo: 'Eran otros los guardias facturados.' },
    });
    assert.equal(r.status, 400, `«3.7 guardias» se aceptó y quedó en ${r.texto}`);
  });

  test('T5.5 los plazos: lo legítimo entra, lo absurdo se contesta', async () => {
    const id = await abrirId(ventas, 'T5 PLAZOS');
    assert.equal((await editar(finanzas, id, { dias_credito: '21' })).status, 200);
    assert.equal((await editar(finanzas, id, { dias_credito: '0' })).status, 200);
    assert.equal((await ficha(id)).dias_credito, 0);
    for (const malo of ['1,234.56', '-1', '366', 'abc', '0x10']) {
      const r = await editar(finanzas, id, { dias_credito: malo });
      assert.equal(r.status, 400, `«${malo}» entró como plazo: ${r.texto}`);
    }
    assert.equal((await ficha(id)).dias_credito, 0, 'y el plazo bueno sigue en pie');
  });

  test('T5.6 HALLAZGO · un plazo en blanco deja «de contado» sin decirlo', async () => {
    /**
     * `aplicarCondiciones()` hace `exigirDato('dias_credito', …) ?? 0`. Un plazo
     * mal tecleado ahora se contesta —eso es lo que se arregló—, pero un plazo
     * EN BLANCO sigue clavándose a cero, y por el alcance «todos» eso pone a
     * doscientos servicios en «de contado» con un 200 y sin un solo aviso. Es el
     * mismo fallo silencioso que el comentario dice haber cerrado.
     */
    const id = await abrirId(ventas, 'T5 CONDICIONES', { dias_credito: '30', esquema_facturacion: 'FIN_MES' });
    const r = await finanzas.pedir('/api/facturas/condiciones', {
      method: 'POST',
      body: JSON.stringify({
        esquema_facturacion: 'FIN_MES',
        dias_credito: '',
        forma_pago: cat.formasPago[0],
        alcance: 'seleccion',
        ids: [id],
      }),
    });
    assert.equal(r.status, 400, `un plazo en blanco se aceptó y dejó ${(await ficha(id)).dias_credito}: ${r.texto}`);
  });
});

// ---------------------------------------------------------------------- T6

describe('T6 · los caminos que no pasan por el sitio único', () => {
  test('T6.1 HALLAZGO · el desglose de turnos lee los números a la vieja', async () => {
    /**
     * `normalizarTurnos()` sigue haciendo `Number(v) || 0`, que es exactamente
     * lo que `numOrNull()` hacía y por lo que existe `lib/captura.js`. Y la suma
     * del desglose MANDA sobre `guardias`
     * (`sumaDesglose > 0 ? sumaDesglose : exigirDato('guardias', …)`), así que
     * por aquí se escribe `servicios.total_guardias` —la columna del invariante,
     * y un factor del «valor mensual que entra»— sin pasar por el sitio único:
     *
     *   · `'0x10'` → 16 guardias (el hexadecimal que el refactor vino a matar)
     *   · `2.5`    → dos guardias y medio
     *   · `1e9`    → mil millones, saltándose el tope de 10 000 de `exigirDato()`
     */
    const casos = [
      ['hexadecimal', { '24 HRS': '0x10' }],
      ['fracción', { '24 HRS': 2.5 }],
      ['tope de 10 000', { '24 HRS': 1e9 }],
      ['notación científica', { '24 HRS': '1e3' }],
    ];
    const entraron = [];
    for (const [que, turnos] of casos) {
      const r = await abrirCrudo(ventas, {
        tipo: 'APERTURA',
        servicio: unico(`T6 TURNOS ${que}`),
        zona: cat.zonas[0],
        asesor: cat.asesores[0],
        turnos,
      });
      if (r.status === 201) {
        const s = await ficha(r.json.servicioId);
        entraron.push(`${que}: ${JSON.stringify(Object.values(turnos)[0])} → ${s.total_guardias} guardias`);
      }
    }
    assert.deepEqual(entraron, [], `el desglose de turnos aceptó: ${entraron.join(' · ')}`);
  });

  test('T6.1b HALLAZGO · y esos guardias llegan al estado de fuerza y al valor del mes', async () => {
    /**
     * Lo que eleva el hallazgo anterior: `total_guardias` es la columna del
     * invariante —880 guardias— y `aperturas.guardias` es un factor directo de
     * `montoDe()`, o sea del «valor mensual que entra» que la pantalla de
     * Aperturas enseña. Mil millones de guardias a mil pesos cada uno son un
     * billón de pesos en un total que nadie puso.
     */
    const r = await abrirCrudo(ventas, {
      tipo: 'APERTURA',
      servicio: unico('T6 TURNOS TABLERO'),
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 1e9 },
      precio_guardia: '1000',
      fecha: '2026-09-15',
    });
    /**
     * El `201` de entrada era la condición previa del defecto, no un requisito:
     * esta prueba nació midiendo el daño DESPUÉS de que la captura pasara. Con
     * la puerta cerrada la petición se rechaza, así que exigir 201 pediría que
     * el defecto siguiera ahí.
     *
     * Lo que sí se exige, que es lo que la prueba vino a proteger: por el camino
     * que sea —rechazo en la puerta o tope al escribir—, mil millones de
     * guardias no pueden llegar a la ficha ni al «valor mensual que entra».
     */
    assert.ok([201, 400].includes(r.status), `ni creó ni rechazó: ${r.status} ${r.texto.slice(0, 200)}`);

    const pantalla = await admin.pedir('/aperturas?periodo=2026-09');
    const total = pantalla.texto
      .replace(/<!--[\s\S]*?-->/g, '')
      .match(/Valor mensual que entra<\/p>[\s\S]{0,300}?>(\$[\d,.]+)</);
    // Un total con trece cifras es el daño; se mide el texto de la pantalla y no
    // solo la columna, porque es ahí donde lo vería una persona.
    assert.ok(
      !total || total[1].replace(/[^\d]/g, '').length < 13,
      `el «valor mensual que entra» de 2026-09 dice ${total?.[1]}`
    );

    if (r.status === 201) {
      const s = await ficha(r.json.servicioId);
      assert.ok(Number(s.total_guardias) <= 10_000, `la ficha quedó con ${s.total_guardias} guardias`);
    }
  });

  test('T6.2 HALLAZGO · el desglose por puesto escribe dinero con su propio lector', async () => {
    /**
     * `lib/partidas.js` conserva `limpiarNumero()`, que es `numOrNull()` con
     * otro nombre: `Number(String(v).replace(/[$,\s]/g, ''))`. Y `guardarPartidas()`
     * ESCRIBE `servicios.importe_sin_iva` y `servicios.importe_factura` —las dos
     * columnas de dinero que `actualizarServicio()` ahora sí guarda—, así que es
     * un camino de escritura sobre `servicios` que se salta `exigirDato()`
     * entero. `'0x10'` vuelve a ser 16 pesos, y `'1e21'` entra tal cual.
     */
    const id = await abrirId(ventas, 'T6 PARTIDAS');
    const casos = [
      ['hexadecimal', '0x10'],
      ['notación científica', '1e21'],
      ['exponente negativo', '7e-3'],
      ['espacios de en medio', '1 2 3'],
    ];
    const entraron = [];
    for (const [que, precio] of casos) {
      const r = await guardarPartidas(admin, id, [
        { puesto: cat.puestos[0], cantidad: 1, precio_unitario: precio },
      ]);
      if (r.status === 200) {
        const s = await ficha(id);
        entraron.push(`${que}: «${precio}» → importe_sin_iva ${s.importe_sin_iva}`);
      }
    }
    assert.deepEqual(entraron, [], `el desglose por puesto aceptó: ${entraron.join(' · ')}`);
  });

  test('T6.2b HALLAZGO · y ese dinero llega al tablero y a la propuesta de factura', async () => {
    /**
     * Lo que eleva el hallazgo anterior: `importe_factura` no se queda en la
     * ficha. Lo suman `SUM(importe_factura)` del tablero y de los cortes, y es
     * el importe que cobranza ve PROPUESTO al facturar el mes. Es palabra por
     * palabra el daño que `TOPE_IMPORTE` dice atajar —«`1e21` entraba tal cual y
     * después salía en una propuesta de factura»— y sigue entrando, solo que por
     * el desglose por puesto en vez de por la ficha.
     */
    const id = await abrirId(ventas, 'T6 PARTIDAS TABLERO', {
      esquema_facturacion: 'FIN_MES',
      fecha: '2026-01-15',
    });
    const r = await guardarPartidas(admin, id, [
      { puesto: cat.puestos[0], cantidad: 1, precio_unitario: '1e21' },
    ]);
    /**
     * Igual que en T6.1b: el `200` de entrada era la condición previa del
     * defecto. Cerrada la puerta, el guardado se rechaza, y pedir 200 sería
     * pedir que el defecto siguiera ahí.
     *
     * Lo que se exige es el daño que esta prueba vino a impedir: por el camino
     * que sea, ese importe no puede acabar en la ficha ni —sobre todo— en la
     * propuesta que cobranza ve al facturar el mes.
     */
    assert.ok([200, 400].includes(r.status), `ni guardó ni rechazó: ${r.status} ${r.texto.slice(0, 200)}`);

    const s = await ficha(id);
    const tablero = await admin.pedir('/');
    const propuesta = await finanzas.pedir('/api/facturas?pendientes=1&periodo=2026-01');
    const mio = (propuesta.json.porFacturar || []).find((p) => p.id === id || p.servicio_id === id);

    assert.ok(
      Number(s.importe_factura || 0) <= 10_000_000,
      `la ficha quedó en ${s.importe_factura}; el tablero respondió ${tablero.status}`
    );
    assert.ok(
      !mio || Number(mio.importe || 0) <= 10_000_000,
      `la propuesta de cobranza dice ${mio?.importe}`
    );
  });

  test('T6.3 HALLAZGO · `aut_json` guarda lo que le manden, del tamaño que sea', async () => {
    /**
     * `aut_json` es el hueco que el coder nombró. Se comprueba qué entra de
     * verdad: una llave que no es ninguna de las siete autorizaciones, y un
     * volumen que nadie teclea.
     */
    const r = await abrirCrudo(ventas, {
      tipo: 'APERTURA',
      servicio: unico('T6 AUT'),
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 1 },
      aut: { inventada: 'x'.repeat(200000), __proto__: { polucion: 1 }, ventas: { quien: 'nadie' } },
    });
    assert.equal(r.status, 201, r.texto);
    const fila = conLaBase((db) =>
      db.prepare('SELECT aut_json FROM aperturas WHERE servicio_id = ? ORDER BY id DESC').get(Number(r.json.servicioId))
    );
    assert.ok(
      fila.aut_json.length < 10000,
      `aut_json guardó ${fila.aut_json.length} caracteres de una llave que no existe`
    );
  });

  test('T6.4 HALLAZGO · la carga de facturas por archivo no lleva tope de cordura', async () => {
    /**
     * La importación es el otro hueco nombrado, y la razón que se le da es
     * buena: un archivo se tolera como venga escrito. Pero el tope de cordura
     * no es una cuestión de formato. `cargarFacturas()` comprueba
     * `importe > 0` y nada más, así que por un CSV entra una factura de un
     * billón de pesos a la cartera vencida, que es el mismo `1e21` del que
     * `TOPE_IMPORTE` existe para defender —y que por la pantalla ya no entra—.
     */
    const id = await abrirId(ventas, 'T6 CARGA ARCHIVO');
    const csv = [
      'id,Servicio,Periodo,Concepto,Fecha de factura,Días de crédito,Importe,Folio fiscal,¿Pagada?,Fecha de pago',
      `${id},,2025-01,Mes completo,2025-01-31,"1,234.56",999999999999999,,no,`,
    ].join('\n');
    const r = await finanzas.pedir('/api/facturas/carga', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
    assert.equal(r.status, 200, r.texto);
    const guardada = conLaBase((db) =>
      db.prepare('SELECT importe, dias_credito FROM facturas WHERE servicio_id = ?').get(Number(id))
    );
    assert.equal(
      guardada,
      undefined,
      `entró una factura de ${guardada?.importe} pesos, y el plazo «1,234.56» se clavó en ` +
        `${guardada?.dias_credito} días sin decirlo: ${r.texto}`
    );
  });
});

// ---------------------------------------------------------------------- T6b

describe('T6b · la permisividad de la hora no se derramó', () => {
  test('T6b.1 la hora mal escrita se ignora y no tumba la captura (la reversión)', async () => {
    const r = await abrirCrudo(ventas, {
      tipo: 'APERTURA',
      servicio: unico('T6b HORA MALA'),
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 1 },
      hora_apertura: 'a las siete',
    });
    assert.equal(r.status, 201, r.texto);
    const fila = conLaBase((db) =>
      db.prepare('SELECT hora_apertura FROM aperturas WHERE servicio_id = ?').get(Number(r.json.servicioId))
    );
    assert.equal(fila.hora_apertura, null, 'no se guarda media hora');
  });

  test('T6b.2 ningún otro campo accesorio se ignora en silencio cuando viene mal', async () => {
    /**
     * `horaOpcional` es la única clase tolerante del módulo, y el desvío 2 fue
     * una reversión: hay que comprobar que no se derramó. Se mandan mal, uno por
     * uno, los demás datos accesorios del movimiento —los que no describen al
     * cliente ni al dinero y a los que sería tentador aplicarles la misma
     * excusa— y se exige que la captura se conteste en vez de guardarse sin
     * ellos.
     */
    const accesorios = {
      vehiculos_custodia: '0x10',
      credito_plazo: 'x'.repeat(501),
      reporta: 'x'.repeat(501),
      comentarios: 'x'.repeat(2001),
      fecha: '2026-02-31',
    };
    const silenciosos = [];
    for (const [campo, valor] of Object.entries(accesorios)) {
      const r = await abrirCrudo(ventas, {
        tipo: 'APERTURA',
        servicio: unico(`T6b ${campo}`),
        zona: cat.zonas[0],
        asesor: cat.asesores[0],
        turnos: { '24 HRS': 1 },
        [campo]: valor,
      });
      if (r.status === 201) {
        const fila = conLaBase((db) =>
          db.prepare('SELECT * FROM aperturas WHERE servicio_id = ?').get(Number(r.json.servicioId))
        );
        silenciosos.push(`${campo} → 201 y quedó «${String(fila[campo]).slice(0, 20)}»`);
      }
    }
    assert.deepEqual(silenciosos, [], `se ignoraron en silencio: ${silenciosos.join(' · ')}`);
  });
});

// ---------------------------------------------------------------------- T6c

describe('T6c · volumen, concurrencia y estado sucio', () => {
  test('T6c.1 volumen diez veces mayor: un lote de cien campos en una sola petición', async () => {
    const id = await abrirId(admin, 'T6c VOLUMEN');
    const cuerpo = {};
    // Los campos de verdad, repetidos con basura alrededor para medir que el
    // rechazo nombra el primero y no se guarda nada.
    for (let i = 0; i < 100; i += 1) cuerpo[`inventado_${i}`] = 'x'.repeat(1000);
    cuerpo.direccion = 'Dirección buena';
    const r = await editar(admin, id, cuerpo);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.rechazados.length, 100, 'los cien se nombran uno por uno');
    assert.equal((await ficha(id)).direccion, 'Dirección buena');
  });

  test('T6c.2 dos ediciones del mismo precio a la vez dejan la ficha y el movimiento de acuerdo', async () => {
    const id = await abrirId(ventas, 'T6c CONCURRENCIA', { precio_guardia: '1000' });
    const [a, b] = await Promise.all([
      editar(admin, id, { precio_guardia: '2000' }),
      editar(admin, id, { precio_guardia: '3000' }),
    ]);
    assert.ok([200, 409, 500].includes(a.status), a.texto);
    assert.ok([200, 409, 500].includes(b.status), b.texto);
    const s = await ficha(id);
    const movs = aperturasDe(id);
    assert.ok([2000, 3000].includes(s.precio_guardia), `la ficha quedó en ${s.precio_guardia}`);
    assert.equal(
      movs[0].precio_guardia,
      s.precio_guardia,
      `la ficha dice ${s.precio_guardia} y el movimiento ${movs[0].precio_guardia}`
    );
  });

  test('T6c.3 una captura que falla a la mitad no deja el servicio a medias', async () => {
    // El desglose por puesto se revisa ANTES de crear el servicio: si falla, no
    // tiene que quedar ni el servicio ni la apertura.
    const antes = conteos();
    const r = await abrirCrudo(ventas, {
      tipo: 'APERTURA',
      servicio: unico('T6c A MEDIAS'),
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      turnos: { '24 HRS': 1 },
      razon_social: 'x'.repeat(501),
    });
    assert.equal(r.status, 400, r.texto);
    assert.deepEqual(conteos(), antes, 'no quedó nada de la captura que falló');
  });
});

// ---------------------------------------------------------------------- T7

describe('T7 · la derivación de las reglas, atacada por su fuente', () => {
  test('T7.1 los ocho campos de catálogo salen de cruzar CAMPOS con TIPOS, y aciertan', async () => {
    const id = await abrirId(admin, 'T7 CATÁLOGOS');
    const paresBuenos = {
      zona: cat.zonas[0],
      asesor: cat.asesores[0],
      gerente: cat.gerentes[0],
      supervisor: cat.supervisores[0],
      estado_geo: cat.estados[0],
      tipo_repse: cat.tiposRepse[0],
      uniforme: cat.uniformes[0],
      forma_pago: cat.formasPago[0],
    };
    for (const [campo, valor] of Object.entries(paresBuenos)) {
      assert.ok(valor, `el catálogo de «${campo}» tiene valores sembrados`);
      const r = await editar(admin, id, { [campo]: valor });
      assert.equal(r.status, 200, `«${campo}» = «${valor}» debería entrar: ${r.texto}`);
      const malo = await editar(admin, id, { [campo]: 'VALOR QUE NO EXISTE EN NINGÚN CATÁLOGO' });
      assert.equal(malo.status, 400, `«${campo}» aceptó un valor fuera de catálogo: ${malo.texto}`);
      assert.equal((await ficha(id))[campo], valor);
    }
  });

  test('T7.2 un valor retirado del catálogo no obliga a arreglarlo para guardar otra cosa', async () => {
    const id = await abrirId(admin, 'T7 RETIRADO', { zona: cat.zonas[0] });
    const zona = cat.zonas[0];
    // Se retira la zona del catálogo (como hizo la operación con «Centro»).
    conLaBase((db) => db.prepare('UPDATE catalogos SET activo = 0 WHERE tipo = ? AND valor = ?').run('zona', zona));
    try {
      const r = await editar(admin, id, { direccion: 'Otra dirección', zona });
      assert.equal(r.status, 200, `guardar otra cosa no debería exigir arreglar la zona: ${r.texto}`);
      assert.equal((await ficha(id)).zona, zona);
    } finally {
      conLaBase((db) => db.prepare('UPDATE catalogos SET activo = 1 WHERE tipo = ? AND valor = ?').run('zona', zona));
    }
  });

  test('T7.3 HALLAZGO · el tope de las plantillas no alcanza a los guardias facturados', async () => {
    /**
     * `TOPE_GUARDIAS` (10 000) se aplica por la clase `guardias`, que solo tienen
     * `total_guardias` y `guardias` (de `FUERA_DE_LA_FICHA`). `guardias_en_factura`
     * está en `CAMPOS` con `tipo: 'int'`, así que la derivación le da la clase
     * `entero` y el tope de los importes: diez millones. Es la misma pregunta
     * —cuántos guardias— con dos respuestas distintas según por qué columna se
     * pregunte, y la columna suelta es justo la que sirve para conciliar lo
     * facturado contra lo que está en la calle.
     */
    const id = await abrirId(admin, 'T7 GUARDIAS FACTURA');
    const r = await editar(finanzas, id, { guardias_en_factura: '5000000' });
    assert.equal(r.status, 400, `cinco millones de guardias en factura entraron: ${r.texto}`);
  });

  test('T7.4 el tope de las plantillas sí se aplica donde la clase lo dice', async () => {
    const id = await abrirId(admin, 'T7 TOPE PLANTILLA');
    const r = await correccionFormal(admin, id, {
      total_guardias: '10001',
      motivo: 'Intento de plantilla imposible.',
    });
    assert.equal(r.status, 400, r.texto);
  });

  test('T7.5 HALLAZGO · «sí/no» en nulo tumba una edición que antes funcionaba', async () => {
    /**
     * La clase `siNo` se juzga ANTES del «no llegó nada», y `loQueNoEsUnDato(null)`
     * contesta «un objeto» porque `typeof null === 'object'`. Antes,
     * `actualizarServicio()` hacía `limpio[k] = v ? 1 : 0`, así que
     * `tiene_contrato: null` quedaba en 0. Ahora es un 400 con el mensaje «se
     * contesta sí o no, y llegó un objeto», que además es falso: lo que llegó fue
     * un nulo. Lo mismo le pasa a cualquier campo `bool` que un cliente de la API
     * mande en nulo —la propia pantalla de contratos manda nulo para las fechas
     * por este mismo PATCH—.
     */
    const id = await abrirId(admin, 'T7 BOOL NULO');
    const r = await editar(juridico, id, {
      tiene_contrato: null,
      fecha_contrato: null,
      fecha_vencimiento_contrato: null,
    });
    assert.notEqual(r.status, 400, `tiene_contrato en nulo se rechazó: ${r.texto}`);
  });

  test('T7.6 HALLAZGO · un tipo de control que el validador no conozca no se valida', async () => {
    /**
     * `claseDe()` hace `CLASE_POR_TIPO[tipo] || 'texto'` y el comentario de al
     * lado dice que texto «es lo más estrecho que se puede hacer sin inventar
     * una regla». Es lo contrario: `texto` es la clase MÁS ANCHA del módulo
     * —cualquier cosa de hasta 500 caracteres—, así que un campo que la pantalla
     * pinte con un control nuevo queda sin validar y sin que nadie se entere.
     * Es el precio de derivar las reglas de su fuente, y la derivación falla
     * abierta en vez de cerrada.
     *
     * Se prueba al nivel del módulo porque lo que se ataca es la fuente de la
     * derivación: se le añade a `CAMPOS` —en esta copia en memoria, no en el
     * archivo— un campo con un tipo que `CLASE_POR_TIPO` no conoce.
     */
    const { register } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const resolver = new URL('./_resolver-sin-extension.mjs', import.meta.url);
    register(resolver);

    const { CAMPOS } = await import('../lib/campos.js');
    const { exigirDato } = await import(pathToFileURL('/home/user/Ultra2025/lib/captura.js').href);

    CAMPOS.hora_del_servicio = { etiqueta: 'Hora del servicio', tipo: 'time' };
    let resultado;
    try {
      resultado = exigirDato('hora_del_servicio', 'a las siete de la tarde más o menos');
    } catch (e) {
      resultado = `ERR: ${e.message}`;
    } finally {
      delete CAMPOS.hora_del_servicio;
    }
    assert.match(
      String(resultado),
      /^ERR:/,
      `un tipo de control desconocido aceptó «${resultado}» en vez de contestar`
    );
  });
});

// ---------------------------------------------------------------------- T8

describe('T8 · fallo silencioso e invariantes', () => {
  test('T8.1 un rechazo se ve: no hay 200 que no guarde ni 200 que guarde otra cosa', async () => {
    const id = await abrirId(ventas, 'T8 SILENCIO');
    // Un lote donde un campo es basura: no se guarda NADA y se dice cuál.
    const r = await completar(ventas, id, { precio_guardia: '0x10', dias_credito: '30' });
    assert.equal(r.status, 400, r.texto);
    const s = await ficha(id);
    assert.equal(s.precio_guardia, null, 'el lote no se guardó a medias');
    assert.equal(s.dias_credito, null, 'ni el campo bueno del lote');
    assert.match(r.json.error, /Precio por guardia/, `el error nombra el campo: ${r.texto}`);
  });

  test('T8.2 un campo que el panel no ofrece se contesta, no se calla', async () => {
    const id = await abrirId(ventas, 'T8 RECHAZADOS');
    const r = await completar(ventas, id, { inventado: 'x', precio_guardia: '1000' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.rechazados, ['inventado'], `la respuesta nombra lo que no reconoció: ${r.texto}`);
  });

  test('T8.3 un texto demasiado largo se avisa, nunca se recorta', async () => {
    const id = await abrirId(admin, 'T8 TRUNCADO');
    const largo = 'Á'.repeat(501);
    const r = await editar(admin, id, { direccion: largo });
    assert.equal(r.status, 400, r.texto);
    assert.equal((await ficha(id)).direccion, null, 'ni media dirección guardada');

    const justo = 'Ñ'.repeat(500);
    const ok = await editar(admin, id, { direccion: justo });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await ficha(id)).direccion, justo, 'el tope exacto entra entero');
  });

  test('T8.4 correr dos veces lo mismo no deja estado sucio', async () => {
    const id = await abrirId(ventas, 'T8 DOS VECES');
    const a = await completar(ventas, id, { precio_guardia: '1,500' });
    assert.equal(a.status, 200, a.texto);
    const b = await completar(ventas, id, { precio_guardia: '1,500' });
    assert.equal(b.status, 200, b.texto);
    assert.deepEqual(b.json.llenados, {}, 'la segunda no vuelve a llenar');
    assert.deepEqual(b.json.yaTenian, ['precio_guardia']);
    assert.equal((await ficha(id)).precio_guardia, 1500);
  });

  test('T8.5 inyección y rutas hacia arriba no pasan por el sitio único', async () => {
    const id = await abrirId(admin, 'T8 INYECCIÓN');
    const sucios = [
      "'; DROP TABLE servicios; --",
      '../../etc/passwd',
      '<script>alert(1)</script>',
      '${7*7}',
    ];
    for (const sucio of sucios) {
      const r = await editar(admin, id, { direccion: sucio });
      assert.equal(r.status, 200, r.texto);
      assert.equal((await ficha(id)).direccion, sucio, 'se guarda literal, sin interpretarse');
    }
    assert.equal(conteos().servicios > 0, true, 'las tablas siguen ahí');
  });

  test('T8.6 los invariantes: lo que hay es lo sembrado más lo que estas pruebas abrieron', async () => {
    const ahora = conteos();
    const abiertas = ahora.aperturas - base0.aperturas;
    const canceladas = ahora.cancelaciones - base0.cancelaciones;
    assert.ok(abiertas > 0, 'estas pruebas abrieron movimientos');
    // Ni un servicio, guardia, apertura o cancelación aparecido de la nada: el
    // delta de aperturas y cancelaciones explica el de servicios.
    const serviciosNuevos = ahora.servicios - base0.servicios;
    assert.ok(
      serviciosNuevos <= abiertas,
      `aparecieron ${serviciosNuevos} servicios con ${abiertas} aperturas`
    );
    assert.equal(canceladas >= 1, true, 'la cancelación de T1 quedó registrada');
  });
});
