// Signal-Logik – wird von Browser und Server gemeinsam genutzt.
export const DEFAULTS = { sigma: 2, dd1: 10, dd2: 20, rsi: 30, sma: 5, strong: 4 };

function std(a) {
  if (a.length < 2) return NaN;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

const pctTxt = (v, d = 1) => (v == null || !isFinite(v)) ? "–"
  : (v > 0 ? "+" : "") + (v * 100).toFixed(d).replace(".", ",") + " %";
const num = (v, d = 1) => v.toFixed(d).replace(".", ",");
const deDate = d => d ? d.split("-").reverse().join(".") : "–";

/** prices: [[YYYY-MM-DD, close], ...]  cfg: Schwellen */
export function analyze(prices, cfgIn = {}) {
  const cfg = { ...DEFAULTS, ...cfgIn };
  const p = (prices || []).filter(x => x && isFinite(x[1]) && x[1] > 0).slice().sort((a, b) => a[0] < b[0] ? -1 : 1);
  const c = p.map(x => x[1]); const n = c.length;
  const out = { n, dates: p.map(x => x[0]), closes: c, last: n ? c[n - 1] : null, lastDate: n ? p[n - 1][0] : null,
    signals: [], score: 0, level: "none" };
  if (n < 2) return out;
  const rets = c.slice(1).map((x, i) => x / c[i] - 1);
  out.r1 = rets[rets.length - 1];
  const base = rets.slice(Math.max(0, rets.length - 61), rets.length - 1);
  out.vol = std(base);
  out.z1 = isFinite(out.vol) && out.vol > 0 ? out.r1 / out.vol : null;
  if (n >= 6) { out.r5 = c[n - 1] / c[n - 6] - 1; out.z5 = out.vol > 0 ? out.r5 / (out.vol * Math.sqrt(5)) : null; }
  const start = Math.max(0, n - 252); const win = c.slice(start);
  out.high = Math.max(...win); out.dd = out.last / out.high - 1;
  out.highDate = p[start + win.indexOf(out.high)][0];
  if (n >= 200) { out.sma200 = c.slice(n - 200).reduce((s, x) => s + x, 0) / 200; out.smaGap = out.last / out.sma200 - 1; }
  out.rsi = rsi(c);

  const add = (key, hit, pts, title, detail) => { out.signals.push({ key, hit, pts, title, detail }); if (hit) out.score += pts; };
  add("day", out.z1 != null && out.z1 <= -cfg.sigma, 2, "Außergewöhnlicher Tagesverlust",
    out.z1 == null ? "Zu wenig Kurshistorie"
      : `${pctTxt(out.r1, 2)} am letzten Handelstag, das ${num(Math.abs(out.z1))}-Fache der üblichen Tagesschwankung (${num(out.vol * 100, 2)} %)`);
  add("week", out.z5 != null && out.z5 <= -cfg.sigma, 2, "Ungewöhnlich schwache Woche",
    out.z5 == null ? "Zu wenig Kurshistorie" : `${pctTxt(out.r5)} in 5 Handelstagen (${num(Math.abs(out.z5))}-fache Wochenschwankung)`);
  add("dd1", out.dd <= -cfg.dd1 / 100, 2, `Rücksetzer über ${cfg.dd1} % vom 52-Wochen-Hoch`,
    `${pctTxt(out.dd)} seit dem Hoch vom ${deDate(out.highDate)}`);
  add("dd2", out.dd <= -cfg.dd2 / 100, 1, `Rücksetzer über ${cfg.dd2} % vom Hoch`,
    out.dd <= -cfg.dd2 / 100 ? "Tiefe Korrektur" : "Nicht erreicht");
  add("rsi", out.rsi != null && out.rsi < cfg.rsi, 1, `RSI unter ${cfg.rsi} (überverkauft)`,
    out.rsi == null ? "Zu wenig Kurshistorie" : `RSI 14 liegt bei ${num(out.rsi)}`);
  add("sma", out.smaGap != null && out.smaGap <= -cfg.sma / 100, 1, `Mehr als ${cfg.sma} % unter 200-Tage-Linie`,
    out.smaGap == null ? "Ab 200 Kursen verfügbar" : `${pctTxt(out.smaGap)} Abstand zur 200-Tage-Linie`);
  out.level = out.score >= cfg.strong ? "buy" : out.score >= 2 ? "watch" : "calm";

  out.marks = [];
  for (let i = 21; i < rets.length; i++) {
    const v = std(rets.slice(Math.max(0, i - 60), i));
    if (v > 0 && rets[i] / v <= -cfg.sigma) out.marks.push(i + 1);
  }
  return out;
}

export const LEVEL_LABEL = { buy: "Nachkauf prüfen", watch: "Beobachten", calm: "Unauffällig", none: "Keine Kurse" };
