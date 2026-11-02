// Ronda 5 del tester (17, S1, S3, S4) sobre 12c: identificadores de eToro fuera del dashboard, el recorte del aviso nunca corta una
// línea "Falla:", y una subida sin dirección no deja el dashboard con días mezclados. (S2 está en dia-pagina-reporte.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as reporte } from "../bin/70-reporte.mjs";
import { leerTrabajo, escribirTrabajo } from "../lib/archivos.mjs";
import { armarAviso, avisoConLinea } from "../lib/aviso.mjs";
import { DATASETS } from "../lib/reporte.mjs";
import { artifactFalso } from "./db-falso.mjs";
import { prepararDia, dbInicial } from "./escenario.mjs";
import { carpetaTemporal, leerFix, FIX } from "./util.mjs";

const reales = () => ({ "cartera-libro": leerFix("db/lunes-real-libro-v2.json"), "rutina-estado": leerFix("db/lunes-real-estado-v2.json") });
async function dia({ t, db, portafolio, art = artifactFalso() }) {
  const e = await prepararDia({ db, t, modo: "archivo", herramientas: "artifactdata,artifact,push", sinRadar: true, portafolio });
  await cerrar(["--dir", e.dir], { ahora: () => t + 15 * 60000 });
  assert.equal(e.S.escribir("final").accion, "listo");
  const fase = f => reporte(["--dir", e.dir, "--fase", f], { ahora: () => t + 20 * 60000 }), acc = [];
  let r = await fase("lista"); acc.push(r.linea.accion);
  e.S.leerReporte(leerTrabajo(e.dir, "leer-reporte.json").lecturas);
  r = await fase("armar"); acc.push(r.linea.accion);
  e.S.subirReporte(leerTrabajo(e.dir, "subir-reporte.json").subidas, art);
  r = await fase("escribir"); acc.push(r.linea.accion);
  if (r.linea.accion === "escribir") { e.S.escribirReporte(); acc.push((await fase("registrar")).linea.accion); }
  return Object.assign(e, { acc, ultima: r, aviso: fs.readFileSync(path.join(e.dir, "salida/aviso.txt"), "utf8") });
}

test("S1 · alertas con posiciones y órdenes de eToro: ningún archivo de salida/reporte/ lleva sus números ni campos prohibidos", async () => {
  // portafolio real del lunes con SPY 3629415538 en 26.7 unidades y XLE 3630614815 cerrada fuera de la rutina (vector del tester)
  const pf = leerFix("etoro/lunes-real-portfolio.json");
  pf.clientPortfolio.positions = pf.clientPortfolio.positions.filter(p => p.positionID !== 3630614815).map(p => (p.positionID === 3629415538 ? Object.assign(p, { units: 26.7 }) : p));
  const e = await dia({ t: Date.parse("2026-11-05T14:47:00Z"), db: dbInicial(reales()), portafolio: pf });
  assert.deepEqual(e.acc, ["leer", "subir", "escribir", "listo"]);
  const bit = e.db.doc("bitacora-2026-11-05");
  assert.ok(bit.alertas.some(a => a.includes("3629415538")), "la bitácora (privada) conserva el número");
  // números de 9+ dígitos de los fixtures reales: positionID, orderID y CID de eToro y los lotes del libro real
  const prohibidos = new Set();
  for (const f of fs.readdirSync(path.join(FIX, "etoro"))) JSON.stringify(leerFix(`etoro/${f}`), (k, v) => { if (["positionID", "orderID", "CID", "PositionID", "OrderID"].includes(k) && Number.isInteger(v) && String(v).length >= 8) prohibidos.add(String(v)); return v; });
  for (const l of leerFix("db/lunes-real-libro-v2.json").lotes) { prohibidos.add(String(l[2])); prohibidos.add(String(l[3])); }
  assert.ok(prohibidos.has("3629415538") && prohibidos.has("391187994"));
  const dirR = path.join(e.dir, "salida/reporte"), archivos = fs.readdirSync(dirR);
  assert.ok(archivos.length >= 20);
  for (const f of archivos) {
    const txt = fs.readFileSync(path.join(dirR, f), "utf8");
    for (const n of prohibidos) assert.ok(!txt.includes(n), `${f}: ${n}`);
    assert.ok(!/"(positionID|orderID|CID|token|referenceId)"/i.test(txt), f);
  }
  const al = JSON.parse(fs.readFileSync(path.join(dirR, "alertas.json"), "utf8")).map(a => a.texto);
  assert.ok(al.some(a => a.startsWith("SPY: eToro reporta 26.7 unidades en la posición de SPY")), JSON.stringify(al));
  assert.ok(al.some(a => a === "XLE: posición de XLE cerrada fuera de la rutina."), JSON.stringify(al));
  // y en el dashboard falso tampoco (los blobs son los archivos subidos)
  assert.ok(![...e.S.ad.dash.values()].some(d => [...prohibidos].some(n => JSON.stringify(d).includes(n))));
});

