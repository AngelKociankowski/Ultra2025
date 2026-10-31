// H13 · a5-tiempo portado (12b §D.2 regla 2, §I): sin calendario del año → continuar con ventana cerrada y alerta; con feriados-<año> en db → feriado
import test from "node:test";
import assert from "node:assert/strict";
import { main as preparar } from "../bin/00-preparar.mjs";
import { cargarPagina } from "../lib/cargar-pagina.mjs";
import { semilla } from "../lib/libro.mjs";
import { carpetaConDb, leerSalida } from "./util.mjs";

const pag = cargarPagina();
async function correr(iso, docs) {
  const mes = new Date(Date.parse(iso) - 5 * 3600000).toISOString().slice(0, 7);
  const dir = carpetaConDb(Object.assign(semilla(), docs), null, { noExisten: ["rutina-estado", `bitacora-mes-${mes}`] });
  const r = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => Date.parse(iso), pagina: pag });
  return { r, p: leerSalida(dir, "trabajo/preparar.json") };
}

test("H13 · sin calendario de 2028: continuar con ventana cerrada y alerta; con feriados-2028 en db → feriado", async () => {
  for (const iso of ["2028-01-17T14:47:00Z", "2028-07-04T13:47:00Z", "2028-12-25T14:47:00Z"]) {
    const x = await correr(iso, {});
    assert.equal(x.r.codigo, 0, iso); assert.equal(x.p.mercado.calendario, "ausente"); assert.equal(x.p.ventana.dentro, false);
    assert.ok(x.p.alertas.includes("Falta el calendario NYSE de 2028: hoy no se opera"), iso);
  }
  const fer = { kind: "feriados", v: 1, year: "2028", rows: [{ date: "2028-01-17", name: "Martin Luther King, Jr. Day", isClosed: true, adjOpenTime: null, adjCloseTime: null }] };
  const y = await correr("2028-01-17T14:47:00Z", { "feriados-2028": fer });
  assert.equal(y.p.rutina.motivoSalida, "feriado");
});
