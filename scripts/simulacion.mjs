#!/usr/bin/env node
/**
 * Simula un mes de operación real contra la plataforma y comprueba que las
 * cuentas cierren.
 *
 *   npm run simular            # contra http://localhost:3000
 *   BASE=http://localhost:3210 npm run simular
 *
 * No es una prueba unitaria: es el ensayo que uno haría antes de poner esto en
 * manos de la operación. Los cinco roles entran, hacen su trabajo, intentan
 * hacer lo que no les toca, y al final se comprueba la única igualdad que
 * importa:
 *
 *     guardias al inicio + altas − bajas = guardias al final
 *
 * Si esa resta no cuadra, alguien movió el estado de fuerza por fuera de las
 * aperturas y cancelaciones, que es justo lo que la plataforma existe para
 * impedir.
 */

const BASE = process.env.BASE || 'http://localhost:3000';
const PASSWORD = process.env.SIM_PASSWORD || 'UltraGuardias2026';

const CUENTAS = {
  admin: 'admin@corporativoultra.com',
  juridico: 'juridico@corporativoultra.com',
  finanzas: 'finanzas@corporativoultra.com',
  operaciones: 'operaciones@corporativoultra.com',
  ventas: 'ventas@corporativoultra.com',
};

// ------------------------------------------------------------------ salida

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  mal: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  fuerte: (s) => `\x1b[1m${s}\x1b[0m`,
};

let fallos = 0;
const bitacoraLocal = [];

function paso(quien, texto, detalle = '') {
  bitacoraLocal.push({ quien, texto, detalle });
  console.log(`  ${c.dim(quien.padEnd(12))} ${texto}${detalle ? ' ' + c.dim(detalle) : ''}`);
}

function comprobar(condicion, texto, extra = '') {
  if (condicion) {
    console.log(`  ${c.ok('✓')} ${texto}${extra ? ' ' + c.dim(extra) : ''}`);
  } else {
    fallos++;
    console.log(`  ${c.mal('✗')} ${texto}${extra ? ' ' + c.dim(extra) : ''}`);
  }
}

function titulo(t) {
  console.log(`\n${c.fuerte(t)}`);
  console.log(c.dim('─'.repeat(Math.max(t.length, 60))));
}

const dinero = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);

// ------------------------------------------------------------------ cliente

async function entrar(rol) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CUENTAS[rol], password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`No se pudo entrar como ${rol}: ${r.status}`);
  const cookie = (r.headers.getSetCookie?.() || []).map((s) => s.split(';')[0]).join('; ');

  return {
    rol,
    async pedir(ruta, opciones = {}) {
      const res = await fetch(BASE + ruta, {
        ...opciones,
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', cookie, ...(opciones.headers || {}) },
      });
      const texto = await res.text();
      let json = null;
      try {
        json = JSON.parse(texto);
      } catch {
        /* HTML */
      }
      return { status: res.status, json, texto, headers: res.headers };
    },
  };
}

const estado = async (cli) => {
  const r = await cli.pedir('/api/servicios?estatus=ACTIVO');
  const s = r.json.servicios;
  return {
    servicios: s.length,
    guardias: s.reduce((a, x) => a + (x.total_guardias || 0), 0),
    facturacion: s.reduce((a, x) => a + (x.importe_factura || 0), 0),
  };
};

// ------------------------------------------------------------------ guion

/** Servicios que la operación abre este mes. Datos verosímiles, no reales. */
const APERTURAS_VENTAS = [
  {
    servicio: 'PLAZA SATELITE TORRE B',
    razon_social: 'ADMINISTRADORA PLAZA SATELITE SA DE CV',
    zona: 'NORTE',
    asesor: 'YESSICA RAMIREZ',
    direccion: 'Circuito Centro Comercial 2251, Naucalpan',
    turnos: { '24X24': 4, '12X12 L-D': 2 },
    precio_guardia: 19800,
  },
  {
    servicio: 'CEDIS TEXCOCO ORIENTE',
    razon_social: 'LOGISTICA INTEGRAL DEL VALLE SA DE CV',
    zona: 'NORTE',
    asesor: 'ISAI ALVARADO',
    direccion: 'Carretera Texcoco-Lechería km 14',
    turnos: { '12X36': 8 },
    precio_guardia: 18200,
  },
  {
    servicio: 'RESIDENCIAL BOSQUE REAL',
    razon_social: 'CONDOMINIO BOSQUE REAL',
    zona: 'SUR',
    asesor: 'HUMBERTO MARTINEZ',
    direccion: 'Blvd. Bosque Real 200, Huixquilucan',
    turnos: { '24X24': 3 },
    precio_guardia: 21500,
  },
];

