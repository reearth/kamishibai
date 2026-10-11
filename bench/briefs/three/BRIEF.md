# Brief: 3D field with a lower third

Output: `out.mp4` in the project root. 1920×1080, 30 fps, exactly 6.0 seconds (180 frames). No audio.

## Look

- A three.js scene (three.js **0.170.0**, from npm or a CDN, whichever suits the project) filling the whole frame.
- **500 spheres** (radius 0.1–0.3) scattered in a box 40 wide × 20 tall × 30 deep, with positions, radii and colors from a **seeded** pseudo-random generator, so every render places them identically. Colors: random hues, saturation 60 %, lightness 55 %.
- Spheres are three.js `SphereGeometry` with 32 width × 16 height segments.
- Lighting: one ambient light and one directional light. Background `#0B0E14`.
- Camera: perspective, vertical field of view 45°, near 0.1, far 200. It sits at height 10 on a circle of radius 48 around the box center (the origin), starting on the +Z axis (position `(0, 10, 48)`), and always looks at the origin.

## Timeline

| Time | What happens |
|---|---|
| 0–6 s | The camera orbits at constant speed from 0° to **30°** (toward +X), always looking at the origin. |
| 1.0–1.5 s | A lower third slides in from the left edge to 96 px from the left, 120 px from the bottom: a dark translucent box (black at 60 % opacity, 12 px corner radius) with the white text **"Re:Earth · 3D"** (48 px, semibold). |
| 1.5–4.5 s | The lower third stays. |
| 4.5–5.0 s | It slides back out to the left. |
| 5.0–6.0 s | Only the scene. |

## Done when

- `out.mp4` exists with the size, frame rate and duration above.
- Rendering twice gives the same frames (no wall-clock time or unseeded randomness anywhere).
