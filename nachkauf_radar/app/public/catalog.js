// Kleiner Startkatalog für sofortige Vorschläge. Die Live-Suche ergänzt alles Weitere.
// Typ: ETF | Aktie | Fonds | ETC
export const CATALOG = [
  ["ETF", "iShares Core MSCI World UCITS ETF (Acc)", "IE00B4L5Y983", "EUNL", "welt global industrieländer"],
  ["ETF", "Vanguard FTSE All-World UCITS ETF (Dist)", "IE00B3RBWM25", "VGWL", "welt global all world schwellenländer"],
  ["ETF", "Vanguard FTSE All-World UCITS ETF (Acc)", "IE00BK5BQT80", "VWCE", "welt global all world thesaurierend"],
  ["ETF", "Xtrackers MSCI World UCITS ETF 1C", "IE00BJ0KDQ92", "XDWD", "welt global"],
  ["ETF", "Amundi MSCI World UCITS ETF Acc", "LU1681043599", "CW8", "welt global"],
  ["ETF", "iShares MSCI ACWI UCITS ETF (Acc)", "IE00B6R52259", "ISAC", "welt global all country"],
  ["ETF", "SPDR MSCI ACWI IMI UCITS ETF", "IE00B3YLTY66", "SPYI", "welt global small cap"],
  ["ETF", "iShares Core MSCI EM IMI UCITS ETF", "IE00BKM4GZ66", "IS3N", "schwellenländer emerging markets"],
  ["ETF", "Xtrackers MSCI Emerging Markets UCITS ETF 1C", "IE00BTJRMP35", "XMME", "schwellenländer emerging markets"],
  ["ETF", "iShares Core S&P 500 UCITS ETF (Acc)", "IE00B5BMR087", "SXR8", "usa amerika sp500"],
  ["ETF", "Vanguard S&P 500 UCITS ETF (Dist)", "IE00B3XXRP09", "VUSA", "usa amerika sp500"],
  ["ETF", "iShares Nasdaq 100 UCITS ETF (Acc)", "IE00B53SZB19", "SXRV", "usa technologie nasdaq"],
  ["ETF", "Invesco EQQQ Nasdaq-100 UCITS ETF", "IE0032077012", "EQQQ", "usa technologie nasdaq"],
  ["ETF", "iShares Core DAX UCITS ETF (DE)", "DE0005933931", "EXS1", "deutschland dax"],
  ["ETF", "iShares Core EURO STOXX 50 UCITS ETF (DE)", "DE0005933956", "EXW1", "europa eurozone"],
  ["ETF", "iShares STOXX Europe 600 UCITS ETF (DE)", "DE0002635307", "EXSA", "europa"],
  ["ETF", "iShares Core MSCI Europe UCITS ETF", "IE00B4K48X80", "EUNK", "europa"],
  ["ETF", "iShares MSCI World Small Cap UCITS ETF", "IE00BF4RFH31", "IUSN", "welt nebenwerte small cap"],
  ["ETF", "Xtrackers MSCI World Information Technology UCITS ETF", "IE00BM67HT60", "XDWT", "technologie it welt"],
  ["ETF", "iShares Automation & Robotics UCITS ETF", "IE00BYZK4552", "2B76", "robotik automation thema"],
  ["ETF", "iShares Global Clean Energy UCITS ETF", "IE00B1XNHC34", "IQQH", "erneuerbare energie thema"],
  ["ETF", "iShares MSCI India UCITS ETF", "IE00BZCQB185", "QDV5", "indien"],
  ["ETF", "iShares Core Global Aggregate Bond UCITS ETF", "IE00BDBRDM35", "EUNA", "anleihen renten bond"],
  ["ETC", "Xetra-Gold", "DE000A0S9GB0", "4GLD", "gold rohstoff edelmetall"],
  ["ETC", "iShares Physical Gold ETC", "IE00B4ND3602", "PPFB", "gold rohstoff edelmetall"],
  ["Aktie", "Apple", "US0378331005", "AAPL", "usa technologie"],
  ["Aktie", "Microsoft", "US5949181045", "MSFT", "usa technologie software"],
  ["Aktie", "NVIDIA", "US67066G1040", "NVDA", "usa halbleiter chips ki"],
  ["Aktie", "Amazon", "US0231351067", "AMZN", "usa handel cloud"],
  ["Aktie", "Alphabet (A)", "US02079K3059", "GOOGL", "usa google"],
  ["Aktie", "Meta Platforms", "US30303M1027", "META", "usa facebook"],
  ["Aktie", "Tesla", "US88160R1014", "TSLA", "usa auto elektro"],
  ["Aktie", "Berkshire Hathaway (B)", "US0846707026", "BRK-B", "usa holding buffett"],
  ["Aktie", "JPMorgan Chase", "US46625H1005", "JPM", "usa bank"],
  ["Aktie", "Visa", "US92826C8394", "V", "usa zahlungen"],
  ["Aktie", "Coca-Cola", "US1912161007", "KO", "usa dividende konsum"],
  ["Aktie", "Johnson & Johnson", "US4781601046", "JNJ", "usa gesundheit pharma"],
  ["Aktie", "Taiwan Semiconductor (ADR)", "US8740391003", "TSM", "taiwan halbleiter chips"],
  ["Aktie", "ASML", "NL0010273215", "ASML", "niederlande halbleiter"],
  ["Aktie", "Novo Nordisk", "DK0062498333", "NOVO-B", "dänemark pharma"],
  ["Aktie", "LVMH", "FR0000121014", "MC", "frankreich luxus"],
  ["Aktie", "Nestlé", "CH0038863350", "NESN", "schweiz konsum dividende"],
  ["Aktie", "Airbus", "NL0000235190", "AIR", "luftfahrt europa"],
  ["Aktie", "SAP", "DE0007164600", "SAP", "deutschland dax software"],
  ["Aktie", "Siemens", "DE0007236101", "SIE", "deutschland dax industrie"],
  ["Aktie", "Siemens Healthineers", "DE000SHL1006", "SHL", "deutschland medizintechnik"],
  ["Aktie", "Allianz", "DE0008404005", "ALV", "deutschland dax versicherung"],
  ["Aktie", "Münchener Rück", "DE0008430026", "MUV2", "deutschland dax versicherung"],
  ["Aktie", "Deutsche Telekom", "DE0005557508", "DTE", "deutschland dax telekom"],
  ["Aktie", "Mercedes-Benz Group", "DE0007100000", "MBG", "deutschland dax auto"],
  ["Aktie", "BMW", "DE0005190003", "BMW", "deutschland dax auto"],
  ["Aktie", "Volkswagen Vz.", "DE0007664039", "VOW3", "deutschland dax auto"],
  ["Aktie", "Porsche AG Vz.", "DE000PAG9113", "P911", "deutschland auto"],
  ["Aktie", "Daimler Truck", "DE000DTR0CK8", "DTG", "deutschland dax lkw"],
  ["Aktie", "BASF", "DE000BASF111", "BAS", "deutschland dax chemie"],
  ["Aktie", "Bayer", "DE000BAY0017", "BAYN", "deutschland dax pharma"],
  ["Aktie", "Infineon", "DE0006231004", "IFX", "deutschland dax halbleiter"],
  ["Aktie", "Rheinmetall", "DE0007030009", "RHM", "deutschland dax rüstung"],
  ["Aktie", "Deutsche Bank", "DE0005140008", "DBK", "deutschland dax bank"],
  ["Aktie", "adidas", "DE000A1EWWW0", "ADS", "deutschland dax sport"],
  ["Aktie", "Carl Zeiss Meditec", "DE0005313704", "AFX", "deutschland medizintechnik"],
  ["Fonds", "Fundsmith Equity Fund T EUR Acc", "LU0690375182", "", "aktienfonds welt qualität"],
  ["Fonds", "Flossbach von Storch Multiple Opportunities R", "LU0323578657", "", "mischfonds"],
  ["Fonds", "DWS Top Dividende LD", "DE0009848119", "", "dividende aktienfonds"],
  ["Fonds", "DWS Vermögensbildungsfonds I LD", "DE0008476524", "", "aktienfonds welt"],
  ["Fonds", "ACATIS Gané Value Event Fonds A", "DE000A0X7541", "", "mischfonds value"],
  ["Fonds", "Carmignac Patrimoine A EUR Acc", "FR0010135103", "", "mischfonds"],
  ["Fonds", "Deka-DividendenStrategie CF", "DE000DK2CDS0", "", "dividende aktienfonds"],
  ["Fonds", "UniGlobal", "DE0008491051", "", "aktienfonds welt union"],
  ["Fonds", "Templeton Growth (Euro) Fund A (acc)", "LU0114760746", "", "aktienfonds welt"],
  ["Fonds", "Comgest Growth Europe EUR Acc", "IE0004766675", "", "aktienfonds europa"],
  ["Fonds", "DJE – Dividende & Substanz P", "LU0159550150", "", "dividende aktienfonds"]
].map(([type, name, isin, ticker, kw]) => ({ type, name, isin, ticker, kw }));