async function main() {
  console.log(c.fuerte('\n  SIMULACIÓN DE UN MES DE OPERACIÓN — ULTRA SEGURIDAD PRIVADA'));
  console.log(c.dim(`  ${BASE}\n`));

  // --------------------------------------------------------------- acceso
  titulo('1 · Los cinco roles entran a la plataforma');
  const s = {};
  for (const rol of Object.keys(CUENTAS)) {
    s[rol] = await entrar(rol);
    paso(rol, 'inició sesión');
  }

  const inicial = await estado(s.admin);
  console.log(
    `\n  Estado de fuerza al abrir el mes: ${c.fuerte(inicial.servicios + ' servicios')} · ` +
      `${c.fuerte(inicial.guardias + ' guardias')} · ${dinero(inicial.facturacion)}`
  );

  // Foto de un corte cerrado, para comprobar al final que no se movió.
  const corteAntes = await s.admin.pedir('/api/cortes/2026-01');
  const huellaCorteAntes = corteAntes.texto.length;

  let altas = 0;
  let bajas = 0;
  const nuevos = [];

  // ------------------------------------------------------------- ventas
  titulo('2 · Ventas abre los servicios que cerró en el mes');
  for (const a of APERTURAS_VENTAS) {
    const r = await s.ventas.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ ...a, tipo: 'APERTURA', fecha: '2026-08-03' }),
    });
    const g = Object.values(a.turnos).reduce((x, y) => x + y, 0);
    comprobar(r.status === 201, `apertura de ${a.servicio}`, `${g} guardias · folio ${r.json?.folio || '—'}`);
    if (r.status === 201) {
      altas += g;
      nuevos.push({ ...a, id: r.json.servicioId, guardias: g });
    }
  }

  // ---------------------------------------------------------- operaciones
  titulo('3 · Operaciones ajusta la plantilla');

  const objetivo = nuevos[0];
  const inc = await s.operaciones.pedir('/api/aperturas', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'INCREMENTO',
      servicio_id: objetivo.id,
      turnos: { '24X24': 2 },
      fecha: '2026-08-11',
      comentarios: 'El cliente pidió cubrir el estacionamiento',
    }),
  });
  comprobar(inc.status === 201, `incremento en ${objetivo.servicio}`, '+2 guardias');
  if (inc.status === 201) altas += 2;

  const red = await s.operaciones.pedir('/api/cancelaciones', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'REDUCCION',
      servicio_id: nuevos[1].id,
      guardias: 3,
      motivo: 'AJUSTE DE TURNOS SOLICITADO POR EL CLIENTE',
      fecha: '2026-08-18',
    }),
  });
  comprobar(red.status === 201, `reducción en ${nuevos[1].servicio}`, '−3 guardias');
  if (red.status === 201) bajas += 3;

  // Una reducción que se llevaría todo debe rechazarse.
  const excesiva = await s.operaciones.pedir('/api/cancelaciones', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'REDUCCION',
      servicio_id: nuevos[2].id,
      guardias: nuevos[2].guardias,
      motivo: 'PRUEBA',
    }),
  });
  comprobar(
    excesiva.status === 400 && /cancelaci/i.test(excesiva.json?.error || ''),
    'una reducción que se lleva todos los guardias se rechaza',
    excesiva.json?.error?.slice(0, 60)
  );

  const baja = await s.operaciones.pedir('/api/cancelaciones', {
    method: 'POST',
    body: JSON.stringify({
      tipo: 'CANCELACION',
      servicio_id: nuevos[2].id,
      motivo: 'EL CLIENTE CONTRATO SEGURIDAD PROPIA',
      fecha: '2026-08-25',
    }),
  });
  comprobar(baja.status === 201, `cancelación de ${nuevos[2].servicio}`, `−${nuevos[2].guardias} guardias`);
  if (baja.status === 201) bajas += nuevos[2].guardias;

  // --------------------------------------------------------------- jurídico
  titulo('4 · Jurídico registra los contratos');
  const contrato = await s.juridico.pedir(`/api/servicios/${nuevos[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tiene_contrato: true,
      fecha_contrato: '2026-08-05',
      fecha_vencimiento_contrato: '2027-08-05',
      condiciones_comerciales: 'A los 15 días de cada mes',
    }),
  });
  comprobar(contrato.status === 200, `contrato de ${nuevos[0].servicio} a un año`);
  paso('jurídico', 'registró contrato', Object.keys(contrato.json?.cambios || {}).join(', '));

  const juridicoFactura = await s.juridico.pedir(`/api/servicios/${nuevos[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ importe_factura: 500000 }),
  });
  comprobar(juridicoFactura.status === 403, 'jurídico NO puede tocar la factura', juridicoFactura.json?.error?.slice(0, 55));

  // --------------------------------------------------------------- finanzas
  titulo('5 · Finanzas factura y da seguimiento a la cobranza');
  for (const nv of nuevos.slice(0, 2)) {
    const actual = await s.admin.pedir(`/api/servicios/${nv.id}`);
    const guardias = actual.json.servicio.total_guardias;
    const importe = Math.round(guardias * nv.precio_guardia * 1.16);
    const r = await s.finanzas.pedir(`/api/servicios/${nv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        importe_factura: importe,
        importe_sin_iva: Math.round(guardias * nv.precio_guardia),
        guardias_en_factura: guardias,
        facturado: true,
        status_cobranza: 'POR COBRAR',
        dias_credito: 30,
      }),
    });
    comprobar(r.status === 200, `factura de ${nv.servicio}`, `${guardias} guardias · ${dinero(importe)}`);
  }

  const finanzasContrato = await s.finanzas.pedir(`/api/servicios/${nuevos[1].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fecha_vencimiento_contrato: '2030-01-01' }),
  });
  comprobar(finanzasContrato.status === 403, 'finanzas NO puede mover fechas de contrato', finanzasContrato.json?.error?.slice(0, 55));

  // ----------------------------------------------------------------- admin
  titulo('6 · El administrador corrige datos de los tres bloques');
  const mixto = await s.admin.pedir(`/api/servicios/${nuevos[1].id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      supervisor: 'OCTAVIO ESPARZA',
      condiciones_comerciales: 'A mes vencido',
      status_cobranza: 'PAGADO',
    }),
  });
  comprobar(
    mixto.status === 200 && Object.keys(mixto.json.cambios).length === 3 && mixto.json.rechazados.length === 0,
    'el admin edita operativo + contrato + cobranza en una sola petición'
  );

  // ------------------------------------------------------------ invariante
  titulo('7 · Nadie puede saltarse la regla');
  for (const rol of Object.keys(CUENTAS)) {
    const alta = await s[rol].pedir('/api/servicios', {
      method: 'POST',
      body: JSON.stringify({ servicio: 'ALTA POR LA PUERTA DE ATRÁS', total_guardias: 50 }),
    });
    const bajaDirecta = await s[rol].pedir(`/api/servicios/${nuevos[0].id}`, { method: 'DELETE' });
    comprobar(
      alta.status === 405 && bajaDirecta.status === 405,
      `${rol} no puede dar de alta ni borrar un servicio directamente`
    );
  }

  const forzarEstatus = await s.admin.pedir(`/api/servicios/${nuevos[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ estatus: 'BAJA', total_guardias: 0 }),
  });
  comprobar(forzarEstatus.status === 403, 'ni el admin puede poner un servicio en BAJA a mano');

  for (const rol of ['juridico', 'finanzas']) {
    const r = await s[rol].pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ servicio: 'NO DEBE ENTRAR', tipo: 'APERTURA', guardias: 5 }),
    });
    comprobar(r.status === 403, `${rol} no registra aperturas`);
  }
  for (const rol of ['ventas', 'operaciones']) {
    const r = await s[rol].pedir(`/api/servicios/${nuevos[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ importe_factura: 1 }),
    });
    comprobar(r.status === 403, `${rol} no edita la ficha del servicio`);
  }

  // --------------------------------------------------------------- cuentas
  titulo('8 · Las cuentas del mes');
  const final = await estado(s.admin);
  const esperado = inicial.guardias + altas - bajas;

  console.log(`
  Guardias al abrir el mes      ${String(inicial.guardias).padStart(6)}
  Altas por aperturas           ${c.ok('+' + String(altas).padStart(5))}
  Bajas por cancelaciones       ${c.mal('−' + String(bajas).padStart(5))}
  ${c.dim('─'.repeat(38))}
  Esperado al cerrar            ${String(esperado).padStart(6)}
  Guardias que reporta la app   ${String(final.guardias).padStart(6)}
`);
  comprobar(final.guardias === esperado, 'la resta cuadra: el estado de fuerza solo se movió por movimientos');
  comprobar(
    final.servicios === inicial.servicios + APERTURAS_VENTAS.length - 1,
    'el conteo de servicios cuadra',
    `${inicial.servicios} + ${APERTURAS_VENTAS.length} altas − 1 baja = ${final.servicios}`
  );

  // ------------------------------------------------------------- bitácora
  titulo('9 · Todo quedó registrado');
  const bit = await s.admin.pedir('/bitacora');
  for (const quien of ['Ventas Ultra', 'Operaciones Ultra', 'Jurídico Ultra', 'Finanzas Ultra', 'Administrador Ultra']) {
    comprobar(bit.texto.includes(quien), `la bitácora registra a ${quien}`);
  }
  comprobar(bit.texto.includes('PLAZA SATELITE TORRE B'), 'la bitácora nombra el servicio abierto');

  const bitVentas = await s.ventas.pedir('/bitacora');
  comprobar(/Sin permiso/.test(bitVentas.texto), 'ventas no alcanza la bitácora');

  // ----------------------------------------------------- cortes cerrados
  titulo('10 · Los cortes cerrados no se movieron');
  const corteDespues = await s.admin.pedir('/api/cortes/2026-01');
  comprobar(
    corteDespues.texto.length === huellaCorteAntes,
    'el corte de enero 2026 es idéntico después de un mes de operación',
    `${huellaCorteAntes} bytes`
  );
  for (const metodo of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const r = await s.admin.pedir('/api/cortes/2026-01', { method: metodo, body: '{}' });
    comprobar([404, 405].includes(r.status), `${metodo} sobre un corte cerrado no existe`, `HTTP ${r.status}`);
  }

  // ------------------------------------------------------------ descargas
  titulo('11 · Facturación se lleva su archivo');
  const csv = await s.finanzas.pedir('/api/cortes/actual');
  const lineas = csv.texto.trim().split('\r\n');
  comprobar(csv.status === 200, 'el CSV del mes en curso descarga');
  comprobar(
    lineas.length === final.servicios + 1,
    'el CSV trae un renglón por servicio activo más el encabezado',
    `${lineas.length - 1} servicios`
  );
  comprobar(lineas[0].split(';').length === 24, 'el CSV trae las 24 columnas de facturación y contrato');

  // ------------------------------------------------------------ resumen
  console.log('');
  console.log(c.dim('═'.repeat(62)));
  if (fallos === 0) {
    console.log(c.ok(c.fuerte('  Simulación completa sin un solo fallo.')));
    console.log(
      `  ${inicial.guardias} → ${final.guardias} guardias · ` +
        `${inicial.servicios} → ${final.servicios} servicios · ` +
        `${dinero(final.facturacion)} facturados`
    );
  } else {
    console.log(c.mal(c.fuerte(`  ${fallos} comprobación(es) fallaron.`)));
  }
  console.log(c.dim('═'.repeat(62)) + '\n');

  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(c.mal(`\n  La simulación no pudo correr: ${e.message}`));
  console.error(c.dim('  ¿Está levantado el servidor? Prueba `npm run start` en otra terminal.\n'));
  process.exit(1);
});
