// B4 · a5-tiempo del tester (14): feriados, cierre anticipado, cambio de horario y años sin calendario en 00-preparar
import test from "node:test";
import assert from "node:assert/strict";
import { main as preparar } from "../bin/00-preparar.mjs";
import { semilla } from "../lib/libro.mjs";
import { PAG } from "./escenario.mjs";
import { carpetaConDb, leerSalida } from "./util.mjs";

const CASOS = [
  ["2026-11-26T14:47:00Z", "Thanksgiving 2026 (repo)", { codigo: 2, motivo: "feriado" }],
  ["2026-11-27T17:45:00Z", "viernes post-Thanksgiving 12:45 ET (cierre 13:00, ventana hasta 12:30)", { codigo: 0, abierto: true, dentro: false, hasta: "12:30" }],
  ["2026-11-27T18:05:00Z", "viernes post-Thanksgiving 13:05 ET (ya cerró)", { codigo: 0, abierto: false, dentro: false }],
  ["2026-03-09T13:47:00Z", "lunes tras el cambio de horario (9:47 EDT)", { codigo: 0, abierto: true, dentro: true }],
  ["2027-01-18T14:47:00Z", "MLK 2027 (repo)", { codigo: 2, motivo: "feriado" }],
  ["2028-01-17T14:47:00Z", "MLK 2028 (sin calendario)", { codigo: 0, abierto: false, dentro: false, ausente: true }],
  ["2028-07-04T13:47:00Z", "4 de julio 2028 (sin calendario)", { codigo: 0, abierto: false, dentro: false, ausente: true }],
  ["2028-12-25T14:47:00Z", "Navidad 2028 (sin calendario)", { codigo: 0, abierto: false, dentro: false, ausente: true }],
];
for (const [iso, nombre, x] of CASOS) {
  test(`A5 · ${nombre}`, async () => {
    const mes = new Date(Date.parse(iso) - 5 * 3600000).toISOString().slice(0, 7);
    const dir = carpetaConDb(semilla(), null, { noExisten: ["rutina-estado", `bitacora-mes-${mes}`] });
    const r = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => Date.parse(iso), pagina: PAG });
    const p = leerSalida(dir, "trabajo/preparar.json");
    assert.equal(r.codigo, x.codigo);
    if (x.motivo) { assert.equal(p.rutina.motivoSalida, x.motivo); return; }
    assert.equal(p.mercado.abierto, x.abierto); assert.equal(p.ventana.dentro, x.dentro);
    if (x.hasta) assert.equal(p.ventana.hasta, x.hasta);
    // A5.9: sin calendario nadie abre la ventana sin aviso
    assert.equal(p.mercado.calendario === "ausente", !!x.ausente);
    if (x.ausente) assert.ok(p.alertas.includes("Falta el calendario NYSE de 2028: hoy no se opera"));
  });
}
