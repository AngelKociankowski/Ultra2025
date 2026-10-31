// H24 · a14-lectura-omitida portado (12b §E.2, §E.4): sin lectura registrada no hay escritura
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { leerVersiones } from "../lib/db.mjs";
import { prepararDia } from "./escenario.mjs";
import { aviso, grupo, idsDe, docDe, T_CIERRE } from "./cierre.mjs";

// H24 · a14-lectura-omitida portado: sin lectura registrada no hay escritura
test("H24 · ops-2026-10-30 sin línea en lecturas.jsonl → no va en final (alerta); con la línea va con ifVersion", async () => {
  const sin = await prepararDia({ omitir: ["ops-2026-10-30"] });
  assert.equal(sin.preparar.codigo, 0);
  assert.equal(leerVersiones(sin.dir)["ops-2026-10-30"].codigo, "no_leido");
  await cerrar(["--dir", sin.dir], { ahora: () => T_CIERRE(sin) });
  assert.ok(!idsDe(sin.dir).includes("ops-2026-10-30"));
  assert.ok(docDe(sin.dir, "bitacora-2026-11-02").alertas.includes("no se leyó ops-2026-10-30; no se escribe"));
  const con = await prepararDia({});
  await cerrar(["--dir", con.dir], { ahora: () => T_CIERRE(con) });
  const op = grupo(con.dir).ops.find(o => o.path.endsWith("/ops-2026-10-30")), bm = grupo(con.dir).ops.find(o => o.path.endsWith("/bitacora-mes-2026-11"));
  assert.equal(op.ifVersion, 1); assert.equal(bm.ifVersion, undefined); // bitacora-mes-2026-11 no existía (exists:false)
  const conBm = await prepararDia({ dbExtra: { "bitacora-mes-2026-11": { kind: "bitacoraMes", v: 1, mes: "2026-11", d: [] } } });
  await cerrar(["--dir", conBm.dir], { ahora: () => T_CIERRE(conBm) });
  assert.equal(grupo(conBm.dir).ops.find(o => o.path.endsWith("/bitacora-mes-2026-11")).ifVersion, 1);
});

test("H24 · bitacora-mes sin línea: 00-preparar sale por integridad sin escribir; si falta su registro al cerrar, no va en final", async () => {
  const e = await prepararDia({ omitir: ["bitacora-mes-2026-11"] });
  assert.equal(e.preparar.codigo, 2); assert.equal(e.preparar.linea.resumen.motivo, "integridad");
  assert.equal(e.preparar.linea.escribir, null);
  assert.equal(aviso(e.dir), "Radar · lun 2-nov · Falla: no se pudo leer bitacora-mes-2026-11 de db; hoy no se operó.");
  // defensa del cierre: el registro de la lectura desaparece después de preparar
  const d = await prepararDia({});
  const ver = leerVersiones(d.dir); delete ver["bitacora-mes-2026-11"];
  fs.writeFileSync(path.join(d.dir, "entrada/db/_versiones.json"), JSON.stringify(ver));
  await cerrar(["--dir", d.dir], { ahora: () => T_CIERRE(d) });
  assert.ok(!idsDe(d.dir).includes("bitacora-mes-2026-11"));
  assert.ok(docDe(d.dir, "bitacora-2026-11-02").alertas.includes("no se leyó bitacora-mes-2026-11; no se escribe"));
});
