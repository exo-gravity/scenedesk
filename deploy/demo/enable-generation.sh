#!/usr/bin/env bash
# Enable the real paid models (MiniMax H3, Volcengine Seedance / Seedream) on the demo box in one run.
#
#   deploy/demo/enable-generation.sh [--no-smoke] [--skip-deploy]
#
# Needs the operator's own SSH access to the box (like deploy.sh) plus git, rsync and curl here,
# and python3 + jq on the box. Steps:
#   1. asks for the MiniMax and Volcengine Ark API keys without echo. They travel to the box on
#      the ssh channel's stdin — never on a command line, in a log, or in the repository.
#   2. on the box, idempotently: database role scenedesk_generation (password generated there),
#      provision.json generationRole, roles.sql, secrets/generation.json (0400, uid 1000),
#      SCENEDESK_GENERATION_CONFIG in .env and the generation-worker override in compose.demo.yaml
#      (implementation note 83 §5 shape), then `docker compose config --quiet`.
#   3. deploy/demo/deploy.sh --force origin/main: the four images, migrations, the capability rows
#      for the code profiles (disabled), generation-worker --check and the `generation` profile up.
#   4. PAID smoke after an explicit "yes": Seedream 5.0 flash image, Seedance 2.0 mini 5 s video and
#      MiniMax H3 5 s video — about 6 元 in total at the 2026-09 list prices.
#   5. enables the two Volcengine profiles the smoke proved (H3 waits for its measured output sizes
#      in packages/provider/src/verified/profiles.ts), copies the evidence to output/verified/<date>/
#      and prints the H3 stream dimensions when ffprobe is installed.
set -euo pipefail

HOST=${SCENEDESK_DEMO_HOST:-root@8.210.171.132}
REMOTE_HOME=${SCENEDESK_DEMO_HOME:-/opt/scenedesk}
GENERATION_ROLE=scenedesk_generation
SEEDREAM_FLASH=volcengine/doubao-seedream-5-0-flash-260915
SEEDANCE_MINI=volcengine/doubao-seedance-2-0-mini-260615

smoke=1
deploy=1
for arg in "$@"; do
  case "$arg" in
    --no-smoke) smoke=0 ;;
    --skip-deploy) deploy=0 ;;
    -h | --help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

tenant_env=""
if [ -n "${SCENEDESK_GENERATION_TENANT:-}" ]; then
  [[ $SCENEDESK_GENERATION_TENANT =~ ^[0-9a-f-]{36}$ ]] || { echo "SCENEDESK_GENERATION_TENANT must be a uuid" >&2; exit 2; }
  tenant_env="SCENEDESK_GENERATION_TENANT=$SCENEDESK_GENERATION_TENANT "
fi

