/**
 * Respaldos: que existan, que sirvan, y que restaurarlos devuelva la operación.
 *
 * Un respaldo que nadie ha restaurado nunca es una promesa, no un respaldo. Por
 * eso aquí no basta con que el archivo se genere: se cambia la operación
 * después de hacerlo, se restaura, y se comprueba que lo capturado en medio
 * desapareció y lo de antes volvió. Es la única prueba que de verdad importa.
 *
 * Y se prueba también lo que NO debe pasar: que un archivo cualquiera no pueda
 * reemplazar la base, que la palabra de confirmación no sea decorativa, y que
 * un nombre con `../` no pueda bajarse cualquier archivo del servidor.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, ROLES } from './servidor.mjs';

let app;
let admin;
let finanzas;

/** Baja un respaldo y lo deja en disco para poder abrirlo con `unzip`. */
async function bajar(nombre) {
  const r = await fetch(`${app.base}/api/respaldos/${nombre}`, { headers: { cookie: admin.cookie } });
  assert.equal(r.status, 200, `no se pudo bajar ${nombre}`);
  const datos = Buffer.from(await r.arrayBuffer());
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-zip-')), nombre);
  fs.writeFileSync(ruta, datos);
  return { ruta, datos };
}

const activos = async () => (await admin.pedir('/api/servicios?estatus=ACTIVO')).json.servicios;

before(async () => {
  app = await arrancar();
  admin = await app.entrarYAsentar(ROLES.admin);
  finanzas = await app.entrarYAsentar(ROLES.finanzas);
});

after(async () => {
  await app?.cerrar();
});

describe('hacer un respaldo', () => {
  test('la plataforma arranca con al menos uno hecho por ella sola', async () => {
    // La agenda lo hace sola al primer uso de la base; si tardara, lo forzamos.
    let e = (await admin.pedir('/api/respaldos')).json;
    if (!e.respaldos.length) {
      await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({}) });
      e = (await admin.pedir('/api/respaldos')).json;
    }
    assert.ok(e.respaldos.length > 0);
    assert.ok(e.estado.ultimo, 'el estado dice cuál fue el último');
    assert.equal(e.estado.alDia, true, 'recién hecho, tiene que estar al día');
  });

  test('el archivo es un ZIP de verdad, con la base y el manifiesto', async () => {
    const hecho = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(hecho.status, 201, hecho.texto);
    assert.ok(hecho.json.bytes > 10000, 'un respaldo con la base entera no puede pesar tan poco');

    const { ruta } = await bajar(hecho.json.nombre);
    // Que lo abra el `unzip` del sistema es la prueba que importa: el
    // administrador lo va a abrir con doble clic en su computadora.
    execFileSync('unzip', ['-t', ruta]);
    const dentro = execFileSync('unzip', ['-Z1', ruta]).toString().trim().split('\n');
    assert.ok(dentro.includes('ultra.db'), 'trae la base');
    assert.ok(dentro.includes('respaldo.json'), 'trae el manifiesto');

    const manifiesto = JSON.parse(execFileSync('unzip', ['-p', ruta, 'respaldo.json']).toString());
    const cuantos = (await activos()).length;
    assert.equal(manifiesto.conteos.servicios, cuantos, 'el manifiesto cuenta lo que hay');
    assert.ok(manifiesto.conteos.facturas >= 0);
    assert.equal(manifiesto.motivo, 'manual');
    assert.equal(manifiesto.completo, true, 'el que pide una persona siempre va completo');
  });

  test('la base que trae dentro se puede abrir y consultar', async () => {
    const hecho = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({}) });
    const { ruta } = await bajar(hecho.json.nombre);
    const dir = path.dirname(ruta);
    execFileSync('unzip', ['-o', '-q', ruta, 'ultra.db', '-d', dir]);

    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(dir, 'ultra.db'), { readonly: true });
    const n = db.prepare("SELECT COUNT(*) AS n FROM servicios WHERE estatus = 'ACTIVO'").get().n;
    db.close();
    assert.equal(n, (await activos()).length);
  });
});

