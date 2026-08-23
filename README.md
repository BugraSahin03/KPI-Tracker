# Pace – KPI Tracker

Pace ist eine mobile-first PWA zum schnellen Erfassen und Auswerten täglicher Sport- und Gesundheitsziele. Die Web-App kann auf dem iPhone-Homescreen installiert werden; im Normalmodus ist die SQLite-Datenbank auf dem Pace-Server die zentrale Datenquelle.

## Funktionen

- Dashboard mit den Standardzielen **120 g Protein** und **2,0 L Wasser**
- One-Tap-Status „Erfüllt“, „Nicht geschafft“ und Zurücksetzen
- Tagesnavigation zum Nachtragen und Korrigieren
- Eigene Ziele anlegen, bearbeiten, pausieren und löschen
- Kalender als ISO-Woche, Monat und Jahres-Heatmap
- Insights für Woche, Monat und Jahr: Quote, aktuelle/beste Serie und Zielquoten
- Körperwerte für Gewicht und manuell gepflegte Muskelmasse
- GYM-Tracker mit frei pflegbaren Einheiten, Wiederholungsranges, satzgenauen Gewichten und Trainingshistorie
- Profilbezogene Übungsbibliothek für templateübergreifenden Fortschritt; gleichnamige Übungen bleiben zunächst getrennt und können ausschließlich nach ausdrücklicher Bestätigung verbunden werden
- Push, Pull und Beine starten bei einer frischen Datenbank bewusst als leere Vorlagen, damit keine unpassenden Gewichte vorgegeben werden
- Vor dem Abschluss lassen sich Gewicht und Wiederholungen je Satz anpassen; historische Sessions bleiben erhalten und liefern die Gewichte für das nächste Training
- Automatischer Import von Gewicht und Körperfett über Google Health API v4 (vorbereitet, standardmäßig ausgeschaltet)
- Serverseitige SQLite-Datenbank mit Revisionen und sicheren Migrationen
- Installierbare PWA; aktuell bewusst kein Offline-Datensync
- Sicherer Demo-Modus mit realistischen Beispieldaten unter `/?demo=1`
- Responsive Oberfläche, Touch-Targets, Safe Areas und Reduced-Motion-Unterstützung
- Zwei strikt getrennte Profile **Bugra** und **Sena** mit schnellem Umschalter; das zuletzt gewählte Profil bleibt pro Gerät gespeichert

## Entwicklung

Voraussetzungen: Node.js 22 oder neuer und npm.

```bash
npm install
npm run dev
```

`npm run dev` startet API/SQLite auf Port 4173 und Vite auf Port 5173. Die Entwicklungsdatenbank liegt standardmäßig unter `data/pace.sqlite`.

Qualitätschecks:

```bash
npm run lint
npm test
npm run build
```

Der Produktions-Build liegt anschließend in `dist/`, das eigenständig ausführbare Serverartefakt in `dist-server/`. Mit `npm start` startet ausschließlich das kompilierte JavaScript; TypeScript, `tsx` und andere Entwicklungsabhängigkeiten werden in Produktion nicht benötigt.

## Architektur

- `src/types.ts` – persistiertes, versioniertes Datenmodell
- `src/lib/storage.ts` – Datenvalidierung, lokale Altformate und Statusupdates
- `src/lib/api.ts` – Same-Origin-Client für idempotente Einzelmutationen
- `src/lib/stats.ts` – Tagesstatus, Quoten und Serien
- `src/lib/date.ts` – deutsche Datumsdarstellung und ISO-Zeiträume
- `src/App.tsx` – Views, Serverzustände und Interaktionen
- `src/GymView.tsx` – GYM-Vorlagen, aktive Session und Verlauf
- `src/App.css` – responsives Designsystem und Komponentenstile
- `server/app.ts` – HTTP-API und statische Auslieferung
- `server/db.ts` – SQLite-Zugriff, atomare Einzelmutationen, Receipts und Deduplizierung
- `server/google-health.ts` – OAuth, Token-Erneuerung und 15-Minuten-Polling
- `server/migrations/` – versioniertes Datenbankschema

