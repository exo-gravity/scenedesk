# Primary canvas and discussion acceptance

## Scope and source

This is an isolated, synthetic local fixture. It uses the actual API, PostgreSQL,
MinIO, media processor and restricted generation worker. The text/video provider
is an explicitly labelled local technical fixture. No external model calls or
real-user data were used. The complete demo on port 4311 was not modified by
these browser tests.

Initial layout production build: `53bb6fad4a7bb3c8dce0b20524346b7690f372bf`.
Follow-up layout observations used an explicitly marked working-tree build of
that commit; `.runtime/creative-experience-7c7e8079-102f-476f-94a2-60c892d05d35/dist.json`
records its patch hash. This intermediate run does not validate the new
discussion backend, which requires a separate current-source fixture.

## Observed through the actual browser

- A scene URL without a mode opens canvas. The full storyboard remains available.
- At 1254 CSS pixels, the mode switch is centered at x=627. Opening the right
  assistant reserves 360px without changing the stored canvas transform.
- Canvas prompt and storyboard prompt survive switching modes. A playing
  storyboard video pauses when hidden, retaining its playback position.
- Selecting a different node does not retarget an already-open draft editor.
  Focus editing uses the same input. Changing zoom changes the node editor's
  displayed size with the canvas.
- Navigating to an empty scene and back exposed JSONB field-order comparisons
  incorrectly leaving preferences dirty. After changing to semantic equality,
  the actual navigation succeeded and restored the prior selection, viewport
  and canvas text.
- The technical video task required a prepared plan and explicit execution.
  A returned 9-second video actually played (readyState 4). Explicit placement
  created one separate video node while retaining the original draft and text.
  See [technical video preview](technical-video-result.png).
- At 390×844, the old header layout let the save status overlap the mode switch;
  the narrow header was subsequently changed to separate rows and must be
  verified in the final build.

## Public LibTV evidence

[LibTV Agent](https://www.liblib.tv/skill) was opened from the official public
navigation. Its logged-out entry presents a creative-idea textbox, optional
attachments, model and skill controls; no canvas-node selection is required to
reach the input. See [public entry](libtv-agent-empty.png). No login or message
submission was performed. This does not prove the authenticated canvas layout
or after-send behavior.

## Browser limitation

A local corrupt PNG was prepared to verify the import failure panel. Chrome
rejected file assignment because its extension lacked file-URL access. No file
was uploaded and this particular browser upload/failure/dismiss sequence is
**not claimed as passed**. The limitation was reported to the user; no browser
permission was changed or bypassed.
