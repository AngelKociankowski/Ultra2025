// T01 · Andamiaje: archivos, http, llaves, esperar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { leerDoc, escribirDoc, borrarDoc, ordenDe, ErrorArchivo, leerArgs } from "../lib/archivos.mjs";
import { crearHttp, transporteFalso, ErrorHttp } from "../lib/http.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { DOC_MAX, CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { main as esperar } from "../bin/esperar.mjs";
import { RAIZ, carpetaConDb, archivosBajo } from "./util.mjs";

test("package.json sin dependencias", () => {
  const p = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  assert.equal(p.dependencies, undefined);
  assert.equal(p.devDependencies, undefined);
  assert.equal(p.type, "module");
});

test("leerDoc distingue no_existe, fallo (_fallos) y ok", () => {
  const dir = carpetaConDb({ corrida: { kind: "corrida", v: 1 }, "cartera-libro": { kind: "carteraLibro" } }, { "cartera-libro": "resource_exhausted", "rutina-estado": "unavailable" });
  assert.deepEqual(leerDoc(dir, "corrida"), { estado: "ok", doc: { kind: "corrida", v: 1 }, codigo: null });
  assert.equal(leerDoc(dir, "indice").estado, "no_existe");
  const f = leerDoc(dir, "rutina-estado");
  assert.equal(f.estado, "fallo"); assert.equal(f.codigo, "unavailable");
  // en _fallos aunque haya archivo: nunca "existe" ni "no existe"
  assert.equal(leerDoc(dir, "cartera-libro").estado, "fallo");
  fs.writeFileSync(path.join(dir, "entrada", "db", "plan.json"), "{roto");
  assert.equal(leerDoc(dir, "plan").estado, "fallo");
  assert.throws(() => leerDoc(dir, "../x"), ErrorArchivo);
});

test("escribirDoc: tope de 150 000 B compactos, kind obligatorio, _orden en orden de llamada", () => {
  const dir = carpetaConDb();
  const grande = { kind: "x", s: "a".repeat(DOC_MAX - 18) }; // compacto = DOC_MAX + 1
  assert.equal(Buffer.byteLength(JSON.stringify(grande)), DOC_MAX + 1);
  assert.throws(() => escribirDoc(dir, "final", "grande", grande), e => e.codigo === "doc_grande");
  const justo = { kind: "x", s: "a".repeat(DOC_MAX - 19) };
  assert.equal(escribirDoc(dir, "final", "justo", justo).bytes, DOC_MAX);
  assert.throws(() => escribirDoc(dir, "final", "sinkind", { v: 1 }), e => e.codigo === "sin_kind");
  escribirDoc(dir, "final", "b-doc", { kind: "b" });
  borrarDoc(dir, "final", "viejo");
  escribirDoc(dir, "final", "a-doc", { kind: "a" });
  assert.deepEqual(ordenDe(dir, "final"), [
    { id: "justo", archivo: "salida/final/justo.json", accion: "escribir" },
    { id: "b-doc", archivo: "salida/final/b-doc.json", accion: "escribir" },
    { id: "viejo", accion: "borrar" },
    { id: "a-doc", archivo: "salida/final/a-doc.json", accion: "escribir" },
  ]);
  // el archivo es JSON compacto
  assert.equal(fs.readFileSync(path.join(dir, "salida/final/a-doc.json"), "utf8"), '{"kind":"a"}');
});

