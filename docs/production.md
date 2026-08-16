# Pace auf Hetzner betreiben

Pace ist ein privater Tailscale-Dienst. Die beiden auswählbaren Datenprofile Bugra und Sena sind **keine Sicherheitskonten**: Beide erlaubten Personen können beide Profile sehen und bearbeiten. Die Sicherheitsgrenze ist Tailscale plus die serverseitige Login-Allowlist.

## Voraussetzungen und Erstinstallation

- Ubuntu/Debian-Server im Tailnet, Node.js >= 22 und npm unter `/usr/bin`
- Tailscale Serve; **kein** öffentlicher Reverse Proxy und kein offener Port 4173
- Release ohne `node_modules`, `data`, `.env`, `.git` oder AppleDouble-Dateien (`._*`)

Beim ersten Bootstrap zuerst das noch leere Release-Root mit sicheren Rechten anlegen:

```bash
sudo getent group pace >/dev/null || sudo groupadd --system pace
sudo install -d -o root -g pace -m 0750 /opt/pace /opt/pace/releases
sudo install -d -o root -g pace -m 0750 /opt/pace/releases/20260808T170000Z
```

Jedes Release bekommt vor der Aktivierung ein eigenes Verzeichnis. Eine eindeutige ID festlegen (z. B. Git-SHA oder UTC-Zeit) und nach `/opt/pace/releases/<release-id>` übertragen:

```bash
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude data --exclude .env --exclude '._*' \
  ./ root@SERVER:/opt/pace/releases/20260808T170000Z/
```

`--delete` ist nur für das neue, noch nicht aktive und exakt ausgeschriebene Releaseziel vorgesehen; niemals für `/opt/pace/current`, `/opt`, `/var/lib` oder ein unvalidiertes variables Ziel. `/opt/pace/current` wird ausschließlich vom Installer als atomar getauschter Symlink verwaltet. Auf dem Server `/etc/pace/pace.env` aus `.env.example` manuell erzeugen (Owner `root:pace`, Modus `0600`). Erforderlich sind insbesondere:

```dotenv
HOST=127.0.0.1
PORT=4173
PACE_DATABASE_PATH=/var/lib/pace/pace.sqlite
PACE_PUBLIC_ORIGIN=https://pace.DEIN-TAILNET.ts.net
PACE_TIME_ZONE=Europe/Berlin
PACE_ALLOWED_TAILSCALE_USERS=bugra@BEISPIEL,sena@BEISPIEL
PACE_GOOGLE_HEALTH_ENABLED=false
PACE_BACKUP_DIR=/var/backups/pace
PACE_BACKUP_RETENTION_DAYS=30
```

Dann:

```bash
sudo bash /opt/pace/releases/20260808T170000Z/scripts/deploy/install-production-service.sh 20260808T170000Z
```

Das Skript akzeptiert nur eine sichere Release-ID und verifiziert den daraus abgeleiteten Kandidatenpfad. Es baut und testet den Kandidaten als `pace`, führt Audit und einen Production-Smoke auf einer temporären DB aus und macht ihn anschließend `root:pace` mit nur lesendem Gruppenzugriff. All das passiert, während das alte Release weiterläuft. Für die Aktivierung stoppt es Timer und Altservice, bestätigt den inaktiven Prozess und erstellt **erst dann** den finalen Rollback-Snapshot unter `/var/backups/pace/releases/<neue-id>/`. So enthält das Rollback-Paar auch den letzten bestätigten Schreibzugriff. Erst anschließend installiert es Units und tauscht `current` atomar. Bei Fehler oder INT/TERM stellt die State Machine DB/WAL/SHM, Units, Symlink sowie vorherige enable/active-Zustände wieder her. SIGKILL kann kein Prozess abfangen; in diesem Fall anhand des Release-Backupverzeichnisses mit dem Restore-Skript recovern. Bei einer fehlgeschlagenen Erstinstallation ohne Vorgänger werden Kandidaten-Units/current entfernt und der Dienst bleibt gestoppt. Eine lokale `data/pace.sqlite` wird nie kopiert.

