# SceneDesk engineering agreement

The user authorized implementation and merging verified changes into `exo-gravity/scenedesk`. Latest first-release direction (2026-09-11) supersedes the original full-platform launch gate: prioritize a usable private creative workspace; defer post-production editing/rendering, full team management, public signup and operations. The user explicitly retained canvas and AI capabilities according to the original plan, including generation, fixed inputs/results and documented recovery; do not reduce them to a lightweight board or text-only assistant. See `docs/implementation/38-first-release-scope-review.md`. Preserve deferred code and history, but do not continue media normalization/rendering as a prerequisite for this MVP. Commercial billing and cost operations are deferred; safe model execution, limits and duplicate-submission protection remain necessary. Imported media supports manual workflows but cannot replace real AI acceptance. Do not make paid provider calls without the actual service, credentials and spending authorization.

Latest refactor authorization (2026-09-16): implement the independent Web creative-workspace direction in `docs/design/creative-workspace-approved-2026-09-16.md`, delivered incrementally using `docs/implementation/70-creative-workspace-refactor.md`. Canvas is the main creative workspace; scripts are primarily imported/read, shots become an optional list/focus view. Preserve all execution and recovery invariants. The approved prototype is a reference, not production code or real-model acceptance.

## Sources of truth

- Product and technical behavior: `docs/implementation/README.md`, `03-domain-data-model.md`, `06-api-contract.md`, `11-transaction-and-implementation-blueprint.md`, and the applicable editing, canvas or provider contract in that directory.
- Accepted experience: `docs/design/approved-baseline-2026-09-10.md`, superseded for the primary scene workspace by the user-approved `docs/design/primary-canvas-approved-2026-09-14.md`; frontend instructions in `apps/web/AGENTS.md`.
- Actual delivery status: `docs/implementation/22-implementation-progress.md`. Update the relevant implementation note with concrete evidence. A prototype, passing static checks, mock result or implemented endpoint alone is not complete business acceptance.

## Implementation boundaries

- Deliver usable slices across database constraints, service, page and failure recovery. Preserve the documented domain names and distinct states: available media, candidate selection, adoption, cut use and fixed-version approval are separate facts.
- Enforce current tenant/project authority on the server, including retries and cached idempotent responses. Shared reads do not grant access to private source projects. Keep runtime database roles restricted and derive typed references from validated fixed definitions.
- Append immutable content revisions; use the documented revision preconditions for mutable roots. Persist business effects and their queue hint in one transaction. A queue receipt alone cannot establish business success.
- Keep originals, previews and production copies distinct. Use exact integer/rational frame and sample arithmetic. Never silently upgrade a fixed asset, look, voice, plan or review reference.
- Keep draft inputs through conflicts, failed requests and refresh. Bind confirmation dialogs to the object/version opened. Do not report a save complete until its result and local recovery state agree.
- Keep provider attempts durable before submission. An unknown submission must remain unresolved until evidence arrives; it cannot become an automatic paid retry. Mock outputs and local test identities stay explicitly identified.
- Never modify an already applied migration. Add a new migration and reapply explicit role grants. Do not print secrets or commit `.env*`, private storage grants, runtime manifests or real customer data.

## Verification and integration

Use the repository scripts and lockfiles. Run checks relevant to the behavior changed: `npm run check`, database integration tests for persistence/authorization, media tests for storage/decoding, and actual browser flows for UI changes. Test failures at the public behavior boundary; avoid tests that merely repeat implementation details. Inspect changed pages in the production build after style changes.

Change the Python contract generator before regenerating OpenAPI and TypeScript. Documentation checks write to a fresh directory under `output/`; historical reports are not overwritten. Keep fixture evidence distinct from real-user or production acceptance.

Use `feat/` branches for independently reviewable slices. Review the actual diff, run relevant checks, push and inspect the resulting GitHub CI before merging. Record the verified PR/merge and material remaining work. The user's implementation and merge authorization already covers these routine steps; do not introduce an additional approval gate.

2026-09-16 manual-merge authorization: while GitHub Actions jobs cannot start because of account billing/quota, the user authorizes continuing development and ordinary manual merges after relevant local verification and diff review. Record the exact merged head, local evidence, and checks that did not run; never represent unavailable CI as passing. Prefer merging with the GitHub CLI and ask the user to merge only when their access is actually required. This does not authorize changing repository visibility, weakening protections, or ignoring a relevant unresolved product failure.