test("S3 · el recorte del aviso a 700 nunca corta una línea Falla: (verificar y paso 9b)", async () => {
  // vector x22: aviso real con la ejecución dañada y la marca de verificar; 9b sin Artifact
  const base = armarAviso({ fecha: "2026-11-04", hora: "10:02", simulacion: true, cartera: { valorUSD: 31966.12, valorMXN: 600133.4 }, rend: { usd: [0.001, 0, 0, 0, 0.0002], mxn: [0.006], spy: [0, 0, 0, 0, 0.004], meta: [0, 0, 0, 0] },
    radar: { regimen: "Favorable", cambios: [] }, notas: [{ titulo: "Stock market today: Dow, S&P 500, Nasdaq recover from bruising week as investors weigh jobs data", medio: "Yahoo Finanzas" },
      { titulo: "Fed interest rate decision October 2026: Fed holds rates steady as inflation cools", medio: "CNBC" }],
    operaciones: [], alertas: ["Pendiente de confirmar: IWM compra desde 2026-11-02", "Pendiente de confirmar: XLK compra desde 2026-11-02", "Sin compras: el Radar tiene 3 días hábiles."],
    fallas: [{ paso: "cartera", texto: "ejecucion-2026-11-02 llegó dañada o no se pudo leer: sin conciliación ni órdenes hoy; se reintenta mañana" }] });
  const marca = "Falla: cartera-libro no quedó en db como se preparó; no se opera hasta que el director lo revise.";
  const aviso = avisoConLinea(base, marca), fallas = x => x.split("\n").filter(l => l.startsWith("Falla:"));
  assert.ok(aviso.length <= 700);
  assert.deepEqual(fallas(aviso), fallas(base).concat([marca]));
  const dir = carpetaTemporal("x22-");
  for (const d of ["salida", "trabajo"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, "salida/aviso.txt"), aviso);
  escribirTrabajo(dir, "herramientas.json", { artifactdata: true, artifact: false, push: true });
  assert.equal((await reporte(["--dir", dir, "--fase", "lista"])).linea.accion, "saltar");
  const despues = fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8");
  assert.ok(despues.length <= 700 && despues.endsWith("\nReporte: sin actualizar (falta la herramienta Artifact)."));
  assert.deepEqual(fallas(despues), fallas(aviso));
  assert.ok(despues.startsWith("Radar · mié 4-nov"));
});

