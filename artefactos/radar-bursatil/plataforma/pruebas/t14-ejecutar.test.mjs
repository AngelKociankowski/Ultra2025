// T14 / B1 · 50-ejecutar en tres fases (12b §F) con eToro falso con guion (nunca sale a la red)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { crearEToro } from "../lib/etoro.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { aplicarResultados, opsNuevo } from "../lib/libro.mjs";
import { leerVersiones, hDe } from "../lib/db.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { ejecutar, montar, armarYReclamar, reclamar, etoroGuion, reloj, posts, sinEspera, leerDiario, resDe, PLAN, F, T0 } from "./ejecucion.mjs";
import { leerSalida } from "./util.mjs";

const op = (t, ahora) => ({ transporteEToro: t, ahora, dormir: sinEspera });
const ruta = req => new URL(req.url).pathname.replace(/^.*\/demo\//, "");

test("--armar: un solo set de ejecucion-<hoy> sin ifVersion con antes y las líneas; GET solamente", async () => {
  const { dir } = montar(), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  const r = await ejecutar(["--dir", dir, "--armar"], op(t, ahora));
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "armado"); assert.equal(r.linea.escribir, "salida/pre-ejecucion/db_write.json");
  const w = leerSalida(dir, "salida/pre-ejecucion/db_write.json");
  assert.equal(w.ops.length, 1);
  assert.deepEqual([w.ops[0].op, w.ops[0].path, w.ops[0].ifVersion], ["set", `${DB_RUTA}/ejecucion-${F}`, undefined]);
  const d = w.ops[0].data;
  assert.deepEqual([d.kind, d.f, d.sesion, d.fin, d.res], ["ejecucion", F, "s-prueba1", null, []]);
  assert.deepEqual(d.antes, { pos: [2600000001, 2600000002, 2600000005], ord: [] });
  assert.deepEqual(d.lineas.map(l => [l.id.slice(11), l.k, l.lado, l.pos, l.u, l.usd]), [["XLE-V1", 0, "v", 2600000005, null, null], ["SPY-R1", 0, "v", 2600000001, null, null],
    ["SPY-R1", 1, "v", 2600000002, 2, null], ["QQQ-C1", 0, "c", null, null, 1500], ["IWM-C1", 0, "c", null, null, 800]]);
  assert.deepEqual(d.lineas.map(l => l.rid), PLAN.flatMap(o => o.requestIds));
  assert.equal(hDe(leerTrabajo(dir, "ejecucion-doc.json")), d.h, "el reclamo es el documento armado");
  assert.equal(posts(t).length, 0);
  // reclamo creado (versión 1) → registrar lo marca escrito por esta sesión
  assert.equal(reclamar(dir).accion, "listo");
  assert.deepEqual([leerVersiones(dir)[`ejecucion-${F}`].version, leerVersiones(dir)[`ejecucion-${F}`].escritoEn], [1, "pre-ejecucion"]);
});

