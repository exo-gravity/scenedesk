#!/usr/bin/env bash
# Box-side half of deploy/demo/deploy.sh. The local script uploads this file to
# $SCENEDESK_HOME/bin/demo-remote.sh on every run, so the copy on the box never drifts.
#
#   demo-remote.sh build   <short-sha>
#   demo-remote.sh rollout <short-sha> <full-sha> "<subject>"
#
# build   — implementation note 83 §8: pause the co-hosted platform's worker and scheduler,
#           build api / web / media-worker from the synced source tree, tag them :<short-sha>,
#           prune the build cache, resume the platform. Prints BUILD_DONE rc=<n> last.
# rollout — 83 §9 steps 5–7: keep the running images as :previous, dump the database, tag the
#           new images :demo, provision --apply, read-only audit, both --check entrypoints,
#           up -d --wait, then write DEPLOYED_REVISION. Prints ROLLOUT_DONE last.
set -euo pipefail

HOME_DIR=${SCENEDESK_HOME:-/opt/scenedesk}
SRC_DIR=${SCENEDESK_SRC:-/opt/scenedesk-src}
PLATFORM_DIR=${PLATFORM_COMPOSE_DIR:-/opt/exogravity/infra}
TARGETS=(api web media-worker)

image_name() {
  case "$1" in
    api) echo scenedesk-private-api ;;
    web) echo scenedesk-private-web ;;
    media-worker) echo scenedesk-private-worker ;;
  esac
}

platform_compose() {
  # The demo shares the machine with the platform stack; its two batch services are paused
  # during a build to free memory (83 §8). Skipped when that stack is not present.
  if [ -d "$PLATFORM_DIR" ]; then (cd "$PLATFORM_DIR" && docker compose "$@"); fi
}

cmd=${1:-}
short=${2:-}
if [ -z "$cmd" ] || [ -z "$short" ]; then
  echo "usage: $0 build|rollout <short-sha> [<full-sha> <subject>]" >&2
  exit 2
fi

case "$cmd" in
  build)
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
    full=${3:-$short}
    subject=${4:-}
    cd "$HOME_DIR"

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
    echo "== audit =="
    docker compose --profile operations run --rm --no-deps operations node --import tsx deploy/runtime/audit.ts
    unset SCENEDESK_PROVISION_CONFIG

    echo "== api --check =="
    docker compose run --rm --no-deps api node --import tsx deploy/runtime/api.ts --check
    echo "== media-worker --check =="
    docker compose --profile media run --rm --no-deps media-worker node --import tsx deploy/runtime/media-worker.ts --check

    echo "== up -d --wait =="
    docker compose --profile media up -d --wait --wait-timeout 300
    docker compose ps --format "table {{.Name}}\t{{.Image}}\t{{.Status}}"

    schema=$(docker compose exec -T database psql -U postgres -d scenedesk -Atc \
      "select table_schema from information_schema.tables where table_name='schema_migrations' limit 1")
    migrations=$(docker compose exec -T database psql -U postgres -d scenedesk -Atc \
      "select count(*) from \"$schema\".schema_migrations")
    echo "migrations applied: $migrations"

    cat > DEPLOYED_REVISION <<EOF
revision: $full
subject:  $subject
deployed: $(date -Is) by deploy/demo/deploy.sh (api, web, media-worker rebuilt; migrations applied: $migrations)
previous: ${previous:-unknown} (images kept as :previous${previous:+ and :$previous}; dump before provision: $dump)
EOF
    cat DEPLOYED_REVISION
    echo "ROLLOUT_DONE $(date -Is)"
    ;;

  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
