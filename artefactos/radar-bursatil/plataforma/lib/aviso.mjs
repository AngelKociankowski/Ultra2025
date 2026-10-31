// Aviso al celular (12-plan §5.12): texto fijo armado por código, ≤ 700 caracteres. Puro.
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MAX_AVISO = 700;

export function fechaCorta(fecha) {
  const d = new Date(fecha + "T12:00:00Z");
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}-${MESES[d.getUTCMonth()]}`;
}
export const horaCorta = hhmm => String(hhmm).replace(/^0/, "");
const isNum = v => typeof v === "number" && Number.isFinite(v);
// miles con coma, decimales con punto (es-MX)
export const miles = (x, dec = 0) => (isNum(x) ? x.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—");
const conSigno = (x, dec) => { const f = 10 ** dec, r = Math.round(x * f) / f; return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(dec)}`; };
export const pct = (frac, dec = 2) => (isNum(frac) ? `${conSigno(frac * 100, dec)} %` : "—");
const pts = (x, dec = 2) => (isNum(x) ? `${conSigno(x, dec)} pts` : "—");
const recorta = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export const avisoFinDeSemana = fecha => `Radar · ${fechaCorta(fecha)} · Fin de semana: sin operación.`;
export const avisoFeriado = (fecha, nombre) => `Radar · ${fechaCorta(fecha)} · Feriado NYSE (${nombre}): sin operación.`;
export const AVISO_YA_HECHA = "Radar · la rutina de hoy ya corrió.";
export const AVISO_TEMPRANO = "Radar · fuera de horario; corre a las 9:47 ET.";
export const AVISO_SIN_SEMILLA = "Radar · Falta sembrar la Cartera Radar en db (T18); sin operaciones.";

const VERBO = { real: { compra: "compré", venta: "vendí" }, sim: { compra: "comprar", venta: "vender" } };

// d: { fecha, hora, simulacion, cartera: {valorUSD, valorMXN} | null, rend: §5.13.1 | null, radar: {regimen, cambios, motivoSin} ,
//      notas: [{titulo, medio}], operaciones: [{sym, lado, regla}], alertas: [string], fallas: [{paso, texto}] }
export function armarAviso(d) {
  const L = [];
  L.push(`Radar · ${fechaCorta(d.fecha)} · ${horaCorta(d.hora)} ET${d.simulacion ? " · SIMULACIÓN" : ""}`);
  if (d.cartera && isNum(d.cartera.valorUSD)) {
    const r = d.rend || {}, u = r.usd || {}, m = r.mxn || {};
    let l = `Cartera: US$ ${miles(d.cartera.valorUSD)} (${pct(u.dia)} hoy · ${pct(u.inicio)} desde inicio)`;
    if (isNum(d.cartera.valorMXN)) l += ` · MXN $ ${miles(d.cartera.valorMXN)} (${pct(m.dia)})`;
    L.push(l);
    if (r.spy && isNum(u.inicio) && isNum(r.spy.inicio)) L.push(`vs SPY desde inicio: ${pct(u.inicio - r.spy.inicio)} · meta 15 % anual: ${pts(r.meta15 && r.meta15.difPtsUSD)}`);
  }
  if (d.radar) {
    if (d.radar.motivoSin) L.push(`Radar: sin análisis de hoy (${d.radar.motivoSin})`);
    else {
      const partes = [`régimen ${d.radar.regimen || "—"}`].concat((d.radar.cambios || []).slice(0, 3));
      L.push(`Radar: ${partes.join("; ")}`);
    }
  }
  if (d.notas && d.notas.length) L.push(`Noticias: ${d.notas.slice(0, 2).map(n => `${recorta(n.titulo, 60)} (${n.medio})`).join("; ")}`);
  const ops = d.operaciones || [];
  if (!ops.length) L.push("Operaciones: ninguna");
  else {
    const v = d.simulacion ? VERBO.sim : VERBO.real;
    L.push(`Operaciones: ${ops.length}${d.simulacion ? (ops.length > 1 ? " simuladas" : " simulada") : ""} — ${ops.map(o => `${v[o.lado]} ${o.sym} (${o.regla})`).join(", ")}`);
  }
  if (d.alertas && d.alertas.length) L.push(`Alertas: ${d.alertas.slice(0, 3).join("; ")}`);
  for (const f of d.fallas || []) L.push(`Falla: ${f.paso} — ${f.texto}`);
  // ≤ 700: se recortan primero noticias y alertas, luego la línea del Radar
  let txt = L.join("\n");
  for (const pref of ["Noticias:", "Alertas:", "Radar:"]) {
    if (txt.length <= MAX_AVISO) break;
    const i = L.findIndex(x => x.startsWith(pref));
    if (i < 0) continue;
    const sobra = txt.length - MAX_AVISO;
    if (L[i].length - sobra >= pref.length + 12) L[i] = recorta(L[i], L[i].length - sobra);
    else L.splice(i, 1);
    txt = L.join("\n");
  }
  return txt.length <= MAX_AVISO ? txt : recorta(txt, MAX_AVISO);
}
