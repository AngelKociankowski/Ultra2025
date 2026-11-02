// W7 (12c §J) · El miércoles 4-nov de punta a punta siguiendo el RUNBOOK 2.1.0: sin FMP, el Radar sale de la página (ArtifactData
// falso sobre el volcado del 30-oct), eToro con lunes-real-*, simulación, final y verificar, y el paso 9b sube los 9 datasets al
// dashboard falso. En modo archivo y en modo en línea con ArtifactData cargado; y la misma corrida sin la herramienta Artifact.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as preparar } from "../bin/00-preparar.mjs";
import { main as radar } from "../bin/10-radar.mjs";
import { main as cartera } from "../bin/20-cartera.mjs";
import { main as noticias } from "../bin/30-fmp-noticias.mjs";
import { main as decidir } from "../bin/40-decidir.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as reporte } from "../bin/70-reporte.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { DATASETS } from "../lib/reporte.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { crearSesion, artifactFalso, artifactDataFalso } from "./db-falso.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { PAG, dbInicial, tasasA } from "./escenario.mjs";
import { docsPagina } from "./pagina-falsa.mjs";
import { carpetaTemporal, leerFix } from "./util.mjs";

const T = Date.parse("2026-11-04T14:47:00Z"), MIN = 60000;
const PAGINA_IDS = ["indice", "dia-2026-10-30", "dia-2026-10-30-p0", "dia-2026-10-30-p1", "dia-2026-10-30-p2", "dia-2026-10-30-p3"];
const sinFmp = () => transporteFalso(() => ({ http: 0, conectar: 403, texto: "", errorRed: "curl 56" }));

