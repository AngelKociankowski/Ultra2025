// D7 (00q §3) · PushNotification pide una línea de ≤ 200 caracteres: 60-cerrar escribe además salida/aviso-push.txt (valor USD y
// %, MXN y %, vs SPY, Radar sí/no, operaciones); el aviso completo sigue en aviso.txt para el chat.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { armarAviso, armarPush, lineaPush, pushConFalla, MAX_PUSH } from "../lib/aviso.mjs";
import { escribirAviso, leerTrabajo } from "../lib/archivos.mjs";
import { verificarEstado, FALLA_PUSH_REVISION } from "../lib/db.mjs";
import { main as preparar } from "../bin/00-preparar.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { prepararDia, abrirDia, dbInicial, LUNES } from "./escenario.mjs";
import { carpetaTemporal } from "./util.mjs";

const unaLinea = s => typeof s === "string" && s.length >= 1 && s.length <= MAX_PUSH && [...s].length <= MAX_PUSH && !s.includes("\n");
const leer = (dir, f) => fs.readFileSync(path.join(dir, "salida", f), "utf8");
// las cifras del aviso real del lunes 2-nov (bitácora de db: rend del día, cartera 32 108.89 / 596 210.71, sin Radar)
const LUNES_REAL = { fecha: "2026-11-02", hora: "10:59", simulacion: true, cartera: { valorUSD: 32108.89, valorMXN: 596210.71 },
  rend: { usd: [0.004687, 0.004687, 0.004687, 0.004687, 0.004687, null], mxn: [-0.006315, -0.006315, -0.006315, -0.006315, -0.006315, null],
    spy: [0.010275, 0.010275, 0.010275, 0.010275, 0.010275, null], meta: [31995.8, 0.35, 600689.16, -0.75] },
  radar: { sinRadar: true, motivo: "policy" }, notas: [], operaciones: [], alertas: [], fallas: [] };

test("lunes real: una línea con valor USD y %, MXN y %, vs SPY, Radar sí/no y operaciones (las mismas cifras del aviso)", () => {
  const p = armarPush(LUNES_REAL), aviso = armarAviso(LUNES_REAL);
  assert.equal(p, "Radar · lun 2-nov · SIM · US$ 32,109 (+0.47 % hoy) · MXN $ 596,211 (−0.63 % hoy) · vs SPY desde inicio −0.56 % · Sin Radar · Ops: ninguna");
  assert.ok(unaLinea(p));
  for (const x of ["US$ 32,109", "+0.47 %", "MXN $ 596,211", "−0.63 %", "vs SPY desde inicio: −0.56 %"]) assert.ok(aviso.includes(x), x);
  // con Radar y operaciones simuladas
  const sim = armarPush(Object.assign({}, LUNES_REAL, { radar: { regimen: "alcista", cambios: [] },
    operaciones: [{ sym: "XLE", lado: "venta", regla: "V1", est: "simulada" }, { sym: "QQQ", lado: "compra", regla: "C1", est: "simulada" }] }));
  assert.match(sim, / · Radar hoy · Ops: 2 simuladas \(vender XLE, comprar QQQ\)$/);
});

