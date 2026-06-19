import { describe, it, expect } from "vitest";
import { fnv1a64 } from "../src/fingerprint.ts";

describe("fnv1a64", () => {
  it("is deterministic", () => {
    expect(fnv1a64("hello")).toBe(fnv1a64("hello"));
  });

  it("is a 16-char lowercase hex string", () => {
    expect(fnv1a64("anything")).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64("")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("distinguishes different inputs", () => {
    expect(fnv1a64("a")).not.toBe(fnv1a64("b"));
    expect(fnv1a64("frame-0")).not.toBe(fnv1a64("frame-1"));
  });

  it("is sensitive to small changes (e.g. a single transform value)", () => {
    const a = fnv1a64('<div style="transform:translateX(100px)">hi</div>');
    const b = fnv1a64('<div style="transform:translateX(101px)">hi</div>');
    expect(a).not.toBe(b);
  });

  it("is order-sensitive (anagram-safe)", () => {
    expect(fnv1a64("ab")).not.toBe(fnv1a64("ba"));
  });
});