Die Übungsbibliothek bietet bewusst kein nachträgliches „Trennen“ einer bereits verbundenen Übung an: Ein solches Trennen müsste festlegen, welcher Teil der gemeinsamen Historie rückwirkend zu welcher neuen Identität gehört. Neue namensgleiche Übungen können beim Anlegen weiterhin ausdrücklich getrennt erstellt werden; ein späteres Unlinking folgt erst mit einem eigenen, historisch eindeutigen Workflow.

## Bestehende Browserdaten

Beim ersten Start im Servermodus erkennt Pace vorhandene `localStorage`-Daten und fragt ausdrücklich nach einer Übernahme. Der Import wird nur ausgeführt, wenn die Serverdatenbank noch unverändert ist. Vorhandene Serverdaten werden niemals überschrieben. Die ursprünglichen Browserdaten bleiben erhalten; bei erfolgreichem Import legt Pace zusätzlich eine datierte Backup-Kopie im Browser ab.

Ein vorhandener Altbestand wird ausschließlich Bugra zugeordnet. Der lokale Einmalimport ersetzt ebenfalls nur Bugras unveränderten Startbestand; Senas Daten werden dabei nie berührt. Der Demo-Modus unter `/?demo=1` bleibt vollständig lokal, führt für beide Profile getrennte flüchtige Daten und schreibt weder produktive Browser-Queues noch Serverdaten.

## Google Health / Fitbit

Pace verwendet ausschließlich die neue Google Health API v4, nicht die auslaufende Fitbit Web API. Die Integration ist vorläufig über `PACE_GOOGLE_HEALTH_ENABLED=false` vollständig ausgeschaltet: Es gibt dann keine OAuth-Routen, kein Polling und keine Google-Health-Oberfläche. Gewicht und Muskelmasse bleiben manuell nutzbar. Vor einer späteren Aktivierung muss OAuth einschließlich Tokens, Cursor und importierten Messpunkten explizit einem Profil zugeordnet werden; die derzeitige vorbereitete Integration ist bewusst auf Bugra begrenzt und darf nicht als globale Synchronisierung aktiviert werden. Alle Zugangstokens liegen bei späterer Aktivierung verschlüsselt in SQLite und werden nie an den Browser ausgeliefert.

1. In Google Cloud die Google Health API aktivieren und einen OAuth-Webclient erstellen.
2. Als Redirect-URI `https://DEINE-PACE-URL/api/integrations/google-health/callback` eintragen.
3. `.env.example` nach `/etc/pace/pace.env` übertragen und Client-ID, Client-Secret, öffentliche Origin sowie einen 32-Byte-Base64-Schlüssel setzen.
4. `PACE_GOOGLE_HEALTH_ENABLED=true` setzen, Pace neu starten und unter **Körper → Google Health → Verbinden** autorisieren.

Der Server fragt alle 15 Minuten die v4-Datentypen `weight` und `body-fat` ab. Historische Zeiträume werden entsprechend der Google-Vorgabe lückenlos in maximal 90 Tage große Fenster mit Unter- und Obergrenze zerlegt und vollständig paginiert. Ein konfigurierbarer siebentägiger Rückblick fängt verspätete RENPHO-/Fitbit-Uploads ab; persistierte externe Datenpunkt-IDs verhindern dabei Duplikate. Fettfreie Masse wird nur berechnet, wenn Gewicht und Körperfett derselben Messung vorliegen. BMI wird nur berechnet, wenn `PACE_HEIGHT_CM` korrekt gesetzt ist. Muskelmasse bleibt ein eigener manueller Wert.

Manuelle Muskelmasse und Google-Werte bilden einen gemeinsamen Messdatensatz: Ein manueller Tagesdatensatz ohne Uhrzeit wird durch die erste passende Google-Messung dieses Tages ergänzt; umgekehrt ergänzt eine manuelle Eingabe den ausgewählten Google-Datensatz. Pace erfindet keine Messzeit. Bei mehreren Waagenmessungen an einem Tag wird nur die konkret ausgewählte Messung bearbeitet oder gelöscht. Gelöschte Google-Datenpunkte werden als Tombstone behalten, damit der nächste Rückblick sie nicht ungewollt wiederherstellt.

Google-OAuth-Projekte im externen **Testmodus** können Refresh-Tokens nach sieben Tagen ungültig machen. Für dauerhaften Betrieb muss das Projekt passend als persönliche/produktive Anwendung konfiguriert und die jeweils erforderliche Google-Freigabe beachtet werden.

## Hetzner / systemd

