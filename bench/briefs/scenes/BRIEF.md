# Brief: three scenes with music and captions

Output: `out.mp4` in the project root. 1920×1080, 30 fps, exactly 12.0 seconds (360 frames), **with an audio track**.

## Assets

- `assets/bgm.mp3` — background music (14 s long; use the first 12 s).

## Scenes

Three scenes, each on its own solid background, joined by **0.5 s crossfades** (the incoming scene fades in over the outgoing one):

| Scene | On screen (including crossfades) | Background | Content |
|---|---|---|---|
| 1. Title | 0.0–4.25 s | `#0B0E14` | **"kamishibai benchmark"** (110 px, bold, centered), and below it **"T2 · scenes"** (48 px, 60 % opacity). |
| 2. List | 3.75–8.25 s | `#13233A` | A heading **"What we measure"** (72 px) and three bullet points that appear one at a time, 0.6 s apart starting 0.4 s after the scene begins: **"Render time"**, **"Tokens"**, **"Success rate"** (56 px). Each bullet fades in while moving up 20 px. |
| 3. End card | 7.75–12.0 s | `#2A1630` | **"Thanks"** (140 px, bold, centered), scaling from 90 % to 100 % over its first second. |

All text is `#F2F4F8`, in a clean sans-serif font.

## Audio

- `assets/bgm.mp3` from 0 s, fading in over the first **1.0 s** and out over the last **1.5 s**, ending at 12.0 s.

## Captions

Burn these captions into the picture, centered near the bottom (white 40 px text on a black box at 60 % opacity):

| From | To | Text |
|---|---|---|
| 0.5 s | 3.5 s | Every frame is rendered from its time. |
| 4.5 s | 7.5 s | We measure speed, tokens and success. |
| 8.5 s | 11.5 s | Same brief, three tools. |

## Done when

- `out.mp4` exists with the size, frame rate, duration and audio track above.
- Rendering twice gives the same frames.
