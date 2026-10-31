// Prueba de humo de eToro Demo para el director: solo lecturas (GET). Uso: node bin/humo-etoro.mjs
import { pathToFileURL } from "node:url";
import { crearEToro } from "../lib/etoro.mjs";
import { transporteCurl } from "../lib/http.mjs";
import { leerArgs } from "../lib/archivos.mjs";

const AYUDA = "Uso: node bin/humo-etoro.mjs   (GET a portafolio, pnl, tasas de SPY y búsqueda de SPY; imprime OK/FALLA por fila)";

const FILAS = [
  ["portafolio", et => et.portafolio(), r => !!(r && r.clientPortfolio && Array.isArray(r.clientPortfolio.positions) && Array.isArray(r.clientPortfolio.ordersForOpen))],
  ["pnl", et => et.pnl(), r => !!(r && r.clientPortfolio && Array.isArray(r.clientPortfolio.positions))],
  ["tasas 3000", et => et.tasas([3000]), r => !!(r && Array.isArray(r.rates) && r.rates.some(x => x.instrumentID === 3000 && typeof x.bid === "number"))],
  ["buscar SPY", et => et.buscar("SPY"), r => !!(r && Array.isArray(r.items) && r.items.some(x => x.internalSymbolFull === "SPY" && x.instrumentId === 3000))],
];

export async function main(argv, { transporte = transporteCurl(), escribir = t => process.stdout.write(t) } = {}) {
  const a = leerArgs(argv);
  if (a.ayuda) { escribir(AYUDA + "\n"); return { codigo: 0, linea: null }; }
  const et = crearEToro({ transporte });
  let fallas = 0;
  for (const [nombre, f, ok] of FILAS) {
    let txt;
    try { txt = ok(await f(et)) ? "OK" : "FALLA forma inesperada"; }
    catch (e) { txt = `FALLA ${e && e.codigo ? e.codigo : "error"}${e && e.http ? " HTTP " + e.http : ""}`; }
    if (txt !== "OK") fallas++;
    escribir(`${nombre.padEnd(12)} ${txt}\n`);
  }
  return { codigo: fallas ? 1 : 0, linea: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(r => { process.exitCode = r.codigo; }, e => { process.stderr.write(String(e && e.message || e) + "\n"); process.exitCode = 1; });
}
