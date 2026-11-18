#!/usr/bin/env bash
# The nightly backup (ticket 73 steps 4 and 5), into the other VPS's Garage,
# bucket from backup.env, encrypted with rclone crypt (contents encrypted,
# names kept, so days can be listed and pruned):
# - the images bucket, a full copy per day under files/<YYYY-MM-DD>/. Files
#   unchanged since the newest copy are copied inside the target server
#   (rclone --copy-dest), so only what is new crosses the network;
# - the database, where this server has one (the `db` profile), a
#   `pg_dump -Fc` per day under db/<YYYY-MM-DD>/exlibris.dump.
# Kept, for each: the 7 newest days, the 4 newest Sundays and the 6 newest
# first days of a month; or, when backup.env sets BACKUP_KEEP_DAYS=<n>, only
# the n newest days (ticket 76: the long history lives in the vault on the
# other VPS, backup-vault.sh, which this server can't delete). The password
# is made on the first run, in backup-password next to this script: keep a
# copy in the password manager, since without it the copies can't be read.
# After a good run the time goes to backup-last-ok and status/backup-last-ok,
# for the monitoring (ticket 75: /health/backup).
#
# Needs backup.env next to it (written by backup-target-setup.sh on the
# other VPS). Run from /opt/exlibris:
#   bash backup.sh                one backup now
#   bash backup.sh install        every night at 03:30 (server time), from
#                                 this user's crontab (needs `cron`); logs
#                                 to backup.log
#   bash backup.sh check [day]    restores that day's database dump (default:
#                                 the newest) into a throwaway database here,
#                                 compares the row counts with the live
#                                 database and drops it
#   bash backup.sh fetch [day]    saves that day's database dump here as
#                                 restore-<day>.dump, for db-setup.sh
#   bash backup.sh restore-files [day]
#                                 copies that day's files back into the
#                                 bucket (adds and overwrites, deletes
#                                 nothing)
#   bash backup.sh vault check|fetch|restore-files [day]
#                                 the same, reading the vault instead, with
#                                 the read-only key in vault.env (made by
#                                 `backup-target-setup.sh vault-reader`)
# Restoring for real, also on a new server: context/restore-runbook.md.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source ./backup-keep.sh

if [ "${1:-}" = install ]; then
  command -v crontab >/dev/null || { echo "crontab is missing: sudo apt install -y cron" >&2; exit 1; }
  line="30 3 * * * cd $PWD && bash backup.sh >> backup.log 2>&1"
  (crontab -l 2>/dev/null | grep -vE 'backup(-files)?\.sh' || true; echo "$line") | crontab -
  echo "installed: $line"
  exit 0
fi

env_file=backup.env
if [ "${1:-}" = vault ]; then
  env_file=vault.env
  shift
  case "${1:-}" in
    check | fetch | restore-files) ;;
    *) echo "from the vault: check, fetch or restore-files" >&2; exit 1 ;;
  esac
fi
[ -f "$env_file" ] || { echo "$env_file is missing (see backup-target-setup.sh)" >&2; exit 1; }
# shellcheck source=/dev/null
source "$env_file"
: "${BACKUP_S3_URL:?}" "${BACKUP_BUCKET:?}" "${BACKUP_ACCESS_KEY_ID:?}" "${BACKUP_SECRET_ACCESS_KEY:?}"
# The vault copies a day only once it is over, so a day stays here at least
# 2 days before the vault can have it; the floor of 4 (7 recommended) leaves
# room for a vault that is down a few days. Days the vault never got are
# lost once pruned here, so keep it well above the time to notice the
# "Backup vault" alert.
[[ -z "${BACKUP_KEEP_DAYS:-}" || "${BACKUP_KEEP_DAYS:-}" =~ ^[4-9]$|^[1-9][0-9]+$ ]] \
  || { echo "BACKUP_KEEP_DAYS must be a number of days, at least 4 (7 recommended)" >&2; exit 1; }

if [ ! -s backup-password ]; then
  (umask 077 && openssl rand -base64 32 > backup-password)
  echo "new backup password in $PWD/backup-password: copy it to the password manager"
fi

# The status folder must be this user's: Docker makes it as root when the
# backend's mount comes first (deploy.sh makes it for this user since ticket
# 75), and the run would then fail at its very end, after the copy.
if [ -z "${1:-}" ]; then
  mkdir -p status
  [ -w status ] || { echo "status/ is not writable: sudo chown $(id -un):$(id -gn) status" >&2; exit 1; }
fi

