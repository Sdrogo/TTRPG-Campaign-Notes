#!/usr/bin/env bash
# The old name of backup.sh (ticket 73 step 4), kept because the crontab
# installed then still calls it. `bash backup.sh install` replaces that cron
# line; this file goes in step 6.
exec bash "$(dirname "$0")/backup.sh" "$@"
