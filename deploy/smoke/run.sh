#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
smoke_id="$(date +%s)-$$"
project="scenedesk-deploy-smoke-$smoke_id"
directory="$PWD/.runtime/deploy-smoke-$smoke_id"
node --import tsx deploy/smoke/prepare.ts "$directory"
compose=(docker compose --project-name "$project" --env-file "$directory/compose.env" -f deploy/compose.yaml -f deploy/smoke/compose.yaml --profile media --profile operations)
cleanup() { "${compose[@]}" down --volumes --remove-orphans >"$directory/cleanup.log" 2>&1 || true; }
finish() {
  code=$?
  if [[ "$code" != 0 && "${SCENEDESK_SMOKE_KEEP_ON_FAILURE:-0}" == 1 ]]; then
    printf 'Smoke failed; own project retained for diagnosis: %s\n' "$project"
  else
    cleanup
  fi
  exit "$code"
}
trap finish EXIT
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait database minio storage identity decoder >"$directory/start.log" 2>&1
for attempt in {1..30}; do
  if "${compose[@]}" exec -T decoder docker -H unix:///run/decoder/docker.sock info >/dev/null 2>&1; then break; fi
  sleep 1
done
# Prefetch into this dedicated daemon; worker task containers still use --pull never and --network none.
"${compose[@]}" exec -T decoder docker -H unix:///run/decoder/docker.sock pull mwader/static-ffmpeg@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7 >"$directory/decoder-image.log" 2>&1
"${compose[@]}" exec -T database psql -v ON_ERROR_STOP=1 -U postgres -d scenedesk <"$directory/roles.sql" >"$directory/roles.log" 2>&1
"${compose[@]}" run --rm --no-deps storage-init >"$directory/storage-init.log" 2>&1
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/runtime/provision.ts --apply >"$directory/provision.log" 2>&1
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/media-grants.ts >"$directory/media-grants.log" 2>&1
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/runtime/audit.ts >"$directory/audit.log" 2>&1
"${compose[@]}" run --rm --no-deps api node --import tsx deploy/runtime/api.ts --check >"$directory/api-check.log" 2>&1
"${compose[@]}" run --rm --no-deps media-worker node --import tsx deploy/runtime/media-worker.ts --check >"$directory/worker-check.log" 2>&1
# A nonexistent business identity is a valid stale hint; it proves routing/grants, not decoded output.
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/queue-fixture.ts generated >"$directory/generated-hint.log" 2>&1
"${compose[@]}" up -d --wait api web media-worker >"$directory/application.log" 2>&1
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -o "$directory/index.html" -w '%{http_code}' https://localhost:4338/)
[[ "$status" == 200 ]]
curl --max-time 20 --fail --silent --show-error --cacert "$directory/certs/ca.crt" https://localhost:4338/health/ready >"$directory/ready.json"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.status!=="ok"||r.businessReady!==true||r.completeMvp!==false) process.exit(1)' "$directory/ready.json"
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -o /dev/null -w '%{http_code}' https://localhost:4338/v1/tenants)
[[ "$status" == 401 ]]
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -D "$directory/login-headers" -o /dev/null -w '%{http_code}' https://localhost:4338/v1/auth/login)
[[ "$status" == 302 ]]
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!/location: https:\/\/identity:9443\/authorize/i.test(s)||!/httponly;.*secure/i.test(s)) process.exit(1)' "$directory/login-headers"
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -D "$directory/schema-get-headers" -o "$directory/openapi.json" -w '%{http_code}' https://localhost:4338/design/openapi.json)
[[ "$status" == 200 ]]
status=$(curl --head --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -D "$directory/schema-head-headers" -o /dev/null -w '%{http_code}' https://localhost:4338/design/openapi.json)
[[ "$status" == 200 ]]
node --import tsx deploy/smoke/contract-schema.ts "$directory/openapi.json" "$directory/schema-get-headers" "$directory/schema-head-headers" >"$directory/contract-schema.log" 2>&1
bash deploy/smoke/browser-contract.sh "$directory" >"$directory/browser-contract-result.json"
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -o /dev/null -w '%{http_code}' https://localhost:4338/design/prototype)
[[ "$status" == 404 ]]
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -X POST -o /dev/null -w '%{http_code}' https://localhost:4338/v1/tenants/00000000-0000-0000-0000-000000000001/projects/00000000-0000-0000-0000-000000000002/cut-normalizations)
[[ "$status" == 503 ]]
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -X POST -o "$directory/generation-unavailable.json" -w '%{http_code}' https://localhost:4338/v1/tenants/00000000-0000-0000-0000-000000000001/generation-jobs)
[[ "$status" == 503 ]]
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.code!=="GENERATION_EXECUTOR_UNAVAILABLE") process.exit(1)' "$directory/generation-unavailable.json"
for suffix in generation-plans generation-jobs/00000000-0000-0000-0000-000000000002/recover-archive; do
  status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' "https://localhost:4338/v1/tenants/00000000-0000-0000-0000-000000000001/$suffix")
  [[ "$status" == 401 ]]
done
generated_state=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='media_generation'")
[[ "$generated_state" == 'completed:0' ]]
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/queue-fixture.ts invalid >"$directory/invalid-hint.log" 2>&1
worker_id=$("${compose[@]}" ps -aq media-worker)
for attempt in {1..30}; do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$worker_id")" == false ]]; then break; fi
  sleep 1
done
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$worker_id")" == 1 ]]
invalid_state=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='future_kind'")
[[ "$invalid_state" == 'retry:0' ]]
"${compose[@]}" logs --no-log-prefix media-worker >"$directory/worker-stop.log" 2>&1
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/queue-fixture.ts >"$directory/queue-fixture.log" 2>&1
before=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='media_production'")
if "${compose[@]}" run --rm --no-deps media-worker node --import tsx deploy/runtime/media-worker.ts --check >"$directory/queue-rejection.log" 2>&1; then
  echo 'Expected unsupported queue startup rejection' >&2; exit 1
fi
after=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='media_production'")
[[ "$before" == 'created:0' && "$after" == "$before" ]]
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!s.includes("QUEUE_CONTAINS_UNSUPPORTED_WORK")) process.exit(1)' "$directory/queue-rejection.log"
printf '%s\n' '{"status":"passed","staticHttps":200,"sameOriginBusinessReady":true,"unauthenticatedBusinessRequest":401,"oidcHandshakeSecureRedirect":302,"creativeMediaWorkerReady":true,"generatedMediaGrants":true,"staleGeneratedHintState":"completed:0","prototypeBlocked":404,"publicCanvasSchema":200,"canvasSchemaMatchesBuildAndCompiles":true,"postProductionWriteBlocked":503,"generationSubmissionBlocked":503,"generationSubmissionCode":"GENERATION_EXECUTOR_UNAVAILABLE","planAndArchiveRecoveryReachAuthentication":true,"unsupportedQueueRejectedBeforeClaim":true,"queueStateUnchanged":"created:0","runtimeMalformedHintStopsWorker":true,"runtimeMalformedHintState":"retry:0","identity":"discovery_only_no_login","paidProvidersEnabled":false,"productionReady":false}'
