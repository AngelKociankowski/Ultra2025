// D7 (00q §2) · Bug medio del lunes real: eToro llenó las 5 compras iniciales por 31 946.00 de 31 958.53 pedidos y devolvió
// 12.53 a su efectivo; el libro dejó el efectivo en 0.56. Lo que eToro no usa de una compra vuelve al efectivo al conciliarla, y
// el libro v2 que quedó en db el lunes queda en 13.09 en la corrida siguiente (una sola vez).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { semilla, libroDeDb, libroADb, conciliar, aplicarResultados, corregirEfectivoInicial, opsNuevo } from "../lib/libro.mjs";
import { conH, hOk } from "../lib/db.mjs";
import { DB_SLUG, DB_RUTA } from "../lib/constantes.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { prepararDia, dbInicial } from "./escenario.mjs";
import { leerFix } from "./util.mjs";

const REAL = leerFix("etoro/lunes-real-portfolio.json");
const LIBRO_V2 = leerFix("db/lunes-real-libro-v2.json"), ESTADO_V2 = leerFix("db/lunes-real-estado-v2.json");
const LUNES_REAL = Date.parse("2026-11-02T15:57:00Z");
const S = semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") });
const cuadre = L => Math.round((L.mandato.baseUSD + L.realizadoUSD - L.posiciones.flatMap(p => p.lotes).reduce((a, l) => a + l.costoUSD, 0)
  - L.pendientes.filter(x => x.lado === "compra").reduce((a, x) => a + x.montoUSD, 0)) * 100) / 100;

test("lunes real: las 5 compras iniciales casan por orderID y vuelven 12.53 al efectivo (0.56 → 13.09)", () => {
  const c = conciliar({ libro: libroDeDb(S["cartera-libro"]).libro, portafolio: REAL, historial: [], ahora: LUNES_REAL, ops: S["ops-2026-10-30"].ops });
  assert.deepEqual(c.alertas, []);
  assert.deepEqual(c.eventos.map(e => [e.tipo, e.sym, e.ejecucion.montoUSD]), [["ejecutada", "SPY", 499.93], ["ejecutada", "SPY", 20262.4], ["ejecutada", "DIA", 6164.59], ["ejecutada", "XLF", 3131.46], ["ejecutada", "XLE", 1887.62]]);
  assert.equal(c.libro.pendientes.length, 0);
  assert.equal(c.libro.efectivoUSD, 13.09);
  assert.equal(cuadre(c.libro), 13.09, "efectivo = base + realizado − costo de los lotes − compras pendientes");
  // los lotes son los mismos que quedaron en db el lunes; solo cambia el efectivo
  const db = libroADb(c.libro, Date.parse(LIBRO_V2.at));
  assert.deepEqual(db.lotes, LIBRO_V2.lotes);
  assert.deepEqual([db.efectivo, LIBRO_V2.efectivo], [13.09, 0.56]);
  // la respuesta de pnl del mismo lunes trae las mismas posiciones: mismo resultado
  const pnl = conciliar({ libro: libroDeDb(S["cartera-libro"]).libro, portafolio: leerFix("etoro/lunes-real-pnl.json"), historial: [], ahora: LUNES_REAL });
  assert.deepEqual([pnl.libro.efectivoUSD, libroADb(pnl.libro, Date.parse(LIBRO_V2.at)).lotes], [13.09, LIBRO_V2.lotes]);
  // y la migración no vuelve a sumar sobre un libro ya cuadrado
  assert.equal(corregirEfectivoInicial(c.libro).alerta, null);
  assert.equal(corregirEfectivoInicial(c.libro).libro.efectivoUSD, 13.09);
});

