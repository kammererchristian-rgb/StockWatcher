// Nachkauf-Radar – Home-Assistant-Add-on
// Holt Kurse und Historien (Yahoo Finance), speichert die Watchlist unter /data,
// prüft täglich auf Nachkauf-Signale und meldet sie über Home Assistant.
// Keine externen npm-Abhängigkeiten.

import http from "node:http";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyze, DEFAULTS, LEVEL_LABEL } from "./public/analysis.js";
import { CATALOG, isIsin, searchCatalog } from "./public/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8099);
const DATA = process.env.DATA_DIR || "/data";
const PUBLIC = path.join(__dirname, "public");
const MOCK = process.env.MOCK === "1";
const SUP_TOKEN = process.env.SUPERVISOR_TOKEN || "";
const VERSION = (() => { try { return JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")).version; } catch { return "?"; } })();

// Add-on-Optionen (Home Assistant schreibt sie nach /data/options.json)
const OPTIONS = (() => {
  let o = {};
  try { o = JSON.parse(readFileSync(path.join(DATA, "options.json"), "utf8")); } catch {}
  return {
    eodhdKey: String(process.env.EODHD_API_KEY || o.eodhd_api_key || "").trim(),
    eodhdLimit: Number(process.env.EODHD_DAILY_LIMIT || o.eodhd_daily_limit || 20),
    maxDiff: Number(process.env.MAX_DIFF || o.max_abweichung_prozent || 1.5) / 100
  };
})();
const MOCK_EOD_FAIL = process.env.MOCK_EOD_FAIL === "1";

const log = (...a) => console.log(new Date().toISOString().replace("T", " ").slice(0, 19), ...a);

/* ------------------------------------------------------------------ Speicher */
const STATE_FILE = path.join(DATA, "state.json");
const PRICE_DIR = path.join(DATA, "prices");
let state = {
  watchlist: [],
  settings: { ...DEFAULTS },
  notify: { service: "", time: "18:00", weekdaysOnly: true, level: "buy" },
  lastRun: null, lastRunDate: null, lastResult: null,
  alerts: {},
  eodUsage: { date: null, calls: 0 }
};

async function loadState() {
  await fs.mkdir(PRICE_DIR, { recursive: true });
  try {
    const j = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    state = { ...state, ...j, settings: { ...DEFAULTS, ...(j.settings || {}) }, notify: { ...state.notify, ...(j.notify || {}) } };
  } catch { await saveState(); }
}
let saving = Promise.resolve();
function saveState() {
  saving = saving.then(async () => {
    const tmp = STATE_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(state, null, 1));
    await fs.rename(tmp, STATE_FILE);
  }).catch(e => log("Speichern fehlgeschlagen:", e.message));
  return saving;
}
const priceFile = id => path.join(PRICE_DIR, id.replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
async function readPrices(id) {
  try { return JSON.parse(await fs.readFile(priceFile(id), "utf8")); }
  catch { return { series: [], manual: [], fetchedAt: null }; }
}
async function writePrices(id, p) {
  const f = priceFile(id), tmp = f + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(p));
  await fs.rename(tmp, f);
}
function mergedSeries(p) {
  const m = new Map((p.manual || []).map(x => [x[0], x[1]]));
  for (const [d, v] of p.series || []) m.set(d, v);
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
}

/* ------------------------------------------------------------- Kursquelle */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const YT = process.env.YAHOO_TEST_BASE || "";          // nur für Tests: nachgebauter Yahoo-Server
const HOSTS = YT ? [YT] : ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const Y_COOKIE_URLS = YT ? [YT + "/fc"] : ["https://fc.yahoo.com/", "https://finance.yahoo.com/"];
const Y_CRUMB_URL = YT ? YT + "/v1/test/getcrumb" : "https://query2.finance.yahoo.com/v1/test/getcrumb";

/* Transport: bevorzugt der Python-Helfer (curl_cffi, Chrome-Signatur), sonst Node-fetch.
   Yahoo sperrt Programme mit fremder Verbindungssignatur per HTTP 429; der Helfer umgeht das. */
const helper = { proc: null, ready: false, failed: null, seq: 0, wait: new Map(), buf: "" };
function startHelper() {
  if (helper.proc || process.env.YFETCH === "0") return;
  let p;
  try { p = spawn("python3", [path.join(__dirname, "yfetch.py")], { stdio: ["pipe", "pipe", "pipe"] }); }
  catch (e) { helper.failed = e.message; return; }
  helper.proc = p;
  p.stdout.on("data", chunk => {
    helper.buf += chunk;
    let i;
    while ((i = helper.buf.indexOf("\n")) >= 0) {
      const line = helper.buf.slice(0, i); helper.buf = helper.buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id === 0) { if (m.ready) { helper.ready = true; log("Yahoo-Helfer bereit (Chrome-Signatur)"); } if (m.fatal) helper.failed = m.fatal; continue; }
      const w = helper.wait.get(m.id); if (w) { helper.wait.delete(m.id); w(m); }
    }
  });
  p.stderr.on("data", d => log("Yahoo-Helfer:", String(d).trim().slice(0, 200)));
  p.on("exit", code => {
    log("Yahoo-Helfer beendet, Code", code);
    for (const w of helper.wait.values()) w({ status: 0, body: "", error: "Helfer beendet" });
    helper.wait.clear(); helper.proc = null; helper.ready = false;
    if (code === 3) helper.failed = helper.failed || "curl_cffi nicht installiert";
    else if (!helper.failed) setTimeout(startHelper, 5000);
  });
}
async function helperGet(url, headers, redirects = true) {
  const t0 = Date.now(); while (!helper.ready && !helper.failed && helper.proc && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100));
  if (!helper.ready) return null;
  const id = ++helper.seq;
  return new Promise(res => {
    const to = setTimeout(() => { helper.wait.delete(id); res({ status: 0, body: "", error: "Zeitüberschreitung" }); }, 30000);
    helper.wait.set(id, m => { clearTimeout(to); res(m); });
    helper.proc.stdin.write(JSON.stringify({ id, url, headers, redirects }) + "\n");
  });
}
/** GET mit Helfer, sonst Node-fetch. Liefert {status, text, via} */
async function yGet(url, headers = {}, redirects = true) {
  const h = await helperGet(url, headers, redirects);
  if (h) { if (h.error && !h.status) throw new Error(`Verbindung fehlgeschlagen: ${h.error}`); return { status: h.status, text: h.body, via: "chrome" }; }
  const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: redirects ? "follow" : "manual", signal: AbortSignal.timeout(20000) });
  return { status: r.status, text: await r.text(), via: "node", res: r };
}
const yTransport = () => helper.ready ? "chrome" : "node";

