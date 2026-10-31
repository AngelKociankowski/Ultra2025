// T15 / K8 · Cierre: grupo final (§E.6), verificar.json, aviso (§H, H12), H15 (a8-db-sucia), H24 (a14) y --degradado
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar, TEXTO_FALLA } from "../bin/60-cerrar.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { escribirTrabajo, escribirJson, leerTrabajo } from "../lib/archivos.mjs";
import { armarAviso } from "../lib/aviso.mjs";
import { lectura, leerVersiones, conH } from "../lib/db.mjs";
import { validarDoc, kindDeId } from "../lib/esquemas.mjs";
import { semilla } from "../lib/libro.mjs";
import { DOC_TOPES, DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, dbInicial, OUT30, PAG, copia } from "./escenario.mjs";
import { leerSalida, carpetaConDb } from "./util.mjs";
import { transporteFalso } from "../lib/http.mjs";

const aviso = dir => fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8");
const grupo = dir => leerSalida(dir, "salida/final/db_write.json");
const idsDe = dir => grupo(dir).ops.map(o => o.path.slice(DB_RUTA.length + 1));
const docDe = (dir, id) => grupo(dir).ops.find(o => o.path === `${DB_RUTA}/${id}`).data;
const NOTAS = { v: 1, generadoEl: "2026-11-02T15:00:00Z", notas: [{ id: "n1", titulo: "Fed holds rates steady as inflation cools", medio: "Reuters", url: "https://www.cnbc.com/2026/11/02/fed-holds.html",
  fecha: "2026-11-02", tema: "macro", simbolos: [], resumen: "La Reserva Federal mantuvo su tasa sin cambios.", evento: null }] };
const outXleEvitar = () => { const out = copia(OUT30); Object.assign(out.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 }); return out; };
const operarDb = () => ({ "rutina-config": Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) });
const T_CIERRE = d => d.t + 900000;

test("grupo final: orden exacto de §E.6, esquemas, topes, ifVersion solo en leídos, verificar.json y escritos con los h", async () => {
  const s = semilla(); delete s["etoro-mapa"].i.DIA; delete s["etoro-mapa"].rech.DIA; // fuerza un cambio del mapa
  const e = await prepararDia({ out: outXleEvitar(), notas: NOTAS, dbExtra: { "etoro-mapa": s["etoro-mapa"] } });
  const r = await cerrar(["--dir", e.dir], { ahora: () => T_CIERRE(e) });
  assert.equal(r.codigo, 0); assert.equal(r.linea.escribir, "salida/final/db_write.json");
  assert.deepEqual(idsDe(e.dir), ["ops-2026-10-30", "ops-2026-11-02", "cartera-libro", "etoro-mapa", "punto-2026-11-02", "radar-2026-11-02", "bitacora-2026-11-02", "bitacora-mes-2026-11", "rutina-estado"]);
  const ver = leerVersiones(e.dir);
  for (const op of grupo(e.dir).ops) {
    const id = op.path.slice(DB_RUTA.length + 1), b = Buffer.byteLength(JSON.stringify(op.data));
    assert.equal(op.op, "set");
    assert.deepEqual(validarDoc(id, op.data), [], id);
    assert.equal(conH(op.data).h, op.data.h, `${id}: h`);
    assert.ok(b <= DOC_TOPES[kindDeId(id)], `${id}: ${b} B > ${DOC_TOPES[kindDeId(id)]}`);
    if (ver[id] && ver[id].estado === "ok") assert.equal(op.ifVersion, ver[id].version, id); else assert.equal(op.ifVersion, undefined, id);
    assert.ok(!/"CID"|10000001/.test(JSON.stringify(op.data)), id); // CID ficticio de los fixtures: nunca va a db
  }
  const est = docDe(e.dir, "rutina-estado");
  assert.deepEqual([est.estado, est.paso], ["hecha", "cerrar"]);
  assert.deepEqual(est.escritos, Object.fromEntries(grupo(e.dir).ops.slice(0, -1).map(o => [o.path.slice(DB_RUTA.length + 1), o.data.h])));
  assert.deepEqual(leerTrabajo(e.dir, "verificar.json"), { lecturas: [lectura("rutina-estado", { obligatoria: true, dirAbs: path.resolve(e.dir) })] });
  const ops = docDe(e.dir, "ops-2026-10-30").ops, hoy = docDe(e.dir, "ops-2026-11-02").ops;
  assert.ok(ops.every(o => o.est === "ejecutada"));
  assert.deepEqual(hoy.map(o => [o.id, o.est, o.sim]), [["2026-11-02-XLE-V1", "simulada", true]]);
  const libro = docDe(e.dir, "cartera-libro");
  assert.equal(libro.pend.length, 0); assert.equal(libro.lotes.length, 5); assert.equal(libro.efectivo, 0.56); assert.equal(libro.refs.dia[0], "2026-11-02");
  const b = docDe(e.dir, "bitacora-2026-11-02");
  assert.deepEqual([b.estado, b.sim, b.radar.estado], ["completa", true, "listo"]);
  assert.equal(b.aviso, aviso(e.dir)); assert.ok(Number.isInteger(b.presupuesto) && b.presupuesto < 36000, String(b.presupuesto));
  assert.deepEqual(docDe(e.dir, "bitacora-mes-2026-11").d, [["2026-11-02", "completa", 32010.04, b.rend.usd[0], 0, 1]]);
  // el grupo se aplica al db falso sin conflictos y los documentos de la página no cambian
  assert.equal(e.S.escribir("final").accion, "listo");
  assert.deepEqual([e.db.version("indice"), e.db.version("corrida")], [1, 1]);
});

