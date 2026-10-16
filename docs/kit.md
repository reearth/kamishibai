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
          - { type: card, label: Fixed, code: "now >= nextDay(expires)", mark: nextDay, tone: accent }
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
| `aspect` | The shapes it lays out for, `{ min, max }` as `"9:16"` or numbers (default 9:16 to 16:9). |
| `fonts` | Font files, `[{ family, src, weight? }]`, paths relative to the reel. |
| `theme` | Colours and font families over the default theme (see below). |
| `voice` | The narration's voice: `{ provider, …options }`, with any provider of [`kamishibai/tts`](narration.md) (`kokoro`, `openai`, `gemini`, `google`, `elevenlabs`, `polly`, `say`) and its options, such as `{ provider: say, voice: Samantha }` or `{ provider: kokoro, voice: jf_alpha }`. |
| `lexicon` | Readings for the voice only; captions keep the text. |
| `music` | A track under the whole reel, `{ src, gain?, duck? }`: looped, faded out at the end, and lowered while the voice speaks unless `duck: false`. |
| `captions` | Captions from each scene's `say`: `true` (the default) for a subtitle track and an `.srt` next to the video, `burn` to draw them into the picture (light on a dark box, in the room kept at the foot), or `false`. |
| `scenes` | The scenes, in order. |

## Scenes

