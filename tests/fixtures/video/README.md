# Synthetic preview and download fixtures

These silent four-second 96×160 H.264 MP4 files contain only a flat blue or orange field at 24 fps. Created with `ffmpeg`'s `color` generator. They are synthetic media for browser playback, candidate comparison and exact original-download assertions, not a generated-model result or upload/probe acceptance.

Reproduction (replace blue with orange for the second file):

```sh
ffmpeg -f lavfi -i 'color=c=blue:s=96x160:r=24:d=4' -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart synthetic-blue.mp4
```

The tests seed the immutable original identity and accepted metadata in their isolated database, then use actual business API routes. The test-only store serves these checked-in bytes on a disposable loopback server. Neither the server nor seeded identities are reachable in a product deployment.