here=$(cd "$(dirname "$0")" && pwd)
cd "$(git -C "$here" rev-parse --show-toplevel)"
for tool in git ssh scp rsync curl base64; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
remote() { ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" "$@"; }

step "check the box"
remote true || { echo "cannot reach $HOST over ssh" >&2; exit 1; }
remote "command -v python3 >/dev/null && command -v jq >/dev/null && test -f $REMOTE_HOME/secrets/worker.json && test -f $REMOTE_HOME/secrets/provision.json" \
  || { echo "the box needs python3 and jq, and $REMOTE_HOME/secrets/{worker,provision}.json from the runbook" >&2; exit 1; }
existing=$(remote "test -f $REMOTE_HOME/secrets/generation.json && echo yes || echo no")
remote "mkdir -p $REMOTE_HOME/bin"
scp -q "$here/remote.sh" "$HOST:$REMOTE_HOME/bin/demo-remote.sh"
remote "chmod +x $REMOTE_HOME/bin/demo-remote.sh"
# The box's base compose file mirrors the repository's (note 83 §4). It must already declare the
# generation-worker service before compose.demo.yaml may reference it; the rollout refreshes it
# again from the deployed source tree. Only additions, so running services are not recreated.
scp -q deploy/compose.yaml "$HOST:$REMOTE_HOME/compose.yaml"
echo "box reachable; generation.json present: $existing"

step "API keys (typed here, not shown, never logged)"
if [ "$existing" = yes ]; then
  echo "generation.json already exists on the box: press Enter to keep a stored key, or paste a new one to replace it"
fi
printf 'MiniMax API key: '
IFS= read -rs minimax_key
echo
printf 'Volcengine Ark API key: '
IFS= read -rs ark_key
echo
if [ "$existing" = no ] && { [ -z "$minimax_key" ] || [ -z "$ark_key" ]; }; then
  echo "both keys are required the first time" >&2
  exit 1
fi

step "prepare the box (role, generation.json, .env, compose override)"
# Runs as root on the box. Reads the two keys from stdin; prints only what it changed.
prep=$(cat <<'PY'
import json, os, re, secrets, subprocess, sys
home, role = sys.argv[1], sys.argv[2]
if not re.fullmatch(r"[a-z_]+", role): raise SystemExit("bad role name")
minimax_key = sys.stdin.readline().rstrip("\n")
ark_key = sys.stdin.readline().rstrip("\n")
secrets_dir = os.path.join(home, "secrets")
path = os.path.join(secrets_dir, "generation.json")

def load(p):
    with open(p) as f: return json.load(f)

def write_private(p, data, uid=1000, gid=1000):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2); f.write("\n")
    os.chmod(tmp, 0o400); os.chown(tmp, uid, gid); os.replace(tmp, p)

def psql(sql):
    subprocess.run(["docker", "compose", "exec", "-T", "database", "psql", "-v", "ON_ERROR_STOP=1", "-q",
                    "-U", "postgres", "-d", "scenedesk"], input=sql, text=True, check=True, cwd=home,
                   stdout=subprocess.DEVNULL)

changes = []
if os.path.exists(path):
    config = load(path)
    for vendor, key in (("minimax", minimax_key), ("volcengine", ark_key)):
        if key:
            config["vendors"][vendor]["apiKey"] = key
            changes.append(vendor + " apiKey replaced")
    if changes: write_private(path, config)
else:
    password = secrets.token_hex(24)
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='%s') THEN "
         "CREATE ROLE %s LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB; END IF; END $$;\n"
         "ALTER ROLE %s PASSWORD '%s';\n" % (role, role, role, password))
    # roles.sql keeps the runbook's invariant: every SceneDesk role has its CREATE line there (83 §7).
    roles_sql = os.path.join(home, "roles.sql")
    lines = []
    if os.path.exists(roles_sql):
        lines = [l for l in open(roles_sql).read().splitlines() if ("CREATE ROLE " + role + " ") not in l]
    lines.append("CREATE ROLE %s LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '%s';" % (role, password))
    with open(roles_sql, "w") as f: f.write("\n".join(lines) + "\n")
    os.chmod(roles_sql, 0o600)
    worker = load(os.path.join(secrets_dir, "worker.json"))
    config = {
        "databaseUrl": "postgresql://%s:%s@database:5432/scenedesk?sslmode=verify-full" % (role, password),
        "media": worker["media"],
        "vendors": {
            "minimax": {"apiKey": minimax_key, "baseUrl": "https://api.minimax.cn"},
            "volcengine": {"apiKey": ark_key, "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "accountTier": "personal"},
        },
        "connections": [
            {"vendor": "minimax", "connectionId": "13fa5f48-77fb-4243-914c-1f589573703c",
             "connectionVersionId": "8b474f70-fe2c-43a8-932c-8f3255ee5cfa", "accountIdentityLabel": "MiniMax account (demo)"},
            {"vendor": "volcengine", "connectionId": "79df520e-1cd8-4a6b-8165-f00d76c0dc1a",
             "connectionVersionId": "bcace369-236c-4fdc-a008-59a4d84b39ca", "accountIdentityLabel": "Volcengine account (demo)"},
        ],
    }
    write_private(path, config)
    changes.append("database role " + role + " created (password only in roles.sql and generation.json)")
    changes.append("secrets/generation.json written (0400, uid 1000)")

provision_path = os.path.join(secrets_dir, "provision.json")
provision = load(provision_path)
if provision.get("generationRole") != role:
    provision["generationRole"] = role
    st = os.stat(provision_path)
    write_private(provision_path, provision, st.st_uid, st.st_gid)
    changes.append("provision.json generationRole added")

env_path = os.path.join(home, ".env")
env = open(env_path).read()
if not re.search(r"^SCENEDESK_GENERATION_CONFIG=", env, re.M):
    with open(env_path, "a") as f:
        f.write(("" if env.endswith("\n") else "\n") + "SCENEDESK_GENERATION_CONFIG=" + path + "\n")
    changes.append(".env SCENEDESK_GENERATION_CONFIG added")

compose_path = os.path.join(home, "compose.demo.yaml")
compose = open(compose_path).read()
if not re.search(r"^  generation-worker:", compose, re.M):
    block = """  generation-worker:
    # 生成执行器：只在 generation profile 下启动（基础文件已声明），真正付费调用 MiniMax / 火山方舟。
    # 与 media-worker 同样的偏离：on-failure:5 而不是上游的 "no"，配置错误最多重试 5 次就停。
    logging: *logging
    restart: on-failure:5
    mem_limit: 512m
    depends_on:
      database: { condition: service_healthy }
    environment:
      NODE_EXTRA_CA_CERTS: /certs/pki/ca.crt
    volumes:
      - ./secrets/pki:/certs/pki:ro
    extra_hosts:
      # 归档产物要写对象存储（走 edge 的 9443），同样不依赖发夹 NAT。
      - "scenedesk-media.${SCENEDESK_DOMAIN}:host-gateway"

"""
    marker = "\n  # ---- 幕序自带的依赖 ----\n"
    if marker in compose:
        compose = compose.replace(marker, "\n" + block + marker[1:], 1)
    else:
        m = re.search(r"^  database:\n", compose, re.M)
        if not m: raise SystemExit("compose.demo.yaml: no place to insert the generation-worker override")
        compose = compose[:m.start()] + block + compose[m.start():]
    with open(compose_path, "w") as f: f.write(compose)
    changes.append("compose.demo.yaml generation-worker override added")

subprocess.run(["docker", "compose", "config", "--quiet"], cwd=home, check=True)
print("PREP_DONE " + ("; ".join(changes) if changes else "nothing to change"))
PY
)
prep_b64=$(printf '%s' "$prep" | base64 | tr -d '\n')
rotated=0
if [ "$existing" = yes ] && [ -n "$minimax_key$ark_key" ]; then rotated=1; fi
printf '%s\n%s\n' "$minimax_key" "$ark_key" \
  | remote "python3 -c \"\$(printf %s $prep_b64 | base64 -d)\" $REMOTE_HOME $GENERATION_ROLE"
