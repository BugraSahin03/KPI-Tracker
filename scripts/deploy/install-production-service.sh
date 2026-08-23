#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

BASE_DIR=/opt/pace
RELEASES_DIR=$BASE_DIR/releases
CURRENT_LINK=$BASE_DIR/current
DATA_DIR=/var/lib/pace
DATABASE_PATH=$DATA_DIR/pace.sqlite
BACKUP_DIR=/var/backups/pace
CONFIG_DIR=/etc/pace
ENV_FILE=$CONFIG_DIR/pace.env
SERVICE_DIR=/etc/systemd/system
HEALTH_URL=http://127.0.0.1:4173/api/health

release_id=${1:-}
if [[ ${EUID} -ne 0 ]]; then
  echo 'Dieses Installationsskript muss als root laufen.' >&2
  exit 1
fi
if [[ ! $release_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]]; then
  echo 'Aufruf: install-production-service.sh <release-id> (nur Buchstaben, Zahlen, Punkt, Unterstrich, Bindestrich).' >&2
  exit 1
fi
exec 9>/run/lock/pace-production.lock
if ! flock -n 9; then
  echo 'Eine andere Pace-Installation läuft bereits.' >&2
  exit 1
fi
candidate=$RELEASES_DIR/$release_id
if [[ ! -d $candidate || -L $candidate ]]; then
  echo "Release-Kandidat muss als echtes Verzeichnis unter $candidate liegen." >&2
  exit 1
fi
candidate_resolved=$(readlink -f -- "$candidate")
if [[ $candidate_resolved != "$candidate" || ! -f $candidate/package.json || ! -f $candidate/scripts/backup/create-backup.mjs ]]; then
  echo 'Release-Kandidat ist unvollständig oder liegt außerhalb des erwarteten Pfads.' >&2
  exit 1
fi
if [[ -e $CURRENT_LINK && ! -L $CURRENT_LINK ]]; then
  echo "$CURRENT_LINK muss ein Symlink auf ein unveränderliches Release sein." >&2
  exit 1
fi
previous_release=
if [[ -L $CURRENT_LINK ]]; then
  previous_release=$(readlink -f -- "$CURRENT_LINK")
  if [[ $previous_release != "$RELEASES_DIR/"* || ! -d $previous_release ]]; then
    echo 'Der aktuelle Release-Symlink zeigt nicht auf ein gültiges Pace-Release.' >&2
    exit 1
  fi
  if [[ $previous_release == "$candidate" ]]; then
    curl --fail --silent --show-error "$HEALTH_URL" >/dev/null
    echo "Release $release_id ist bereits aktiv und gesund."
    exit 0
  fi
fi

node_major=$(/usr/bin/node -p 'Number(process.versions.node.split(".")[0])')
if [[ $node_major -lt 22 ]]; then
  echo 'Pace benötigt Node.js 22 oder neuer.' >&2
  exit 1
fi
getent group pace >/dev/null || groupadd --system pace
id -u pace >/dev/null 2>&1 || useradd --system --gid pace --home-dir "$DATA_DIR" --shell /usr/sbin/nologin pace
install -d -o root -g pace -m 0750 "$BASE_DIR" "$RELEASES_DIR" "$CONFIG_DIR"
install -d -o pace -g pace -m 0700 "$DATA_DIR" "$BACKUP_DIR"
if [[ ! -f $ENV_FILE ]]; then
  echo "$ENV_FILE fehlt. Aus .env.example erstellen; das Skript erzeugt oder druckt keine Secrets." >&2
  exit 1
fi
chown root:pace "$ENV_FILE"
chmod 0600 "$ENV_FILE"
for key in HOST PORT PACE_DATABASE_PATH PACE_PUBLIC_ORIGIN PACE_ALLOWED_TAILSCALE_USERS PACE_GOOGLE_HEALTH_ENABLED PACE_BACKUP_DIR PACE_BACKUP_RETENTION_DAYS; do
  grep -Eq "^${key}=.+" "$ENV_FILE" || { echo "$ENV_FILE: Pflichtwert $key fehlt oder ist leer." >&2; exit 1; }
