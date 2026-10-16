# Brief: a narrated explainer, wide and tall

Output: two videos of the same explainer in the project root, both 30 fps, **with an audio track**:

- `out.mp4`: 1920×1080
- `out-tall.mp4`: 1080×1920, for phones. The same scenes, narration and timing, laid out for the tall frame; not the wide video cropped or letterboxed.

The two videos are the same length, which is set by the narration: each scene lasts as long as its narration plus a short pause.

## Narration

Speak the narration with macOS `say`, voice **Samantha** at its default rate (for example `say -v Samantha -o clip.aiff "…"`). Synthesize it however you like, a sentence or a scene at a time. Each scene's narration starts just after the scene comes in, and the next scene starts after a short pause (under 1.5 s).

Burn in captions of the narration, a sentence at a time, while that sentence is spoken.

## Look

Dark background, light text, one accent colour, a clean sans-serif. All text must stay inside the frame and be easy to read on a phone in the tall video. The rest of the design is yours.

## Scenes

Things in a scene **appear as the narration mentions them**, not all at once. When the same thing is on screen in two scenes in a row (the same box, the same step), it moves to its new place instead of disappearing and coming back.

1. **Title.** "How a ticket gate reads your card", with "Transit IC cards" above it.
   - Say: "Every morning, millions of people tap a card at a ticket gate. Here is what happens in that moment."
2. **The parts.** Three boxes in a row joined by arrows: **Card**, **Gate**, **Station server**.
   - Say: "The card holds your balance. The gate reads it over radio. The station server keeps the fare tables."
   - Card appears with the first sentence, Gate with the second, Station server with the third.
3. **The steps.** Four steps in order: **Detect**, **Read**, **Check**, **Open**. Each step is highlighted in turn, and the steps before it are shown as done.
   - Say: "First, the gate detects the card. Then it reads the balance and the last station. It checks the fare against its local table. And the doors open."
   - The highlight moves to each step with its sentence.
4. **The number.** A big **0.2** with the unit **seconds**, counting up from 0, and the label "for the whole exchange".
   - Say: "All of this takes about 0.2 seconds."
5. **Why it's fast.** Three points, each appearing with its sentence: **The fare table lives in the gate**, **The card does its own maths**, **The server catches up later**.
   - Say: "It is fast because the fare table lives in the gate. The card does its own maths. And the server catches up later, after you have walked through."

## Done when

- `out.mp4` and `out-tall.mp4` exist with the sizes, frame rate and audio track above, and the same length.
- Every scene's narration is heard in full, in order, and the captions match it.
