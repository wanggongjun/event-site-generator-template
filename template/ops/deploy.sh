#!/usr/bin/env bash
set -euo pipefail
# Called with a runtime-only tarball. Credentials and business data live outside releases.
event_slug="${1:?event slug}"; event_env="${2:?environment}"; event_domain="${3:?domain}"; event_port="${4:?port}"; event_revision="${5:?revision}"; event_archive="${6:?archive}"
[[ "$event_slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
[[ "$event_env" = staging || "$event_env" = production ]]
[[ "$event_domain" =~ ^[a-z0-9]+([.-][a-z0-9]+)+$ ]]
[[ "$event_port" =~ ^[0-9]{4,5}$ ]] && (( event_port >= 1024 && event_port <= 65535 ))
[[ "$event_revision" =~ ^[a-f0-9]{40}$ ]]
[[ "$event_archive" =~ ^/tmp/event-[a-zA-Z0-9-]+\.tar\.gz$ ]]
event_base="/opt/events/$event_slug/$event_env"
event_service="event-$event_slug-$event_env"
event_release="$event_base/releases/$event_revision"
event_envfile="$event_base/shared/app.env"
test "$(id -u)" = 0
node -e 'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)'
test -f "$event_envfile"
test ! -e "$event_release"
install -d -m 755 "$event_release"
tar -xzf "$event_archive" -C "$event_release"
node --env-file="$event_envfile" --input-type=module - "$event_release" "$event_slug" "$event_env" "$event_domain" "$event_port" <<'JS'
import fs from 'node:fs';
const [root,slug,env,domain,port]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(root+'/config.json'));
if(config.event.slug!==slug||process.env.DEPLOY_ENV!==env||process.env.PUBLIC_ORIGIN!=='https://'+domain||process.env.PORT!==port||process.env.FORUM_OSS_PREFIX!==slug+'/'+env+'/'||process.env.FORUM_DATA_DIR!=='/opt/events/'+slug+'/'+env+'/shared/data')throw Error('Deployment target and resource configuration disagree');
JS
event_node="$(command -v node)"
event_previous="$(readlink -f "$event_base/current" || true)"
event_switched=false
rollback(){ local status=$?; if [[ "$event_switched" = true && "$status" != 0 ]]; then if [[ -n "$event_previous" ]]; then ln -sfn "$event_previous" "$event_base/current"; systemctl restart "$event_service"; else systemctl stop "$event_service" || true; fi; fi; exit "$status"; }
trap rollback EXIT
# Provision HTTPS reverse proxy once from ops/nginx.conf.example; this script never edits other virtual hosts.
test -f "/etc/systemd/system/$event_service.service" || cat > "/etc/systemd/system/$event_service.service" <<UNIT
[Unit]
Description=Activity $event_slug $event_env
After=network.target
[Service]
Type=simple
WorkingDirectory=$event_base/current
EnvironmentFile=$event_envfile
ExecStart=$event_node backend/forum-start.js
Restart=on-failure
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
ln -sfn "$event_release" "$event_base/current"
event_switched=true
systemctl daemon-reload
systemctl enable --now "$event_service"
systemctl restart "$event_service"
for attempt in {1..20}; do if curl -fsS "http://127.0.0.1:$event_port/healthz" >/dev/null; then break; fi; sleep 1; done
curl -fsS "http://127.0.0.1:$event_port/deployment.json" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{if(JSON.parse(s).revision!==process.argv[1])process.exit(1)})' "$event_revision"
curl -fsS "https://$event_domain/deployment.json" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{if(JSON.parse(s).revision!==process.argv[1])process.exit(1)})' "$event_revision"
event_switched=false
echo "Deployed $event_slug $event_env $event_revision"
