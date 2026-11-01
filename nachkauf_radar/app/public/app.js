import { analyze, DEFAULTS, LEVEL_LABEL } from "./analysis.js";
import { CATALOG, searchCatalog, isIsin, norm } from "./catalog.js";

/* ---------------------------------------------------------------- Helfer */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (v, d = 1) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : "") + (d === 2 ? nf2 : nf1).format(v * 100) + " %";
const fmtDate = d => d ? d.slice(0, 10).split("-").reverse().join(".") : "–";
const fmtTime = iso => iso ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
const TYPES = ["Alle", "ETF", "Aktie", "Fonds", "ETC"];
const TYPE_LABEL = { Alle: "Alle", ETF: "ETFs", Aktie: "Aktien", Fonds: "Fonds", ETC: "ETCs" };

async function api(path, opts = {}) {
  const r = await fetch(path, { method: opts.method || "GET", headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
  return j;
}

/* ---------------------------------------------------------------- Zustand */
let items = [], cfg = { ...DEFAULTS }, notify = {}, lastRun = null, lastResult = null, sources = {};
let selected = null, typeFilter = "Alle", busy = false;

/* Zeiträume für Verlauf und Wertentwicklung */
const RANGES = [
  { k: "1m", label: "1 Monat", short: "1 M", months: 1 },
  { k: "1y", label: "1 Jahr", short: "1 J", months: 12 },
  { k: "5y", label: "5 Jahre", short: "5 J", months: 60 },
  { k: "10y", label: "10 Jahre", short: "10 J", months: 120 }
];
let range = (() => { try { const v = localStorage.getItem("nr-range"); return RANGES.some(r => r.k === v) ? v : "1y"; } catch { return "1y"; } })();
const R = () => RANGES.find(r => r.k === range);
function setRange(k) { range = k; try { localStorage.setItem("nr-range", k); } catch {} render(); }
function targetDate(lastDate, months) {
  const d = new Date(lastDate + "T12:00:00Z"); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, dim)); return d.toISOString().slice(0, 10);
}
/** Startindex und Wertentwicklung für einen Zeitraum in Monaten */
function perf(a, months) {
  if (a.n < 2) return null;
  const t = targetDate(a.lastDate, months), d = a.dates;
  let idx = -1;
  for (let i = d.length - 1; i >= 0; i--) if (d[i] <= t) { idx = i; break; }
  const partial = idx < 0, start = partial ? 0 : idx;
  const chg = a.last / a.closes[start] - 1;
  const yrs = (Date.parse(a.lastDate) - Date.parse(d[start])) / (365.25 * 864e5);
  const pa = months >= 24 && yrs >= 1.5 ? Math.pow(1 + chg, 1 / yrs) - 1 : null;
  return { start, startDate: d[start], partial, chg, pa, yrs };
}
const cache = new Map();
const A = it => { const k = it.id; const sig = `${it.prices.length}:${it.prices.at(-1)?.join()}:${JSON.stringify(cfg)}`;
  const c = cache.get(k); if (c && c.sig === sig) return c.a; const a = analyze(it.prices, cfg); cache.set(k, { sig, a }); return a; };

function setStatus(t) { $("#status").textContent = t; }
function statusDefault() {
  const f = items.map(i => i.fetchedAt).filter(Boolean).sort().pop();
  setStatus((f ? `Kurse abgerufen ${fmtTime(f)}` : "") + (sources.eodhd ? ` · EODHD heute ${sources.eodCalls} von ${sources.eodLimit} Abrufen` : " · nur Yahoo (kein EODHD-Schlüssel)"));
}

async function load() {
  const s = await api("api/state");
  items = s.items; cfg = { ...DEFAULTS, ...s.settings }; notify = s.notify; lastRun = s.lastRun; lastResult = s.lastResult; sources = s.sources || {};
  if (selected && !items.some(i => i.id === selected)) selected = null;
  render(); renderNotify(); statusDefault();
}
async function refresh(force) {
  if (busy) return; busy = true; $("#refreshBtn").disabled = true;
  setStatus(force ? "Aktualisiere alle Kurse …" : "Prüfe auf neue Kurse …");
  try { await api("api/refresh", { method: "POST", body: { force } }); await load(); }
  catch (e) { setStatus("Aktualisierung fehlgeschlagen: " + e.message); }
  finally { busy = false; $("#refreshBtn").disabled = false; }
}
$("#refreshBtn").onclick = () => refresh(true);

/* ---------------------------------------------------------------- Suche */
const q = $("#q"), sugg = $("#sugg");
let opts = [], active = -1, live = { q: "", results: [], loading: false, error: null }, liveTimer;

function renderChips() {
  $("#typeChips").innerHTML = TYPES.map(t => `<button class="chip" aria-pressed="${t === typeFilter}" data-t="${t}">${TYPE_LABEL[t]}</button>`).join("");
}
$("#typeChips").addEventListener("click", e => {
  const b = e.target.closest("[data-t]"); if (!b) return;
  typeFilter = b.dataset.t; renderChips(); openSuggest(); q.focus();
});

function scheduleLive() {
  clearTimeout(liveTimer);
  const t = q.value.trim();
  if (t.length < 2) { live = { q: "", results: [], loading: false, error: null }; return; }
  live.loading = true;
  liveTimer = setTimeout(async () => {
    try {
      const j = await api("api/search?q=" + encodeURIComponent(t));
      if (q.value.trim() !== t) return;
      live = { q: t, results: j.results || [], loading: false, error: j.error || null };
    } catch (e) { live = { q: t, results: [], loading: false, error: e.message }; }
    if (!sugg.hidden) openSuggest();
  }, 350);
}

