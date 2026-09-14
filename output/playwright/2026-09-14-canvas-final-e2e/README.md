# Canvas end-to-end review

This is actual browser testing against a synthetic PostgreSQL/MinIO/API fixture. The retained “旧钥匙 · 完整演示” project is not a mutation or failure-injection target. All assistant/video executions are explicitly labelled local technical fixtures; paid provider calls remain zero.

## First browser batch

Web source: `5a8540a7ae1b76dc6ae4c2208974aab0fa1fec92`, `/assets/index-DARG20sN.js`, index SHA-256 `f7e244d3bbfd24230dd4a61e02593f5b0d855f04727a480edd232c7bca7e1007`. Existing fixture API process is still the earlier `e9825a1` candidate. The forthcoming conversation-source API requires a new fixture and separate acceptance.

- At 1280 × 720, selecting a draft shows its short tools; explicit Edit opens a 400 × 280 editor. With two actual references, model, specification and Prepare remain visible. See `two-reference-editor-1280.jpg` (visually inspected).
- Editing draft A and selecting text B retains A's named editor and input. Refresh retains the edited draft and selected B. The viewport remains `translate(36px, 30px) scale(0.8)` and the visible zoom reads 80%.
- The initial assistant is visibly a floating form, recorded in `assistant-before-form-floating.jpg`. This failed the user's latest conversation/sidebar expectation and was replaced; it is not an approved final screenshot.
- Explicitly adding one text node fixes its r3 source. One assistant plan with an empty `shotSources` list and one local execution produces one saved suggestion.
- A suggested replacement is reviewed against canvas r3. Editing the target afterward saves r4; confirming the old review is refused, creates no application receipt, and retains the hand-written text. See `application-review-before-conflict.txt` and `application-conflict-result.txt`.
- Explicitly selecting Append and reviewing again uses the current r4 text. Confirmation saves r5 and exactly one receipt. A read-only database audit verifies that only the target prompt changed; edges, groups, other nodes and the model were preserved. See `server-application-evidence.json` and `application-explicit-success.txt`.

These checks do not yet establish the new sidebar, continuous follow-up conversation, all responsive states, or a fully green final release. Earlier editor-slice results and failures remain in `../2026-09-14-canvas-contextual-editor/`.


## Final conversation and sidebar

Separate fixture `8461be00-d4d8-44f0-97fa-19a816d620c1` runs API source `af84347`. Root tested the actual `13c30f4` production frontend, with subsequent fixes individually retested below. The request/SQL evidence contains only synthetic data. No demonstration-project content was changed by these tests.

- At the actual 1280 × 720 viewport, opening the assistant gives it a flush 360 px right column, full available height, without radius or shadow. The canvas width changes from 1212 to 852 while `translate(36px, 30px) scale(0.8)` and its one selected object remain unchanged. Closing restores the width and preserves both. See the initial/close geometry files and visually inspected light/dark screenshots.
- Ordinary selection adds no attachment. Explicitly adding the text object fixes canvas r2. The first message prepares one plan; explicit confirmation performs one local assistant execution and displays the actual saved r1 suggestion.
- Explicit Append application advances canvas r2 to r3. A database deep comparison proves only the chosen draft prompt changed; all other node fields, edges, groups and model settings are preserved.
- Explicit “基于这份建议继续” fixes the first artifact/r1. Sending with stale r2 attachments is refused before a new plan POST and preserves the second message. Explicitly reviewing and accepting the current attachments changes only the next message's source to r3.
- The second confirmed plan resolves the exact previous artifact body and original instruction. Both plans have zero shot sources. Refresh restores both messages and actual saved replies, the fixed previous suggestion and a third, unsent composer message. No third plan is created.
- `server-chat-evidence.json` and `server-chat-assertions.json` record these durable checks. `requests-before-stale-send.json` and `requests-after-stale-send.json` show no extra POST on the stale send.

## Defects found and retested

