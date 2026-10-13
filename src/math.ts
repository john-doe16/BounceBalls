export const TAU = Math.PI * 2;

export interface Vec {
  x: number;
  y: number;
}

/** A line segment with thickness — what every weapon hitbox is made of. */
export interface Capsule {
  a: Vec;
  b: Vec;
  r: number;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Formats a stat: integers as-is, fractions with one decimal. */
export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1) : 0;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentSegment(p1: Vec, q1: Vec, p2: Vec, q2: Vec): { dist: number; c1: Vec; c2: Vec } {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y;
  const rx = p1.x - p2.x, ry = p1.y - p2.y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-9;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = { x: p1.x + d1x * s, y: p1.y + d1y * s };
  const c2 = { x: p2.x + d2x * t, y: p2.y + d2y * t };
  return { dist: Math.hypot(c1.x - c2.x, c1.y - c2.y), c1, c2 };
}