function openSuggest() {
  const t = q.value.trim();
  const cat = searchCatalog(t, typeFilter, t ? 6 : 8).map(c => ({ kind: "cat", c }));
  const known = new Set(cat.map(o => o.c.ticker && norm(o.c.name)));
  const liveOpts = (live.q === t ? live.results : [])
    .filter(r => typeFilter === "Alle" || r.type === typeFilter)
    .filter(r => !cat.some(o => o.c.ticker && r.symbol.split(".")[0] === o.c.ticker && /\.DE$/.test(r.symbol)))
    .slice(0, 10).map(r => ({ kind: "live", r }));
  opts = [...cat, ...liveOpts];
  if (t.length >= 2) opts.push({ kind: "custom", text: t });
  const have = new Set(items.flatMap(i => [i.isin, i.symbol].filter(Boolean)));
  let html = "", idx = 0;
  const row = (o, i) => {
    if (o.kind === "cat") {
      const c = o.c, on = have.has(c.isin);
      return `<div class="opt" role="option" id="o${i}" data-i="${i}" aria-selected="${i === active}"><span class="tag ${c.type}">${c.type}</span><span><span class="nm">${esc(c.name)}</span><span class="meta mono">${c.isin}${c.ticker ? " · " + esc(c.ticker) : ""}</span></span><span class="add ${on ? "on" : ""}">${on ? "beobachtet" : "+ Beobachten"}</span></div>`;
    }
    if (o.kind === "live") {
      const r = o.r, on = !!r.symbol && have.has(r.symbol);
      return `<div class="opt" role="option" id="o${i}" data-i="${i}" aria-selected="${i === active}"><span class="tag ${esc(r.type)}">${esc(r.type)}</span><span><span class="nm">${esc(r.name)}</span><span class="meta mono">${esc(r.symbol || r.eodSymbol)} · ${esc(r.exchange)}</span></span><span class="add ${on ? "on" : ""}">${on ? "beobachtet" : "+ Beobachten"}</span></div>`;
    }
    return `<div class="opt" role="option" id="o${i}" data-i="${i}" aria-selected="${i === active}"><span class="tag ETC">neu</span><span><span class="nm">„${esc(o.text)}“ ohne Kursquelle anlegen</span><span class="meta">Kurse dann per Import eintragen</span></span><span class="add">Anlegen</span></div>`;
  };
  if (cat.length) html += `<div class="head"><span>${t ? "Katalog" : "Beliebt" + (typeFilter !== "Alle" ? " · " + TYPE_LABEL[typeFilter] : "")}</span></div>` + cat.map(o => row(o, idx++)).join("");
  if (t.length >= 2) {
    html += `<div class="head"><span>Live-Suche</span><span>${live.loading && live.q !== t ? "sucht …" : live.error ? "nicht erreichbar" : ""}</span></div>`;
    if (liveOpts.length) html += liveOpts.map(o => row(o, idx++)).join("");
    else if (!(live.loading && live.q !== t)) html += `<div class="opt" style="cursor:default"><span></span><span class="meta">${live.error ? esc(live.error) : "Keine weiteren Treffer."}</span><span></span></div>`;
    html += row(opts.at(-1), idx++);
  }
  sugg.innerHTML = html; sugg.hidden = false; q.setAttribute("aria-expanded", "true");
}
function closeSuggest() { sugg.hidden = true; active = -1; q.setAttribute("aria-expanded", "false"); }

async function pick(i) {
  const o = opts[i]; if (!o) return;
  let body;
  if (o.kind === "cat") body = { isin: o.c.isin, name: o.c.name, type: o.c.type, ticker: o.c.ticker };
  else if (o.kind === "live") body = { symbol: o.r.symbol, eodSymbol: o.r.eodSymbol || "", name: o.r.name, type: o.r.type, exchange: o.r.exchange, isin: isIsin(q.value) ? q.value.trim().toUpperCase() : "" };
  else body = { name: o.text, isin: isIsin(o.text) ? o.text.toUpperCase() : "", type: typeFilter === "Alle" ? "ETF" : typeFilter, manualOnly: true };
  closeSuggest(); q.value = ""; q.blur();
  setStatus(`Füge ${body.name} hinzu und lade die Kurshistorie …`);
  try {
    const r = await api("api/watchlist", { method: "POST", body });
    selected = r.id; await load(); scrollDetail();
    if (r.error) setStatus(r.error);
  } catch (e) { setStatus("Hinzufügen fehlgeschlagen: " + e.message); }
}

q.addEventListener("focus", openSuggest);
q.addEventListener("input", () => { active = -1; scheduleLive(); openSuggest(); });
q.addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { e.preventDefault(); if (sugg.hidden) return openSuggest(); active = Math.min(opts.length - 1, active + 1); openSuggest(); $("#o" + active)?.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); openSuggest(); $("#o" + active)?.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter") { e.preventDefault(); pick(active >= 0 ? active : 0); }
  else if (e.key === "Escape") closeSuggest();
});
sugg.addEventListener("mousedown", e => { const o = e.target.closest("[data-i]"); if (o) { e.preventDefault(); pick(+o.dataset.i); } });
document.addEventListener("click", e => { if (!e.target.closest(".search")) closeSuggest(); });

