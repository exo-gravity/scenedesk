#!/usr/bin/env bash
# Box-side half of deploy/demo/deploy.sh. The local script uploads this file to
# $SCENEDESK_HOME/bin/demo-remote.sh on every run, so the copy on the box never drifts.
#
#   demo-remote.sh build   <short-sha>
#   demo-remote.sh rollout <short-sha> <full-sha> "<subject>"
#   demo-remote.sh smoke   <minimax|volcengine> <image|video> <out-subdir>
#   demo-remote.sh enable  <profileId>...
#
# build   — implementation note 83 §8: pause the co-hosted platform's worker and scheduler,
#           build api / web / media-worker / generation-worker from the synced source tree,
#           tag them :<short-sha>, prune the build cache, resume the platform. Prints BUILD_DONE rc=<n> last.
# rollout — 83 §9 steps 5–7: keep the running images as :previous, dump the database, tag the
#           new images :demo, provision --apply, read-only audit, the --check entrypoints,
#           up -d --wait, then write DEPLOYED_REVISION. Prints ROLLOUT_DONE last.
#           When $SCENEDESK_HOME/secrets/generation.json exists (deploy/demo/enable-generation.sh
#           writes it) the rollout also publishes the capability rows for the code profiles
#           (disabled), runs generation-worker --check, audits with --generation-executor and
#           starts the `generation` profile; without that file nothing about generation changes.
# smoke   — PAID: scripts/verified-smoke.ts inside the operations image, one vendor task,
#           evidence under $SCENEDESK_HOME/output/verified/<out-subdir>/ (record.json is redacted).
# enable  — scripts/provision-verified-capabilities.ts --enable for the named profiles: the only
#           step that lets a paid model produce ready plans. Run it after the smoke passed.
set -euo pipefail

HOME_DIR=${SCENEDESK_HOME:-/opt/scenedesk}
SRC_DIR=${SCENEDESK_SRC:-/opt/scenedesk-src}
PLATFORM_DIR=${PLATFORM_COMPOSE_DIR:-/opt/exogravity/infra}
GENERATION_CONFIG=$HOME_DIR/secrets/generation.json
TARGETS=(api web media-worker generation-worker)

image_name() {
  case "$1" in
    api) echo scenedesk-private-api ;;
    web) echo scenedesk-private-web ;;
    media-worker) echo scenedesk-private-worker ;;
    generation-worker) echo scenedesk-private-generation ;;
  esac
}

platform_compose() {
  # The demo shares the machine with the platform stack; its two batch services are paused
  # during a build to free memory (83 §8). Skipped when that stack is not present.
  if [ -d "$PLATFORM_DIR" ]; then (cd "$PLATFORM_DIR" && docker compose "$@"); fi
}

generation_configured() { [ -f "$GENERATION_CONFIG" ]; }

# The tenant whose capability rows the executor serves: exactly one active tenant, or the
# one named by SCENEDESK_GENERATION_TENANT when the demo database has several.
generation_tenant() {
  if [ -n "${SCENEDESK_GENERATION_TENANT:-}" ]; then echo "$SCENEDESK_GENERATION_TENANT"; return; fi
  local rows
  rows=$(docker compose exec -T database psql -U postgres -d scenedesk -Atc \
    "select id || ' ' || name from drama.tenants where status='active' order by created_at")
  if [ "$(printf '%s\n' "$rows" | grep -c .)" != 1 ]; then
    echo "expected exactly one active tenant; rerun with SCENEDESK_GENERATION_TENANT=<id> set to one of:" >&2
    printf '  %s\n' "$rows" >&2
    return 1
  fi
  echo "${rows%% *}"
}

# scripts/provision-verified-capabilities.ts inside the operations image. It reads the private
# generation.json (bind-mounted read-only) only for the connection identities, and takes the
# migration owner's URL from the provision secret inside the container, so no credential is
# passed on the command line or stored in the container's environment definition.
provision_capabilities() {
  local tenant
  tenant=$(generation_tenant)
  SCENEDESK_PROVISION_CONFIG=$HOME_DIR/secrets/provision.json \
  docker compose --profile operations run --rm --no-deps \
    -v "$GENERATION_CONFIG:/run/generation.json:ro" \
    operations sh -c 'DATABASE_URL=$(node -p "JSON.parse(require(\"fs\").readFileSync(\"/run/secrets/config.json\",\"utf8\")).databaseUrl") exec node --import tsx scripts/provision-verified-capabilities.ts "$@"' \
    provision --config /run/generation.json --tenant "$tenant" "$@"
}

cmd=${1:-}
if [ -z "$cmd" ] || [ -z "${2:-}" ]; then
  echo "usage: $0 build|rollout <short-sha> [<full-sha> <subject>] | smoke <vendor> <kind> <out-subdir> | enable <profileId>..." >&2
  exit 2
fi

