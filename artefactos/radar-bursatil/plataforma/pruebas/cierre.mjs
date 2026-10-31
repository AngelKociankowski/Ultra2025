// Utilidades de las pruebas de 60-cerrar (no es un archivo de prueba).
import fs from "node:fs";
import path from "node:path";
import { semilla } from "../lib/libro.mjs";
import { DB_RUTA } from "../lib/constantes.mjs";
import { OUT30, copia } from "./escenario.mjs";
import { leerSalida } from "./util.mjs";

export const aviso = dir => fs.readFileSync(path.join(dir, "salida/aviso.txt"), "utf8");
export const grupo = dir => leerSalida(dir, "salida/final/db_write.json");
export const idsDe = dir => grupo(dir).ops.map(o => o.path.slice(DB_RUTA.length + 1));
export const docDe = (dir, id) => grupo(dir).ops.find(o => o.path === `${DB_RUTA}/${id}`).data;
export const NOTAS = { v: 1, generadoEl: "2026-11-02T15:00:00Z", notas: [{ id: "n1", titulo: "Fed holds rates steady as inflation cools", medio: "Reuters", url: "https://www.cnbc.com/2026/11/02/fed-holds.html",
  fecha: "2026-11-02", tema: "macro", simbolos: [], resumen: "La Reserva Federal mantuvo su tasa sin cambios.", evento: null }] };
export const outXleEvitar = () => { const out = copia(OUT30); Object.assign(out.rows.find(r => r.symbol === "XLE"), { signal: 1, signalLabel: "Evitar", pct: 44 }); return out; };
export const operarDb = () => ({ "rutina-config": Object.assign(semilla()["rutina-config"], { operar: true, activadoEl: "2026-11-01T15:00:00Z" }) });
export const T_CIERRE = d => d.t + 900000;
export const cts = x => Math.round(x * 100) / 100;
