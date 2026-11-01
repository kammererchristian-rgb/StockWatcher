/* Nachkauf-Radar – Dashboard-Karte für Home Assistant
 *
 *   type: custom:nachkauf-radar-card
 *   height: 760          # Höhe in Pixeln (Standard 760)
 *   mode: full           # full = Add-on-Oberfläche einbetten, compact = schlichte Liste aus den Sensoren
 *   view: app            # app = komplette Ansicht wie in der Seitenleiste
 *                        # watchlist = Kacheln + Watchlist (ohne Suche/Einstellungen), Höhe passt sich an
 *                        # summary = nur die vier Kacheln, Höhe passt sich an
 *
 * Die volle Ansicht bettet die Add-on-Oberfläche über Ingress ein, genau wie die Seitenleiste.
 * Dafür braucht das angemeldete Konto Admin-Rechte; sonst zeigt die Karte automatisch die kompakte Watchlist.
 */
const NR_VERSION = "__VERSION__";
const SUMMARY = "sensor.nachkauf_radar_signale";
const PREFIX = "sensor.nachkauf_radar_";

class NachkaufRadarCard extends HTMLElement {
  static getStubConfig() { return { view: "app" }; }
  static getConfigElement() { return document.createElement("nachkauf-radar-card-editor"); }

  setConfig(config) {
    this._config = { mode: "full", view: "app", ...(config || {}) };
    if (!["app", "watchlist", "summary", "charts"].includes(this._config.view)) throw new Error("view muss app, watchlist, summary oder charts sein");
    this._auto = this._config.view !== "app" && !this._config.height;
    this._frameH = null;
    this._mode = null;
    if (this._hass) this._start();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._start();
    else if (this._mode === "compact") this._renderCompact();
  }

