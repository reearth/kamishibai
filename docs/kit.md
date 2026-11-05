[← docs](README.md)

# Kit reels: scenes as data

A kit reel is a [canvas reel](canvas.md) written as scenes instead of drawing code. Each scene lists the parts on screen (a title, cards, a flow of steps, a number, a list…), or picks a scene shape and fills it in. The kit lays every scene out for the view's shape, moves what stays from one scene to the next (as Keynote's Magic Move does), brings in what is new, and holds each scene for as long as its narration takes. It renders on the CPU with no browser, like any canvas reel.

It can be written as YAML, JSON or code. A reel as data needs no build step and no code run from its author, which suits an agent making videos in a sandbox; `kamishibai check` then finds layout problems with no frame drawn.

```sh
npm i -D @napi-rs/canvas yoga-layout    # Skia, and Yoga for the layout
npm i -D yaml                           # only for a .yaml reel
```

## A reel

```yaml
kit: 1
title: The coupon that expired a day early
fonts:
  - { family: Geist, src: fonts/Geist.ttf, weight: "100 900" }
theme:
  fonts: { sans: Geist, mono: Geist }
scenes:
  - kata: cover
    say: Customers said their coupons stopped working on the last day.
    title: The coupon that expired a day early
  - kata: flow
    say: A coupon is issued, then used, or it expires.
    title: A coupon's life
    steps: [Issued, Used, Expiry day, Expired]
    at: 2
  - say: The fix compares against the start of the next day.
    parts:
      - { type: title, text: The fix }
      - type: row
        parts:
          - { type: card, label: Now, code: "now >= startOfDay(expires)", tone: dim }
          - { type: arrow }
          - { type: card, label: Fixed, code: "now >= nextDay(expires)", highlight: nextDay, tone: accent }
```

```sh
kamishibai check  reel.yaml                    # layout issues for each shape, no frames
kamishibai render reel.yaml -o reel.mp4
kamishibai render reel.yaml --aspect 9:16 -o tall.mp4
kamishibai dev    reel.yaml                    # the player, reloading on save
kamishibai export reel.yaml -o reel.html       # one HTML file, laid out for the window
```

[`examples/kit/reel.yaml`](../examples/kit/reel.yaml) is a complete one, and [`examples/kit/reel.ts`](../examples/kit/reel.ts) the same kind of reel in code, with a part of its own.

The reel's fields:

