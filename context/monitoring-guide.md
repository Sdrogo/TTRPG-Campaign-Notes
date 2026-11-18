# Monitoring guide (ticket 75)

How the monitoring is set up on the two VPSes and how to open it. Design in
`context/feature/75 - Monitoring dashboards.md` (As built) and
`context/architecture.md` → Monitoring. The product owner's step-by-step
copy, in Italian, is `/mnt/project-files/vps/passo-monitoraggio.md`.

## Per server (`/opt/exlibris`)

| | Production (`51.77.150.38`) | Staging (`57.129.179.240`) |
|---|---|---|
| `.env` `COMPOSE_PROFILES` adds | `monitoring` | `monitoring,monitoring-hub` |
| `.env` `MONITOR_NAME` | `prod` | `staging` |
| `monitoring.env` (chmod 600) | `KEY`, `TOKEN`, `LISTEN=45876` | `KEY`, `TOKEN`, `LISTEN=127.0.0.1:45876`, `HUB_URL=http://127.0.0.1:8090` |
| `ufw` | `allow from 57.129.179.240 to any port 45876 proto tcp` | nothing |
| `backend.env` | `ADMIN_USER_IDS=<id>`, `BACKUP_STATUS_FILE=/srv/status/backup-last-ok` | `ADMIN_USER_IDS` with staging's ids only: staging runs no `backup.sh` (the nightly backup goes from production to staging's Garage), so its `/health/backup` stays 404 |

`KEY` and `TOKEN` come from Beszel's "Add system" dialog (one system per
server). After changing `backend.env`: `docker compose up -d
--force-recreate backend`.

## Opening the dashboards

Only through SSH with the product owner's key; nothing is on a public port.

```
ssh -N -L 8090:127.0.0.1:8090 -L 3001:127.0.0.1:3001 -L 8081:127.0.0.1:8081 debian@57.129.179.240
ssh -N -L 8082:127.0.0.1:8081 debian@51.77.150.38
```

Beszel `localhost:8090`, Uptime Kuma `localhost:3001`, Dozzle staging
`localhost:8081`, Dozzle production `localhost:8082`.

## Alerts (email)

- SMTP in Beszel (PocketBase admin `localhost:8090/_/` → Mail settings) and
  in Uptime Kuma (Settings → Notifications, SMTP, default on). The sender is
  a Gmail account with an app password (`smtp.gmail.com:587`, StartTLS; the
  sender address must be that account); the recipient is the product owner's
  Proton address. A free Proton account can receive but cannot send by SMTP.
- Beszel per system: down for 2 min, CPU 90% for 10 min, memory 90% for
  10 min, disk 80%.
- Uptime Kuma, both environments, every minute, 3 retries 30 s apart,
  10 s timeout: API `/health`,
  `/health/ready`, the site, and production's `/health/backup` (hourly); certificate expiry
  notification on. Staging monitors are in a recurring maintenance window
  00:00-09:00 Europe/Rome (the product owner's choice).

## Checks

- `curl -sS -X POST http://127.0.0.1:2375/containers/create` on a server
  answers 403 (the proxy refuses writes).
- Dozzle lists the server's containers. It reads Docker only through
  `DOZZLE_REMOTE_HOST` (no socket); if it shows none, read
  `docker compose logs dozzle`.
- `/health/backup` turns green after the first `backup.sh` run that follows
  the deploy.
