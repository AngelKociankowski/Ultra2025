// W4 (12c §F.1–F.2) · Datasets del dashboard "Cartera Radar" y bin/70-reporte.mjs (lista → armar → escribir → registrar) con el
// ArtifactData falso (historial y dashboard) y la herramienta Artifact falsa. Textos de D-R1 en pruebas/fixtures/dash/.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as reporte } from "../bin/70-reporte.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { DATASETS, validarDataset } from "../lib/reporte.mjs";
import { DASH_URL } from "../lib/constantes.mjs";
import { artifactFalso } from "./db-falso.mjs";
import { prepararDia, dbInicial, LUNES } from "./escenario.mjs";
import { carpetaTemporal, leerFix, FIX } from "./util.mjs";

const leerSal = (dir, f) => fs.readFileSync(path.join(dir, "salida", f), "utf8");
const fase = (dir, f) => reporte(["--dir", dir, "--fase", f], { ahora: () => LUNES + 20 * 60000 });
// un día cerrado y guardado (paso 9) listo para el 9b
async function diaCerrado({ herramientas = "artifactdata,artifact,push", real = false, modo = "archivo" } = {}) {
  const db = dbInicial(real ? { "cartera-libro": leerFix("db/lunes-real-libro-v2.json"), "rutina-estado": leerFix("db/lunes-real-estado-v2.json") } : {});
  const e = await prepararDia({ db, modo, herramientas, portafolio: real ? leerFix("etoro/lunes-real-portfolio.json") : undefined, t: real ? Date.parse("2026-11-03T14:50:00Z") : LUNES });
  await cerrar(["--dir", e.dir], { ahora: () => e.t + 15 * 60000 });
  assert.equal(e.S.escribir("final").accion, "listo");
  return e;
}
async function reporteCompleto(e, art = artifactFalso()) {
  const l = await fase(e.dir, "lista");
  if (l.linea.accion !== "leer") return { l };
  e.S.leerReporte(leerTrabajo(e.dir, "leer-reporte.json").lecturas);
  const a = await fase(e.dir, "armar");
  if (a.linea.accion !== "subir") return { l, a };
  e.S.subirReporte(leerTrabajo(e.dir, "subir-reporte.json").subidas, art);
  const w = await fase(e.dir, "escribir");
  if (w.linea.accion !== "escribir") return { l, a, w };
  e.S.escribirReporte();
  return { l, a, w, r: await fase(e.dir, "registrar"), art };
}
const datos = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, "salida/reporte", id + ".json"), "utf8"));

