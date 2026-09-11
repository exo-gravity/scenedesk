# Private workspace deployment package

This package builds a static production web image, a same-origin HTTPS gateway/API, and a separate media worker for imports and already-received generated files. It does not supply a generation executor, enable a paid model, supply a real identity provider, or represent a completed production deployment.

The original package procedure and credential contract are recorded in [implementation note 47](../docs/implementation/47-private-deployment-package.md). The current image-mainline integration, strict generation audit and independent CI are described in [implementation note 52](../docs/implementation/52-private-deployment-integration.md).

For the first workspace owner after a trusted login, follow [the private operator bootstrap](../docs/implementation/55-private-owner-bootstrap.md). It uses the existing authenticated API, defaults to read-only preflight and requires an explicit apply. An unknown creation is never resent; selecting an existing workspace verifies current ownership without claiming it is the original request result.

Enabled model capability records do not mean this deployment can execute them. The gateway returns `503 GENERATION_EXECUTOR_UNAVAILABLE` for new generation jobs, preserving plan preparation, history and original-file archive recovery. The read-only audit refuses unresolved submissions or archive states without a fixed `generation_media_outputs` record; it never disables capabilities or clears jobs to pass a check.

Check the deployment entrypoints, configuration boundaries and private operator files after `npm ci`:

```sh
sh deploy/check.sh
```

The independent `SceneDesk deployment package` workflow also tests the audit against an isolated PostgreSQL database, builds all three images and runs the API/queue/browser-contract smoke. It does not push an image or deploy external resources.

Build from the repository root:

```sh
docker build -f deploy/Dockerfile --target api -t scenedesk-private-api:local .
docker build -f deploy/Dockerfile --target web -t scenedesk-private-web:local .
docker build -f deploy/Dockerfile --target media-worker -t scenedesk-private-worker:local .
```

Configuration examples deliberately cannot start unchanged. Copy them outside the checkout, replace the placeholders, and mount only each service's own file. Do not run local development setup scripts against a real deployment.

`SCENEDESK_DECODER_SOCKET` is required and must name the absolute socket path of a dedicated decoder daemon (for example `/run/scenedesk-decoder/docker.sock`). Compose has no default host Docker socket. Confirm that daemon owns only the decoder workload before setting `dedicatedDecoderHost: true`; the JSON assertion does not create host isolation. The smoke override mounts its own daemon's socket volume instead.

The isolated local check creates and removes only its own Compose project and volumes. It requires installed Chrome/Chromium for the original browser contract compiler; set `SCENEDESK_SMOKE_CHROME` to its executable if discovery cannot find it. Missing Chrome fails explicitly rather than skipping that check:

```sh
bash deploy/smoke/run.sh
```

Its OIDC service supplies discovery metadata only and cannot authenticate a user. Its dedicated Docker-in-Docker service is a local test harness, not a production deployment recommendation. It uses port 4338, real PostgreSQL TLS, versioned private object storage, separate API/worker storage users and the pinned networkless decoder image. The harness prefetches the pinned decoder image into its dedicated daemon; task execution does not pull images. The harness leaves private diagnostic files under `.runtime/deploy-smoke-*` for local investigation and never prints credentials. Remove that individual directory when the diagnostic retention period ends.

To retain a failed test project for diagnosis, set `SCENEDESK_SMOKE_KEEP_ON_FAILURE=1`; clean it with the exact project name and configuration paths printed/created by that run. The default cleans up its containers and volumes and reports any cleanup failure. Only fixed stage names and exit codes are printed to CI; private runtime files and browser profiles are not uploaded. The browser proof page is mounted only by the smoke override, never included in the production web image; the browser ignores only the harness certificate while separate curl GET/HEAD checks verify TLS using the ephemeral CA. The harness closes its own browser after verifying the serialized DOM, and fails if the assertion does not arrive within 60 seconds.
