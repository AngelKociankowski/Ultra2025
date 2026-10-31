// validOutput de ui.js v5.5.1 (líneas 231–250), copiado literal; CFG e isNum vienen del núcleo de la página.
export function crearValidador(C) {
  const CFG = C.CONFIG, isNum = C.isNum;
  const isCount = v => Number.isInteger(v) && v >= 0;
  const isStr = v => typeof v === "string", numOrNull = v => v === null || isNum(v), isObj = v => !!v && typeof v === "object";
  const arrOf = f => a => Array.isArray(a) && a.every(f), strs = arrOf(isStr);
  const shape = spec => o => isObj(o) && Object.keys(spec).every(k => spec[k](o[k]));
  const validRow = shape({
    symbol: isStr, display: isStr, name: isStr, cls: isStr, clsLabel: isStr, signalLabel: isStr, confidence: isStr,
    price: isNum, priceTime: isNum, S: isNum, alpha: isNum, coverage: isNum, changePct: numOrNull, pBeat: numOrNull, pBase: numOrNull, pUp: numOrNull,
    group: v => v === "acciones" || v === "otros", ref: v => v === "sp500" || v === "sube", pRef: isNum, pct: v => isCount(v) && v >= 35 && v <= 65, factorPct: v => isCount(v) && v <= 100,
    capReason: v => v === null || isStr(v), capShort: v => v === null || isStr(v), pUpStock: numOrNull, expRet: isNum, medRet: isNum,
    signal: v => [1, 2, 3].includes(v), capReasons: strs, tags: strs, cone: shape({ lo: isNum, med: isNum, hi: isNum }),
    drivers: shape({ pos: arrOf(shape({ label: isStr })), neg: arrOf(shape({ label: isStr })) }), flags: arrOf(shape({ text: isStr })),
    penalties: arrOf(shape({ text: isStr, z: isNum })), blocks: v => v === null || arrOf(shape({ key: isStr, label: isStr, weight: isNum }))(v),
    components: arrOf(shape({ code: isStr, block: isStr, label: isStr, contrib: isNum })), fundamentals: v => v === null || isObj(v), tech: isObj,
    series: arrOf(x => Array.isArray(x) && isNum(x[0]) && isNum(x[1])),
  });
  const validOutput = shape({
    asOf: v => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v), plan: v => !!CFG.K[v], nowMs: isNum, rows: arrOf(validRow), notes: strs,
    excluded: arrOf(shape({ symbol: isStr, reason: isStr })), rest: arrOf(shape({ symbol: isStr, display: isStr, name: isStr, reason: isStr, S1: numOrNull, price: numOrNull, changePct: numOrNull })),
    counts: shape(Object.fromEntries(["universe", "eligible", "quoted", "finalists", "ranked", "nonStock"].map(k => [k, v => v === undefined || isCount(v)]))), regime: shape({ state: isStr, label: isStr, weights: arrOf(isNum) }),
  });
  return validOutput;
}