test("(1)(2)(3)(7) día sintético y lunes real: los 9 archivos validan, sin identificadores de eToro; evolución base 100; Reporte: actualizado (9 de 9)", async () => {
  // identificadores que nunca deben aparecer: positionID y orderID de los fixtures de eToro y del libro real
  const prohibidos = new Set();
  for (const f of fs.readdirSync(path.join(FIX, "etoro"))) JSON.stringify(leerFix(`etoro/${f}`), (k, v) => { if (["positionID", "orderID", "PositionID", "OrderID"].includes(k) && Number.isFinite(v) && v > 1000) prohibidos.add(String(v)); return v; });
  for (const l of leerFix("db/lunes-real-libro-v2.json").lotes) { prohibidos.add(String(l[2])); prohibidos.add(String(l[3])); }
  for (const real of [false, true]) {
    const e = await diaCerrado({ real }), r = await reporteCompleto(e);
    assert.deepEqual([r.l.linea.accion, r.a.linea.accion, r.w.linea.accion, r.r.linea.accion], ["leer", "subir", "escribir", "listo"], `real=${real}`);
    for (const d of DATASETS) {
      const filas = datos(e.dir, d.id), txt = JSON.stringify(filas);
      assert.deepEqual(validarDataset(d.id, filas), [], d.id);
      assert.ok(Buffer.byteLength(txt) < 8 * 1024 * 1024);
      assert.ok(!/"(positionID|orderID|CID|token|referenceId)"/i.test(txt), d.id);
      for (const n of txt.match(/\d{6,}/g) || []) assert.ok(!prohibidos.has(n), `${d.id}: ${n}`);
    }
    const ev = datos(e.dir, "evolucion"), punto = JSON.parse(leerSal(e.dir, `final/punto-${leerTrabajo(e.dir, "preparar.json").fechaET}.json`));
    assert.deepEqual(Object.values(ev[0]).slice(3).concat([ev[0].fecha]), [100, 100, 100, 100, "2026-10-30"]);
    assert.equal(ev[ev.length - 1].idx_usd, Math.round(100 * punto.i * 100) / 100);
    assert.match(leerSal(e.dir, "aviso.txt"), /\nReporte: actualizado \(9 de 9\)\.$/);
    assert.equal(r.art.blobs.size, 9);
    // el dashboard falso tiene los 9 datasets apuntando a la subida
    assert.deepEqual([...e.S.ad.dash.keys()].sort(), DATASETS.map(d => d.id).sort());
    assert.match(e.S.ad.dash.get("resumen").data.source.url, /^\/_blob\/x\d+$/);
    if (real) {
      const res = datos(e.dir, "resumen")[0];
      assert.deepEqual([res.efectivo_usd, res.inicio, res.base_usd, res.radar_fuente], [13.09, "2026-10-30", 31959.09, "Corrida propia (FMP)"]);
      assert.ok(datos(e.dir, "posiciones").some(p => p.simbolo === "EFECTIVO" && p.valor_usd === 13.09));
    }
  }
});

test("(4) operaciones = historial de entrada/reporte/ops + las de hoy (mandan por id); un archivo con h malo se descarta con alerta", async () => {
  const e = await diaCerrado();
  assert.equal((await fase(e.dir, "lista")).linea.accion, "leer");
  e.S.leerReporte(leerTrabajo(e.dir, "leer-reporte.json").lecturas);
  const dirOps = path.join(e.dir, "entrada/reporte/ops/data/users/me");
  const viejo = JSON.parse(fs.readFileSync(path.join(dirOps, "ops-2026-10-30.json"), "utf8"));
  // un documento de historial dañado (h que no cuadra) y uno bueno de otro día
  fs.writeFileSync(path.join(dirOps, "ops-2026-10-29.json"), JSON.stringify(Object.assign({}, viejo, { f: "2026-10-29", ops: [Object.assign({}, viejo.ops[0], { id: "2026-10-29-SPY-C1" })] })));
  assert.equal((await fase(e.dir, "armar")).linea.accion, "subir");
  const ops = datos(e.dir, "operaciones"), ids = ops.map(o => o.id);
  assert.ok(ids.includes("2026-10-30-SPY-INICIAL-1") && !ids.includes("2026-10-29-SPY-C1"));
  // las de hoy mandan: el ops-2026-10-30 del final (ejecutadas) gana sobre el del historial (aceptadas al leer)
  assert.equal(ops.find(o => o.id === "2026-10-30-DIA-INICIAL").estado, JSON.parse(leerSal(e.dir, "final/ops-2026-10-30.json")).ops.find(o => o.id === "2026-10-30-DIA-INICIAL").est === "ejecutada" ? "Ejecutada" : "Enviada, sin ejecutar");
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(datos(e.dir, "alertas").some(a => /h que no cuadra/.test(a.texto)));
});