done
grep -Eq '^HOST=(127\.0\.0\.1|localhost|::1)$' "$ENV_FILE" || { echo 'HOST muss Loopback sein.' >&2; exit 1; }
grep -Eq '^PORT=4173$' "$ENV_FILE" || { echo 'PORT muss 4173 sein.' >&2; exit 1; }
grep -Eq '^PACE_DATABASE_PATH=/var/lib/pace/pace\.sqlite$' "$ENV_FILE" || { echo 'PACE_DATABASE_PATH ist ungültig.' >&2; exit 1; }
grep -Eq '^PACE_BACKUP_DIR=/var/backups/pace$' "$ENV_FILE" || { echo 'PACE_BACKUP_DIR ist ungültig.' >&2; exit 1; }
grep -Eq '^PACE_BACKUP_RETENTION_DAYS=([1-9][0-9]{0,2}|[1-2][0-9]{3}|3[0-5][0-9]{2}|36[0-4][0-9]|3650)$' "$ENV_FILE" || { echo 'PACE_BACKUP_RETENTION_DAYS muss zwischen 1 und 3650 liegen.' >&2; exit 1; }
grep -Eq '^PACE_PUBLIC_ORIGIN=https://.+' "$ENV_FILE" || { echo 'PACE_PUBLIC_ORIGIN muss HTTPS verwenden.' >&2; exit 1; }
grep -Eq '^PACE_GOOGLE_HEALTH_ENABLED=false$' "$ENV_FILE" || { echo 'Google Health muss für diesen Release false sein.' >&2; exit 1; }

# Der Kandidat ist noch nicht live. Alle potenziell fehlschlagenden Builds und Checks laufen vor dem Stop des Altprozesses.
chown -R pace:pace "$candidate"
runuser -u pace -- /usr/bin/npm --prefix "$candidate" ci
runuser -u pace -- /usr/bin/npm --prefix "$candidate" test
runuser -u pace -- /usr/bin/npm --prefix "$candidate" run lint
runuser -u pace -- /usr/bin/npm --prefix "$candidate" run build
runuser -u pace -- /usr/bin/npm --prefix "$candidate" audit --omit=dev
chown -R root:pace "$candidate"
chmod -R u=rwX,g=rX,o= "$candidate"
# Beweist nach dem finalen Rechtewechsel, dass der Dienstnutzer den Kandidaten lesen und starten kann.
(cd "$candidate" && runuser -u pace -- /usr/bin/node scripts/deploy/smoke-production.mjs)

release_stamp=$(date -u +%Y%m%dT%H%M%S.000Z)
release_backup_dir=$BACKUP_DIR/releases/$release_id
prior_units_dir=$release_backup_dir/prior-units
install -d -o pace -g pace -m 0700 "$BACKUP_DIR/releases" "$release_backup_dir"
install -d -o root -g root -m 0700 "$prior_units_dir"

service_was_enabled=false
service_was_active=false
timer_was_enabled=false
timer_was_active=false
if systemctl is-enabled --quiet pace.service 2>/dev/null; then service_was_enabled=true; fi
if systemctl is-active --quiet pace.service 2>/dev/null; then service_was_active=true; fi
if systemctl is-enabled --quiet pace-backup.timer 2>/dev/null; then timer_was_enabled=true; fi
if systemctl is-active --quiet pace-backup.timer 2>/dev/null; then timer_was_active=true; fi
service_unit_existed=false
backup_service_unit_existed=false
timer_unit_existed=false
if [[ -f $SERVICE_DIR/pace.service ]]; then service_unit_existed=true; install -o root -g root -m 0600 "$SERVICE_DIR/pace.service" "$prior_units_dir/pace.service"; fi
if [[ -f $SERVICE_DIR/pace-backup.service ]]; then backup_service_unit_existed=true; install -o root -g root -m 0600 "$SERVICE_DIR/pace-backup.service" "$prior_units_dir/pace-backup.service"; fi
if [[ -f $SERVICE_DIR/pace-backup.timer ]]; then timer_unit_existed=true; install -o root -g root -m 0600 "$SERVICE_DIR/pace-backup.timer" "$prior_units_dir/pace-backup.timer"; fi

rollback_snapshot=
had_database=false
activation_started=false
activation_intent=false
successful=false
rollback_running=false
next_link=$BASE_DIR/.current-$release_id-next