// Yahoo verlangt je nach Region/IP ein Cookie mit "Crumb". Der Helfer hält die Cookies selbst.
let yAuth = { cookie: "", crumb: "", at: 0 };
let yBlockedUntil = 0;                                  // nach HTTP 429 Pause, damit die Sperre nicht verlängert wird
async function yahooAuth(force = false) {
  if (!force && yAuth.crumb && Date.now() - yAuth.at < 6 * 3600e3) return yAuth;
  const cookies = new Map();
  for (const u of Y_COOKIE_URLS) {
    try {
      const r = await yGet(u, { "Accept": "text/html", "Accept-Language": "de-DE,de;q=0.9" }, false);
      (r.res?.headers.getSetCookie?.() || []).forEach(c => { const [kv] = c.split(";"); const i = kv.indexOf("="); if (i > 0) cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1)); });
      if (r.via === "chrome" || cookies.size) break;
    } catch {}
  }
  const jar = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const r2 = await yGet(Y_CRUMB_URL, jar ? { Cookie: jar } : {});
  const crumb = (r2.text || "").trim();
  if (r2.status < 200 || r2.status >= 300 || !crumb || crumb.length > 40 || /[<{ ]/.test(crumb)) {
    const e = new Error(`Yahoo-Anmeldung fehlgeschlagen (HTTP ${r2.status}, Verbindung: ${r2.via})`); e.status = r2.status; throw e;
  }
  yAuth = { cookie: jar, crumb, at: Date.now() };
  log("Yahoo: Crumb geholt über", r2.via);
  return yAuth;
}
async function yahooOnce(url, auth) {
  const headers = { "Accept": "application/json", "Accept-Language": "de-DE,de;q=0.9" };
  if (auth) { if (auth.cookie) headers.Cookie = auth.cookie; url += (url.includes("?") ? "&" : "?") + "crumb=" + encodeURIComponent(auth.crumb); }
  const r = await yGet(url, headers);
  const text = r.text || "";
  if (r.status === 404) { const e = new Error("Nicht gefunden (HTTP 404)"); e.status = 404; throw e; }
  if (r.status < 200 || r.status >= 300) { const e = new Error(`Yahoo antwortet mit HTTP ${r.status} (Verbindung: ${r.via}): ${text.replace(/\s+/g, " ").slice(0, 100)}`); e.status = r.status; throw e; }
  try { return JSON.parse(text); } catch { const e = new Error(`Yahoo liefert kein JSON: ${text.replace(/\s+/g, " ").slice(0, 80)}`); e.status = 502; throw e; }
}
async function yahoo(pathAndQuery, { ignoreBlock = false } = {}) {
  if (!ignoreBlock && Date.now() < yBlockedUntil) {
    const until = new Date(yBlockedUntil).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const e = new Error(`Yahoo sperrt Abrufe vorübergehend (HTTP 429), nächster Versuch ab ${until}`); e.status = 429; throw e;
  }
  let lastErr;
  for (const host of HOSTS) {
    try { return await yahooOnce(host + pathAndQuery, yAuth.crumb ? yAuth : null); }
    catch (e) {
      lastErr = e; if (e.status === 404) break;
      if ([401, 403, 429, 502].includes(e.status) || /crumb|unauthori/i.test(e.message)) {
        try { return await yahooOnce(host + pathAndQuery, await yahooAuth(true)); }
        catch (e2) { lastErr = e2; if (e2.status === 404) break; }
      }
      if (lastErr.status === 429) break;                  // gesperrt: nicht noch den zweiten Host bemühen
    }
  }
  if (lastErr?.status === 429) { yBlockedUntil = Date.now() + 30 * 60e3; log("Yahoo: HTTP 429, Pause 30 Minuten"); }
  throw lastErr;
}

const TYPE_MAP = { ETF: "ETF", EQUITY: "Aktie", MUTUALFUND: "Fonds", INDEX: "Index", CURRENCY: "Währung", CRYPTOCURRENCY: "Krypto", FUTURE: "Future" };
const EX_PREF = ["GER", "FRA", "STU", "MUN", "DUS", "BER", "HAM", "HAN", "AMS", "PAR", "MIL", "EBS", "VIE", "BRU", "MCE", "LSE", "NMS", "NYQ", "NGM", "NCM", "ASE", "PCX"];
const exRank = e => { const i = EX_PREF.indexOf(e); return i < 0 ? 99 : i; };