test("(5) sin ArtifactData o sin Artifact → lista responde saltar (y lo dice el aviso); sin historial → evolución base + hoy con la alerta", async () => {
  for (const [h, motivo] of [["artifact,push", "falta la herramienta ArtifactData"], ["artifactdata,push", "falta la herramienta Artifact"]]) {
    const e = await diaCerrado({ herramientas: h });
    const l = await fase(e.dir, "lista");
    assert.deepEqual([l.codigo, l.linea.accion, l.linea.resumen.motivo], [0, "saltar", motivo]);
    assert.ok(leerSal(e.dir, "aviso.txt").endsWith(`\nReporte: sin actualizar (${motivo}).`));
    assert.equal(leerSal(e.dir, "aviso-push.txt").includes("Reporte"), false);
  }
  const e = await diaCerrado();
  await fase(e.dir, "lista");
  // las dos lecturas de historial fallaron (no dejaron archivos); la lista del tablero sí llegó (DR2: sin ella, armar salta)
  fs.writeFileSync(path.join(e.dir, leerTrabajo(e.dir, "leer-reporte.json").lecturas[2].texto), fs.readFileSync(path.join(FIX, "dash/dash-list-real.txt")));
  assert.equal((await fase(e.dir, "armar")).linea.accion, "subir");
  assert.deepEqual(datos(e.dir, "evolucion").map(p => p.fecha), ["2026-10-30", leerTrabajo(e.dir, "preparar.json").fechaET]);
  assert.ok(datos(e.dir, "alertas").some(a => a.texto === "Reporte sin historial: hoy no hubo ArtifactData."));
});

test("(6) escribir: /_blob/ de subida-ok (texto real de D-R1), nada de subida-sin-url (S4: entonces ninguno); versiones de la lista en línea (DR2); artifactdata.json exacto", async () => {
  const e = await diaCerrado();
  await fase(e.dir, "lista");
  const lr = leerTrabajo(e.dir, "leer-reporte.json");
  assert.deepEqual(lr.lecturas.map(l => [l.args.action, l.args.url, l.args.collection, l.texto || null]), [
    ["query", "https://claude.ai/artifact/FkRDmR1kpgQTQq7t1eLodw", "data/users/me", null], ["query", "https://claude.ai/artifact/FkRDmR1kpgQTQq7t1eLodw", "data/users/me", null],
    ["list", DASH_URL, "datasets", lr.lecturas[2].texto]]);
  assert.equal(lr.lecturas[2].args.out_dir, undefined, "DR2: la lista del tablero va sin out_dir");
  assert.match(lr.lecturas[2].texto, /^entrada\/reporte\/dash-list\.\d+\.txt$/);
  fs.writeFileSync(path.join(e.dir, lr.lecturas[2].texto), fs.readFileSync(path.join(FIX, "dash/dash-list-inline.txt"))); // texto medido el 5-nov (DR2)
  await fase(e.dir, "armar");
  const sub = leerTrabajo(e.dir, "subir-reporte.json").subidas;
  assert.deepEqual(sub[0], { id: "resumen", args: { action: "publish", url: DASH_URL, asset: true, file_path: path.join(fs.realpathSync(e.dir), "salida/reporte/resumen.json") }, texto: "salida/reporte/subida-resumen.txt" });
  // con todas las subidas buenas (texto real de D-R1): 9 escrituras, versión fijada solo donde dash-list la trae
  for (const s of sub) fs.writeFileSync(path.join(e.dir, s.texto), fs.readFileSync(path.join(FIX, "dash/subida-ok.txt")));
  const w = await fase(e.dir, "escribir");
  assert.deepEqual([w.linea.accion, w.linea.resumen.datasets], ["escribir", 9]);
  const ad = JSON.parse(leerSal(e.dir, "reporte/artifactdata.json")), abs = fs.realpathSync(e.dir);
  assert.deepEqual(Object.keys(ad), ["action", "url", "writes"]); assert.deepEqual([ad.action, ad.url], ["batch", DASH_URL]);
  assert.deepEqual(ad.writes.find(x => x.doc_id === "resumen"), { op: "set", collection: "datasets", doc_id: "resumen", file_path: path.join(abs, "salida/reporte/ds-resumen.json"), if_version: 2 });
  assert.deepEqual(ad.writes.find(x => x.doc_id === "posiciones"), { op: "set", collection: "datasets", doc_id: "posiciones", file_path: path.join(abs, "salida/reporte/ds-posiciones.json"), if_version: 2 });
  assert.ok(ad.writes.every(x => x.if_version === 2) && ad.writes.length === 9);
  const ds = JSON.parse(leerSal(e.dir, "reporte/ds-resumen.json"));
  assert.deepEqual(Object.keys(ds), ["title", "description", "source", "updated", "schedule", "staleAfterHours"]);
  assert.deepEqual([ds.title, ds.source, ds.updated.by, ds.schedule, ds.staleAfterHours], ["Resumen de la cartera", { kind: "file", url: "/_blob/abf2b98035e66d57ed0080524216bd58", name: "resumen.json", format: "json" },
    "Rutina diaria de Claude", "Cada día hábil, al terminar la rutina de las 9:47 ET", 96]);
  assert.ok(ds.description.endsWith("Archivo que sube la rutina diaria."));
  // nada de subida-sin-url: ese dataset no se escribe, y tampoco los demás (S4: el dashboard no mezcla cortes)
  fs.writeFileSync(path.join(e.dir, "salida/reporte/subida-noticias.txt"), fs.readFileSync(path.join(FIX, "dash/subida-sin-url.txt")));
  assert.equal((await fase(e.dir, "escribir")).linea.accion, "saltar");
  assert.ok(!fs.existsSync(path.join(e.dir, "salida/reporte/artifactdata.json")));
  for (const s of sub) fs.writeFileSync(path.join(e.dir, s.texto), fs.readFileSync(path.join(FIX, "dash/subida-ok.txt")));
  // la lista real del dashboard vacío (D-R1): ninguna versión fijada
  fs.writeFileSync(path.join(e.dir, lr.lecturas[2].texto), fs.readFileSync(path.join(FIX, "dash/dash-list-real.txt")));
  await fase(e.dir, "escribir");
  assert.ok(JSON.parse(leerSal(e.dir, "reporte/artifactdata.json")).writes.every(x => x.if_version === undefined));
  // sin la lista (la lectura falló o el texto no se entiende): no se escribe a ciegas
  fs.writeFileSync(path.join(e.dir, lr.lecturas[2].texto), "Error: artifact not found");
  assert.equal((await fase(e.dir, "escribir")).linea.accion, "saltar");
});

