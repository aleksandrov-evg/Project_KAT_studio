#!/bin/sh
set -eu

required_vars="SSH_HOST SSH_USER SSH_PRIVATE_KEY_BASE64 SSH_KNOWN_HOSTS_BASE64 DB_REMOTE_HOST"
for variable in $required_vars; do
  eval "value=\${$variable:-}"
  if [ -z "$value" ]; then
    echo "$variable must be set" >&2
    exit 1
  fi
done

ssh_port="${SSH_PORT:-22}"
db_remote_port="${DB_REMOTE_PORT:-5432}"
tunnel_port="${TUNNEL_PORT:-15432}"

mkdir -p /run/ssh
printf '%s' "$SSH_PRIVATE_KEY_BASE64" | base64 -d > /run/ssh/id_key
printf '%s' "$SSH_KNOWN_HOSTS_BASE64" | base64 -d > /run/ssh/known_hosts
chmod 600 /run/ssh/id_key /run/ssh/known_hosts

exec ssh -N -T \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/run/ssh/known_hosts \
  -i /run/ssh/id_key \
  -p "$ssh_port" \
  -L "0.0.0.0:${tunnel_port}:${DB_REMOTE_HOST}:${db_remote_port}" \
  "${SSH_USER}@${SSH_HOST}"
