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

## Coverage: the studio (`studio-*.spec.ts`)

The creative workspace is the studio at `…/p/{id}/studio` (canvas), `…/studio/script` and `…/studio/shots`; the retired canvas, scene workspace, script page and shot list, and their specs, are gone. Existing studio specs explicitly use 1920×902 so screenshots pair with the LibTV reference frames in `docs/design/assets/2026-09-21-studio-rebuild/`; shot creation also checks its dialog at 1366×768, 820×900 and 390×844. These narrower dialog checks do not establish mobile support for the whole studio. The design decision is `docs/design/creative-workspace-rebuild-libtv-2026-09-21.md`; the slice record with what each case proves is `docs/implementation/85-studio-rebuild.md`.

- `studio-entry.spec.ts` — ST-00: the full-viewport frame with the view switch and environment labels; the old `/canvas` address opens the studio.
- `studio-board.spec.ts` — ST-01: cards created, edited in place, renamed, saved through the engine and restored after a reload; multi-select and shortcuts; a revoked collaborator cannot reopen the cached board or read its document.
- `studio-references.spec.ts` — ST-02: ports, dragged references, purposes, ⊕ continue-creation and reference badges.
- `studio-composer.spec.ts` — ST-03/04: one submission per fixed inputs, refresh recovery, a lost receipt that is only rechecked, revoked access mid-session, and the multi-select batch review.
- `studio-results.spec.ts` — ST-04: results shown inside the card, placement review and archive recovery without re-calling a model.
- `studio-assets.spec.ts` — ST-05: the asset panel lists project assets and media, searches, and drops onto the board.
- `studio-script.spec.ts` — ST-06: current and fixed earlier manuscripts, a real Word upload with exact original download, a selected passage as a fixed excerpt card with a way back; carried over from the old script page: a lost Word commit and a lost excerpt reply recovered through receipts without a second request, the Feishu synthetic provider (fixed preview, fail-closed permissions, pending import across a refresh, lost commit with one receipt), revoked access hiding the cached script and project name, and an archived project with no import controls.
- `studio-shots.spec.ts` — ST-07: a board video becomes a fixed candidate, explicit selection, exact original download, reordering with archived children, the batch handoff; carried over: a concurrent selection keeps the reason for an explicit recheck, and a revoked collaborator cannot display the cached list.
- `studio-shot-creation.spec.ts` — six cases cover the compact directory and studio dialogs, visible controls, cancelled drafts across reload, focus on the created shot while content refresh is pending, optional description and idempotent recovery after a lost real response, legacy detailed drafts with another target scene, and late responses after closing or changing scenes. Transport faults delay or drop actual committed responses without fabricating business results.
- `studio-docks.spec.ts` — ST-08: the assistant and task docks (docked and floating, drafts kept across close and reload, the `assistantOpen` preference), the switch to a scene canvas, the project menu and the account menu.
- `studio-switch.spec.ts` — ST-09: old addresses redirect (`canvas`, `production` with and without a storyboard shot, `script` with a revision or the settings tab, `content?revision=`), the project card and the content page lead to the studio, and an archived project stays readable while the API refuses new edits.

Not carried over from the retired specs, because the interface they exercised is gone: rail keyboard navigation, storyboard deep links, the canvas-switch dialogs, the group panel and plain-text script editing. Three groups are untested for now although their modules are mounted unchanged: invalid Word file recovery and concurrent Word CAS, the handoff refusing an old confirmation after the selection changed, and a lost assistant-application reply. Canonical excerpt selection (Unicode, CRLF, repeated quotes) is a unit test, `tests/script-excerpt-selection.test.ts`.

## Evidence boundaries

Screenshots are review evidence, **not approved pixel baselines**: inspect them against the accepted design before reporting visual acceptance. The suite does not prove external provider execution, media decoding beyond the synthetic MP4 fixtures, or OIDC login. No business response body is fabricated: transport faults are injected only after the real server committed.

## Fixtures and manual harnesses

`startWorkspaceRuntime` accepts optional `media` services for the isolated store (`shot-media.ts`). `shot-list-fixture.ts` and `selected-delivery-fixture.ts` seed shots, takes and synthetic originals through the real API; `continuous-workspace-fixture.ts` and `canvas-generation-fixture.ts` seed a project with controlled model capabilities and a signed-in preview server. The `preview-*.ts` scripts start the same synthetic setups for coordinated manual inspection after building Web; they need a disposable `drama_e2e*` loopback database and `PROVIDER_MODE=mock`, and default to `[::1]` ports so their test-only HttpOnly identity does not overwrite a developer's `127.0.0.1` or `localhost` session.
