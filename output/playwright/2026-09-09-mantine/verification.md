# Mantine visual sample verification — 2026-09-09

Scope: local React prototype, Mantine migration and shared sample. Dedicated Playwright CLI session `mantine-visual`; no user browser data reset. Production build smoke uses separate localhost:4313 storage. Development URL remains localhost:4311.

## Results

- [Production workflow](production-workflow-result.txt): **9 assertions passed**. Per-shot draft retention, explicit adoption and cut replacement, storyboard/cut ordering isolation, fixed revisions/comments/approval, simulation without automatic adoption.
- [Layout and sample](layout-and-sample-result.txt): **15 assertions passed**. Pointer/keyboard resize, persisted width/collapse, layout/business separation, 1366px action visibility, narrow inspector entry, Form validation, Select in Modal, Escape focus restoration, real 4s technical clip playback, sample selection/state progression and unknown-submission recovery entry.
- [Production-build smoke](final-smoke-result.txt): **7 assertions passed**. Actual primary-button/input paint and dimensions, fixed-width reset, reachable narrow navigation, visible drawer action, lazy route/chunk loading and zero captured runtime errors on visited build routes.
- [Engineering output](engineering-checks.txt): contracts generation check, scoped UI gate, typecheck, Vite production build and existing **9 tests passed**. No database integration run required for these frontend changes; no complete AT-01–51 claim.
- [Audit](npm-audit.json): npm reported **0 vulnerabilities** at this check.
- [Installed licenses](installed-license-evidence.json): core/hooks/form 9.6.0 installed LICENSE files and package metadata all MIT. This direct-package check is not a complete legal review of every dependency.

The UI gate checks 7 migrated source files and 10 specified color pairs. Primary/secondary/muted text against the raised surface measured 12.90/7.83/5.65; filled-button text 9.62; input border 3.27. This does not cover every layered/disabled/hover combination or constitute full accessibility certification.

Final build chunks: React runtime 192.93KB (gzip60.47), Mantine UI302.60KB (gzip94.77), main217.88KB (gzip55.75), lazy design12.81KB (gzip4.96). CSS: main80.80KB, Mantine237.54KB, design4.35KB. These are combined-build output sizes, not a library performance benchmark. Earlier >500KB JS warning was resolved through route/vendor splitting; warning threshold unchanged.

## Visual inspection and fixes

Inspected actual screenshots at1512×982 and1366×900 plus900px drawer. Corrected cards whose auto grid rows clipped metadata, kept the generation footer visible, fixed inherited popup textarea wrapper styling, and restored narrow navigation access. Drawer screenshots require settling the enter transition: the initial capture preceded the end of movement; the final capture shows its settled geometry.

The [first layout attempt](layout-first-attempt.txt) observed only a partial drag and failed its pointer-distance assertion while source formatting/HMR overlapped the walk-through. A clean pointer recheck and the complete15-assertion rerun passed; the initial failure is preserved rather than described as a first-pass success. No vendor source was patched. Double-click restoring mixed-unit ratios did not equal the intended380px default, so the application disables the default ratio reset and handles that explicit layout reset through the public root event/sizes API; final smoke verifies380px.

The final production screenshot exposed a real cascade-order defect: extracted Mantine CSS loaded before the main bundle and established its layer ahead of legacy styles. An early `@layer legacy, mantine;` declaration in the HTML head now fixes order before either stylesheet loads; the source gate checks that declaration. The smoke script now asserts actual button background/32px height and input background/border after load, not just successful navigation. The [before-fix screenshot](production-css-order-before.png) is retained. Follow-up checks initially retained an old document during hash-only navigation and then sampled an in-progress color transition; [stale-document](smoke-stale-document-attempt.txt) and [transition](smoke-transition-attempt.txt) attempts are preserved. The final script explicitly reloads the built document and waits for settled paint, and all7 assertions pass.

## Final screenshots

- [Production1512](final-production-1512.png), [production1366](final-production-1366.png), [generation plan](final-generation-plan.png), [narrow drawer](final-narrow-drawer.png).
- [Controls](final-design-controls.png), [creative components](final-design-creative.png), [states](final-design-states.png).
- Supporting flow evidence: [adoptedB/cutA](03-candidates-adopted-b.png), [replacement confirmation](04-replace-confirmation.png), [edit](05-edit.png), [review](06-review.png), [technical media](11-design-media.png).

## Reproduction and remaining scope

Run `npm run dev:web`, then use Playwright CLI's dedicated session with `run-code --filename` and [production-workflow.js](production-workflow.js) or [layout-and-sample.js](layout-and-sample.js). The production workflow resets only that browser session's example through the UI. Build with `npm run build`, start `npm run preview --workspace @drama/web -- --port 4313`, then run [final-smoke.js](final-smoke.js). The workflow scripts are recorded browser scenarios, not a newly installed test framework or CI screenshot-diff service.

No true video generation, paid submission, server rendering, frame-exact editing, auth, concurrent collaboration, Safari/Firefox matrix, mobile full-editing acceptance or target-user pilot was tested. Original scenes still play a static storyboard sequence. The sample's actual video is a synthetic technical clip, not a generated scene. The canonical visual direction remains open to user review.