async function miercoles({ modo, herramientas, fallaGet = null }) {
  const db = dbInicial(Object.assign({ "cartera-libro": leerFix("db/lunes-real-libro-v2.json"), "rutina-estado": leerFix("db/lunes-real-estado-v2.json") }, docsPagina()));
  const versiones = Object.fromEntries(PAGINA_IDS.map(id => [id, db.version(id)])), raiz = carpetaTemporal();
  const h = herramientas.split(","), P = {};
  // pasos 2 y 3
  const l = await preparar(["--fase", "lista", "--modo", modo, "--herramientas", herramientas], { ahora: () => T, raiz });
  const dir = path.join(raiz, ".trabajo", l.linea.fecha), S = crearSesion({ db, dir, modo, ad: fallaGet ? artifactDataFalso(db, { fallaGet }) : null });
  S.leer(l.linea.lecturas);
  P.preparar = await preparar(["--dir", dir, "--fase", "decidir"], { ahora: () => T, pagina: PAG, sesion: "s-mie" });
  P.ahora = S.escribir("ahora");
  S.leer(leerTrabajo(dir, "leer-mas.json").lecturas);
  // paso 4: correr → sin FMP → página (LEER-PÁGINA mientras pida leer, a lo más 6)
  P.correr = await radar(["--dir", dir, "--modo", "correr"], { transporteFmp: sinFmp(), ahora: () => T + MIN, pagina: PAG, cache: null });
  let r = P.correr, vueltas = 0;
  if (r.linea.siguiente === "pagina") {
    r = await radar(["--dir", dir, "--modo", "pagina"], { ahora: () => T + 2 * MIN, pagina: PAG, cache: null });
    while (r.linea.accion === "leer" && vueltas < 6) { vueltas++; S.leerPagina(leerTrabajo(dir, "leer-pagina.json").lecturas); r = await radar(["--dir", dir, "--modo", "pagina"], { ahora: () => T + 2 * MIN, pagina: PAG, cache: null }); }
  }
  P.radar = r; P.vueltas = vueltas;
  // pasos 5–7
  const et = etoroFalso({ portafolio: leerFix("etoro/lunes-real-portfolio.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, T + 6 * MIN) });
  P.cartera = await cartera(["--dir", dir], { transporteEToro: et, transporteFmp: sinFmp(), ahora: () => T + 6 * MIN, pagina: PAG });
  P.noticias = await noticias(["--dir", dir], { transporteFmp: sinFmp(), ahora: () => T + 7 * MIN, pagina: PAG });
  fs.writeFileSync(path.join(dir, "entrada/noticias.json"), JSON.stringify({ v: 1, generadoEl: "2026-11-04T15:00:00Z", notas: [{ id: "n1", titulo: "La Fed mantiene la tasa", medio: "CNBC",
    url: "https://www.cnbc.com/2026/11/04/fed.html", fecha: "2026-11-04", tema: "macro", simbolos: [], resumen: "La Reserva Federal mantuvo su tasa sin cambios.", evento: null }] }));
  P.decidir = await decidir(["--dir", dir], { ahora: () => T + 12 * MIN, pagina: PAG });
  // paso 9
  P.cerrar = await cerrar(["--dir", dir], { ahora: () => T + 14 * MIN });
  P.final = S.escribir("final");
  S.leer(leerTrabajo(dir, "verificar.json").lecturas);
  P.verificar = await dbCli(["verificar", "--dir", dir]);
  // paso 9b
  const art = h.includes("artifact") ? artifactFalso() : null, fase = f => reporte(["--dir", dir, "--fase", f], { ahora: () => T + 20 * MIN });
  P.reporte = [];
  let x = await fase("lista"); P.reporte.push(x.linea.accion);
  if (x.linea.accion !== "saltar") {
    S.leerReporte(leerTrabajo(dir, "leer-reporte.json").lecturas);
    x = await fase("armar"); P.reporte.push(x.linea.accion);
    S.subirReporte(leerTrabajo(dir, "subir-reporte.json").subidas, art);
    x = await fase("escribir"); P.reporte.push(x.linea.accion);
    S.escribirReporte();
    x = await fase("registrar"); P.reporte.push(x.linea.accion);
  }
  return { db, dir, P, S, et, art, versiones, aviso: fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8"), push: fs.readFileSync(path.join(dir, "salida/aviso-push.txt"), "utf8") };
}

for (const modo of ["archivo", "en_linea"]) {
  test(`mié 4-nov (${modo}, con ArtifactData y Artifact): Radar de la página del 30-oct, simulación, final verificado y reporte 9 de 9`, { timeout: 300000 }, async () => {
    const m = await miercoles({ modo, herramientas: "artifactdata,artifact,push" });
    assert.deepEqual([m.P.preparar.codigo, m.P.ahora.accion, m.P.correr.linea.accion, m.P.correr.linea.siguiente], [0, "listo", "sin_radar", "pagina"]);
    assert.deepEqual([m.P.radar.linea.accion, m.P.vueltas], ["listo", 3]);
    const an = leerTrabajo(m.dir, "analisis.json");
    assert.deepEqual([an.fuente, an.asOf, an.antiguedad], ["pagina", "2026-10-30", 3]);
    assert.equal(m.P.cartera.linea.accion, "listo");
    assert.ok(["simulacion", "nada"].includes(m.P.decidir.linea.accion));
    assert.ok(leerTrabajo(m.dir, "decisiones.json").simulacion);
    assert.deepEqual([m.P.final.accion, m.P.verificar.codigo], ["listo", 0]);
    assert.deepEqual(m.P.reporte, ["leer", "subir", "escribir", "listo"]);
    // dashboard falso: 9 datasets con source.url de las subidas
    assert.deepEqual([...m.S.ad.dash.keys()].sort(), DATASETS.map(d => d.id).sort());
    for (const [id, d] of m.S.ad.dash) assert.ok(m.art.blobs.has(d.data.source.url.replace("/_blob/", "")), id);
    assert.deepEqual(m.art.blobs.get(m.S.ad.dash.get("resumen").data.source.url.replace("/_blob/", ""))[0].radar_fuente, "Página del Radar");
    // aviso: línea del Radar con fuente y fecha, sin compras por antigüedad, y el reporte; push con Radar pág
    assert.match(m.aviso, /\nRadar: análisis de la página del 30-oct \(3 días hábiles\); régimen [^;\n]+; sin compras: el Radar tiene 3 días/);
    assert.ok(m.aviso.endsWith("\nReporte: actualizado (9 de 9)."));
    assert.match(m.push, / · Radar pág 30-oct · /); assert.ok(m.push.length <= 200 && !m.push.includes("Reporte"));
    // bitácora y radar-<hoy> con fuente; la página no cambió; 0 POST
    const bit = m.db.doc("bitacora-2026-11-04"), rd = m.db.doc("radar-2026-11-04");
    assert.deepEqual(bit.radar, { estado: "listo", motivo: null, fu: "pagina", fa: "2026-10-30", ant: 3 });
    assert.deepEqual([rd.v, rd.fu, rd.fa, rd.ant], [2, "pagina", "2026-10-30", 3]);
    assert.deepEqual([m.db.doc("rutina-estado").previo.fa, m.db.doc("rutina-estado").previo.fu, m.db.doc("rutina-estado").estado], ["2026-10-30", "pagina", "hecha"]);
    for (const id of PAGINA_IDS) assert.equal(m.db.version(id), m.versiones[id], id);
    assert.ok(m.db.escrituras.every(w => !/\/(indice|dia-|corrida|contador-)/.test(w.path)));
    assert.ok(m.et.llamadas.every(c => c.metodo === "GET"), "0 POST");
  });
}

test("la misma corrida sin la herramienta Artifact: Reporte: sin actualizar (falta la herramienta Artifact). y el resto igual", { timeout: 300000 }, async () => {
  const m = await miercoles({ modo: "archivo", herramientas: "artifactdata,push" });
  assert.deepEqual([m.P.radar.linea.accion, m.P.final.accion, m.P.verificar.codigo, m.P.reporte], ["listo", "listo", 0, ["saltar"]]);
  assert.ok(m.aviso.endsWith("\nReporte: sin actualizar (falta la herramienta Artifact)."));
  assert.equal(m.S.ad.dash.size, 0);
  assert.equal(m.db.doc("bitacora-2026-11-04").radar.fu, "pagina");
  for (const id of PAGINA_IDS) assert.equal(m.db.version(id), m.versiones[id], id);
});

test("S2 (tester ronda 5): sin la parte de series p3 el análisis vale, pero el día dice que no hubo objetivo y por qué", { timeout: 300000 }, async () => {
  const m = await miercoles({ modo: "archivo", herramientas: "artifactdata,artifact,push", fallaGet: id => id === "dia-2026-10-30-p3" });
  assert.equal(m.P.radar.linea.accion, "listo");
  const an = leerTrabajo(m.dir, "analisis.json"), dec = leerTrabajo(m.dir, "decisiones.json");
  assert.ok(an.alertas.some(a => /sin una parte de series \(dia-2026-10-30-p3\)/.test(a)), JSON.stringify(an.alertas));
  assert.notEqual(dec.objetivo.estado, "ok");
  assert.ok(dec.alertas.some(a => a.startsWith("Sin objetivo del Radar hoy (")), JSON.stringify(dec.alertas));
  assert.match(m.aviso, /\nRadar: análisis de la página del 30-oct \(3 días hábiles\); régimen [^;\n]+; sin objetivo hoy \([^)]+\)/);
  assert.ok(m.db.doc("bitacora-2026-11-04").alertas.some(a => /^Sin objetivo del Radar hoy/.test(a)));
});