# Whether this server has a database comes from its settings, not from a
# running container: a stopped database must fail the backup, not skip it.
has_db=false
if [[ ",$(sed -n 's/^COMPOSE_PROFILES=//p' .env 2>/dev/null)," == *,db,* ]]; then
  has_db=true
  [ -n "$(docker compose ps -q --status running db)" ] || { echo "the db service is not running" >&2; exit 1; }
fi

garage() { docker compose exec -T garage /garage "$@" 2>/dev/null; }
# A key of this server's Garage that can only read the bucket, made on the
# first run.
reader=backup-reader
garage key info "$reader" >/dev/null || garage key create "$reader" >/dev/null
garage bucket allow --read document-images --key "$reader" >/dev/null

# rclone runs in the compose network, to reach garage:3900. Its settings go
# through a file readable by this user only, never the command line.
network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' \
  "$(docker compose ps -q garage)")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
settings="$work/settings"
cat > "$settings" <<SETTINGS
RCLONE_CONFIG_SOURCE_TYPE=s3
RCLONE_CONFIG_SOURCE_PROVIDER=Other
RCLONE_CONFIG_SOURCE_ENDPOINT=http://garage:3900
RCLONE_CONFIG_SOURCE_REGION=garage
RCLONE_CONFIG_SOURCE_FORCE_PATH_STYLE=true
RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID=$(garage key info "$reader" --key-id)
RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY=$(garage key info "$reader" --secret-key)
RCLONE_CONFIG_TARGET_TYPE=s3
RCLONE_CONFIG_TARGET_PROVIDER=Other
RCLONE_CONFIG_TARGET_ENDPOINT=$BACKUP_S3_URL
RCLONE_CONFIG_TARGET_REGION=garage
RCLONE_CONFIG_TARGET_FORCE_PATH_STYLE=true
RCLONE_CONFIG_TARGET_ACCESS_KEY_ID=$BACKUP_ACCESS_KEY_ID
RCLONE_CONFIG_TARGET_SECRET_ACCESS_KEY=$BACKUP_SECRET_ACCESS_KEY
RCLONE_CONFIG_SAFE_TYPE=crypt
RCLONE_CONFIG_SAFE_REMOTE=target:$BACKUP_BUCKET/files
RCLONE_CONFIG_SAFE_FILENAME_ENCRYPTION=off
RCLONE_CONFIG_SAFE_DIRECTORY_NAME_ENCRYPTION=false
RCLONE_CONFIG_BUCKET_TYPE=s3
RCLONE_CONFIG_BUCKET_PROVIDER=Other
RCLONE_CONFIG_BUCKET_ENDPOINT=http://garage:3900
RCLONE_CONFIG_BUCKET_REGION=garage
RCLONE_CONFIG_BUCKET_FORCE_PATH_STYLE=true
RCLONE_CONFIG_SAFEDB_TYPE=crypt
RCLONE_CONFIG_SAFEDB_REMOTE=target:$BACKUP_BUCKET/db
RCLONE_CONFIG_SAFEDB_FILENAME_ENCRYPTION=off
RCLONE_CONFIG_SAFEDB_DIRECTORY_NAME_ENCRYPTION=false
SETTINGS
# The work folder is mounted at /work, for the dump.
rclone() {
  docker run --rm --network "$network" --env-file "$settings" -v "$work:/work" \
    rclone/rclone:1.71.0@sha256:fd635aecd9667ee3c3bf920d14118090d4f2a83a080c1fa77e0bafbd4587ca87 -q "$@"
}
# rclone wants the password in its own obscured form. Only this call reads
# standard input (-i); the others must not, or a `while read` loop around
# them would lose its lines to the container.
obscured="$(docker run --rm -i rclone/rclone:1.71.0@sha256:fd635aecd9667ee3c3bf920d14118090d4f2a83a080c1fa77e0bafbd4587ca87 obscure - < backup-password)"
printf '%s\n' "RCLONE_CONFIG_SAFE_PASSWORD=$obscured" "RCLONE_CONFIG_SAFEDB_PASSWORD=$obscured" >> "$settings"

