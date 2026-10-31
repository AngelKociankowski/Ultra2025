// K11 / H11 · Días completos en modo en línea contra un db falso con la semántica real (versiones, ifVersion obligatorio sobre
// existentes, 409, ≤ 50 ops). La "sesión" solo copia lo que piden los archivos (procedimientos LEER y ESCRIBIR del RUNBOOK).
// Porta dia-completo.mjs del tester (14).
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
import { main as dbCli } from "../bin/db.mjs";
import { leerTrabajo } from "../lib/archivos.mjs";
import { leerVersiones, hOk } from "../lib/db.mjs";
import { esDePagina, validarDoc } from "../lib/esquemas.mjs";
import { semilla } from "../lib/libro.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { DB_SLUG, DB_RUTA } from "../lib/constantes.mjs";
import { crearDbFalso, crearSesion } from "./db-falso.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { PAG, tasasA } from "./escenario.mjs";
import { fmpSintetico } from "./sintetico.mjs";
import { carpetaTemporal, leerFix } from "./util.mjs";

const MIN = 60000;
const PAGINA_DOCS = {
  indice: { kind: "indice", v: 1, at: 1, dias: [{ dateET: "2026-10-30", parts: 4 }] },
  corrida: { kind: "corrida", v: 1, dateET: "2026-10-30", state: "done", runId: "d-1", startedAt: 1 },
  "dia-2026-10-30": { kind: "dia", v: 1, dateET: "2026-10-30", parts: [] },
  "contador-drutina0001": { kind: "contador", v: 1, used: 0 },
  vivo: { kind: "vivo", v: 1, at: 1 }, plan: { kind: "plan", v: 1 }, preferencias: { kind: "preferencias", v: 1, cetesPct: 7.44 },
};
const sinFmp = () => transporteFalso(() => ({ http: 0, conectar: 403, texto: "", errorRed: "curl 56" }));
const fmpNoticias = () => transporteFalso(req => {
  const u = new URL(req.url), n = i => ({ symbol: "SPY", publishedDate: "2026-11-02 08:00:00", title: `Noticia ${i} sobre el mercado de EE. UU.`, site: "cnbc.com", url: `https://www.cnbc.com/markets/${i}`, text: "x".repeat(400) });
  if (u.pathname === "/stable/news/stock") return { http: 200, texto: JSON.stringify(Array.from({ length: 50 }, (_, i) => n(i))) };
  if (u.pathname === "/stable/news/general-latest") return { http: 200, texto: JSON.stringify(Array.from({ length: 20 }, (_, i) => n(100 + i))) };
  if (u.pathname === "/stable/economic-calendar") return { http: 200, texto: JSON.stringify([{ date: "2026-11-04 14:00:00", country: "US", event: "FOMC Rate Decision", impact: "High" }]) };
  return { http: 200, texto: "[]" };
});
const DOM = ["https://www.cnbc.com/", "https://www.bloomberg.com/", "https://finance.yahoo.com/", "https://www.elfinanciero.com.mx/"];
const NOTAS = f => ({ v: 1, generadoEl: f + "T15:00:00Z", notas: Array.from({ length: 8 }, (_, i) => ({ id: "n" + (i + 1), titulo: "Fed mantiene tasas mientras la inflación se modera en EE. UU.", medio: "x",
  url: `${DOM[i % 4]}nota-${f}-${i}`, fecha: f, tema: i < 3 ? "macro" : "mercado", simbolos: [], evento: null,
  resumen: "La Reserva Federal mantuvo su tasa sin cambios y señaló que vigilará los datos de empleo e inflación antes de su próxima reunión." })) });

// H11: cada db_write.json es JSON válido, ≤ 50 ops, solo set, nada de la página, ifVersion si y solo si el id está ok
function comprobarGrupo(dir, grupo) {
  const args = JSON.parse(fs.readFileSync(path.join(dir, "salida", grupo, "db_write.json"), "utf8"));
  const ver = leerVersiones(dir);
  assert.equal(args.slug, DB_SLUG);
  assert.ok(args.ops.length >= 1 && args.ops.length <= 50, `${grupo}: ${args.ops.length} ops`);
  for (const op of args.ops) {
    const id = op.path.slice(DB_RUTA.length + 1);
    assert.ok(op.path.startsWith(DB_RUTA + "/"), op.path);
    assert.equal(op.op, "set", `${grupo} ${id}`);
    assert.ok(!esDePagina(id), `${grupo} escribe ${id}`);
    assert.deepEqual(validarDoc(id, op.data), [], id); assert.ok(hOk(op.data), id);
    if (ver[id] && ver[id].estado === "ok") assert.equal(op.ifVersion, ver[id].version, `${grupo} ${id}`);
    else assert.equal(op.ifVersion, undefined, `${grupo} ${id}`);
  }
  return args.ops.length;
}