test("http rechaza POST sin /demo/ antes de invocar el transporte", async () => {
  const t = transporteFalso(() => ({ http: 200, texto: "{}" }));
  const h = crearHttp({ transporte: t });
  const malas = [
    "https://public-api.etoro.com/api/v1/trading/execution/market-close-orders/positions/1",
    "https://public-api.etoro.com/api/v2/trading/execution/orders",
    "https://public-api.etoro.com/api/v2/trading/execution/demo/orders/extra",
    "https://public-api.etoro.com/api/v1/trading/execution/demo/market-close-orders/positions/1/x",
    "https://public-api.etoro.com/api/v1/trading/info/demo/portfolio",
    "https://financialmodelingprep.com/stable/quote?symbol=SPY",
    "https://otro.example.com/api/v2/trading/execution/demo/orders",
    "http://public-api.etoro.com/api/v2/trading/execution/demo/orders",
  ];
  for (const u of malas) await assert.rejects(() => h.post(u, { a: 1 }), ErrorHttp, u);
  await assert.rejects(() => h.get("https://public-api.etoro.com/api/v1/trading/info/real/portfolio"), e => e.codigo === "ruta_prohibida");
  await assert.rejects(() => h.get("https://evil.example.com/x"), e => e.codigo === "host_prohibido");
  assert.equal(t.llamadas.length, 0);
  // las dos rutas Demo sí pasan
  await h.post("https://public-api.etoro.com/api/v2/trading/execution/demo/orders", { a: 1 });
  await h.post("https://public-api.etoro.com/api/v1/trading/execution/demo/market-close-orders/positions/123", { a: 1 });
  assert.equal(t.llamadas.length, 2);
  assert.equal(t.llamadas[0].metodo, "POST");
});

test("http no deja poner encabezados de llaves", async () => {
  const t = transporteFalso(() => ({ http: 200, texto: "[]" }));
  const h = crearHttp({ transporte: t });
  for (const k of ["x-" + "api-key", "x-" + "user-key", "api" + "key", "Authorization"]) {
    await assert.rejects(() => h.get("https://financialmodelingprep.com/stable/quote?symbol=SPY", { encabezados: { [k]: "x" } }), e => e.codigo === "encabezado_prohibido");
  }
  assert.equal(t.llamadas.length, 0);
});

// Allowlist: esta línea es la única coincidencia permitida del patrón de llaves en el repo de la plataforma.
const PATRON_LLAVES = /apikey|x-api-key|x-user-key/i;
test("ningún archivo de lib/ ni bin/ menciona llaves", () => {
  const hallazgos = [];
  for (const base of ["lib", "bin"]) for (const f of archivosBajo(path.join(RAIZ, base))) {
    fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (PATRON_LLAVES.test(l)) hallazgos.push(`${path.relative(RAIZ, f)}:${i + 1}`); });
  }
  assert.deepEqual(hallazgos, []);
});

test("registro recorta textos largos y no pierde líneas", () => {
  const r = crearRegistro({ paso: "x", ahora: () => 5 });
  r.info("hola", { cuerpo: "z".repeat(500) });
  assert.equal(r.lineas[0].datos.cuerpo.length, 201);
  assert.equal(r.lineas[0].nivel, "info");
});

test("constantes congeladas", () => {
  assert.ok(Object.isFrozen(CONFIG_DEFECTO) && Object.isFrozen(CONFIG_DEFECTO.ventanaET));
  assert.equal(CONFIG_DEFECTO.operar, false);
});

test("esperar: --help sale con 0; rango 1–300", async () => {
  assert.equal((await esperar(["--help"])).codigo, 0);
  let dormido = 0;
  const r = await esperar(["2"], { dormir: async ms => { dormido = ms; } });
  assert.equal(r.codigo, 0); assert.equal(dormido, 2000); assert.equal(r.linea.accion, "listo");
  assert.equal((await esperar(["0"], { dormir: async () => {} })).codigo, 1);
  assert.equal((await esperar(["301"], { dormir: async () => {} })).codigo, 1);
  assert.throws(() => leerArgs(["--nope"]), ErrorArchivo);
});

// Regla del director: ningún identificador de la cuenta del dueño en el repo (los fixtures usan CID ficticio 10000001).
test("el CID real de la cuenta no aparece en ningún archivo de plataforma/", () => {
  const cidReal = "1456" + "9031";
  const hallazgos = archivosBajo(RAIZ).filter(f => fs.readFileSync(f, "latin1").includes(cidReal)).map(f => path.relative(RAIZ, f));
  assert.deepEqual(hallazgos, []);
});
