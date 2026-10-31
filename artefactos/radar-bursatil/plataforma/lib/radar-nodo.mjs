// Corredor del Radar sin navegador (12-plan §5.4): puerto de la orquestación de la corrida Starter de ui.js v5.5.1
// (runCtx, runPaid, deepSteps, fetchFinalists, loadMacro, stripJump, asOfNow). El modelo (C.analyze) y la capa de datos
// (D.create, call, runQueue, detectPlan, classifyError) son los de la página, tal cual. Lo que decide qué se pide y en qué
// orden no se cambia: cualquier diferencia de llamadas contra la página es un bug (T05).
const PAGE_KINDS = new Set(["limit_reached", "auth", "not_connected", "selection", "no_mcp", "policy"]);
const FATAL_SCREEN = new Set(["approval", "denied_scope", "unknown", "bug", "user_changed"]);
const OUTAGE_CODES = new Set(["server_unavailable", "upstream_error"]);
const DEEP_KEYS = ["eodLight", "keyMetrics", "scores", "ratios", "earnings", "ptSummary", "grades", "ptConsensus"];
// textos literales de ui.js
const NO_PASS = n => `FMP devolvió ${n} cotizaciones, pero ninguna pasó el filtro de acciones (volumen, fecha, precio o bolsa); no se guardó nada.`;
const VIX_BAD = "El VIX que llegó de FMP no es válido: este análisis usa el régimen neutral.";
const PARTIAL_TXT = { "por minuto": "Análisis parcial: FMP limitó las consultas por minuto; se puede reanudar." };

// Almacenamiento en memoria con la interfaz de localStorage: el contador de la página (budget) sobrevive a setPlan como en el
// navegador; con makeStorage(null) la sonda se pierde al pasar a STARTER.
function memoria() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