  _height() { return this._frameH || Number(this._config?.height) || { app: 760, watchlist: 460, summary: 160, charts: 420 }[this._config?.view] || 760; }
  _fill() { return this._config?.height === "fill"; }
  getCardSize() { return this._mode === "compact" ? 4 : this._fill() ? 12 : Math.ceil(this._height() / 50); }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: this._mode === "compact" || this._auto ? "auto" : Math.ceil(this._height() / 56) }; }

  connectedCallback() {
    if (this._mode === "full" && !this._timer) this._timer = setInterval(() => this._keepAlive(), 60000);
    if (!this._onMsg) {
      // eingebettete Ansicht meldet ihre Höhe
      this._onMsg = ev => {
        const f = this.querySelector("iframe");
        if (!f || ev.source !== f.contentWindow || ev.data?.type !== "nachkauf-radar-height" || !this._auto) return;
        const h = Math.max(60, Math.min(4000, Number(ev.data.h) || 0));
        if (Math.abs(h - (this._frameH || 0)) > 2) { this._frameH = h; f.style.height = h + "px"; }
      };
      window.addEventListener("message", this._onMsg);
    }
  }
  disconnectedCallback() {
    clearInterval(this._timer); this._timer = null;
    if (this._onMsg) { window.removeEventListener("message", this._onMsg); this._onMsg = null; }
  }

  _shell(inner) {
    this.innerHTML = `
      <ha-card>
        <style>
          .nr-frame{display:block;width:100%;border:0;border-radius:var(--ha-card-border-radius,12px);background:var(--card-background-color)}
          .nr-c{padding:12px 16px 14px}
          .nr-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
          .nr-h b{font-size:16px}
          .nr-h a{color:var(--primary-color);font-size:13px;text-decoration:none}
          .nr-l{display:grid}
          .nr-r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:8px 0;border-top:1px solid var(--divider-color)}
          .nr-r .nm{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .nr-r .nums{grid-column:1/-1;display:flex;gap:14px;font-size:13px;color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
          .nr-r .nums b{font-weight:500;color:var(--primary-text-color)}
          .neg{color:var(--error-color,#c2341f)} .pos{color:var(--success-color,#3f7a5a)}
          .pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
          .buy{background:rgba(194,52,31,.14);color:var(--error-color,#c2341f)}
          .watch{background:rgba(168,106,0,.14);color:var(--warning-color,#a86a00)}
          .calm{background:rgba(63,122,90,.14);color:var(--success-color,#3f7a5a)}
          .none{background:var(--secondary-background-color);color:var(--secondary-text-color)}
          .nr-note{color:var(--secondary-text-color);font-size:12.5px;margin-top:8px}
        </style>
        ${inner}
      </ha-card>`;
  }

  async _start() {
    if (!this._config || !this._hass || this._starting) return;
    this._starting = true;
    try {
      if (this._config.mode !== "compact" && this._hass.user?.is_admin !== false) {
        try { await this._startFull(); return; }
        catch (e) { this._fullError = e?.message || String(e); }
      }
      this._mode = "compact";
      this._renderCompact();
    } finally { this._starting = false; }
  }

  _slug() {
    if (this._config.addon) return this._config.addon;
    const p = this._hass.states[SUMMARY]?.attributes?.addon_slug;
    if (p) return p;
    throw new Error("Sensor " + SUMMARY + " fehlt – läuft das Add-on?");
  }

  async _session() {
    const r = await this._hass.callWS({ type: "supervisor/api", endpoint: "/ingress/session", method: "post" });
    this._sess = r.session;
    document.cookie = `ingress_session=${r.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === "https:" ? ";Secure" : ""}`;
  }
  async _keepAlive() {
    if (!this._sess) return;
    try { await this._hass.callWS({ type: "supervisor/api", endpoint: "/ingress/validate_session", method: "post", data: { session: this._sess } }); }
    catch { try { await this._session(); } catch {} }
  }

  async _startFull() {
    const info = await this._hass.callWS({ type: "supervisor/api", endpoint: `/addons/${this._slug()}/info`, method: "get" });
    if (!info?.ingress_url) throw new Error("Add-on hat keine Ingress-Adresse");
    await this._session();
    this._mode = "full";
    const v = this._config.view, q = new URLSearchParams();
    if (v !== "app") q.set("embed", v);
    if (this._config.isin) q.set("isin", String(this._config.isin));
    const src = info.ingress_url + (q.toString() ? "?" + q : "");
    const h = this._fill() ? "calc(100vh - var(--header-height, 56px) - 16px)" : this._height() + "px";
    this._shell(`<iframe class="nr-frame" title="Nachkauf-Radar" scrolling="${this._auto ? "no" : "auto"}" style="height:${h}" src="${src}"></iframe>`);
    this.connectedCallback();
    if (!this._timer) this._timer = setInterval(() => this._keepAlive(), 60000);
  }

  _renderCompact() {
    const h = this._hass, s = h.states[SUMMARY];
    const panel = s?.attributes?.panel || "/local_nachkauf_radar";
    const rows = Object.values(h.states).filter(e => e.entity_id.startsWith(PREFIX) && e.entity_id !== SUMMARY)
      .map(e => ({ e, a: e.attributes }))
      .sort((x, y) => ({ buy: 0, watch: 1, calm: 2, none: 3 }[x.a.stufe] ?? 3) - ({ buy: 0, watch: 1, calm: 2, none: 3 }[y.a.stufe] ?? 3));
    const fmt = v => v == null || isNaN(v) ? "–" : (v > 0 ? "+" : "") + Number(v).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
    const cls = v => v == null ? "" : v < 0 ? "neg" : v > 0 ? "pos" : "";
    const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const range = this._config.range || "veraenderung_1_jahr";
    const label = { veraenderung_1_monat: "1 M", veraenderung_1_jahr: "1 J", veraenderung_5_jahre: "5 J", veraenderung_10_jahre: "10 J" }[range] || "1 J";
    this._shell(`<div class="nr-c">
      <div class="nr-h"><b>Nachkauf-Radar</b><a href="${esc(panel)}">Öffnen ›</a></div>
      ${!s ? `<div class="nr-note">Noch keine Daten. Läuft das Add-on Nachkauf-Radar?</div>` : rows.length ? `<div class="nr-l">
        ${rows.map(({ e, a }) => `<div class="nr-r">
          <span class="nm" title="${esc(a.friendly_name)}">${esc(a.friendly_name)}</span>
          <span class="pill ${esc(a.stufe || "none")}">${esc(a.signal || "–")}</span>
          <span class="nums"><b>${isNaN(e.state) ? "–" : Number(e.state).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(a.unit_of_measurement || "")}</b>
            <span>1 T <span class="${cls(a.veraenderung_1_tag)}">${fmt(a.veraenderung_1_tag)}</span></span>
            <span>${label} <span class="${cls(a[range])}">${fmt(a[range])}</span></span></span>
        </div>`).join("")}
      </div>` : `<div class="nr-note">Die Watchlist ist leer.</div>`}
      ${this._fullError && this._config.mode !== "compact" ? `<div class="nr-note">Kompakte Ansicht: ${esc(this._fullError)}</div>` : ""}
    </div>`);
  }
}

