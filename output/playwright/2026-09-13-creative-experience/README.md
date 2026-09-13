# Creative experience — actual browser verification

The scoped E2E flows passed against an isolated real API, PostgreSQL 16 and MinIO. Two product defects were found, fixed and retested: the script tab did not follow a changed URL on an already mounted page; a double click on the canvas did not open its menu in selection mode. Final product source: `093d8c5ed2c3ffc24164a77c6676f7ec08ca9c3b` (`index-l_bRDbIN.js`). No provider adapter or generation executor was started.

Run: [803157f9-e122-4afa-9f9e-d8c6ef0140af/results.json](803157f9-e122-4afa-9f9e-d8c6ef0140af/results.json). Execution crossed midnight in Asia/Shanghai; timestamps in logs use UTC on 2026-09-13. This was incremental Playwright CLI verification, with explicit continuation after harness corrections, rather than one uninterrupted test-suite run.

## Verified behavior

| Path | Actual evidence |
| --- | --- |
| Script and story settings | Read → edit → empty first character keeps focus → reading preview retains input; hidden assistant does not receive focus during 12 Tab presses. Refresh and explicit recovery retain script and settings drafts. The actual API creates script v2 once and saves settings. Final tab clicks, same-page deep links, back/forward and reload remain consistent without losing the draft. |
| Storyboard | The imported 9-second video advances during native playback and pauses through its controls. Opening/collapsing a video creation tab preserves manual input. Opening the assistant preserves input; dark mode applies no media color filter. Viewing leaves the shot adoption unchanged. |
| Canvas | Text editing and keyboard Backspace stay in the text input; actual PUT and GET, followed by refresh/reselection, retain the text. Reference chips and expanded reference details remain usable. A real pointer drag saves a changed position automatically. The floating “continue creation” action creates one independent image draft and its prompt edge, preserving the source. History revisions 7 and 8 retain identical source content and position. The offscreen selection toolbar identifies the actual selected node and remains within the viewport. |
| Real conflict | A second request changes another node. The stale browser save receives one actual HTTP 412 and retains local input. The user explicitly selects and reapplies the local change; subsequent save, GET and refresh preserve both changes. |
| Canvas upload | Blank double click opens a menu without creating a node. Double clicking a node does not open this menu. Native FileChooser remains open approximately 9.7 seconds before file selection. Actual upload/probe → ready media → saved image node preserves the original pointer location to less than 0.001 px. SHA-256 and bytes equal the selected file. |
| Assets | Current fixed-version thumbnails load; a no-image asset does not borrow a different picture. Category/search/archived filtering works. Reference and look selection only browse. Confirmed historical v1 remains fixed across reload while current v2 stays unchanged. Editing, refresh, explicit local recovery and save create exactly v3 with v2 as parent. |
| Media | File and display name survive collapse/reopen. Collapsing during actual upload does not abort it. Media becomes ready with matching SHA-256/bytes; reload retains the completed import record. |

The script-save evidence is explicitly partial: `resume-script-saved.js` asserted `scripts.items.length === 2` and the v2 text ending via the real API, then captured `script-1366-reading.png`, before the later settings locator timed out. `results.json.results.scriptSave` records the successful preceding assertions and the single POST receipt; this does not mark the entire `script-saved-cli.log` run green. The final route screenshot also retains the saved v2 content.

Final database readback: one synthetic project, six ready media, zero generation jobs, zero generation attempts. The two browser uploads each produced their own media. [requests.json](803157f9-e122-4afa-9f9e-d8c6ef0140af/requests.json) contains only method/path/status, without headers, query grants or credentials. It includes the intended 412, two harness GETs to nonexistent shot routes, and the canvas upload’s expected initial by-request lookup 404.

## Production rendering

The before build was freshly rebuilt from `585eb10df26bc7b1d32d8b67bb99a8ee7b596898`, then copied before product edits. It was not an old mounted runtime. Initial after script/settings ran on `dc4ccbf`; scene/assets and conflict recovery on `652ab9a`; final defect retests and canvas actions on `093d8c5`. Their unchanged page styles share the same fixture data, except for the explicitly recorded edits.

The run includes eight [before screenshots](803157f9-e122-4afa-9f9e-d8c6ef0140af/before) and 24 [after screenshots](803157f9-e122-4afa-9f9e-d8c6ef0140af/after): 1440×900, 1366×768 and 390×844, light and dark. Both agents inspected the rendered images. Document width stayed within the viewport in measured narrow-screen cases; overflowing project navigation has its own scroll region. Actual dark tab contrast is 13.19:1 for “剧本正文” and 7.64:1 for “故事设定”.