case "$cmd" in
  build)
    short=$2
    echo "START $(date -Is) rev=$short"
    platform_compose stop worker scheduler
    trap 'platform_compose start worker scheduler' EXIT
    cd "$SRC_DIR"
    rc=0
    for target in "${TARGETS[@]}"; do
      echo "=== build $target -> $(image_name "$target"):$short $(date -Is)"
      if ! docker build -f deploy/Dockerfile --target "$target" -t "$(image_name "$target"):$short" .; then
        rc=$?
        echo "BUILD_FAILED target=$target rc=$rc"
        break
      fi
    done
    docker builder prune -f >/dev/null
    echo "BUILD_DONE rc=$rc $(date -Is)"
    exit "$rc"
    ;;

  rollout)
    short=$2
    full=${3:-$short}
    subject=${4:-}
    cd "$HOME_DIR"

    # Before any compose command: the base file mirrors the repository's (note 83 §4), so a
    # revision that adds a service or secret must land here before the override is parsed.
    echo "== refresh compose.yaml from the deployed source =="
    cp "$SRC_DIR/deploy/compose.yaml" compose.yaml
    docker compose config --quiet

    echo "== images =="
    for target in "${TARGETS[@]}"; do
      docker image inspect "$(image_name "$target"):$short" --format "$(image_name "$target"):$short {{.Id}}"
    done

    previous=$(sed -n 's/^revision: //p' DEPLOYED_REVISION 2>/dev/null | cut -c1-7 || true)
    echo "== keep running images as :previous${previous:+ and :$previous} =="
    for target in "${TARGETS[@]}"; do
      name=$(image_name "$target")
      if docker image inspect "$name:demo" >/dev/null 2>&1; then
        docker tag "$name:demo" "$name:previous"
        if [ -n "$previous" ]; then docker tag "$name:demo" "$name:$previous"; fi
      fi
    done

    echo "== pg_dump before provision =="
    mkdir -p backups
    dump="backups/pg-scenedesk-pre-$short-$(date +%F-%H%M).sql.gz"
    docker compose exec -T database pg_dump -U postgres scenedesk | gzip > "$dump"
    ls -la "$dump"

    echo "== tag :demo =="
    for target in "${TARGETS[@]}"; do
      docker tag "$(image_name "$target"):$short" "$(image_name "$target"):demo"
    done

    export SCENEDESK_PROVISION_CONFIG=$HOME_DIR/secrets/provision.json
    echo "== provision --apply =="
    docker compose --profile operations run --rm --no-deps operations node --import tsx deploy/runtime/provision.ts --apply
    profiles=(--profile media)
    audit_flags=()
    generation=absent
    if generation_configured; then
      echo "== generation capability rows (new profiles start disabled) =="
      provision_capabilities
      profiles+=(--profile generation)
      audit_flags=(--generation-executor)
      generation=configured
    fi
    echo "== audit =="
    docker compose --profile operations run --rm --no-deps operations node --import tsx deploy/runtime/audit.ts ${audit_flags[@]+"${audit_flags[@]}"}
    unset SCENEDESK_PROVISION_CONFIG

    echo "== api --check =="
    docker compose run --rm --no-deps api node --import tsx deploy/runtime/api.ts --check
    echo "== media-worker --check =="
    docker compose --profile media run --rm --no-deps media-worker node --import tsx deploy/runtime/media-worker.ts --check
    if generation_configured; then
      echo "== generation-worker --check =="
      docker compose --profile generation run --rm --no-deps generation-worker node --import tsx deploy/runtime/generation-worker.ts --check
    fi

    echo "== up -d --wait =="
    docker compose "${profiles[@]}" up -d --wait --wait-timeout 300
    # nginx in the web image resolves `api` once at start (deploy/nginx.conf proxy_pass http://api:4310),
    # so a recreated api container leaves an untouched web container answering 502. Recreating the
    # static web service is instant and safe, so do it on every rollout (seen on the ae58be5 rollout).
    docker compose "${profiles[@]}" up -d --force-recreate --wait --wait-timeout 300 web
    docker compose "${profiles[@]}" ps --format "table {{.Name}}\t{{.Image}}\t{{.Status}}"

    schema=$(docker compose exec -T database psql -U postgres -d scenedesk -Atc \
      "select table_schema from information_schema.tables where table_name='schema_migrations' limit 1")
    migrations=$(docker compose exec -T database psql -U postgres -d scenedesk -Atc \
      "select count(*) from \"$schema\".schema_migrations")
    echo "migrations applied: $migrations"

    cat > DEPLOYED_REVISION <<EOF
revision: $full
subject:  $subject
deployed: $(date -Is) by deploy/demo/deploy.sh (api, web, media-worker, generation-worker rebuilt; migrations applied: $migrations; generation executor: $generation)
previous: ${previous:-unknown} (images kept as :previous${previous:+ and :$previous}; dump before provision: $dump)
EOF
    cat DEPLOYED_REVISION
    echo "ROLLOUT_DONE $(date -Is)"
    ;;

  smoke)
    vendor=$2
    kind=${3:?kind}
    out=${4:?out-subdir}
    generation_configured || { echo "missing $GENERATION_CONFIG; run deploy/demo/enable-generation.sh first" >&2; exit 2; }
    cd "$HOME_DIR"
    # The operations image runs as uid 1000; the evidence directory must be writable by it.
    mkdir -p output/verified && chown 1000:1000 output/verified
    docker compose --profile operations run --rm --no-deps \
      -v "$GENERATION_CONFIG:/run/generation.json:ro" \
      -v "$HOME_DIR/output/verified:/workspace/output/verified" \
      operations node --import tsx scripts/verified-smoke.ts \
        --config /run/generation.json --vendor "$vendor" --kind "$kind" --out "/workspace/output/verified/$out"
    echo "SMOKE_DONE $vendor $kind $out"
    ;;

  enable)
    shift
    generation_configured || { echo "missing $GENERATION_CONFIG; run deploy/demo/enable-generation.sh first" >&2; exit 2; }
    cd "$HOME_DIR"
    flags=()
    for profile in "$@"; do flags+=(--enable "$profile"); done
    provision_capabilities "${flags[@]}"
    echo "ENABLE_DONE $*"
    ;;

  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
