#!/usr/bin/env bash
# Deploy a git ref to the SceneDesk demo box in one command.
#
#   deploy/demo/deploy.sh [ref] [--force] [--dry-run] [--no-fetch]
#
#   ref        commit-ish to deploy; defaults to origin/main
#   --force    rebuild and roll out even when the box already runs this revision
#   --dry-run  resolve, compare with the box and stop before touching it
#   --no-fetch skip `git fetch origin`
#
# Needs the operator's own SSH access to the box (nothing is stored in the repository),
# plus git, rsync and curl. Steps: fetch → compare with the box's DEPLOYED_REVISION →
# git archive → rsync → SHA-256 compare of both trees → build the four images on the box
# (implementation note 83 §8) → pg_dump, provision --apply, audit, --check, up -d --wait
# (83 §9) → public acceptance checks (83 §10). Every step stops the run on failure.
# When the box has secrets/generation.json (written by deploy/demo/enable-generation.sh), the
# rollout also publishes the capability rows and starts the generation executor (remote.sh).
set -euo pipefail

HOST=${SCENEDESK_DEMO_HOST:-root@8.210.171.132}
DOMAIN=${SCENEDESK_DEMO_DOMAIN:-miraland.cc}
REMOTE_SRC=${SCENEDESK_DEMO_SRC:-/opt/scenedesk-src}
REMOTE_HOME=${SCENEDESK_DEMO_HOME:-/opt/scenedesk}
BUILD_TIMEOUT=${SCENEDESK_DEMO_BUILD_TIMEOUT:-1800}

ref=origin/main
force=0
dry=0
fetch=1
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    --no-fetch) fetch=0 ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) ref=$arg ;;
  esac
done

