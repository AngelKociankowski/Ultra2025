// K2 · Documentos compactos (12b §E.3, §E.5): cada kind valida y cabe en su tope con el día sintético y con un caso grande
// (12 lotes, 5 pendientes, 8 notas, 15 decisiones); precisión de §E.3; la bitácora se recorta en el orden de §E.5.7
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar, recortarBitacora } from "../bin/60-cerrar.mjs";
import { main as semillaCli } from "../bin/semilla.mjs";
import { escribirTrabajo, leerTrabajo } from "../lib/archivos.mjs";
import { conH, bytes } from "../lib/db.mjs";
import { validarDoc, kindDeId } from "../lib/esquemas.mjs";
import { valuar } from "../lib/libro.mjs";
import { composicion } from "../lib/rendimientos.mjs";
import { DOC_TOPES, DB_RUTA } from "../lib/constantes.mjs";
import { prepararDia, OUT30, copia } from "./escenario.mjs";
import { carpetaConDb, leerSalida } from "./util.mjs";

// decimales de un número (por su forma más corta en JSON)
const dec = x => { const s = String(x); if (/e-/.test(s)) return Number(s.split("e-")[1]) + ((s.split("e-")[0].split(".")[1] || "").length); return (s.split(".")[1] || "").length; };
const max = (x, d, donde) => { if (typeof x === "number") assert.ok(dec(x) <= d && !Object.is(x, -0), `${donde}: ${x} (> ${d} decimales)`); };
const precioOk = (x, donde) => { if (typeof x === "number") max(x, Math.abs(x) >= 1 ? 2 : 4, donde); };
const ref = (r, donde) => { max(r[1], 2, donde + ".v"); max(r[2], 2, donde + ".vm"); precioOk(r[3], donde + ".spy"); max(r[4], 8, donde + ".i"); max(r[5], 8, donde + ".im"); };

// §E.3 por kind (i/im con 8 decimales: desvío 1 del reporte 16)
const PRECISION = {
  carteraLibro: (d, id) => {
    max(d.efectivo, 2, id); max(d.realizado, 2, id); max(d.mandato.baseMXN, 2, id); max(d.mandato.baseUSD, 2, id); max(d.mandato.fx0, 4, id);
    d.lotes.forEach((l, i) => { max(l[4], 6, `${id}.lotes[${i}].u`); max(l[5], 2, `${id}.lotes[${i}].costo`); });
    d.pend.forEach((p, i) => { max(p.usd, 2, `${id}.pend[${i}].usd`); max(p.u, 6, `${id}.pend[${i}].u`); });
    for (const [s, p] of Object.entries(d.precios)) precioOk(p[0], `${id}.precios.${s}`);
    for (const [k, r] of Object.entries(d.refs)) ref(r, `${id}.refs.${k}`);
  },
  carteraPunto: (d, id) => { for (const k of ["v_", "vm", "e", "fl"]) max(d[k], 2, `${id}.${k}`); max(d.fx, 4, id + ".fx"); precioOk(d.spy, id + ".spy"); max(d.i, 8, id + ".i"); max(d.im, 8, id + ".im"); },
  carteraOps: (d, id) => d.ops.forEach((o, i) => { max(o.usd, 2, `${id}[${i}].usd`); max(o.u, 6, `${id}[${i}].u`); precioOk(o.px, `${id}[${i}].px`); max(o.uej, 6, `${id}[${i}].uej`); max(o.usdej, 2, `${id}[${i}].usdej`); max(o.real, 2, `${id}[${i}].real`); }),
  bitacora: (d, id) => {
    const c = d.cartera;
    if (c.v_ !== undefined) { max(c.v_, 2, id); max(c.vm, 2, id); max(c.fx, 4, id); max(c.e, 2, id); c.pos.forEach(p => { max(p[1], 6, id + ".pos.u"); max(p[2], 2, id + ".pos.costo"); precioOk(p[3], id + ".pos.px"); max(p[4], 2, id + ".pos.valor"); max(p[5], 4, id + ".pos.peso"); }); }
    for (const k of ["usd", "mxn", "spy"]) (d.rend[k] || []).forEach(x => max(x, 6, `${id}.rend.${k}`));
    (d.rend.meta || []).forEach(x => max(x, 2, id + ".rend.meta"));
    for (const k of Object.keys(d.comp)) d.comp[k].forEach(x => max(x[1], 4, `${id}.comp.${k}`));
    d.dec.forEach(x => { max(x[3], 4, id + ".dec.pa"); max(x[4], 4, id + ".dec.po"); max(x[5], 2, id + ".dec.desv"); max(x[6], 2, id + ".dec.monto"); });
  },
  bitacoraMes: (d, id) => d.d.forEach(x => { max(x[2], 2, id + ".v"); max(x[3], 6, id + ".r"); }),
  radarResumen: (d, id) => {
    if (d.estado === "sin_radar") return;
    for (const k of ["r12", "dd", "rf"]) max(d.reg[k], 4, `${id}.reg.${k}`); max(d.reg.vix, 2, id + ".reg.vix");
    d.filas.forEach(f => { assert.ok(Number.isInteger(f[2]) && Number.isInteger(f[3]) && Number.isInteger(f[4]), id + ".filas enteros"); precioOk(f[5], id + ".filas.px"); max(f[6], 1, id + ".filas.cambio"); max(f[7], 4, id + ".filas.expRet"); });
    d.obj.forEach(o => assert.ok(Number.isInteger(o[1]), id + ".obj ‱"));
  },
};
function revisarDoc(id, data, { sinTope = false } = {}) {
  const doc = conH(data), k = kindDeId(id), n = bytes(doc);
  assert.deepEqual(validarDoc(id, doc), [], id);
  if (!sinTope) assert.ok(n <= DOC_TOPES[k], `${id}: ${n} B > tope ${DOC_TOPES[k]}`);
  if (PRECISION[k]) PRECISION[k](doc, id);
  JSON.stringify(doc, (key, v) => { if (typeof v === "number") max(v, 8, `${id}.${key}`); return v; });
  return n;
}
const docsDe = (dir, g) => leerSalida(dir, `salida/${g}/db_write.json`).ops.map(o => [o.path.slice(DB_RUTA.length + 1), o.data]);

