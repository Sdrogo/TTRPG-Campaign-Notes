#!/usr/bin/env bash
# Sets up the images bucket in Garage on this server (ticket 73 step 4). Run
# once per server from /opt/exlibris, after a deploy that brought Garage:
#   bash garage-setup.sh https://files.exlibris.world
# Safe to run again: each step checks what is already there.
#
# 1. Writes Garage's RPC secret (garage.env) and turns on the `files`
#    profile and FILES_HOSTS in .env, then starts Garage and reloads Caddy.
# 2. Gives Garage its layout, creates the bucket and a key that can only use
#    that bucket, and adds the S3_* lines to backend.env (sudo: the file
#    belongs to root). The key never has to be copied by hand.
# 3. Restarts the backend so it uses Garage. The objects themselves come
#    from the backup (`bash backup.sh restore-files`, context/restore-runbook.md).
set -euo pipefail

files_host="${1:?usage: garage-setup.sh <public files URL, e.g. https://files.exlibris.world>}"
case "$files_host" in
  https://*) ;;
  *) echo "the files URL must start with https://" >&2; exit 1 ;;
esac
files_host="${files_host%/}"
cd "$(dirname "$0")"

bucket=document-images
key_name=exlibris-backend
garage() { docker compose exec -T garage /garage "$@" 2>/dev/null; }

# Sets KEY=value in .env, replacing an earlier value.
set_env() {
  sed -i "/^$1=/d" .env
  echo "$1=$2" >> .env
}

echo "== 1. Garage and Caddy"
if [ ! -f garage.env ]; then
  (umask 077 && echo "GARAGE_RPC_SECRET=$(openssl rand -hex 32)" > garage.env)
fi
touch .env
set_env COMPOSE_PROFILES files
set_env FILES_HOSTS "$files_host"
# Caddy is recreated because its environment changed (FILES_HOSTS).
docker compose up -d garage caddy
for _ in $(seq 1 20); do
  garage status >/dev/null && break
  sleep 2
done
garage status >/dev/null || { echo "Garage did not start; see: docker compose logs garage" >&2; exit 1; }

echo "== 2. Layout, bucket and key"
if ! garage layout show | grep -q "Current cluster layout version: [1-9]"; then
  node="$(garage node id -q | cut -d@ -f1)"
  # The capacity only weighs nodes against each other; with one node it is
  # not a limit. The disk is.
  garage layout assign -z vps -c 20G "$node" >/dev/null
  garage layout apply --version 1 >/dev/null
fi
garage bucket info "$bucket" >/dev/null || garage bucket create "$bucket" >/dev/null
if ! sudo grep -q '^S3_ACCESS_KEY_ID=' backend.env; then
  garage key info "$key_name" >/dev/null || garage key create "$key_name" >/dev/null
  garage bucket allow --read --write "$bucket" --key "$key_name" >/dev/null
  key_id="$(garage key info "$key_name" --key-id)"
  secret="$(garage key info "$key_name" --secret-key)"
  [ -n "$key_id" ] && [ -n "$secret" ] || { echo "could not read the key" >&2; exit 1; }
  sudo sed -i '/^S3_/d' backend.env
  printf '%s\n' \
    "S3_ENDPOINT=http://garage:3900" \
    "S3_PUBLIC_URL=$files_host" \
    "S3_ACCESS_KEY_ID=$key_id" \
    "S3_SECRET_ACCESS_KEY=$secret" | sudo tee -a backend.env >/dev/null
  echo "key $key_id added to backend.env"
fi

echo "== 3. Restart the backend on Garage"
docker compose up -d --force-recreate backend
echo "done: the backend now uses Garage at $files_host"