test("aviso H12: simulación; real ejecutada; A4.2 compra sin efectivo → ninguna + No se ejecutaron; aceptada e incierta sin 'compré'", async () => {
  const sim = await prepararDia({ out: outXleEvitar(), notas: NOTAS });
  await cerrar(["--dir", sim.dir], { ahora: () => T_CIERRE(sim) });
  assert.equal(aviso(sim.dir), [
    "Radar · lun 2-nov · 10:05 ET · SIMULACIÓN",
    "Cartera: US$ 32,010 (+0.16 % hoy · +0.16 % desde inicio) · MXN $ 600,956 (+0.16 %)",
    "vs SPY desde inicio: −0.23 % · meta 15 % anual: +0.04 pts",
    "Radar: régimen Favorable",
    "Noticias: Fed holds rates steady as inflation cools (CNBC)",
    "Operaciones: 1 simulada — vender XLE (V1)",
  ].join("\n"));
  const real = async res => {
    const d = await prepararDia({ out: outXleEvitar(), notas: NOTAS, dbExtra: operarDb() });
    assert.equal(d.decidir.linea.accion, "ejecutar");
    if (res.plan) escribirJson(path.join(d.dir, "trabajo/plan-ordenes.json"), { fecha: "2026-11-02", simulacion: false, ordenes: res.plan });
    escribirTrabajo(d.dir, "ejecucion.json", { doc: null, res: res.res });
    assert.equal((await cerrar(["--dir", d.dir], { ahora: () => T_CIERRE(d) })).codigo, 0);
    return d;
  };
  const xle = await real({ res: [{ id: "2026-11-02-XLE-V1", k: 0, est: "ejecutada", env: "2026-11-02T15:01:00Z", http: 200, o: 391400001, pos: [2600000005], px: 70.1, uej: 27.059025, usdej: 1896.84 }] });
  assert.match(aviso(xle.dir), /\nOperaciones: 1 — vendí XLE \(V1\)$/);
  assert.ok(!/SIMULACIÓN/.test(aviso(xle.dir)));
  const lx = docDe(xle.dir, "cartera-libro");
  assert.equal(lx.efectivo, 1897.4); assert.equal(lx.realizado, 8.12); assert.equal(lx.lotes.length, 4);
  assert.deepEqual(docDe(xle.dir, "ops-2026-11-02").ops.map(o => [o.id, o.est, o.sim, o.usdej]), [["2026-11-02-XLE-V1", "ejecutada", false, 1896.84]]);
  const QQQ = { id: "2026-11-02-QQQ-C1", orden: 1, sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 1500, cierres: null, motivo: "Entra al objetivo", noticias: [], requestIds: ["x"] };
  const sinEf = await real({ plan: [QQQ], res: [{ id: QQQ.id, k: 0, est: "no_enviada", env: null, http: null, err: "sin efectivo" }] });
  assert.match(aviso(sinEf.dir), /\nOperaciones: ninguna\nNo se ejecutaron: QQQ \(sin efectivo\)/);
  assert.equal(docDe(sinEf.dir, "cartera-libro").efectivo, 0.56);
  const acep = await real({ plan: [QQQ], res: [{ id: QQQ.id, k: 0, est: "aceptada", env: "2026-11-02T15:01:00Z", http: 200, o: 6001 }] });
  assert.match(aviso(acep.dir), /\nOperaciones: 1 — compra QQQ enviada, sin ejecutar aún/);
  const inc = await real({ plan: [QQQ], res: [{ id: QQQ.id, k: 0, est: "incierta", env: "2026-11-02T15:01:00Z", http: null }] });
  assert.match(aviso(inc.dir), /\nOperaciones: 1 — compra QQQ sin confirmar/);
  const li = docDe(inc.dir, "cartera-libro");
  assert.equal(li.efectivo, cts(0.56 - 1500)); assert.deepEqual(li.pend.map(p => [p.id, p.est, p.env, p.usd]), [[QQQ.id, "incierta", "2026-11-02T15:01:00Z", 1500]]);
  for (const d of [sinEf, acep, inc]) assert.ok(!/compré|vendí/.test(aviso(d.dir)), aviso(d.dir));
  // tope de 700 con muchas alertas y notas largas
  const largo = armarAviso({ fecha: "2026-11-02", hora: "09:58", simulacion: false, cartera: null, rend: null, radar: { regimen: "Favorable", cambios: [] },
    notas: [{ titulo: "x".repeat(300), medio: "CNBC" }, { titulo: "y".repeat(300), medio: "Bloomberg" }], operaciones: [], alertas: Array.from({ length: 30 }, (_, i) => "alerta larga ".repeat(5) + i), fallas: [] });
  assert.ok(largo.length <= 700); assert.match(largo, /^Radar · lun 2-nov · 9:58 ET/);
});
const cts = x => Math.round(x * 100) / 100;

