// N4 · x04 del tester B5 (17): el h de un documento armado por la rutina sobrevive el viaje por db aunque el objeto en memoria
// traiga undefined, Date, NaN o -0; una posición de eToro sin openDateTime no deja cartera-libro "corrupto" al día siguiente
import test from "node:test";
import assert from "node:assert/strict";
import { canon, conH, hOk, leerVersiones } from "../lib/db.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { prepararDia, abrirDia, dbInicial, copia } from "./escenario.mjs";
import { leerFix, leerSalida } from "./util.mjs";

const viaje = x => JSON.parse(JSON.stringify(x));

test("x04 · canon = canon de la forma JSON; conH devuelve esa forma y su h vale tras el viaje", () => {
  for (const d of [{ kind: "carteraPunto", a: [1, undefined, 3] }, { kind: "x", a: 1, b: undefined }, { kind: "x", a: NaN, b: Infinity, c: -0 }, { kind: "x", a: new Date(0) }, { kind: "x", f: () => 1, n: { u: undefined } }]) {
    assert.equal(canon(d), canon(viaje(d)));
    const c = conH(d);
    assert.ok(hOk(viaje(c)), JSON.stringify(viaje(d))); assert.ok(hOk(c));
    assert.deepEqual(c, viaje(c), "lo que se escribe es JSON puro");
  }
  assert.equal(canon({ a: [1, undefined, 3], b: undefined }), '{"a":[1,null,3]}');
});

test("x04 · lunes con posiciones sin openDateTime: final se escribe; al día siguiente cartera-libro se importa ok y el día continúa", async () => {
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  for (const p of pf.clientPortfolio.positions) delete p.openDateTime;
  const db = dbInicial({});
  const d = await prepararDia({ db, portafolio: pf });
  await cerrar(["--dir", d.dir], { ahora: () => d.t + 15 * 60000 });
  const libro = leerSalida(d.dir, "salida/final/db_write.json").ops.find(o => o.path.endsWith("/cartera-libro")).data;
  assert.equal(libro.lotes.length, 5);
  assert.ok(libro.lotes.every(l => l.length === 7 && l[6] !== undefined), JSON.stringify(libro.lotes[0]));
  assert.equal(d.S.escribir("final").accion, "listo");
  const d2 = await abrirDia({ db, t: Date.parse("2026-11-03T14:47:00Z"), raiz: d.raiz });
  assert.equal(leerVersiones(d2.dir)["cartera-libro"].estado, "ok");
  assert.equal(d2.preparar.linea.accion, "continuar");
});
