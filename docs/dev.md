[← kamishibai](../README.md) · [all docs](README.md)

# Live preview: `kamishibai dev`

```sh
kamishibai dev reel.tsx [-p public] [--port 4321] [--mute] [--cc off|captions|storyboard] [--no-sweep] [--no-open]
```

Serves the reel and opens a player at `http://127.0.0.1:4321/__kamishibai/`. The player drives the reel only through `seek(ms)`, the call the renderer makes, so any page that renders also previews: React, plain DOM, canvas. The reel is served at the root as in a render, with `-p` behind it.

- **Reload on save.** A script entry is rebuilt on every change (an `.html` entry's directory and `-p` are watched); the player keeps its position. A build error is shown over the last good build.
- **Controls.** Play/pause, scrub, step one frame, and set a range (In/Out) to play or loop. **Copy --only** puts the range on the clipboard as `--only 120-150`, so you can re-capture just what you looked at. For a long reel, zoom the timeline with ⌘/Ctrl + wheel (or a pinch) at the pointer, `+` / `−`, or the buttons, and scroll it with the wheel or the bar under it; `0` / **Fit** shows the whole reel again. It follows the playhead while playing.
- **Narration costs nothing.** `dev` never calls a TTS provider: a line already in `.kamishibai-tts/` plays with its real audio, and a new or edited line gets an estimated length and no audio. The header counts these lines. Run `kamishibai tts reel.tsx` when the script is settled, and the player picks up the real voice on the next reload. The scene layout can shift then, since the estimate is only a guess.
- **Sound and captions** are two buttons in the header. **Mute** (`M`) turns the sound off. **CC** (`C`) steps through three overlays: `off` shows nothing; `captions` shows the soft subtitles; `storyboard` shows every sound as text, narration included (narration by its line, other clips by file name). The player remembers both; `--mute` and `--cc` set them at start. The timeline has three lanes: frames (captured or copied), sound, and subtitles. The **?** button explains the colors and lists the keys, and turns the lane names off once you know them.
- **What `seek` returned.** At the right of the controls: this frame's fingerprint (or `false`), then `capture` or `copy`: whether a render screenshots the frame or reuses the one before. The timeline's top lane marks every captured frame, and once all frames are known the footer shows how many a render captures ("renders 66 of 586 frames"). A `false` only says "same as the frame before", so it's shown when that frame was the last one seeked.
- **Collecting the sound.** Audio and subtitle markers register as frames are seeked, so a hidden copy of the reel seeks every frame in the background to find them all (and to fill in the captured/copied lane). Until it finishes, only the sound seen so far plays. Pass `--no-sweep` for a reel too heavy for that.

Playback runs on the wall clock and skips frames a slow seek can't keep up with, which a render never does. The mix is close to the render's (gain, fades, trims, loops, ducking) but is played by the browser, not by ffmpeg. Formats the browser can't decode, such as the AIFF from macOS `say`, are converted to WAV with ffmpeg. A URL entry can't be previewed, since kamishibai doesn't serve it.