describe('quién puede tocarlos', () => {
  test('finanzas no hace respaldos ni se los baja', async () => {
    assert.equal((await finanzas.pedir('/api/respaldos')).status, 403);
    assert.equal((await finanzas.pedir('/api/respaldos', { method: 'POST', body: '{}' })).status, 403);
    const lista = (await admin.pedir('/api/respaldos')).json.respaldos;
    assert.equal((await finanzas.pedir(`/api/respaldos/${lista[0].nombre}`)).status, 403);
  });

  test('sin sesión tampoco', async () => {
    const r = await app.anonimo().pedir('/api/respaldos');
    assert.ok(r.status === 401 || r.status === 307, `esperaba 401/307 y fue ${r.status}`);
  });

  test('un nombre inventado no baja nada del servidor', async () => {
    for (const malo of ['../../lib/schema.sql', 'ultra.db', 'respaldo-2026-01-01-0000-otro-completo.zip', 'respaldo-2026-01-01-0000-manual.zip']) {
      const r = await admin.pedir(`/api/respaldos/${encodeURIComponent(malo)}`);
      assert.equal(r.status, 400, `${malo} no debería bajarse`);
    }
  });
});

describe('restaurar', () => {
  test('devuelve la operación a como estaba, y lo de en medio se va', async () => {
    const antes = (await activos()).length;

    // 1. Se guarda el estado de hoy.
    const respaldo = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(respaldo.status, 201);
    const { datos } = await bajar(respaldo.json.nombre);

    // 2. Se abre un servicio que en ese respaldo no existe.
    const alta = await admin.pedir('/api/aperturas', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'APERTURA', servicio: 'SERVICIO DESPUES DEL RESPALDO', turnos: { '24 HRS': 3 } }),
    });
    assert.equal(alta.status, 201);
    assert.equal((await activos()).length, antes + 1);

    // 3. Se restaura.
    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([datos], { type: 'application/zip' }), respaldo.json.nombre);
    cuerpo.append('confirmacion', 'RESTAURAR');
    const r = await fetch(`${app.base}/api/respaldos`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
      body: cuerpo,
    });
    const salida = await r.json();
    assert.equal(r.status, 200, JSON.stringify(salida));
    assert.ok(salida.respaldoPrevio, 'antes de restaurar guarda lo que había');

    // 4. El servicio de en medio ya no está, y la cuenta volvió a la de antes.
    const despues = await activos();
    assert.equal(despues.length, antes);
    assert.equal(despues.some((s) => s.servicio === 'SERVICIO DESPUES DEL RESPALDO'), false);

    // 5. Y la sesión sigue viva: los usuarios venían dentro del respaldo.
    assert.equal((await admin.pedir('/api/respaldos')).status, 200);
  });

  test('el respaldo previo queda guardado y se distingue', async () => {
    const lista = (await admin.pedir('/api/respaldos')).json.respaldos;
    const previo = lista.find((r) => r.motivo === 'antes-de-restaurar');
    assert.ok(previo, 'tiene que existir el respaldo de vuelta atrás');
    assert.equal(previo.motivoTexto, 'Antes de restaurar');
  });

  test('sin escribir RESTAURAR no se restaura', async () => {
    const lista = (await admin.pedir('/api/respaldos')).json.respaldos;
    const { datos } = await bajar(lista[0].nombre);
    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([datos]), lista[0].nombre);
    cuerpo.append('confirmacion', 'si');
    const r = await fetch(`${app.base}/api/respaldos`, { method: 'POST', headers: { cookie: admin.cookie }, body: cuerpo });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /RESTAURAR/);
  });

  test('un archivo que no es respaldo no reemplaza nada', async () => {
    const antes = (await activos()).length;
    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([Buffer.from('esto no es un zip, es un recado')]), 'cualquier.zip');
    cuerpo.append('confirmacion', 'RESTAURAR');
    const r = await fetch(`${app.base}/api/respaldos`, { method: 'POST', headers: { cookie: admin.cookie }, body: cuerpo });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /no se puede leer|ZIP/i);
    assert.equal((await activos()).length, antes, 'la operación siguió intacta');
  });

  test('un ZIP legítimo pero ajeno tampoco: le falta la base', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-ajeno-'));
    fs.writeFileSync(path.join(dir, 'nota.txt'), 'hola');
    execFileSync('zip', ['-q', '-j', path.join(dir, 'ajeno.zip'), path.join(dir, 'nota.txt')]);

    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([fs.readFileSync(path.join(dir, 'ajeno.zip'))]), 'ajeno.zip');
    cuerpo.append('confirmacion', 'RESTAURAR');
    const r = await fetch(`${app.base}/api/respaldos`, { method: 'POST', headers: { cookie: admin.cookie }, body: cuerpo });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /base de datos|no es un respaldo/i);
  });

  test('finanzas no puede restaurar aunque tenga el archivo', async () => {
    const lista = (await admin.pedir('/api/respaldos')).json.respaldos;
    const { datos } = await bajar(lista[0].nombre);
    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([datos]), lista[0].nombre);
    cuerpo.append('confirmacion', 'RESTAURAR');
    const r = await fetch(`${app.base}/api/respaldos`, { method: 'POST', headers: { cookie: finanzas.cookie }, body: cuerpo });
    assert.equal(r.status, 403);
  });
});