test("sin Radar (sin FMP): radar sin_radar, bitácora parcial, rutina-estado hecha y la línea de §H", async () => {
  const e = await prepararDia({ sinRadar: true, notas: NOTAS });
  await cerrar(["--dir", e.dir], { ahora: () => T_CIERRE(e) });
  assert.match(aviso(e.dir), /\nRadar: sin datos de FMP hoy; sin Radar no se opera\.\n/);
  assert.deepEqual([docDe(e.dir, "radar-2026-11-02").estado, docDe(e.dir, "radar-2026-11-02").motivo], ["sin_radar", "policy"]);
  assert.equal(docDe(e.dir, "bitacora-2026-11-02").estado, "parcial");
  assert.equal(docDe(e.dir, "rutina-estado").estado, "hecha");
});

test("--degradado: cualquier paso sale 0 con Falla:; sin eToro no se reescribe el libro", async () => {
  const a = await prepararDia({ sinRadar: true });
  for (const paso of Object.keys(TEXTO_FALLA).concat(["50-ejecutar", "registrar", "x y", ""])) {
    const r = await cerrar(["--dir", a.dir, "--degradado", paso], { ahora: () => T_CIERRE(a) });
    assert.equal(r.codigo, 0, paso);
    assert.equal(docDe(a.dir, "rutina-estado").estado, "degradada", paso);
    assert.match(aviso(a.dir), /\nFalla: [a-z0-9-]+ — /, paso);
  }
  await cerrar(["--dir", a.dir, "--degradado", "radar"], { ahora: () => T_CIERRE(a) });
  assert.match(aviso(a.dir), /\nFalla: radar — el Radar no corrió; sin análisis de hoy$/);
  const b = await prepararDia({ etoro: transporteFalso(() => ({ http: 503, texto: "" })) });
  assert.equal((await cerrar(["--dir", b.dir, "--degradado", "cartera"], { ahora: () => T_CIERRE(b) })).codigo, 0);
  assert.equal(docDe(b.dir, "bitacora-2026-11-02").estado, "degradada");
  assert.match(aviso(b.dir), /Falla: cartera — sin datos de eToro; sin órdenes hoy/);
  assert.ok(!idsDe(b.dir).includes("cartera-libro"));
});

