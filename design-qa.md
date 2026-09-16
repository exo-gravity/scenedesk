# Canvas navigation / directory design QA

final result: passed

Source: `docs/design/canvas-navigation-2026-09-16/{script,canvas,directory}-approved.png`.
Implementation: production build, isolated real API and synthetic database at `[::1]:4511`.
Viewport: 1487×1058 CSS px, DPR 1. Source pixels: script/directory 1487×1058, canvas 1488×1057 (one-pixel size difference not treated as drift). Screens are unframed. No density resizing used.

## Comparison 1

Reference and implementation pairs were opened together in one multi-image comparison input. Full captures: `output/verification/canvas-navigation/visual/01-script-before.png`, `02-canvas-before.png`, `03-directory-before.png`.

- P2: script paper inherited compact interface text rather than the readable manuscript type scale. Use existing `--ws-reading-size` and simplify the repeated identity label; retain true source metadata. Fixed and recaptured in comparison 2.
- P2: canvas header lost the project context preceding the unified workspace selector. Restore compact project name and separator, hide only at narrow breakpoints. Fixed and recaptured in comparison 2.
- P2: scene directory's primary 新增场次 action inherited a neutral variant. Explicit filled emphasis is required; row 打开画布 stays neutral. Fixed and recaptured in comparison 2.

## Expected differences

This is implementation in an existing product. Keep its accepted 216px collapsible navigation and shared Mantine typography/controls. The generated image's larger global scale is not a new brand system. The isolated fixture contains no generated cafe stills or selected video takes: empty media cells and zero counts are real data states. Do not fabricate production media or counts to match a concept image. Keep real task/result, material and recovery access on the canvas header; the concept image simplifies these but does not authorize removing capabilities.

## Comparison 2

All three final source/implementation pairs were opened together in the same multi-image comparison input at their native dimensions. Reviewed the full views and their script toolbar/reading region, canvas context/selector and directory row/action regions. The three P2 findings above are closed. The directory detail drawer also now gives its close control the accessible name 关闭场次详情.

Final captures under `output/verification/canvas-navigation/visual/`: `01-script-after.png`, `02-canvas-after.png`, `03-directory-after.png`. Supplemental evidence: `04-details.png`, `05-selection-preview.png`, `08-create-scene.png`.

Actual pointer selection in the paper prefilled the exact selected sentence in the confirmation dialog. Escape restored the selection trigger. Directory details opened locally; labelled close restored the original row button. The new-scene dialog exposes title, episode, time, place and summary, with optional continuity/assets collapsed; Escape restores 新增场次. Durable writes and recovery are separately checked through real-API E2E.

390px and 820px canvas menus stay inside the viewport and Escape restores the selector. 390px directory and script wrap their actions and have no horizontal document overflow. Captures: `06-canvas-menu-390.png`, `07-canvas-menu-820.png`, `09-directory-390.png`, `10-script-390.png`. Temporary viewport override was reset after inspection.

The console contained one failed lazy import from a tab left open while its temporary build output was replaced. Reloading the final build resolved it; subsequent script → canvas → directory → details/create navigation produced no new runtime warnings/errors. This was isolated preview build replacement, not a suppressed application error.

## Final gate

No remaining visual P0/P1/P2 findings. The functional resize regression found during verification is fixed: activation reads the live media query rather than a stale rendered breakpoint. Deterministic targeted E2E passed 3/3 without weakening focus checks. The final production build was additionally opened at 820px: Enter opened 项目导航 with focus on its labelled close button; Escape restored the original trigger. Viewport override was reset again. Full-suite execution and CI/merge are recorded separately in implementation note 78.