describe('la pantalla', () => {
  test('el administrador la ve y trae el botón', async () => {
    const html = (await admin.pedir('/respaldos')).texto;
    assert.match(html, /Hacer un respaldo ahora/);
    assert.match(html, /Restaurar/);
    assert.match(html, /Bajar/);
  });

  test('finanzas no la alcanza', async () => {
    const html = (await finanzas.pedir('/respaldos')).texto;
    assert.match(html, /Sin permiso/);
    assert.doesNotMatch(html, /Hacer un respaldo ahora/);
  });

  test('el menú se la ofrece solo al administrador', async () => {
    assert.match((await admin.pedir('/')).texto, /Respaldos/);
    assert.doesNotMatch((await finanzas.pedir('/')).texto, />Respaldos</);
  });

  test('el tablero no regaña cuando los respaldos están al día', async () => {
    const html = (await admin.pedir('/')).texto;
    assert.doesNotMatch(html, /Todavía no hay ningún respaldo de la plataforma/);
  });
});

describe('el peso del respaldo', () => {
  test('el automático diario no se lleva los PDF: solo la base', async () => {
    // Los adjuntos no cambian una vez subidos. Copiarlos todos los días llenaría
    // el disco del servidor en un año escribiendo catorce veces lo mismo.
    const r = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'automatico' }) });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.completo, false, 'ya hubo uno completo hace un rato, este va ligero');
    assert.match(r.json.nombre, /-automatico-base\.zip$/);

    const { ruta } = await bajar(r.json.nombre);
    const dentro = execFileSync('unzip', ['-Z1', ruta]).toString().trim().split('\n');
    assert.ok(dentro.includes('ultra.db'), 'la base siempre va');
    assert.equal(dentro.some((n) => n.startsWith('archivos/')), false, 'los PDF no');
  });

  test('el que pide una persona sí se los lleva, porque es el que se baja', async () => {
    const r = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'manual' }) });
    assert.equal(r.json.completo, true);
    assert.match(r.json.nombre, /-manual-completo\.zip$/);
  });

  test('el botón «bajar» apunta al último completo, no al último a secas', async () => {
    const { estado } = (await admin.pedir('/api/respaldos')).json;
    assert.ok(estado.ultimoCompleto, 'hay uno completo');
    assert.equal(estado.ultimoCompleto.completo, true);
    assert.equal(estado.ultimoCompleto.alcanceTexto, 'Base + facturas');
  });
});