wait_for_health() {
  for _ in {1..30}; do
    if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

archive_live_database_checked() {
  local archive_dir=$1
  local ok=true
  if ! install -d -o pace -g pace -m 0700 "$archive_dir"; then ok=false; fi
  if [[ -f $DATABASE_PATH ]] && ! mv -- "$DATABASE_PATH" "$archive_dir/pace.sqlite"; then ok=false; fi
  if [[ -f $DATABASE_PATH-wal ]] && ! mv -- "$DATABASE_PATH-wal" "$archive_dir/pace.sqlite-wal"; then ok=false; fi
  if [[ -f $DATABASE_PATH-shm ]] && ! mv -- "$DATABASE_PATH-shm" "$archive_dir/pace.sqlite-shm"; then ok=false; fi
  if [[ -e $DATABASE_PATH || -e $DATABASE_PATH-wal || -e $DATABASE_PATH-shm ]]; then ok=false; fi
  [[ $ok == true ]]
}

restore_unit_file() {
  local existed=$1 name=$2
  if [[ $existed == true ]]; then install -o root -g root -m 0644 "$prior_units_dir/$name" "$SERVICE_DIR/$name"
  elif [[ -f $SERVICE_DIR/$name ]]; then unlink -- "$SERVICE_DIR/$name"
  fi
}

unit_file_matches() {
  local existed=$1 name=$2
  if [[ $existed == true ]]; then cmp -s -- "$prior_units_dir/$name" "$SERVICE_DIR/$name"
  else [[ ! -e $SERVICE_DIR/$name ]]
  fi
}

restore_boolean_state() {
  local enabled=$1 active=$2 unit=$3 ok=true
  if [[ $enabled == true ]]; then systemctl enable "$unit" >/dev/null 2>&1 || ok=false
  else systemctl disable "$unit" >/dev/null 2>&1 || ok=false
  fi
  if [[ $active == true ]]; then systemctl start "$unit" >/dev/null 2>&1 || ok=false
  else systemctl stop "$unit" >/dev/null 2>&1 || ok=false
  fi
  [[ $ok == true ]]
}

rollback_activation() {
  if [[ $rollback_running == true ]]; then return; fi
  rollback_running=true
  local rollback_ok=true current_target=
  echo 'Release-Aktivierung fehlgeschlagen oder wurde unterbrochen; Rollback läuft.' >&2
  if ! systemctl stop pace-backup.timer pace-backup.service >/dev/null 2>&1; then rollback_ok=false; fi
  if ! systemctl stop pace.service >/dev/null 2>&1; then rollback_ok=false; fi
  if systemctl is-active --quiet pace.service; then
    systemctl disable pace.service pace-backup.timer >/dev/null 2>&1 || true
    echo "KRITISCH: Pace ließ sich nicht stoppen. Fail-closed; DB/Symlink unangetastet. Recovery: $release_backup_dir" >&2
    return
  fi
  if [[ -L $CURRENT_LINK ]]; then current_target=$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true); fi
  if [[ $current_target == "$candidate" ]]; then
    if ! archive_live_database_checked "$release_backup_dir/failed-activation-$release_stamp"; then rollback_ok=false; fi
    if [[ $had_database == true && -f $rollback_snapshot ]]; then
      if [[ -e $DATABASE_PATH || -e $DATABASE_PATH-wal || -e $DATABASE_PATH-shm ]]; then rollback_ok=false
      elif ! install -o pace -g pace -m 0600 "$rollback_snapshot" "$DATABASE_PATH"; then rollback_ok=false
      elif ! runuser -u pace -- /usr/bin/node "$candidate/scripts/backup/verify-database.mjs" --allow-migrate-from 1..9 "$DATABASE_PATH"; then rollback_ok=false
      fi
    fi
    if [[ -n $previous_release ]]; then
      rollback_link=$BASE_DIR/.current-$release_id-rollback
      if ! ln -s -- "$previous_release" "$rollback_link" || ! mv -Tf -- "$rollback_link" "$CURRENT_LINK"; then rollback_ok=false; fi
    elif [[ -L $CURRENT_LINK ]] && ! unlink -- "$CURRENT_LINK"; then rollback_ok=false
    fi
  fi
  if ! restore_unit_file "$service_unit_existed" pace.service; then rollback_ok=false; fi
  if ! restore_unit_file "$backup_service_unit_existed" pace-backup.service; then rollback_ok=false; fi
  if ! restore_unit_file "$timer_unit_existed" pace-backup.timer; then rollback_ok=false; fi
  if ! unit_file_matches "$service_unit_existed" pace.service || ! unit_file_matches "$backup_service_unit_existed" pace-backup.service || ! unit_file_matches "$timer_unit_existed" pace-backup.timer; then rollback_ok=false; fi
  if ! systemctl daemon-reload; then rollback_ok=false; fi
  current_target=
  if [[ -L $CURRENT_LINK ]]; then current_target=$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true); fi
  if [[ -n $previous_release && $current_target != "$previous_release" ]]; then rollback_ok=false; fi
  if [[ -z $previous_release && -e $CURRENT_LINK ]]; then rollback_ok=false; fi
  if [[ $rollback_ok == true && -n $previous_release ]]; then
    if ! restore_boolean_state "$service_was_enabled" "$service_was_active" pace.service; then rollback_ok=false; fi
    if ! restore_boolean_state "$timer_was_enabled" "$timer_was_active" pace-backup.timer; then rollback_ok=false; fi
    if [[ $service_was_active == true ]] && ! wait_for_health; then rollback_ok=false; fi
  elif [[ $rollback_ok == true ]]; then
    if ! systemctl disable --now pace.service pace-backup.timer >/dev/null 2>&1; then rollback_ok=false; fi
  fi
  if [[ -L $next_link ]] && ! unlink -- "$next_link"; then rollback_ok=false; fi
  if [[ $rollback_ok != true ]]; then
    systemctl stop pace.service pace-backup.timer >/dev/null 2>&1 || true
    systemctl disable pace.service pace-backup.timer >/dev/null 2>&1 || true
    echo "KRITISCH: Rollback nicht vollständig verifiziert. Fail-closed; nicht starten. Snapshot: ${rollback_snapshot:-keiner}; Artefakte: $release_backup_dir" >&2
  fi
}

