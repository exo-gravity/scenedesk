# Final canvas editor browser review — 2026-09-14

## Scope and environment

- Product bundle reviewed: `13c30f44673ccaac417e13ab967e202d756e6f3e`.
- Actual local API fixture: `http://localhost:4327`, API source `af84347`.
- Independent editor scene: `309c5fa5-cab8-4cd4-8cef-2eda77fce6c8` in project `43dc861e-a6bc-40b8-8e47-8a4e55476d4e`.
- Chrome CUA, explicit viewport 1440 × 900. The main assistant acceptance scene and user demo were not edited.
- Actual authorized API and persistent canvas were used. No transport replacement, paid model call, video execution, materialization, adoption, or Take creation occurred in this review.
- Product source was not changed by this review. The parent applied the reported Escape fix separately in `bfcee38cec9e2b9766c22325510aa5b76d2bb662`.

## Verified behavior

1. A single click on **动作优化 · 创作草稿** selected it and showed its short actions without opening an editor. Explicit **编辑** opened the local editor.
2. The local editor measured **400 × 280**, at `(618, 312)` in this initial layout. Its prompt, two actual reference chips, model, 9:16 / 9-second specification control, and **准备生成** button were visible. The screenshot was visually inspected; the model and submission button were not hidden behind the sticky footer.
3. The draft prompt was changed to `最终验收：保留铜钥匙与动作要求参考，缓慢推近；预制静帧视频技术测试。`. Clicking the separate **本次动作要求** text node changed selection to that node while the open editor remained bound to the original video draft and retained the exact prompt.
4. Explicit **编辑** switched to the text node. Explicitly selecting/editing the video draft again restored the exact modified prompt. The normal save status reached **已保存**.
5. **专注编辑** presented the same intended draft with the actual key image and text reference, rather than a replacement input. Its measured focus area was `(80, 104, 1348, 784)`. The canvas transform remained `translate(0px, 0px) scale(1)`; the header, canvas surface, and auxiliary asides had `inert` attributes in the recorded focus snapshot.
6. In focus, **规格 → 更多参数 → 随机种子** opened the inner specification popover. Escape closed that inner popover without deleting the prompt or closing the editor.
7. After the outer Escape issue below, explicit **返回画布** returned to the local editor, retained the prompt and selected video draft, and retained the original canvas transform.

## Confirmed defect in 13c30f4

**Escape could not exit focus after the inner popover had completely closed.**

- Reproduction: open the video draft editor → focus → specification popover → seed input → Escape → wait until the popover is hidden → focus the main prompt → Escape.
- Stable DOM evidence: the editor still had `role="dialog"`; the prompt was unchanged; no visible portal dialog/menu/listbox matched the Escape guard (`escape-dom-diagnostic.json`). This was not solely a transition-frame observation: another Escape after a subsequent stable DOM read also failed.
- Source cause: `CanvasContextualEditor` passed `ref={root}` to its section child. The installed Mantine `FocusTrap` clones that child with its own merged ref and only preserves a caller ref provided through `innerRef`. Thus `root.current` did not identify the section. The composed-path guard treated the editor's own `role="dialog"` as an inner floating layer.
- Reported to parent immediately. Parent independently confirmed and changed the self-exclusion to `event.currentTarget`; new candidate `bfcee38` passed the parent's 174 checks. This directory **does not claim browser acceptance of that new candidate**.

## Inconclusive / remaining checks

- One attempt to click the AI toggle while the editor was still focused produced **请求字段不符合接口要求** and **重新保存本页视图**. Parent independently observed a workspace-preference PUT 422 in public request records, but the original body was not captured. Explicit **返回画布**, followed by **重新保存本页视图**, removed the error. This review does not assign a product cause or claim the focus lock failed based only on the automation click.
- During the subsequent ordinary-mode AI toggle check, Chrome's browser connection closed. Browser inventory temporarily returned no connected browsers; Chrome's native window showed the agent tab groups closed. No application error was inferred from this control-plane interruption.
- Chrome later appeared as a new browser connection. A fresh agent tab and local fixture login were restored. Parent then requested handoff rather than continuing overlapping acceptance, so that fresh tab was closed and its viewport override reset.
- Still delegated to parent: browser recheck of the new Escape candidate; complete 1440 / 390 docked assistant layout; refresh recovery; one technical video execution with the two references and explicit result materialization. No such generation was submitted by this agent, so the allowed execution remains unused.

## Artifacts

- `editor-1440.png`: local editor, two actual references, compact model/specification/CTA. Visually inspected.
- `focus-1440.png`: focus workspace and reference view. Visually inspected.
- `baseline-1440.json`: initial dimensions, input, transform, and document width.
- `selection-b-edit-a.json`: selected text node while the original video draft remains the editor target.
- `switch-edit-return.json`: original video draft prompt after explicit editing handoff.
- `focus-1440.json`: focus dimensions, input, transform, and inert backgrounds.
- `escape-layers.json`: immediate Escape observations (includes a disappearing popover during transition; not alone used as the defect proof).
- `escape-settled.json`: later outer Escape still leaves the editor in dialog mode.
- `escape-dom-diagnostic.json`: stable absence of visible inner layers, editor ancestors, and focus state supporting the confirmed cause.

No secrets, cookies, private grants, or provider credentials are included. The browser's readonly DOM snapshots contain only fixture content and public identifiers.
