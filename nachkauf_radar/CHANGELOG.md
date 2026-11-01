# Changelog

## 1.4.1
- Prüft, ob Home Assistant die Dashboard-Karte unter /local ausliefert. Wurde der Ordner www gerade erst angelegt,
  zeigen App und Protokoll den Hinweis, Home Assistant einmal neu zu starten (sonst „Konfigurationsfehler“ in der Karte).

## 1.4.0
- Dashboard-Karte `custom:nachkauf-radar-card`: zeigt die komplette Ansicht wie in der Seitenleiste
  (für Admin-Konten) oder eine kompakte Watchlist (`mode: compact`, automatisch für Konten ohne Admin-Rechte).
  Das Add-on legt die Karte unter /config/www/nachkauf-radar ab und meldet sie als Dashboard-Ressource an.
- Sensoren: `sensor.nachkauf_radar_signale` plus ein Sensor je Wertpapier mit Kurs, Signal und Wertentwicklung
  (1 Tag, 1 Monat, 1/5/10 Jahre). Werden alle 10 Minuten neu gesetzt und überstehen so Neustarts von Home Assistant.
- Neu in der App: „Im Dashboard anzeigen“ mit fertigem YAML für Karte und Badges.
- Benachrichtigung: Fehler beim Abruf der Geräteliste werden angezeigt (vorher blieb die Liste still leer).
  Unterstützt zusätzlich Benachrichtigungs-Entitäten und einen von Hand eingetragenen Dienstnamen.
- „Datenquellen testen“ prüft auch die Verbindung zu Home Assistant und listet die gefundenen Geräte.
- Neue Option `dashboard_karte` (Standard: an). Das Add-on braucht dafür Schreibzugriff auf den Konfigurationsordner.

## 1.3.0
- Yahoo-Abrufe laufen über einen Helfer mit Chrome-Verbindungssignatur (curl_cffi). Yahoo sperrt Programme mit
  anderer Signatur per HTTP 429; das betraf auch dieses Add-on.
- Nach einem HTTP 429 pausiert das Add-on Yahoo-Abrufe 30 Minuten, damit die Sperre nicht verlängert wird.
- Neu: „Sichern und übernehmen“ – Watchlist vom bisherigen lokalen Add-on übernehmen, Sicherung als Text
  erzeugen und wiederherstellen.
- Installation und Updates über das GitHub-Repository kammererchristian-rgb/StockWatcher.

## 1.2.1
- Yahoo Finance: holt bei Bedarf automatisch Cookie und „Crumb“ (Yahoo lehnt Abrufe sonst teils mit HTTP 401/429 ab).
  Fehlermeldungen enthalten jetzt den HTTP-Status und den Anfang der Antwort.
- Einträge, die nur mit ISIN angelegt wurden, bekommen beim Aktualisieren nachträglich das Yahoo-Kürzel,
  den richtigen Namen und Typ und damit die 10-Jahres-Historie.
- Fällt die Yahoo-Suche aus, sucht die App ISINs bei EODHD.
- Watchlist zeigt bei kurzer Historie direkt „seit MM/JJJJ“ unter dem Wert.
- Detailansicht zeigt pro Quelle, ob der Abruf geklappt hat und ab wann Kurse vorliegen.
- Neu: „Datenquellen testen“ mit kopierbarem Ergebnis.

## 1.2.0
- Wertentwicklung und Verlauf für 1 Monat, 1 Jahr, 5 Jahre und 10 Jahre (bei 5 und 10 Jahren auch pro Jahr, p. a.).
- Zeitraum-Umschalter in der Watchlist (Spalte „Entwicklung“ und Mini-Chart) und als Kacheln in der Detailansicht.
- Kurshistorie auf 10 Jahre erweitert. Nach dem ersten Laden holt das Add-on nur die letzten 3 Monate nach und
  lädt die lange Historie einmal pro Woche neu (wegen rückwirkender Dividendenbereinigung).
- Liefert die Hauptquelle eine kürzere Historie (EODHD-Gratistarif: 1 Jahr), werden ältere Kurse aus der zweiten Quelle
  ergänzt und an die Hauptquelle angeglichen.
- Ist ein Wertpapier jünger als der Zeitraum, zeigt die App die Entwicklung seit Beginn der Historie mit Sternchen.

## 1.1.0
- Zweite Kursquelle: EODHD (lizenzierter Datenhändler, offizielle API) als Hauptquelle, sobald ein API-Schlüssel
  in der Konfiguration steht. Yahoo Finance prüft gegen und springt bei Ausfall oder erreichtem Tageslimit ein.
- Plausibilitätsprüfung: Weichen die Schlusskurse beider Quellen um mehr als 1,5 % ab, erscheint eine Warnung in der App
  und ein Hinweis in der Push-Nachricht.
- Abrufzähler für EODHD mit einstellbarem Tageslimit (Gratis-Tarif: 20 Abrufe).
- Detailansicht zeigt Quelle und Ergebnis der Gegenprüfung.

## 1.0.0
- Erste Version: Watchlist mit Live-Suche, Kurshistorie über Yahoo Finance, Nachkauf-Signale,
  tägliche Prüfung mit Push-Benachrichtigung über Home Assistant, Sensor `sensor.nachkauf_radar_signale`.