/* ---------------------------------------------------------------- Liste */
const LV = { buy: "buy", watch: "watch", calm: "calm", none: "none" };
function spark(a) {
  const pf = perf(a, R().months); if (!pf) return `<span class="note">–</span>`;
  let c = a.closes.slice(pf.start); const k = Math.ceil(c.length / 120);
  if (k > 1) c = c.filter((_, i) => i % k === 0 || i === c.length - 1);
  if (c.length < 2) return `<span class="note">–</span>`;
  const w = 96, h = 28, mn = Math.min(...c), mx = Math.max(...c), r = mx - mn || 1;
  const pts = c.map((v, i) => [(i / (c.length - 1) * w), (h - 2 - (v - mn) / r * (h - 4))]);
  const col = a.level === "buy" ? "var(--buy)" : a.level === "watch" ? "var(--watch)" : "var(--chart-line)";
  const [lx, ly] = pts.at(-1);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.4" fill="${col}"/></svg>`;
}

function render() {
  const an = items.map(it => ({ it, a: A(it) }));
  const order = { buy: 0, watch: 1, calm: 2, none: 3 };
  an.sort((x, y) => order[x.a.level] - order[y.a.level] || (x.a.dd ?? 0) - (y.a.dd ?? 0));
  const cnt = l => an.filter(x => x.a.level === l).length;
  const lastDate = an.map(x => x.a.lastDate).filter(Boolean).sort().pop();
  $("#summary").innerHTML = `
    <div class="sum buy"><b class="num">${cnt("buy")}</b><span>Nachkauf prüfen</span></div>
    <div class="sum watch"><b class="num">${cnt("watch")}</b><span>Beobachten</span></div>
    <div class="sum calm"><b class="num">${cnt("calm")}</b><span>Unauffällig</span></div>
    <div class="sum"><b class="num" style="font-size:20px;padding-top:6px">${fmtDate(lastDate)}</b><span>Letzter Schlusskurs</span></div>`;
  $("#rows").innerHTML = !an.length
    ? `<tr><td colspan="8" class="empty">Noch nichts auf der Watchlist. Tippe oben einen ETF, eine Aktie oder einen Fonds ein und wähle einen Vorschlag.</td></tr>`
    : an.map(({ it, a }) => `<tr data-id="${esc(it.id)}" class="${it.id === selected ? "sel" : ""}" tabindex="0">
      <td><span class="iname">${esc(it.name)}</span><span class="isub"><span class="tag ${esc(it.type)}">${esc(it.type)}</span><span class="mono">${esc(it.isin || it.symbol)}</span>${it.error ? `<span class="warn">Kursabruf gestört</span>` : it.check && !it.check.ok ? `<span class="warn">Quellen weichen ab</span>` : ""}</span></td>
      <td class="num">${a.last != null ? nf2.format(a.last) : "–"}${it.currency ? ` <span class="note">${esc(it.currency)}</span>` : ""}</td>
      <td class="num ${a.r1 < 0 ? "neg" : a.r1 > 0 ? "pos" : ""}">${pct(a.r1, 2)}</td>
      ${(() => { const pf = perf(a, R().months); return `<td class="num ${pf?.chg < 0 ? "neg" : pf?.chg > 0 ? "pos" : ""}" title="${pf ? "seit " + fmtDate(pf.startDate) : ""}">${pf ? pct(pf.chg) + (pf.partial ? `*<small class="since">seit ${pf.startDate.slice(5, 7)}/${pf.startDate.slice(0, 4)}</small>` : "") : "–"}</td>`; })()}
      <td class="num ${a.dd <= -cfg.dd1 / 100 ? "neg" : ""}">${a.dd != null ? pct(a.dd) : "–"}</td>
      <td class="num">${a.rsi != null ? nf1.format(a.rsi) : "–"}</td>
      <td>${spark(a)}</td>
      <td><span class="pill ${LV[a.level]}">${LEVEL_LABEL[a.level]}</span></td></tr>`).join("");
  $("#thPerf").textContent = R().short;
  $("#thSpark").textContent = "Verlauf " + R().short;
  $("#rangeSeg").innerHTML = RANGES.map(r => `<button data-r="${r.k}" aria-pressed="${r.k === range}" title="${r.label}">${r.short}</button>`).join("");
  $("#partialNote").hidden = !an.some(({ a }) => perf(a, R().months)?.partial);
  renderDetail();
  for (const k of Object.keys(DEFAULTS)) { const el = $("#s_" + k); if (document.activeElement !== el) el.value = cfg[k]; }
}
$("#rows").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (!tr) return; selected = selected === tr.dataset.id ? null : tr.dataset.id; render(); if (selected) scrollDetail(); });
$("#rows").addEventListener("keydown", e => { if (e.key !== "Enter") return; const tr = e.target.closest("tr[data-id]"); if (tr) { selected = tr.dataset.id; render(); scrollDetail(); } });
$("#rangeSeg").addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) setRange(b.dataset.r); });
function scrollDetail() { requestAnimationFrame(() => $("#detail").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })); }

function statusLine(it) {
  const st = it.status; if (!st) return "";
  const one = (name, x) => !x ? "" : x.ok ? `${name}: ✓ ${x.n} Kurse ab ${fmtDate(x.from)}` : `${name}: ✕ ${esc(x.error || "Fehler")}`;
  const parts = [one("Yahoo", st.yahoo), one("EODHD", st.eodhd)].filter(Boolean);
  return parts.length ? `<p class="note" style="margin:0">${parts.join(" · ")} · Historie gesamt ab ${fmtDate(it.prices[0]?.[0])}</p>` : "";
}
function sourceLine(it) {
  const name = { eodhd: "EODHD", yahoo: "Yahoo Finance" };
  if (!it.source) return it.manualCount ? "Quelle: eigener Import" : "Keine Kursquelle";
  const other = it.source === "eodhd" ? "Yahoo Finance" : "EODHD";
  let t = `Quelle: ${name[it.source]}${it.source === "eodhd" && it.eodSymbol ? " (" + esc(it.eodSymbol) + ")" : ""}`;
  if (it.check) t += ` · gegengeprüft mit ${other} am ${fmtDate(it.check.date)}: ${it.check.ok ? "✓" : "⚠"} Abweichung ${nf2.format(Math.abs(it.check.diff) * 100)} %`;
  else t += sources.eodhd ? ` · Gegenprüfung mit ${other} derzeit nicht möglich` : " · keine zweite Quelle aktiv";
  return t;
}