test("día sintético: los documentos de semilla, ahora y final validan, caben en su tope y respetan §E.3", async t => {
  const s = carpetaConDb({}, null, { noExisten: ["cartera-libro"] });
  assert.equal((await semillaCli(["--dir", s], { ahora: () => Date.parse("2026-10-31T12:00:00Z") })).codigo, 0);
  const out = copia(OUT30); Object.assign(out.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 });
  const e = await prepararDia({ out });
  await cerrar(["--dir", e.dir], { ahora: () => e.t + 900000 });
  const tam = {};
  for (const [id, d] of docsDe(s, "semilla").concat(docsDe(e.dir, "ahora"), docsDe(e.dir, "final"))) tam[id] = revisarDoc(id, d);
  t.diagnostic(JSON.stringify(tam));
  assert.deepEqual(Object.keys(tam).sort(), ["bitacora-2026-11-02", "bitacora-mes-2026-11", "cartera-libro", "etoro-mapa", "ops-2026-10-30", "ops-2026-11-02", "punto-2026-10-30", "punto-2026-11-02",
    "radar-2026-11-02", "rutina-config", "rutina-estado"]);
});

// caso grande: 12 lotes, 5 pendientes, 8 notas largas, 15 decisiones, 12 órdenes simuladas
const SYMS = [["SPY", 3000], ["DIA", 3026], ["XLF", 3004], ["XLE", 3008], ["QQQ", 3006], ["IWM", 3005], ["TLT", 3020], ["GLD", 3025], ["VWO", 3022], ["EFA", 3023], ["XLK", 3021]];
function libroGrande(base) {
  const L = copia(base);
  L.posiciones = SYMS.map(([sym, instrumentId], i) => ({ sym, instrumentId, lotes: [{ positionId: 2700000000 + i, orderId: 391500000 + i, unidades: 12.345678 + i, costoUSD: 1234.56 + i, abiertaEl: "2026-11-02T15:01:02Z" }] }));
  L.posiciones[0].lotes.push({ positionId: 2700000099, orderId: null, unidades: 3.141593, costoUSD: 2345.67, abiertaEl: "2026-11-03T15:01:02Z" });
  L.pendientes = Array.from({ length: 5 }, (_, i) => ({ opId: `2026-11-0${2 + (i % 2)}-${SYMS[i][0]}-${i % 2 ? "V1" : "C1"}`, dia: `2026-11-0${2 + (i % 2)}`, orderId: 391600000 + i, sym: SYMS[i][0], instrumentId: SYMS[i][1],
    lado: i % 2 ? "venta" : "compra", montoUSD: i % 2 ? null : 1500.25, unidades: i % 2 ? 1.234567 : null, positionId: i % 2 ? 2700000000 + i : null, enviadaEl: "2026-11-02T15:04:05Z", estado: i % 3 ? "aceptada" : "incierta" }));
  L.fueraDelObjetivo = { QQQ: { desde: "2026-11-01", dias: 2 }, TLT: { desde: "2026-11-02", dias: 1 }, GLD: { desde: "2026-10-29", dias: 2 } };
  return L;
}
const largo = (p, n) => (p + " ").repeat(Math.ceil(n / (p.length + 1))).slice(0, n);

