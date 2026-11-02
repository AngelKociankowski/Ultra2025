// Documentos de la página en el db falso (volcado del 30-oct: indice real medido en D-R1, dia-2026-10-30 y sus 4 partes) y el
// recorrido del paso 4 con `10-radar --modo pagina` (no es un archivo de prueba).
import fs from "node:fs";
import { leerFix } from "./util.mjs";
import { main as radar } from "../bin/10-radar.mjs";

// extra: documentos que cambian o se agregan; con valor null, el documento no está
export const docsPagina = (extra = {}) => Object.fromEntries(Object.entries(Object.assign({ indice: leerFix("dia-2026-10-30/indice.json"), "dia-2026-10-30": leerFix("dia-2026-10-30/dia-2026-10-30.json") },
  Object.fromEntries([0, 1, 2, 3].map(k => [`dia-2026-10-30-p${k}`, leerFix(`dia-2026-10-30/dia-2026-10-30-p${k}.json`)])), extra)).filter(([, v]) => v !== null));

// corre `--modo pagina` y, mientras pida leer, hace LEER-PÁGINA con la sesión (a lo más 6 veces, como el RUNBOOK)
export async function radarPagina({ dir, S, pagina, ahora, cache = null }) {
  let r = await radar(["--dir", dir, "--modo", "pagina"], { pagina, ahora, cache }), rondas = 0;
  while (r.linea.accion === "leer" && rondas < 6) {
    rondas++;
    S.leerPagina(JSON.parse(fs.readFileSync(`${dir}/trabajo/leer-pagina.json`, "utf8")).lecturas);
    r = await radar(["--dir", dir, "--modo", "pagina"], { pagina, ahora, cache });
  }
  return Object.assign(r, { rondas });
}
