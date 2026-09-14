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

## Final current-source acceptance

The full fixture was recreated at API/frontend source `9618c0e` (run
`c4c0ea5a-0d35-4921-9813-378f72d0e65e`). Five actual browser sends created exactly
five succeeded discussion jobs. No video/image/audio generation job was created.
Attachment counts were `0, 0, 0, 0, 1`; fixed history lengths were `0, 1, 2, 0, 1`.
The fourth message explicitly removed the prior reply to start a new topic; the
fifth explicitly attached the text node. See [database evidence](discussion-jobs.json)
with the exact fixed old questions/replies. Technical output does not prove model quality.

Three consecutive sends used the composer without clicking Continue. Switching
to storyboard and refreshing preserved all replies and the unsent text
`这条暂不发送：保持前面的创作方向。`. Both modes retained the conversational sidebar.

Final presentation polish was inspected in its production working-tree build
before commit. It changes conversation captions and scroll following:

- At 1440×900, the newest reply's bottom gap after asynchronous history loaded
  was -0.5 CSS pixels; after resizing to 390×844 it was 0.
- Keyboard Home moved the focusable history log to scrollTop=0; resizing back
  to 1440 kept scrollTop=0 instead of forcing the latest reply into view.
- At 390×844, document scrollWidth=390, mode center=195 and save/actions occupy
  their own row. At 1440, mode center=720. Header controls no longer overlap.
- Both themes were inspected: [desktop](discussion-desktop.png),
  [mobile](discussion-mobile.png), [dark](discussion-dark.png).

The complete demo was separately upgraded with immutable migrations 0103–0105
(70 total) and explicit runtime grants. Port 4311 served the verified production
HTML; `/health/ready` returned businessReady=true and completeMvp=false. Existing
project/media loaded; no synthetic chat messages were added to that demo.
The intermediate fixture cleanup completed without errors. Final fixture cleanup
is recorded under its private runtime directory.