// Una sesión que sigue el RUNBOOK (pasos 2–10) con operar:false
async function sesion({ db, raiz, t, fmpRadar, fmpOtras = sinFmp, corromper = null, morirEn = null }) {
  const pasos = {};
  const l = await preparar(["--fase", "lista", "--modo", "en_linea"], { ahora: () => t, raiz });
  const dir = path.join(raiz, ".trabajo", l.linea.fecha);
  const S = crearSesion({ db, dir, corromper });
  const escribir = g => { comprobarGrupo(dir, g); return S.escribir(g); };
  S.leer(l.linea.lecturas);
  const p = await preparar(["--dir", path.join(raiz, ".trabajo/hoy"), "--fase", "decidir"], { ahora: () => t, pagina: PAG });
  pasos.preparar = p;
  if (p.linea.escribir) pasos.ahora = escribir("ahora");
  if (p.codigo !== 0) return { dir, S, pasos, fin: "salir" };
  S.leer(leerTrabajo(dir, "leer-mas.json").lecturas);
  const prep = leerTrabajo(dir, "preparar.json");
  const f = fmpRadar();
  pasos.radar = await radar(["--dir", dir, "--modo", prep.radar.accion], { transporteFmp: f.transporte, ahora: f.ahora, pagina: PAG });
  const et = etoroFalso({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, t + 6 * MIN) });
  pasos.cartera = await cartera(["--dir", dir], { transporteEToro: et, transporteFmp: sinFmp(), ahora: () => t + 6 * MIN, pagina: PAG });
  pasos.noticias = await noticias(["--dir", dir], { transporteFmp: fmpOtras(), ahora: () => t + 7 * MIN, pagina: PAG });
  fs.writeFileSync(path.join(dir, "entrada/noticias.json"), JSON.stringify(NOTAS(prep.fechaET)));
  pasos.decidir = await decidir(["--dir", dir], { ahora: () => t + 12 * MIN, pagina: PAG });
  pasos.cerrar = await cerrar(["--dir", dir], { ahora: () => t + 14 * MIN });
  if (morirEn === "60-cerrar") return { dir, S, pasos, fin: "muerto" };
  pasos.final = escribir("final");
  S.leer(leerTrabajo(dir, "verificar.json").lecturas);
  pasos.verificar = await dbCli(["verificar", "--dir", dir]);
  pasos.presupuesto = await dbCli(["presupuesto", "--dir", dir]);
  assert.ok(et.llamadas.every(x => x.metodo === "GET"), "solo GET a eToro");
  return { dir, S, pasos, fin: "listo" };
}

