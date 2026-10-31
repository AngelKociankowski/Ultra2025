// N8 (00o) · día de 12 órdenes reales (6 ventas de 2 lotes + 6 compras = 18 líneas) de punta a punta con el db falso: el cierre
// de ejecucion-<hoy> cabe en su tope (4 000 B), verificar relee libro y ejecución, y el presupuesto medido del día es ≤ 40 000 B
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { shaArchivo } from "../bin/40-decidir.mjs";
import { escribirTrabajo, leerTrabajo } from "../lib/archivos.mjs";
import { bytes, conH } from "../lib/db.mjs";
import { requestIdDe } from "../lib/reglas.mjs";
import { semilla } from "../lib/libro.mjs";
import { DOC_TOPES } from "../lib/constantes.mjs";
import { prepararDia, dbInicial, LUNES, copia, tasasA } from "./escenario.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { ejecutar, reloj, sinEspera } from "./ejecucion.mjs";
import { leerFix } from "./util.mjs";

const F = "2026-11-02";
// 7 lotes más en el libro (con los 5 de las órdenes del 30-oct quedan 12: 2 por símbolo)
const EXTRA = [["DIA", 3026, 2700000001, 5, 2600], ["XLF", 3004, 2700000002, 50, 2800], ["XLE", 3008, 2700000003, 20, 1400], ["QQQ", 3006, 2700000004, 2, 1300],
  ["QQQ", 3006, 2700000005, 1.5, 1000], ["IWM", 3005, 2700000006, 4, 1100], ["IWM", 3005, 2700000007, 3, 830]];
const PRECIOS = { 3000: 758.2, 3026: 518.4, 3004: 56.51, 3008: 70.1, 3006: 690, 3005: 280, 3021: 250, 3009: 90, 4252: 48, 3020: 82, 3025: 355, 4430: 30 };
const COMPRAS = [["XLK", 3021], ["EFA", 3009], ["VWO", 4252], ["TLT", 3020], ["GLD", 3025], ["SLV", 4430]];
const NOTAS = { v: 1, generadoEl: "x", notas: Array.from({ length: 8 }, (_, i) => ({ id: "n" + i, titulo: "Fed mantiene tasas mientras la inflación se modera en EE. UU. " + i, medio: "x",
  url: `https://www.cnbc.com/2026/11/02/nota-${i}.html`, fecha: F, tema: i < 3 ? "macro" : "mercado", simbolos: [], evento: null,
  resumen: "La Reserva Federal mantuvo su tasa sin cambios y señaló que vigilará los datos de empleo e inflación antes de su próxima reunión." })) };

function eToro(t) {
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  for (const [, i, pos, u, usd] of EXTRA) pf.clientPortfolio.positions.push({ positionID: pos, orderID: pos - 1000, instrumentID: i, units: u, amount: usd, openRate: usd / u, openDateTime: "2026-10-20T15:00:00Z", isBuy: true, leverage: 1 });
  let n = 0;
  const tr = etoroFalso({ portafolio: () => pf, tasas: tasasA(Object.entries(PRECIOS).map(([i, p]) => ({ instrumentID: Number(i), bid: p, ask: p + 0.05 })).concat([{ instrumentID: 63, bid: 18.7, ask: 18.72 }]), t),
    historial: pf.clientPortfolio.positions.map(p => ({ positionId: p.positionID, closeRate: PRECIOS[p.instrumentID] })),
    post: req => {
      n++;
      const c = JSON.parse(req.cuerpo), m = new URL(req.url).pathname.match(/positions\/(\d+)$/);
      if (m) {
        const id = Number(m[1]), k = pf.clientPortfolio.positions.findIndex(p => p.positionID === id);
        if (c.UnitsToDeduct === null) pf.clientPortfolio.positions.splice(k, 1); else pf.clientPortfolio.positions[k].units = Math.round((pf.clientPortfolio.positions[k].units - c.UnitsToDeduct) * 1e6) / 1e6;
        return { http: 200, texto: JSON.stringify({ orderForClose: { positionID: id, orderID: 5000 + n } }) };
      }
      const px = PRECIOS[c.instrumentId];
      pf.clientPortfolio.positions.push({ positionID: 2800000000 + n, orderID: 6000 + n, instrumentID: c.instrumentId, units: Math.floor(c.amount / px * 1e6) / 1e6, amount: c.amount, openRate: px,
        openDateTime: new Date(t + 11 * 60000 + n * 1000).toISOString(), isBuy: true, leverage: 1 });
      return { http: 200, texto: JSON.stringify({ token: "00000000-0000-4000-8000-0000000000f1", orderId: 6000 + n, referenceId: "00000000-0000-4000-8000-0000000000f2" }) };
    } });
  return tr;
}

