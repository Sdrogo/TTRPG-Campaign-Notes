#!/usr/bin/env bash
# The nightly backup of the images bucket (ticket 73 step 4): a full copy
# into the other VPS's Garage, one folder per day, under
# <bucket>/files/<YYYY-MM-DD>/, encrypted (rclone crypt: contents encrypted,
# names kept, so days can be listed and pruned). The password is made on the
# first run, in backup-password next to this script: keep a copy in the
# password manager, since without it the copies can't be read. Files unchanged since the newest copy are
# copied inside the target server (rclone --copy-dest), so only what is new
# crosses the network. Kept: the 7 newest days, the 4 newest Sundays and
# the 6 newest first days of a month. Step 5 adds the database dump.
#
# Needs backup.env next to it (written by backup-target-setup.sh on the
# other VPS). Run from /opt/exlibris:
#   bash backup-files.sh          one backup now
#   bash backup-files.sh install  every night at 03:30 (server time), from
#                                 this user's crontab; logs to
#                                 backup-files.log
# Restore (on the server whose Garage lost its objects): the same settings
# as below, then
#   rclone sync safe:<day>/ source:document-images
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = install ]; then
  line="30 3 * * * cd $PWD && bash backup-files.sh >> backup-files.log 2>&1"
  (crontab -l 2>/dev/null | grep -vF 'backup-files.sh' || true; echo "$line") | crontab -
  echo "installed: $line"
  exit 0
fi

[ -f backup.env ] || { echo "backup.env is missing (see backup-target-setup.sh)" >&2; exit 1; }
# shellcheck source=/dev/null
source backup.env
: "${BACKUP_S3_URL:?}" "${BACKUP_BUCKET:?}" "${BACKUP_ACCESS_KEY_ID:?}" "${BACKUP_SECRET_ACCESS_KEY:?}"

if [ ! -s backup-password ]; then
  (umask 077 && openssl rand -base64 32 > backup-password)
  echo "new backup password in $PWD/backup-password: copy it to the password manager"
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
settings="$(mktemp)"
trap 'rm -f "$settings"' EXIT
chmod 600 "$settings"
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
SETTINGS
rclone() {
  docker run --rm -i --network "$network" --env-file "$settings" rclone/rclone:1.71.0 -q "$@"
}
# rclone wants the password in its own obscured form.
echo "RCLONE_CONFIG_SAFE_PASSWORD=$(rclone obscure - < backup-password)" >> "$settings"

root="safe:"
today="$(date -u +%F)"
newest="$(rclone lsf --dirs-only "$root" 2>/dev/null | tr -d / | grep -vx "$today" | sort | tail -n 1 || true)"
copy_dest=()
[ -n "$newest" ] && copy_dest=(--copy-dest "$root$newest/")
rclone sync "source:document-images" "$root$today/" "${copy_dest[@]}"
echo "$(date -u +%FT%TZ) files copied to $BACKUP_BUCKET/files/$today/"

# The days to keep, from the days present (one per line, any order): the 7
# newest, the 4 newest Sundays and the 6 newest first days of a month.
keep_days() {
  sort -r | awk '
    {
      split($0, d, "-")
      cmd = "date -u -d " $0 " +%u"; cmd | getline weekday; close(cmd)
      keep = 0
      if (++all <= 7) keep = 1
      if (weekday == 7 && ++sundays <= 4) keep = 1
      if (d[3] == "01" && ++firsts <= 6) keep = 1
      if (keep) print
    }'
}
days="$(rclone lsf --dirs-only "$root" | tr -d / | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || true)"
keep="$(keep_days <<<"$days")"
while read -r day; do
  [ -n "$day" ] || continue
  if ! grep -qx "$day" <<<"$keep"; then
    rclone purge "$root$day/"
    echo "removed the copy of $day"
  fi
done <<<"$days"
