// Aviso al celular (12-plan §5.12): texto fijo armado por código, ≤ 700 caracteres. Puro.
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MAX_AVISO = 700;

export function fechaCorta(fecha) {
  const d = new Date(fecha + "T12:00:00Z");
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}-${MESES[d.getUTCMonth()]}`;
}
export const horaCorta = hhmm => String(hhmm).replace(/^0/, "");
export const diaMes = fecha => fechaCorta(fecha).split(" ")[1];
const FUENTE = { rutina: "corrida propia", pagina: "página" };
// 12c §C.5–C.6: de dónde salió el análisis y de cuándo
function lineaRadar(r) {
  if (r.sinRadar) return r.motivo === "pagina_cambio" ? "Radar: la página del Radar cambió; sin Radar no se opera." : "Radar: sin datos de FMP hoy; sin Radar no se opera.";
  const partes = [];
  if (r.fuente && r.mismo) partes.push(`mismo análisis que el día anterior (${FUENTE[r.fuente]} del ${diaMes(r.fa)})`);
  else if (r.fuente === "pagina") partes.push(`análisis de la página del ${diaMes(r.fa)} (${r.ant} ${r.ant === 1 ? "día hábil" : "días hábiles"})`);
  else if (r.fuente === "rutina" && r.ant > 0) partes.push(`corrida propia del ${diaMes(r.fa)} (${r.ant} ${r.ant === 1 ? "día hábil" : "días hábiles"})`);
  else if (r.fuente === "rutina") partes.push("corrida propia de hoy");
  partes.push(`régimen ${r.regimen || "—"}`);
  if (r.sinCompras) partes.push(`sin compras: el Radar tiene ${r.ant} días`);
  return `Radar: ${partes.concat(r.mismo ? [] : (r.cambios || []).slice(0, 3)).join("; ")}`;
}
// en el push: Radar hoy | Radar pág <d-mes> | Sin Radar
const radarPush = r => (!r || r.sinRadar ? "Sin Radar" : r.fuente === "pagina" ? `Radar pág ${diaMes(r.fa)}` : r.fuente === "rutina" && r.ant > 0 ? `Radar ${diaMes(r.fa)}` : "Radar hoy");
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

const PASADO = { compra: "compré", venta: "vendí" }, INFIN = { compra: "comprar", venta: "vender" };

// d: { fecha, hora, simulacion, cartera: {valorUSD, valorMXN} | null, rend: {usd:[…], mxn:[…], spy:[…], meta:[…]} | null,
//      radar: {regimen, cambios} | {sinRadar, motivo}, notas: [{titulo, medio}], operaciones: [{sym, lado, regla, est, motivo}],
//      alertas: [string], fallas: [{paso, texto}] }
export function armarAviso(d) {
  const L = [];
  L.push(`Radar · ${fechaCorta(d.fecha)} · ${horaCorta(d.hora)} ET${d.simulacion ? " · SIMULACIÓN" : ""}`);
  if (d.cartera && isNum(d.cartera.valorUSD)) {
    const r = d.rend || {}, u = r.usd || [], m = r.mxn || [], sp = r.spy || [];
    let l = `Cartera: US$ ${miles(d.cartera.valorUSD)} (${pct(u[0])} hoy · ${pct(u[4])} desde inicio)`;
    if (isNum(d.cartera.valorMXN)) l += ` · MXN $ ${miles(d.cartera.valorMXN)} (${pct(m[0])})`;
    L.push(l);
    if (isNum(u[4]) && isNum(sp[4])) L.push(`vs SPY desde inicio: ${pct(u[4] - sp[4])} · meta 15 % anual: ${pts(r.meta && r.meta[1])}`);
  }
  if (d.radar) L.push(lineaRadar(d.radar));
  if (d.notas && d.notas.length) L.push(`Noticias: ${d.notas.slice(0, 2).map(n => `${recorta(n.titulo, 60)} (${n.medio})`).join("; ")}`);
  const ops = d.operaciones || [];
  if (d.simulacion && ops.length) L.push(`Operaciones: ${ops.length} ${ops.length > 1 ? "simuladas" : "simulada"} — ${ops.map(o => `${INFIN[o.lado]} ${o.sym} (${o.regla})`).join(", ")}`);
  else if (d.simulacion) L.push("Operaciones: ninguna");
  else {
    // H12: solo lo que llegó a eToro se cuenta como hecho; lo rechazado o no enviado va aparte
    const hechas = ops.filter(o => ["ejecutada", "aceptada", "incierta"].includes(o.est)).map(o => o.est === "ejecutada" ? `${PASADO[o.lado]} ${o.sym} (${o.regla})`
      : o.est === "aceptada" ? `${o.lado} ${o.sym} enviada, sin ejecutar aún` : `${o.lado} ${o.sym} sin confirmar`);
    L.push(hechas.length ? `Operaciones: ${hechas.length} — ${hechas.join(", ")}` : "Operaciones: ninguna");
    const no = ops.filter(o => o.est === "rechazada" || o.est === "no_enviada");
    if (no.length) L.push(`No se ejecutaron: ${no.map(o => `${o.sym} (${recorta(String(o.motivo || o.est), 40)})`).join(", ")}`);
  }
  if (d.alertas && d.alertas.length) L.push(`Alertas: ${d.alertas.slice(0, 3).join("; ")}`);
  for (const f of d.fallas || []) L.push(f.linea || `Falla: ${f.paso} — ${f.texto}`);
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

// ---- Línea de PushNotification (00q §3): una línea de ≤ 200 caracteres; el aviso completo va en el chat ----
export const MAX_PUSH = 200;
export const lineaPush = texto => recorta(String(texto).split("\n").map(x => x.trim()).filter(Boolean).join(" · "), MAX_PUSH);
export const pushConFalla = (push, falla) => { const suf = ` · ${falla}`; return recorta(String(push), MAX_PUSH - suf.length) + suf; };
const ESTADO_PUSH = { ejecutada: o => `${PASADO[o.lado]} ${o.sym}`, aceptada: o => `${o.lado} ${o.sym} enviada`, incierta: o => `${o.lado} ${o.sym} sin confirmar` };
// d: lo mismo que armarAviso. Valor y % del día en USD y en MXN, vs SPY desde inicio, Radar sí/no, operaciones y, si hubo, fallas.
export function armarPush(d) {
  const P = [`Radar · ${fechaCorta(d.fecha)}${d.simulacion ? " · SIM" : ""}`];
  if (d.cartera && isNum(d.cartera.valorUSD)) {
    const r = d.rend || {}, u = r.usd || [], m = r.mxn || [], sp = r.spy || [];
    P.push(`US$ ${miles(d.cartera.valorUSD)} (${pct(u[0])} hoy)`);
    if (isNum(d.cartera.valorMXN)) P.push(`MXN $ ${miles(d.cartera.valorMXN)} (${pct(m[0])} hoy)`);
    if (isNum(u[4]) && isNum(sp[4])) P.push(`vs SPY desde inicio ${pct(u[4] - sp[4])}`);
  } else P.push("sin valuación");
  P.push(radarPush(d.radar));
  const ops = d.operaciones || [];
  let cuenta, detalle;
  if (d.simulacion) {
    cuenta = ops.length ? `${ops.length} ${ops.length > 1 ? "simuladas" : "simulada"}` : "ninguna";
    detalle = ops.map(o => `${INFIN[o.lado]} ${o.sym}`);
  } else {
    const hechas = ops.filter(o => ESTADO_PUSH[o.est]), no = ops.filter(o => o.est === "rechazada" || o.est === "no_enviada");
    cuenta = [hechas.length ? String(hechas.length) : null, no.length ? `${no.length} sin ejecutar` : null].filter(Boolean).join(", ") || "ninguna";
    detalle = hechas.map(o => ESTADO_PUSH[o.est](o)).concat(no.map(o => `${o.sym} sin ejecutar`));
  }
  const fallas = [...new Set((d.fallas || []).map(f => f.paso))];
  const base = P.concat([`Ops: ${cuenta}`]).join(" · "), cola = fallas.length ? ` · Falla: ${fallas.join(", ")}` : "";
  // el detalle de operaciones entra hasta donde quepa; lo que no, queda como "…"
  const entre = n => (n ? ` (${detalle.slice(0, n).join(", ")}${n < detalle.length ? ", …" : ""})` : "");
  let n = detalle.length;
  while (n > 0 && (base + entre(n) + cola).length > MAX_PUSH) n--;
  return lineaPush(base + entre(n) + cola);
}