async function casoGrande(nOrdenes) {
  const e = await prepararDia({});
  const c = leerTrabajo(e.dir, "cartera.json");
  const libro = libroGrande(c.libro);
  const tasas = SYMS.map(([sym, id], i) => ({ instrumentID: id, bid: 100.123 + i * 37.77, ask: 100.2 + i * 37.77, date: new Date(e.t + 60000).toISOString() })).concat([{ instrumentID: 63, bid: 18.7, ask: 18.72, date: new Date(e.t).toISOString() }]);
  const valuacion = valuar({ libro, tasas, fx: { valor: 18.7012, fuente: "etoro" }, at: e.t + 60000 });
  libro.precios = valuacion.precios; delete valuacion.alertas;
  const filas = Object.fromEntries(OUT30.rows.map(r => [r.symbol, r]));
  escribirTrabajo(e.dir, "cartera.json", Object.assign(c, { libro, valuacion, composicion: composicion({ valuacion, libro, filas }) }));
  const d = leerTrabajo(e.dir, "decisiones.json");
  d.decisiones = Array.from({ length: 15 }, (_, i) => ({ sym: SYMS[i % 11][0] + (i >= 11 ? "X" : ""), regla: ["V1", "R1", "C1", null][i % 4], accion: ["vender", "comprar", "comprar", "mantener"][i % 4], lado: null,
    pesoActual: 0.123456789 + i / 1000, pesoObjetivo: 0.0987654321, desvPts: 2.4691357 + i, montoUSD: i % 4 === 3 ? null : 1234.5678 + i, motivo: largo("Motivo largo de la decisión número " + i, 300), razonOmision: null, noticias: [] }));
  escribirTrabajo(e.dir, "decisiones.json", d);
  const plan = Array.from({ length: nOrdenes }, (_, i) => ({ id: `2026-11-02-${SYMS[i % 11][0]}${i >= 11 ? "X" : ""}-${i % 2 ? "C1" : "V1"}`, orden: i + 1, sym: SYMS[i % 11][0], instrumentId: SYMS[i % 11][1], lado: i % 2 ? "compra" : "venta",
    regla: i % 2 ? "C1" : "V1", montoUSD: i % 2 ? 1234.56 : null, cierres: i % 2 ? null : [{ positionId: 2700000000 + (i % 11), unidades: null }], motivo: largo("Motivo de la orden " + i, 200), noticias: ["https://www.cnbc.com/a", "https://www.bloomberg.com/b"], requestIds: ["x"] }));
  escribirTrabajo(e.dir, "plan-ordenes.json", { fecha: "2026-11-02", simulacion: true, ordenes: plan });
  fs.writeFileSync(path.join(e.dir, "entrada/noticias.json"), JSON.stringify({ v: 1, generadoEl: "x", notas: Array.from({ length: 8 }, (_, i) => ({ id: "n" + i,
    titulo: largo("Título largo de la nota " + i, 200), medio: "x", url: `https://www.cnbc.com/2026/11/02/una-ruta-bastante-larga-de-la-nota-numero-${i}-con-palabras.html`, fecha: "2026-11-02",
    tema: "mercado", simbolos: ["SPY"], resumen: largo("Resumen largo con hechos de la nota " + i, 280), evento: null })) }));
  const r = await cerrar(["--dir", e.dir], { ahora: () => e.t + 900000 });
  assert.equal(r.codigo, 0); assert.equal(r.linea.resumen.minimo, undefined);
  return Object.fromEntries(docsDe(e.dir, "final"));
}

test("caso grande (12 lotes, 5 pend, 8 notas, 15 decisiones, 7 órdenes): todo valida y respeta §E.3; todo salvo cartera-libro cabe en su tope", async t => {
  const fin = await casoGrande(7), tam = {};
  for (const [id, x] of Object.entries(fin)) tam[id] = revisarDoc(id, x, { sinTope: id === "cartera-libro" });
  t.diagnostic(JSON.stringify(tam));
  assert.equal(fin["cartera-libro"].lotes.length, 12); assert.equal(fin["cartera-libro"].pend.length, 5);
  assert.equal(fin["ops-2026-11-02"].ops.length, 7);
  const b = fin["bitacora-2026-11-02"];
  // se recortó en el orden de §E.5.7: las 12 decisiones activas siguen; las "mantener" fueron lo primero que salió de dec
  assert.equal(b.dec.filter(d => d[2] !== "mantener").length, 12); assert.equal(b.notas.length, 4);
});