test("S4 · una subida sin dirección: no se escribe ningún dataset (cada uno conserva el anterior completo) y el aviso lo dice", async () => {
  const db = dbInicial(reales());
  const d1 = await dia({ t: Date.parse("2026-11-04T14:47:00Z"), db });
  assert.deepEqual(d1.acc, ["leer", "subir", "escribir", "listo"]);
  const antes = JSON.stringify([...d1.S.ad.dash]);
  // segundo día con el mismo dashboard: la subida de resumen no devuelve /_blob/
  const e = await prepararDia({ db, t: Date.parse("2026-11-05T14:47:00Z"), modo: "archivo", herramientas: "artifactdata,artifact,push", sinRadar: true, ad: d1.S.ad });
  await cerrar(["--dir", e.dir], { ahora: () => Date.parse("2026-11-05T15:02:00Z") });
  assert.equal(e.S.escribir("final").accion, "listo");
  const fase = f => reporte(["--dir", e.dir, "--fase", f], { ahora: () => Date.parse("2026-11-05T15:07:00Z") });
  await fase("lista"); e.S.leerReporte(leerTrabajo(e.dir, "leer-reporte.json").lecturas);
  await fase("armar"); e.S.subirReporte(leerTrabajo(e.dir, "subir-reporte.json").subidas, artifactFalso({ sinUrl: ["resumen"] }));
  const w = await fase("escribir");
  assert.deepEqual([w.codigo, w.linea.accion], [0, "saltar"]);
  assert.ok(!fs.existsSync(path.join(e.dir, "salida/reporte/artifactdata.json")));
  assert.equal(JSON.stringify([...d1.S.ad.dash]), antes, "el dashboard sigue entero con el corte anterior");
  assert.equal([...d1.S.ad.dash.values()].filter(x => x.version === 1).length, DATASETS.length);
  assert.ok(fs.readFileSync(path.join(e.dir, "salida/aviso.txt"), "utf8").endsWith("\nReporte: sin actualizar (la subida de resumen no devolvió la dirección del archivo; el dashboard sigue con el corte anterior)."));
});

test("S4-2 (director) · un dataset que no valida: ese día no se sube ni se escribe ninguno y el aviso lo dice", async () => {
  const db = dbInicial(reales());
  const d1 = await dia({ t: Date.parse("2026-11-04T14:47:00Z"), db });
  assert.deepEqual(d1.acc, ["leer", "subir", "escribir", "listo"]);
  const antes = JSON.stringify([...d1.S.ad.dash]);
  const e = await prepararDia({ db, t: Date.parse("2026-11-05T14:47:00Z"), modo: "archivo", herramientas: "artifactdata,artifact,push", sinRadar: true, ad: d1.S.ad });
  await cerrar(["--dir", e.dir], { ahora: () => Date.parse("2026-11-05T15:02:00Z") });
  assert.equal(e.S.escribir("final").accion, "listo");
  // sin tipo de cambio el valor en pesos es nulo y `resumen` (valor_mxn no admite nulo) no valida
  const c = leerTrabajo(e.dir, "cartera.json"); c.valuacion.valorMXN = null; escribirTrabajo(e.dir, "cartera.json", c);
  const fase = f => reporte(["--dir", e.dir, "--fase", f], { ahora: () => Date.parse("2026-11-05T15:07:00Z") });
  await fase("lista"); e.S.leerReporte(leerTrabajo(e.dir, "leer-reporte.json").lecturas);
  const a = await fase("armar");
  assert.deepEqual([a.codigo, a.linea.accion, a.linea.resumen.motivo], [0, "saltar", "resumen no pasó la validación; el dashboard sigue con el corte anterior"]);
  assert.ok(!fs.existsSync(path.join(e.dir, "trabajo/subir-reporte.json")));
  assert.ok(!DATASETS.some(d => fs.existsSync(path.join(e.dir, "salida/reporte", d.archivo))));
  assert.ok(fs.readFileSync(path.join(e.dir, "salida/aviso.txt"), "utf8").endsWith("\nReporte: sin actualizar (resumen no pasó la validación; el dashboard sigue con el corte anterior)."));
  assert.equal(JSON.stringify([...d1.S.ad.dash]), antes);
  assert.ok(fs.readFileSync(path.join(e.dir, "registro.jsonl"), "utf8").includes("reporte: resumen no valida"));
});
