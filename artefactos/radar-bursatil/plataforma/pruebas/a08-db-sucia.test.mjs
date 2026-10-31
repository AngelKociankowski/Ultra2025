// B4 · a8-db-sucia del tester (14) en el diseño de 12b: A8.1 es H15 (t15); A8.2 y A8.3 hablaban de `indice` y `corrida`, que la
// rutina ya no lee: aquí se prueba que un fallo o un dato raro en esos documentos no cambia nada
import test from "node:test";
import assert from "node:assert/strict";
import { main as preparar } from "../bin/00-preparar.mjs";
import { semilla } from "../lib/libro.mjs";
import { leerVersiones } from "../lib/db.mjs";
import { PAG } from "./escenario.mjs";
import { carpetaConDb, leerSalida } from "./util.mjs";

test("A8.2/A8.3 · corrida y dia-<hoy> en fallo e indice malformado: importar los ignora y 00-preparar continúa con un solo set de rutina-estado", async () => {
  const docs = Object.assign(semilla(), { indice: { kind: "indice", v: 1, at: 1, dias: [{ dateET: "2026-10-16 ", parts: 4 }] } });
  const dir = carpetaConDb(docs, { corrida: "resource_exhausted", "dia-2026-11-04": "resource_exhausted" }, { noExisten: ["rutina-estado", "bitacora-mes-2026-11"] });
  const v = leerVersiones(dir);
  assert.ok(!("corrida" in v) && !("indice" in v) && !("dia-2026-11-04" in v));
  const r = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => Date.parse("2026-11-04T14:48:00Z"), pagina: PAG });
  assert.deepEqual([r.codigo, r.linea.accion], [0, "continuar"]);
  assert.equal(leerSalida(dir, "trabajo/preparar.json").radar.accion, "correr");
  assert.deepEqual(leerSalida(dir, "salida/ahora/db_write.json").ops.map(o => o.path.split("/").pop()), ["rutina-estado"]);
});