async function searchRemote(q) {
  if (MOCK) return mockSearch(q);
  const j = await yahoo(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0&lang=de-DE&region=DE`);
  return (j.quotes || []).filter(x => x.symbol && TYPE_MAP[x.quoteType] && !["Währung", "Future"].includes(TYPE_MAP[x.quoteType]))
    .map(x => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      type: TYPE_MAP[x.quoteType] === "ETF" && /gold|silver|silber|etc|commodit/i.test(x.longname || "") ? "ETC" : TYPE_MAP[x.quoteType],
      exchange: x.exchDisp || x.exchange || "",
      exchCode: x.exchange || ""
    }));
}

async function resolveSymbol(isin, ticker) {
  const tries = [isin, ticker ? ticker + ".DE" : null, ticker].filter(Boolean);
  for (const t of tries) {
    try {
      const res = await searchRemote(t);
      if (res.length) return res.sort((a, b) => exRank(a.exchCode) - exRank(b.exchCode))[0];
    } catch (e) { log("Symbolsuche fehlgeschlagen:", t, e.message); }
  }
  return null;
}

const HIST_YEARS = 10;
const KEEP = 2750;                               // ~10,5 Jahre Handelstage
const yearsAgo = y => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - 10); return d.toISOString().slice(0, 10); };

async function fetchHistory(symbol, range = `${HIST_YEARS}y`, opt = {}) {
  if (MOCK) return mockHistory(symbol, range);
  const j = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false&events=div%2Csplit`, opt);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || "Keine Kursdaten erhalten");
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const off = r.meta?.gmtoffset || 0;
  const m = new Map(), mr = new Map();
  ts.forEach((t, i) => {
    const v = adj[i] ?? close[i];
    if (v == null || !isFinite(v) || v <= 0) return;
    const d = new Date((t + off) * 1000).toISOString().slice(0, 10);
    m.set(d, Math.round(v * 10000) / 10000);
    if (close[i] != null && isFinite(close[i])) mr.set(d, Math.round(close[i] * 10000) / 10000);
  });
  const srt = mm => [...mm.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  return {
    raw: srt(mr),
    series: srt(m),
    currency: r.meta?.currency || "",
    exchange: r.meta?.fullExchangeName || r.meta?.exchangeName || ""
  };
}

/* ------------------------------------------------- Zweite Quelle: EODHD */
// Lizenzierter Datenhändler mit offizieller API. Wird Hauptquelle, sobald ein API-Schlüssel hinterlegt ist.
const EOD_ENABLED = () => !!OPTIONS.eodhdKey || MOCK;
const YH_TO_EOD = { DE: "XETRA", F: "F", MU: "MU", SG: "STU", BE: "BE", DU: "DU", HM: "HM", HA: "HA",
  AS: "AS", PA: "PA", L: "LSE", MI: "MI", VI: "VI", SW: "SW", BR: "BR", MC: "MC", CO: "CO", ST: "ST", OL: "OL", HE: "HE" };
const EOD_EX_PREF = ["XETRA", "F", "STU", "MU", "DU", "BE", "HM", "HA", "EUFUND", "AS", "PA", "MI", "VI", "SW", "LSE", "US"];