| Field | |
|---|---|
| `kit` | The version of the layout rules the reel was written for: `1`. A reel written for newer rules than this kamishibai has is refused. |
| `uses` | Modules that define parts and shapes (see [Parts of your own](#parts-of-your-own)), as paths relative to the reel. A JSON or YAML reel reads them before its scenes; a code reel imports them itself. |
| `title`, `fps` | The reel's title, and frames per second (default 30). |
| `width`, `height` | The default view, in layout units (default 1920×1080). |
| `aspect` | The shapes it lays out for: one, `"9:16"` (the default view then takes it: 1080×1920), or a range `{ min, max }` as `"9:16"` or numbers (default 9:16 to 16:9). |
| `fonts` | Font files, `[{ family, src, weight? }]`, paths relative to the reel. |
| `theme` | Colours and font families over the default theme (see below). |
| `voice` | The narration's voice: `{ provider, …options }`, with any provider of [`kamishibai/tts`](narration.md) (`kokoro`, `openai`, `gemini`, `google`, `elevenlabs`, `polly`, `say`) and its options, such as `{ provider: say, voice: Samantha }` or `{ provider: kokoro, voice: jf_alpha }`, or a provider a `--tts-adapter` module registers (its options all go into the cache key). |
| `lexicon` | Readings for the voice only; captions keep the text. |
| `music` | A track under the whole reel, `{ src, gain?, duck?, fadeInMs?, fadeOutMs?, trimStartMs? }`: looped, faded out over `fadeOutMs` (1500) at the end, and lowered while the voice speaks unless `duck: false` (or as `duck: { amountDb, attackMs, releaseMs }` says). |
| `pace` | Narration timing for every scene, in ms: `{ lead, gap, tail }`, the wait before the first sentence (400), between sentences (250), and after the last (700). A scene's own `pace` overrides it. |
| `captions` | Captions from each scene's `say`: `true` (the default) for a subtitle track and an `.srt` next to the video, `burn` to draw them into the picture (light on a dark box, in the room kept at the foot), or `false`. |
| `captionStyle` | How burned captions look: `{ color, box, size, font }`, the text colour (`#fff`), the box's (`rgba(0,0,0,0.62)`), each a theme colour's name or CSS, the size in layout units (40 on a wide stage, 48 on a tall one) and the font role (`bold`). |
| `captionRoom` | `false` gives the room kept at the foot for the captions to the parts, so they fill more of the stage; the captions then sit over them. For a reel whose captions are often off, or are a player's own. Default `true` when there are captions. |
| `transition` | How every scene comes in, unless it says: a name, or `{ type, ms }` with how long it takes (see [Transitions](#transitions)). |
| `enter` | When every scene's new parts come in, unless it says: `{ delay, ms, stagger }` (see [When parts come in](#when-parts-come-in)). |
| `margin` | Room kept clear at the stage's edges, in layout units: a number for all four, or `{ top, right, bottom, left }`. By default 88 at the top and 96 elsewhere on a wide stage, 120 and 72 on a tall one. A scene's `margin` goes over the reel's, edge by edge, so `margin: 0` on one scene lets a picture fill the frame. Captions take a band above the foot's margin (104 wide, 240 tall), and the view's insets and an overlay's `room` are kept beyond it; a `progress` bar keeps its edge at least as wide as itself. `kamishibai check` keeps parts 48 in from the edges, or a scene's margin where that is less. |
| `progress` | A bar that fills as the reel plays, at the foot of the picture: `true` (the accent, 10 units thick), or `{ color, size, at, track }`, its colour, its thickness, `top` for the top edge, and a colour under its whole length. It sits in the stage's margin, inside the view's insets, so it never covers a part. |
| `overlay` | Only in a code reel: drawn over every scene, outside the camera, under burned captions. `{ paint(g, ms, { W, H, durationMs, timing }), room? }`: `paint` draws in stage units and returns a fingerprint of what it drew (frames with the same one are drawn once; with none, every frame is drawn), and `room: { top, right, bottom, left }` keeps that much clear, so the parts and `kamishibai check` stay out of it. |
| `scenes` | The scenes, in order. |

## Scenes

A scene has a `say` (the narration, and its captions: a text, split into sentences, or a list of them, where a sentence may be written out as `{ text, caption?, voice?, pause? }`: what is spoken, what the caption shows instead, the voice's options for it alone (`{ speed: 0.9 }`), and the ms of silence after it: before the next sentence instead of the gap, or after the last one before the scene ends instead of the tail) and either a `kata`, a scene shape filled in with the fields beside it, or `parts`, or both: the parts are added after the shape's. `id` names the scene in messages, and `ms` holds it for that long instead of the narration's length. `transition` says how the scene comes in after the one before, and `focus` moves the camera in on a part (see [Transitions](#transitions) and [Camera](#camera)). When the parts under the heading leave most of the stage empty, they grow together, up to 1.6 times and 90% of the room, to fill it; `fill: max` grows them as large as the room allows (up to 4×), a number such as `fill: 2` as large as the room allows up to that many times, and `fill: false` keeps them at their own size; a scene with a `paint` part does not grow. Parts that are too large for the room, such as a row of steps too wide for the stage or a long list, are shrunk together to fit it, whatever `fill` says, to half their size at most; past that, `kamishibai check` says what spills. `place` says where they sit in their room: `center` (the default), an edge (`left`, `right`, `top`, `bottom`) or a corner (`top-left`, `top-right`, `bottom-left`, `bottom-right`), and they grow from there. A scene with no `title` has no heading, so its room runs from the stage's top margin. `margin` sets that margin for the scene, over the reel's (see the reel's fields).

| Shape | Fields (* required) | |
|---|---|---|
| `cover` | `title`\*, `kicker`, `sub` | The opening: a big title, with a line above and below. |
| `flow` | `title`\*, `steps`\*, `at`, `note` | Numbered steps as pills with arrows; `at` is the current one, those before it are done and ticked. Move `at` from scene to scene to walk the flow. |
| `compare` | `title`\*, `left`\*, `right`\*, `kind` | Two cards side by side (stacked on a tall stage) with ≠, = or → between. `left` and `right` take a card's fields. |
| `code` | `title`\*, `code`\*, `highlight`, `label`, `note` | A code excerpt with one part highlighted. |
| `stat` | `title`\*, `value`\*, `unit`, `label` | One big number that counts up. |
| `points` | `title`\*, `items`\*, `at` | A bulleted list; `at` stresses one item. |
| `picture` | `title`\*, `src`\*, `caption` | One picture from a file next to the reel. |

## Parts

Every part is `{ type, … }`, with an optional `id`, `enter` and `cue`.

In a part's text (a heading, a `text`, a card's label and body, a list's items, a chip, a stat's label; not code, nor a figure's items), a run written between `**` is set in the accent's text colour: `re·**CEIPT**` marks the stressed syllable. A `text` part's `mark` sets the colour (a theme colour's name or CSS). Only paired `**` mark, so `2 ** 10` stays as written; `kamishibai check` judges the marked runs' contrast too.

| Part | Fields (* required) | |
|---|---|---|
| `title` | `text`\*, `kicker` | The scene's heading, pinned to the top. |
| `text` | `text`\*, `role` (`display`, `lead`, `body`, `note`), `align`, `color`, `shrink`, `mark` | Plain text, sized by what it is for: a cover's title, a large line, a sentence (the default), or a small grey note. A word never breaks, so a long one can be wider than its room: `shrink: true` sets the text smaller until its longest word fits, down to half its size (`shrink: 0.7`, to 70%). |
| `row`, `col` | `parts`\*, `gap`, `align`, `narrow` | Parts side by side, or one under another. A row is held to the stage's width, its cards wrapping their text to fit; one that still doesn't fit (a word would be cut, or a card would go under 360 units) stacks into a column (`narrow: stack`, the default), wraps like tiles (`wrap`), stays a row with its parts at their own width and the scene shrunk to fit it on a wide stage, stacking on a tall one or when stacking shrinks it less (`fit`, which `flow` uses), or stays a row (`keep`). |
| `card` | `label`, `body`, `code`, `highlight`, `tone` (`plain`, `accent`, `dim`), `width` | A paper card: a small label over a sentence, a code excerpt, or both. On a tall stage a card in a column takes the full width instead of its `width`, so the column reads as one; in a row it keeps it. |
| `arrow` | `kind` (`right`, `down`, `versus`, `equals`) | An arrow between parts; in a column it points down. |
| `chip` | `text`\*, `state` (`active`, `done`), `n` | A pill, for a step. `n` puts a number in a badge before the label, a tick once it is done. |
| `stat` | `value`\*, `unit`, `label`, `tone`, `digits` | A big number that counts up from its previous value. |
| `list` | `items`\*, `at` | A bulleted list; `at` stresses one item. |
| `image` | `src`\*, `width`, `height`, `upscale`, `caption` | A picture, as large as the room it gets allows, its shape kept: as tall as the room under the heading, less its caption. `width` and `height` hold it smaller; `upscale: false` keeps it no wider than the file's own pixels, so a small file stays sharp. Its corners are rounded, but square where it meets the frame's edge (with a scene's `margin: 0`). |
| `figure` | `width`\*, `height`\*, `items`\*, `caption` | A drawing as data (see below), as large as the room under the heading allows. |
| `paint` | `width`\*, `height`\*, `fn`\*, `key` | A box drawn by code, `fn(g, ms, w, h)`, on the reel's clock. Only in a code reel. |

### Figures

A `figure` draws in its own units, `width` × `height`, and is fitted to the room it gets, its items scaled with it:

```yaml
- type: figure
  width: 1200
  height: 360
  items:
    - { id: app, rect: [0, 120, 260, 120], r: 16, stroke: rule }
    - { id: app.t, text: App, pos: [130, 160], align: center, bold: true }
    - { id: a1, line: [[270, 180], [460, 180]], arrow: true }
    - { id: server, rect: [470, 120, 260, 120], r: 16, fill: accentTint, stroke: accent, lineWidth: 4 }
    - { id: dot, circle: [600, 300, 20], fill: accent }
```

Each item is one of `rect: [x, y, w, h]` (with `r` for its corners), `circle: [cx, cy, r]`, `line: [[x, y], …]` (with `arrow: true` for a head; with a `fill`, three points or more close into a filled shape, outlined only with a `stroke`), or `text` with `pos: [x, y]`, its top-left corner (top-centre with `align: center`, top-right with `end`), `size` (44 by default), `font` (`sans`, `bold`, `black` or `mono`; `bold: true` and `mono: true` are short for two of them), and `width`, where it wraps (evenly; otherwise only at `\n`). `fill`, `stroke` and `color` take a theme colour's name (`accent`, `accentTint`, `ink3`, `rule`, …) or any CSS colour, `lineWidth` is a line's or an outline's width, `dash: [on, off]` dashes a stroke, and `opacity` (0 to 1) fades an item. An item may have an `id`, an `enter` verb and a `cue`. An item under the same id in the next scene's figure moves, resizes and changes colour, so a diagram can change from one scene to the next.

An item can also move within its scene. `then` lists what it becomes, in order, each with when it moves: `cue`, the sentence it moves with, and `delay`, ms after that sentence starts (after the scene starts, with no `cue`), so one sentence can carry several moves. Each gives the fields that change (its shape's own field, `pos`, `fill`, `stroke`, `color`, `lineWidth`, `r`, `size`, `text`), and `ms` for how long the move takes (750 by default). A step can also change `opacity`. A rect stays a rect, and a line keeps its number of points. A number text with `enter: count` counts to its new value. The next scene starts from the item as its last step left it.

```yaml
- { id: dot, circle: [100, 300, 20], fill: accent, then: [{ cue: 1, circle: [600, 300, 20] }, { cue: 2, circle: [1100, 300, 20] }] }
- { id: bar, rect: [0, 400, 0, 40], fill: accent, then: [{ cue: 1, rect: [0, 400, 1200, 40], ms: 2000 }] }
```

`code` is the code itself, or a reference to a file next to the reel: `"src/coupon.ts#L44"` shows lines 43 to 45, and `"src/coupon.ts#L40-L48"` that range, with line numbers.

### What moves between scenes

A part is the same part in the next scene when it has the same `id`. Then it moves there, changing size and colour on the way; a part that is gone fades out, and a new one comes in with its `enter` verb (`rise` by default, `draw` for lines; also `fade`, `pop`, `type`, `count`, `none`, `from-left`, `from-right`, `from-top` and `from-bottom` to slide in from that side, `wipe` to be uncovered from the left, and `blur` to come into focus). New parts come in one after another, 160 ms apart, after the movers have mostly settled. A number under the same id counts from its old value to its new one, and a line of code still on screen slides to its new place instead of being typed again.

A part without an `id` gets its type as its id, numbered when the type repeats in the scene (`card`, `card.2`). So a `title` in every scene is the same title, and it stays put while the rest changes. The shapes use fixed ids (`title`, `flow.0`, `flow.1`, …), so moving `at` along a flow from one scene to the next fills the next pill.

### Timing

A scene's `say` is spoken a sentence at a time: it is split after 。！？, and after . ! ? before a space (a decimal point doesn't split it), or it can be given as a list of sentences. Each sentence is one clip and one caption, with 250 ms between them. A scene holds for its narration plus a little: the voice starts 400 ms in, as the parts finish moving, and the scene holds 700 ms after it ends (at least 2.5 s in all). With a `voice`, the lengths are the synthesized audio's own, measured before any frame is drawn (`kamishibai tts reel.yaml` synthesizes them ahead). Without one, each length is estimated from the text: about 7.5 characters a second for Japanese, 14 for other scripts.

### Cues

A part with `cue: n` comes in as sentence `n` of the scene's `say` starts, counting from 0, instead of with the scene. Parts inside it come in with it, and so does a figure's item with its own `cue`. It takes its place in the layout from the start of the scene, so nothing moves when it comes in.

```yaml
- say: [A shop scans the coupon., The app asks the server., The server answers.]
  parts:
    - { type: title, text: How a coupon is checked }
    - type: row
      parts:
        - { type: chip, text: Shop }
        - { type: arrow, cue: 1 }
        - { type: chip, text: App, cue: 1 }
        - { type: arrow, cue: 2 }
        - { type: chip, text: Server, cue: 2 }
```

### Transitions

A scene comes in after the one before it by its `transition`:

| Transition | |
|---|---|
| `morph` | The default: parts under the same id move, the rest fade out, and new parts come in with their verbs. |
| `cut` | The new scene is there at once, whole. |
| `fade` | The scene before fades out to the paper, then the new parts come in with their verbs. |
| `push` | The new scene slides in from the right and pushes the one before out to the left. |
| `wipe` | The new scene is uncovered over the one before, from left to right. |

With `cut`, `push` and `wipe`, a part with a `cue` (or a `delay` of its own) still comes in with its sentence. Nothing carries over from the scene before, so a change of topic reads as one.

A transition takes its own time: a morph moves what stays over 750 ms, a fade takes 400 ms to go out, and a push or a wipe 700 ms. `transition: { type: fade, ms: 200 }` sets it. A `transition` on the reel is every scene's, and a scene's fields go over it: with `transition: { type: fade, ms: 200 }` on the reel, a scene's `transition: push` pushes in 200 ms, and `transition: { ms: 300 }` fades in 300.

### When parts come in

New parts start coming in 150 ms into a scene; after a fade, 150 ms after it has gone out; after a morph, once what stays has mostly moved. Each verb takes its own time (a `rise` 550 ms, a `fade` 400, a `count` 1100), and parts that come in together start 160 ms apart. A scene shown for a moment needs them sooner and quicker, and `enter` says so:

```yaml
transition: { type: fade, ms: 200 }
enter: { delay: 0, ms: 250, stagger: 60 }   # every scene's new parts
scenes:
  - say: accommodation
    ms: 900
    enter: { delay: 50 }                    # this scene's, over the reel's
    parts:
      - { type: text, role: display, text: accommodation, enter: { type: pop, ms: 150 } }
```

On the reel or a scene, `enter` takes `delay` (ms from the scene's start to the first new part), `ms` (how long each takes) and `stagger` (ms between one and the next). A part's `enter` is a verb, or `{ type?, ms?, delay? }`: the verb (the part's own when left out), how long it takes, and when it starts, in ms from the scene's start, or from its sentence with a `cue`. Parts inside it take its timing.

### Camera

`focus` moves the camera in on a part, by its `id`, or on an item of a figure, by the figure's id and the item's (`map.gate`): as close as frames it (2.5× at most), and never so close that the part is cut off or the stage's edge shows. `{ on, cue, zoom }` moves in as sentence `cue` starts, as close as `zoom` (closer than 2.5× for a small item, or holding back), still never cutting the part off. A list moves from part to part, in the order of their sentences. Captions stay where they are.

```yaml
- say: [The card holds your balance., The gate reads it over radio., The station server keeps the fare tables.]
  focus: [{ on: gate, cue: 1 }, { on: server, cue: 2 }]
  parts:
    - { type: title, text: Three parts }
    - type: row
      parts:
        - { type: card, id: card, label: Card }
        - { type: arrow, cue: 1 }
        - { type: card, id: gate, label: Gate, cue: 1 }
        - { type: arrow, cue: 2 }
        - { type: card, id: server, label: Station server, cue: 2 }
```

The next scene starts where the camera was and moves back out, unless it comes in another way than `morph`. A part that already fills the frame across, as a card does on a tall stage, has nothing to move in to.

## Any shape

Layout is done in units of a stage whose long side is 1920, for each view the reel is drawn at, and drawn scaled to the view's size. `--size` and `--aspect` pick the view as for any canvas reel, within the reel's `aspect`.

On a tall stage, rows stack into columns, cards take the full width, arrows point down, and a corner part leads the body instead of sitting beside the heading. Room is kept at the foot for captions, and `--inset` keeps the picture clear of an app's controls. Japanese breaks between phrases (a word with the hiragana after it), and a heading or a centred line balances its lines.

## `kamishibai check`

```sh
kamishibai check reel.yaml            # meta's own view and each end of aspect
kamishibai check reel.yaml --aspect 1:1
kamishibai check reel.yaml --json     # { views: [{ width, height, issues }], count }
```

The layout already knows every box, so these are found with no frame drawn (the characters are drawn once each, off screen):

- `off-stage`: something reaches outside the safe area (the stage less 48 units and the insets).
- `overflow`: a word too long to break in the width it has, or text that spills out of what it sits on (a card, or a figure's filled rect).
- `overlap`: two parts overlap.
- `contrast`: text below WCAG contrast on what it sits on (3:1 for large text, 4.5:1 otherwise).
- `widow`: one or two characters alone on a paragraph's last line, or one word under a line more than 2.5 times as long.
- `glyph`: a character no font has, which would show as an empty box (the parts' text, and burned captions).
- `unused`: a field the reel wrote that no shape it lays out for uses, such as a card's `width` in a reel that is only tall.

Each issue ends with what usually fixes it. It exits 1 when it finds anything. What it can't judge is whether the result looks good: look at the frames of each shape you render.

## Theme

`theme` sets any of the default theme's fields:

| Field | Default | |
|---|---|---|
| `paper` | `#fafaf7` | the stage |
| `card`, `well` | `#ffffff`, `#efeee9` | cards; code wells and dimmed cards |
| `ink`, `ink2`, `ink3` | `#121212`, `#3e3e3a`, `#6e6e69` | text, strongest to weakest |
| `rule` | `#d8d6cf` | card edges |
| `accent`, `accentText`, `accentTint`, `onAccent` | `#d9662a`, `#b84e14`, `#f6d9c6`, `#ffffff` | the accent, its darker text colour, its tint (code marks), and text on it |
| `fonts` | `{ sans: "sans-serif", mono: "monospace" }` | CSS font families by role: `sans` for text, `mono` for code and numbers, and `bold` (labels, card text) and `black` (headings, titles) take `sans`'s unless given, so `black: Fraunces` sets the headings in a serif |
| `weights` | `{ body: 400, bold: 700, black: 900 }` | the weights the roles draw with; `mono` takes `body`'s unless given |

Colours take any CSS colour (`#fff`, `#ff000080`, `rgb()`, `tomato`); they blend when a part changes colour, and check judges their contrast (a see-through one is not judged). A theme may also name colours of its own, `theme: { brand: "#0b6" }`, and use them by name wherever a colour goes (`fill: brand`).

Without `fonts`, text is drawn with the system's fonts, which differ between machines: give the reel its font files so it looks the same everywhere. A container needs fonts for every script the reel uses.

## In code

```ts
import { kit, title, row, card, arrow } from "kamishibai/kit";

export default await kit({
  kit: 1,
  scenes: [
    { kata: "cover", say: "Hello.", title: "Hello" },
    { say: "Two ways.", parts: [title("Two ways"), row([card({ body: "This" }), arrow(), card({ body: "That" })])] },
  ],
});
```

The functions build the same objects a YAML reel holds, and `kit()` checks them the same way. A code reel can also use `paint` parts, parts of its own, and an `overlay` drawn over every scene:

```ts
export default await kit({
  kit: 1,
  // a chapter mark in the corner, kept clear of the parts
  overlay: {
    room: { top: 60 },
    paint(g, ms, { W, timing }) {
      const n = timing.findIndex((t) => ms < t.start + t.ms) + 1;
      g.font = "700 28px Geist";
      g.fillStyle = "#6e6e69";
      g.textAlign = "right";
      g.fillText(`${n} / ${timing.length}`, W - 96, 64);
      return String(n);
    },
  },
  scenes: [/* … */],
});
```

Wrap the reel `kit()` returns instead only for what an overlay can't do: an overlay is laid out with the reel, and `kamishibai check` keeps its room clear. A code reel that builds its scenes from data imports it, `import words from "./words.yaml"` (or `.json`), so the data is bundled with the reel and is there in `kamishibai dev` and `export` too, which run it in a browser where `node:fs` is not. A canvas reel can have the kit's motion without its layout, from [`morph`](canvas.md#moving-items-between-keyframes-morph).

### Parts of your own

```ts
import { definePart, f, textBox } from "kamishibai/kit";

definePart<{ id: string; label: string }>("badge", {
  doc: "A small label in a pill.",
  fields: { label: f.str("its text", true) },
  box: (s, ctx) => ({ style: { pad: [12, 24] }, kids: [textBox(`${s.id}.t`, s.label, ctx, { font: "bold" })] }),
});
export const badge = (label: string, o: { id?: string } = {}) => ({ type: "badge", label, ...o });
```

A JSON or YAML reel uses such a module by naming it in `uses`; then `{ type: "badge", label: "new" }` is a part of the reel like any other. Its `import … from "kamishibai/kit"` is the same kit the reel is made with.

`box` returns a tree of boxes that Yoga lays out (`style` is flexbox: `dir`, `gap`, `pad`, `grow`, `align`, `w`, `h`, …), and each box's `paint(rect)` returns the drawables in its rectangle: rects, text, paths, circles and images, each with an id. Drawables with the same id move between scenes, so give them ids from the part's. `corner(spec)` pins a part to the top-right corner on a wide stage, and `fields` are checked and go into the schema. [`examples/kit/route-map.ts`](../examples/kit/route-map.ts) is a complete one. `defineKata(name, { doc, fields, parts })` adds a scene shape the same way; its fields sit beside the scene's own, so it can't take `id`, `say`, `ms`, `kata`, `parts`, `transition`, `focus`, `fill` or `place`.

A leaf box with no `kids` gets its size from `measure(maxW)`, which returns `{ w, h }` for the widest it may be. A `col` and the body are as wide as their widest child, so a leaf that returns `w: 0` makes them 0 wide, and `self: "stretch"` then stretches it to nothing. Return `maxW` for a part that should take the room it is given, and its natural width for one that should not.

Import something the module exports (`badge` above), not only the file for its side effect: a bundler may drop an import that only runs code when the package says it has no side effects.

## The schema

```sh
kamishibai schema > kit.schema.json
```

prints the JSON Schema of a reel (with the built-in parts and shapes), for an editor's completion, or for an agent to write a reel against. A YAML file can name it in a `# yaml-language-server: $schema=kit.schema.json` comment.

`kamishibai schema --brief` prints every field instead, a line for the reel, a scene, each shape and each part (`*` required, `#` a number, `[..]` a list, `(a|b)` the values it takes): about 2 KB against the schema's 27 KB. The kit topic of `kamishibai skill` includes it.