test("(7) registrar: cuenta las líneas `- set \"datasets\"/…`; un rechazo → Reporte: sin actualizar (…); nunca código 1 por datos", async () => {
  const e = await diaCerrado();
  const r = await reporteCompleto(e);
  assert.equal(r.r.linea.resumen.actualizados, 9);
  const f = await diaCerrado();
  await fase(f.dir, "lista"); f.S.leerReporte(leerTrabajo(f.dir, "leer-reporte.json").lecturas);
  await fase(f.dir, "armar"); f.S.subirReporte(leerTrabajo(f.dir, "subir-reporte.json").subidas, artifactFalso());
  await fase(f.dir, "escribir");
  fs.writeFileSync(path.join(f.dir, "salida/reporte/resultado.txt"), "db batch write failed (version_mismatch): writes[0] (write 1 of 9) targets datasets/resumen; nothing was written");
  const g = await fase(f.dir, "registrar");
  assert.deepEqual([g.codigo, g.linea.accion], [0, "saltar"]);
  assert.ok(leerSal(f.dir, "aviso.txt").endsWith("\nReporte: sin actualizar (el dashboard rechazó la escritura: version_mismatch)."));
  // el 9b no se repite: con subidas de hoy, armar responde saltar
  assert.equal((await fase(f.dir, "armar")).linea.accion, "saltar");
  // entradas rotas: nunca código 1
  const vacia = carpetaTemporal();
  for (const fa of ["lista", "armar", "escribir", "registrar"]) assert.equal((await reporte(["--dir", vacia, "--fase", fa])).codigo, 0, fa);
  assert.equal((await reporte(["--dir", vacia, "--fase", "otra"])).codigo, 1);
});
