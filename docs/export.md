[← docs](README.md)

# One HTML file: `kamishibai export`

`kamishibai export` writes a reel and its player as one HTML file. It plays from anywhere, offline included, with no server: open it, send it, or put it in an `<iframe>`. Where a video file is needed (to post it, or to play it where scripts don't run), render an mp4 from the same reel.

```sh
kamishibai export reel.tsx -o reel.html                          # a player with controls
kamishibai export reel.tsx --bare -o embed.html                  # no controls: it autoplays, to embed
kamishibai export reel.tsx --bare --loop 0 -o loop.html          # …and plays forever
kamishibai export reel.tsx --bare --no-autoplay -o scroll.html   # waits for the page to start it
kamishibai export reel.tsx -p public -o reel.html                # a page's static assets, as for render
```

Both kinds of reel export: a page (`window.kamishibai`, React or raw) and a [canvas reel](canvas.md).

## The player

- Click the picture, or press space, to play and pause; the arrow keys step a frame.
- The reel's soundtrack plays with it, and the player follows the soundtrack's clock. Browsers start sound only after the viewer has interacted with the page, so a file that autoplays starts muted.
- Subtitle cues show as captions over the picture.
- `--loop` takes the values of `--gif-loop`: `0` forever, `-1` once (the default), `n` that many more times.

The flags set the file's defaults, and the query string of its URL can change them, so one file can be embedded in several ways:

| Query | |
|---|---|
| `controls=0` / `1` | hide or show the controls |
| `autoplay=0` / `1` | wait, or start at once |
| `loop=<n>` | as `--loop` |
| `t=<seconds>` | start there, e.g. `t=12.5` |
| `muted=1` | start with the sound off |
| `cc=0` | hide the captions |

```html
<iframe src="reel.html?controls=0&loop=0&muted=1" width="640" height="360"></iframe>
```

A page that embeds the file can drive it through `window.kamishibaiPlayer` (`play()`, `pause()`, `seek(ms)`, `ms`, `playing`, `durationMs`).

## What goes in the file

`export` runs the reel once, every frame, and puts in the file what it reads while it plays:

- **the narration** `prepareNarration` returned, so the reel lays out to the voice-over's real length with no TTS server;
- **the soundtrack**, mixed into one AAC track by the same pass that mixes an mp4's (gains, fades and ducking included). It adds about 16 KB a second (96 kbps, as base64);
- **the reel's code**, bundled and minified, with the player.

Then, by kind of reel:

**A page** is loaded in Chrome, as for a capture, and seeked through every frame, with no screenshots. Every file it reads from its own server (images, fonts, video clips, JSON, stylesheets, files from `-p`) is recorded and embedded. When the exported page asks for one, by `fetch`, `XMLHttpRequest`, an element's `src`, `href` or `poster`, a CSS `url()` or a `FontFace`, it gets the embedded copy. Files on other servers (a font from a CDN, say) are left as links, so they need the network. The page plays at its meta size, scaled to fit the window, and the player calls `seek(ms)` as it plays: a seek still settling when the next frame comes is let finish, and the newest time is drawn next. The basics example exports to 238 KB, most of it React.

**A canvas reel** is painted every frame on the CPU, for the default view and both ends of `meta.aspect`, which records:

- each font in `fonts`, cut to the characters drawn in it, as WOFF2 (a variable font keeps its weight axis). This needs `npm i -D subset-font`;
- the files `setup` read with `env.readText` and `env.loadImage`, under the paths it asked for.

The file lays a canvas reel out for the window's shape, within `meta.aspect`, and again when the window changes, so a phone held upright plays it tall. The canvas example exports to 12 KB.

No local paths end up in the file: a page's files go in under the paths they had on the server, and a canvas reel's under the paths it asked for.
