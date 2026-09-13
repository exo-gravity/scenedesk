# Approved asset, media and assistant layout evidence

The product changes are `9b8b4f9`, `01c5bee` and `2bd382d`. This worktree also includes the root shell/theme changes `7eaf69e`, `238f66a`, `7bbf96e` and `30141a8`. The source is the accepted v0.4 asset detail image, `output/playwright/2026-09-10-production-details/06-asset-v2.png`, and the shared approved visual language. This is a real business-page production build with synthetic content, not a prototype or a deployed customer environment.

The root agent's subsequent final integrated build/browser evidence is kept in a separate evidence directory. This packet is the independently recorded asset/media slice and does not replace that combined acceptance.

The asset detail has a full-height 360 px version/reference side panel. Its left side holds the title, media and existing editor; editing replaces the preview and keeps the fixed version context visible. Asset and media lists use light rows/gallery framing. Media colors remain unchanged in dark mode. The assistant's internal controls use compact modes and an on-demand source disclosure; the scene agent owns the outer dock and its final integration evidence.

## Verification

- Web TypeScript, UI checks (135 files), production build and the isolated fixture TypeScript check passed.
- `verify-assets.js` ran in Chromium against the production build and real API/PG/MinIO. It checked v2 → fixed v1 → current v2 without changing the current revision; editing in the left area; close → reopen → explicit recovery of unsaved local text; search; imports; and 1512, 1366 and 390 px layouts. There were zero page errors or business mutations. The single-reference asset work area measured 892 px high with no extra vertical overflow at 1512 × 982.
- The dark-mode check compared the exact image source, filter, opacity and radius before/after switching theme; filter stayed `none` and opacity `1`.
- Visual inspection then found the thumbnail's intrinsic square dimensions were being cropped by its 16:10 slot. The final CSS correction bounds the image within the slot with `object-fit: contain`. The final production build and `verify-media-frame.js` passed: image and slot both measured 211.20 × 131.99 px. The complete square frame is visible with neutral space at its sides.
- All included screenshots were opened and visually inspected. Asset behavior screenshots precede only the final thumbnail CSS correction; the three `media-*-default/complete-frame` images show the final correction. The asset editor screenshot's reference thumbnail is therefore superseded by the final complete-frame follow-up, while its editor/context layout is unchanged.

Representative images:

- `asset-v2-light-1512.png`, `asset-v2-dark-1512.png`: full-height asset detail and media-preserving theme change.
- `asset-editor-1512.png`: left-side editing with the version/reference context retained.
- `asset-v1-history-1512.png`: explicit historical revision inspection.
- `asset-v2-light-1366.png`, `asset-v2-light-390.png`: compact and narrow layouts; narrow mode stacks the context below the media without horizontal page overflow.
- `media-list-complete-frame-1512.png`, `media-detail-default-1512.png`, `media-detail-default-390.png`: final full-frame thumbnail and default media detail.

## Isolated fixture and reproduction

`serve.ts` creates its own PostgreSQL 16 container, MinIO and restricted database roles through the existing test helpers. It imports the repository's approved `key-reference.png` using an actual presigned multipart POST and waits for real original/poster processing. It seeds three scenes, six shots, one script, five assets and two revisions of the displayed prop through the business API. No generation worker is started and the fixture reports zero provider calls.

Build the web app, then run from the checkout root:

```sh
node --import tsx output/playwright/2026-09-12-approved-assets-assistant/serve.ts
```

The script binds only `127.0.0.1:4317` and prints the path of a fresh 0700 `.runtime/approved-assets-assistant-<uuid>` directory. Session state and fixture IDs are 0600 and must stay private. A fresh start defines the fixture-only `GET /__layout_fixture/login`; the recorded long-running fixture predated that addition and used an equivalent loopback-only 4318 login shim. The direct route addition was typechecked without restarting the fixture being shared for integrated acceptance.

The browser scripts retain this run's synthetic IDs and output paths to describe exactly what ran. For a new run, use a new evidence directory and substitute the fresh IDs from its private `fixture.json`; do not overwrite these historical screenshots. Load the local test identity through the fixture login route and pass each script to the repository's Playwright CLI `run-code` command. The scripts use role/label selectors and do not print the session, CSRF token or private storage grants.

The fixture binds explicit cleanup callbacks to SIGTERM/SIGINT and cleans only its own resources. It was deliberately left running for the root agent's combined visual acceptance when this evidence was committed; service teardown and the combined-page result belong to that later acceptance record.

## Initial failures retained as limitations

The first harness startup omitted the queue error callback, and a subsequent seed attempted the unimplemented single-scene GET route. Both were harness errors, corrected to use the existing callback and content-tree read; no product API was changed for them.

The default 512 MiB MinIO test volume accepted a tiny multipart upload but rejected this 2,318,884-byte image with `507 XMinioStorageFull`. A direct PutObject probe accepted the same bytes. Clearing rebuildable Docker build cache did not resolve the multipart failure. The user-authorized test helper option in `e1566cb` lets only this visual fixture explicitly choose 2 GiB; its default remains 512 MiB and production thresholds are unchanged. The same presigned multipart path then returned 204 and real original/poster processing reached ready. Private startup failure records and cleanup records remain in `.runtime`, never in the committed evidence.

An early screenshot with an oversized asset work area and an old-build assistant screenshot from a shared scene fixture are excluded from these final screenshots. The assistant screenshot also encountered a concurrent preference revision conflict; it is not counted as a successful assistant acceptance. Final dock inspection is supplied by the scene agent/root integration. This packet establishes the asset/media behavior and visual changes above; it does not claim real model quality, production identity, external deployment, or complete AI acceptance.
