---
name: kamishibai
description: Author and render videos with kamishibai — turn a web page into an mp4/gif by seeking it frame by frame. Use when building a kamishibai reel, writing a page that exposes window.kamishibai = { meta, seek }, using the React sugar (Series/Audio/Bgm/Narration), or rendering with the kamishibai CLI.
allowed-tools: Bash(npx --no-install kamishibai skill *)
---

# kamishibai

The usage guide ships inside the package, so it matches the installed version.
Its core follows. Don't guess the API: follow the guide, and print the topics
your reel needs, e.g. `npx kamishibai skill audio narration`.

If no guide follows (your agent didn't run the line below), run
`npx kamishibai skill` and read its output first.

!`npx --no-install kamishibai skill 2>/dev/null || echo "kamishibai isn't installed in this project yet. Install it (npm i kamishibai react react-dom), then run npx kamishibai skill and read its output."`
