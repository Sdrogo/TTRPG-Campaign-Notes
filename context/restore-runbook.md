# Restore runbook

How to bring back the database and the images from the nightly backup
(ticket 73 steps 4 and 5). Every command runs on the server, in
`/opt/exlibris`, as `debian`.

## What the backup holds

- `deploy/backup.sh` runs on **production** every night at 03:30 (server
  time) from the crontab, logging to `backup.log`.
- It writes to the **staging VPS**'s Garage, bucket `exlibris-backups`:
  - `files/<YYYY-MM-DD>/`: a full copy of the images bucket;
  - `db/<YYYY-MM-DD>/exlibris.dump`: a `pg_dump -Fc` of the whole database.
- Both are encrypted with rclone crypt. Names stay readable (days can be
  listed), contents do not.
- The password is in `backup-password` on production and in the product
  owner's password manager. **Without it the backup cannot be read.**
- Kept: the 7 newest days, the 4 newest Sundays and the 6 newest first days
  of a month.
- After each good run, `backup-last-ok` holds its time (UTC). The monitoring
  of ticket 75 reads it.

## Check that a backup restores

```
bash backup.sh check            # the newest copy
bash backup.sh check 2026-11-20 # a given day
```

It restores the dump into a throwaway database `restore_check` on the same
Postgres, compares row counts with the live database and drops it. The live
database is not touched. Differences are expected only in tables written
since the copy. Run it after any change to the backup, and every few months.

## Restore the database on the same server

For example, after data was deleted by mistake.

1. Pick the day: the newest copy made **before** the problem.
2. `bash backup.sh fetch 2026-11-20` saves `restore-2026-11-20.dump` here.
3. `bash db-setup.sh restore-2026-11-20.dump`:
   - keeps the database as it is now in `before-restore-<time>.dump`;
   - stops the backend, empties the `public` schema and restores the file;
   - starts the backend and checks it reads the data.
   The API is down for a minute or two. Everything written after that day's
   03:30 is lost (it stays in `before-restore-*.dump`, for picking out by hand).
4. If the migrations moved on since that day, run Actions → *Migrate
   database* for this server.
5. Delete `restore-*.dump` and, once satisfied, `before-restore-*.dump`:
   they hold personal data.

## Restore the images on the same server

`bash backup.sh restore-files 2026-11-20` copies that day's files back into
the bucket with the backend's own key. It adds and overwrites, and deletes
nothing, so it is safe to run on a bucket that is only partly damaged.

## Rebuild production on a new VPS

When the production server is lost. The staging VPS holds the backup and is
untouched.

1. **Server**: a new VPS, hardened like the others (SSH key only, ufw 22,
   80 and 443, Docker from Docker's repository, `sudo apt install -y cron`),
   `/opt/exlibris` owned by `debian`, `docker login ghcr.io` with a
   read-only token.
2. **DNS**: point `exlibris.world`, `www`, `api` and `files` at the new IP.
3. **GitHub**: update `VPS_HOST` (and the deploy key, if it changed) in the
   environment `vps-production`, then Actions → *Deploy production* → Run
   workflow. This brings the compose file, the Caddyfile and the scripts.
   It may end red, since the backend has no database yet: the files are
   copied before that.
4. **Settings**: write `.env` (the hosts, as in `context/architecture.md`)
   and `backend.env`. Secrets that only lived on the old server must be made
   again:
   - `AUTH_TOKEN_SECRET`: a new random value (`openssl rand -base64 48`);
     everyone is signed out once;
   - the Google, Discord and GitHub client secrets: new ones from each
     console (the client IDs and redirect URIs stay);
   - no `DATABASE_URL` and no `S3_*` lines: the scripts below write them.
5. **Images**: `bash garage-setup.sh https://files.exlibris.world` (an
   empty bucket; step 7 fills it).
6. **Backup access**: from your own computer, the same command as the first
   time:
   ```
   ssh debian@<staging> 'bash /opt/exlibris/backup-target-setup.sh' | ssh debian@<new production> 'umask 077 && cat > /opt/exlibris/backup.env'
   ```
   then on the new server, put the password from the password manager in
   `backup-password` (`nano backup-password`, then `chmod 600 backup-password`).
7. **Files back**: `bash backup.sh restore-files` (the newest day).
8. **Database back**: `bash backup.sh fetch`, then
   `bash db-setup.sh restore-<day>.dump`.
9. **Nightly backup**: `bash backup.sh install`.
10. Check the app, then delete `restore-*.dump`.

Expected time: about an hour, mostly steps 1 to 4.