test("cualquier compra pendiente: llenada por menos devuelve la diferencia; llenada por más la descuenta", () => {
  const lunes = conciliar({ libro: libroDeDb(S["cartera-libro"]).libro, portafolio: REAL, historial: [], ahora: LUNES_REAL }).libro;
  const plan = [{ id: "2026-11-03-QQQ-C1", sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", motivo: "", montoUSD: 10, cierres: null, noticias: [] }];
  const enviada = aplicarResultados({ libro: lunes, opsHoy: opsNuevo("2026-11-03"), plan, simulacion: false, ahora: Date.parse("2026-11-03T15:00:00Z"),
    res: [{ id: "2026-11-03-QQQ-C1", k: 0, est: "aceptada", env: "2026-11-03T15:00:00Z", o: 390000101, usd: 10 }] }).libro;
  assert.deepEqual([enviada.efectivoUSD, cuadre(enviada)], [3.09, 3.09]); // 13.09 − 10.00 pedidos
  for (const [amount, efectivo] of [[9.95, 3.14], [10, 3.09], [10.02, 3.07]]) {
    const qqq = { positionID: 2600000101, orderID: 390000101, instrumentID: 3006, units: 0.02, amount, openDateTime: "2026-11-03T15:00:05Z" };
    const pf = { clientPortfolio: Object.assign({}, REAL.clientPortfolio, { positions: REAL.clientPortfolio.positions.concat([qqq]) }) };
    const c = conciliar({ libro: enviada, portafolio: pf, historial: [], ahora: Date.parse("2026-11-04T15:00:00Z") });
    assert.deepEqual(c.alertas, []);
    assert.deepEqual([c.libro.efectivoUSD, cuadre(c.libro)], [efectivo, efectivo], `llenada por ${amount}`);
  }
});

test("migración: el libro v2 que quedó en db el lunes (efectivo 0.56) queda en 13.09 en la corrida siguiente, y una sola vez", async () => {
  assert.deepEqual([LIBRO_V2.h, hOk(LIBRO_V2), ESTADO_V2.escritos["cartera-libro"]], ["524640a3a882822d", true, "524640a3a882822d"]);
  const db = dbInicial({ "cartera-libro": LIBRO_V2, "rutina-estado": ESTADO_V2 });
  // en db ambos van en su versión 2 (la de la escritura del lunes)
  db.write({ slug: DB_SLUG, ops: ["cartera-libro", "rutina-estado"].map(id => ({ op: "set", path: `${DB_RUTA}/${id}`, data: db.doc(id), ifVersion: 1 })) });
  assert.deepEqual([db.version("cartera-libro"), db.doc("cartera-libro").efectivo], [2, 0.56]);
  const correr = async t => {
    const e = await prepararDia({ db, t, portafolio: REAL, sinRadar: true });
    assert.equal(e.preparar.codigo, 0);
    await cerrar(["--dir", e.dir], { ahora: () => t + 15 * 60000 });
    assert.equal(e.S.escribir("final").accion, "listo");
    e.S.leer(leerTrabajo(e.dir, "verificar.json").lecturas);
    assert.equal((await dbCli(["verificar", "--dir", e.dir])).codigo, 0);
    return { e, cartera: leerTrabajo(e.dir, "cartera.json"), final: JSON.parse(fs.readFileSync(path.join(e.dir, "salida/final/cartera-libro.json"), "utf8")) };
  };
  const mar = await correr(Date.parse("2026-11-03T14:50:00Z"));
  assert.equal(mar.cartera.libro.efectivoUSD, 13.09);
  assert.ok(mar.cartera.alertas.includes("Efectivo corregido: +US$ 12.53 que eToro no usó de las compras iniciales (se llenaron por menos de lo pedido)."));
  assert.equal(mar.final.efectivo, 13.09); assert.deepEqual(mar.final.lotes, LIBRO_V2.lotes);
  assert.deepEqual([db.version("cartera-libro"), db.doc("cartera-libro").efectivo], [3, 13.09]);
  assert.match(fs.readFileSync(path.join(mar.e.dir, "salida/aviso.txt"), "utf8"), /Efectivo corregido: \+US\$ 12\.53/);
  const mie = await correr(Date.parse("2026-11-04T14:50:00Z"));
  assert.equal(mie.cartera.libro.efectivoUSD, 13.09);
  assert.ok(!mie.cartera.alertas.some(a => /Efectivo corregido/.test(a)));
  assert.deepEqual([db.version("cartera-libro"), db.doc("cartera-libro").efectivo], [4, 13.09]);
});

test("la migración no toca un libro que no tiene la diferencia exacta (semilla, otra cifra, sin lotes iniciales)", () => {
  const sem = libroDeDb(S["cartera-libro"]).libro;
  assert.equal(corregirEfectivoInicial(sem).alerta, null); // pendientes sin llenar: nada que devolver todavía
  const v2 = libroDeDb(LIBRO_V2).libro;
  for (const ef of [0.55, 0.57, 13.09]) assert.equal(corregirEfectivoInicial(Object.assign({}, v2, { efectivoUSD: ef })).alerta, null, String(ef));
  assert.equal(corregirEfectivoInicial(v2).libro.efectivoUSD, 13.09);
  assert.equal(v2.efectivoUSD, 0.56, "no muta el libro recibido");
  assert.equal(conH(libroADb(corregirEfectivoInicial(v2).libro, 1)).efectivo, 13.09);
});
