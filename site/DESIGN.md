# Site design

The rules behind reearth.github.io/kamishibai/: what the site looks like, how it moves, and how to check a change on every screen before it ships.

## The idea

White paper cards on a grey desk, pulled away one at a time like a kamishibai performance. The design is as small as the library. It uses ink on paper, one orange accent and no decoration.

The site is also its own example. Every moving picture on it is drawn from a clock, and every page exposes `window.kamishibai`, so `kamishibai render <page url>` turns a page into a video.

## Tokens

Defined in `src/styles/global.css`. Use the variables; don't write raw colors in components.

| Token | Value | Use |
|---|---|---|
| `--desk` | `#e7e5df` | Page background, the desk the cards sit on |
| `--paper` | `#fafaf7` | Sheets, cards, script panels |
| `--frame-bg` | `#ffffff` | Inside a picture frame |
| `--ink` | `#121212` | Text, frame borders, solid buttons |
| `--ink-2` / `--ink-3` | `#3e3e3a` / `#6e6e69` | Body text / secondary text |
| `--rule` / `--well` | `#d8d6cf` / `#efeee9` | Hairlines / code and prompt wells |
| `--kaki` | `#d9662a` | **Fills only**: the ball, captured frames, chapter cards |
| `--kaki-text` | `#b84e14` | **Text** in the accent; 4.5:1 on paper |
| `--copy` | `#c8cbd2` | Copied (not captured) frames |

- There is one accent, the orange of a kamishibai frame. Don't add a second hue. Lighter tints of `--kaki` are fine for steps in a sequence, as in the Chrome rows.
- Accent text is always `--kaki-text`. `--kaki` is too light to read on paper.
- Light theme only. A dark theme was tried and didn't suit the paper.
- No gradients, glows or blur. Shadows only lift a card off the desk, and grow while it is being pulled.

## Type

- **Geist** for everything, with **Zen Kaku Gothic New** as the Japanese fallback. Both come from Google Fonts in `src/layouts/Base.astro`.
- **Geist Mono only for code and numbers**: commands, `seek(…)`, `01 / 05`, frame counts. Never set labels, kickers or headings in mono; it reads as machine-made.
- Headings are 800 weight with tight tracking (`letter-spacing: -0.045em` to `-0.05em`, line-height about 1). Size them with `clamp()` against both `vw` and `vh`, so a heading fits a short screen too.
- Break headlines by phrase. On wide screens each phrase is a block `<span>`; on phones the spans go inline and the line wraps naturally. Don't use `<br>`: once it is hidden, the words on either side run together.

## Copy

- The site is in English. Japanese appears only as a term's reading in the Lexicon.
- The first sheet says what kamishibai is and who it is for, in one line: *If your agent can write a web page, it can make a video.*
- The sheets go: what it is → why (nothing to learn) → how (write, watch, render) → cheap to redo → start.
- Only claim what can be checked. Put no numbers on token use or speed until a benchmark backs them.
- Prompts meant for an agent ("Ask your agent", "Ask for it") are plain sentences with a Copy button.

## Motion

- **Everything is a function of time.** A drawing is `draw(t) → shapes` (`src/lib/draw.ts`, `src/lib/ball.ts`) and has no state between frames. Loops are seamless, so the picture at `t = LOOP_MS` matches `t = 0`.
- `reel()` (`src/lib/reel.ts`) runs the drawings on the wall clock, and hands control to `seek(ms)` once a renderer calls it. Don't use CSS animations or `setInterval` for anything in a picture; a renderer can't seek them.
- CSS transitions are for hover feedback only.
- **Scroll is the playhead.** With `s = scrollTop / height`, sheet `floor(s)` is pulled out over the middle 76% of its screen of scroll, eased with smoothstep. It moves left and turns slightly, and must leave the screen completely.
- Honour `prefers-reduced-motion`: the ball holds a single frame.

## Layout

- **A sheet never scrolls inside.** Everything on it must fit its height. When it doesn't, cut or shrink content at that breakpoint instead of letting it overflow.
- Keep the bottom-left HUD clear. On phones and short screens, sheets reserve padding at the bottom for it.
- Picture frames are always **4:3** with a 1px ink border. Size them by height and `aspect-ratio`; if something also caps the width, the ratio breaks and the ball turns into an oval. The deck card works out its height from the width left beside the script panel for this reason.
- Touch targets are at least 44px (`.btn`, `.chip`, the ‹ › buttons).

### Breakpoints

| Query | Where | What changes |
|---|---|---|
| `max-width: 1179px`, `max-height: 719px` | Top | Hides the contact sheet and the frame lane (`.wide-only`) |
| `max-width: 900px` | Deck | Card above the script instead of beside it |
| `max-width: 760px` | Top | Phone sheets: tighter padding, inline headline, HUD shows dots only |
| `max-width: 560px` | Lexicon | Two cards a row with names only; the chips scroll sideways |
| `max-height: 500px` | Both | A phone on its side: drops the ball preview and step descriptions; deck card and script side by side |

## Checking a change

Build and serve the site the way Pages will:

```sh
cd site
pnpm build
pnpm preview --port 4410              # http://localhost:4410/kamishibai/
pnpm exec astro preview stop          # when done
```

### Screens to check

Check every sheet of the top page, the Lexicon grid and the deck at each of these sizes. Chrome DevTools' device toolbar works, as does the chrome-devtools MCP `emulate` tool.

| Size | Stands for |
|---|---|
| 360×740, 375×667, 390×844 | Phones, portrait. 375×667 is the shortest common one |
| 844×390 | A phone on its side |
| 820×1180 | iPad, portrait |
| 1280×720, 1440×900, 1920×1080 | Laptops and desktops. 1440×900 is also the top page's reel size |

### What to check

In the browser console:

```js
// Each sheet: how far it overflows (should be 0), and the page width (should equal innerWidth).
[...document.querySelectorAll(".sheet")].map((s) => `${s.dataset.sheet}: ${s.scrollHeight - s.clientHeight}`);
document.documentElement.scrollWidth;

// Deck: card ratio (should be 1.333), and the worst script overflow across every card (should be 0).
const h = document.querySelector(".holder").getBoundingClientRect(); h.width / h.height;
const all = [...document.querySelectorAll(".script")], shown = all.find((e) => !e.hidden);
const worst = Math.max(...all.map((e) => (all.forEach((x) => (x.hidden = x !== e)), e.scrollHeight - e.clientHeight)));
all.forEach((x) => (x.hidden = x !== shown)); worst;
```

Then look at each one, because the numbers miss some problems:

- Headlines break by phrase, with no lone word on a line and no words run together.
- Nothing important sits under the HUD.
- The ball is round, and every frame is 4:3.
- A pulled sheet or card leaves the screen completely.
- There are no console errors.

### On a real phone

`pnpm preview --host --port 4410` serves on the local network. Open `http://<your Mac's IP>:4410/kamishibai/` from a phone on the same Wi-Fi. Swipe through the sheets and the deck, and check that Copy works (the clipboard needs a user gesture).

### As a reel

The pages are kamishibai reels, so render them and look at the frames:

```sh
node dist/cli.js render http://localhost:4410/kamishibai/ -o top.mp4                  # 5 sheets, 16 s at 1440×900
node dist/cli.js render "http://localhost:4410/kamishibai/lexicon/nuki/?card" -o nuki.mp4   # one term, one loop
```

Run these from the repo root after `pnpm build` there. Without `?card`, a term page plays the deck from that term to the end.
