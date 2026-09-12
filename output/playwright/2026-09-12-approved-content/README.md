# Approved content workspace: implementation evidence

Implemented in `f892856` and `8a346c1`, against the approved 2026-09-10 scene catalog and production-detail script references. The parent integration provides the approved shell and shared theme through `30141a8`.

These are **production web build tests with explicit synthetic HTTP responses** on the isolated preview at `127.0.0.1:4417`. They use real React business components, browser events and IndexedDB, but do not constitute API/database, provider, or real-model acceptance. No user workspace, session, object storage or provider was accessed. Scripts generate their own synthetic request token at runtime; the evidence contains no session cookie, token value or connection credential.

## Passed checks

- `npm run check`: contracts, UI guard, TypeScript, production build and 144/144 unit tests passed; zero failures, cancellations or skipped tests. The subsequent CSS-only independent-scroll change passed UI guard and production build again.
- Three creation recovery flows: episode, scene and shot each committed once in the controlled transport, lost its response, reloaded and explicitly replayed the original body, If-Match and key. Each had 2 HTTP requests / 1 object. No automatic replay or rebase of the unknown request; failed staging sent 0 HTTP requests; completion-cleanup failure recovered without another business write.
- Script draft survived scenes/script navigation and refresh with explicit recovery. Save added one controlled revision. After readback reached a final 503 error, the saved state exposed no second save action; scenes/script navigation preserved that lock. Explicit reread reopened the new text. Script POST count remained 1.
- A `/content?revision=<fixed script id>` deep link opened the exact read-only historical version. The script document remained visible while editing a proposal item.
- Original fixed-input plan/job/proposal flow: 1 plan POST, 1 job POST, 1 proposal edit PUT and 1 explicit apply POST. Selection and generation alone created no shot. No browser page errors.
- 1512px viewport: right pane is exactly 410px wide and starts at y=90; 1366px viewport: 370px and y=90. At 390px, the pane stacks below the document without horizontal page overflow. Light and dark were inspected.
- A separate long-proposal read fixture produced scrollHeight 2423 / clientHeight 892; the right pane actually scrolled to 1530.5 while the source document's position and scrollTop stayed fixed. This test sent no business writes.

Exact results are in `results.json`. Final layout screenshots use the `final-` prefix. Recovery screenshots show intentional failures and their retained inputs; their surrounding catalog predates the final metadata-row placement. The saved-read-failed screenshot predates only the final CSS scroll containment.

## Reproduce

Build the web app with the matching shell plus both product commits, and start an unused isolated preview port (`4417` is the scripts' default). Use separate named Playwright CLI browser sessions for `verify-creation.js` and `verify-layout.js`; each installs only synthetic `/v1` and health transports. Pass the file contents to `playwright-cli run-code`. Run `verify-panels.js`, `verify-basic-screens.js` and `verify-long-proposal-scroll.js` sequentially in the completed layout session, so its synthetic proposal and saved assistant record remain available. Close only those named browser sessions and the preview process that you started.

Earlier incomplete harness attempts (missing `URL` in the CLI execution sandbox, a stale-page locator timeout, and a same-document navigation that did not reload the new bundle) are not counted as acceptance. Their local diagnostics remain outside the committed evidence. The final layout run uses a fresh browser; the panel test explicitly reloads the production bundle.

Actual API/database and unified multi-page browser acceptance belong to the parent's isolated fixture integration. Real provider configuration and model acceptance remain unchanged by this visual slice.
