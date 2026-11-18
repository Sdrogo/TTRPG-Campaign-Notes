# shellcheck shell=bash
# Shared by backup.sh (production) and backup-vault.sh (staging): which days
# of a backup to keep. Sourced, not run.

# The days to keep, from the days present (one per line, any order): the 7
# newest, the 4 newest Sundays and the 6 newest first days of a month. With
# a number as argument, only that many newest days.
keep_days() {
  sort -r | awk -v newest="${1:-}" '
    NF == 0 { next }
    newest != "" { if (++all <= newest) print; next }
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

# `rclone lsf`, where a folder that doesn't exist yet (rclone's exit code 3)
# lists as empty; any other error fails.
lsf_or_empty() {
  local out status=0
  out="$(rclone lsf "$@" 2>/dev/null)" || status=$?
  case "$status" in
    0 | 3) [ -z "$out" ] || printf '%s\n' "$out" ;;
    *) echo "could not list: $*" >&2; return 1 ;;
  esac
}

# The day folders (YYYY-MM-DD) under an rclone path, one per line.
list_days() {
  local out
  out="$(lsf_or_empty --dirs-only "$1")" || return 1
  tr -d / <<<"$out" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || true
}
