// H14 · 12b §J (00l §3): la rutina no lee ni escribe documentos de la página; --fase lista con los obligatorios y .trabajo/hoy
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as preparar } from "../bin/00-preparar.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { carpetaTemporal, RAIZ, archivosBajo } from "./util.mjs";

const T = iso => Date.parse(iso);

test("--fase lista: obligatorios sin documentos de la página; .trabajo/hoy apunta a la fecha ET (H14)", async () => {
  const raiz = carpetaTemporal();
  const r = await preparar(["--fase", "lista", "--modo", "en_linea"], { ahora: () => T("2026-11-03T02:30:00Z"), raiz }); // 21:30 ET del 2-nov
  assert.equal(r.codigo, 0); assert.equal(r.linea.modo, "en_linea"); assert.equal(r.linea.dir, ".trabajo/hoy");
  assert.deepEqual(r.linea.lecturas.map(l => [l.id, l.obligatoria]), [["rutina-estado", true], ["rutina-config", true], ["cartera-libro", true], ["etoro-mapa", true], ["bitacora-mes-2026-11", true]]);
  const l = r.linea.lecturas[0];
  assert.deepEqual(l.en_linea, { herramienta: "mcp__claude-artifacts__db_get", args: { slug: "776fd979-e792-4459-ae2f-00814ef68cde", path: `${DB_RUTA}/rutina-estado` } });
  assert.equal(l.archivo.args.collection, "data/users/me"); assert.ok(path.isAbsolute(l.archivo.args.out_dir));
  assert.equal(fs.readlinkSync(path.join(raiz, ".trabajo/hoy")), "2026-11-02");
  assert.ok(fs.existsSync(path.join(raiz, ".trabajo/hoy/entrada/archivo")));
  // sin calendario en el repo para 2028: se pide feriados-2028 de la página (solo lectura, no obligatorio)
  const r28 = await preparar(["--fase", "lista", "--modo", "en_linea"], { ahora: () => T("2028-01-17T14:47:00Z"), raiz: carpetaTemporal() });
  assert.deepEqual(r28.linea.lecturas.slice(-1).map(x => [x.id, x.obligatoria]), [["feriados-2028", false]]);
  // ningún paso lee ni escribe documentos de la página (comentarios aparte; `cat: "corrida"` es la categoría del contador
  // de llamadas que usa la capa de datos de la página, no un documento)
  const usos = [];
  for (const f of archivosBajo(path.join(RAIZ, "bin")).concat(archivosBajo(path.join(RAIZ, "lib")))) {
    fs.readFileSync(f, "utf8").split("\n").forEach((x, i) => { const c = x.replace(/\/\/.*$/, ""); if (/"corrida"|dia-\$\{|"indice"|contador-/.test(c) && !/esDePagina|\^\(dia-|cat: "corrida"/.test(c)) usos.push(`${path.relative(RAIZ, f)}:${i + 1}`); });
  }
  assert.deepEqual(usos, []);
});
