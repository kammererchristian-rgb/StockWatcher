# Nachkauf-Radar

Watchlist für ETFs, Aktien, Fonds und ETCs. Das Add-on lädt Kurshistorien selbst, wertet sie täglich aus
und meldet außergewöhnliche Kursverluste als Hinweis für einen möglichen Nachkauf.

## Bedienung

Das Add-on erscheint in der Seitenleiste als **Nachkauf-Radar**, auch in der Home-Assistant-App auf dem Handy.

- **Suchen:** Name, ISIN oder Kürzel eintippen. Oben erscheinen Vorschläge aus dem eingebauten Katalog,
  darunter Treffer der Live-Suche mit Börsenplatz. Mit den Filtern ETFs, Aktien, Fonds oder ETCs eingrenzen.
- **Hinzufügen:** Vorschlag antippen. Die Kurshistorie der letzten zehn Jahre wird sofort geladen.
  Bei Katalogeinträgen wird automatisch der Xetra-Handelsplatz bevorzugt.
- **Details:** Eintrag in der Watchlist antippen: Chart mit 200-Tage-Linie und 52-Wochen-Hoch,
  Kennzahlen und die Begründung des Signals.
- **Verlauf und Wertentwicklung:** Über „Entwicklung 1 M · 1 J · 5 J · 10 J“ in der Watchlist bzw. die Kacheln in der
  Detailansicht den Zeitraum wählen. Die Watchlist zeigt dann die Veränderung und den Mini-Chart für diesen Zeitraum,
  die Detailansicht den Chart. Bei 5 und 10 Jahren steht zusätzlich die durchschnittliche Entwicklung pro Jahr (p. a.).
  Gerechnet wird mit dividendenbereinigten Kursen, bei ausschüttenden ETFs ist die Ausschüttung also enthalten.
  Ein Sternchen bedeutet: Die Kurshistorie ist kürzer als der Zeitraum, der Wert gilt seit Beginn der Historie.
- **Ohne Kursquelle:** Findet die Suche ein Wertpapier nicht, über „ohne Kursquelle anlegen“ hinzufügen
  und die Kurse als CSV einfügen (Datum;Schluss).

## Signale

| Prüfung | Standard | Punkte |
|---|---|---|
| Tagesverlust im Verhältnis zur üblichen Tagesschwankung (60 Tage) | ab 2-fach | 2 |
| Verlust über 5 Handelstage im Verhältnis zur üblichen Schwankung | ab 2-fach | 2 |
| Rücksetzer vom 52-Wochen-Hoch | über 10 % | 2 |
| Rücksetzer vom 52-Wochen-Hoch, Stufe 2 | über 20 % | +1 |
| RSI 14 überverkauft | unter 30 | 1 |
| Abstand unter der 200-Tage-Linie | über 5 % | 1 |

Ab 4 Punkten: **Nachkauf prüfen**, ab 2 Punkten: **Beobachten**. Alle Schwellen sind in der App einstellbar.
Gerechnet wird mit dividendenbereinigten Schlusskursen, damit Ausschüttungstage keine Fehlalarme auslösen.

## Benachrichtigung

Unter **Benachrichtigung aufs Handy** das Gerät wählen, Uhrzeit festlegen, speichern und eine Testnachricht senden.
Handys erscheinen dort, sobald die Home-Assistant-App auf ihnen eingerichtet und angemeldet ist. Fehlt ein Gerät,
lässt sich der Dienstname (z. B. `mobile_app_pixel_8`, zu finden unter Entwicklerwerkzeuge → Aktionen → „notify.“)
von Hand eintragen. Zeigt die Liste einen Fehler, hilft **Datenquellen testen**: Der Abschnitt `home_assistant`
zeigt, ob das Add-on Home Assistant erreicht und welche Geräte es findet.

Die Prüfung läuft einmal täglich ab der eingestellten Uhrzeit (Standard 18:00, werktags). Gemeldet wird,
wenn ein Wert die gewählte Stufe neu erreicht oder an einem neuen Handelstag einen außergewöhnlichen
Tagesverlust hat. Ein Tipp auf die Nachricht öffnet das Radar.

## Dashboard

**Volle Ansicht als Karte:** Das Add-on bringt die Karte `custom:nachkauf-radar-card` mit und meldet sie beim Start als
Dashboard-Ressource an. Im Dashboard **Bearbeiten → Karte hinzufügen → Manuell**:

```yaml
type: custom:nachkauf-radar-card
height: 760
```

Die Karte zeigt die gleiche Oberfläche wie die Seitenleiste. Dafür braucht das angemeldete Konto Admin-Rechte
(wie für die Seitenleiste auch). Für andere Konten, etwa ein Wandtablet, zeigt sie automatisch eine kompakte
Watchlist aus den Sensoren. Die kompakte Ansicht lässt sich auch fest wählen:

```yaml
type: custom:nachkauf-radar-card
mode: compact
range: veraenderung_1_jahr   # oder veraenderung_1_monat, veraenderung_5_jahre, veraenderung_10_jahre
```

