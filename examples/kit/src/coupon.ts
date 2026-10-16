// The code the reel quotes: a coupon that expires a day early.
declare function startOfDay(d: Date): Date; // midnight at the start of d's day

export type Coupon = { id: string; expires: Date; usedAt?: Date };

/** Can `c` be used at `now`? */
export function verdict(c: Coupon, now: Date): "ok" | "used" | "expired" {
  if (c.usedAt) return "used";
  const expires = startOfDay(c.expires);
  // expired once the expiry day begins
  if (now >= expires) return "expired";
  return "ok";
}
