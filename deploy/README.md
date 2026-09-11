# Private workspace deployment package

This package builds a static production web image, a same-origin HTTPS gateway/API, and a separate import-media worker. It does not enable a paid model, supply a real identity provider, or represent a completed production deployment.

The tested procedure, exact configuration contract, credential separation, queue boundary and remaining release conditions are recorded in [implementation note 47](../docs/implementation/47-private-deployment-package.md).

Build from the repository root:

```sh
docker build -f deploy/Dockerfile --target api -t scenedesk-private-api:local .
docker build -f deploy/Dockerfile --target web -t scenedesk-private-web:local .
docker build -f deploy/Dockerfile --target media-worker -t scenedesk-private-worker:local .
```

Configuration examples deliberately cannot start unchanged. Copy them outside the checkout, replace the placeholders, and mount only each service's own file. Do not run local development setup scripts against a real deployment.

`SCENEDESK_DECODER_SOCKET` is required and must name the absolute socket path of a dedicated decoder daemon (for example `/run/scenedesk-decoder/docker.sock`). Compose has no default host Docker socket. Confirm that daemon owns only the decoder workload before setting `dedicatedDecoderHost: true`; the JSON assertion does not create host isolation. The smoke override mounts its own daemon's socket volume instead.

The isolated local check creates and removes only its own Compose project and volumes:

```sh
bash deploy/smoke/run.sh
```

Its OIDC service supplies discovery metadata only and cannot authenticate a user. Its dedicated Docker-in-Docker service is a local test harness, not a production deployment recommendation. It uses port 4338, real PostgreSQL TLS, versioned private object storage, separate API/worker storage users and the pinned networkless decoder image. The harness prefetches the pinned decoder image into its dedicated daemon; task execution does not pull images. The harness leaves private diagnostic files under `.runtime/deploy-smoke-*` for local investigation and never prints credentials. Remove that individual directory when the diagnostic retention period ends.

To retain a failed test project for diagnosis, set `SCENEDESK_SMOKE_KEEP_ON_FAILURE=1`; clean it with the exact project name and configuration paths printed/created by that run. The default always removes its containers and volumes.
