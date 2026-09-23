#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
smoke_id="$(date +%s)-$$"
project="scenedesk-deploy-smoke-$smoke_id"
directory="$PWD/.runtime/deploy-smoke-$smoke_id"
compose=(docker compose --project-name "$project" --env-file "$directory/compose.env" -f deploy/compose.yaml -f deploy/smoke/compose.yaml --profile media --profile operations)
phase="prepare"
resources_started=false
stage() { phase="$1"; printf '{"status":"running","stage":"%s"}\n' "$phase"; }
cleanup() {
  if [[ "$resources_started" == true ]]; then
    "${compose[@]}" down --volumes --remove-orphans >"$directory/cleanup.log" 2>&1 || return $?
  fi
}
finish() {
  code=$?
  if [[ "$code" != 0 ]]; then
    printf '{"status":"failed","stage":"%s","exitCode":%s}\n' "$phase" "$code" >&2
  fi
  if [[ "$code" != 0 && "${SCENEDESK_SMOKE_KEEP_ON_FAILURE:-0}" == 1 ]]; then
    printf 'Smoke failed; own project retained for diagnosis: %s\n' "$project"
  else
    if ! cleanup; then
      printf '{"status":"failed","stage":"cleanup","code":"SMOKE_RESOURCE_CLEANUP_FAILED"}\n' >&2
      code=1
    fi
  fi
  exit "$code"
}
trap finish EXIT
stage prepare
node --import tsx deploy/smoke/prepare.ts "$directory"
stage compose_configuration
"${compose[@]}" config --quiet >"$directory/compose-config.log" 2>&1
stage infrastructure
resources_started=true
"${compose[@]}" up -d --wait database minio storage identity decoder >"$directory/start.log" 2>&1
stage decoder_ready
for attempt in {1..30}; do
  if "${compose[@]}" exec -T decoder docker -H unix:///run/decoder/docker.sock info >/dev/null 2>&1; then break; fi
  sleep 1
