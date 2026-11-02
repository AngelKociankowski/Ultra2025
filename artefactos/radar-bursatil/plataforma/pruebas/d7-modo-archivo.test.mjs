// D7 (00q §1) · Modo archivo activo con los formatos medidos de ArtifactData el lunes 2-nov: textos reales de get/batch, importar
// sin copia a mano (datos de out_dir, versión e identidad del texto guardado), batch con file_path e if_version, y los mismos
// días que en línea sobre el db falso (mismos documentos, mismas versiones, verificar en 0).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { main as preparar } from "../bin/00-preparar.mjs";
import { main as radar } from "../bin/10-radar.mjs";
import { main as cartera } from "../bin/20-cartera.mjs";
import { main as decidir } from "../bin/40-decidir.mjs";
import { main as cerrar } from "../bin/60-cerrar.mjs";
import { main as dbCli } from "../bin/db.mjs";
import { leerTrabajo, escribirJson } from "../lib/archivos.mjs";
import { conH, importar, armarGrupo, registrar, leerVersiones, lectura, presupuesto, hOk } from "../lib/db.mjs";
import { ARTEFACTO_URL, DB_SLUG, DB_RUTA } from "../lib/constantes.mjs";
import { semilla } from "../lib/libro.mjs";
import { transporteFalso } from "../lib/http.mjs";
import { crearDbFalso, crearSesion, artifactDataFalso } from "./db-falso.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { PAG, tasasA, prepararDia, dbInicial, OUT30, LUNES, copia } from "./escenario.mjs";
import { ejecutar, etoroGuion, reloj, posts, sinEspera } from "./ejecucion.mjs";
import { fmpSintetico } from "./sintetico.mjs";
import { carpetaConDb, carpetaTemporal, leerFix } from "./util.mjs";

const MIN = 60000;
const T = leerFix("db/artifactdata-lunes.json");
const S = semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") });
const ordenar = x => (Array.isArray(x) ? x.map(ordenar) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordenar(x[k])])) : x);
const YO = "(`me` in this path resolved to your user id on this artifact: u_Np_5cFP3Ho2rFiXosc9ZPw)";
// deja en out_dir el archivo de datos como lo guarda ArtifactData y el texto de la respuesta; agrega la línea de la lectura
function leerConTexto(dir, id, texto, datos = null) {
  const L = lectura(id, { dirAbs: dir }), out = L.archivo.args.out_dir;
  if (datos !== null) { fs.mkdirSync(path.join(out, "data/users/me"), { recursive: true }); fs.writeFileSync(path.join(out, "data/users/me", id + ".json"), datos); }
  fs.writeFileSync(path.join(dir, L.archivo.texto), texto.split("{{out_dir}}").join(out));
  fs.appendFileSync(path.join(dir, "entrada/lecturas.jsonl"), L.archivo.linea + "\n");
  return L;
}
const vacia = () => carpetaConDb({}, null, { modo: "archivo" });

test("textos medidos el 2-nov: get que existe (2586 B, versión 1), get que no existe y batch de 7 escrituras", () => {
  const dir = vacia();
  // el archivo real del lunes es el ops-2026-10-30 de la semilla con claves ordenadas y sangría de 2: mismo tamaño que dice el texto
  const datos = JSON.stringify(ordenar(conH(S["ops-2026-10-30"])), null, 2) + "\n";
  assert.equal(Buffer.byteLength(datos), 2586);
  leerConTexto(dir, "ops-2026-10-30", T.get_existe, datos);
  leerConTexto(dir, "rutina-estado", T.get_no_existe);
  const r = importar(dir, { requeridos: [] }), v = leerVersiones(dir);
  assert.deepEqual([r.ok, r.no_existen, r.fallos, r.corruptos], [["ops-2026-10-30"], ["rutina-estado"], [], []]);
  assert.deepEqual([v["ops-2026-10-30"].version, v["ops-2026-10-30"].h], [1, "1af0fdb98269a3ea"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "entrada/db/ops-2026-10-30.json"), "utf8")), conH(S["ops-2026-10-30"]));
  // batch del final del lunes: las 7 versiones, en el orden de writes
  const g = path.join(dir, "salida/final");
  fs.mkdirSync(g, { recursive: true });
  escribirJson(path.join(g, "_grupo.json"), { grupo: "final", modo: "archivo", ops: T.batch_7_writes.map(id => ({ id, h: "x", ifVersion: null })), omitidos: [], reintento: false });
  fs.writeFileSync(path.join(g, "resultado.txt"), T.batch_7);
  const rg = registrar({ dir, grupo: "final" });
  assert.equal(rg.accion, "listo");
  assert.deepEqual(rg.resumen.escritos.map(e => e.version), [2, 2, 1, 1, 1, 1, 2]);
  assert.equal(leerVersiones(dir)["rutina-estado"].version, 2);
});