unset minimax_key ark_key

if [ "$deploy" = 1 ]; then
  step "deploy origin/main (four images, migrations, capability rows, executor)"
  bash "$here/deploy.sh" --force
fi

if [ "$rotated" = 1 ]; then
  # Compose does not notice a replaced secret file; a running executor keeps the old key otherwise.
  step "recreate the executor so it reads the replaced key"
  remote "cd $REMOTE_HOME && docker compose --profile generation up -d --force-recreate --wait --wait-timeout 300 generation-worker"
fi

if [ "$smoke" = 0 ]; then
  step "done without the paid smoke"
  echo "rerun without --no-smoke to verify the vendors and enable the models"
  exit 0
fi

step "paid smoke"
echo "This creates three real vendor tasks: Seedream 5.0 flash image (~0.12 元),"
echo "Seedance 2.0 mini 5 s 720p video (~2.5 元) and MiniMax H3 5 s 768P video (~2.5 元)."
printf 'Type yes to spend that now, anything else to stop here: '
read -r answer
if [ "$answer" != yes ]; then
  echo "skipped; the executor is up but no paid model is enabled yet"
  exit 0
fi

date=$(date +%F)
passed=""
failed=""
run_smoke() {
  step "smoke $1 ($2 $3)"
  if remote "$REMOTE_HOME/bin/demo-remote.sh smoke $2 $3 $date/$1"; then passed="$passed $1"; else failed="$failed $1"; fi
}
run_smoke seedream-flash-image volcengine image
run_smoke seedance-mini-video volcengine video
run_smoke minimax-h3-video minimax video

enable=""
case " $passed " in *" seedream-flash-image "*) enable="$enable $SEEDREAM_FLASH" ;; esac
case " $passed " in *" seedance-mini-video "*) enable="$enable $SEEDANCE_MINI" ;; esac
if [ -n "$enable" ]; then
  step "enable the profiles the smoke proved"
  remote "$tenant_env$REMOTE_HOME/bin/demo-remote.sh enable$enable"
fi

step "copy the evidence to output/verified/$date"
mkdir -p "output/verified/$date"
rsync -az "$HOST:$REMOTE_HOME/output/verified/$date/" "output/verified/$date/" || echo "no evidence to copy"
h3="output/verified/$date/minimax-h3-video/result.mp4"
if [ -f "$h3" ] && command -v ffprobe >/dev/null; then
  echo "MiniMax H3 stream (fill packages/provider/src/verified/profiles.ts outputs from this):"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of default=noprint_wrappers=1 "$h3"
fi

step "summary"
echo "passed :${passed:- none}"
echo "failed :${failed:- none}"
echo "enabled:${enable:- none}"
echo "evidence: output/verified/$date/*/record.json (redacted; keep the directory out of git)"
[ -z "$failed" ] || exit 1
