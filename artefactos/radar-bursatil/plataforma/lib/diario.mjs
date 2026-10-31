// Diario de envío de 50-ejecutar (12b §F.3.2): una línea JSON por evento, sincronizada a disco antes de cada POST.
import fs from "node:fs";

export function leerDiario(ruta) {
  if (!fs.existsSync(ruta)) return [];
  // una última línea cortada por una caída se ignora: el envío se anota y sincroniza antes del POST
  return fs.readFileSync(ruta, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}
export function anotarSync(ruta, linea) {
  const fd = fs.openSync(ruta, "a");
  try { fs.writeSync(fd, JSON.stringify(linea) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
// N11: lo que el diario sabe de cada línea, en la forma de `res` de §E.5.10, para dejarlo en ejecucion-<f> (sin fin) cuando la
// ejecución queda abierta: qué se envió, cuándo, con qué monto y qué respondió eToro. Una línea sin envío no salió.
export function resDesdeDiario(doc, diario) {
  return (doc.lineas || []).map(l => {
    const e = diario.find(d => d.fase === "envio" && d.id === l.id && d.k === l.k), r = diario.filter(d => d.fase === "respuesta" && d.id === l.id && d.k === l.k).pop();
    const base = { id: l.id, k: l.k, pos: [], px: null, uej: null, usdej: null };
    if (!e) return Object.assign(base, { est: "no_enviada", env: null, http: null, o: null, usd: null, err: "sin envío en el diario" });
    const clase = r ? r.clase : null;
    return Object.assign(base, { est: ["rechazada", "no_enviada", "aceptada"].includes(clase) ? clase : "incierta", env: e.t, http: r ? r.http ?? null : null, o: r ? r.orderId ?? null : null,
      usd: l.lado === "c" ? (typeof e.usd === "number" ? e.usd : l.usd) : null, err: r ? r.motivo || null : "sin respuesta en el diario" });
  });
}