test("importar en modo archivo no supone nada: identidad ajena, tamaño distinto, ruta ajena, sin versión, sin archivo, h dañado", async () => {
  const dir = vacia();
  const libro = JSON.stringify(ordenar(conH(S["cartera-libro"])), null, 2) + "\n", n = Buffer.byteLength(libro);
  const linea = (id, bytes, ruta) => `1 document from collection "data/users/me" saved as JSON files under "x":\n- "${id}"  ${bytes} bytes  version 4  "${ruta}"\n${YO}`;
  const L = leerConTexto(dir, "cartera-libro", "{{out_dir}}", libro);
  const datos = path.join(L.archivo.args.out_dir, "data/users/me/cartera-libro.json");
  const casos = [
    [linea("cartera-libro", n, datos).replace("u_Np_5cFP3Ho2rFiXosc9ZPw", "u_OtroUsuario000000000000"), "fallo", "identidad"],
    [linea("cartera-libro", n, datos).replace(YO, ""), "fallo", "sin_identidad"],
    [linea("cartera-libro", n + 1, datos), "corrupto", "tamano"],
    [linea("cartera-libro", n, path.join(carpetaTemporal(), "cartera-libro.json")), "fallo", "sin_archivo"],
    [`Error: resource exhausted\n${YO}`, "fallo", "texto_sin_version"],
    [linea("etoro-mapa", n, datos), "fallo", "texto_sin_version"],
  ];
  for (const [texto, estado, codigo] of casos) {
    leerConTexto(dir, "cartera-libro", texto);
    importar(dir, { requeridos: [] });
    const v = leerVersiones(dir)["cartera-libro"];
    assert.deepEqual([v.estado, v.codigo], [estado, codigo], codigo);
  }
  // ruta que existe pero no es la de out_dir de esta carpeta
  const otra = path.join(carpetaTemporal(), "cartera-libro.json");
  fs.writeFileSync(otra, libro);
  leerConTexto(dir, "cartera-libro", linea("cartera-libro", n, otra));
  importar(dir, { requeridos: [] });
  assert.equal(leerVersiones(dir)["cartera-libro"].codigo, "ruta_ajena");
  // un carácter cambiado en el archivo de datos (mismo tamaño): integridad
  leerConTexto(dir, "cartera-libro", linea("cartera-libro", n, datos), libro.replace('"efectivo": 0.56', '"efectivo": 0.57'));
  importar(dir, { requeridos: [] });
  assert.deepEqual([leerVersiones(dir)["cartera-libro"].estado, leerVersiones(dir)["cartera-libro"].codigo], ["corrupto", "integridad"]);
  // y bien leído queda ok con la versión del texto
  leerConTexto(dir, "cartera-libro", linea("cartera-libro", n, datos), libro);
  importar(dir, { requeridos: [] });
  assert.deepEqual([leerVersiones(dir)["cartera-libro"].estado, leerVersiones(dir)["cartera-libro"].version], ["ok", 4]);
  // CLI: identidad ajena → accion identidad (RUNBOOK: F9)
  leerConTexto(dir, "cartera-libro", linea("cartera-libro", n, datos).replace("u_Np_5cFP3Ho2rFiXosc9ZPw", "u_OtroUsuario000000000000"));
  const cli = await dbCli(["importar", "--dir", dir]);
  assert.deepEqual([cli.codigo, cli.linea.accion, cli.linea.resumen.identidad], [3, "identidad", ["cartera-libro"]]);
});

