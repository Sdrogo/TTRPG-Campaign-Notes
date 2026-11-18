#!/usr/bin/env bash
# On the staging VPS: makes its Garage the target of production's nightly
# backup (ticket 73 step 4, backup.sh). Run after garage-setup.sh.
# Creates the bucket `exlibris-backups` and a key that can only use that
# bucket, and prints the lines production's backup.env needs on standard
# output (everything else goes to standard error). So from your own
# computer, without the key ever being shown or copied by hand:
#   ssh debian@<staging> 'bash /opt/exlibris/backup-target-setup.sh' \
#     | ssh debian@<production> 'umask 077 && cat > /opt/exlibris/backup.env'
# Safe to run again: it prints the same key.
#
# `backup-target-setup.sh vault-reader` instead prints a key that can only
# read the vault (`exlibris-backups-vault`, made by backup-vault.sh, ticket
# 76), for a restore from the vault: save it as vault.env next to backup.sh
# on the server that restores (`bash backup.sh vault check|fetch|...`).
# The key production writes with never gets any right on the vault.
set -euo pipefail
cd "$(dirname "$0")"

garage() { docker compose exec -T garage /garage "$@" 2>/dev/null; }
case "${1:-}" in
  "")
    bucket=exlibris-backups
    key_name=production-backup
    rights=(--read --write) ;;
  vault-reader)
    bucket=exlibris-backups-vault
    key_name=vault-reader
    rights=(--read)
    garage bucket info "$bucket" >/dev/null || { echo "no vault yet: run backup-vault.sh first" >&2; exit 1; } ;;
  *) echo "unknown command: $1" >&2; exit 1 ;;
esac

files_host="$(sed -n 's/^FILES_HOSTS=//p' .env)"
[ -n "$files_host" ] || { echo "run garage-setup.sh on this server first" >&2; exit 1; }
garage bucket info "$bucket" >/dev/null || garage bucket create "$bucket" >/dev/null
garage key info "$key_name" >/dev/null || garage key create "$key_name" >/dev/null
garage bucket allow "${rights[@]}" "$bucket" --key "$key_name" >/dev/null
key_id="$(garage key info "$key_name" --key-id)"
secret="$(garage key info "$key_name" --secret-key)"
[ -n "$key_id" ] && [ -n "$secret" ] || { echo "could not read the key" >&2; exit 1; }
echo "backup target ready: $bucket on $files_host" >&2
printf '%s\n' \
  "BACKUP_S3_URL=$files_host" \
  "BACKUP_BUCKET=$bucket" \
  "BACKUP_ACCESS_KEY_ID=$key_id" \
  "BACKUP_SECRET_ACCESS_KEY=$secret"