1. On `13c30f4`, Escape did not leave focused node editing because the focus trap replaced an inner ref. Fixed in `bfcee38`: actual Chrome checks at 1440 × 900 confirm Escape closes the inner video specification dialog first; a subsequent Escape in the prompt leaves focus mode and retains the local editor.
2. At 390 × 844, the assistant initially ended at y658 because legacy workspace height won the layout cascade. The files `chat-sidebar-390.png` and `chat-sidebar-390-geometry.json` deliberately preserve that failure. Fixed in `3a9239c`; actual Chrome geometry is x60..390 and y122.695..844, with client/scroll width 330 and document width 390. `chat-sidebar-full-height-390.png` was visually inspected. Results also fit their 305 px available panel width.
3. Root explicitly generated one local 9-second video, played it through 0:09/0:09, and confirmed one placement. The result retained the original draft and was correctly labeled “视频 · 成果已就绪”. However, its origin-relative default point overlapped the existing video. `video-located-1440.png` records this failure, not an approved layout. The placement correction and its final retest are recorded below when completed.

An earlier editor-agent run observed one preference PUT 422 without a captured response body. Subsequent saves succeeded and root did not reproduce it; its cause is unclassified, not claimed fixed. Fixture startup/media test failures, unchanged processing limits and independent Linux CI validation are documented in `startup-history.md` and the adjacent media regression record. These local technical executions do not establish real model quality or external deployment acceptance.


## Final result placement and brand casing

Frontend `f71e102`, API `af84347` (materialization constants remain exactly 320/340): root preserved the first job and explicitly prepared/executed a second local video job. The review proposed **(1338, 30)**, beyond every existing node. Explicit confirmation added one node and advanced canvas r5 to r6. The new result is separate from all existing nodes; the first overlapping placement is intentionally not rewritten.

`placement-final-server-evidence.json` verifies six durable nodes, two distinct succeeded video jobs with ready 9-second media, every existing position unchanged, unchanged edges/groups, and horizontal non-intersection between the new result and every previous node. `placement-new-review.txt`, `placement-final-dom.txt` and the visually inspected `placement-final-1440.png` record the actual UI. The screenshot's overlapping old pair on the left is the preserved pre-fix placement; the newly selected video on the right has the corrected gap.

The actual page shows **SceneDesk** in navigation and `编辑器独立验收 · 镜头制作 · SceneDesk` in its title. The final casing correction changes frontend display only; internal storage keys, backend names and repository paths retain their existing values. Public fixture counts are two assistant and two video executions, with zero provider calls.

Chrome automation intermittently timed out on Runtime.evaluate during compact-editor actions. The state was re-read before repeating any action; preparation/confirmation was completed in the same session's focus view. This is recorded as an automation limitation, not claimed as a diagnosed product defect.


## Final recovery guard and full local check

`32de5e1` additionally fixes the prior materialization recovery boundary: an original unknown request receiving a later version refusal remains unknown with the same key, body and revision. Only a verified first review submission can become a conflict. The four public state/restore tests cover loss after a committed effect, refresh without POST, later 412 without re-positioning, and successful same-identity recovery. Full `npm run check` passes **184/184**, contract consistency, UI rules, both typechecks and production build; see `check-32de5e1.log`.


Final production build `32de5e1` was reloaded in the actual IAB conversation after the recovery change: both original messages/replies and the unsent next message remain visible (`final-build-chat-restored.txt`). Navigation and title display **SceneDesk**. The final build fingerprint and sanitized request summary are captured separately. Local user preview on 4311 and its API/generation worker were switched to this source, and HTTP readiness passed; the media worker and OIDC service remained running.


Both owned browser fixtures were stopped after evidence capture; cleanup reports closed=true with no failures/errors, and their named PostgreSQL/MinIO containers are gone. The retained demo and unrelated containers remain running. During the final local preview restart, launching Vite from the repository root briefly omitted the web proxy configuration; this was corrected to `apps/web` before delivery. Readiness now checks `/health/ready` through port 4311 and requires the actual JSON business-ready response, rather than only an HTML 200.