test("lectura: out_dir con la ruta real y un archivo de texto nuevo por lectura (nunca reemplaza uno anterior)", () => {
  const dir = vacia(), enlace = path.join(carpetaTemporal(), "hoy");
  fs.symlinkSync(dir, enlace);
  const a = lectura("rutina-estado", { dirAbs: enlace });
  assert.equal(a.archivo.args.out_dir, path.join(fs.realpathSync(dir), "entrada/archivo"));
  assert.deepEqual(a.archivo.args, { action: "get", url: ARTEFACTO_URL, collection: "data/users/me", doc_id: "rutina-estado", out_dir: a.archivo.args.out_dir });
  assert.equal(a.archivo.linea, JSON.stringify({ id: "rutina-estado", texto: "entrada/archivo/rutina-estado.1.txt" }));
  fs.writeFileSync(path.join(dir, a.archivo.texto), "x");
  assert.equal(lectura("rutina-estado", { dirAbs: dir }).archivo.texto, "entrada/archivo/rutina-estado.2.txt");
});

test("registrar en modo archivo: texto incompleto → releer; rechazo en ahora → otra_sesion, en pre-ejecucion → ya_hubo_envio", () => {
  const est = { kind: "rutinaEstado", v: 2, fecha: "2026-11-02", estado: "en_curso", paso: "preparar", sesion: "s-1", inicio: "2026-11-02T14:47:00Z", latido: "2026-11-02T14:47:00Z", fin: null,
    commit: null, modo: "archivo", ejecucionesAbiertas: [], previo: null, escritos: {}, motivo: null };
  const dir = carpetaConDb({}, null, { noExisten: ["rutina-estado", "punto-2026-11-02"], modo: "archivo" });
  const armar = grupo => armarGrupo({ dir, grupo, modo: "archivo", docs: [{ id: "rutina-estado", data: est }] });
  armar("ahora");
  fs.writeFileSync(path.join(dir, "salida/ahora/resultado.txt"), T.batch_1.replace("(version 1)", "(version 1)\n- set \"data/users/me\"/\"otro\" (version 3)"));
  assert.equal(registrar({ dir, grupo: "ahora" }).accion, "releer");
  armar("ahora");
  fs.writeFileSync(path.join(dir, "salida/ahora/resultado.txt"), "Error: version mismatch for \"data/users/me\"/\"rutina-estado\" (if_version). Nothing was written.");
  assert.equal(registrar({ dir, grupo: "ahora" }).accion, "otra_sesion");
  armar("pre-ejecucion");
  fs.writeFileSync(path.join(dir, "salida/pre-ejecucion/resultado.txt"), "Error: conflict: document already exists");
  assert.equal(registrar({ dir, grupo: "pre-ejecucion" }).accion, "ya_hubo_envio");
  // la cuenta "409 of 25000 documents used" de un batch bueno no es un conflicto
  armar("ahora");
  fs.writeFileSync(path.join(dir, "salida/ahora/resultado.txt"), T.batch_1.replace("28 of 25000", "409 of 25000"));
  assert.equal(registrar({ dir, grupo: "ahora" }).accion, "listo");
  // un texto que no se entiende en ahora no se toma como otra sesión: se relee
  armar("ahora");
  fs.writeFileSync(path.join(dir, "salida/ahora/resultado.txt"), "Timed out");
  assert.equal(registrar({ dir, grupo: "ahora" }).accion, "releer");
});

