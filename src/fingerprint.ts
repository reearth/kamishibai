// kamishibai — frame fingerprints.
// ------------------------------------------------------------------
// A frame is a pure function of (reel code, ms), so its serialized state is a
// stable key for "have these pixels been rendered before?". We hash that state
// into a short string and use it two ways:
//   - within a run: equal to the previous frame -> copy it (skip a screenshot)
//   - across runs:  equal to last run's frame   -> keep the cached PNG
//
// The hash runs both in the page (the React Driver hashes its committed DOM)
// and in Node (tests), so it must be plain, dependency-free JS. It is NOT
// cryptographic — just a fast, low-collision content key for a cache.
// ------------------------------------------------------------------

/**
 * 64-bit FNV-1a, emitted as 16 lowercase hex chars. We run two independent
 * 32-bit streams (different bases + a per-byte perturbation) and concatenate
 * them, so the effective width is 64 bits — collisions are negligible for
 * per-frame DOM strings without paying for BigInt math.
 */
export function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5; // FNV offset basis (stream A)
  let h2 = 0x1000193b; // a distinct basis for stream B
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + 0x9e), 0x85ebca77);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, "0");
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  return a + b;
}