/* Einfacher Editor: Ansicht, ISIN, Höhe – ohne YAML */
class NachkaufRadarCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...(config || {}) }; this._render(); }
  set hass(h) { this._hass = h; }
  _emit() { this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })); }
  _render() {
    const c = this._config || {};
    this.innerHTML = `<div style="display:grid;gap:14px;padding:4px 0">
      <label style="display:grid;gap:4px">Ansicht
        <select id="v" style="padding:8px;border-radius:6px;font:inherit">
          ${[["summary", "Übersicht: Kacheln und Tagesergebnisse"], ["watchlist", "Watchlist mit Kacheln"], ["charts", "Charts"], ["app", "Volle Ansicht wie in der Seitenleiste"]]
            .map(([k, t]) => `<option value="${k}" ${(c.view || "app") === k ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
      <label style="display:grid;gap:4px">Nur bestimmte Werte (ISIN, mit Komma getrennt; leer = alle)
        <input id="i" value="${String(c.isin || "").replace(/"/g, "&quot;")}" placeholder="z. B. IE00B4L5Y983" style="padding:8px;border-radius:6px;font:inherit"></label>
      <label style="display:grid;gap:4px">Höhe in Pixeln (nur volle Ansicht; leer = automatisch)
        <input id="h" value="${c.height ?? ""}" placeholder="760" style="padding:8px;border-radius:6px;font:inherit"></label>
    </div>`;
    this.querySelector("#v").onchange = e => { this._config = { ...this._config, view: e.target.value }; this._emit(); };
    this.querySelector("#i").onchange = e => { const v = e.target.value.trim(); this._config = { ...this._config }; if (v) this._config.isin = v; else delete this._config.isin; this._emit(); };
    this.querySelector("#h").onchange = e => { const v = e.target.value.trim(); this._config = { ...this._config }; if (v) this._config.height = v === "fill" ? v : Number(v); else delete this._config.height; this._emit(); };
  }
}

if (!customElements.get("nachkauf-radar-card")) {
  customElements.define("nachkauf-radar-card", NachkaufRadarCard);
  customElements.define("nachkauf-radar-card-editor", NachkaufRadarCardEditor);
  window.customCards = window.customCards || [];
  // je Ansicht ein Eintrag in „Karte hinzufügen“, jeweils mit fertiger Konfiguration
  const variants = [
    ["summary", "Übersicht", "Kacheln: Nachkauf prüfen, Beobachten, Unauffällig, Tagesergebnis und Tagesergebnisse je Wert."],
    ["watchlist", "Watchlist", "Kacheln und Watchlist mit Zeitraum-Umschalter und Mini-Charts."],
    ["charts", "Charts", "Kursverlauf je Wert über 1 Monat bis 10 Jahre."],
    ["app", "Volle Ansicht", "Komplette Oberfläche wie in der Seitenleiste."]
  ];
  for (const [view, title, desc] of variants) {
    const tag = view === "app" ? "nachkauf-radar-card" : `nachkauf-radar-${view}-card`;
    if (view !== "app") customElements.define(tag, class extends NachkaufRadarCard {
      static getStubConfig() { return { view }; }
      setConfig(c) { super.setConfig({ view, ...(c || {}) }); }
    });
    window.customCards.push({ type: tag, name: `Nachkauf-Radar: ${title}`, description: desc, preview: false });
  }
  console.info(`%c NACHKAUF-RADAR-CARD %c ${NR_VERSION} `, "background:#2a46c4;color:#fff;border-radius:3px 0 0 3px", "background:#e3e8fb;color:#2a46c4;border-radius:0 3px 3px 0");
}
