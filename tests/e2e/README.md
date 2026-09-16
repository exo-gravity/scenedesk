# Creative workspace browser regressions

This suite supports [the core acceptance matrix](../../docs/implementation/73-creative-workspace-e2e.md). It exercises the **production Vite build**, actual Fastify routes and a freshly migrated PostgreSQL schema with restricted API and authentication roles. No business HTTP response is mocked. Each test gets synthetic users, its own tenant/project, immutable script history, a scene and a text-only character asset. No existing local/demo/customer data or paid models are used.

Run against a disposable database named `drama_e2e` or `drama_e2e_*`:

```sh
npm ci
npx playwright install --with-deps chromium
DATABASE_URL=postgresql://workspace_e2e:synthetic_ci_only@127.0.0.1:5432/drama_e2e_ci PROVIDER_MODE=mock npm run test:e2e
```

The database provisioner needs schema and role creation rights, matching existing integration tests. Those credentials are never given to the API: runtime queries use a generated `NOSUPERUSER NOBYPASSRLS` role. The harness rejects non-loopback databases; do not point it at any personal or deployed database. No `.env` file is loaded. The runner serves built Web on loopback port 4461 (`SCENEDESK_E2E_PORT` overrides it) and API on a dynamically allocated loopback port. Both servers and the schema/roles are torn down in reverse order, including setup failures; CI also discards its PostgreSQL service. Tests are serial and fail without retries so an intermittent regression cannot silently pass.

Synthetic identities are issued in the test process, then an HttpOnly session cookie is installed in a fresh browser context. No bootstrap endpoint, login bypass, or test identity is added to production code. OIDC login itself remains covered by the separate identity integration tests. The fixture never prints or saves session values; trace, video and storage-state recording are disabled. CI uploads only screenshots of synthetic content and assertion context, retained seven days. Each run writes a new `output/playwright/<timestamp-and-process-id>/results/` directory; CI supplies its unique run/attempt ID through `SCENEDESK_E2E_RUN_ID`. Use a fresh ID if overriding it locally. `output/playwright/` is ignored by Git.

## Initial coverage

- CW-01: project card → script → canvas → existing scene canvas → create the actual board → text node → save → public API readback → refresh → guarded exit → project assets → fixed asset detail, with the project navigation retained. The preview proxies `/design/openapi.json` as well as business routes, so the real browser contract compiler participates in the save.
- CW-01: compact rail, 820 px and 390 px drawers, Enter, trapped keyboard focus, Escape and restored trigger focus.
- CW-02: historical script read, read-only controls and fixed deep-link refresh without changing current history.
- CW-02: unsaved draft → navigate away/back → explicit restore → refresh → restore → save one new immutable revision → refresh without stale draft recovery.
- CW-02: a real concurrent server revision preserves a local draft and prevents saving until explicit rebase.
- CW-01/02: revoke a collaborator through the API after reading; subsequent navigation must hide cached script and project identity. Unauthorized API reads must be denied.
- CW-02: archived project remains readable without script editing.

The fixture exports `WorkspaceRuntime` and `WorkspaceFixture` from [fixture.ts](fixture.ts) for subsequent canvas and document-import tests. Extend seed data through the authenticated API; add storage/worker fixtures only when a flow actually needs them. Keep test-only bootstrap confined to this directory and `tests/support`. Browser tests should assert user-visible outcomes and durable public reads, not component internals.

## Evidence boundaries

Screenshots are attached for desktop script (light/dark), the saved scene canvas, asset detail and both drawer widths. These are review evidence, **not approved pixel baselines**: inspect them against the accepted design before reporting visual acceptance. The initial suite does not prove document import, canvas generation, external provider execution, media decoding, OIDC login, or full refactor acceptance. The matrix marks those separate gates. CI run links and actual pass/fail evidence belong in the implementation progress record after execution, not in this file as assumed results.


## Word import coverage

`docx.spec.ts` adds real local-file upload, pre-import preview, exact original download bytes/SHA-256, immutable updated/history reading, invalid-file draft recovery, concurrent-content CAS recovery and one explicitly labelled transport-fault test. That fault sends the real authenticated import request and drops its response only after the actual server committed; refresh must recover with a read-only domain receipt and exactly one import POST. No success response body is fabricated. Synthetic Word fixtures are in `tests/fixtures/scripts/`; actual team Word templates remain a separate acceptance gate.
