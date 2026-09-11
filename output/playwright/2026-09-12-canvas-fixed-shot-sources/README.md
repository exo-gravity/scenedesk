# Canvas fixed shot sources — frontend verification

Date: 2026-09-12. Product commit: `db8eb82`, based on merged `7a1296dc541bf214205cab8f2b15ee071daa56aa`.

This evidence uses the production Vite build at port 4316, an isolated `scenedesk-ai-ui` browser, explicit synthetic identity/data and controlled HTTP responses. IndexedDB, React, the workspace, source picker and request/recovery controllers are real. It is **not** API/database/worker/provider or media-decoding acceptance. The parent integration performs those checks. No paid model, root data/service, Take, media execution or capacity test is used here.

## Delivered behavior

- Optional `ImageDraft.shotSources` defaults to an empty list only for older records where the field is absent. Ordered references live in the existing user/session/tab/canvas/node/kind recovery record.
- Browse project scenes (current scene first), then a shot and its exact historical revision. Browsing does not write the selection. Explicit add or replacement fixes one revision per shot; replacement preserves position. Move/remove controls are explicit. Zero through 100 sources are supported.
- Source summaries read the authorized exact revision. Pending/error reads hide cached source text and retain the references. A failed read never silently substitutes an empty list or a current version.
- Image/video/audio canvas plan builders copy the selected references. Preparation captures them before awaiting canvas save. Unknown plan recovery uses the durable original key, body and saved canvas revision, without resolving a new input.
- A new attempt retains the chosen fixed sources and the old plan. Historical plan details use `resolvedInput.shots` and references, independently of the editable selection, live navigation, current shot version or deleted canvas draft.

## Checks

`npm run check` passed **139/139** tests, contract comparison, UI checks, TypeScript and production build: [check.log](check.log). The eight added public behavior tests cover zero/100 sources, duplicate rejection, explicit replacement/order, all three builders, lost plan receipt recovery, a deferred save, failed durable write and historical-plan/draft separation.

The deferred-save unit test attempts an update while preparation is busy; it is not by itself a navigation acceptance claim. Browser navigation/read isolation is documented separately below.

The first full-check log is retained: it rejected an incomplete new Canvas test fixture and a test callback returning void instead of an ImageDraft. The test fixture was completed before the passing check. The earlier standalone failed storage assertion incorrectly assumed initial `load()` durably writes an unchanged empty record; the final test explicitly commits the draft before simulating a disk failure.

## Production browser

[verify-controlled.js](verify-controlled.js) is the Playwright CLI scenario. [result.json](result.json) and [browser-final.log](browser-final.log) record the final passing run.

- Two ordered sources: a different scene's fixed shot first, and the current scene's **old v1** second. A new current v3 arrives later; refresh keeps v1.
- Delayed history GET for the formerly browsed shot completes after browsing another scene/shot. It does not change the new picker target or either saved source.
- Exact revision GET 503 hides source prose but keeps two selected references. Reload after recovery restores both; there is no plan POST during these reads.
- First plan is created by the controlled transport but its response is lost. Refresh sends zero plan POSTs. The explicit recovery uses identical body/key/If-Match even after the current canvas revision changes. It returns the one original plan.
- Explicit next image attempt keeps the selected sources. Removing both produces a valid zero-source plan.
- Switching saved node preference and reloading into video and audio shows independent empty selections; selecting each source generates the correct kind/input. Audio has no resolution field.
- Removing the original image draft and reopening its first plan through canvas history still shows the original two source snapshots, while its later editable draft has no sources.
- Confirmed project 403 on refresh hides the source text. No JS page errors. Five plan POSTs create four controlled plans (one exact replay); zero execute POSTs. Other writes are only existing editing-presence heartbeats.

Inspected screenshots:

- [Selected ordered sources, 1512](selected-1512.png)
- [Fixed version picker, 390](picker-390.png)
- [Original fixed plan sources, 390](fixed-plan-390.png)
- [Deleted draft with original plan reopened, 1512](deleted-draft-history-1512.png) — the viewport shows the deleted draft's canvas and reopened plan section; the source details below are checked by the script and shown in the separate narrow plan screenshot.

The picker and plan wrap at 390 px without horizontal overflow. The existing independently scrolling canvas and generation sections are retained; screenshots may intentionally show a scrolled portion of each section.

## Retained harness failures

- Browser open was attempted while the build was replacing `dist`, before the production build completed; it returned an HTTP response failure. The subsequent run uses the completed build.
- `browser-first.log`: the strict transport guard rejected an unmodeled existing editing-presence heartbeat. The final fixture models its documented target/entries/serverTime response.
- `browser-second.log`: the locator used textbox for a Mantine combobox. It was corrected from the actual accessibility snapshot.
- `browser-third.log`: a source summary and its collapsed full details contain the same text. The assertion now targets the primary summary within the exact selected-source row.
- `browser-fourth.log`: after scrolling, a dropdown option moved during automatic positioning and the pointer click timed out. The final run uses normal keyboard search/ArrowDown/Enter, without forced or hidden clicks. Earlier current-scene and historical-version pointer selections passed.
- `browser-fifth.log` passed the main flow; `browser-final.log` additionally verifies delayed history and the narrow picker. No product code was changed between these browser runs.

Review: release_entry independently read `db8eb82` and reported no blocking findings. Parent owns actual service/worker acceptance, integration docs and final CI/merge.