`media-import-ready-1440.png` proves the completed import record; its gallery thumbnails were still loading and it is **not** final gallery rendering evidence. The root agent separately opened the protected demo read-only in the final build and captured [demo/after-media-final-iab.jpg](demo/after-media-final-iab.jpg): 1048×1066 light, all eleven image elements complete with nonzero natural width, and visible references/video posters inspected. [demo/after-assets-final-iab.jpg](demo/after-assets-final-iab.jpg) is a corresponding real-demo visual supplement. These supplements are not fixture screenshots at matching A/B dimensions.

## Scope and retained failures

- The media bytes are the approved repository key/hand images plus the existing privately stored demo character poster and technical nine-second still animation. Reading those files did not write the protected demo project `b2833448-189c-4ecf-bc3c-f241f36f2969`, its API, database, storage objects or services. The animation demonstrates playback, not newly generated acting or real-model quality.
- The first fixture attempt `be32b0fc-4123-45ec-b2b2-1402f7024ef2` successfully processed media, then stopped because the harness expected archive status 200 instead of the actual contract’s 201. Its cleanup completed. This was a harness error.
- Early CLI attempts retained syntax/locator failures: old heading and API assumptions, assertions before debounced search settled, and expecting editing to remain open after a successful save. Saved operations were not resubmitted. `scene-cli-4.log` completed playback, tab retention and saving before timing out on the old post-reload selection locator; `canvas-resume-cli.log` reads the saved input after explicit node selection.
- A whole-object `JSON.stringify` comparison reported “continue rewrote source”. Authoritative history and field checks proved identical source data; object-key order is not a public semantic guarantee. The failed assertion remains in the log, and the final result is in `canvas-actions-final-cli.log` and `database-final.json`.
- Playwright CLI handles native file choosers as modal boundaries. Long `run-code` attempts spanning the chooser produced tool-session interruptions before an upload intent existed. The accepted attempt used separate CLI `click` and `upload`, with the open/accept snapshot timestamps recorded in `menu-readback-cli.log`.
- No real-model behavior, paid execution, provider-plan seed execution, complete screen-reader audit or a separate empty-canvas menu upload was repeated in this bounded pass. Empty/capability states remain explicit about unavailable models. Historical tests are not relabeled as fresh E2E acceptance.

## Reproducing an isolated fixture

Use repository dependencies, Docker and a production build. After confirming that the build corresponds to the chosen source commit:

```sh
CREATIVE_CURRENT_DIST="$PWD/apps/web/dist" \
CREATIVE_CURRENT_SHA="$(git rev-parse HEAD)" \
CREATIVE_PHASE=after CREATIVE_PORT=4317 \
node --import tsx output/playwright/2026-09-13-creative-experience/serve.ts
```

Optional prepared baseline: `CREATIVE_BASELINE_DIST=/absolute/baseline/dist`, `CREATIVE_BASELINE_SHA=<that commit>` and `CREATIVE_PHASE=before`. A missing/wrong build identity fails clearly. The fixture does not rebuild a baseline or claim an existing dist belongs to an arbitrary commit.

Optional input files: `CREATIVE_KEY_SOURCE`, `CREATIVE_HAND_SOURCE`, `CREATIVE_CHARACTER_SOURCE`, `CREATIVE_VIDEO_SOURCE`. `CREATIVE_FFMPEG` selects an FFmpeg binary. If private demo media are absent, the fixture creates a clearly labeled technical JPEG/9-second static MP4 from repository references in its new private runtime directory. This portable fallback was typechecked, not executed again during this run.

The fixture binds loopback only. `/__layout_fixture/login` sets its synthetic cookie internally; `/__fixture/ids` exposes synthetic IDs and checksums; `/__fixture/build` gives the selected build identity. Each run has a fresh 0700 runtime directory, 0600 secret/build files and a separate evidence directory. CLI scenario scripts are retained with their execution/continuation logs; mutations assume the corresponding initial fixture state and must not be blindly rerun after success. For native upload, use a fresh snapshot, CLI `click` on “上传文件”, allow the chooser to remain open, then CLI `upload <file>`.

## Cleanup

[cleanup.json](803157f9-e122-4afa-9f9e-d8c6ef0140af/cleanup.json) verifies both attempts’ exact PostgreSQL and MinIO container IDs are absent. The fixture’s callbacks reported no errors while closing API/media workers and dropping its schema, queue and roles; the owned PostgreSQL container was then removed. Storage and PG data used tmpfs. Port 4317 and the dedicated browser session are closed. Protected ports 4310, 4311, 4312 and 4320 remained listening and were never signalled. No product code was modified or committed by this acceptance task.
