// T07 / K4 · 10-radar sin documentos de la página (12b §E.5.6)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as radar } from "../bin/10-radar.mjs";
import { escribirTrabajo } from "../lib/archivos.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { conH } from "../lib/db.mjs";
import { validarDoc } from "../lib/esquemas.mjs";
import { carpetaConDb, leerSalida, existe } from "./util.mjs";
import { PAGINA, fmpSintetico, NOW_SINT } from "./sintetico.mjs";
import { libroLunesDb } from "./escenario.mjs";
import { crearValidador } from "./validar-salida.mjs";

const { C } = PAGINA;
function carpeta(previo = null) {
  const est = { kind: "rutinaEstado", v: 2, fecha: "2026-10-30", estado: "hecha", paso: "cerrar", sesion: "s-1", inicio: "2026-10-30T14:47:00Z", latido: "2026-10-30T15:00:00Z",
    fin: "2026-10-30T15:00:00Z", commit: null, modo: "en_linea", ejecucionesAbiertas: [], previo, escritos: {}, motivo: null };
  const dir = carpetaConDb({ "rutina-estado": est, "cartera-libro": libroLunesDb() });
  escribirTrabajo(dir, "preparar.json", { fechaET: "2026-11-02", ahora: NOW_SINT, modo: "en_linea", radar: { accion: "correr", motivo: null }, config: JSON.parse(JSON.stringify(CONFIG_DEFECTO)) });
  return dir;
}

test("correr con el sintético: analisis.json completo y radar-resumen ≤ 4 000 B, ≤ 30 filas, s con todas, cambios contra previo", async () => {
  // previo de prueba: la primera fila tenía otra señal, el objetivo traía QQQ y el régimen era NEUTRAL
  const sint = fmpSintetico();
  const dir0 = carpeta(null);
  await radar(["--dir", dir0, "--modo", "correr"], { transporteFmp: sint.transporte, ahora: sint.ahora, pagina: PAGINA });
  const base = leerSalida(dir0, "trabajo/radar-resumen.json");
  const fila0 = base.s.split("|")[0].split(":");
  const otra = fila0[1] === "3" ? 1 : 3;
  const previo = { f: "2026-10-30", reg: "NEUTRAL", s: [`${fila0[0]}:${otra}:50`].concat(base.s.split("|").slice(1)).join("|"), obj: "SPY:6500|QQQ:1000" };
  const dir = carpeta(previo), s2 = fmpSintetico();
  const r = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: s2.transporte, ahora: s2.ahora, pagina: PAGINA });
  assert.equal(r.codigo, 0); assert.equal(r.linea.accion, "listo"); assert.equal(r.linea.modo, "en_linea");
  const an = leerSalida(dir, "trabajo/analisis.json");
  assert.equal(an.fuente, "rutina"); assert.equal(an.llamadas.total, 626); assert.equal(crearValidador(C)(an.out), true);
  const res = leerSalida(dir, "trabajo/radar-resumen.json"), conh = conH(res);
  assert.deepEqual(validarDoc("radar-2026-11-02", conh), []);
  assert.ok(Buffer.byteLength(JSON.stringify(conh)) <= 4000, `${Buffer.byteLength(JSON.stringify(conh))} B`);
  assert.ok(res.filas.length <= 30 && res.filas.length >= 10);
  assert.equal(res.s.split("|").length, an.out.rows.length);
  assert.equal(res.llamadas, 626); assert.equal(res.asOf, "2026-11-02");
  assert.ok(res.obj.length > 0 && res.obj.every(x => Number.isInteger(x[1]) && (x[2] === "N" || x[2] === "S")));
  const tipos = res.cambios.map(c => c[0] + ":" + c[1]);
  assert.ok(tipos.includes(`reg:regimen`), JSON.stringify(res.cambios));
  assert.ok(tipos.includes(`${fila0[0]}:senal`));
  assert.ok(tipos.includes("QQQ:sale_objetivo") || res.obj.some(x => x[0] === "QQQ"));
  assert.ok(res.filas.some(f => f[0] === fila0[0]), "la fila que cambió de señal va en filas");
  for (const f of res.filas) { assert.equal(f.length, 8); assert.ok(Number.isInteger(f[4])); }
  assert.ok(!existe(dir, "salida/radar"));
});

test("403 del proxy en la 1.ª llamada → 1 llamada, sin_radar motivo policy; nada en salida/", async () => {
  const dir = carpeta(null);
  const s = fmpSintetico({ falla: () => ({ http: 0, conectar: 403, texto: "", errorRed: "curl 56" }) });
  const r = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: s.transporte, ahora: s.ahora, pagina: PAGINA });
  assert.equal(r.codigo, 3); assert.equal(r.linea.accion, "sin_radar");
  assert.equal(s.transporte.llamadas.length, 1);
  const res = leerSalida(dir, "trabajo/radar-resumen.json");
  assert.deepEqual([res.estado, res.motivo], ["sin_radar", "policy"]);
  assert.deepEqual(validarDoc("radar-2026-11-02", conH(res)), []);
  assert.ok(Buffer.byteLength(JSON.stringify(conH(res))) < 250);
  assert.deepEqual(fs.readdirSync(path.join(dir, "salida")), []);
  // modo ninguno
  const n = await radar(["--dir", dir, "--modo", "ninguno"], { pagina: PAGINA });
  assert.equal(n.codigo, 3); assert.equal(leerSalida(dir, "trabajo/analisis.json").out, null);
  // la página cambió → sin_radar pagina_cambio sin llamadas
  const t = fmpSintetico();
  const p = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: t.transporte, ahora: t.ahora, pagina: Object.assign({}, PAGINA, { compatible: false }) });
  assert.equal(p.codigo, 3); assert.equal(leerSalida(dir, "trabajo/radar-resumen.json").motivo, "pagina_cambio"); assert.equal(t.transporte.llamadas.length, 0);
});