/* ---------------------------------------------------------------- Chart */
function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r))); const f = r / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
function sma200(c) {
  const out = new Array(c.length).fill(null); let sum = 0;
  for (let i = 0; i < c.length; i++) { sum += c[i]; if (i >= 200) sum -= c[i - 200]; if (i >= 199) out[i] = sum / 200; }
  return out;
}
function chartSvg(a, width) {
  const rg = R(), pf = perf(a, rg.months); if (!pf) return "";
  const d = a.dates, c = a.closes, s0 = pf.start, n = c.length, N = n - s0;
  const short = rg.months <= 12;
  const smaAll = sma200(c);
  // für lange Zeiträume ausdünnen (Form bleibt erhalten, SVG bleibt schlank)
  const k = Math.max(1, Math.ceil(N / 700));
  const idx = []; for (let i = s0; i < n; i += k) idx.push(i); if (idx.at(-1) !== n - 1) idx.push(n - 1);
  const W = Math.max(300, width), H = Math.round(Math.min(300, Math.max(200, W * 0.38))), L = 8, Rr = 62, T = 14, B = 26;
  // Beim Monat skaliert nur der Kurs; die 200-Tage-Linie wird am Rand abgeschnitten, statt den Verlauf plattzudrücken
  const vals = idx.map(i => c[i]).concat(rg.k === "1m" ? [] : idx.map(i => smaAll[i]).filter(v => v != null));
  if (rg.k === "1y") vals.push(a.high);
  let mn = Math.min(...vals), mx = Math.max(...vals); const pad = (mx - mn) * 0.06 || 1; mn -= pad; mx += pad;
  const x = i => L + (i - s0) / (N - 1 || 1) * (W - L - Rr), y = v => T + (mx - v) / (mx - mn) * (H - T - B);
  const step = niceStep((mx - mn) / 4); let g = "";
  for (let v = Math.ceil(mn / step) * step; v <= mx; v += step)
    g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${W - Rr + 6}" y="${(y(v) + 4).toFixed(1)}" font-size="11" fill="var(--muted)" font-family="ui-monospace,monospace">${nf2.format(v)}</text>`;
  // x-Achse: Tage (1 M), Monate (1 J), Jahre (5/10 J)
  const keyOf = dt => rg.k === "1m" ? null : rg.k === "1y" ? dt.slice(0, 7) : dt.slice(0, 4);
  let lastKey = keyOf(d[s0]), lastX = -99;
  for (let i = s0 + 1; i < n; i++) {
    const dt = d[i]; let lab = null;
    if (rg.k === "1m") { if (x(i) - lastX > 54) lab = `${dt.slice(8, 10)}.${dt.slice(5, 7)}.`; }
    else { const kk = keyOf(dt); if (kk !== lastKey) { lastKey = kk; if (x(i) - lastX > 40) lab = rg.k === "1y" ? MONTHS[+dt.slice(5, 7) - 1] : dt.slice(0, 4); } }
    if (lab && x(i) < W - Rr - 16 && x(i) > L + 14) { lastX = x(i); g += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${H - B}" y2="${H - B + 4}" stroke="var(--line)"/><text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${lab}</text>`; }
  }
  const line = idx.map((i, j) => `${j ? "L" : "M"}${x(i).toFixed(1)},${y(c[i]).toFixed(1)}`).join("");
  const area = line + `L${x(n - 1).toFixed(1)},${H - B}L${x(s0).toFixed(1)},${H - B}Z`;
  let smaPath = ""; idx.forEach(i => { if (smaAll[i] != null) smaPath += `${smaPath ? "L" : "M"}${x(i).toFixed(1)},${y(smaAll[i]).toFixed(1)}`; });
  const baseY = y(c[s0]);
  const highY = y(a.high), ddY = y(a.high * (1 - cfg.dd1 / 100));
  const showHigh = rg.k === "1y" && highY >= T && highY <= H - B;
  const marks = short ? (a.marks || []).filter(i => i >= s0).map(i => `<circle cx="${x(i).toFixed(1)}" cy="${y(c[i]).toFixed(1)}" r="4" fill="var(--buy)" stroke="var(--surface)" stroke-width="1.5"><title>${fmtDate(d[i])}: ${pct(c[i] / c[i - 1] - 1, 2)}</title></circle>`).join("") : "";
  const col = pf.chg < 0 ? "var(--buy)" : "var(--chart-line)";
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Kursverlauf ${rg.label}: ${pct(pf.chg)}">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-line)" stop-opacity=".18"/><stop offset="1" stop-color="var(--chart-line)" stop-opacity="0"/></linearGradient>
      <clipPath id="plot"><rect x="${L}" y="${T - 6}" width="${W - L - Rr + 6}" height="${H - B - T + 6}"/></clipPath></defs>
    ${g}
    ${showHigh && ddY > T && ddY < H - B ? `<rect x="${L}" y="${ddY.toFixed(1)}" width="${W - L - Rr}" height="${(H - B - ddY).toFixed(1)}" fill="var(--buy)" opacity=".06"/>` : ""}
    ${showHigh ? `<line x1="${L}" x2="${W - Rr}" y1="${highY.toFixed(1)}" y2="${highY.toFixed(1)}" stroke="var(--chart-high)" stroke-dasharray="4 4"/>` : ""}
    <line x1="${L}" x2="${W - Rr}" y1="${baseY.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="var(--muted)" stroke-dasharray="1 3" opacity=".8"/>
    <path d="${area}" fill="url(#ga)"/>
    ${smaPath ? `<path d="${smaPath}" fill="none" stroke="var(--chart-sma)" stroke-width="1.4" clip-path="url(#plot)"/>` : ""}
    <path d="${line}" fill="none" stroke="var(--chart-line)" stroke-width="${N > 400 ? 1.4 : 1.8}" stroke-linejoin="round"/>
    ${marks}
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(c[n - 1]).toFixed(1)}" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>
  </svg>`;
}
function legendHtml(a) {
  const rg = R(), pf = perf(a, rg.months);
  const marks = rg.months <= 12 && (a.marks || []).some(i => i >= pf.start);
  return `<span><i style="background:var(--chart-line)"></i>Schlusskurs</span><span><i style="background:var(--chart-sma)"></i>200-Tage-Linie</span><span><i style="border-top:2px dotted var(--muted);height:0"></i>Kurs zu Beginn des Zeitraums</span>`
    + (rg.k === "1y" ? `<span><i style="background:var(--chart-high);height:2px"></i>52-Wochen-Hoch</span><span><i style="background:var(--buy);opacity:.25;height:10px"></i>Zone ab −${cfg.dd1} % vom Hoch</span>` : "")
    + (marks ? `<span><i style="background:var(--buy);width:8px;height:8px;border-radius:50%"></i>außergewöhnlicher Tagesverlust</span>` : "");
}
function perfTiles(a) {
  return `<div class="perf" role="tablist" aria-label="Zeitraum">${RANGES.map(r => {
    const pf = perf(a, r.months);
    const sub = !pf ? "–" : pf.partial ? `seit ${fmtDate(pf.startDate)}${pf.pa != null ? " · " + pct(pf.pa) + " p. a." : ""}` : pf.pa != null ? `${pct(pf.pa)} p. a.` : `seit ${fmtDate(pf.startDate)}`;
    return `<button role="tab" data-r="${r.k}" aria-selected="${r.k === range}"><span>${r.label}</span><b class="${pf?.chg < 0 ? "neg" : "pos"}">${pf ? pct(pf.chg) : "–"}${pf?.partial ? "*" : ""}</b><small>${sub}</small></button>`;
  }).join("")}</div>`;
}

/* ---------------------------------------------------------------- Detail */
function renderDetail() {
  const box = $("#detail"), it = items.find(x => x.id === selected);
  if (!it) { box.hidden = true; box.innerHTML = ""; return; }
  const a = A(it), keep = $("#imp")?.value || "";
  box.hidden = false;
  box.innerHTML = `
    <div class="dtop">
      <div>
        <div class="isub" style="margin:0 0 4px"><span class="tag ${esc(it.type)}">${esc(it.type)}</span><span class="mono">${esc(it.isin)}${it.symbol ? " · " + esc(it.symbol) : ""}${it.exchange ? " · " + esc(it.exchange) : ""}</span></div>
        <h2>${esc(it.name)}</h2>
      </div>
      <div style="text-align:right">
        <div class="px">${a.last != null ? nf2.format(a.last) : "–"} <span class="note">${esc(it.currency)}</span></div>
        <div class="note">Schluss ${fmtDate(a.lastDate)} · <span class="pill ${LV[a.level]}" style="vertical-align:middle">${LEVEL_LABEL[a.level]}${a.n > 1 ? ` · ${a.score} Pkt.` : ""}</span></div>
      </div>
    </div>
    ${it.error ? `<p class="msg err" style="margin:0">${esc(it.error)}</p>` : ""}
    ${(it.warnings || []).length && !it.error ? `<p class="msg err" style="margin:0">${it.warnings.map(esc).join("<br>")}</p>` : ""}
    <p class="note" style="margin:0">${sourceLine(it)}</p>
    ${statusLine(it)}
    ${a.n >= 20 ? `
    <div class="kpis">
      <div class="kpi"><span>1 Tag</span><b class="${a.r1 < 0 ? "neg" : "pos"}">${pct(a.r1, 2)}</b></div>
      <div class="kpi"><span>5 Tage</span><b class="${a.r5 < 0 ? "neg" : "pos"}">${pct(a.r5)}</b></div>
      <div class="kpi"><span>vom 52-W-Hoch</span><b class="${a.dd <= -cfg.dd1 / 100 ? "neg" : ""}">${pct(a.dd)}</b></div>
      <div class="kpi"><span>übliche Tagesschwankung</span><b>${isFinite(a.vol) ? nf2.format(a.vol * 100) + " %" : "–"}</b></div>
      <div class="kpi"><span>RSI 14</span><b>${a.rsi != null ? nf1.format(a.rsi) : "–"}</b></div>
      <div class="kpi"><span>200-Tage-Linie</span><b>${a.sma200 ? nf2.format(a.sma200) : "–"}</b></div>
    </div>
    <div class="stack">
      <h3>Wertentwicklung</h3>
      ${perfTiles(a)}
      <div class="chart" id="chart"></div>
      <div class="legend">${legendHtml(a)}</div>
      ${RANGES.some(r => perf(a, r.months)?.partial) ? `<p class="note" style="margin:0">* Kurshistorie reicht nur bis ${fmtDate(a.dates[0])} zurück; der Wert gilt seit diesem Tag.${it.spliced ? " Ältere Kurse stammen aus der zweiten Quelle." : ""}</p>` : it.spliced ? `<p class="note" style="margin:0">Ältere Kurse stammen aus der zweiten Quelle und sind an die Hauptquelle angeglichen.</p>` : ""}
    </div>` : `<p class="note" style="margin:0">${a.n ? `Erst ${a.n} Kurse vorhanden. Für die Auswertung braucht es mindestens 20, besser über 200.` : "Noch keine Kurse vorhanden."}</p>`}
    <div class="cols">
      <div class="stack">
        <h3>Warum dieses Signal?</h3>
        ${a.n > 1 ? `<ul class="sig">${a.signals.map(s => `<li class="${s.hit ? "hit" : ""}"><span class="ic">${s.hit ? "●" : "○"}</span><span>${esc(s.title)}<small>${esc(s.detail)}</small></span><span class="pts">${s.hit ? "+" : ""}${s.pts}</span></li>`).join("")}</ul>
        <p class="note" style="margin:0">Ab ${cfg.strong} Punkten „Nachkauf prüfen“, ab 2 Punkten „Beobachten“.</p>` : `<p class="note">Noch keine Auswertung möglich.</p>`}
      </div>
      <div class="stack">
        <h3>Kurse ergänzen</h3>
        <p class="note" style="margin:0">${it.symbol ? `Kurse kommen automatisch (${a.n} Tage, abgerufen ${fmtTime(it.fetchedAt)}). Ein Import ist nur nötig, wenn die Quelle Lücken hat.` : "Für diesen Eintrag gibt es keine Kursquelle. Füge die Kurshistorie hier ein, z. B. als CSV-Export deiner Bank."}</p>
        <label class="field" for="imp">Datum und Schlusskurs je Zeile; Spaltenkopf „Schluss“ oder „Close“ wird erkannt</label>
        <textarea id="imp" placeholder="Datum;Schluss&#10;24.10.2026;104,37&#10;27.10.2026;101,92">${esc(keep)}</textarea>
        <div class="row"><button class="btn primary" id="impBtn">Kurse übernehmen</button><span class="msg" id="impMsg"></span></div>
        <div class="row" style="margin-top:6px"><button class="btn danger" id="delBtn">Von der Watchlist entfernen</button><span class="msg" id="delMsg"></span></div>
      </div>
    </div>`;
  if (a.n >= 20) {
    const ch = $("#chart"); ch.innerHTML = chartSvg(a, ch.clientWidth || 700);
    box.querySelector(".perf").addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) setRange(b.dataset.r); });
  }
  $("#impBtn").onclick = () => importPrices(it);
  let armed = false;
  $("#delBtn").onclick = async () => {
    if (!armed) { armed = true; $("#delBtn").textContent = "Wirklich entfernen?"; $("#delMsg").textContent = "Erneut tippen zum Bestätigen."; return; }
    try { await api("api/watchlist?id=" + encodeURIComponent(it.id), { method: "DELETE" }); selected = null; await load(); }
    catch (e) { $("#delMsg").textContent = "Entfernen fehlgeschlagen: " + e.message; }
  };
}
let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { const ch = $("#chart"), it = items.find(x => x.id === selected); if (ch && it) ch.innerHTML = chartSvg(A(it), ch.clientWidth); }, 150); });

/* ---------------------------------------------------------------- Import */
function parseNum(s) {
  s = String(s || "").trim().replace(/[€$\s]/g, ""); if (!s) return NaN;
  if (/,\d+$/.test(s) && (s.indexOf(".") < s.lastIndexOf(",") || s.indexOf(".") < 0)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return parseFloat(s);
}
function parseDate(s) {
  s = String(s || "").trim().replace(/"/g, "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (!lines.length) return [];
  const sep = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const cells = l => l.split(sep).map(x => x.trim().replace(/^"|"$/g, ""));
  let col = -1, start = 0; const h = cells(lines[0]).map(x => x.toLowerCase());
  if (!parseDate(h[0])) { start = 1; col = h.findIndex(x => /^(schluss|schlusskurs|close|adj close|kurs|letzter|price|rücknahmepreis|nav)/.test(x)); }
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const c = cells(lines[i]); const d = parseDate(c[0]); if (!d) continue;
    let v = col > 0 ? parseNum(c[col]) : NaN; if (!isFinite(v)) v = parseNum(c[1]);
    if (isFinite(v) && v > 0) out.push([d, v]);
  }
  return out;
}
async function importPrices(it) {
  const rows = parseCsv($("#imp").value);
  const msg = (t, ok) => { const m = $("#impMsg"); m.textContent = t; m.className = "msg " + (ok ? "ok" : "err"); };
  if (!rows.length) return msg("Keine Zeilen mit Datum und Kurs erkannt. Format: 27.10.2026;101,92", false);
  try { await api("api/import", { method: "POST", body: { id: it.id, rows } }); $("#imp").value = ""; await load(); msg(`${rows.length} Kurse übernommen.`, true); }
  catch (e) { msg("Import fehlgeschlagen: " + e.message, false); }
}

/* ---------------------------------------------------------------- Einstellungen */
$("#s_save").onclick = async () => {
  const b = {}; for (const k of Object.keys(DEFAULTS)) b[k] = parseFloat($("#s_" + k).value);
  const m = $("#s_msg");
  try { const r = await api("api/settings", { method: "POST", body: b }); cfg = r.settings; render(); m.textContent = "Gespeichert."; m.className = "msg ok"; }
  catch (e) { m.textContent = "Speichern fehlgeschlagen: " + e.message; m.className = "msg err"; }
};

let servicesLoaded = false;
async function loadServices() {
  const sel = $("#n_service");
  nMsg("Lade Geräte aus Home Assistant …", true);
  try {
    const j = await api("api/notify/services");
    const svc = j.services || [], ent = j.entities || [];
    const known = new Set([...svc, ...ent.map(e => "entity:" + e.id)]);
    let html = `<option value="">Keine Benachrichtigung</option>`;
    const phones = svc.filter(s => s.startsWith("mobile_app_")), others = svc.filter(s => !s.startsWith("mobile_app_"));
    if (phones.length) html += `<optgroup label="Handys (Companion-App)">${phones.map(s => `<option value="${esc(s)}">${esc(s.slice(11).replace(/_/g, " "))}</option>`).join("")}</optgroup>`;
    if (ent.length) html += `<optgroup label="Benachrichtigungs-Entitäten">${ent.map(e => `<option value="entity:${esc(e.id)}">${esc(e.name)}</option>`).join("")}</optgroup>`;
    if (others.length) html += `<optgroup label="Weitere Dienste">${others.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</optgroup>`;
    if (notify.service && !known.has(notify.service)) html += `<option value="${esc(notify.service)}">${esc(notify.service)} (von Hand)</option>`;
    sel.innerHTML = html;
    sel.value = notify.service || "";
    servicesLoaded = true;
    if (j.error) nMsg("Geräteliste nicht abrufbar: " + j.error, false);
    else if (!phones.length) nMsg("Kein Handy gefunden. Ist die Home-Assistant-App auf dem Handy eingerichtet und angemeldet? Sonst unten den Dienstnamen eintragen.", false);
    else nMsg("", true);
  } catch (e) { nMsg("Geräteliste nicht abrufbar: " + e.message, false); }
}
function nMsg(t, ok) { const m = $("#n_msg"); m.textContent = t; m.className = "msg " + (ok ? "ok" : "err"); }
function renderNotify() {
  if (document.activeElement?.closest("#notifyBox")) return;
  $("#n_time").value = notify.time || "18:00";
  $("#n_wd").checked = notify.weekdaysOnly !== false;
  $("#n_level").value = notify.level || "buy";
  if (servicesLoaded) $("#n_service").value = notify.service || "";
  $("#n_last").textContent = lastRun
    ? `Letzte Prüfung ${fmtTime(lastRun)}: ${lastResult?.buy ?? 0}× Nachkauf prüfen, ${lastResult?.watch ?? 0}× Beobachten, ${lastResult?.notified ?? 0} Meldung(en) gesendet.${lastResult?.diverging?.length ? " Quellen weichen ab bei: " + lastResult.diverging.join(", ") + "." : ""}${lastResult?.errors?.length ? " Probleme: " + lastResult.errors.join("; ") : ""}`
    : "Noch keine automatische Prüfung gelaufen.";
}
$("#notifyBox").addEventListener("toggle", () => { if ($("#notifyBox").open && !servicesLoaded) loadServices(); });
$("#n_save").onclick = async () => {
  try {
    const r = await api("api/notify", { method: "POST", body: { service: ($("#n_manual").value.trim() || $("#n_service").value), time: $("#n_time").value, weekdaysOnly: $("#n_wd").checked, level: $("#n_level").value } });
    notify = r.notify; $("#n_manual").value = ""; await loadServices(); nMsg("Gespeichert.", true);
  } catch (e) { nMsg("Speichern fehlgeschlagen: " + e.message, false); }
};
$("#n_test").onclick = async () => {
  const chosen = $("#n_manual").value.trim() || $("#n_service").value;
  if (!chosen) return nMsg("Bitte zuerst ein Gerät wählen und speichern.", false);
  if (chosen !== notify.service) return nMsg("Bitte die Auswahl zuerst speichern.", false);
  try { await api("api/notify/test", { method: "POST" }); nMsg("Testnachricht gesendet. Sie sollte gleich auf dem Handy erscheinen.", true); }
  catch (e) { nMsg("Senden fehlgeschlagen: " + e.message, false); }
};
$("#n_run").onclick = async () => {
  const b = $("#n_run"); b.disabled = true; nMsg("Prüfe alle Werte …", true);
  try { const r = await api("api/check", { method: "POST" }); await load(); nMsg(`Fertig: ${r.result.notified} Meldung(en) gesendet.`, true); }
  catch (e) { nMsg("Prüfung fehlgeschlagen: " + e.message, false); }
  finally { b.disabled = false; }
};

$("#diagBtn").onclick = async () => {
  const b = $("#diagBtn"), out = $("#diagOut"); b.disabled = true; out.hidden = false; out.textContent = "Teste Yahoo und EODHD …";
  try { const j = await api("api/diag"); out.textContent = JSON.stringify(j, null, 2); }
  catch (e) { out.textContent = "Test fehlgeschlagen: " + e.message; }
  finally { b.disabled = false; }
};
$("#diagCopy").onclick = async () => {
  const out = $("#diagOut");
  try { await navigator.clipboard.writeText(out.textContent); $("#diagCopy").textContent = "Kopiert"; }
  catch { const r = document.createRange(); r.selectNodeContents(out); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $("#diagCopy").textContent = "Markiert, jetzt kopieren"; }
};

function msgTo(sel, t, ok) { const m = $(sel); m.textContent = t; m.className = "msg " + (ok ? "ok" : "err"); }
$("#migBtn").onclick = async () => {
  const b = $("#migBtn"); b.disabled = true; msgTo("#migMsg", "Suche das bisherige Add-on …", true);
  try { const r = await api("api/migrate-local", { method: "POST", body: {} }); msgTo("#migMsg", `${r.added} Werte übernommen, Kurse werden geladen.`, true); await load(); setTimeout(load, 8000); setTimeout(load, 20000); }
  catch (e) { msgTo("#migMsg", e.message, false); }
  finally { b.disabled = false; }
};
$("#bakExport").onclick = async () => {
  try { const j = await api("api/export"); $("#bak").value = JSON.stringify(j, null, 1); msgTo("#bakMsg", `${j.watchlist.length} Werte in der Sicherung.`, true); }
  catch (e) { msgTo("#bakMsg", e.message, false); }
};
$("#bakCopy").onclick = async () => {
  const t = $("#bak"); if (!t.value) return msgTo("#bakMsg", "Erst „Sicherung erzeugen“ tippen.", false);
  try { await navigator.clipboard.writeText(t.value); msgTo("#bakMsg", "Kopiert.", true); }
  catch { t.select(); msgTo("#bakMsg", "Markiert, jetzt kopieren.", true); }
};
$("#bakRestore").onclick = async () => {
  let data; try { data = JSON.parse($("#bak").value); } catch { return msgTo("#bakMsg", "Der Text ist keine gültige Sicherung.", false); }
  try { const r = await api("api/restore", { method: "POST", body: data }); msgTo("#bakMsg", `${r.added} Werte hinzugefügt, Kurse werden geladen.`, true); await load(); setTimeout(load, 8000); }
  catch (e) { msgTo("#bakMsg", e.message, false); }
};

let info = {};
function dashYaml(kind) {
  const panel = info.panel || "/local_nachkauf_radar";
  const per = items.map(it => ({ it, e: "sensor.nachkauf_radar_" + String(it.isin || it.id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") }));
  if (kind === "full") return `type: custom:nachkauf-radar-card
height: 760`
    + (info.card?.error ? `\n# Hinweis: Die Karte wurde nicht automatisch angemeldet (${info.card.error}).\n# Einstellungen → Dashboards → ⋮ → Ressourcen → /local/nachkauf-radar/nachkauf-radar-card.js (JavaScript-Modul)` : "");
  if (kind === "compact") return `type: custom:nachkauf-radar-card
mode: compact
range: veraenderung_1_jahr   # oder veraenderung_1_monat, veraenderung_5_jahre, veraenderung_10_jahre`;
  if (kind === "badge") return `type: entity
entity: sensor.nachkauf_radar_signale
name: Nachkauf prüfen
icon: mdi:cart-arrow-down
color: red
show_name: true
show_state: true
show_icon: true
tap_action:
  action: navigate
  navigation_path: ${panel}
visibility:
  - condition: numeric_state
    entity: sensor.nachkauf_radar_signale
    above: 0`;
  if (kind === "badges") return per.length ? per.map(({ it, e }) => `- type: entity
  entity: ${e}
  name: ${JSON.stringify(it.name.length > 22 ? it.name.slice(0, 21) + "…" : it.name)}
  show_name: true
  state_content:
    - state
    - signal
  tap_action:
    action: navigate
    navigation_path: ${panel}`).join("\n") : "# Noch keine Werte auf der Watchlist";
  const rows = per.map(({ e }) => `      <tr><td>{{ state_attr('${e}','friendly_name') }}</td><td align="right">{{ states('${e}') }}</td><td align="right">{{ state_attr('${e}','veraenderung_1_tag') }} %</td><td align="right">{{ state_attr('${e}','veraenderung_1_jahr') }} %</td><td>{{ state_attr('${e}','signal') }}</td></tr>`).join("\n");
  return `type: markdown
title: Nachkauf-Radar
content: |
  {% set n = states('sensor.nachkauf_radar_signale') | int(0) %}
  {% if n > 0 %}**🔴 Nachkauf prüfen:** {{ state_attr('sensor.nachkauf_radar_signale','nachkauf_pruefen') | join(', ') }}{% else %}Keine Nachkauf-Signale.{% endif %}

  <table>
      <tr><th align="left">Wert</th><th>Kurs</th><th>1 Tag</th><th>1 Jahr</th><th align="left">Signal</th></tr>
${rows}
  </table>

  [Nachkauf-Radar öffnen](${panel})`;
}
function renderDash() { $("#dashYaml").textContent = dashYaml($("#dashWhich").value); }
$("#dashWhich").onchange = renderDash;
$("#dashBox").addEventListener("toggle", async () => { if (!$("#dashBox").open) return; try { info = await api("api/info"); } catch {} renderDash(); });
$("#dashCopy").onclick = async () => {
  const t = $("#dashYaml").textContent;
  try { await navigator.clipboard.writeText(t); msgTo("#dashMsg", "Kopiert.", true); }
  catch { const r = document.createRange(); r.selectNodeContents($("#dashYaml")); getSelection().removeAllRanges(); getSelection().addRange(r); msgTo("#dashMsg", "Markiert, jetzt kopieren.", true); }
};

/* ---------------------------------------------------------------- Start */
renderChips();
api("api/info").then(i => { $("#ver").textContent = `Version ${i.version}${i.mock ? " · Testmodus mit simulierten Kursen" : ""}.`; }).catch(() => {});
load().then(() => refresh(false)).catch(e => { $("#rows").innerHTML = `<tr><td colspan="8" class="empty">Der Dienst antwortet nicht: ${esc(e.message)}</td></tr>`; });
