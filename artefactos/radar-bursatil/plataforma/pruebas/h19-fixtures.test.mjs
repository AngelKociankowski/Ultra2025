// H19 (12b §J): los `token` y `referenceId` reales de las respuestas de eToro del 30-oct no aparecen en el repo; los fixtures
// usan sintéticos 00000000-0000-4000-8000-00000000000N. La lista negra va como huellas (sha256, 16 hex) para no repetir los valores.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RAIZ, archivosBajo, leerFix } from "./util.mjs";

// 5 token y 4 referenceId reales del 30-oct (comprar-respuestas.json y orden-391187994.json antes de 24aaaac)
const LISTA_NEGRA = new Set(["3ef73cef269ac8e5", "245f5f7a78f7c811", "e821532fc78ada4f", "ec6ed10b7ad1d243", "e06b18cb348b797e",
  "7a8b5e3c456a55a7", "c43285ac232e53da", "80411cbad47d604a", "f388f43197fc97a8"]);
const huella = v => crypto.createHash("sha256").update(v).digest("hex").slice(0, 16);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

test("ningún archivo de plataforma/ contiene un token o referenceId real de la cuenta", () => {
  const hallazgos = [];
  for (const f of archivosBajo(RAIZ)) for (const m of fs.readFileSync(f, "latin1").matchAll(UUID)) if (LISTA_NEGRA.has(huella(m[0].toLowerCase()))) hallazgos.push(path.relative(RAIZ, f));
  assert.deepEqual([...new Set(hallazgos)], []);
});

test("los fixtures de respuestas de eToro llevan token y referenceId sintéticos", () => {
  const sint = /^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$/;
  for (const r of leerFix("etoro/comprar-respuestas.json")) { assert.match(r.token, sint); assert.match(r.referenceId, sint); }
  assert.match(leerFix("etoro/orden-391187994.json").token, sint);
  const todos = JSON.stringify(fs.readdirSync(path.join(RAIZ, "pruebas/fixtures/etoro")).map(f => fs.readFileSync(path.join(RAIZ, "pruebas/fixtures/etoro", f), "utf8")));
  for (const m of todos.matchAll(/"(?:token|referenceI[dD])":\s*"([^"]+)"/g)) assert.match(m[1], /^00000000-0000-(4000-8000-0000000000[0-9a-f]{2}|0000-0000-000000000000)$/, m[1]);
});