export async function correrRadar({ C, D, mcp, ahora, feriados, registro = null, previo = null }) {
  const CFG = C.CONFIG, isNum = C.isNum, isObj = x => !!x && typeof x === "object";
  const STRIP = C.NONSTOCK.filter(d => d.strip), RANKED = C.NONSTOCK.filter(d => d.rank);
  const t0 = ahora(), log = (msg, datos) => { if (registro) registro.info(msg, datos); };
  const cl = D.create({ mcp, storage: D.makeStorage(memoria()), now: ahora, plan: "FREE", concurrency: CFG.CONCURRENCY });
  const llamadas = () => {
    const b = cl.budget.get().byCat;
    return { total: Object.values(b).reduce((a, x) => a + x, 0), porCat: { sonda: b.sonda || 0, macro: b.macro || 0, franja: b.franja || 0, corrida: b.corrida || 0 } };
  };
  const fin = (estado, out, motivo) => ({ estado, out, motivo, tier: cl.plan(), llamadas: llamadas(), duracionMs: ahora() - t0 });

  const det = await cl.detectPlan({ force: true });
  log("plan detectado", { tier: det.tier, source: det.source, probes: det.probes });
  if (det.source === "default" && det.error) return fin("error", null, det.error.kind);
  if (det.tier !== "STARTER") return fin("error", null, `plan_no_soportado:${det.tier}`);

  const today = C.etParts(ahora()).date;
  const s = { macro: { spxDesc: null, treasuryDesc: null }, quotes: {}, run: { cut: null, outage: null, stage: null, done: 0 } };
  for (const d of STRIP) s.quotes[d.symbol] = { q: null, rej: 0 };

  // loadMacro(true) — ui.js 817–833
  async function loadMacro() {
    const opt = { section: "macro", cat: "macro" };
    const [spx, tr] = await Promise.allSettled([
      cl.call("eodIndex", { symbol: "^GSPC", from: C.addDays(today, -CFG.SPX_DAYS), to: today }, opt),
      cl.call("treasury", { from: C.addDays(today, -CFG.TREASURY_DAYS), to: today }, opt),
    ]);
    if (spx.status === "fulfilled") s.macro.spxDesc = spx.value;
    s.macro.treasuryDesc = tr.status === "fulfilled" ? tr.value : s.macro.treasuryDesc || null;
  }
  // stripJump — ui.js 679–683, con res = previo y modo "live"
  function stripJump(sym, q, last, hist) {
    const res = previo, r = res && res.rows.find(x => x.symbol === sym), g = res && res.regime, b = C.normalizeEod(hist || (sym === "^GSPC" && s.macro.spxDesc)).pop();
    const ref = last && isNum(last.price) ? last.price : r ? r.price : sym === "^VIX" && g && !g.vixEstimated ? g.vix : b ? b.close : null;
    const prev = r && isNum(r.changePct) && r.changePct > -100 ? r.price / (1 + r.changePct / 100) : null;
    return C.quoteBad(q, ref, prev, CFG.QUOTE_SANE[sym]);
  }
  // asOfNow — ui.js 803–807
  function asOfNow() {
    const q = s.quotes["^GSPC"].q;
    if (q && isNum(q.timestamp)) return C.etParts(q.timestamp * 1000).date;
    return C.lastTradingDayOnOrBefore(today, feriados);
  }

  // 1. Macro
  await loadMacro();
  log("macro", { spx: !!s.macro.spxDesc, treasury: !!s.macro.treasuryDesc });
  // 2. Franja (como onQuote: fila del símbolo o la primera; precio numérico; control de salto contra lo último aceptado)
  const fr = await cl.runQueue(STRIP.map(d => () => cl.call("quote", { symbol: d.symbol }, { section: "strip", cat: "franja" })));
  STRIP.forEach((d, i) => {
    const r = fr[i], q = s.quotes[d.symbol];
    if (!r.ok) return;
    const row = r.value.find(x => x && x.symbol === d.symbol) || r.value[0];
    if (!row || !isNum(row.price)) return;
    if (stripJump(d.symbol, row, q.q)) { q.rej = 1; return; }
    q.q = row;
  });
  log("franja", { ok: STRIP.filter(d => s.quotes[d.symbol].q).length, rechazadas: STRIP.filter(d => s.quotes[d.symbol].rej).length });

  // runCtx — ui.js 1243–1316 (sin caché de la corrida, techo, candado de pestañas ni pantalla)
  const ac = new AbortController();
  const fatalErr = e => e.kind !== "limit_reached" && (PAGE_KINDS.has(e.kind) || (s.run.stage === "stage1" && FATAL_SCREEN.has(e.kind) && !OUTAGE_CODES.has(e.code) && e.code !== "bad_request"));
  function runCtx() {
    let throttles = 0;
    const onThrottle = () => { throttles++; if (throttles > CFG.THROTTLE_MAX) { cut("por minuto"); return false; } return true; };
    const opt = { section: "ranking", cat: "corrida", signal: ac.signal, onThrottle };
    let streak = 0, anyOk = false, issued = 0, okSeq = 0, rejSeqs = [];
    const okKeys = new Set(), tally = { calls: 0, rejected: 0, cached: 0, saved: 0 };
    const cut = why => { if (!s.run.cut && !s.run.outage) s.run.cut = why; };
    const answered = seq => { if (seq > okSeq) { okSeq = seq; rejSeqs = rejSeqs.filter(f => f > seq); } };
    const suspicious = seq => {
      if (seq > okSeq) rejSeqs.push(seq);
      if (rejSeqs.length >= CFG.SUSPECT_STREAK && anyOk && !s.run.outage && !s.run.cut) cut("posible límite");
    };
    const call = (key, args) => {
      const seq = ++issued;
      return cl.call(key, args, opt).then(v => {
        tally.calls++; streak = 0;
        if (Array.isArray(v) && !v.length) suspicious(seq); else { answered(seq); anyOk = true; okKeys.add(key); }
        return v;
      }, raw => {
        const e = D.classifyError(raw);
        if (e.kind === "cancelled") throw e;
        if (fatalErr(e)) { if (!s.run.outage && !s.run.cut) { s.run.outage = e; ac.abort(); } throw e; }
        tally.calls++;
        const down = OUTAGE_CODES.has(e.code), failed = e.code === "tool_error" && e.kind === "tool_failed", rejected = failed && !okKeys.has(key);
        if (failed || e.kind === "unexpected_shape") { tally.rejected++; suspicious(seq); } else answered(seq);
        if (!down && !rejected) streak = 0;
        else if (++streak >= CFG.OUTAGE_STREAK && !s.run.outage && !s.run.cut) { s.run.outage = down ? "down" : "rejected"; ac.abort(); }
        throw e;
      });
    };
    return {
      call, cut, tally, sig: ac.signal, today, from: C.addDays(today, -CFG.HIST_DAYS),
      live: () => !s.run.cut && !s.run.outage,
      stage: (k, label) => { s.run.stage = k; log(label); },
      tick: () => { s.run.done++; },
      stopOn: e => { if (e && e.kind === "limit_reached") cut("límite"); return !!s.run.cut || !!s.run.outage; },
    };
  }
  // fetchFinalists — ui.js 1432–1449
  async function fetchFinalists(symbols, keys, rc) {
    const tasks = [], idx = [];
    for (const k of keys) for (const sym of symbols) {
      tasks.push(() => rc.call(k, k === "eodLight" ? { symbol: sym, from: rc.from, to: rc.today } : { symbol: sym }));
      idx.push([k, sym]);
    }
    const res = await cl.runQueue(tasks, { signal: rc.sig, stopOn: rc.stopOn, onProgress: rc.tick });
    const by = Object.fromEntries(symbols.map(sym => [sym, { symbol: sym, eodDesc: null, km: null, rt: null, fs: null, ec: null, pts: null, gs: null, ptc: null, denied: false }]));
    const field = { eodLight: "eodDesc", keyMetrics: "km", ratios: "rt", scores: "fs", earnings: "ec", ptSummary: "pts", grades: "gs", ptConsensus: "ptc" };
    res.forEach((r, i) => {
      const [k, sym] = idx[i], f = by[sym];
      if (r.ok) f[field[k]] = k === "eodLight" || k === "earnings" ? r.value : r.value[0] || null;
      else if (r.error.kind === "symbol_denied") f.denied = true;
    });
    return { list: symbols.map(sym => by[sym]) };
  }
  // deepSteps — ui.js 1385–1424
  async function deepSteps(rc, { few, pr, st, quotes, finOf, notes, meta }) {
    const { sig, from } = rc;
    rc.stage("nonstock", "3/4 · Materias primas, cripto, divisas e índices");
    const nsDefs = RANKED.filter(d => d.symbol === "^GSPC" || pr.nonStockHist.includes(d.symbol));
    const nsFetch = nsDefs.filter(d => d.symbol !== "^GSPC");
    const tasks = nsFetch.map(d => () => rc.call(d.key, { symbol: d.symbol, from, to: today }))
      .concat(pr.etfs.flatMap(e => [() => rc.call("quote", { symbol: e }), () => rc.call("eodLight", { symbol: e, from, to: today })]));
    const res = rc.live() ? await cl.runQueue(tasks, { signal: sig, stopOn: rc.stopOn, onProgress: rc.tick }) : [];
    if (s.run.outage) return null;
    const val = r => (r && r.ok ? r.value : null);
    const histOf = Object.fromEntries(nsFetch.map((d, i) => [d.symbol, val(res[i])]));
    const ok = (sym, hist) => { const q = s.quotes[sym].q; return q && !stripJump(sym, q, null, hist) ? q : null; };
    const nonStocks = nsDefs.map(d => { const eodDesc = d.symbol === "^GSPC" ? s.macro.spxDesc : histOf[d.symbol]; return { def: d, quote: d.strip ? ok(d.symbol, eodDesc) : null, eodDesc }; });
    const vq = s.quotes["^VIX"], vixQuote = ok("^VIX"), vixBad = !vixQuote && !!(vq.q || vq.rej);
    if (vixBad) notes = notes.concat([VIX_BAD]);
    const etfs = pr.etfs.map((e, i) => ({ symbol: e, quote: (val(res[nsFetch.length + 2 * i]) || [])[0] || null, eodDesc: val(res[nsFetch.length + 2 * i + 1]) }));
    rc.stage("stage2", `4/4 · Análisis profundo de ${st.finalists.length} finalistas`);
    const finals = rc.live() ? await fetchFinalists(st.finalists, DEEP_KEYS.slice(0, pr.perFinalist), rc) : { list: [] };
    if (s.run.outage) return null;
    const withHist = finals.list.filter(f => Array.isArray(f.eodDesc) && f.eodDesc.length).length + nonStocks.filter(n => Array.isArray(n.eodDesc) && n.eodDesc.length).length;
    const planned = st.finalists.length + nonStocks.length, lowCover = planned > 0 && withHist < CFG.COVERAGE_MIN * planned;
    const t = rc.tally, why = s.run.cut || (t.rejected >= CFG.SUSPECT_MIN && t.rejected / Math.max(1, t.calls) >= CFG.SUSPECT_RATIO ? "muchas consultas rechazadas" : few ? "pocas cotizaciones" : lowCover ? "cobertura baja" : null);
    if (few) notes = notes.concat([few]);
    if (why) notes = notes.concat([why === "por minuto" ? PARTIAL_TXT[why] : `Análisis parcial: ${why}`]);
    if (why === "cobertura baja") notes = notes.concat([`Llegaron datos de ${withHist} de ${planned} activos planeados.`]);
    rc.stage("scoring", "Calculando…");
    const quoteOf = Object.fromEntries(quotes.map(q => [q.symbol, q]));
    return C.analyze({
      plan: cl.plan(), nowMs: ahora(), asOf: asOfNow(), marketOpen: C.marketState(ahora(), feriados).open, example: false,
      spxDesc: s.macro.spxDesc, vixQuote, vixBad, treasuryDesc: s.macro.treasuryDesc, stage1: st,
      finalists: finals.list.filter(f => Array.isArray(f.eodDesc) && f.eodDesc.length).map(f => Object.assign(f, { quote: quoteOf[f.symbol] }, finOf(f.symbol))),
      nonStocks, etfs, partial: !!why, partialReason: why, notes, meta,
    });
  }
  // runPaid, rama STARTER — ui.js 1450–1495 (sin fallback a Free: se informa la incompatibilidad)
  async function runPaid() {
    const rc = runCtx(), tier = cl.plan();
    const incompatible = e => e && (e.kind === "plan_denied" || e.code === "bad_request");
    rc.stage("universe", "1/4 · Universo");
    let screen;
    try { screen = await rc.call("screener", {}); rc.tick(); } catch (e) { if (incompatible(e)) return { incompatible: e }; throw e; }
    const universe = screen.filter(r => r && ["NASDAQ", "NYSE", "AMEX"].includes(r.exchangeShortName) && isNum(r.volume) && isNum(r.price) && r.volume * r.price >= 2e7)
      .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, CFG.UNIVERSE_CAP[tier] || 250);
    const sectorOf = Object.fromEntries(universe.map(r => [r.symbol, r.sector]));
    const pr = C.planRun({ plan: tier, eligible: universe.length, have: { spx: !!s.macro.spxDesc, treasury: !!s.macro.treasuryDesc, universe: true }, nonStock: RANKED, etfs: [], remaining: Infinity, cap: Infinity });
    if (!s.macro.spxDesc || !s.macro.treasuryDesc) await loadMacro();
    if (!s.macro.spxDesc) throw C.makeError("tool_error", "tool_failed");
    rc.stage("stage1", `2/4 · Cribando ${universe.length} acciones`);
    const syms = universe.map(r => r.symbol);
    let quotes = [], screenErr = null;
    const res = await cl.runQueue(syms.map(sym => () => rc.call("quote", { symbol: sym })), { signal: rc.sig, stopOn: rc.stopOn, onProgress: rc.tick });
    if (res.some(r => !r.ok && incompatible(r.error)) && !res.some(r => r.ok)) return { incompatible: res.find(r => !r.ok).error };
    res.forEach(r => { if (r.ok && r.value[0]) quotes.push(r.value[0]); else if (!r.ok && !screenErr && r.error.kind !== "cancelled") screenErr = r.error; });
    if (rc.sig.aborted) return null;
    if (syms.length && !quotes.length && rc.live()) throw screenErr || C.makeError("tool_error", "tool_failed");
    const fq = C.filterQuotes(quotes, { nowMs: ahora(), holidays: feriados, mode: "core" });
    if (syms.length && !fq.pass.length && rc.live()) throw C.makeError("tool_error", "tool_failed", { userText: NO_PASS(quotes.length) });
    const st = C.stage1Select({ quotes: fq.pass, K: pr.K }); st.excluded = fq.excluded;
    const few = syms.length && fq.pass.length < pr.K && rc.live() ? `Pocas cotizaciones válidas (${fq.pass.length} de ${syms.length}).` : null;
    return deepSteps(rc, { few, pr, st, quotes, finOf: sym => ({ isFinancial: sectorOf[sym] === "Financial Services", sector: sectorOf[sym] || null }),
      notes: [], meta: { universe: screen.length, eligible: universe.length, quoted: quotes.length } });
  }

  try {
    const out = await runPaid();
    if (s.run.outage) return fin("error", null, isObj(s.run.outage) ? s.run.outage.kind : s.run.outage);
    if (out && out.incompatible) return fin("error", null, `incompatible:${out.incompatible.kind}`);
    if (!out || !Array.isArray(out.rows) || !out.rows.length) return fin("error", null, s.run.cut ? `corte:${s.run.cut}` : "sin_resultados");
    log("corrida terminada", { filas: out.rows.length, parcial: !!out.partial, motivo: out.partialReason || null });
    return fin(out.partial ? "parcial" : "listo", out, out.partial ? out.partialReason || null : null);
  } catch (raw) {
    if (s.run.outage) return fin("error", null, isObj(s.run.outage) ? s.run.outage.kind : s.run.outage);
    return fin("error", null, D.classifyError(raw).kind);
  }
}