test("órdenes reales: hechas, enviadas, sin confirmar y sin ejecutar; el peor caso (12 órdenes, cifras grandes, fallas) cabe en 200", () => {
  const ops = [{ sym: "SPY", lado: "compra", est: "ejecutada" }, { sym: "XLE", lado: "venta", est: "aceptada" }, { sym: "DIA", lado: "compra", est: "incierta" }, { sym: "QQQ", lado: "compra", est: "rechazada", motivo: "x" }];
  const p = armarPush(Object.assign({}, LUNES_REAL, { simulacion: false, radar: { regimen: "alcista" }, operaciones: ops }));
  assert.match(p, /^Radar · lun 2-nov · US\$ /);
  // el detalle entra hasta donde cabe
  assert.equal(p, "Radar · lun 2-nov · US$ 32,109 (+0.47 % hoy) · MXN $ 596,211 (−0.63 % hoy) · vs SPY desde inicio −0.56 % · Radar hoy · Ops: 3, 1 sin ejecutar (compré SPY, venta XLE enviada, …)");
  assert.ok(unaLinea(p));
  const pocas = armarPush(Object.assign({}, LUNES_REAL, { simulacion: false, cartera: null, operaciones: ops }));
  assert.equal(pocas, "Radar · lun 2-nov · sin valuación · Sin Radar · Ops: 3, 1 sin ejecutar (compré SPY, venta XLE enviada, compra DIA sin confirmar, QQQ sin ejecutar)");
  const muchas = Array.from({ length: 12 }, (_, i) => ({ sym: `SIMBOLO${i}`, lado: i % 2 ? "venta" : "compra", est: i < 9 ? "ejecutada" : "rechazada" }));
  const grande = Object.assign({}, LUNES_REAL, { fecha: "2026-11-25", simulacion: false, cartera: { valorUSD: 12345678.9, valorMXN: 234567890.12 },
    rend: { usd: [-0.123456, 0, 0, 0, -0.234567], mxn: [-0.345678, 0, 0, 0, 0], spy: [0, 0, 0, 0, 0.456789] }, radar: { regimen: "x" }, operaciones: muchas,
    fallas: [{ paso: "20-cartera", texto: "x" }, { paso: "30-fmp-noticias", texto: "y" }, { paso: "cerrar", texto: "z" }] });
  const g = armarPush(grande);
  assert.ok(unaLinea(g), `${g.length}: ${g}`);
  assert.match(g, / · Ops: 9, 3 sin ejecutar · Falla: 20-cartera, 30-fmp-noticias, cerrar$/); // sin detalle: no cabe ni uno
  assert.match(g, /US\$ 12,345,679 \(−12\.35 % hoy\) · MXN \$ 234,567,890 \(−34\.57 % hoy\) · vs SPY desde inicio −69\.14 %/);
  // sin valuación (degradado) y con push agregado de una falla
  const sinV = armarPush({ fecha: "2026-11-02", simulacion: true, cartera: null, radar: null, operaciones: [], fallas: [{ paso: "cerrar", texto: "x" }] });
  assert.equal(sinV, "Radar · lun 2-nov · SIM · sin valuación · Sin Radar · Ops: ninguna · Falla: cerrar");
  assert.ok(unaLinea(pushConFalla(g, FALLA_PUSH_REVISION)) && pushConFalla(g, FALLA_PUSH_REVISION).endsWith(FALLA_PUSH_REVISION));
  assert.equal(lineaPush("a\n\nb"), "a · b");
  assert.throws(() => escribirAviso(carpetaTemporal(), "x", "dos\nlíneas"), e => e.codigo === "aviso");
  assert.throws(() => escribirAviso(carpetaTemporal(), "x", "y".repeat(201)), e => e.codigo === "aviso");
});

test("60-cerrar deja aviso-push.txt junto al aviso (día normal y cierre degradado); 00-preparar al salir deja la misma línea", async () => {
  const e = await prepararDia({ sinRadar: true });
  assert.equal((await cerrar(["--dir", e.dir], { ahora: () => LUNES + 15 * 60000 })).codigo, 0);
  const p = leer(e.dir, "aviso-push.txt"), aviso = leer(e.dir, "aviso.txt");
  assert.ok(unaLinea(p)); assert.ok(aviso.includes("\n"));
  assert.match(p, /^Radar · lun 2-nov · SIM · US\$ [\d,]+ \([+−]\d+\.\d\d % hoy\) · MXN \$ [\d,]+ \([+−]\d+\.\d\d % hoy\) · .*Sin Radar · Ops: ninguna$/);
  const usd = aviso.match(/US\$ [\d,]+/)[0];
  assert.ok(p.includes(usd), "mismo valor que el aviso");
  // degradado: el cierre dice la falla también en el push
  await cerrar(["--dir", e.dir, "--degradado", "20-cartera"], { ahora: () => LUNES + 16 * 60000 });
  assert.match(leer(e.dir, "aviso-push.txt"), /Falla: 20-cartera/);
  assert.ok(unaLinea(leer(e.dir, "aviso-push.txt")));
  // fin de semana: el aviso es una línea y el push es esa misma línea
  const d = await abrirDia({ db: dbInicial(), t: Date.parse("2026-11-01T15:00:00Z") });
  assert.equal(d.preparar.codigo, 2);
  assert.equal(leer(d.dir, "aviso-push.txt"), leer(d.dir, "aviso.txt"));
  assert.equal(leer(d.dir, "aviso-push.txt"), "Radar · dom 1-nov · Fin de semana: sin operación.");
});

test("si lo releído tras escribir no cuadra (N-5b), el push también dice que el día quedó marcado", async () => {
  const e = await prepararDia({ sinRadar: true });
  await cerrar(["--dir", e.dir], { ahora: () => LUNES + 15 * 60000 });
  assert.equal(e.S.escribir("final").accion, "listo");
  // otro escritor cambia cartera-libro después del final: la relectura no cuadra
  const libro = Object.assign({}, e.db.doc("cartera-libro"), { efectivo: 9.99 });
  e.db.docs.get([...e.db.docs.keys()].find(k => k.endsWith("/cartera-libro"))).data = libro;
  e.S.leer(leerTrabajo(e.dir, "verificar.json").lecturas);
  const v = verificarEstado(e.dir);
  assert.equal(v.accion, "marcar");
  const p = leer(e.dir, "aviso-push.txt");
  assert.ok(unaLinea(p)); assert.ok(p.endsWith(` · ${FALLA_PUSH_REVISION}`)); assert.match(p, /^Radar · lun 2-nov/);
  // una segunda verificación no la repite
  verificarEstado(e.dir);
  assert.equal(leer(e.dir, "aviso-push.txt"), p);
});