/**
 * El respaldo se arma escribiendo al disco archivo por archivo, en lugar de
 * juntarlo todo en memoria: en un servidor chico, leer la base y todos los PDF
 * a la vez para luego concatenarlos termina con el proceso muerto por falta de
 * memoria, y eso desde fuera se ve como la plataforma caída sin explicación.
 *
 * Ese cambio toca cómo se produce el único archivo del que depende la vuelta
 * atrás, así que aquí no se comprueba que «se generó»: se comprueba que lo que
 * se metió sale idéntico byte por byte, incluidos los dos casos donde el ZIP se
 * escribe distinto —un archivo que no se puede comprimir, y uno vacío—.
 */
describe('los adjuntos entran y salen intactos', () => {
  const PRUEBA = {
    // Ya comprimido: `deflate` lo dejaría más grande, así que el ZIP lo guarda
    // tal cual. Es la rama que nadie prueba nunca.
    'zz-prueba-incompresible.pdf': randomBytes(64 * 1024),
    'zz-prueba-vacio.xml': Buffer.alloc(0),
    'zz-prueba-texto.xml': Buffer.from('<factura>ñ á é — acentos y guiones largos</factura>', 'utf8'),
  };

  before(() => {
    const dir = path.join(app.carpetaDatos, 'archivos');
    fs.mkdirSync(dir, { recursive: true });
    for (const [nombre, datos] of Object.entries(PRUEBA)) fs.writeFileSync(path.join(dir, nombre), datos);
  });

  test('un respaldo completo los trae, y son los mismos bytes', async () => {
    const hecho = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'manual' }) });
    assert.equal(hecho.status, 201, hecho.texto);
    assert.equal(hecho.json.completo, true);

    const { ruta } = await bajar(hecho.json.nombre);
    // Que el `unzip` del sistema lo dé por bueno con los adjuntos dentro: es lo
    // que hará la computadora del administrador.
    execFileSync('unzip', ['-t', ruta]);

    for (const [nombre, datos] of Object.entries(PRUEBA)) {
      const salida = execFileSync('unzip', ['-p', ruta, `archivos/${nombre}`], { maxBuffer: 8 * 1024 * 1024 });
      assert.equal(salida.length, datos.length, `${nombre} cambió de tamaño`);
      assert.ok(salida.equals(datos), `${nombre} no salió igual a como entró`);
    }

    const manifiesto = JSON.parse(execFileSync('unzip', ['-p', ruta, 'respaldo.json']).toString());
    assert.ok(
      manifiesto.archivos >= Object.keys(PRUEBA).length,
      `el manifiesto dice ${manifiesto.archivos} adjuntos y hay al menos ${Object.keys(PRUEBA).length}`
    );
    assert.ok(manifiesto.base_bytes > 10000, 'el manifiesto pesa la base, no el zip');
  });

  test('restaurarlo repone los adjuntos borrados', async () => {
    const hecho = await admin.pedir('/api/respaldos', { method: 'POST', body: JSON.stringify({ motivo: 'manual' }) });
    const { datos } = await bajar(hecho.json.nombre);

    // Se borran del disco, como si el servidor se hubiera perdido.
    const dir = path.join(app.carpetaDatos, 'archivos');
    for (const nombre of Object.keys(PRUEBA)) fs.rmSync(path.join(dir, nombre), { force: true });
    assert.equal(fs.existsSync(path.join(dir, 'zz-prueba-texto.xml')), false);

    const cuerpo = new FormData();
    cuerpo.append('archivo', new Blob([datos], { type: 'application/zip' }), hecho.json.nombre);
    cuerpo.append('confirmacion', 'RESTAURAR');
    const r = await fetch(`${app.base}/api/respaldos`, { method: 'POST', headers: { cookie: admin.cookie }, body: cuerpo });
    const salida = await r.json();
    assert.equal(r.status, 200, JSON.stringify(salida));
    assert.equal(salida.traiaArchivos, true);

    for (const [nombre, esperado] of Object.entries(PRUEBA)) {
      const vuelto = fs.readFileSync(path.join(dir, nombre));
      assert.ok(vuelto.equals(esperado), `${nombre} volvió distinto`);
    }
  });
});