## Tailscale-only veröffentlichen

```bash
sudo tailscale serve --service=svc:pace --https=443 --yes 127.0.0.1:4173
tailscale serve status
tailscale funnel status
sudo ss -ltnp | grep 4173
```

Der benannte Dienst muss bei der ersten Einrichtung im Tailscale-Adminbereich als `svc:pace` genehmigt und per Grant nur für die vorgesehenen Identitäten freigegeben werden. Für die erste Pace-Version ist das ausschließlich Bugras Tailscale-Login; Sena wird erst nach ihrem eigenen Tailnet-Zugang ergänzt. Der erwartete Dienstname ist `pace.taild1a8ca.ts.net` und darf keine bestehende Host- oder Service-Konfiguration überschreiben.

`funnel status` darf keinen aktiven Funnel zeigen; `ss` muss für Pace ausschließlich `127.0.0.1:4173` (oder explizit `::1`) zeigen. Die Tailnet-ACL muss nur Bugras und Senas Tailscale-Identitäten Zugriff auf den Hetzner-Host/Serve-Port geben. Danach positiv aus dem Tailnet und negativ von einem Gerät außerhalb des Tailnets testen. Ein öffentlicher DNS-/Portscan darf weder 4173 noch eine Funnel-URL erreichen.

Die Header-Allowlist ist eine zweite Schranke hinter Tailscale Serve. Direkte Requests an Node könnten den Header fälschen, sind aber wegen Loopback-Bindung und Firewall nicht extern möglich. `/api/health` ist für den lokalen systemd-Check absichtlich ohne Header; über den privaten Tailscale-Serve-Pfad kann er ebenfalls sichtbar sein, liefert aber ausschließlich `status`, `sqliteReady` und `schemaVersion` und keine persönlichen Daten. Funnel bleibt trotzdem aus.

`PACE_PUBLIC_ORIGIN` ist exakt die HTTPS-Origin ohne Zugangsdaten, Pfad, Query oder Hash. In Produktion weist Pace jeden schreibenden API-Request ohne `Origin` sowie jede abweichende Origin mit 403 zurück. Damit müssen Tailscale Serve und die im Browser sichtbare URL genau zu diesem Wert passen.

## Backups

`pace-backup.timer` startet täglich gegen 02:30 Uhr (Europe/Berlin, persistent) `scripts/backup/create-backup.mjs`. Das Skript benutzt die SQLite Online Backup API, prüft `PRAGMA integrity_check`, finalisiert atomar, setzt Datei und Verzeichnis auf 0600/0700 und löscht ausschließlich eindeutig benannte, abgelaufene `pace-*.sqlite`-Backups.

```bash
systemctl list-timers pace-backup.timer
sudo systemctl start pace-backup.service
sudo journalctl -u pace-backup.service -n 100 --no-pager
sudo -u pace PACE_DATABASE_PATH=/var/lib/pace/pace.sqlite PACE_BACKUP_DIR=/var/backups/pace node /opt/pace/current/scripts/backup/create-backup.mjs
```

Backups müssen zusätzlich verschlüsselt off-host kopiert und Restore-Tests regelmäßig durchgeführt werden.

## Restore

Restore nicht mit manuellen Copy-Kommandos durchführen, sondern mit dem versionierten, flock-geschützten Skript. Es validiert Pfad/Dateiname und Schema vor dem Stop, beweist anschließend den inaktiven Dienst und erzeugt zuerst über die SQLite Backup API einen separat verifizierten Safety-Snapshot, der auch zuvor im WAL bestätigte Schreibvorgänge enthält. Erst danach archiviert es die Live-Dateien DB/WAL/SHM, installiert 0600 als `pace`, prüft erneut und startet mit Healthcheck. Bei jedem Fehler oder INT/TERM entfernt beziehungsweise archiviert es den fehlgeschlagenen Live-Satz vollständig und restauriert den Safety-Snapshot als einzelne Main-DB; Units, Symlink und vorherige Dienstzustände werden erst nach Assertions gestartet. Schlägt ein kritischer Rollback-Schritt fehl, bleiben Service und Timer fail-closed gestoppt und deaktiviert.

