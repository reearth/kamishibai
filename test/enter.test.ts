import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClockProvider, Enter } from "../src/react/index.tsx";

const at = (ms: number, props: object) =>
  renderToStaticMarkup(h(ClockProvider, { value: { ms, durationMs: 2000, fps: 30, epochMs: 0 } }, h(Enter, { dur: 1000, ease: (p: number) => p, ...props }, "x")));

describe("<Enter>", () => {
  it("rises in by default, and slides or grows in when asked", () => {
    expect(at(0, {})).toContain("opacity:0;transform:translateY(26px)");
    // A slide or a grow alone does not also rise.
    expect(at(500, { dx: -100, scale: 0.8, from: 1 })).toContain("opacity:1;transform:translateX(-50px) scale(0.9)");
    expect(at(500, { dx: -100, dy: 40 })).toContain("opacity:0.5;transform:translateX(-50px) translateY(20px)");
  });
});
