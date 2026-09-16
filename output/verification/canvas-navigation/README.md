# Canvas navigation and scene directory verification

All browser screenshots in `visual/` use a synthetic project on an isolated real API and PostgreSQL schema. They contain no customer data, real-provider output, session values or credentials. Approved generated references are kept separately in `docs/design/canvas-navigation-2026-09-16/`.

- `check-release.log`: final 265/265 tests plus generated contracts, UI rules, types and production build PASS.
- `all-e2e-release.log`: final 36/36 production-browser suite PASS, run `2026-09-16-canvas-navigation-4933`, 2.1 minutes, zero retries.
- `resize-e2e.log`: deterministic resize/keyboard regression PASS 3/3.
- `index-db.log`: 6 passing database tests/subtests of the new authorized read-only canvas index.
- `check-final.log`: 265 passing tests plus contracts, UI rules, types and production build, before the subsequent responsive activation fix.
- `all-e2e-final.log`: 35/36; this preserved failure exposed the immediate viewport-change/keyboard-navigation race. It is not a passing final run.
- `doc-check-2.log`: PASS before the last verification documentation update; reports are generated in fresh directories.
- `visual/01..03-*-before.png` and `*-after.png`: paired layout QA iterations; see the root `design-qa.md`.
- `visual/04..10`: details drawer, actual pointer-selected quote preview, 390/820 menu, minimal create form and narrow directory/script layouts.

Browser tests run serially with zero automatic retries, a fresh disposable database and restricted runtime roles. Original business HTTP routes remain real; provider/Feishu/media fixtures keep the boundaries documented in `tests/e2e/README.md`. No paid provider calls occur.
