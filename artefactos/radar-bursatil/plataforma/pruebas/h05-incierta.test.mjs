// H05 · A3.3 portado (12b §F.3.5, §F.4): lo que tiene envío y no se resolvió es `incierta` (nunca cancelada), con efectivo
// provisional; de punta a punta en un día con db falso: --enviar muere tras el POST, --reanudar sin portafolio, 60-cerrar normal
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { ejecutar, diaReal, etoroGuion, reloj, posts, sinEspera, resDe, leerDiario, planDe } from "./ejecucion.mjs";
import { leerSalida } from "./util.mjs";

const F2 = "2026-11-02";
const QQQ = [Object.assign({}, planDe(F2)[2], { orden: 1 })];
const docDe = (dir, id) => leerSalida(dir, "salida/final/db_write.json").ops.find(o => o.path === `${DB_RUTA}/${id}`);

test("A3.3 · muere tras el POST; --reanudar con eToro caído → incierta (código 3); 60-cerrar: efectivo 3 500, pend incierta con env del diario, aviso sin 'compré'", async () => {
  const e = await diaReal({ plan: QQQ });
  const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base });
  const a = await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  assert.equal(a.linea.accion, "armado");
  assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
  let cortar = false;
  const muere = () => { if (cortar) throw new Error("proceso cortado"); return base(); };
  const tc = async req => { const r = await t(req); if (req.metodo === "POST") cortar = true; return r; };
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: tc, ahora: muere, dormir: sinEspera }), /proceso cortado/);
  const envio = leerDiario(e.dir).find(l => l.fase === "envio");
  const caido = transporteFalso(req => (req.url.endsWith("/demo/portfolio") ? { http: 503, texto: "" } : t(req)));
  const r = await ejecutar(["--dir", e.dir, "--reanudar"], { transporteEToro: caido, ahora: base, dormir: sinEspera });
  assert.deepEqual([r.codigo, r.linea.accion], [3, "incompleto"]);
  assert.deepEqual([resDe(e.dir)[0].est, resDe(e.dir)[0].env, resDe(e.dir)[0].usd], ["incierta", envio.t, 1500]);
  assert.equal(posts(t).length, 1);
  assert.equal((await cerrar(["--dir", e.dir], { ahora: () => e.t + 15 * 60000 })).codigo, 0);
  const libro = docDe(e.dir, "cartera-libro").data;
  assert.equal(libro.efectivo, 3500);
  assert.deepEqual(libro.pend.map(p => [p.id, p.est, p.env, p.usd, p.lado]), [[QQQ[0].id, "incierta", envio.t, 1500, "c"]]);
  assert.deepEqual(docDe(e.dir, `ops-${F2}`).data.ops.map(o => [o.id, o.est]), [[QQQ[0].id, "incierta"]]);
  const ej = docDe(e.dir, `ejecucion-${F2}`);
  assert.equal(ej.ifVersion, 1); assert.ok(ej.data.fin); assert.deepEqual(ej.data.res.map(x => x.est), ["incierta"]);
  const aviso = fs.readFileSync(path.join(e.dir, "salida/aviso.txt"), "utf8");
  assert.match(aviso, /Operaciones: 1 — compra QQQ sin confirmar/); assert.ok(!/compré/.test(aviso));
  assert.equal(e.S.escribir("final").accion, "listo");
});

test("A3.1 · enviada + --reanudar con el portafolio que no responde + cierre degradado → el libro conoce la compra (pend incierta, efectivo 3 500)", async () => {
  const e = await diaReal({ plan: QQQ });
  const base = reloj(new Date(e.t + 11 * 60000).toISOString()), t = etoroGuion({ reloj: base });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: t, ahora: base, dormir: sinEspera });
  e.S.escribir("pre-ejecucion");
  let cortar = false;
  await assert.rejects(() => ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: async q => { const r = await t(q); if (q.metodo === "POST") cortar = true; return r; }, ahora: () => { if (cortar) throw new Error("proceso cortado"); return base(); }, dormir: sinEspera }));
  const muerto = async q => { if (q.url.endsWith("/demo/portfolio")) throw new Error("sin respuesta"); return t(q); };
  const r = await ejecutar(["--dir", e.dir, "--reanudar"], { transporteEToro: muerto, ahora: base, dormir: sinEspera });
  assert.deepEqual([r.codigo, resDe(e.dir)[0].est], [3, "incierta"]);
  assert.equal((await cerrar(["--dir", e.dir, "--degradado", "ejecutar"], { ahora: () => e.t + 15 * 60000 })).codigo, 0);
  const libro = docDe(e.dir, "cartera-libro").data;
  assert.equal(libro.efectivo, 3500); assert.deepEqual(libro.pend.map(p => [p.sym, p.est]), [["QQQ", "incierta"]]);
  assert.equal(docDe(e.dir, "rutina-estado").data.estado, "degradada");
  assert.equal(posts(t).length, 1);
});