test("tres días en línea: Radar sintético, sin FMP, y recuperación tras morir en 60-cerrar; página intacta; ≤ 36 000 B", { timeout: 600000 }, async t => {
  const db = crearDbFalso(Object.assign({}, semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") }), PAGINA_DOCS));
  const raiz = carpetaTemporal();

  // día 1 · lun 2-nov 9:47 ET con el Radar sintético
  const d1 = await sesion({ db, raiz, t: Date.parse("2026-11-02T14:47:00Z"), fmpRadar: () => fmpSintetico(), fmpOtras: fmpNoticias });
  assert.equal(d1.fin, "listo");
  assert.deepEqual([d1.pasos.preparar.linea.accion, d1.pasos.ahora.accion, d1.pasos.radar.linea.accion, d1.pasos.cartera.linea.accion], ["continuar", "listo", "listo", "listo"]);
  assert.ok(["simulacion", "nada"].includes(d1.pasos.decidir.linea.accion));
  assert.equal(d1.pasos.final.accion, "listo"); assert.equal(d1.pasos.verificar.codigo, 0);
  const p1 = d1.pasos.presupuesto.linea.resumen;
  t.diagnostic(`presupuesto día 1: ${JSON.stringify({ total: p1.total, leidos: p1.leidos, escritos: p1.escritos })}`);
  assert.ok(p1.total <= 36000, `día 1: ${p1.total} B`); assert.ok(d1.S.copiado.leidos + d1.S.copiado.escritos <= 36000);
  assert.equal(db.doc("radar-2026-11-02").estado, "listo");
  assert.ok(db.doc("ops-2026-10-30").ops.every(o => o.est === "ejecutada"));
  assert.equal(db.doc("rutina-estado").estado, "hecha");

  // día 2 · mar 3-nov sin FMP (403 del proxy): sin Radar, sin órdenes
  const d2 = await sesion({ db, raiz, t: Date.parse("2026-11-03T14:47:00Z"), fmpRadar: () => ({ transporte: sinFmp(), ahora: () => Date.parse("2026-11-03T14:48:00Z") }) });
  assert.equal(d2.fin, "listo");
  assert.deepEqual([d2.pasos.radar.linea.accion, d2.pasos.noticias.codigo, d2.pasos.decidir.linea.accion], ["sin_radar", 3, "nada"]);
  assert.equal(d2.pasos.final.accion, "listo"); assert.equal(d2.pasos.verificar.codigo, 0);
  const p2 = d2.pasos.presupuesto.linea.resumen;
  t.diagnostic(`presupuesto día 2: ${JSON.stringify({ total: p2.total, leidos: p2.leidos, escritos: p2.escritos })}`);
  assert.ok(p2.total <= 36000, `día 2: ${p2.total} B`);
  assert.deepEqual([db.doc("radar-2026-11-03").estado, db.doc("radar-2026-11-03").motivo], ["sin_radar", "policy"]);
  assert.equal(db.doc("bitacora-2026-11-03").estado, "parcial");
  assert.match(db.doc("bitacora-2026-11-03").aviso, /\nRadar: sin datos de FMP hoy; sin Radar no se opera\./);
  // el previo de rutina-estado sigue siendo el del último día con Radar
  assert.equal(db.doc("rutina-estado").previo.f, "2026-11-02");

  // día 3 · mié 4-nov: la sesión A muere en 60-cerrar (no escribe final); la B, 43 min después, recupera
  const vEstado = db.version("rutina-estado");
  const a = await sesion({ db, raiz, t: Date.parse("2026-11-04T14:47:00Z"), fmpRadar: () => ({ transporte: sinFmp(), ahora: () => Date.parse("2026-11-04T14:48:00Z") }), morirEn: "60-cerrar" });
  assert.equal(a.fin, "muerto");
  assert.equal(db.version("rutina-estado"), vEstado + 1); assert.equal(db.doc("rutina-estado").estado, "en_curso");
  assert.equal(db.doc("bitacora-2026-11-04"), null);
  const b = await sesion({ db, raiz, t: Date.parse("2026-11-04T15:30:00Z"), fmpRadar: () => ({ transporte: sinFmp(), ahora: () => Date.parse("2026-11-04T15:31:00Z") }) });
  assert.equal(b.pasos.preparar.linea.accion, "recuperar");
  assert.ok(fs.readdirSync(path.join(raiz, ".trabajo")).some(x => x.startsWith("2026-11-04.prev-")), "la carpeta de la sesión A se aparta");
  assert.ok(leerTrabajo(b.dir, "leer-mas.json").lecturas.some(x => x.id === "bitacora-2026-11-04"));
  assert.equal(b.pasos.final.accion, "listo"); assert.equal(b.pasos.verificar.codigo, 0);
  t.diagnostic(`presupuesto día 3 (sesión B, recuperación): ${b.pasos.presupuesto.linea.resumen.total} B`);
  assert.equal(db.doc("rutina-estado").estado, "hecha"); assert.equal(db.doc("rutina-estado").fecha, "2026-11-04");

  // acumulados: bitácora del mes con los 3 días, puntos por día, refs del libro en el último día
  assert.deepEqual(db.doc("bitacora-mes-2026-11").d.map(x => x[0]), ["2026-11-02", "2026-11-03", "2026-11-04"]);
  for (const f of ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"]) assert.ok(db.doc(`punto-${f}`), f);
  assert.equal(db.doc("cartera-libro").refs.dia[0], "2026-11-04"); assert.equal(db.doc("cartera-libro").lotes.length, 5);
  // la página no cambió: versiones en 1 y ninguna escritura sobre sus documentos; ninguna delete
  for (const id of Object.keys(PAGINA_DOCS)) assert.equal(db.version(id), 1, id);
  assert.ok(db.escrituras.every(w => !esDePagina(w.path.slice(DB_RUTA.length + 1)) && w.op === "set"));
});

test("un carácter cambiado en una lectura → importar la marca corrupta y el día se detiene sin escribir", async () => {
  const db = crearDbFalso(Object.assign({}, semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") }), PAGINA_DOCS));
  const corromper = L => (L.id === "cartera-libro" && L.data ? Object.assign({}, L, { data: JSON.parse(JSON.stringify(L.data).replace('"efectivo":0.56', '"efectivo":0.57')) }) : L);
  const s = await sesion({ db, raiz: carpetaTemporal(), t: Date.parse("2026-11-02T14:47:00Z"), fmpRadar: () => fmpSintetico(), corromper });
  assert.equal(s.fin, "salir");
  assert.equal(leerVersiones(s.dir)["cartera-libro"].estado, "corrupto");
  assert.deepEqual([s.pasos.preparar.codigo, s.pasos.preparar.linea.resumen.motivo, s.pasos.preparar.linea.escribir], [2, "integridad", null]);
  assert.equal(fs.readFileSync(path.join(s.dir, "salida/aviso.txt"), "utf8"), "Radar · lun 2-nov · Falla: el documento cartera-libro llegó dañado desde db; hoy no se operó.");
  assert.deepEqual(db.escrituras, []);
  assert.deepEqual(fs.readdirSync(path.join(s.dir, "salida")).filter(x => x !== "aviso.txt"), []);
});