A scene has a `say` (the narration, and its captions) and either a `kata`, a scene shape filled in with the fields beside it, or `parts`, or both: the parts are added after the shape's. `id` names the scene in messages, and `ms` holds it for that long instead of the narration's length. `transition` says how the scene comes in after the one before, and `focus` moves the camera in on a part (see [Transitions](#transitions) and [Camera](#camera)).

| Shape | Fields (* required) | |
|---|---|---|
| `cover` | `title`\*, `kicker`, `sub` | The opening: a big title, with a line above and below. |
| `flow` | `title`\*, `steps`\*, `at`, `note` | Steps as pills with arrows; `at` is the current one, those before it are done. Move `at` from scene to scene to walk the flow. |
| `compare` | `title`\*, `left`\*, `right`\*, `kind` | Two cards side by side (stacked on a tall stage) with ≠, = or → between. `left` and `right` take a card's fields. |
| `code` | `title`\*, `code`\*, `mark`, `label`, `note` | A code excerpt with one part marked. |
| `stat` | `title`\*, `value`\*, `unit`, `label` | One big number that counts up. |
| `points` | `title`\*, `items`\*, `mark` | A bulleted list; `mark` stresses one item. |
| `picture` | `title`\*, `src`\*, `caption` | One picture from a file next to the reel. |

## Parts

Every part is `{ type, … }`, with an optional `id`, `enter` and `cue`.

| Part | Fields (* required) | |
|---|---|---|
| `title` | `text`\*, `kicker` | The scene's heading, pinned to the top. |
| `text` | `text`\*, `tone` (`display`, `lead`, `body`, `note`), `align` | Plain text. |
| `row`, `col` | `parts`\*, `gap`, `align`, `narrow` | Parts side by side, or one under another. A row that doesn't fit across the stage stacks into a column (`narrow: stack`, the default), wraps like tiles (`wrap`), or stays a row (`keep`). |
| `card` | `label`, `body`, `code`, `mark`, `tone` (`plain`, `accent`, `dim`), `width` | A paper card: a small label over a sentence, a code excerpt, or both. |
| `arrow` | `kind` (`right`, `down`, `versus`, `equals`) | An arrow between parts; in a column it points down. |
| `chip` | `text`\*, `state` (`active`, `done`) | A pill, for a step. |
| `stat` | `value`\*, `unit`, `label`, `tone`, `digits` | A big number that counts up from its previous value. |
| `list` | `items`\*, `mark` | A bulleted list. |
| `image` | `src`\*, `width`, `height`, `caption` | A picture, fitted to the room it gets. |
| `figure` | `width`\*, `height`\*, `items`\*, `caption` | A drawing as data (see below). |
| `paint` | `width`\*, `height`\*, `fn`\*, `key` | A box drawn by code, `fn(g, ms, w, h)`, on the reel's clock. Only in a code reel. |

### Figures

A `figure` draws in its own units, `width` × `height`, and is fitted to the room it gets, its items scaled with it:

```yaml
- type: figure
  width: 1200
  height: 360
  items:
    - { id: app, rect: [0, 120, 260, 120], r: 16, stroke: rule }
    - { id: app.t, text: App, at: [130, 160], align: center, bold: true }
    - { id: a1, line: [[270, 180], [460, 180]], arrow: true }
    - { id: server, rect: [470, 120, 260, 120], r: 16, fill: accentTint, stroke: accent, width: 4 }
    - { id: dot, circle: [600, 300, 20], fill: accent }
```

Each item is one of `rect: [x, y, w, h]` (with `r` for its corners), `circle: [cx, cy, r]`, `line: [[x, y], …]` (with `arrow: true` for a head), or `text` with `at: [x, y]`, its top-left corner (top-centre with `align: center`, top-right with `end`), `size` (36 by default) and `bold`. `fill`, `stroke` and `color` take a theme colour's name (`accent`, `accentTint`, `ink3`, `rule`, …) or any CSS colour, and `width` is a line's or an outline's width. An item may have an `id`, an `enter` verb and a `cue`. An item under the same id in the next scene's figure moves, resizes and changes colour, so a diagram can change from one scene to the next.

`code` is the code itself, or a reference to a file next to the reel: `"src/coupon.ts#L44"` shows lines 43 to 45, and `"src/coupon.ts#L40-L48"` that range, with line numbers.

### What moves between scenes

A part is the same part in the next scene when it has the same `id`. Then it moves there, changing size and colour on the way; a part that is gone fades out, and a new one comes in with its `enter` verb (`rise` by default, `draw` for lines; also `fade`, `pop`, `type`, `count`, `none`, `from-left`, `from-right`, `from-top` and `from-bottom` to slide in from that side, `wipe` to be uncovered from the left, and `blur` to come into focus). New parts come in one after another, after the movers have mostly settled. A number under the same id counts from its old value to its new one, and a line of code still on screen slides to its new place instead of being typed again.

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

With `cut`, `push` and `wipe`, a part with a `cue` still comes in with its sentence. Nothing carries over from the scene before, so a change of topic reads as one.

### Camera

`focus` moves the camera in on a part, by its `id`: as close as frames it (2.5× at most), and never so close that the part is cut off or the stage's edge shows. `{ on, cue, zoom }` moves in as sentence `cue` starts, and holds back at `zoom` if that is less. A list moves from part to part, in the order of their sentences. Captions stay where they are.

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

The layout already knows every box, so these are found with no frame drawn:

- `off-stage`: something reaches outside the safe area (the stage less 48 units and the insets).
- `overflow`: a word too long to break in the width it has, or text that spills out of its card.
- `overlap`: two parts overlap.
- `contrast`: text below WCAG contrast on what it sits on (3:1 for large text, 4.5:1 otherwise).
- `widow`: one or two characters alone on a paragraph's last line.

It exits 1 when it finds anything. What it can't judge is whether the result looks good: look at the frames of each shape you render.

## Theme

`theme` sets any of the default theme's fields:

| Field | Default | |
|---|---|---|
| `paper` | `#fafaf7` | the stage |
| `card`, `well` | `#ffffff`, `#efeee9` | cards; code wells and dimmed cards |
| `ink`, `ink2`, `ink3` | `#121212`, `#3e3e3a`, `#6e6e69` | text, strongest to weakest |
| `rule` | `#d8d6cf` | card edges |
| `accent`, `accentText`, `accentTint`, `onAccent` | `#d9662a`, `#b84e14`, `#f6d9c6`, `#ffffff` | the accent, its darker text colour, its tint (code marks), and text on it |
| `fonts` | `{ sans: "sans-serif", mono: "monospace" }` | CSS font families by role |
| `weights` | `{ body: 400, bold: 700, black: 900 }` | the weights the roles draw with |

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

The functions build the same objects a YAML reel holds, and `kit()` checks them the same way. A code reel can also use `paint` parts and parts of its own.

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

`box` returns a tree of boxes that Yoga lays out (`style` is flexbox: `dir`, `gap`, `pad`, `grow`, `align`, `w`, `h`, …), and each box's `paint(rect)` returns the drawables in its rectangle: rects, text, paths, circles and images, each with an id. Drawables with the same id move between scenes, so give them ids from the part's. `corner(spec)` pins a part to the top-right corner on a wide stage, and `fields` are checked and go into the schema. [`examples/kit/route-map.ts`](../examples/kit/route-map.ts) is a complete one. `defineKata(name, { doc, fields, parts })` adds a scene shape the same way.

Import something the module exports (`badge` above), not only the file for its side effect: a bundler may drop an import that only runs code when the package says it has no side effects.

## The schema

```sh
kamishibai schema > kit.schema.json
```

prints the JSON Schema of a reel (with the built-in parts and shapes), for an editor's completion, or for an agent to write a reel against. A YAML file can name it in a `# yaml-language-server: $schema=kit.schema.json` comment.