// ---- días completos: misma sesión que sigue el RUNBOOK, en cada modo ----
const sinFmp = () => transporteFalso(() => ({ http: 0, conectar: 403, texto: "", errorRed: "curl 56" }));
async function dia({ db, raiz, t, modo, fmpRadar, sesion, ad = null }) {
  const l = await preparar(["--fase", "lista", "--modo", modo], { ahora: () => t, raiz });
  const dir = path.join(raiz, ".trabajo", l.linea.fecha);
  const Ss = crearSesion({ db, dir, modo, ad });
  Ss.leer(l.linea.lecturas);
  const p = await preparar(["--dir", path.join(raiz, ".trabajo/hoy"), "--fase", "decidir"], { ahora: () => t, pagina: PAG, sesion });
  const pasos = { preparar: p };
  if (p.linea.escribir) pasos.ahora = Ss.escribir("ahora");
  if (p.codigo !== 0) return { dir, pasos };
  Ss.leer(leerTrabajo(dir, "leer-mas.json").lecturas);
  const prep = leerTrabajo(dir, "preparar.json"), f = fmpRadar();
  pasos.radar = await radar(["--dir", dir, "--modo", prep.radar.accion], { transporteFmp: f.transporte, ahora: f.ahora, pagina: PAG });
  const et = etoroFalso({ portafolio: leerFix("etoro/lunes-ejecutado.json"), tasas: tasasA(leerFix("etoro/lunes-tasas.json").rates, t + 6 * MIN) });
  pasos.cartera = await cartera(["--dir", dir], { transporteEToro: et, transporteFmp: sinFmp(), ahora: () => t + 6 * MIN, pagina: PAG });
  fs.writeFileSync(path.join(dir, "entrada/noticias.json"), JSON.stringify({ v: 1, generadoEl: "x", notas: [] }));
  pasos.decidir = await decidir(["--dir", dir], { ahora: () => t + 12 * MIN, pagina: PAG });
  pasos.cerrar = await cerrar(["--dir", dir], { ahora: () => t + 14 * MIN });
  pasos.final = Ss.escribir("final");
  Ss.leer(leerTrabajo(dir, "verificar.json").lecturas);
  pasos.verificar = await dbCli(["verificar", "--dir", dir]);
  pasos.presupuesto = await dbCli(["presupuesto", "--dir", dir]);
  return { dir, pasos, S: Ss };
}
// lo que debe coincidir entre modos: todo salvo `modo`, el presupuesto medido (en archivo solo pasa el texto) y su h
const normal = d => {
  const x = copia(d);
  delete x.h; if (x.modo) x.modo = "-"; if (x.kind === "bitacora") x.presupuesto = 0;
  if (x.escritos) x.escritos = Object.fromEntries(Object.entries(x.escritos).filter(([k]) => !/^bitacora-\d/.test(k)));
  return x;
};

test("dos días completos en modo archivo dejan en db lo mismo que en línea (salvo `modo`), con las mismas versiones y verificar en 0", { timeout: 300000 }, async t => {
  const docs = Object.assign({}, semilla({ ahora: () => Date.parse("2026-10-31T12:00:00Z") }), { indice: { kind: "indice", v: 1, at: 1, dias: [] } });
  const res = {};
  for (const modo of ["en_linea", "archivo"]) {
    const db = crearDbFalso(copia(docs)), raiz = carpetaTemporal();
    const d1 = await dia({ db, raiz, t: Date.parse("2026-11-02T14:47:00Z"), modo, sesion: "s-d7-1", fmpRadar: () => fmpSintetico() });
    const d2 = await dia({ db, raiz, t: Date.parse("2026-11-03T14:47:00Z"), modo, sesion: "s-d7-2", fmpRadar: () => ({ transporte: sinFmp(), ahora: () => Date.parse("2026-11-03T14:48:00Z") }) });
    for (const d of [d1, d2]) {
      assert.deepEqual([d.pasos.preparar.codigo, d.pasos.ahora.accion, d.pasos.final.accion, d.pasos.verificar.codigo], [0, "listo", "listo", 0], modo);
      assert.equal(d.pasos.cerrar.linea.escribir, modo === "archivo" ? "salida/final/artifactdata.json" : "salida/final/db_write.json");
    }
    res[modo] = { db, d1, d2 };
  }
  const A = res.archivo.db, B = res.en_linea.db;
  assert.deepEqual([...A.docs.keys()].sort(), [...B.docs.keys()].sort());
  for (const [p, d] of B.docs) {
    assert.equal(A.docs.get(p).version, d.version, p);
    assert.deepEqual(normal(A.docs.get(p).data), normal(d.data), p);
    if (A.docs.get(p).data.h) assert.ok(hOk(A.docs.get(p).data), p);
  }
  assert.equal(A.doc("rutina-estado").modo, "archivo"); assert.equal(A.doc("cartera-libro").lotes.length, 5);
  // en modo archivo no se copian datos: por el modelo pasan solo los textos (lecturas) y los argumentos con file_path (escrituras)
  const pa = res.archivo.d1.pasos.presupuesto.linea.resumen, pe = res.en_linea.d1.pasos.presupuesto.linea.resumen;
  t.diagnostic(`presupuesto día 1: archivo ${pa.total} B (copiado ${res.archivo.d1.S.copiado.leidos + res.archivo.d1.S.copiado.escritos}), en línea ${pe.total} B`);
  assert.ok(pa.total < pe.total && pa.total <= 36000);
  // cada texto de lectura quedó en su archivo y ninguno se reemplazó (uno por lectura)
  const textos = fs.readdirSync(path.join(res.archivo.d1.dir, "entrada/archivo")).filter(x => x.endsWith(".txt"));
  const lineas = fs.readFileSync(path.join(res.archivo.d1.dir, "entrada/lecturas.jsonl"), "utf8").trim().split("\n").map(x => JSON.parse(x));
  assert.equal(textos.length, lineas.length); assert.ok(lineas.every(l => l.texto && Object.keys(l).length === 2));
});