on_exit() {
  local exit_code=$?
  trap - EXIT ERR INT TERM
  if [[ $successful != true && $activation_started == true ]]; then rollback_activation; fi
  exit "$exit_code"
}
trap on_exit EXIT
trap 'exit $?' ERR
trap 'exit 130' INT
trap 'exit 143' TERM

activation_started=true
systemctl stop pace-backup.timer pace-backup.service >/dev/null 2>&1 || true
if systemctl cat pace.service >/dev/null 2>&1; then systemctl stop pace.service; fi
if systemctl is-active --quiet pace.service; then
  echo 'Pace ist nach dem Stop-Befehl noch aktiv; Aktivierung wird vor jedem DB-Zugriff abgebrochen.' >&2
  false
fi

# Ausschließlich dieser Snapshot ist das Rollback-Paar. Er entsteht nach bestätigtem Stop und enthält damit auch den letzten bestätigten Schreibzugriff.
if [[ -f $DATABASE_PATH ]]; then
  had_database=true
  rollback_snapshot=$release_backup_dir/pace-rollback-$release_stamp.sqlite
  runuser -u pace -- env \
    PACE_DATABASE_PATH="$DATABASE_PATH" PACE_BACKUP_DIR="$release_backup_dir" PACE_BACKUP_RETENTION_DAYS=90 \
    PACE_BACKUP_FILENAME="pace-rollback-$release_stamp.sqlite" \
    /usr/bin/node "$candidate/scripts/backup/create-backup.mjs"
  runuser -u pace -- /usr/bin/node "$candidate/scripts/backup/verify-database.mjs" --allow-migrate-from 1..9 "$rollback_snapshot"
fi

install -o root -g root -m 0644 "$candidate/deploy/pace.service" "$SERVICE_DIR/pace.service"
install -o root -g root -m 0644 "$candidate/deploy/pace-backup.service" "$SERVICE_DIR/pace-backup.service"
install -o root -g root -m 0644 "$candidate/deploy/pace-backup.timer" "$SERVICE_DIR/pace-backup.timer"
systemctl daemon-reload
ln -s -- "$candidate" "$next_link"
activation_intent=true
mv -Tf -- "$next_link" "$CURRENT_LINK"
if [[ $(readlink -f -- "$CURRENT_LINK") != "$candidate" ]]; then echo 'Current-Symlink wurde nicht auf den Kandidaten gesetzt.' >&2; false; fi
systemctl enable pace.service pace-backup.timer
systemctl start pace.service
wait_for_health
systemctl start pace-backup.timer
successful=true
echo "Pace-Release $release_id ist aktiv und gesund. Vorher: ${previous_release:-Erstinstallation}; Rollback-Snapshot: ${rollback_snapshot:-keine vorherige DB}."
