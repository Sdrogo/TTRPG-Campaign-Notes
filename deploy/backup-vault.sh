#!/usr/bin/env bash
# On the staging VPS: the backup vault (ticket 76, "Backups production can't
# delete"). Production's nightly backup.sh writes to the bucket
# `exlibris-backups` here, with a key that can also delete. This job copies
# each finished day from that bucket into `exlibris-backups-vault`, with a key
# that only this server has, so a compromised production server can empty its
# own bucket but not the vault.
# - Only finished days: those before today (UTC). backup.sh only ever writes
#   today's folder, so a day in the past never changes legitimately.
# - Copied as they are, still encrypted (this server never holds the
#   password), server side inside Garage, with `--immutable`: nothing the
#   vault already holds is ever overwritten.
# - A day copied completely gets a marker, done/<day>. On later runs such a
#   day is compared with the source while the source still has it: any
#   difference is logged and fails the run.
# - Fails too when yesterday's backup never arrived, so the monitor also
#   says "production stopped sending".
# - Kept in the vault: the 7 newest days, the 4 newest Sundays and the 6
#   newest first days of a month (backup-keep.sh).
# After a good run the time goes to backup-vault-last-ok and
# status/backup-last-ok, read by this server's /health/backup (monitor
# "Backup vault").
#
# Run from /opt/exlibris (the bucket and key are made on the first run):
#   bash backup-vault.sh            one run now
#   bash backup-vault.sh install    every day at 05:00 (server time), after
#                                   production's 03:30 backup, from this
#                                   user's crontab; logs to backup-vault.log
# Restoring from the vault: context/restore-runbook.md.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
source ./backup-keep.sh

if [ "${1:-}" = install ]; then
  command -v crontab >/dev/null || { echo "crontab is missing: sudo apt install -y cron" >&2; exit 1; }
  line="0 5 * * * cd $PWD && bash backup-vault.sh >> backup-vault.log 2>&1"
  (crontab -l 2>/dev/null | grep -v 'backup-vault\.sh' || true; echo "$line") | crontab -
  echo "installed: $line"
  exit 0
fi
[ -z "${1:-}" ] || { echo "unknown command: $1" >&2; exit 1; }
# The status folder must be this user's: Docker makes it as root when the
# backend's mount comes first (deploy.sh makes it for this user since ticket
# 75), and the run would then fail at its very end.
mkdir -p status
[ -w status ] || { echo "status/ is not writable: sudo chown $(id -un):$(id -gn) status" >&2; exit 1; }

source_bucket=exlibris-backups
vault=exlibris-backups-vault
key_name=backup-vault
garage() { docker compose exec -T garage /garage "$@" 2>/dev/null; }
garage bucket info "$source_bucket" >/dev/null \
  || { echo "no bucket $source_bucket here: run backup-target-setup.sh first" >&2; exit 1; }
garage bucket info "$vault" >/dev/null || garage bucket create "$vault" >/dev/null
garage key info "$key_name" >/dev/null || garage key create "$key_name" >/dev/null
garage bucket allow --read "$source_bucket" --key "$key_name" >/dev/null
garage bucket allow --read --write "$vault" --key "$key_name" >/dev/null

# rclone runs in the compose network, to reach garage:3900. Its settings go
# through a file readable by this user only, never the command line.
network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' \
  "$(docker compose ps -q garage)")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
settings="$work/settings"
cat > "$settings" <<SETTINGS
RCLONE_CONFIG_GARAGE_TYPE=s3
RCLONE_CONFIG_GARAGE_PROVIDER=Other
RCLONE_CONFIG_GARAGE_ENDPOINT=http://garage:3900
RCLONE_CONFIG_GARAGE_REGION=garage
RCLONE_CONFIG_GARAGE_FORCE_PATH_STYLE=true
RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID=$(garage key info "$key_name" --key-id)
RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY=$(garage key info "$key_name" --secret-key)
SETTINGS
rclone() {
  docker run --rm --network "$network" --env-file "$settings" \
    rclone/rclone:1.71.0@sha256:fd635aecd9667ee3c3bf920d14118090d4f2a83a080c1fa77e0bafbd4587ca87 -q "$@"
}

src="garage:$source_bucket"
dst="garage:$vault"
today="$(date -u +%F)"
yesterday="$(date -u -d yesterday +%F)"
failed=false
log() { echo "$(date -u +%FT%TZ) $*"; }

src_files="$(list_days "$src/files/")"
src_db="$(list_days "$src/db/")"
src_days="$(printf '%s\n' "$src_files" "$src_db" | sort -u)"
done_days="$(lsf_or_empty --files-only "$dst/done/")"

while read -r day; do
  [ -n "$day" ] && [[ "$day" < "$today" ]] || continue
  roots=()
  grep -qx "$day" <<<"$src_files" && roots+=(files)
  grep -qx "$day" <<<"$src_db" && roots+=(db)
  if grep -qx "$day" <<<"$done_days"; then
    # Already in the vault: the source must still hold exactly the same.
    for root in "${roots[@]}"; do
      if ! rclone check --one-way "$src/$root/$day/" "$dst/$root/$day/"; then
        log "MISMATCH: $source_bucket/$root/$day differs from the vault copy; the vault copy is kept"
        failed=true
      fi
    done
  else
    # New, or a copy cut short: --immutable adds what is missing and refuses
    # to change anything already there.
    ok=true
    for root in "${roots[@]}"; do
      rclone copy --immutable "$src/$root/$day/" "$dst/$root/$day/" || ok=false
    done
    if $ok; then
      rclone touch "$dst/done/$day"
      log "copied $day (${roots[*]}) to $vault"
    else
      log "could not copy $day (or it differs from what the vault already holds)"
      failed=true
    fi
  fi
done <<<"$src_days"

# The vault's own retention, over every day it holds.
vault_files="$(list_days "$dst/files/")"
vault_db="$(list_days "$dst/db/")"
done_days="$(lsf_or_empty --files-only "$dst/done/")"
vault_days="$(printf '%s\n' "$vault_files" "$vault_db" "$done_days" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort -u || true)"
keep="$(keep_days <<<"$vault_days")"
while read -r day; do
  [ -n "$day" ] || continue
  grep -qx "$day" <<<"$keep" && continue
  grep -qx "$day" <<<"$vault_files" && rclone purge "$dst/files/$day/"
  grep -qx "$day" <<<"$vault_db" && rclone purge "$dst/db/$day/"
  grep -qx "$day" <<<"$done_days" && rclone deletefile "$dst/done/$day"
  log "removed the copy of $day from $vault"
done <<<"$vault_days"

grep -qx "$yesterday" <<<"$done_days" || { log "no complete copy of $yesterday in the vault: did production's backup run?"; failed=true; }

if $failed; then
  log "vault run FAILED (see above); backup-vault-last-ok not updated"
  exit 1
fi
date -u +%FT%TZ > backup-vault-last-ok
# The same time where the backend reads it, for /health/backup and the
# uptime monitor; readable by the backend's user. (Staging runs no
# backup.sh, so this file is the vault's alone.)
mkdir -p status
# Replaced, not overwritten (see backup.sh).
(umask 022 && cp backup-vault-last-ok status/.backup-last-ok.new && mv -f status/.backup-last-ok.new status/backup-last-ok)
log "vault run ok"
