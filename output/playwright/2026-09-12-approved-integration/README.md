# Approved layout: combined production acceptance

2026-09-12. These are actual business pages built from the integrated branch, compared visually with the approved v0.3 scene workflow and v0.4 script/asset detail references. They are not screenshots of the design prototype. Product source through `b3bf494`; the script/asset images precede only the final scene-player and canvas-tool CSS/components, which do not affect those pages. Delivery: [PR #33](https://github.com/exo-gravity/scenedesk/pull/33).

The main agent used the in-app browser against two isolated fixtures and the same integrated production output. No user project data was changed. No provider calls were made. All saved images were visually inspected. The fixture login helpers set synthetic sessions internally; no cookies or storage grants are included here.

## Final observations

| Page/state | Result |
|---|---|
| Scene catalog, 1512×982 | 34px top bar, 76px rail, 56px context header, 196px project directory and flat episode/scene rows. Creation and requirements remain accessible. |
| Script, 1512×982 | Document and 410px assistant start at y90 and fill892px. Project directory is absent. Unsubmitted text survived navigation to scenes and back. After reload, the explicit recovery prompt locked editing until recovery; accepting recovery restored the exact added text. No script POST was performed. |
| Asset, 1512×982 and dark1366×768 | Full left media with 360px fixed-version dock. Viewed confirmed v1, returned to current draft v2, opened the current-version editor in the left main area while keeping context on the right. Images loaded with filter:none. |
| Storyboard, 1512×982 | Five adopted thumbnails decoded. A 222px-wide portrait player retains its native9:16 geometry; fixed reference is60px from the player, not from a560px empty wrapper. Creation input and bottom strip remain bounded. |
| Storyboard+assistant, dark1366×768 | One360px dock, no horizontal overflow. Player124.20×220.80px; control bar124.20×44px. Time range18px and essential control buttons26px fit inside it. An actual click played the four-second local video to currentTime4/ended:true/error:null. |
| Canvas, 1512×982 | Full remaining space, lightly titled media, selected draft, explicit reference edges. Viewport controls float at lower left; Add exposes text/image/video/audio/material/upload actions. Existing draft remains present. |
| Canvas+assistant, dark1366×768 | Explicit Fit brought content into the narrower canvas; opening the dock itself does not pan nodes. One360px dock, toolbar384.59×40px at x96/y427.94, no horizontal overflow, original draft retained. |
| Canvas narrow390×844 | Existing list fallback explicitly explains desktop spatial editing. Tool group wraps within282px; document scrollWidth390px. This is not a claim of a full mobile canvas. |

The final scene changes were prompted by inspection, not by screenshot regeneration alone: the first player wrapper reserved too much horizontal space; an intermediate compact control bar clipped its lower row due to the media library's slotted range minimum height. Both were corrected and rechecked in the built page. An initial post-reload text comparison read the server document while the explicit recovery prompt was pending; the subsequent recovery action restored the original local text, so automatic replacement is not claimed.

## Screenshots

- `scenes-1512.png`: real project scene catalog.
- `script-1512.png`: document draft and per-scene assistant; the unavailable model state is explicit.
- `asset-v2-1512.png`: actual uploaded/processed image with current draft version.
- `asset-v1-dark-1366.png`: fixed confirmed history, unchanged media color.
- `asset-editor-dark-1366.png`: editor in the main area beside fixed context; long forms scroll locally.
- `storyboard-light-1512.png`, `storyboard-dark-assistant-1366.png`: final portrait player, fixed reference, input and filmstrip.
- `canvas-light-1512.png`, `canvas-dark-assistant-1366.png`: final left-bottom tools and media treatment.
- `canvas-list-390.png`: narrow-screen boundary.

## Fixtures and scope

The asset/script fixture uses actual API, restricted PostgreSQL roles and MinIO. The approved key image went through a real presigned multipart upload, original probing and poster processing. The scene fixture uses actual API/restricted PostgreSQL but a static media adapter with synthetic metadata. For the final visual comparison its clearly labelled four-second technical video was made from the approved still image; this is a local clip, not AI generation, S3 integrity acceptance or a real customer artifact. The constituent fixture sources and broader behavior/failure evidence are in the adjacent `approved-content`, `approved-assets-assistant` and `approved-scene-layout` directories.

Local validation: `npm run check` passed all144 tests plus contracts/UI/type/build; final player CSS passed UI/build and actual playback. Remote checks and merge are recorded on PR #33. Real model transport/quality, external identity/deployment, execution recovery gates and the documented high-capacity canvas performance limits remain separate work.
