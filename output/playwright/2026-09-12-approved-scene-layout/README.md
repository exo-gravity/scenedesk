# Approved scene layout — production page verification

2026-09-12. Product commits: `0f2fdc9`, `d87a7ac`. Local composition also includes the parent's shell `7eaf69e` (local cherry `ea26a37`) and the assistant/media change `9b8b4f9` (local cherry `1a88e22`). Only the two product deltas above belong to this agent.

## Baseline and implemented structure

Read the approved baseline, shared visual language, Mantine rules, scene walkthrough v0.3 and production detail v0.4. Compared the actual prototype source/CSS and approved images `10-storyboard-default`, `11-canvas-default`, `04-compact-storyboard` under `output/playwright/2026-09-10-scene-walkthrough`.

The real scene fills the parent's 34px top bar / 76px rail frame. Its own context header is 56px and mode/tool row is 44px. Storyboard uses a flexible candidate preview, adjacent references from that Take's **fixed** ShotRevision, a bounded creation input and a 92px horizontal strip with current adopted Take thumbnails. IDs remain in detail/history; ordinary status labels do not show short UUIDs. Empty shots keep a real candidate-import entry. A scene without a Canvas uses this same production layout.

Candidate history/media/opinions and scene assistant/media share a single visible dock; the default is closed. Closing auxiliary UI does not discard controller input. The Canvas keeps its full remaining space with a local, scrollable input area; node properties are disclosed on request. Media nodes have a lightweight title above unframed media, a selection outline and reference handles, while text and generation drafts remain distinct. The existing ReactFlow measurement, drag handle, fit/focus, source selection, persistence and generation controllers remain in use.

## Verification

- `npm run build`: passed, including both TypeScript projects and Vite production output.
- `npm run ui:check`: passed; semantic tokens and contrast checks retained.
- 52 existing public behavior tests passed: candidate time, canvas creation/viewport/fixed sources, assistant session, prompt assistance and feedback UI. No DB/media/capacity suite was rerun for this layout-only change.
- `verify-desktop.js` and `verify-recovery.js` ran via the Playwright CLI against the production build at the agent-owned 4316. Results are in `results.json`; browser logs preserve the run details.
- Actual restricted API and an isolated PostgreSQL schema provided project, scene, ShotRevision, Take, canvas, preference and draft facts. Canvas prompt was changed and read back at revision 3, then survived mode switching and page reload. The independent shot prompt survived input collapse, mutually exclusive dock switching, mode switching and reload.

| View | Measured result |
| --- | --- |
| 1512 × 982 storyboard | Main x76/y34, 948px high; preview area 395px; composer 208px; strip 92px ending at y982 |
| 1366 × 768 storyboard + assistant | Dock 360px; preview 221px; composer 178px; strip ends at y768 |
| 1366 × 768 generation expanded | Input area 246px; preview 153px; no preview/composer overlap |
| 1512 × 982 selected Canvas draft | Canvas visible area 520px; with generation panel expanded, 466px |
| Scene without Canvas | Same 948px main, 395px preview and bottom strip |
| Empty shot at 390px | Explicit usable-video entry; no document horizontal overflow; content scrolls vertically |

Final screenshots were visually inspected, not accepted solely by overflow measurements. Dark media has `filter: none`. Before final storyboard screenshots, all five expected thumbnail images were decoded. The dark Canvas screenshot retains the viewport when the assistant opens; opening a dock does not silently pan or reorder content, so content may remain outside that narrower view until the user explicitly fits it.

## Screenshots

- `storyboard-light-1512.png`: default real storyboard with decoded strip.
- `storyboard-dark-assistant-1366.png`: compact dark mode, adjacent fixed reference, one assistant dock, preserved handwritten prompt.
- `storyboard-dark-generation-1366.png`: bounded expanded generation controls and original prompt.
- `canvas-light-selected-1512.png`: lightweight media titles, selected draft, real source edges, local input.
- `canvas-light-generation-1512.png`: generation controls open while the Canvas keeps its space.
- `canvas-dark-assistant-1366.png`: compact dark Canvas and single assistant.
- `storyboard-no-canvas-light-1512.png`: new scene before Canvas creation.
- `storyboard-empty-light-1512.png`, `storyboard-empty-light-390.png`: no candidate, explicit material entry.
- `initial-*`: first visual iteration, retained as diagnostic evidence.

## Findings corrected during inspection

The first compact-generation measurement left only 30px for the preview because the expanded composer used 48dvh. The final product uses a 300px / 32dvh bound and a minimum preview height, with the generation body scrolling locally. The earlier run is preserved in `browser-desktop-first.log`. Media titles were moved from below to above the image to match the approved Canvas. The filmstrip no longer wraps technical IDs into additional lines.

One intermediate harness run selected a hidden retained assistant badge when waiting for “本机已保留”. `browser-desktop-final.log` records that selector timeout. The final run scopes the wait to the visible creation input; no product recovery rule was weakened. An early manual click used an old Playwright element ref after reload and was rejected before any business action.

## Boundaries and resource handoff

This is a **local technical visual fixture**, not real-model or object-storage acceptance. The restricted media authorization route is real; its object-storage adapter returns static repository demonstration files. Relational media rows and their posters are seeded for visual inspection. The video is the repository's four-second color-bar technical preview; the photo reference/posters are approved demo assets. No model or provider submission occurred and no user data was touched. The parent may replace the local static video with an approved still-frame clip for its final visual comparison, separately labelled as local media.

The dedicated 4316 server and its isolated schema remain alive at the parent's explicit request for full-site integration. Login helper: `http://127.0.0.1:4316/__layout_fixture/login`. It sets the technical cookie internally; no credentials are stored in this evidence. Object IDs are in `fixture.json`. The parent owns the subsequent unified dist / browser phase; send SIGTERM to the recorded agent server process after that phase to close it and run schema/role cleanup. User 4311/4312 services were not changed.
