[← kamishibai](../README.md) · [all docs](README.md)

# Skipping frames & incremental builds

## Skipping static spans

`seek(ms)` can return `false` to mean "identical to the previous frame". The renderer then copies the previous still instead of paying for a settle + screenshot, cheaply skipping held frames. Returning `void`/`true` captures normally, so existing pages are unaffected.

## Incremental builds

`seek(ms)` can also return a **fingerprint** — a stable string key for the frame's content. The renderer copies the previous still when two adjacent prints match (the static-span case, generalized), and with `--incremental` it reuses a cached PNG across runs whenever a print matches the previous run's, stored in `<frames-dir>/.kamishibai-cache.json`. So after you edit a reel, only the frames that actually changed are re-captured; the rest are kept byte-for-byte.

```sh
kamishibai render reel.tsx -f frames -o reel.mp4        # seed the cache
# …edit the reel…
kamishibai render reel.tsx -f frames -i -o reel.mp4     # re-render only what changed
```

`kamishibai/react` returns the fingerprint automatically by hashing the page's DOM (the whole `<body>`, so portals outside the stage count) and the text of every stylesheet rule — so React reels get this for free, no annotation needed. What the hash can't see: `<canvas>`/WebGL pixels, and the bytes behind a URL that didn't change (an image, font or video replaced on disk under the same name). Cover those with a cheap token via `useFingerprint(token)` (`<Video>` already names its frame), or put a version in the URL (`/map.png?v=2`). Matching prints are trusted even without `-i`: within a run, a frame whose print equals the previous frame's is copied, not captured. The cache auto-invalidates when the output geometry (fps/size/scale) changes, and `--only 0-30,90,120-150` is a manual escape hatch that renders just the frames you name. Both need a persisted `--frames-dir`. Caching trusts determinism — a frame that isn't a pure function of its ms can be wrongly reused; omit `-i` for a clean full render.

Once `-i`/`--only` reduce capture to a handful of frames, the **full re-encode** of the PNG sequence becomes the dominant cost (every confirm re-encodes the whole reel, not just the changed frames). For a fast confirm loop, pair the reuse flag with `--preview` (= `--preset ultrafast`), which trades a larger file for a much quicker H.264 pass; drop it for the final render.

```sh
kamishibai render reel.tsx -f frames -i --preview -o reel.mp4   # fast confirm
```