here=$(cd "$(dirname "$0")" && pwd)
cd "$(git -C "$here" rev-parse --show-toplevel)"
for tool in git ssh rsync curl; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done
if command -v sha256sum >/dev/null; then sha=sha256sum; else sha="shasum -a 256"; fi

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
remote() { ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" "$@"; }

step "resolve"
if [ "$fetch" = 1 ]; then git fetch origin --quiet; fi
rev=$(git rev-parse "${ref}^{commit}")
short=$(git rev-parse --short "$rev")
subject=$(git log -1 --format=%s "$rev")
remote true || { echo "cannot reach $HOST over ssh" >&2; exit 1; }
current=$(remote "sed -n 's/^revision: //p' $REMOTE_HOME/DEPLOYED_REVISION 2>/dev/null" || true)
echo "target : $short  $subject"
echo "on box : ${current:-unknown}"
if [ -n "$current" ] && git cat-file -e "$current^{commit}" 2>/dev/null; then
  echo "merges since the deployed revision:"
  git log --merges --format='  %h %ad %s' --date=short "$current..$rev" | head -20
  if git diff --name-only "$current" "$rev" | grep -qE 'migrations/|^apps/api/|^packages/|^deploy/'; then
    echo "note   : api, packages, deploy or migrations changed; provision --apply runs after a fresh dump"
  else
    echo "note   : only web, tests or docs changed"
  fi
fi
if [ "$current" = "$rev" ] && [ "$force" = 0 ]; then
  echo "already deployed; pass --force to rebuild anyway"
  exit 0
fi
if [ "$dry" = 1 ]; then
  echo "dry run: stopping before any change to the box"
  exit 0
fi

step "export $short"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp" "$tmp.local.sums" "$tmp.remote.sums" "$tmp.index.html"' EXIT
git archive --format=tar "$rev" | tar -x -C "$tmp"
echo "$rev" > "$tmp/.deploy-revision"

step "rsync -> $HOST:$REMOTE_SRC"
rsync -az --delete --stats \
  --exclude .git --exclude node_modules --exclude .runtime --exclude output --exclude .venv \
  "$tmp/" "$HOST:$REMOTE_SRC/" | grep -E 'Number of files transferred|Total transferred file size'

step "verify the tree on the box (sha256)"
(cd "$tmp" && find . -type f ! -path './output/*' -print0 | xargs -0 $sha | sort -k2) > "$tmp.local.sums"
remote "cd $REMOTE_SRC && find . -type f ! -path './output/*' -print0 | xargs -0 sha256sum" | sort -k2 > "$tmp.remote.sums"
if ! diff -q "$tmp.local.sums" "$tmp.remote.sums" >/dev/null; then
  echo "the tree on the box differs from $short:" >&2
  diff "$tmp.local.sums" "$tmp.remote.sums" | head >&2
  exit 1
fi
echo "identical: $(wc -l < "$tmp.local.sums" | tr -d ' ') files"

step "upload the box-side script"
remote "mkdir -p $REMOTE_HOME/bin $REMOTE_HOME/logs"
scp -q "$here/remote.sh" "$HOST:$REMOTE_HOME/bin/demo-remote.sh"
remote "chmod +x $REMOTE_HOME/bin/demo-remote.sh"

log="$REMOTE_HOME/logs/build-$short.log"
step "build api / web / media-worker / generation-worker on the box (log: $log)"
# Detached on the box so a dropped ssh session cannot kill a build; followed by polling the log.
remote "nohup setsid $REMOTE_HOME/bin/demo-remote.sh build $short > $log 2>&1 < /dev/null &"
seen=0
started=$(date +%s)
while :; do
  chunk=$(remote "tail -n +$((seen + 1)) $log 2>/dev/null" || true)
  if [ -n "$chunk" ]; then
    seen=$((seen + $(printf '%s\n' "$chunk" | wc -l)))
    printf '%s\n' "$chunk" | grep -E 'START|=== build|naming to|BUILD_|ERROR|error:|npm ERR|Killed' || true
    if printf '%s\n' "$chunk" | grep -q 'BUILD_DONE'; then
      rc=$(printf '%s\n' "$chunk" | sed -n 's/.*BUILD_DONE rc=\([0-9]*\).*/\1/p' | tail -1)
      if [ "$rc" != 0 ]; then echo "build failed (rc=$rc); see $log on the box" >&2; exit 1; fi
      break
    fi
  fi
  if [ $(( $(date +%s) - started )) -ge "$BUILD_TIMEOUT" ]; then
    echo "build did not finish within ${BUILD_TIMEOUT}s; it may still be running on the box ($log)" >&2
    exit 1
  fi
  sleep 10
done

rollout_log="$REMOTE_HOME/logs/rollout-$short.log"
step "rollout on the box (log: $rollout_log)"
safe_subject=$(printf '%s' "$subject" | tr -d "'\\\\")
# The executor's tenant when the demo database has several active ones (remote.sh generation_tenant).
tenant_env=""
if [ -n "${SCENEDESK_GENERATION_TENANT:-}" ]; then
  [[ $SCENEDESK_GENERATION_TENANT =~ ^[0-9a-f-]{36}$ ]] || { echo "SCENEDESK_GENERATION_TENANT must be a uuid" >&2; exit 2; }
  tenant_env="SCENEDESK_GENERATION_TENANT=$SCENEDESK_GENERATION_TENANT "
fi
remote "set -o pipefail; $tenant_env$REMOTE_HOME/bin/demo-remote.sh rollout $short $rev '$safe_subject' 2>&1 | tee $rollout_log" \
  | grep -vE '^[[:space:]]*$|Container .* (Creating|Created|Waiting|Running|Starting|Started|Recreate|Recreated|Healthy)[[:space:]]*$'

step "acceptance (83 §10)"
fail=0
check() {
  if [ "$2" = 1 ]; then printf '  ok    %s %s\n' "$1" "$3"; else printf '  FAIL  %s %s\n' "$1" "$3"; fail=1; fi
}
base="https://scenedesk.$DOMAIN:8443"
ready=$(curl -sS -m 20 "$base/health/ready" || true)
check "health/ready businessReady:true" "$([[ $ready == *'"businessReady":true'* ]] && echo 1 || echo 0)" "$ready"
code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$base/" || true)
check "GET / -> 200" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$base/v1/tenants" || true)
check "GET /v1/tenants -> 401" "$([ "$code" = 401 ] && echo 1 || echo 0)" "$code"
hdrs=$(curl -s -m 20 -D- -o /dev/null "$base/v1/auth/login" || true)
login_ok=0
if grep -qi '^HTTP/[0-9.]* 302' <<<"$hdrs" \
  && grep -qi "^location: https://scenedesk-id.$DOMAIN:9444/authorize" <<<"$hdrs" \
  && grep -qi '^set-cookie:.*httponly' <<<"$hdrs" && grep -qi '^set-cookie:.*secure' <<<"$hdrs"; then login_ok=1; fi
check "login -> 302 to identity, Secure+HttpOnly cookie" "$login_ok" ""
issuer=$(curl -s -m 20 "https://scenedesk-id.$DOMAIN:9444/.well-known/openid-configuration" | head -c 200 || true)
check "identity discovery issuer" "$([[ $issuer == *"\"issuer\":\"https://scenedesk-id.$DOMAIN:9444\""* ]] && echo 1 || echo 0)" ""
cors=$(curl -s -m 20 -D- -o /dev/null -X OPTIONS -H "Origin: $base" -H "Access-Control-Request-Method: POST" \
  "https://scenedesk-media.$DOMAIN:9443/scenedesk-private-media/" || true)
check "media CORS allows $base" "$(grep -qi "^access-control-allow-origin: $base" <<<"$cors" && echo 1 || echo 0)" ""
tls=$(curl -s -m 20 -o /dev/null -w '%{ssl_verify_result}' "$base/" || true)
check "TLS chain verifies" "$([ "$tls" = 0 ] && echo 1 || echo 0)" "ssl_verify_result=$tls"
modified=$(curl -s -m 20 -D- -o "$tmp.index.html" "$base/" | sed -n 's/^[Ll]ast-[Mm]odified: //p' | tr -d '\r')
entry=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' "$tmp.index.html" | head -1 || true)
echo "  web bundle: ${entry:-?} (Last-Modified: ${modified:-?})"
if remote "test -f $REMOTE_HOME/secrets/generation.json"; then
  status=$(remote "cd $REMOTE_HOME && docker compose --profile generation ps --format '{{.Status}}' generation-worker" || true)
  check "generation-worker healthy" "$([[ $status == *healthy* ]] && echo 1 || echo 0)" "$status"
fi
if [ "$fail" != 0 ]; then echo "acceptance failed; the box is running $short, investigate or roll back" >&2; exit 1; fi

step "done: $short is live at $base"
echo "rollback: on the box tag scenedesk-private-{api,web,worker,generation}:previous back to :demo and run"
echo "          'docker compose --profile media --profile generation up -d' in $REMOTE_HOME; DEPLOYED_REVISION names the dump taken before provision."