test("--enviar: ventas antes que compras, 1 POST por línea, diario con envío en disco antes de cada POST, efectivo nunca negativo", async () => {
  const { dir, libro } = montar(), ahora = reloj();
  const vistos = [];
  const t = etoroGuion({ reloj: ahora, antesDePost: req => {
    const d = leerDiario(dir), u = d[d.length - 1];
    vistos.push([u.fase, u.rid === req.encabezados["x-request-id"]]);
  } });
  await armarYReclamar(dir, op(t, ahora));
  const r = await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo");
  assert.deepEqual(posts(t).map(ruta), ["market-close-orders/positions/2600000005", "market-close-orders/positions/2600000001", "market-close-orders/positions/2600000002", "orders", "orders"]);
  assert.deepEqual(vistos, Array(5).fill(["envio", true]), "la línea de envío ya estaba en el diario cuando salió el POST");
  assert.deepEqual(new Set(posts(t).map(p => p.encabezados["x-request-id"])).size, 5);
  const res = resDe(dir);
  assert.deepEqual(res.map(x => [x.id.slice(11), x.k, x.est]), [["XLE-V1", 0, "ejecutada"], ["SPY-R1", 0, "ejecutada"], ["SPY-R1", 1, "ejecutada"], ["QQQ-C1", 0, "ejecutada"], ["IWM-C1", 0, "ejecutada"]]);
  assert.deepEqual([res[0].px, res[0].uej, res[0].usdej], [70.5, 27.059025, 1907.66]);
  assert.deepEqual([res[2].uej, res[2].usdej], [2, 1515]);
  assert.deepEqual([res[3].o, res[3].pos, res[3].usdej, res[3].usd], [6004, [2800000004], 1500, 1500]);
  assert.ok(res.every(x => x.env && /Z$/.test(x.env)));
  const d = leerDiario(dir);
  assert.deepEqual(d.map(x => x.fase), ["envio", "respuesta", "envio", "respuesta", "envio", "respuesta", "envio", "respuesta", "envio", "respuesta"]);
  const ap = aplicarResultados({ libro, opsHoy: opsNuevo(F), plan: PLAN, res, simulacion: false, ahora: Date.parse(T0) + 600000 });
  assert.ok(ap.libro.efectivoUSD >= 0);
  assert.equal(ap.libro.efectivoUSD, Math.round((5000 + 1907.66 + res[1].usdej + 1515 - 1500 - 800) * 100) / 100);
  assert.deepEqual(ap.ops.ops.map(o => o.est), ["ejecutada", "ejecutada", "ejecutada", "ejecutada"]);
});

test("efectivo insuficiente: las compras se escalan por igual; lo que queda bajo el mínimo → no_enviada (sin efectivo)", async () => {
  const { dir } = montar({ plan: PLAN.slice(2), efectivo: 1150 }), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  await armarYReclamar(dir, op(t, ahora));
  await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  const res = resDe(dir);
  assert.deepEqual(res.map(x => [x.est, x.usd]), [["ejecutada", 750], ["ejecutada", 400]]);
  const b = montar({ plan: PLAN.slice(2), efectivo: 120 }), tb = etoroGuion({ reloj: ahora });
  await armarYReclamar(b.dir, op(tb, ahora));
  await ejecutar(["--dir", b.dir, "--enviar"], op(tb, ahora));
  assert.deepEqual(resDe(b.dir).map(x => [x.est, x.err]), [["no_enviada", "sin efectivo"], ["no_enviada", "sin efectivo"]]);
  assert.equal(posts(tb).length, 0);
});

test("plan alterado → --armar nada (no_enviada) y 0 POST; --enviar sin reclamo de esta sesión → ya_ejecutado, 0 POST", async () => {
  const a = montar({ alterar: true }), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  const r = await ejecutar(["--dir", a.dir, "--armar"], op(t, ahora));
  assert.deepEqual([r.codigo, r.linea.accion], [0, "nada"]);
  assert.ok(resDe(a.dir).every(x => x.est === "no_enviada" && x.err === "plan alterado"));
  assert.ok(!fs.existsSync(path.join(a.dir, "salida/pre-ejecucion")));
  const b = montar();
  await ejecutar(["--dir", b.dir, "--armar"], op(t, ahora)); // sin registrar el reclamo
  const e = await ejecutar(["--dir", b.dir, "--enviar"], op(t, ahora));
  assert.deepEqual([e.codigo, e.linea.accion], [3, "ya_ejecutado"]);
  // 409 en pre-ejecucion: registrar dice ya_hubo_envio y --enviar se niega
  const c = montar();
  await ejecutar(["--dir", c.dir, "--armar"], op(t, ahora));
  assert.equal(reclamar(c.dir, { choque: true }).accion, "ya_hubo_envio");
  assert.equal((await ejecutar(["--dir", c.dir, "--enviar"], op(t, ahora))).linea.accion, "ya_ejecutado");
  // el documento armado cambió después del reclamo → no es el reclamo de esta sesión
  const d = montar();
  await armarYReclamar(d.dir, op(t, ahora));
  const doc = leerTrabajo(d.dir, "ejecucion-doc.json"); doc.armado = "2026-11-04T15:59:59Z";
  fs.writeFileSync(path.join(d.dir, "trabajo/ejecucion-doc.json"), JSON.stringify(doc));
  assert.equal((await ejecutar(["--dir", d.dir, "--enviar"], op(t, ahora))).linea.accion, "ya_ejecutado");
  assert.equal(posts(t).length, 0);
});