Zeigt die Karte „Konfigurationsfehler“: Home Assistant einmal neu starten (Einstellungen → System → Neu starten)
und die Seite bzw. App neu laden. Home Assistant liefert Dateien aus dem Ordner `www` erst aus, wenn der Ordner beim
Start schon existierte; das Add-on legt ihn beim ersten Mal an. Die Karte gehört in **Karte hinzufügen**, nicht in
**Badge hinzufügen**.

Klappt die automatische Anmeldung nicht (z. B. bei Dashboards im YAML-Modus), unter **Einstellungen → Dashboards
→ ⋮ → Ressourcen** `/local/nachkauf-radar/nachkauf-radar-card.js` als JavaScript-Modul eintragen.

**Badges und Sensoren:** In der App unter **Im Dashboard anzeigen** steht fertiges YAML für Badges und Karten.

| Sensor | Zustand | Attribute |
|---|---|---|
| `sensor.nachkauf_radar_signale` | Anzahl „Nachkauf prüfen“ | `nachkauf_pruefen`, `beobachten` (Namen), `anzahl_beobachten`, `letzte_pruefung`, `panel` |
| `sensor.nachkauf_radar_<isin>` | Schlusskurs | `signal`, `stufe`, `punkte`, `veraenderung_1_tag`, `veraenderung_1_monat`, `veraenderung_1_jahr`, `veraenderung_5_jahre`, `veraenderung_10_jahre`, `vom_52w_hoch`, `rsi_14` |

Die Sensoren werden alle 10 Minuten neu gesetzt; nach einem Neustart von Home Assistant sind sie also spätestens
nach 10 Minuten wieder da.

## Daten

Watchlist, Einstellungen und Kurse liegen im Add-on-Speicher (`/data`) und sind Teil der Home-Assistant-Sicherung.

Unter **Sichern und übernehmen** lässt sich die Watchlist als Text sichern und wiederherstellen. Beim Umstieg vom
lokal installierten Add-on übernimmt „Vom lokalen Add-on übernehmen“ Watchlist, Schwellen und Benachrichtigung
direkt, solange das alte Add-on noch läuft.

## Kursquellen und Gegenprüfung

Das Add-on nutzt zwei Quellen:

| Quelle | Rolle | Voraussetzung |
|---|---|---|
| **EODHD** (eodhd.com) | Hauptquelle, lizenzierte Börsendaten über eine offizielle API | API-Schlüssel in der Konfiguration |
| **Yahoo Finance** | Gegenprüfung und Ersatz bei Ausfall; ohne EODHD-Schlüssel alleinige Quelle | keine |

**Einrichten:** Auf eodhd.com ein Konto anlegen (Gratis-Tarif: 20 Abrufe pro Tag, 1 Jahr Historie; der
Tarif „EOD Historical“ für Privatnutzer hat 100.000 Abrufe und über 30 Jahre Historie). Den API-Schlüssel unter
**Einstellungen → Add-ons → Nachkauf-Radar → Konfiguration** eintragen und das Add-on neu starten.

**Historie:** Das Add-on lädt 10 Jahre Tageskurse. Danach holt es bei jeder Aktualisierung nur die letzten
3 Monate nach und lädt die lange Historie einmal pro Woche neu. Mit dem EODHD-Gratistarif (1 Jahr Historie)
ergänzt es die älteren Jahre aus Yahoo Finance und gleicht sie am Übergang an.

**So läuft der Abruf:**
- Bei der täglichen Prüfung, beim Hinzufügen und über „Kurse aktualisieren“ fragt das Add-on beide Quellen ab.
  Jeder Wert kostet dabei einen EODHD-Abruf (beim Hinzufügen gelegentlich einen zweiten für die Suche).
  Mit dem Gratis-Tarif reicht das für etwa 15 Werte.
- Beim bloßen Öffnen der App wird nur Yahoo aktualisiert, um das EODHD-Kontingent zu schonen.
- Ist das Tageslimit erreicht oder EODHD nicht erreichbar, rechnet das Add-on mit Yahoo weiter und zeigt den Grund an.
- Der letzte gemeinsame Schlusskurs beider Quellen wird verglichen. Liegt die Abweichung über dem eingestellten Wert
  (Standard 1,5 %), erscheint „Quellen weichen ab“ in der Watchlist und ein Hinweis in der Push-Nachricht.
  Kleine Abweichungen sind normal, wenn die Quellen verschiedene Börsenplätze nutzen.

Yahoo sperrt Programme, deren Verbindung nicht wie ein Browser aussieht, mit HTTP 429. Das Add-on baut die
Verbindung deshalb mit der Signatur von Chrome auf (Bibliothek curl_cffi). Meldet Yahoo trotzdem 429, pausiert es
30 Minuten und rechnet so lange mit EODHD weiter.

Die Yahoo-Schnittstelle ist inoffiziell und kann sich ohne Ankündigung ändern. Bei Problemen in der App
**Datenquellen testen** öffnen und „Test starten“ tippen; das Ergebnis zeigt für Yahoo und EODHD, ob der Abruf
klappt und wie weit die Historie zurückreicht. Weitere Details zeigt das Log: das Protokoll des Add-ons (Einstellungen → Add-ons → Nachkauf-Radar → Protokoll).

## Hinweis

Die Signale sind eine rechnerische Auswertung von Kursen und keine Anlageberatung.