export const POPULAR = {
  ETF: ["IE00B4L5Y983", "IE00BK5BQT80", "IE00B5BMR087", "IE00BKM4GZ66", "IE00B53SZB19", "DE0005933931"],
  Aktie: ["DE0007164600", "US0378331005", "US5949181045", "DE0008404005", "US67066G1040", "DE0007236101"],
  Fonds: ["LU0690375182", "LU0323578657", "DE0009848119", "DE0008476524"],
  ETC: ["DE000A0S9GB0", "IE00B4ND3602"]
};

export function norm(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " ");
}

export function searchCatalog(text, type = "Alle", limit = 8) {
  const t = norm(text).trim();
  const pool = CATALOG.filter(c => type === "Alle" || c.type === type);
  if (!t) {
    const keys = type === "Alle" ? ["ETF", "Aktie", "Fonds"] : [type];
    return keys.flatMap(k => (POPULAR[k] || []).map(i => CATALOG.find(c => c.isin === i)).filter(Boolean)
      .slice(0, type === "Alle" ? 3 : 8));
  }
  const words = t.split(/\s+/);
  return pool.map(c => {
    const hay = norm(`${c.name} ${c.isin} ${c.ticker} ${c.kw}`); let s = 0;
    for (const w of words) {
      if (!hay.includes(w)) return null;
      if (norm(c.name).startsWith(w)) s += 3;
      if (norm(c.ticker) === w || norm(c.isin) === w) s += 6;
      if (norm(c.name).includes(w)) s += 1;
    }
    return { c, s };
  }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.c);
}

export const isIsin = s => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(String(s || "").trim().toUpperCase());