test("la cartera cambió entre --armar y --enviar (posición nueva de un instrumento del plan) → no_enviada, 0 POST", async () => {
  const { dir } = montar(), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  await armarYReclamar(dir, op(t, ahora));
  t.pf.clientPortfolio.positions.push({ positionID: 2899999990, orderID: 1, instrumentID: 3006, units: 1, amount: 690, openRate: 690, openDateTime: "2026-11-04T15:00:30Z", isBuy: true, leverage: 1 });
  const r = await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  assert.equal(posts(t).length, 0); assert.equal(r.codigo, 0);
  assert.ok(resDe(dir).every(x => x.est === "no_enviada" && x.err === "la cartera cambió entre el armado y el envío"));
});

test("400 → rechazada sin reenvío; 401 a mitad → rechazada y no se envía nada más (código 3)", async () => {
  const a = montar(), ahora = reloj();
  const t = etoroGuion({ reloj: ahora, fallas: { 1: { noLlego: true, resp: { http: 400, texto: '{"errorCode":"InvalidPosition"}' } } } });
  await armarYReclamar(a.dir, op(t, ahora));
  await ejecutar(["--dir", a.dir, "--enviar"], op(t, ahora));
  assert.equal(posts(t).length, 5);
  assert.deepEqual([resDe(a.dir)[0].est, resDe(a.dir)[0].http], ["rechazada", 400]);
  const b = montar(), t2 = etoroGuion({ reloj: ahora, fallas: { 2: { noLlego: true, resp: { http: 401, texto: "" } } } });
  await armarYReclamar(b.dir, op(t2, ahora));
  const r = await ejecutar(["--dir", b.dir, "--enviar"], op(t2, ahora));
  assert.equal(posts(t2).length, 2); assert.equal(r.codigo, 3);
  assert.deepEqual(resDe(b.dir).map(x => x.est), ["ejecutada", "rechazada", "no_enviada", "no_enviada", "no_enviada"]);
  assert.ok(resDe(b.dir).slice(2).every(x => /^detenido/.test(x.err)));
});

test("simulación → --armar nada, 0 POST y sin ejecucion.json", async () => {
  const { dir } = montar({ simulacion: true }), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  const r = await ejecutar(["--dir", dir, "--armar"], op(t, ahora));
  assert.deepEqual([r.codigo, r.linea.accion], [0, "nada"]);
  assert.equal(t.llamadas.length, 0); assert.ok(!fs.existsSync(path.join(dir, "trabajo/ejecucion.json")));
});

test("el proceso muere entre el envío anotado y el POST: --reanudar no envía esa línea (queda incierta) y sí las que no tenían envío", async () => {
  const { dir } = montar(), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  await armarYReclamar(dir, op(t, ahora));
  // lo que dejó en disco el proceso muerto: la línea de envío de XLE sincronizada, sin POST ni respuesta
  const xle = leerTrabajo(dir, "ejecucion-doc.json").lineas[0];
  fs.writeFileSync(path.join(dir, "trabajo/diario-ejecucion.jsonl"), JSON.stringify({ t: "2026-11-04T15:00:05Z", id: xle.id, k: 0, fase: "envio", rid: xle.rid }) + "\n");
  const r = await ejecutar(["--dir", dir, "--reanudar"], op(t, ahora));
  assert.deepEqual(posts(t).map(ruta), ["market-close-orders/positions/2600000001", "market-close-orders/positions/2600000002", "orders", "orders"]);
  assert.equal(r.codigo, 3);
  assert.deepEqual(resDe(dir).map(x => x.est), ["incierta", "ejecutada", "ejecutada", "ejecutada", "ejecutada"]);
  assert.equal(resDe(dir)[0].env, "2026-11-04T15:00:05Z");
  assert.equal(leerDiario(dir).filter(x => x.fase === "reanudar").length, 1);
});

