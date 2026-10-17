// A canvas reel that moves hand-placed items between keyframes with the
// kit's motion (morph from kamishibai/kit), and draws its own things around
// them. The keyframes are placed for the view, so a tall view gets its own.
//
//   kamishibai render examples/canvas/morph.ts -o morph.mp4
//   kamishibai render examples/canvas/morph.ts --aspect 9:16 -o tall.mp4
import { canvasReel } from "kamishibai/canvas";
import { morph, type MorphItem } from "kamishibai/kit";

const STEPS = ["Issued", "Scanned", "Checked", "Used"];

export default canvasReel({
  meta: { fps: 30, durationMs: 9000, width: 1920, height: 1080, aspect: { min: 9 / 16, max: 16 / 9 } },
  fonts: [{ family: "Geist", src: "../kit/fonts/Geist.ttf", weight: "100 900" }],
  setup(view, env) {
    const { width: W, height: H } = view;
    const tall = H > W;
    // One box per step, along a line across a wide view or down a tall one.
    const box = { w: tall ? W * 0.6 : W * 0.17, h: tall ? H * 0.09 : H * 0.16 };
    const gap = W * 0.06;
    const left = (W - STEPS.length * box.w - (STEPS.length - 1) * gap) / 2;
    const at = (i: number): [number, number] =>
      tall ? [(W - box.w) / 2, H * 0.22 + i * box.h * 1.9] : [left + i * (box.w + gap), (H - box.h) / 2];
    const step = (i: number, fill?: string): MorphItem[] => {
      const [x, y] = at(i);
      return [
        { id: `s${i}`, rect: [x, y, box.w, box.h], r: 24, ...(fill ? { fill, stroke: "accent", lineWidth: 4 } : { stroke: "rule" }) },
        { id: `s${i}.t`, text: STEPS[i]!, pos: [x + box.w / 2, y + box.h / 2 - 28], align: "center", bold: true },
      ];
    };
    const steps = (lit: number) => STEPS.flatMap((_, i) => step(i, i === lit ? "accentTint" : undefined));
    const dot = (i: number): MorphItem => {
      const [x, y] = at(i);
      return { id: "dot", circle: tall ? [x - 40, y + box.h / 2, 16] : [x + box.w / 2, y + box.h + 50, 16], fill: "accent" };
    };

    const m = morph(
      [
        { at: 0, items: steps(-1) },
        { at: 1500, items: [...steps(0), dot(0)] },
        { at: 3500, items: [...steps(1), dot(1)] },
        { at: 5500, items: [...steps(2), dot(2)] },
        { at: 7500, items: [...steps(3), dot(3), { id: "done", text: "Used once, then gone.", pos: tall ? [W / 2, H * 0.84] : [W / 2, H * 0.78], align: "center", color: "ink3", delay: 600 }] },
      ],
      { env, width: W, height: H, theme: { fonts: { sans: "Geist", mono: "Geist" } } },
    );

    return (g, ms) => {
      g.fillStyle = "#fafaf7";
      g.fillRect(0, 0, W, H);
      // Drawn by hand under the items: a progress bar along the top.
      g.fillStyle = "#efeee9";
      g.fillRect(0, 0, W, 12);
      g.fillStyle = "#d9662a";
      g.fillRect(0, 0, (W * ms) / 9000, 12);
      m.draw(g, ms);
    };
  },
});