test("cierre mínimo: datos de trabajo que hacen fallar el cierre normal → código 0, normal y con --degradado", async () => {
  const e = await prepararDia({});
  escribirTrabajo(e.dir, "cartera.json", { estado: "listo", libro: { posiciones: "x" }, valuacion: { posiciones: 3 }, alertas: [] });
  for (const args of [[], ["--degradado", "cerrar"], ["--degradado", "cartera"]]) {
    const r = await cerrar(["--dir", e.dir, ...args], { ahora: () => T_CIERRE(e) });
    assert.equal(r.codigo, 0, args.join(" ")); assert.equal(r.linea.resumen.minimo, true);
    assert.deepEqual(idsDe(e.dir), ["bitacora-2026-11-02", "bitacora-mes-2026-11", "rutina-estado"]);
    assert.equal(docDe(e.dir, "rutina-estado").estado, "degradada");
    assert.match(aviso(e.dir), /Falla: .+ — /);
  }
});

// H15 · a8-db-sucia portado: entradas malas de bitacora-mes (y de lotes, pend y ops) se descartan con alerta
const SUCIAS = { "entrada null": [null], "f con hora": [{ f: "2026-10-30T00:00" }], "texto": ["x"] };
for (const [nombre, malas] of Object.entries(SUCIAS)) {
  test(`H15 · bitacora-mes.d con ${nombre}: 00-preparar y 60-cerrar (normal y --degradado cerrar) salen 0 con alerta y degradada`, async () => {
    const bm = { kind: "bitacoraMes", v: 1, mes: "2026-11", d: malas.concat([["2026-11-01", "completa", 31900, 0, 0, 1]]) };
    const e = await prepararDia({ dbExtra: { "bitacora-mes-2026-11": bm } });
    assert.equal(e.preparar.codigo, 0);
    const txt = `Entrada mala en bitacora-mes-2026-11: ${String(JSON.stringify(malas[0])).slice(0, 40)}; se descarta.`;
    assert.ok(leerTrabajo(e.dir, "preparar.json").alertas.includes(txt));
    for (const args of [[], ["--degradado", "cerrar"]]) {
      const r = await cerrar(["--dir", e.dir, ...args], { ahora: () => T_CIERRE(e) });
      assert.equal(r.codigo, 0); assert.equal(r.linea.resumen.minimo, undefined);
      assert.equal(docDe(e.dir, "rutina-estado").estado, "degradada");
      assert.equal(docDe(e.dir, "bitacora-2026-11-02").estado, "degradada");
      assert.ok(docDe(e.dir, "bitacora-2026-11-02").alertas.includes(txt));
      assert.deepEqual(docDe(e.dir, "bitacora-mes-2026-11").d.map(x => x[0]), ["2026-11-01", "2026-11-02"], "la entrada mala no se reescribe");
    }
  });
}

test("H15 · lote, pendiente y operación mal formados: se ignoran con alerta, día degradado, no se reescriben", async () => {
  const s = semilla();
  s["cartera-libro"].lotes.push(["SPY", "x"]); s["cartera-libro"].pend.push(null);
  s["ops-2026-10-30"].ops.push({ id: 7 });
  const e = await prepararDia({ dbExtra: { "cartera-libro": s["cartera-libro"], "ops-2026-10-30": s["ops-2026-10-30"] } });
  assert.equal(e.preparar.codigo, 0); assert.equal(e.cartera.codigo, 0);
  const r = await cerrar(["--dir", e.dir], { ahora: () => T_CIERRE(e) });
  assert.equal(r.codigo, 0);
  const al = docDe(e.dir, "bitacora-2026-11-02").alertas.join("\n");
  assert.match(al, /Lote mal formado en cartera-libro/); assert.match(al, /Pendiente mal formado en cartera-libro/); assert.match(al, /Operación mal formada en ops-2026-10-30/);
  assert.equal(docDe(e.dir, "rutina-estado").estado, "degradada");
  const libro = docDe(e.dir, "cartera-libro");
  assert.equal(libro.lotes.length, 5); assert.equal(libro.pend.length, 0);
  assert.equal(docDe(e.dir, "ops-2026-10-30").ops.length, 5);
});

