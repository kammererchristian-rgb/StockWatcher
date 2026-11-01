# StockWatcher – Nachkauf-Radar für Home Assistant

Home-Assistant-Add-on: Watchlist für ETFs, Aktien und Fonds. Meldet außergewöhnliche Kursverluste als Hinweis für einen
möglichen Nachkauf, zeigt Verlauf und Wertentwicklung über 1 Monat, 1 Jahr, 5 und 10 Jahre und schickt
Push-Nachrichten über die Home-Assistant-App.

Kurse kommen aus zwei Quellen mit Gegenprüfung: EODHD (offizielle API, optional mit eigenem Schlüssel) und
Yahoo Finance. Alles läuft lokal auf deinem Home Assistant.

## Installation

1. **Einstellungen → Add-ons → Add-on-Store**, oben rechts **⋮ → Repositories**.
2. Diese Adresse hinzufügen:
   ```
   https://github.com/kammererchristian-rgb/StockWatcher
   ```
3. Store neu laden (⋮ → **Nach Updates suchen**), **Nachkauf-Radar** öffnen und **Installieren**.
4. **Starten** und **In Seitenleiste anzeigen** einschalten.
5. Optional unter **Konfiguration** den EODHD-API-Schlüssel eintragen.

**Updates:** Neue Versionen erscheinen im Add-on als **Aktualisieren**. Watchlist und Einstellungen bleiben erhalten.

**Umstieg vom lokal installierten Add-on:** Das neue Add-on installieren und starten, solange das alte noch läuft.
In der App unter **Sichern und übernehmen → Vom lokalen Add-on übernehmen** tippen. Danach das alte Add-on
(„Lokale Add-ons“) deinstallieren.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `nachkauf_radar/` | Das Add-on (Konfiguration, Dockerfile, Dokumentation) |
| `nachkauf_radar/app/server.js` | Dienst: Kursabruf, Speicher, tägliche Prüfung, Home-Assistant-Anbindung |
| `nachkauf_radar/app/yfetch.py` | Helfer für Yahoo-Abrufe mit Chrome-Verbindungssignatur |
| `nachkauf_radar/app/public/` | Oberfläche (Watchlist, Charts, Einstellungen) und Signal-Logik |
| `tools/install.sh` | Installation ohne Repository (ZIP über Samba) |

## Lokal entwickeln

```sh
cd nachkauf_radar/app
npm run dev        # Testmodus mit simulierten Kursen, http://localhost:8099
```

Bedienung, Signal-Logik, Kursquellen und Sensor: siehe [`nachkauf_radar/DOCS.md`](nachkauf_radar/DOCS.md).

Die Signale sind eine rechnerische Auswertung von Kursen und keine Anlageberatung.
