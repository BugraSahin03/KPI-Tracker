#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

BASE_DIR=/opt/pace
RELEASES_DIR=$BASE_DIR/releases
CURRENT_LINK=$BASE_DIR/current
DATA_DIR=/var/lib/pace
DATABASE_PATH=$DATA_DIR/pace.sqlite
BACKUP_ROOT=/var/backups/pace
SERVICE_DIR=/etc/systemd/system
HEALTH_URL=http://127.0.0.1:4173/api/health

backup_argument=${1:-}
release_id=${2:-}
if [[ ${EUID} -ne 0 ]]; then echo 'Restore muss als root laufen.' >&2; exit 1; fi
if [[ -z $backup_argument ]]; then echo 'Aufruf: restore-production.sh <backup.sqlite> [release-id]' >&2; exit 1; fi
exec 9>/run/lock/pace-production.lock
flock -n 9 || { echo 'Installation oder Restore läuft bereits.' >&2; exit 1; }

backup_path=$(readlink -f -- "$backup_argument")
if [[ $backup_path != "$BACKUP_ROOT/"* || ! -f $backup_path || -L $backup_argument ]]; then echo 'Backup muss eine reguläre Datei unter /var/backups/pace sein.' >&2; exit 1; fi
backup_name=$(basename -- "$backup_path")
if [[ ! $backup_name =~ ^pace-(rollback-)?[0-9]{8}T[0-9]{6}\.[0-9]{3}Z\.sqlite$ ]]; then echo 'Backup-Dateiname ist nicht als Pace-Backup erkennbar.' >&2; exit 1; fi

current_release=$(readlink -f -- "$CURRENT_LINK")
if [[ -z $current_release || $current_release != "$RELEASES_DIR/"* || $(dirname -- "$current_release") != "$RELEASES_DIR" || ! -d $current_release || ! -f $current_release/scripts/backup/verify-database.mjs || ! -f $current_release/scripts/deploy/run-restore-verifier.mjs ]]; then
  echo 'Current zeigt nicht auf ein sicheres, verifierfähiges Release.' >&2
  exit 1
fi
current_verifier=$current_release/scripts/backup/verify-database.mjs
target_release=
target_requested=false
if [[ -n $release_id ]]; then
  target_requested=true
  if [[ ! $release_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]]; then echo 'Release-ID ist ungültig.' >&2; exit 1; fi
  target_release=$RELEASES_DIR/$release_id
  if [[ ! -d $target_release || -L $target_release || $(readlink -f -- "$target_release") != "$target_release" ]]; then echo 'Ziel-Release ist ungültig.' >&2; exit 1; fi
  for required in package.json deploy/pace.service deploy/pace-backup.service deploy/pace-backup.timer scripts/backup/verify-database.mjs; do
    [[ -f $target_release/$required ]] || { echo "Ziel-Release fehlt: $required" >&2; exit 1; }
  done
fi
target_release=${target_release:-$current_release}
target_verifier=$target_release/scripts/backup/verify-database.mjs
display_release=unverändert
if [[ $target_requested == true ]]; then display_release=$target_release; fi
route_verifier=$current_release/scripts/deploy/run-restore-verifier.mjs
runuser -u pace -- env PACE_RELEASES_DIR="$RELEASES_DIR" /usr/bin/node "$route_verifier" input "$current_release" "$target_release" "$backup_path"

restore_stamp=$(date -u +%Y%m%dT%H%M%S.000Z)
safety_dir=$BACKUP_ROOT/restores/$restore_stamp
prior_units_dir=$safety_dir/prior-units
failed_dir=$safety_dir/failed-restore
install -d -o pace -g pace -m 0700 "$BACKUP_ROOT/restores" "$safety_dir"
install -d -o root -g root -m 0700 "$prior_units_dir"
previous_release=$current_release
service_was_enabled=false; service_was_active=false; timer_was_enabled=false; timer_was_active=false
if systemctl is-enabled --quiet pace.service 2>/dev/null; then service_was_enabled=true; fi
if systemctl is-active --quiet pace.service 2>/dev/null; then service_was_active=true; fi
if systemctl is-enabled --quiet pace-backup.timer 2>/dev/null; then timer_was_enabled=true; fi
if systemctl is-active --quiet pace-backup.timer 2>/dev/null; then timer_was_active=true; fi
service_unit_existed=false; backup_unit_existed=false; timer_unit_existed=false
if [[ -f $SERVICE_DIR/pace.service ]]; then service_unit_existed=true; install -m 0600 "$SERVICE_DIR/pace.service" "$prior_units_dir/pace.service"; fi
if [[ -f $SERVICE_DIR/pace-backup.service ]]; then backup_unit_existed=true; install -m 0600 "$SERVICE_DIR/pace-backup.service" "$prior_units_dir/pace-backup.service"; fi
if [[ -f $SERVICE_DIR/pace-backup.timer ]]; then timer_unit_existed=true; install -m 0600 "$SERVICE_DIR/pace-backup.timer" "$prior_units_dir/pace-backup.timer"; fi

