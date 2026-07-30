# Pace – KPI Tracker

Pace ist eine mobile-first PWA zum schnellen Erfassen und Auswerten täglicher Sport- und Gesundheitsziele. Die Anwendung funktioniert vollständig lokal und kann über den Browser auf dem Homescreen installiert werden.

## Funktionen

- Dashboard mit den Standardzielen **120 g Protein** und **2,0 L Wasser**
- One-Tap-Status „Erfüllt“, „Nicht geschafft“ und Zurücksetzen
- Tagesnavigation zum Nachtragen und Korrigieren
- Eigene Ziele anlegen, bearbeiten, pausieren und löschen
- Kalender als ISO-Woche, Monat und Jahres-Heatmap
- Insights für Woche, Monat und Jahr: Quote, aktuelle/beste Serie und Zielquoten
- Körperwerte für Gewicht und Muskelmasse
- Versionierte lokale Speicherung im Browser (`localStorage`)
- Installierbare PWA mit Offline-Cache
- Responsive Oberfläche, Touch-Targets, Safe Areas und Reduced-Motion-Unterstützung

## Entwicklung

Voraussetzungen: Node.js 20 oder neuer und npm.

```bash
npm install
npm run dev
```

Qualitätschecks:

```bash
npm run lint
npm test
npm run build
```

Der Produktions-Build liegt anschließend in `dist/`.

## Architektur

- `src/types.ts` – persistiertes, versioniertes Datenmodell
- `src/lib/storage.ts` – Defaults, Laden/Speichern und Statusupdates
- `src/lib/stats.ts` – Tagesstatus, Quoten und Serien
- `src/lib/date.ts` – deutsche Datumsdarstellung und ISO-Zeiträume
- `src/App.tsx` – Views und Interaktionen des MVP
- `src/App.css` – responsives Designsystem und Komponentenstile

Die Daten bleiben derzeit ausschließlich auf dem jeweiligen Gerät. Cloud-Synchronisation, Benutzerkonten und automatischer Renpho-Import sind bewusst nicht Teil des MVP; das getrennte Datenmodell hält diese Erweiterungen offen.