// H24 · a14-lectura-omitida portado: sin lectura registrada no hay escritura
test("H24 · ops-2026-10-30 sin línea en lecturas.jsonl → no va en final (alerta); con la línea va con ifVersion", async () => {
  const sin = await prepararDia({ omitir: ["ops-2026-10-30"] });
  assert.equal(sin.preparar.codigo, 0);
  assert.equal(leerVersiones(sin.dir)["ops-2026-10-30"].codigo, "no_leido");
  await cerrar(["--dir", sin.dir], { ahora: () => T_CIERRE(sin) });
  assert.ok(!idsDe(sin.dir).includes("ops-2026-10-30"));
  assert.ok(docDe(sin.dir, "bitacora-2026-11-02").alertas.includes("no se leyó ops-2026-10-30; no se escribe"));
  const con = await prepararDia({});
  await cerrar(["--dir", con.dir], { ahora: () => T_CIERRE(con) });
  const op = grupo(con.dir).ops.find(o => o.path.endsWith("/ops-2026-10-30")), bm = grupo(con.dir).ops.find(o => o.path.endsWith("/bitacora-mes-2026-11"));
  assert.equal(op.ifVersion, 1); assert.equal(bm.ifVersion, undefined); // bitacora-mes-2026-11 no existía (exists:false)
  const conBm = await prepararDia({ dbExtra: { "bitacora-mes-2026-11": { kind: "bitacoraMes", v: 1, mes: "2026-11", d: [] } } });
  await cerrar(["--dir", conBm.dir], { ahora: () => T_CIERRE(conBm) });
  assert.equal(grupo(conBm.dir).ops.find(o => o.path.endsWith("/bitacora-mes-2026-11")).ifVersion, 1);
});

test("H24 · bitacora-mes sin línea: 00-preparar sale por integridad sin escribir; si falta su registro al cerrar, no va en final", async () => {
  const e = await prepararDia({ omitir: ["bitacora-mes-2026-11"] });
  assert.equal(e.preparar.codigo, 2); assert.equal(e.preparar.linea.resumen.motivo, "integridad");
  assert.equal(e.preparar.linea.escribir, null);
  assert.equal(aviso(e.dir), "Radar · lun 2-nov · Falla: no se pudo leer bitacora-mes-2026-11 de db; hoy no se operó.");
  // defensa del cierre: el registro de la lectura desaparece después de preparar
  const d = await prepararDia({});
  const ver = leerVersiones(d.dir); delete ver["bitacora-mes-2026-11"];
  fs.writeFileSync(path.join(d.dir, "entrada/db/_versiones.json"), JSON.stringify(ver));
  await cerrar(["--dir", d.dir], { ahora: () => T_CIERRE(d) });
  assert.ok(!idsDe(d.dir).includes("bitacora-mes-2026-11"));
  assert.ok(docDe(d.dir, "bitacora-2026-11-02").alertas.includes("no se leyó bitacora-mes-2026-11; no se escribe"));
});

test("feriado lo arma 00-preparar (aviso de una línea y rutina-estado sin_mercado)", async () => {
  const fer = carpetaConDb(semilla(), null, { noExisten: ["rutina-estado", "bitacora-mes-2026-11"] });
  const r = await preparar(["--dir", fer, "--fase", "decidir"], { ahora: () => Date.parse("2026-11-26T14:47:00Z"), pagina: PAG });
  assert.equal(r.codigo, 2);
  assert.equal(aviso(fer), "Radar · jue 26-nov · Feriado NYSE (Thanksgiving Day): sin operación.");
  assert.equal(leerSalida(fer, "salida/ahora/db_write.json").ops[0].data.estado, "sin_mercado");
});
