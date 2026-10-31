// Utilidades de las pruebas de 50-ejecutar (no es un archivo de prueba): carpeta con plan real, eToro con guion y reclamo.
import fs from "node:fs";
import path from "node:path";
import { main as ejecutar } from "../bin/50-ejecutar.mjs";
import { shaArchivo } from "../bin/40-decidir.mjs";
import { escribirTrabajo, leerTrabajo } from "../lib/archivos.mjs";
import { requestIdDe, configEfectiva } from "../lib/reglas.mjs";
import { valuar, semilla } from "../lib/libro.mjs";
import { registrar } from "../lib/db.mjs";
import { CONFIG_DEFECTO } from "../lib/constantes.mjs";
import { etoroFalso } from "./etoro-falso.mjs";
import { libroLunes, prepararDia, copia } from "./escenario.mjs";
import { carpetaConDb, leerFix } from "./util.mjs";

export const F = "2026-11-04";
export const T0 = "2026-11-04T15:00:00Z"; // mié 10:00 ET
export const CONFIG = configEfectiva(Object.assign(copia(CONFIG_DEFECTO), { operar: true, activadoEl: "2026-11-03T12:00:00Z" })).config;
export const orden = (o, i, f = F) => Object.assign({ orden: i + 1, noticias: [], requestIds: (o.cierres || [0]).map((_, k) => requestIdDe(f, o.id, k)) }, o);
export const planDe = (f = F) => [
  { id: `${f}-XLE-V1`, sym: "XLE", instrumentId: 3008, lado: "venta", regla: "V1", montoUSD: null, cierres: [{ positionId: 2600000005, unidades: null }], motivo: "Pasó a Evitar (44 %)" },
  { id: `${f}-SPY-R1`, sym: "SPY", instrumentId: 3000, lado: "venta", regla: "R1", montoUSD: null, cierres: [{ positionId: 2600000001, unidades: null }, { positionId: 2600000002, unidades: 2 }], motivo: "Desviación" },
  { id: `${f}-QQQ-C1`, sym: "QQQ", instrumentId: 3006, lado: "compra", regla: "C1", montoUSD: 1500, cierres: null, motivo: "Entra al objetivo" },
  { id: `${f}-IWM-C1`, sym: "IWM", instrumentId: 3005, lado: "compra", regla: "C1", montoUSD: 800, cierres: null, motivo: "Entra al objetivo" },
].map((o, i) => orden(o, i, f));
export const PLAN = planDe();
export const COMPRA = [orden(Object.assign({}, PLAN[2]), 0)];