started=false; safety_snapshot_ready=false; data_move_intent=false; code_activation_intent=false; successful=false; rollback_running=false
next_link=$BASE_DIR/.current-restore-$restore_stamp
safety_snapshot=$safety_dir/pace-rollback-$restore_stamp.sqlite

move_database_set_checked() {
  local destination=$1
  local ok=true
  if ! install -d -o pace -g pace -m 0700 "$destination"; then ok=false; fi
  if [[ -f $DATABASE_PATH ]] && ! mv -- "$DATABASE_PATH" "$destination/pace.sqlite"; then ok=false; fi
  if [[ -f $DATABASE_PATH-wal ]] && ! mv -- "$DATABASE_PATH-wal" "$destination/pace.sqlite-wal"; then ok=false; fi
  if [[ -f $DATABASE_PATH-shm ]] && ! mv -- "$DATABASE_PATH-shm" "$destination/pace.sqlite-shm"; then ok=false; fi
  if [[ -e $DATABASE_PATH || -e $DATABASE_PATH-wal || -e $DATABASE_PATH-shm ]]; then ok=false; fi
  [[ $ok == true ]]
}
restore_unit() {
  local existed=$1 name=$2
  if [[ $existed == true ]]; then install -o root -g root -m 0644 "$prior_units_dir/$name" "$SERVICE_DIR/$name"
  elif [[ -f $SERVICE_DIR/$name ]]; then unlink -- "$SERVICE_DIR/$name"
  fi
}
unit_matches() {
  local existed=$1 name=$2
  if [[ $existed == true ]]; then cmp -s -- "$prior_units_dir/$name" "$SERVICE_DIR/$name"
  else [[ ! -e $SERVICE_DIR/$name ]]
  fi
}
restore_states() {
  local ok=true
  if [[ $service_was_enabled == true ]]; then systemctl enable pace.service >/dev/null 2>&1 || ok=false; else systemctl disable pace.service >/dev/null 2>&1 || ok=false; fi
  if [[ $timer_was_enabled == true ]]; then systemctl enable pace-backup.timer >/dev/null 2>&1 || ok=false; else systemctl disable pace-backup.timer >/dev/null 2>&1 || ok=false; fi
  if [[ $service_was_active == true ]]; then systemctl start pace.service >/dev/null 2>&1 || ok=false; else systemctl stop pace.service >/dev/null 2>&1 || ok=false; fi
  if [[ $timer_was_active == true ]]; then systemctl start pace-backup.timer >/dev/null 2>&1 || ok=false; else systemctl stop pace-backup.timer >/dev/null 2>&1 || ok=false; fi
  [[ $ok == true ]]
}
wait_health() { for _ in {1..30}; do curl --fail --silent "$HEALTH_URL" >/dev/null && return 0; sleep 1; done; return 1; }