done
stage decoder_image
# Prefetch into this dedicated daemon; worker task containers still use --pull never and --network none.
"${compose[@]}" exec -T decoder docker -H unix:///run/decoder/docker.sock pull mwader/static-ffmpeg@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7 >"$directory/decoder-image.log" 2>&1
stage database_roles
"${compose[@]}" exec -T database psql -v ON_ERROR_STOP=1 -U postgres -d scenedesk <"$directory/roles.sql" >"$directory/roles.log" 2>&1
stage storage_setup
"${compose[@]}" run --rm --no-deps storage-init >"$directory/storage-init.log" 2>&1
stage provision
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/runtime/provision.ts --apply >"$directory/provision.log" 2>&1
stage media_grants
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/media-grants.ts >"$directory/media-grants.log" 2>&1
stage deployment_audit
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/runtime/audit.ts >"$directory/audit.log" 2>&1
stage api_preflight
"${compose[@]}" run --rm --no-deps api node --import tsx deploy/runtime/api.ts --check >"$directory/api-check.log" 2>&1
stage worker_preflight
"${compose[@]}" run --rm --no-deps media-worker node --import tsx deploy/runtime/media-worker.ts --check >"$directory/worker-check.log" 2>&1
stage generated_hint
# A nonexistent business identity is a valid stale hint; it proves routing/grants, not decoded output.
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/queue-fixture.ts generated >"$directory/generated-hint.log" 2>&1
stage application_start
"${compose[@]}" up -d --wait api web media-worker >"$directory/application.log" 2>&1
stage static_and_authentication
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -o "$directory/index.html" -w '%{http_code}' https://localhost:4338/)
[[ "$status" == 200 ]]
curl --max-time 20 --fail --silent --show-error --cacert "$directory/certs/ca.crt" https://localhost:4338/health/ready >"$directory/ready.json"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.status!=="ok"||r.businessReady!==true||r.completeMvp!==false) process.exit(1)' "$directory/ready.json"
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -o /dev/null -w '%{http_code}' https://localhost:4338/v1/tenants)
[[ "$status" == 401 ]]
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -D "$directory/login-headers" -o /dev/null -w '%{http_code}' https://localhost:4338/v1/auth/login)
[[ "$status" == 302 ]]
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!/location: https:\/\/identity:9443\/authorize/i.test(s)||!/httponly;.*secure/i.test(s)) process.exit(1)' "$directory/login-headers"
stage canvas_schema
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -D "$directory/schema-get-headers" -o "$directory/openapi.json" -w '%{http_code}' https://localhost:4338/design/openapi.json)
[[ "$status" == 200 ]]
status=$(curl --head --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -D "$directory/schema-head-headers" -o /dev/null -w '%{http_code}' https://localhost:4338/design/openapi.json)
[[ "$status" == 200 ]]
node --import tsx deploy/smoke/contract-schema.ts "$directory/openapi.json" "$directory/schema-get-headers" "$directory/schema-head-headers" >"$directory/contract-schema.log" 2>&1
stage browser_contract
bash deploy/smoke/browser-contract.sh "$directory" >"$directory/browser-contract-result.json"
stage gateway_boundaries
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -o /dev/null -w '%{http_code}' https://localhost:4338/design/prototype)
[[ "$status" == 404 ]]
status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -X POST -o /dev/null -w '%{http_code}' https://localhost:4338/v1/tenants/00000000-0000-0000-0000-000000000001/projects/00000000-0000-0000-0000-000000000002/cut-normalizations)
[[ "$status" == 503 ]]
# Job submission is no longer a gateway rule: the API itself answers 503 GENERATION_EXECUTOR_UNAVAILABLE
# for verified-provider plans unless api.json sets generationExecutor (tests/integration/verified-plan.test.ts);
# unauthenticated it reaches authentication like every other business route.
for suffix in generation-jobs generation-plans generation-jobs/00000000-0000-0000-0000-000000000002/recover-archive; do
  status=$(curl --max-time 20 --silent --show-error --cacert "$directory/certs/ca.crt" -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' "https://localhost:4338/v1/tenants/00000000-0000-0000-0000-000000000001/$suffix")
  [[ "$status" == 401 ]]
done
stage generated_hint_completion
generated_state=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='media_generation'")
[[ "$generated_state" == 'completed:0' ]]
stage runtime_invalid_hint
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
stage unsupported_queue_preflight
"${compose[@]}" run --rm --no-deps operations node --import tsx deploy/smoke/queue-fixture.ts >"$directory/queue-fixture.log" 2>&1
before=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='media_production'")
if "${compose[@]}" run --rm --no-deps media-worker node --import tsx deploy/runtime/media-worker.ts --check >"$directory/queue-rejection.log" 2>&1; then
  echo 'Expected unsupported queue startup rejection' >&2; exit 1
fi
after=$("${compose[@]}" exec -T database psql -At -U postgres -d scenedesk -c "SELECT state::text||':'||retry_count FROM scenedesk_queue.job WHERE data->>'taskKind'='media_production'")
[[ "$before" == 'created:0' && "$after" == "$before" ]]
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8"); if(!s.includes("QUEUE_CONTAINS_UNSUPPORTED_WORK")) process.exit(1)' "$directory/queue-rejection.log"
stage completed
printf '%s\n' '{"status":"passed","staticHttps":200,"sameOriginBusinessReady":true,"unauthenticatedBusinessRequest":401,"oidcHandshakeSecureRedirect":302,"creativeMediaWorkerReady":true,"generatedMediaGrants":true,"staleGeneratedHintState":"completed:0","prototypeBlocked":404,"publicCanvasSchema":200,"canvasSchemaMatchesBuildAndCompiles":true,"postProductionWriteBlocked":503,"generationSubmissionReachesAuthentication":401,"planAndArchiveRecoveryReachAuthentication":true,"unsupportedQueueRejectedBeforeClaim":true,"queueStateUnchanged":"created:0","runtimeMalformedHintStopsWorker":true,"runtimeMalformedHintState":"retry:0","identity":"discovery_only_no_login","paidProvidersEnabled":false,"productionReady":false}'