Nur DB, Code unverändert:

```bash
sudo bash /opt/pace/current/scripts/deploy/restore-production.sh /var/backups/pace/pace-20260808T023000.000Z.sqlite
```

Gepaarter Code-und-DB-Rollback, etwa nach den strukturändernden Migrationen 005 oder 006:

```bash
sudo bash /opt/pace/current/scripts/deploy/restore-production.sh \
  /var/backups/pace/releases/20260808T170000Z/pace-rollback-20260808T170500.000Z.sqlite \
  20260801T120000Z
```

Das optionale zweite Argument ist die bereits vorhandene, validierte Ziel-Release-ID. Das Skript installiert deren Units zusammen mit dem atomaren Code-Symlink. Safety-Sets liegen unter `/var/backups/pace/restores/<timestamp>/` und dürfen erst nach verifiziertem Betrieb und Off-host-Backup kontrolliert entfernt werden.

Notfall nach SIGKILL: Zuerst `systemctl stop pace.service pace-backup.timer` und `systemctl is-active pace.service` prüfen. Danach das Restore-Skript mit dem finalen Snapshot im betroffenen `/var/backups/pace/releases/<id>/` und der im Releaseprotokoll notierten vorigen Code-ID ausführen. Niemals eine möglicherweise migrierte DB mit altem Code starten.

## Release und Rollback

Vor jedem Update müssen das alte Code-Release **und** der nach dem finalen Stop erzeugte Rollback-Snapshot als Paar aufbewahrt werden. Die Migrationen 005 und 006 verändern die DB-Struktur; deshalb niemals nur den Code zurückrollen.

1. Das bisherige Ziel von `/opt/pace/current` und den vom Installer unter `/var/backups/pace/releases/<neue-release-id>/pace-rollback-<zeit>.sqlite` erzeugten Snapshot als Paar im Releaseprotokoll notieren.
2. Neues Release ausschließlich in ein neues `/opt/pace/releases/<release-id>` übertragen und den Installer mit genau dieser ID ausführen.
3. Health, beide Profile und Persistenz nach einem Neustart prüfen. Alte Releases und ihre gepaarten DB-Backups mindestens bis zum nächsten erfolgreich geprüften Release behalten.
4. Rollback ausschließlich mit `restore-production.sh`, dem **zum Ziel-Code-Release gepaarten** Snapshot und der expliziten Ziel-Release-ID ausführen. Das Skript übernimmt DB-Safetyset, Units, atomaren Symlink, Zustände und Health. Die Migrationen 005 und 006 verbieten einen reinen Code-Rollback.

Normale Backup-Retention und Release-Retention sind getrennt: Der tägliche Timer rotiert ausschließlich `pace-<timestamp>.sqlite` direkt im Backup-Root. Inhalte unter `releases/` werden nie automatisch gelöscht und dürfen erst entfernt werden, wenn auch das zugehörige Code-Release aus der Rollback-Aufbewahrung fällt. Off-host-Kopien bleiben verpflichtend.

## Betrieb prüfen

```bash
systemctl status pace.service pace-backup.timer --no-pager
journalctl -u pace.service -n 200 --no-pager
curl --fail http://127.0.0.1:4173/api/health
df -h /var/lib/pace /var/backups/pace
du -sh /var/lib/pace /var/backups/pace
sudo -u pace /usr/bin/node /opt/pace/current/scripts/backup/verify-database.mjs /var/lib/pace/pace.sqlite
```

Erwartet: Health HTTP 200, `sqliteReady:true`, Schema 6, `quick_check=ok`, keine Google-Health-Routen (404) und ausreichend freier Speicher. Fehlerhafte Health-Antworten enthalten keine Profildaten.
