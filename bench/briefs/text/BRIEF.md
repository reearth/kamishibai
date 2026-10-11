# Brief: "Function of time" title sequence

Output: `out.mp4` in the project root. 1920×1080, 30 fps, exactly 8.0 seconds (240 frames). No audio.

## Look

- Background: a solid color that tweens from `#0B0E14` (at 0 s) to `#121826` (at 8 s), linearly.
- Text color `#F2F4F8`, accent color `#F2C94C`. Any clean sans-serif font.

## Timeline

| Time | What happens |
|---|---|
| 0.0–0.8 s | The title **"Every frame is a function of time"** (96 px, bold, centered horizontally, upper third) enters from 60 px below its resting place while fading in. Use a spring or ease-out curve that settles without visible overshoot past 0.8 s. |
| 1.0–2.5 s | Three horizontal bars appear below the title, left-aligned in a column, one after another (starts 0.5 s apart). Each grows from width 0 to its value as a share of 900 px: **40 %**, **70 %**, **95 %**, in the accent color. Each bar has a label to its left: "Seek", "Capture", "Encode". |
| 2.5–4.5 s | A counter under the bars counts up from **0** to **2026** (whole numbers, ease-out), 120 px tall digits. |
| 4.5–6.5 s | Everything holds still. |
| 6.5–8.0 s | Everything (title, bars, labels, counter) fades out to the background. The last frame shows only the background. |

## Done when

- `out.mp4` exists with the size, frame rate and duration above.
- Rendering twice gives the same frames.