test("día con órdenes reales en modo archivo: reclamo sin if_version, envío, cierre y verificar; un segundo reclamo choca", async () => {
  const out = copia(OUT30); Object.assign(out.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 });
  const db = dbInicial({ "rutina-config": Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) });
  const e = await prepararDia({ db, out, modo: "archivo" });
  assert.equal(e.decidir.linea.accion, "ejecutar");
  const ahora = reloj(new Date(LUNES + 11 * MIN).toISOString()), et = etoroGuion({ reloj: ahora });
  await ejecutar(["--dir", e.dir, "--armar"], { transporteEToro: et, ahora, dormir: sinEspera });
  const w = JSON.parse(fs.readFileSync(path.join(e.dir, "salida/pre-ejecucion/artifactdata.json"), "utf8")).writes;
  assert.deepEqual(w.map(x => [x.doc_id, x.if_version]), [["ejecucion-2026-11-02", undefined], ["rutina-estado", leerVersiones(e.dir)["rutina-estado"].version]]);
  // un segundo reclamo del mismo día (otra sesión) se rechaza: el documento ya existe
  const copiaGrupo = fs.readFileSync(path.join(e.dir, "salida/pre-ejecucion/artifactdata.json"), "utf8");
  assert.equal(e.S.escribir("pre-ejecucion").accion, "listo");
  fs.writeFileSync(path.join(e.dir, "salida/pre-ejecucion/artifactdata.json"), copiaGrupo);
  const ad = artifactDataFalso(db);
  fs.writeFileSync(path.join(e.dir, "salida/pre-ejecucion/resultado.txt"), ad.batch(JSON.parse(copiaGrupo)));
  assert.match(fs.readFileSync(path.join(e.dir, "salida/pre-ejecucion/resultado.txt"), "utf8"), /version mismatch/);
  assert.equal(registrar({ dir: e.dir, grupo: "pre-ejecucion" }).accion, "ya_hubo_envio");
  assert.equal(db.version("ejecucion-2026-11-02"), 1);
  // la sesión dueña del reclamo sigue (su reclamo quedó registrado con la versión que devolvió su batch)
  assert.equal((await ejecutar(["--dir", e.dir, "--enviar"], { transporteEToro: et, ahora, dormir: sinEspera })).codigo, 0);
  assert.equal(posts(et).length, 1);
  await cerrar(["--dir", e.dir], { ahora: () => LUNES + 15 * MIN });
  assert.equal(e.S.escribir("final").accion, "listo");
  e.S.leer(leerTrabajo(e.dir, "verificar.json").lecturas);
  assert.equal((await dbCli(["verificar", "--dir", e.dir])).codigo, 0);
  assert.ok(db.doc("ejecucion-2026-11-02").fin); assert.deepEqual(db.doc("ops-2026-11-02").ops.map(o => [o.regla, o.est]), [["V1", "ejecutada"]]);
  assert.ok(presupuesto(e.dir).total <= 40000);
});

test("if_version en modo archivo: si otro escribe entre la lectura y el final, el batch se rechaza entero y nada se pisa", async () => {
  const e = await prepararDia({ modo: "archivo", sinRadar: true });
  await cerrar(["--dir", e.dir], { ahora: () => LUNES + 15 * MIN });
  // otro escritor cambia cartera-libro después de que esta sesión lo leyó
  const ajeno = Object.assign({}, e.db.doc("cartera-libro"), { efectivo: 1.23 });
  e.db.write({ slug: DB_SLUG, ops: [{ op: "set", path: `${DB_RUTA}/cartera-libro`, data: conH(ajeno), ifVersion: e.db.version("cartera-libro") }] });
  const antes = new Map([...e.db.docs].map(([k, v]) => [k, v.version]));
  const r = e.S.escribir("final");
  assert.deepEqual([r.accion, r.codigo], ["conflicto", 3]);
  assert.ok(r.resumen.conflictos.includes("cartera-libro"));
  assert.equal(e.db.doc("cartera-libro").efectivo, 1.23);
  for (const [k, v] of e.db.docs) assert.equal(v.version, antes.get(k), k);
});
