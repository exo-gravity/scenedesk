# Synthetic Word fixtures

No customer content or generated-model media is present. `initial-draft.docx` contains a heading, dialogue with an emoji, a table and a 1 × 1 PNG inside an inline DrawingML picture. The tiny picture intentionally catches layout upscaling regressions. `updated-draft.docx` changes the dialogue and omits the picture. `invalid-draft.docx` is deliberately not a ZIP file.

The deterministic ZIP and OOXML source is [docx.ts](../../support/docx.ts). From the repository root, regenerate the valid files with:

```sh
node --import tsx --input-type=module - <<'JS'
import {writeFile} from 'node:fs/promises';
import {docxFixture,illustratedDocxFixture,sampleParagraphs} from './tests/support/docx.ts';
await writeFile('tests/fixtures/scripts/initial-draft.docx',illustratedDocxFixture());
await writeFile('tests/fixtures/scripts/updated-draft.docx',docxFixture(sampleParagraphs.replace('钥匙在哪里？','钥匙在窗边。')));
JS
```

These synthetic packages test the controlled boundary. They do not establish compatibility with every Word template or replace actual team-file acceptance.