Die verbindliche Installations-, Backup-, Restore- und Rollback-Anleitung steht in [`docs/production.md`](docs/production.md). Sie enthält auch die Tailscale-ACL, Funnel-Kontrolle, öffentliche Negativtests sowie Log- und Plattenchecks. Das Installationsskript `scripts/deploy/install-production-service.sh` richtet Dienst und täglichen Backup-Timer reproduzierbar ein; es erzeugt oder druckt keine Secrets und kopiert niemals eine lokale Entwicklungsdatenbank.

Die Vorlage `deploy/pace.service` betreibt Pace analog zu den anderen privaten Apps als einzelnen Dienst. Empfohlene Verzeichnisse:

```text
/opt/pace/releases/<id>  unveränderliche Releases
/opt/pace/current        atomarer Symlink auf das aktive Release
/var/lib/pace            SQLite-Datenbank (beschreibbar)
/etc/pace/pace.env       Secrets, Modus 600
```

Nach `npm ci` und `npm run build`:

```bash
sudo cp deploy/pace.service /etc/systemd/system/pace.service
sudo systemctl daemon-reload
sudo systemctl enable --now pace
```

Der Prozess bindet standardmäßig nur an `127.0.0.1:4173`. Die App kann über Tailscale Serve oder einen privaten Reverse Proxy veröffentlicht werden. Das Google-Polling ist ausschließlich ausgehend; ein öffentlicher Webhook-Endpunkt ist nicht nötig. Die SQLite-Datei einschließlich WAL sollte regelmäßig bei gestopptem Dienst oder über die SQLite-Backup-API gesichert werden.

`PACE_TIME_ZONE` legt den verbindlichen Kalendertag für serverseitige Prüfungen fest und muss eine gültige IANA-Zeitzone sein. Der Standard ist `Europe/Berlin`. Dadurch akzeptiert ein in Deutschland direkt nach Mitternacht abgeschlossenes Training auch dann den neuen Tag, wenn der Hetzner-Prozess intern noch im UTC-Vortag läuft.

### Verbindliches Zugriffs- und Profilmodell

Pace besitzt bewusst keine eigene Anmeldung. Bugra und Sena sind Datenprofile, keine Sicherheitskonten: Jede Person, die Pace öffnen kann, kann beide Profile auswählen und bearbeiten. Für Produktion gilt deshalb: Der Node-Port bleibt an `127.0.0.1` gebunden, Pace wird ausschließlich über Tailscale Serve veröffentlicht und die Tailnet-ACL erlaubt nur den ausdrücklich vorgesehenen Personen Zugriff.

In Produktion muss `PACE_ALLOWED_TAILSCALE_USERS` mit Bugras und Senas kommagetrennten Tailscale-Logins gesetzt werden. Pace akzeptiert API-Aufrufe nur, wenn der von Tailscale Serve gesetzte Header `Tailscale-User-Login` in dieser Allowlist steht. `/api/health` bleibt für den lokalen systemd-Check absichtlich ohne Header und kann auch über den privaten Serve-Pfad sichtbar sein; er enthält keine persönlichen Daten. Dieser Header darf nur hinter dem vertrauenswürdigen Tailscale-Proxy ausgewertet werden. Schreibzugriffe erfordern außerdem dieselbe Origin. Ohne Allowlist ist nur die lokale Entwicklung zulässig; `NODE_ENV=production` startet dann absichtlich nicht.

UI-Änderungen werden als granulare Mutation mit stabiler Idempotency-ID gesendet. Der Server speichert ein Receipt in derselben SQLite-Transaktion. Falls die Antwort verloren geht, kann dieselbe Mutation gefahrlos erneut gesendet werden. Google-Polling und UI-Schreibvorgänge ersetzen damit niemals gegenseitig vollständige Datenstände.

Die Architektur ist bewusst ein modularer Monolith: ein Serverprozess und eine SQLite-Datei. Alle persönlichen Root-Datensätze (`goals`, Körperwerte, GYM-Vorlagen und Sessions) tragen eine `profile_id`; abhängige Einträge und Übungen sind über profilgebundene Fremdschlüssel isoliert. Mutationsreceipts und die Browser-Warteschlange sind ebenfalls profilbezogen. PostgreSQL, echte Benutzerkonten und Offline-Synchronisation bleiben spätere, migrierbare Erweiterungen.