psql_admin() { docker compose exec -T -e PGOPTIONS=--client-min-messages=warning db psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
# Every table of `public` with its row count, one per line.
row_counts() {
  local query
  query="$(psql_admin -d "$1" -At -c "SELECT string_agg(format('SELECT %L, count(*) FROM public.%I', tablename, tablename), ' UNION ALL ') || ' ORDER BY 1' FROM pg_tables WHERE schemaname = 'public'")"
  psql_admin -d "$1" -At -F ' ' -c "$query" | LC_ALL=C sort
}

# The given day, or the newest copy in that root.
pick_day() {
  local day="${2:-}"
  [ -n "$day" ] || day="$(rclone lsf --dirs-only "$1" | tr -d / | sort | tail -n 1)"
  [ -n "$day" ] || { echo "no copy yet in $1" >&2; exit 1; }
  echo "$day"
}

case "${1:-}" in
  check)
    $has_db || { echo "no database on this server" >&2; exit 1; }
    day="$(pick_day safedb: "${2:-}")"
    rclone copyto "safedb:$day/exlibris.dump" /work/exlibris.dump
    psql_admin -d exlibris -c 'DROP DATABASE IF EXISTS restore_check' -c 'CREATE DATABASE restore_check'
    docker compose exec -T db pg_restore -U postgres --exit-on-error -d restore_check < "$work/exlibris.dump"
    restored="$(row_counts restore_check)"
    live="$(row_counts exlibris)"
    psql_admin -d exlibris -c 'DROP DATABASE restore_check'
    echo "copy of $day restored: $(wc -l <<<"$restored") tables, $(awk '{s += $2} END {print s}' <<<"$restored") rows"
    if [ "$restored" = "$live" ]; then
      echo "the same row counts as the live database"
    else
      echo "row counts that differ from the live database (left the copy, right now);"
      echo "expected for tables written since the copy was made:"
      diff <(echo "$restored") <(echo "$live") || true
    fi
    exit 0 ;;
  fetch)
    day="$(pick_day safedb: "${2:-}")"
    rclone copyto "safedb:$day/exlibris.dump" /work/exlibris.dump
    (umask 077 && cp "$work/exlibris.dump" "restore-$day.dump")
    echo "saved restore-$day.dump; to put it in place: bash db-setup.sh restore-$day.dump"
    exit 0 ;;
  restore-files)
    day="$(pick_day safe: "${2:-}")"
    # The backend's own key: backup-reader can only read.
    {
      echo "RCLONE_CONFIG_BUCKET_ACCESS_KEY_ID=$(sudo sed -n 's/^S3_ACCESS_KEY_ID=//p' backend.env)"
      echo "RCLONE_CONFIG_BUCKET_SECRET_ACCESS_KEY=$(sudo sed -n 's/^S3_SECRET_ACCESS_KEY=//p' backend.env)"
    } >> "$settings"
    rclone copy "safe:$day/" "bucket:document-images"
    echo "files of $day copied back into document-images"
    exit 0 ;;
  "") ;;
  *) echo "unknown command: $1" >&2; exit 1 ;;
esac

today="$(date -u +%F)"

# The bucket.
newest="$(rclone lsf --dirs-only safe: 2>/dev/null | tr -d / | grep -vx "$today" | sort | tail -n 1 || true)"
copy_dest=()
[ -n "$newest" ] && copy_dest=(--copy-dest "safe:$newest/")
rclone sync "source:document-images" "safe:$today/" "${copy_dest[@]}"
echo "$(date -u +%FT%TZ) files copied to $BACKUP_BUCKET/files/$today/"

# The database: the whole of it, with owners and grants, as restore needs.
if $has_db; then
  (umask 077 && docker compose exec -T db pg_dump -U postgres -Fc exlibris > "$work/exlibris.dump")
  rclone copyto /work/exlibris.dump "safedb:$today/exlibris.dump"
  echo "$(date -u +%FT%TZ) database ($(du -h "$work/exlibris.dump" | cut -f1)) copied to $BACKUP_BUCKET/db/$today/"
fi

# The days to keep: backup-keep.sh.
prune() {
  local root="$1" days keep day
  days="$(list_days "$root")"
  keep="$(keep_days "${BACKUP_KEEP_DAYS:-}" <<<"$days")"
  while read -r day; do
    [ -n "$day" ] || continue
    if ! grep -qx "$day" <<<"$keep"; then
      rclone purge "$root$day/"
      echo "removed the copy of $day from $root"
    fi
  done <<<"$days"
}
prune safe:
$has_db && prune safedb:

date -u +%FT%TZ > backup-last-ok
# The same time where the backend reads it, for /health/backup and the
# uptime monitor (ticket 75); readable by the backend's user.
mkdir -p status
# Replaced, not overwritten: a leftover file owned by another user (root,
# from a run before status/ was made for this user) can then not block it.
(umask 022 && cp backup-last-ok status/.backup-last-ok.new && mv -f status/.backup-last-ok.new status/backup-last-ok)
