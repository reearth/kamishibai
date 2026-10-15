// A canvas reel: drawn on a 2D canvas for a time `ms`, and painted on the CPU
// by `kamishibai render`, with no browser. The same file plays in a browser.
//
//   kamishibai render examples/canvas/reel.ts -o out.mp4
//   kamishibai render examples/canvas/reel.ts --aspect 9:16 -o tall.mp4
import { canvasReel } from "kamishibai/canvas";
import { eases, ramp } from "kamishibai/easing";

const INK = "#121212";
const PAPER = "#fafaf7";
const KAKI = "#d9662a";

export default canvasReel({
  meta: { fps: 30, durationMs: 4000, width: 1920, height: 1080, aspect: { min: 9 / 16, max: 16 / 9 } },
  // Paths are relative to this file. Geist is a variable font, so any weight
  // draws, in between the named ones too.
  fonts: [{ family: "Geist", src: "fonts/Geist.ttf", weight: "100 900" }],
  setup(view) {
    // Layout, once per view: a tall view stacks the title over the ball's track.
    const { width: W, height: H } = view;
    const tall = H > W;
    const size = Math.round(Math.min(W, H) * 0.12);
    const title = { x: W / 2, y: tall ? H * 0.3 : H * 0.38 };
    const track = { x0: W * 0.2, x1: W * 0.8, y: tall ? H * 0.6 : H * 0.66 };

    return (g, ms) => {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, W, H);

      g.globalAlpha = ramp(ms, 0, 600, 0, 1, eases.smooth);
      g.fillStyle = INK;
      // The weight grows from 300 to 800 as the title comes in.
      g.font = `${Math.round(ramp(ms, 0, 1200, 300, 800, eases.smooth))} ${size}px Geist`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("kamishibai", title.x, title.y + ramp(ms, 0, 600, 24, 0, eases.smooth));
      g.globalAlpha = 1;

      // The ball crosses and comes back, then rests: frames after 3 s repeat,
      // and the fingerprint lets the renderer copy them instead of painting.
      const p = ms < 3000 ? Math.sin((ms / 3000) * Math.PI) : 0;
      const x = track.x0 + (track.x1 - track.x0) * eases.inOut(p);
      g.fillStyle = KAKI;
      g.beginPath();
      g.arc(x, track.y, size * 0.4, 0, Math.PI * 2);
      g.fill();
      return ms < 3000 ? undefined : "rest";
    };
  },
});