// carpeta del día con plan real (como la dejan 00-preparar, 20-cartera y 40-decidir)
export function montar({ plan = PLAN, efectivo = 5000, simulacion = false, alterar = false, f = F } = {}) {
  const libro = libroLunes();
  if (efectivo !== null) libro.efectivoUSD = efectivo;
  // rutina-config con operar activado tal como llega de db (50-ejecutar lo exige, N9)
  const dir = carpetaConDb({ "rutina-config": Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-03T12:00:00Z" }) });
  escribirTrabajo(dir, "preparar.json", { fechaET: f, modo: "en_linea", rutina: { accion: "continuar", sesion: "s-prueba1" }, config: CONFIG });
  escribirTrabajo(dir, "cartera.json", { estado: "listo", libro, valuacion: valuar({ libro, tasas: leerFix("etoro/lunes-tasas.json"), fx: { valor: 18.7, fuente: "etoro" } }) });
  escribirTrabajo(dir, "plan-ordenes.json", { fecha: f, simulacion, ordenes: plan });
  escribirTrabajo(dir, "decisiones.json", { fecha: f, simulacion, planSha: alterar ? "0".repeat(64) : shaArchivo(path.join(dir, "trabajo/plan-ordenes.json")), decisiones: [] });
  return { dir, libro };
}
// respuesta de db_write a pre-ejecucion: creada (versión 1) o 409 (ya existía)
export function reclamar(dir, { choque = false } = {}) {
  fs.writeFileSync(path.join(dir, "salida/pre-ejecucion/resultado.json"), JSON.stringify(choque ? leerFix("db/escritura-409.json") : { results: [{ version: 1 }] }));
  return registrar({ dir, grupo: "pre-ejecucion" });
}
export async function armarYReclamar(dir, opciones) {
  const a = await ejecutar(["--dir", dir, "--armar"], opciones);
  if (a.linea.accion !== "armado") return { armar: a, reclamo: null };
  return { armar: a, reclamo: reclamar(dir) };
}
// plan real en un día completo de escenario.mjs (con db falso): reemplaza el plan de 40-decidir y su huella
export async function diaReal({ plan, efectivo = 5000 }) {
  const s = semilla();
  const e = await prepararDia({ dbExtra: { "rutina-config": Object.assign(s["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }), "cartera-libro": Object.assign(s["cartera-libro"], { efectivo }) } });
  escribirTrabajo(e.dir, "plan-ordenes.json", { fecha: "2026-11-02", simulacion: false, ordenes: plan });
  const dec = leerTrabajo(e.dir, "decisiones.json");
  escribirTrabajo(e.dir, "decisiones.json", Object.assign(dec, { simulacion: false, planSha: shaArchivo(path.join(e.dir, "trabajo/plan-ordenes.json")) }));
  return e;
}

// eToro con estado. fallas[n]: respuesta forzada del n-ésimo POST ({resp, noLlego}); retrasoVisible: las compras aparecen en el
// portafolio solo tras k lecturas; antesDePost(req): se llama antes de que el POST tenga efecto (p. ej. para revisar el diario).
export function etoroGuion({ fallas = {}, reloj, retrasoVisible = 0, antesDePost = null }) {
  let n = 0, lecturas = 0;
  const pf = copia(leerFix("etoro/lunes-ejecutado.json"));
  const ocultas = [];
  const t = etoroFalso({
    portafolio: () => { lecturas++; for (const o of ocultas.splice(0)) { if (lecturas >= o.desde) pf.clientPortfolio.positions.push(o.p); else ocultas.push(o); } return pf; },
    tasas: leerFix("etoro/lunes-tasas.json").rates.concat([{ instrumentID: 3006, bid: 690, ask: 690.1 }, { instrumentID: 3005, bid: 280, ask: 280.1 }]),
    historial: [{ positionId: 2600000005, closeRate: 70.5 }, { positionId: 2600000001, closeRate: 757.5 }, { positionId: 2600000002, closeRate: 757.5 }],
    post: req => {
      n++;
      if (antesDePost) antesDePost(req, n);
      const f = fallas[n], c = JSON.parse(req.cuerpo), m = new URL(req.url).pathname.match(/positions\/(\d+)$/);
      if (!(f && f.noLlego)) {
        if (m) {
          const id = Number(m[1]), i = pf.clientPortfolio.positions.findIndex(p => p.positionID === id);
          if (i >= 0) { if (c.UnitsToDeduct === null) pf.clientPortfolio.positions.splice(i, 1); else pf.clientPortfolio.positions[i].units = Math.round((pf.clientPortfolio.positions[i].units - c.UnitsToDeduct) * 1e6) / 1e6; }
        } else {
          const px = c.instrumentId === 3006 ? 690 : 280;
          const p = { positionID: 2800000000 + n, orderID: 6000 + n, instrumentID: c.instrumentId, units: Math.floor(c.amount / px * 1e6) / 1e6, amount: c.amount, openRate: px, openDateTime: new Date(reloj.ahora()).toISOString(), isBuy: true, leverage: 1 };
          if (retrasoVisible) ocultas.push({ p, desde: lecturas + retrasoVisible }); else pf.clientPortfolio.positions.push(p);
        }
      }
      if (f && f.resp) return typeof f.resp === "function" ? f.resp() : f.resp;
      if (m) return { http: 200, texto: JSON.stringify({ orderForClose: { positionID: Number(m[1]), instrumentID: c.InstrumentId, unitsToDeduct: c.UnitsToDeduct, orderID: 5000 + n } }) };
      return { http: 200, texto: JSON.stringify({ token: "00000000-0000-4000-8000-0000000000f1", orderId: 6000 + n, referenceId: "00000000-0000-4000-8000-0000000000f2" }) };
    },
  });
  t.pf = pf;
  return t;
}
// reloj que avanza 1 s por lectura; `ahora()` mira sin avanzar
export function reloj(iso = T0) {
  let x = Date.parse(iso);
  const f = () => (x += 1000);
  f.ahora = () => x;
  f.saltar = ms => { x += ms; };
  return f;
}
export const posts = t => t.llamadas.filter(c => c.metodo === "POST");
export const sinEspera = async () => {};
export const leerDiario = dir => fs.readFileSync(path.join(dir, "trabajo/diario-ejecucion.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
export const resDe = dir => leerTrabajo(dir, "ejecucion.json").res;
export { ejecutar };