// DESVÍO 4 (reporte 16): 12 lotes + 5 pendientes con la forma de §E.5.3 no caben en los 2 500 B de cartera-libro
test("cartera-libro con 12 lotes y 5 pendientes cabe en su tope", { todo: "DESVÍO 4: tope de cartera-libro (2 500 B) menor que 12 lotes + 5 pend" }, async t => {
  const fin = await casoGrande(7);
  t.diagnostic(`cartera-libro con 12 lotes y 5 pend: ${bytes(conH(fin["cartera-libro"]))} B`);
  revisarDoc("cartera-libro", fin["cartera-libro"]);
});

// DESVÍO 3 (reporte 16): con maxOrdenesDia = 12 y mot ≤ 120, ops-<hoy> no cabe en los 3 000 B de §E.5
test("ops-<hoy> con 12 órdenes cabe en su tope", { todo: "DESVÍO 3: tope de ops-<f> (3 000 B) menor que 12 órdenes con mot ≤ 120" }, async t => {
  const fin = await casoGrande(12);
  t.diagnostic(`ops-2026-11-02 con 12 órdenes: ${bytes(conH(fin["ops-2026-11-02"]))} B`);
  revisarDoc("ops-2026-11-02", fin["ops-2026-11-02"]);
});

test("recorte de la bitácora en el orden de §E.5.7: notas 8 → 4, resúmenes → 120, dec mantener, comp.sector", () => {
  const nota = (i, n) => [largo("Título " + i, 160), "CNBC", `https://www.cnbc.com/${i}`, "2026-11-02", "mercado", largo("Resumen " + i, n)];
  const dec = (i, a) => [`S${i}`, a === "mantener" ? null : "R1", a, 0.1234, 0.1, 2.34, a === "mantener" ? null : 100, largo("Motivo " + i, 120)];
  const notas = (k, n) => Array.from({ length: k }, (_, i) => nota(i, n));
  const decs = Array.from({ length: 12 }, (_, i) => dec(i, i < 9 ? "mantener" : "vender")), vender = decs.slice(9);
  const sector = Array.from({ length: 30 }, (_, i) => ["Sector largo número " + i, 0.0333]);
  const base = (o = {}) => Object.assign({ kind: "bitacora", v: 2, f: "2026-11-02", t: "2026-11-02T15:00:00Z", estado: "completa", sim: true, commit: null, modo: "en_linea", mercado: {}, radar: { estado: "listo", motivo: null },
    cartera: {}, rend: {}, comp: { clase: [["a", 1]], sector: [["s", 1]], region: [["r", 1]] }, notas: notas(8, 200), eventos: [], vetos: [], dec: [], ops: [], alertas: [], errores: [], aviso: "x" }, o);
  const TOPE = DOC_TOPES.bitacora - 40, tam = b => bytes(conH(b)), cabe = b => bytes(conH(b)) <= DOC_TOPES.bitacora;
  // relleno mínimo (en el aviso) para que la etapa anterior al recorte esperado no alcance
  const relleno = antes => { let n = 0; while (tam(antes(largo("aviso", n))) <= TOPE) n += 10; return largo("aviso", n); };
  // 1. con 8 notas no cabe; con 4 sí → solo se recortan las notas
  const a = recortarBitacora(base({ aviso: relleno(av => base({ aviso: av })) }));
  assert.ok(cabe(a)); assert.equal(a.notas.length, 4); assert.equal(a.notas[0][5].length, 200);
  // 2. con 4 notas tampoco cabe → resúmenes a 120; dec intacto
  const r2 = relleno(av => base({ aviso: av, notas: notas(4, 200), dec: [dec(1, "mantener")] }));
  const b = recortarBitacora(base({ aviso: r2, dec: [dec(1, "mantener")] }));
  assert.ok(cabe(b)); assert.equal(b.notas.length, 4); assert.ok(b.notas.every(n => n[5].length <= 120)); assert.equal(b.dec.length, 1);
  // 3. ni así → fuera las decisiones "mantener"; comp.sector intacto
  const r3 = relleno(av => base({ aviso: av, notas: notas(4, 120), dec: decs }));
  const c = recortarBitacora(base({ aviso: r3, dec: decs }));
  assert.ok(cabe(c)); assert.deepEqual(c.dec.map(x => x[2]), ["vender", "vender", "vender"]); assert.deepEqual(c.comp.sector, [["s", 1]]);
  // 4. ni así → fuera comp.sector
  const comp = { clase: [["a", 1]], sector, region: [["r", 1]] };
  const r4 = relleno(av => base({ aviso: av, notas: notas(4, 120), dec: vender, comp }));
  const d = recortarBitacora(base({ aviso: r4, dec: decs, comp }));
  assert.ok(cabe(d)); assert.equal(d.comp.sector, undefined); assert.equal(d.dec.length, 3); assert.equal(d.notas.length, 4); assert.deepEqual(d.comp.clase, [["a", 1]]);
});
