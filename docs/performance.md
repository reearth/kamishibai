[← kamishibai](../README.md) · [all docs](README.md)

# Skipping frames & incremental builds

## Skipping static spans

`seek(ms)` can return `false` to mean "identical to the previous frame". The renderer then copies the previous still instead of paying for a settle + screenshot, cheaply skipping held frames. Returning `void`/`true` captures normally, so existing pages are unaffected.

## Incremental builds

`seek(ms)` can also return a **fingerprint** — a stable string key for the frame's content. The renderer copies the previous still when two adjacent prints match (the static-span case, generalized), and with `--incremental` it reuses a cached PNG across runs whenever a print matches the previous run's, stored in `<frames-dir>/.kamishibai-cache.json`. So after you edit a reel, only the frames that actually changed are re-captured; the rest are kept byte-for-byte. A print also tells the renderer that the frame is final: it screenshots as soon as `seek` resolves, without the two animation frames it otherwise waits for, so return the print only once the frame is drawn.

```sh
kamishibai render reel.tsx -f frames -o reel.mp4        # seed the cache
# …edit the reel…
kamishibai render reel.tsx -f frames -i -o reel.mp4     # re-render only what changed
```

`kamishibai/react` returns the fingerprint automatically by hashing the page's DOM (the whole `<body>`, so portals outside the stage count) and the text of every stylesheet rule — so React reels get this for free, no annotation needed. What the hash can't see: `<canvas>`/WebGL pixels, and the bytes behind a URL that didn't change (an image, font or video replaced on disk under the same name). Cover those with a cheap token via `useFingerprint(token)` (`<Video>` already names its frame), or put a version in the URL (`/map.png?v=2`). Matching prints are trusted even without `-i`: within a run, a frame whose print equals the previous frame's is copied, not captured. The cache auto-invalidates when the output geometry (fps/size/scale) changes, and `--only 0-30,90,120-150` is a manual escape hatch that renders just the frames you name. Both need a persisted `--frames-dir`. Caching trusts determinism — a frame that isn't a pure function of its ms can be wrongly reused; omit `-i` for a clean full render.

With `-i` or `--only` the **encode is incremental too**. The video is encoded in 2-second segments, kept in `<frames-dir>/.kamishibai-segments/` and keyed by their frames' prints and the encode settings. A re-render encodes only the segments whose frames changed and joins them with the rest without re-encoding, so an edit to one scene re-encodes a few seconds of video, and an edit to the sound alone re-encodes none. Each segment starts with a keyframe, so the file is somewhat larger than a full render's (about a quarter, for a reel where something moves in every frame); drop `-i` for the final render. `--preview` (= `--preset ultrafast`) still speeds up the segments that do get encoded.

```sh
kamishibai render reel.tsx -f frames -i --preview -o reel.mp4   # fast confirm
```

A print is only as exact as the DOM's serialization, which writes numbers to 6 significant digits: `scale(0.9999998)` and `scale(1)` hash the same. So before hashing, `kamishibai/react` re-applies each element's inline style from its own serialization, and the page paints exactly the frame its print describes. Equal prints then mean equal pixels, and a run of copied frames looks the same however the reel is split across workers.