test("N8 · 12 órdenes reales: 18 líneas, cierre de ejecucion ≤ 4 000 B, verificar ok y presupuesto ≤ 40 000 B", { timeout: 300000 }, async t => {
  const s = semilla();
  const libro = Object.assign(s["cartera-libro"], { efectivo: 20000 });
  for (const [sym, i, pos, u, usd] of EXTRA) libro.lotes.push([sym, i, pos, pos - 1000, u, usd, "2026-10-20T15:00:00Z"]);
  const db = dbInicial({ "cartera-libro": libro, "rutina-config": Object.assign(s["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) });
  const e = await prepararDia({ db, notas: NOTAS, etoro: eToro(LUNES) });
  const c = leerTrabajo(e.dir, "cartera.json");
  assert.equal(c.libro.posiciones.flatMap(p => p.lotes).length, 12);
  // plan de 12 órdenes (como el que dejaría 40-decidir con su huella)
  const orden = (o, k) => Object.assign({ orden: k + 1, noticias: [], requestIds: (o.cierres || [0]).map((_, j) => requestIdDe(F, o.id, j)) }, o);
  const ventas = c.libro.posiciones.map(p => ({ id: `${F}-${p.sym}-R1`, sym: p.sym, instrumentId: p.instrumentId, lado: "venta", regla: "R1", montoUSD: null, motivo: "Desviación de −6.20 pts contra el objetivo",
    cierres: [{ positionId: p.lotes[0].positionId, unidades: null }, { positionId: p.lotes[1].positionId, unidades: Math.floor(p.lotes[1].unidades / 2 * 1e6) / 1e6 }] }));
  const compras = COMPRAS.map(([sym, i]) => ({ id: `${F}-${sym}-C1`, sym, instrumentId: i, lado: "compra", regla: "C1", montoUSD: 1000, cierres: null, motivo: "Entra al objetivo con 3.1 % (Satélite, señal Compra 61 %)" }));
  const plan = ventas.concat(compras).map(orden);
  assert.equal(plan.length, 12);
  escribirTrabajo(e.dir, "plan-ordenes.json", { fecha: F, simulacion: false, ordenes: plan });
  escribirTrabajo(e.dir, "decisiones.json", Object.assign(leerTrabajo(e.dir, "decisiones.json"), { simulacion: false, planSha: shaArchivo(path.join(e.dir, "trabajo/plan-ordenes.json")) }));
  const ahora = reloj(new Date(LUNES + 11 * 60000).toISOString()), et = eToro(LUNES + 11 * 60000), op = { transporteEToro: et, ahora, dormir: sinEspera };
  assert.equal((await ejecutar(["--dir", e.dir, "--armar"], op)).linea.accion, "armado");
  assert.equal(leerTrabajo(e.dir, "ejecucion-doc.json").lineas.length, 18);
  assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
  const r = await ejecutar(["--dir", e.dir, "--enviar"], op);
  assert.equal(r.codigo, 0);
  assert.equal(et.llamadas.filter(x => x.metodo === "POST").length, 18);
  assert.ok(leerTrabajo(e.dir, "ejecucion.json").res.every(x => x.est === "ejecutada"), JSON.stringify(leerTrabajo(e.dir, "ejecucion.json").res.map(x => x.est)));
  await cerrar(["--dir", e.dir], { ahora: () => LUNES + 25 * 60000 });
  assert.equal(e.S.escribir("final").accion, "listo");
  const ej = db.doc(`ejecucion-${F}`);
  t.diagnostic(`ejecucion-${F}: reclamo ${bytes(conH(leerTrabajo(e.dir, "ejecucion-doc.json")))} B · cierre ${bytes(ej)} B (tope ${DOC_TOPES.ejecucion})`);
  assert.deepEqual(ej.lineas, []); assert.equal(ej.res.length, 18); assert.ok(bytes(ej) <= DOC_TOPES.ejecucion, `${bytes(ej)} B`);
  e.S.leer(leerTrabajo(e.dir, "verificar.json").lecturas);
  assert.deepEqual(leerTrabajo(e.dir, "verificar.json").lecturas.map(l => l.id), ["rutina-estado", "cartera-libro", `ejecucion-${F}`]);
  assert.equal((await dbCli(["verificar", "--dir", e.dir])).codigo, 0);
  const p = (await dbCli(["presupuesto", "--dir", e.dir])).linea.resumen;
  t.diagnostic(`presupuesto del día de 12 órdenes: ${JSON.stringify({ total: p.total, leidos: p.leidos, escritos: p.escritos })}`);
  assert.ok(p.total <= 40000, `${p.total} B`);
  for (const id of ["cartera-libro", `ops-${F}`, "bitacora-2026-11-02"]) assert.ok(bytes(db.doc(id)) <= DOC_TOPES[db.doc(id).kind], `${id}: ${bytes(db.doc(id))} B`);
});