rollback_restore() {
  [[ $rollback_running == true ]] && return
  rollback_running=true
  local rollback_ok=true current_target=
  if ! systemctl stop pace-backup.timer pace-backup.service pace.service >/dev/null 2>&1; then rollback_ok=false; fi
  if systemctl is-active --quiet pace.service; then
    systemctl disable pace.service pace-backup.timer >/dev/null 2>&1 || true
    echo "KRITISCH: Dienst noch aktiv. Fail-closed; DB unangetastet. Recovery: $safety_dir" >&2
    return
  fi
  if [[ $data_move_intent == true ]]; then
    if ! move_database_set_checked "$failed_dir"; then rollback_ok=false; fi
    if [[ -e $DATABASE_PATH || -e $DATABASE_PATH-wal || -e $DATABASE_PATH-shm ]]; then rollback_ok=false
    elif [[ $safety_snapshot_ready == true ]]; then
      if ! install -o pace -g pace -m 0600 "$safety_snapshot" "$DATABASE_PATH"; then rollback_ok=false
      elif ! runuser -u pace -- env PACE_RELEASES_DIR="$RELEASES_DIR" /usr/bin/node "$route_verifier" rollback "$current_release" "$target_release" "$DATABASE_PATH"; then rollback_ok=false
      fi
    fi
  fi
  if [[ -L $CURRENT_LINK ]]; then current_target=$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true); fi
  if [[ $code_activation_intent == true || ( $target_requested == true && $current_target == "$target_release" ) ]]; then
    if [[ -n $previous_release ]]; then
      rollback_link=$BASE_DIR/.current-restore-rollback
      if ! ln -s -- "$previous_release" "$rollback_link" || ! mv -Tf -- "$rollback_link" "$CURRENT_LINK"; then rollback_ok=false; fi
    elif [[ -L $CURRENT_LINK ]] && ! unlink -- "$CURRENT_LINK"; then rollback_ok=false
    fi
  fi
  if ! restore_unit "$service_unit_existed" pace.service; then rollback_ok=false; fi
  if ! restore_unit "$backup_unit_existed" pace-backup.service; then rollback_ok=false; fi
  if ! restore_unit "$timer_unit_existed" pace-backup.timer; then rollback_ok=false; fi
  if ! unit_matches "$service_unit_existed" pace.service || ! unit_matches "$backup_unit_existed" pace-backup.service || ! unit_matches "$timer_unit_existed" pace-backup.timer; then rollback_ok=false; fi
  if ! systemctl daemon-reload; then rollback_ok=false; fi
  current_target=
  if [[ -L $CURRENT_LINK ]]; then current_target=$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true); fi
  if [[ -n $previous_release && $current_target != "$previous_release" ]]; then rollback_ok=false; fi
  if [[ $rollback_ok == true ]] && ! restore_states; then rollback_ok=false; fi
  if [[ $rollback_ok == true && $service_was_active == true ]] && ! wait_health; then rollback_ok=false; fi
  if [[ $rollback_ok != true ]]; then
    systemctl stop pace.service pace-backup.timer >/dev/null 2>&1 || true
    systemctl disable pace.service pace-backup.timer >/dev/null 2>&1 || true
    echo "KRITISCH: Restore-Rollback nicht vollständig verifiziert. Fail-closed; nicht starten. Safety-Snapshot: $safety_snapshot; Artefakte: $safety_dir" >&2
  fi
}
on_exit() { local code=$?; trap - EXIT ERR INT TERM; if [[ $successful != true && $started == true ]]; then rollback_restore; fi; exit "$code"; }
trap on_exit EXIT
trap 'exit $?' ERR
trap 'exit 130' INT
trap 'exit 143' TERM

started=true
systemctl stop pace-backup.timer pace-backup.service >/dev/null 2>&1 || true
systemctl stop pace.service
if systemctl is-active --quiet pace.service; then echo 'Dienst konnte nicht gestoppt werden; Restore abgebrochen.' >&2; false; fi
if [[ -f $DATABASE_PATH ]]; then
  runuser -u pace -- env PACE_DATABASE_PATH="$DATABASE_PATH" PACE_BACKUP_DIR="$safety_dir" PACE_BACKUP_RETENTION_DAYS=90 PACE_BACKUP_FILENAME="pace-rollback-$restore_stamp.sqlite" \
    /usr/bin/node "$current_release/scripts/backup/create-backup.mjs"
  runuser -u pace -- env PACE_RELEASES_DIR="$RELEASES_DIR" /usr/bin/node "$route_verifier" safety "$current_release" "$target_release" "$safety_snapshot"
  safety_snapshot_ready=true
fi
data_move_intent=true
move_database_set_checked "$safety_dir/original-files"
if [[ -e $DATABASE_PATH || -e $DATABASE_PATH-wal || -e $DATABASE_PATH-shm ]]; then echo 'Live-DB-Satz ist nicht vollständig archiviert.' >&2; false; fi
install -o pace -g pace -m 0600 "$backup_path" "$DATABASE_PATH"
if [[ $target_requested == true ]]; then
  install -o root -g root -m 0644 "$target_release/deploy/pace.service" "$SERVICE_DIR/pace.service"
  install -o root -g root -m 0644 "$target_release/deploy/pace-backup.service" "$SERVICE_DIR/pace-backup.service"
  install -o root -g root -m 0644 "$target_release/deploy/pace-backup.timer" "$SERVICE_DIR/pace-backup.timer"
  systemctl daemon-reload
  ln -s -- "$target_release" "$next_link"
  code_activation_intent=true
  mv -Tf -- "$next_link" "$CURRENT_LINK"
  if [[ $(readlink -f -- "$CURRENT_LINK") != "$target_release" ]]; then echo 'Restore-Code-Symlink stimmt nicht.' >&2; false; fi
fi
runuser -u pace -- env PACE_RELEASES_DIR="$RELEASES_DIR" /usr/bin/node "$route_verifier" final "$current_release" "$target_release" "$DATABASE_PATH"
systemctl start pace.service
wait_health
systemctl start pace-backup.timer
successful=true
if [[ $safety_snapshot_ready == true ]]; then echo "Restore erfolgreich. Safety-Snapshot: $safety_snapshot; Release: $display_release."
else echo "Restore erfolgreich. Vorherige DB: keine; Release: $display_release."
fi
