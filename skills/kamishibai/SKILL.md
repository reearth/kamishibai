---
name: kamishibai
description: Author and render videos with kamishibai — turn a web page into an mp4/gif by seeking it frame by frame. Use when building a kamishibai reel, writing a page that exposes window.kamishibai = { meta, seek }, using the React sugar (Series/Audio/Bgm/Narration), or rendering with the kamishibai CLI.
---

# kamishibai

The full, authoritative usage guide ships inside the package — don't guess the
API, print the guide and follow it:

```sh
npx kamishibai skill
```

(or just `kamishibai skill` if it's already installed). Read the whole output
first; it is the source of truth. This skill is only the pointer.

It covers: the mental model (every frame a pure function of time), the one
contract (`window.kamishibai = { meta, seek }`), the React sugar (`<Series>` /
`<Scene>` layout, `<Audio>` / `<Bgm>` / `<Narration>`, `<Cue>`, easing), the
render CLI and flags, audio + TTS, and the determinism checklist.