test("F.1 · clasificación de cada respuesta de un POST (nunca se reenvía)", async () => {
  const ID = "3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
  const casos = [
    [{ http: 200, texto: '{"token":"x","orderId":391}' }, "comprar", "aceptada", 391, false],
    [{ http: 200, texto: '{"orderForClose":{"orderID":77}}' }, "cerrar", "aceptada", 77, false],
    [{ http: 200, texto: '{"token":"x","orderId":39' }, "comprar", "incierta", null, false],
    [{ http: 200, texto: '{"token":"x"}' }, "comprar", "incierta", null, false],
    [{ http: 200, texto: '{"orderId":391}', errorRed: "curl 18" }, "comprar", "incierta", 391, false],
    [{ http: 307, texto: "" }, "comprar", "incierta", null, false],
    [{ http: 503, texto: "" }, "cerrar", "incierta", null, false],
    [{ http: 0, texto: "", errorRed: "curl 28 (tiempo)" }, "comprar", "incierta", null, false],
    [{ http: 401, texto: "" }, "comprar", "rechazada", null, true],
    [{ http: 403, texto: "" }, "cerrar", "rechazada", null, true],
    [{ http: 0, conectar: 403, texto: "" }, "comprar", "rechazada", null, true],
    [{ http: 429, texto: "Limit" }, "comprar", "rechazada", null, false],
    [{ http: 400, texto: '{"errorCode":"InvalidAmount"}' }, "comprar", "rechazada", null, false],
    [{ http: 404, texto: "<html" }, "comprar", "incierta", null, false],
  ];
  for (const [resp, metodo, clase, orderId, detener] of casos) {
    const t = transporteFalso(() => resp), et = crearEToro({ transporte: t });
    const r = metodo === "comprar" ? await et.comprar({ instrumentId: 3006, montoUSD: 100, requestId: ID }) : await et.cerrar({ positionId: 1, instrumentId: 3006, unidades: null, requestId: ID });
    assert.deepEqual([r.clase, r.orderId, r.detener], [clase, orderId, detener], JSON.stringify(resp));
    assert.equal(t.llamadas.length, 1, "un solo intento");
  }
  const lanza = await crearEToro({ transporte: () => { throw new Error("transporte roto"); } }).comprar({ instrumentId: 3006, montoUSD: 100, requestId: ID });
  assert.equal(lanza.clase, "incierta");
});

test("--armar y --enviar se niegan si la ejecución de esta carpeta ya corrió; --reanudar solo una vez", async () => {
  const { dir } = montar({ plan: PLAN.slice(0, 1) }), ahora = reloj(), t = etoroGuion({ reloj: ahora });
  await armarYReclamar(dir, op(t, ahora));
  await ejecutar(["--dir", dir, "--enviar"], op(t, ahora));
  for (const f of ["--armar", "--enviar", "--reanudar"]) {
    const r = await ejecutar(["--dir", dir, f], op(t, ahora));
    assert.deepEqual([r.codigo, r.linea.accion], [3, "ya_ejecutado"], f);
  }
  assert.equal(posts(t).length, 1);
  // una reanudación que muere después de marcarse: la segunda se niega
  const b = montar({ plan: PLAN.slice(0, 1) }), base = reloj(), t2 = etoroGuion({ reloj: base });
  await armarYReclamar(b.dir, op(t2, base));
  fs.writeFileSync(path.join(b.dir, "trabajo/diario-ejecucion.jsonl"), "");
  let morir = false;
  const ahora2 = () => { if (morir) throw new Error("proceso cortado"); return base(); };
  const corta = async req => { morir = true; return t2(req); };
  await assert.rejects(() => ejecutar(["--dir", b.dir, "--reanudar"], op(corta, ahora2)), /proceso cortado/);
  const r2 = await ejecutar(["--dir", b.dir, "--reanudar"], op(t2, base));
  assert.deepEqual([r2.codigo, r2.linea.accion], [3, "ya_ejecutado"]);
  assert.equal(posts(t2).length, 0);
});
