[← kamishibai](../README.md) · [all docs](README.md)

# Library

```ts
import { render } from "kamishibai";

await render({
  entry: "reel.tsx",
  out: "reel.mp4",
  workers: 4,
  audio: [{ src: "voiceover.m4a", atMs: 0 }], // merged with any page-declared audio
  publicDir: "public",
  onLog: (msg) => console.log(msg),
});
```

`render` is just `capture` then `assemble`, and both are exported: `capture({ entry, framesDir })` captures frames (+ manifest + mux sidecar) without encoding, and `encode({ framesDir, out })` re-assembles a kept frames dir into a video without re-capturing (the programmatic forms of the [subcommands](cli.md#splitting-a-render-capture--encode)). Lower-level building blocks (`probeMeta`, `captureChunk`, `renderPool`, `serveEntry`, `encodeFrames`, `muxAudio`, `assemble`, `splitFrames`) are exported too if you want to assemble your own pipeline.