function eodBudgetLeft() {
  const today = localParts().date;
  if (state.eodUsage.date !== today) state.eodUsage = { date: today, calls: 0 };
  return OPTIONS.eodhdLimit - state.eodUsage.calls;
}
async function eodhd(apiPath) {
  if (eodBudgetLeft() <= 0) throw new Error(`Tageslimit von ${OPTIONS.eodhdLimit} Abrufen erreicht`);
  state.eodUsage.calls++;
  if (MOCK) {
    if (MOCK_EOD_FAIL) throw new Error("EODHD antwortet mit 503");
    return mockEod(apiPath);
  }
  const sep = apiPath.includes("?") ? "&" : "?";
  const r = await fetch(`https://eodhd.com/api${apiPath}${sep}api_token=${encodeURIComponent(OPTIONS.eodhdKey)}&fmt=json`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) { const e = new Error("Bei EODHD nicht gefunden"); e.status = 404; throw e; }
  if (r.status === 401 || r.status === 403) throw new Error("EODHD-Schlüssel ungültig oder Börse nicht im Tarif enthalten");
  if (r.status === 402 || r.status === 429) throw new Error("EODHD-Abrufkontingent erschöpft");
  if (!r.ok) throw new Error(`EODHD antwortet mit ${r.status}`);
  return r.json();
}
function eodFromYahoo(sym) {
  if (!sym) return null;
  const m = sym.match(/^(.+)\.([A-Z]{1,3})$/);
  if (!m) return /^[A-Z.-]+$/.test(sym) ? `${sym}.US` : null;
  if (isIsin(m[1])) return null;                 // Fonds unter ISIN: besser per Suche (meist Börse EUFUND)
  return YH_TO_EOD[m[2]] ? `${m[1]}.${YH_TO_EOD[m[2]]}` : null;
}
function eodType(t) { t = String(t || "").toLowerCase(); return t === "etf" ? "ETF" : t === "fund" || t.includes("fund") ? "Fonds" : t.includes("stock") ? "Aktie" : "ETF"; }
async function eodResolve(item) {
  const q = item.isin || item.name;
  if (!q) return null;
  const res = await eodhd(`/search/${encodeURIComponent(q)}?limit=20`);
  const list = (Array.isArray(res) ? res : []).filter(x => x.Code && x.Exchange);
  if (!list.length) return null;
  list.sort((a, b) => {
    const ra = EOD_EX_PREF.indexOf(a.Exchange), rb = EOD_EX_PREF.indexOf(b.Exchange);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
  if (isIsin(item.name) && list[0].Name) { item.name = list[0].Name; item.type = eodType(list[0].Type); saveState(); }
  return `${list[0].Code}.${list[0].Exchange}`;
}
async function eodHistory(symbol, fromDate) {
  const q = `?from=${fromDate || yearsAgo(HIST_YEARS)}`;
  const rows = await eodhd(`/eod/${encodeURIComponent(symbol)}${q}`);
  if (!Array.isArray(rows)) throw new Error("Unerwartete Antwort von EODHD");
  return rows.filter(r => r.date && isFinite(r.close) && r.close > 0)
    .map(r => ({ d: r.date, adj: Number(r.adjusted_close ?? r.close), raw: Number(r.close) }));
}

/* -------------------------------------------- Abruf mit Gegenprüfung */
// Hauptquelle: EODHD (falls Schlüssel vorhanden), sonst Yahoo. Die andere Quelle prüft den letzten Schlusskurs gegen
// und springt ein, wenn die Hauptquelle ausfällt.
function lastCommon(a, b) {
  const mb = new Map(b.map(x => [x[0], x[1]]));
  for (let i = a.length - 1; i >= 0; i--) if (mb.has(a[i][0])) return { date: a[i][0], a: a[i][1], b: mb.get(a[i][0]) };
  return null;
}

// Lange Historie einmal laden (und wöchentlich neu, wegen rückwirkender Dividendenbereinigung),
// dazwischen nur die letzten 3 Monate holen und anfügen.
function mergeSeries(oldS, newS) {
  const m = new Map(oldS.map(x => [x[0], x[1]])); newS.forEach(([d, v]) => m.set(d, v));
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-KEEP);
}
async function fetchYahooPart(item, p) {
  if (!item.symbol) return { ok: false, error: "kein Yahoo-Symbol" };
  try {
    const have = p.yahoo?.series?.length > 300 ? p.yahoo : null;
    const fullDue = !have || !have.fullAt || Date.now() - Date.parse(have.fullAt) > 7 * 864e5 || have.years !== HIST_YEARS;
    if (!fullDue) {
      const h = await fetchHistory(item.symbol, "3mo");
      const mOld = new Map(have.series.map(x => [x[0], x[1]]));
      const ov = h.series.find(x => mOld.has(x[0]));
      if (ov && Math.abs(mOld.get(ov[0]) / ov[1] - 1) <= 0.002)
        return { ok: true, series: mergeSeries(have.series, h.series), raw: mergeSeries(have.raw || [], h.raw || []),
          currency: h.currency, fullAt: have.fullAt };
    }
    const h = await fetchHistory(item.symbol, `${HIST_YEARS}y`);
    return { ok: true, series: h.series.slice(-KEEP), raw: (h.raw || []).slice(-KEEP), currency: h.currency, fullAt: new Date().toISOString() };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Ältere Kurse der Zweitquelle vor die Hauptquelle setzen (z. B. EODHD-Gratistarif: nur 1 Jahr),
// am ersten gemeinsamen Tag auf das Niveau der Hauptquelle umgerechnet.
function splice(prim, sec) {
  if (!prim?.length || !sec?.length || sec[0][0] >= prim[0][0]) return prim || [];
  const ms = new Map(sec.map(x => [x[0], x[1]]));
  const anchor = prim.slice(0, 30).find(x => ms.has(x[0]));
  if (!anchor) return prim;
  const f = anchor[1] / ms.get(anchor[0]);
  const older = sec.filter(x => x[0] < prim[0][0]).map(([d, v]) => [d, Math.round(v * f * 10000) / 10000]);
  return older.concat(prim).slice(-KEEP);
}
async function fetchEodPart(item, p) {
  if (!EOD_ENABLED()) return { ok: false, error: "kein EODHD-Schlüssel", skipped: true };
  try {
    if (!item.eodSymbol) {
      item.eodSymbol = eodFromYahoo(item.symbol) || await eodResolve(item) || "";
      saveState();
      if (!item.eodSymbol) return { ok: false, error: "bei EODHD nicht gefunden" };
    }
    // inkrementell abrufen, wenn schon Historie da ist (spart Datenvolumen; zählt trotzdem als 1 Abruf)
    const have = p.eod?.series?.length ? p.eod.series : null;
    const from = have ? have.at(-15)?.[0] : null;
    let rows;
    try { rows = await eodHistory(item.eodSymbol, from); }
    catch (e) {
      if (e.status === 404 && !from) {           // Kürzel passte nicht: einmal per Suche auflösen
        const alt = await eodResolve(item);
        if (!alt || alt === item.eodSymbol) throw e;
        item.eodSymbol = alt; saveState();
        rows = await eodHistory(alt, null);
      } else throw e;
    }
    const m = new Map(have ? have.map(x => [x[0], x[1]]) : []);
    const mr = new Map(have ? (p.eod.raw || []).map(x => [x[0], x[1]]) : []);
    // Bei Dividenden ändert sich die bereinigte Historie rückwirkend: bei Abweichung im Überlappungsbereich komplett neu laden
    const ov = rows.find(r => m.has(r.d));
    if (ov && Math.abs(m.get(ov.d) / ov.adj - 1) > 0.002) {
      const full = await eodHistory(item.eodSymbol, null);
      m.clear(); mr.clear(); full.forEach(r => { m.set(r.d, r.adj); mr.set(r.d, r.raw); });
    } else rows.forEach(r => { m.set(r.d, r.adj); mr.set(r.d, r.raw); });
    const sort = mm => [...mm.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-KEEP);
    return { ok: true, series: sort(m), raw: sort(mr) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Einträge, die ohne Yahoo-Kürzel angelegt wurden (z. B. weil die Suche ausfiel), höchstens alle 6 h neu auflösen
async function healItem(item) {
  if (item.symbol || !(item.isin || item.name)) return;
  if (item.yhTriedAt && Date.now() - Date.parse(item.yhTriedAt) < 6 * 3600e3) return;
  item.yhTriedAt = new Date().toISOString();
  const r = await resolveSymbol(item.isin || item.name, null);
  if (r) {
    item.symbol = r.symbol; item.exchange = r.exchange;
    if (isIsin(item.name)) { item.name = r.name; item.type = r.type; }
    log("Yahoo-Kürzel nachgetragen:", item.name, r.symbol);
  }
  saveState();
}

async function refreshItem(item, force = false) {
  if (force) await healItem(item);
  const p = await readPrices(item.id);
  if (!item.symbol && !item.eodSymbol && !(EOD_ENABLED() && item.isin)) return p;
  const age = p.fetchedAt ? Date.now() - Date.parse(p.fetchedAt) : Infinity;
  if (!force && age < 20 * 60 * 1000) return p;

  // EODHD nur bei erzwungenem Abruf (Prüfung, Hinzufügen, Knopf) – schont das Tageskontingent.
  // Beim bloßen Öffnen der App wird nur Yahoo aktualisiert.
  const eodDue = force || !p.eod?.fetchedAt || (Date.now() - Date.parse(p.eod.fetchedAt) > 12 * 3600e3);
  const [yh, eo] = await Promise.all([fetchYahooPart(item, p), eodDue ? fetchEodPart(item, p) : Promise.resolve(null)]);
  const now = new Date().toISOString();

  if (yh.ok) { p.yahoo = { series: yh.series, raw: yh.raw, fetchedAt: now, fullAt: yh.fullAt, years: HIST_YEARS }; if (yh.currency && item.currency !== yh.currency) { item.currency = yh.currency; saveState(); } }
  if (eo?.ok) p.eod = { series: eo.series, raw: eo.raw, fetchedAt: now };

  const eodFresh = p.eod?.series?.length && (eo?.ok || (!eodDue));
  const primary = eodFresh ? "eodhd" : p.yahoo?.series?.length && yh.ok ? "yahoo" : p.eod?.series?.length ? "eodhd" : p.yahoo?.series?.length ? "yahoo" : null;
  const prim = primary === "eodhd" ? p.eod : p.yahoo, sec = primary === "eodhd" ? p.yahoo : p.eod;
  p.series = splice(prim?.series, sec?.series) || p.series || [];
  p.source = primary;
  p.spliced = !!(prim?.series?.length && p.series.length > prim.series.length);

  // Gegenprüfung auf unbereinigten Schlusskursen
  p.check = null;
  if (prim?.raw?.length && sec?.raw?.length) {
    const c = lastCommon(prim.raw, sec.raw);
    if (c) {
      const diff = c.b / c.a - 1;
      p.check = { date: c.date, diff, ok: Math.abs(diff) <= OPTIONS.maxDiff,
        lagDays: Math.round((Date.parse(prim.raw.at(-1)[0]) - Date.parse(sec.raw.at(-1)[0])) / 864e5) };
    }
  }

  const problems = [];
  if (EOD_ENABLED() && eo && !eo.ok && !eo.skipped) problems.push("EODHD: " + eo.error);
  if (item.symbol && !yh.ok) problems.push("Yahoo: " + yh.error);
  p.warnings = problems;
  p.error = !p.series.length ? (problems.join(" · ") || "Keine Kursquelle verfügbar") : null;
  if (p.check && !p.check.ok) {
    const msg = `Quellen weichen am ${p.check.date.split("-").reverse().join(".")} um ${(p.check.diff * 100).toFixed(1).replace(".", ",")} % ab`;
    p.warnings.push(msg); log("Plausibilität:", item.name, msg);
  }
  if (yh.ok || eo?.ok) p.fetchedAt = now;
  p.status = {
    yahoo: item.symbol ? { ok: yh.ok, error: yh.ok ? null : yh.error, from: p.yahoo?.series?.[0]?.[0] || null, n: p.yahoo?.series?.length || 0 }
                       : { ok: false, error: "kein Yahoo-Kürzel gefunden", from: null, n: 0 },
    eodhd: EOD_ENABLED() ? { ok: eo ? eo.ok : !!p.eod?.series?.length, error: eo && !eo.ok ? eo.error : null, from: p.eod?.series?.[0]?.[0] || null, n: p.eod?.series?.length || 0 } : null
  };
  problems.forEach(w => log("Kursabruf:", item.name, w));
  await writePrices(item.id, p);
  return p;
}

/* ------------------------------------------------------- Home Assistant */
async function ha(method, apiPath, body) {
  if (MOCK || !SUP_TOKEN) { log("[HA]", method, apiPath, body ? JSON.stringify(body).slice(0, 300) : ""); return MOCK ? mockHa(apiPath) : null; }
  const r = await fetch("http://supervisor" + apiPath, {
    method, headers: { Authorization: `Bearer ${SUP_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`Home Assistant antwortet mit ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
let ingressPath = null;
async function getIngressPath() {
  if (ingressPath) return ingressPath;
  try { const j = await ha("GET", "/addons/self/info"); const slug = j?.data?.slug; if (slug) ingressPath = `/hassio/ingress/${slug}`; }
  catch (e) { log("Add-on-Info nicht verfügbar:", e.message); }
  return ingressPath || "/hassio/ingress/local_nachkauf_radar";
}
async function listNotifyServices() {
  const j = await ha("GET", "/core/api/services");
  const n = (Array.isArray(j) ? j : []).find(x => x.domain === "notify");
  return n ? Object.keys(n.services).sort((a, b) => (b.startsWith("mobile_app_") - a.startsWith("mobile_app_")) || a.localeCompare(b)) : [];
}
async function sendNotify(title, message) {
  const svc = state.notify.service;
  if (!svc) throw new Error("Kein Benachrichtigungsdienst gewählt");
  const click = await getIngressPath();
  await ha("POST", `/core/api/services/notify/${encodeURIComponent(svc)}`, {
    title, message,
    data: { clickAction: click, url: click, tag: "nachkauf-radar", group: "nachkauf-radar", channel: "Nachkauf-Radar" }
  });
}
async function publishSensor(results) {
  const buy = results.filter(r => r.level === "buy"), watch = results.filter(r => r.level === "watch");
  try {
    await ha("POST", "/core/api/states/sensor.nachkauf_radar_signale", {
      state: String(buy.length),
      attributes: {
        friendly_name: "Nachkauf-Radar Signale", icon: "mdi:chart-line-variant",
        nachkauf_pruefen: buy.map(r => r.name), beobachten: watch.map(r => r.name),
        letzte_pruefung: new Date().toISOString()
      }
    });
  } catch (e) { log("Sensor konnte nicht gesetzt werden:", e.message); }
}

/* ------------------------------------------------------- Tägliche Prüfung */
const pct = v => (v > 0 ? "+" : "") + (v * 100).toFixed(1).replace(".", ",") + " %";
let checking = null;
async function runCheck(reason = "Zeitplan") {
  if (checking) return checking;
  checking = (async () => {
    log("Prüfung gestartet:", reason, `(${state.watchlist.length} Werte)`);
    const results = [];
    for (const item of state.watchlist) {
      const p = await refreshItem(item, true);
      const a = analyze(mergedSeries(p), state.settings);
      results.push({ id: item.id, name: item.name, level: a.level, score: a.score, r1: a.r1, dd: a.dd, lastDate: a.lastDate,
        dayHit: a.signals.find(s => s.key === "day")?.hit || false, error: p.error || null,
        diverge: !!(p.check && !p.check.ok), single: !p.check, source: p.source });
      if (!MOCK) await new Promise(r => setTimeout(r, 800));
    }
    const rank = { none: 0, calm: 1, watch: 2, buy: 3 };
    const minRank = rank[state.notify.level] ?? 3;
    const fresh = [];
    for (const r of results) {
      const prev = state.alerts[r.id];
      const meets = rank[r.level] >= minRank;
      const changed = !prev || prev.level !== r.level;
      const newDayDrop = r.dayHit && prev?.date !== r.lastDate;
      if (meets && (changed || newDayDrop)) fresh.push(r);
      state.alerts[r.id] = { level: r.level, date: r.lastDate };
    }
    if (fresh.length && state.notify.service) {
      const title = fresh.length === 1 ? `Nachkauf-Radar: ${fresh[0].name}` : `Nachkauf-Radar: ${fresh.length} Signale`;
      const msg = fresh.map(r => `${LEVEL_LABEL[r.level]}: ${r.name} – heute ${r.r1 != null ? pct(r.r1) : "–"}, vom Hoch ${r.dd != null ? pct(r.dd) : "–"}`
        + (r.diverge ? " ⚠ Kursquellen weichen ab, bitte prüfen" : r.single ? " (nur eine Quelle)" : "")).join("\n");
      try { await sendNotify(title, msg); log("Benachrichtigung gesendet:", fresh.length); }
      catch (e) { log("Benachrichtigung fehlgeschlagen:", e.message); }
    }
    await publishSensor(results);
    state.lastRun = new Date().toISOString();
    state.lastResult = { count: results.length, buy: results.filter(r => r.level === "buy").length,
      watch: results.filter(r => r.level === "watch").length, notified: fresh.length,
      errors: results.filter(r => r.error).map(r => `${r.name}: ${r.error}`),
      diverging: results.filter(r => r.diverge).map(r => r.name), eodCalls: state.eodUsage.calls };
    await saveState();
    log("Prüfung beendet:", JSON.stringify(state.lastResult));
    return state.lastResult;
  })().finally(() => { checking = null; });
  return checking;
}

function localParts(d = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hm: `${pad(d.getHours())}:${pad(d.getMinutes())}`, dow: d.getDay() };
}
setInterval(() => {
  const { date, hm, dow } = localParts();
  if (state.notify.weekdaysOnly && (dow === 0 || dow === 6)) return;
  if (hm >= state.notify.time && state.lastRunDate !== date) {
    state.lastRunDate = date;
    runCheck("Zeitplan").catch(e => log("Prüfung fehlgeschlagen:", e.message));
  }
}, 30 * 1000);

/* ------------------------------------------------------------------ HTTP */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 3e6) throw new Error("Anfrage zu groß"); chunks.push(c); }
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}
const newId = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40) || "X" + Date.now().toString(36).toUpperCase();

const routes = {
  // Sicherung: Watchlist, Schwellen, Benachrichtigung (ohne Kurse – die lädt das Add-on neu)
  "GET /api/export": async () => ({ format: "nachkauf-radar", version: VERSION, exportedAt: new Date().toISOString(),
    watchlist: state.watchlist.map(({ yhTriedAt, ...it }) => it), settings: state.settings, notify: state.notify }),

  "POST /api/restore": async (_q, b) => importBackup(b),

  // Umzug: Watchlist direkt vom bisherigen, lokal installierten Add-on holen (gleiches Docker-Netz in Home Assistant)
  "POST /api/migrate-local": async (_q, b) => {
    const hosts = [b.host, "local-nachkauf-radar", "local_nachkauf_radar"].filter(Boolean);
    let lastErr;
    for (const h of hosts) {
      try {
        const r = await fetch(`http://${h}:8099/api/state`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        return await importBackup({ watchlist: (j.items || []).map(({ prices, fetchedAt, error, manualCount, source, check, warnings, spliced, status, ...it }) => it),
          settings: j.settings, notify: j.notify }, `lokales Add-on (${h})`);
      } catch (e) { lastErr = `${h}: ${e.message}`; }
    }
    throw Object.assign(new Error("Bisheriges Add-on nicht erreichbar. Läuft es noch? (" + lastErr + ")"), { status: 502 });
  },

  "GET /api/info": async () => ({ version: VERSION, mock: MOCK, haConnected: !!SUP_TOKEN || MOCK, eodhd: EOD_ENABLED() }),

  "GET /api/state": async () => {
    const items = [];
    for (const it of state.watchlist) {
      const p = await readPrices(it.id);
      items.push({ ...it, prices: mergedSeries(p), fetchedAt: p.fetchedAt, error: p.error || null, manualCount: (p.manual || []).length,
        source: p.source || null, check: p.check || null, warnings: p.warnings || [], spliced: !!p.spliced, status: p.status || null });
    }
    eodBudgetLeft();
    return { items, settings: state.settings, notify: state.notify, lastRun: state.lastRun, lastResult: state.lastResult,
      sources: { eodhd: EOD_ENABLED(), eodCalls: state.eodUsage.calls, eodLimit: OPTIONS.eodhdLimit, maxDiff: OPTIONS.maxDiff } };
  },

  "POST /api/refresh": async (_q, body) => {
    const ids = body.ids || state.watchlist.map(x => x.id);
    for (const it of state.watchlist.filter(x => ids.includes(x.id))) {
      await refreshItem(it, !!body.force);
      if (!MOCK && body.force) await new Promise(r => setTimeout(r, 400));
    }
    return { ok: true };
  },

  "GET /api/search": async q => {
    const text = (q.get("q") || "").trim();
    if (text.length < 2) return { results: [] };
    try { return { results: await searchRemote(text) }; }
    catch (e) {
      if (EOD_ENABLED() && isIsin(text)) {
        try {
          const res = await eodhd(`/search/${encodeURIComponent(text.toUpperCase())}?limit=10`);
          const list = (Array.isArray(res) ? res : []).filter(x => x.Code && x.Exchange).map(x => ({
            symbol: "", eodSymbol: `${x.Code}.${x.Exchange}`, name: x.Name || x.Code, type: eodType(x.Type), exchange: x.Exchange + " (EODHD)", exchCode: x.Exchange }));
          return { results: list, error: "Yahoo nicht erreichbar, Treffer von EODHD" };
        } catch {}
      }
      return { results: [], error: "Live-Suche nicht erreichbar: " + e.message };
    }
  },

  "POST /api/watchlist": async (_q, b) => {
    let { symbol, isin, name, type, ticker, exchange, eodSymbol } = b;
    isin = (isin || "").toUpperCase().trim();
    if (!isin && isIsin(name)) isin = name.toUpperCase().trim();
    const placeholder = !name || isIsin(name);
    if (!symbol && (b.manualOnly !== true || isin)) {
      const r = await resolveSymbol(isin || name, ticker);
      if (r) { symbol = r.symbol; exchange = r.exchange; if (placeholder) { name = r.name; type = r.type; } else { name = name || r.name; type = type || r.type; } }
    }
    const id = newId(symbol || isin || name);
    if (state.watchlist.some(x => x.id === id)) return { ok: true, id, existed: true };
    const item = { id, symbol: symbol || "", isin, name: name || symbol || isin, type: type || "ETF", exchange: exchange || "",
      currency: "", addedAt: new Date().toISOString().slice(0, 10), eodSymbol: eodSymbol || "" };
    state.watchlist.push(item);
    await saveState();
    const p = await refreshItem(item, true);
    const error = p.series?.length ? null : "Keine Kursquelle gefunden. Kurse können per Import eingetragen werden.";
    return { ok: true, id, symbol: item.symbol, eodSymbol: item.eodSymbol || "", error };
  },

  "DELETE /api/watchlist": async q => {
    const id = q.get("id");
    state.watchlist = state.watchlist.filter(x => x.id !== id);
    delete state.alerts[id];
    await saveState();
    try { await fs.unlink(priceFile(id)); } catch {}
    return { ok: true };
  },

  "POST /api/import": async (_q, b) => {
    const it = state.watchlist.find(x => x.id === b.id);
    if (!it) throw Object.assign(new Error("Unbekannter Eintrag"), { status: 404 });
    const rows = (b.rows || []).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && isFinite(r[1]) && r[1] > 0);
    const p = await readPrices(it.id);
    const m = new Map((p.manual || []).map(x => [x[0], x[1]]));
    rows.forEach(([d, v]) => m.set(d, Number(v)));
    p.manual = [...m.entries()].sort((a, c) => a[0] < c[0] ? -1 : 1).slice(-KEEP);
    await writePrices(it.id, p);
    return { ok: true, count: rows.length };
  },

  "POST /api/settings": async (_q, b) => {
    const n = {};
    for (const k of Object.keys(DEFAULTS)) { const v = Number(b[k]); n[k] = isFinite(v) ? v : DEFAULTS[k]; }
    if (n.dd2 < n.dd1) n.dd2 = n.dd1;
    state.settings = n; await saveState();
    return { ok: true, settings: n };
  },

  "GET /api/notify/services": async () => {
    try { return { services: await listNotifyServices() }; }
    catch (e) { return { services: [], error: e.message }; }
  },

  "POST /api/notify": async (_q, b) => {
    const time = /^\d{2}:\d{2}$/.test(b.time || "") ? b.time : state.notify.time;
    state.notify = { service: String(b.service || ""), time, weekdaysOnly: b.weekdaysOnly !== false,
      level: b.level === "watch" ? "watch" : "buy" };
    const { date, hm } = localParts();
    if (hm < time && state.lastRunDate === date) state.lastRunDate = null;
    await saveState();
    return { ok: true, notify: state.notify };
  },

  "POST /api/notify/test": async () => {
    await sendNotify("Nachkauf-Radar", "Testnachricht: Benachrichtigungen funktionieren.");
    return { ok: true };
  },

  "GET /api/diag": async () => {
    const out = { zeit: new Date().toISOString(), version: VERSION };
    const t0 = Date.now();
    try {
      const h = await fetchHistory("EUNL.DE", "10y", { ignoreBlock: true });
      out.yahoo_kurse = { ok: true, punkte: h.series.length, ab: h.series[0]?.[0], bis: h.series.at(-1)?.[0], ms: Date.now() - t0, crumb: !!yAuth.crumb, verbindung: yTransport() };
    } catch (e) { out.yahoo_kurse = { ok: false, fehler: e.message, crumb: !!yAuth.crumb, verbindung: yTransport(), helfer: helper.failed || (helper.ready ? "bereit" : "nicht gestartet") }; }
    try { const r = await searchRemote("IE00B4L5Y983"); out.yahoo_suche = { ok: true, treffer: r.length, erster: r[0]?.symbol || null }; }
    catch (e) { out.yahoo_suche = { ok: false, fehler: e.message }; }
    if (EOD_ENABLED()) {
      try { const rows = await eodHistory("EUNL.XETRA", yearsAgo(HIST_YEARS)); out.eodhd = { ok: true, punkte: rows.length, ab: rows[0]?.d, bis: rows.at(-1)?.d, abrufe_heute: state.eodUsage.calls, limit: OPTIONS.eodhdLimit }; }
      catch (e) { out.eodhd = { ok: false, fehler: e.message, abrufe_heute: state.eodUsage.calls, limit: OPTIONS.eodhdLimit }; }
      saveState();
    } else out.eodhd = { ok: false, fehler: "kein API-Schlüssel eingetragen" };
    log("Diagnose:", JSON.stringify(out));
    return out;
  },

  "POST /api/check": async () => ({ ok: true, result: await runCheck("manuell") })
};

async function importBackup(b, from = "Sicherung") {
  const list = Array.isArray(b?.watchlist) ? b.watchlist : null;
  if (!list) throw Object.assign(new Error("Keine Watchlist in den Daten gefunden"), { status: 400 });
  let added = 0;
  for (const it of list) {
    if (!it || !it.id || !(it.symbol || it.isin || it.name)) continue;
    if (state.watchlist.some(x => x.id === it.id)) continue;
    state.watchlist.push({ id: String(it.id), symbol: it.symbol || "", isin: it.isin || "", name: it.name || it.isin || it.symbol,
      type: it.type || "ETF", exchange: it.exchange || "", currency: it.currency || "", addedAt: it.addedAt || new Date().toISOString().slice(0, 10),
      eodSymbol: it.eodSymbol || "" });
    added++;
  }
  if (b.settings && typeof b.settings === "object") state.settings = { ...DEFAULTS, ...b.settings };
  if (b.notify && typeof b.notify === "object") state.notify = { ...state.notify, ...b.notify };
  await saveState();
  log(`Übernommen aus ${from}: ${added} Werte`);
  // Kurse im Hintergrund laden
  (async () => { for (const it of state.watchlist) { await refreshItem(it, true).catch(() => {}); if (!MOCK) await new Promise(r => setTimeout(r, 500)); } })();
  return { ok: true, added, total: state.watchlist.length };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const key = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
    if (routes[key]) {
      const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
      return send(res, 200, await routes[key](url.searchParams, body));
    }
    if (req.method !== "GET") return send(res, 404, { error: "Unbekannte Anfrage" });
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return send(res, 404, { error: "Nicht gefunden" });
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch (e) {
    log("Fehler:", req.method, req.url, e.message);
    send(res, e.status || 500, { error: e.message });
  }
});

/* -------------------------------------------------------------- Testmodus */
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
function mockSearch(q) {
  return searchCatalog(q, "Alle", 8).map(c => ({ symbol: (c.ticker || c.isin) + ".DE", name: c.name, type: c.type, exchange: "XETRA", exchCode: "GER" }));
}
function mockHistory(symbol, range = "10y") {
  const r = rng(hash(symbol)); const g = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return u - 3; };
  const young = /^SAP/.test(symbol) ? 0 : /^LU/.test(symbol) ? 1500 : 0;     // ein Fonds mit nur ~6 Jahren Historie
  const total = (young || 2620);
  const days = []; const d = new Date(); while (days.length < total) { if (d.getDay() % 6) days.unshift(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1); }
  let p = 20 + r() * 300; const crash = r() < 0.5;
  const series = days.map((dt, i) => { const k = days.length - 1 - i; let ret = 0.0005 + g() * 0.01; if (crash && k < 4) ret = -0.02 - r() * 0.01; p *= 1 + ret; return [dt, Math.round(p * 100) / 100]; });
  const cut = range === "3mo" ? series.slice(-66) : series;
  return { series: cut, raw: cut, currency: "EUR", exchange: "XETRA (Test)" };
}
function mockEod(apiPath) {
  const m = apiPath.match(/^\/(search|eod)\/([^?]+)/); const key = decodeURIComponent(m[2]);
  if (m[1] === "search") {
    const c = CATALOG.find(x => x.isin === key) || searchCatalog(key, "Alle", 1)[0];
    return c ? [{ Code: c.ticker || c.isin, Exchange: c.ticker ? "XETRA" : "EUFUND", Name: c.name, Type: c.type, ISIN: c.isin }] : [];
  }
  const base = key.replace(/\.(XETRA|EUFUND|F|US)$/, "");
  const h = mockHistory(base + ".DE");
  const f = /^SAP/.test(base) ? 1.03 : 1.001;               // SAP absichtlich abweichend → Plausibilitätswarnung
  return h.series.slice(-255).map(([d, v]) => ({ date: d, close: Math.round(v * f * 100) / 100, adjusted_close: Math.round(v * f * 100) / 100 }));
}
function mockHa(apiPath) {
  if (apiPath === "/core/api/services") return [{ domain: "notify", services: { mobile_app_pixel_8: {}, notify: {} } }];
  if (apiPath === "/addons/self/info") return { data: { slug: "local_nachkauf_radar" } };
  return {};
}

await loadState();
if (!MOCK) startHelper();
server.listen(PORT, () => log(`Nachkauf-Radar ${VERSION} läuft auf Port ${PORT}${MOCK ? " (Testmodus)" : ""}; Prüfzeit ${state.notify.time}`));
