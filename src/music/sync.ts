// Beat Sync: the ball falls under gravity and bounces off slanted platforms that are placed
// ahead of time, each one exactly where the ball will be when its note is due.

import { closestOnSegment, segmentSegment, type Vec } from '../math';
import type { NoteEvent } from './songs';

/** One platform hit. Between hits the ball flies p + vOut·s + ½g·s² (g along +y). */
export interface Hit {
  /** Song-clock time of the hit. */
  t: number;
  /** Ball center at the moment of the hit. */
  p: Vec;
  vIn: Vec;
  vOut: Vec;
  /** Platform normal (points from the platform toward the ball). */
  n: Vec;
  ev: NoteEvent;
  color: number;
  /** Half the platform's length: shorter on quick notes so a fast run of them doesn't crowd. */
  half: number;
  /**
   * Set when the ball drops in for this hit (the first note, or the first after a long rest):
   * it appears at `p` at time `t` and falls straight onto the platform.
   */
  launch?: { t: number; p: Vec };
}

export interface PlanOptions {
  /** Horizontal band the ball stays in (a lane). */
  xMin?: number;
  xMax?: number;
  /** Longest platform half-length. */
  halfMax?: number;
  /**
   * Lane mode: hits are placed on the song's absolute clock (so parallel parts line up), and a
   * rest longer than `restMax` seconds ends the phrase: the ball fades out and drops back in.
   */
  absolute?: boolean;
  restMax?: number;
}

/** Notes closer together than this are played as one hit. */
const MERGE = 0.07;
/** Free fall before the first note. */
const LEAD_IN = 0.9;
/** Keep landings inside this horizontal band of the 720px-wide view. */
const X_MIN = 110;
const X_MAX = 610;
const MAX_SPEED = 1600;
/** Platform shape, shared with the renderer. */
export const PLATFORM_HALF = 42;
export const PLATFORM_THICK = 12;
/** How far from the ball's center (at the hit) the platform's middle sits. */
export const platformOffset = (r: number) => r + PLATFORM_THICK / 2;
/** Preferred fall rate, px per second of song: keeps the camera scrolling evenly. */
const DESCENT = 480;
/** Each hit lands at least this much lower than the last, however fast the notes come. */
const MIN_STEP = 72;
/** Only nearby earlier platforms and flights can collide; older ones are far above. */
const LOOKBACK = 60;
const SAMPLES = 12;
/** Preferred downward speed when reaching the next platform (px/s). */
const MIN_ARRIVE = 320;

/** Combines notes that start within MERGE of each other into single chords. */
export function mergeEvents(events: NoteEvent[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.time - last.time < MERGE) {
      for (const n of e.notes) if (!last.notes.includes(n)) last.notes.push(n);
      last.dur = Math.max(last.dur, e.dur);
      last.vel = Math.max(last.vel, e.vel);
    } else {
      out.push({ ...e, notes: [...e.notes] });
    }
  }
  return out;
}

export interface PlatformSeg {
  a: Vec;
  b: Vec;
}

/** Platform half-length for a note followed by a gap of `next` seconds. */
const halfFor = (next: number, max = PLATFORM_HALF) => Math.max(Math.min(24, max), Math.min(max, 260 * next));
/** How long a ball keeps flying (and fading) after the last note of a phrase. */
export const PHRASE_TAIL = 0.6;

/** The platform bar for a hit at ball center `p` with normal `n`. */
export function platformSegment(p: Vec, n: Vec, r: number, half = PLATFORM_HALF): PlatformSeg {
  const off = platformOffset(r);
  const c = { x: p.x - n.x * off, y: p.y - n.y * off };
  const tx = -n.y * half;
  const ty = n.x * half;
  return { a: { x: c.x - tx, y: c.y - ty }, b: { x: c.x + tx, y: c.y + ty } };
}

/** Ball centers along a flight, sampled evenly over its duration (excluding the start). */
function flightPoints(p: Vec, v: Vec, T: number, g: number): Vec[] {
  const pts: Vec[] = [];
  for (let k = 1; k <= SAMPLES; k++) {
    const s = (k / SAMPLES) * T;
    pts.push({ x: p.x + v.x * s, y: p.y + v.y * s + 0.5 * g * s * s });
  }
  return pts;
}

/**
 * Plans the whole fall. Each hit happens exactly at its note's time. At every hit it tries a spread
 * of launches toward the next note and keeps the best one that (1) a real slanted bar could
 * produce, (2) puts its platform clear of other platforms and earlier flight paths, and (3) flies
 * to the next hit without clipping any platform.
 */
export function planFall(events: NoteEvent[], start: Vec, g: number, r: number, opts: PlanOptions = {}): Hit[] {
  const xMin = opts.xMin ?? X_MIN;
  const xMax = opts.xMax ?? X_MAX;
  const halfMax = opts.halfMax ?? PLATFORM_HALF;
  const restMax = opts.restMax ?? Infinity;
  const hitTime = (i: number) => LEAD_IN + events[i].time - (opts.absolute ? 0 : events[0].time);
  const hits: Hit[] = [];
  const platforms: PlatformSeg[] = [];
  /** Committed flight paths; the latest one ends at the current hit. */
  const flights: Vec[][] = [];
  let p = { ...start };
  let v = { x: 0, y: 0 };
  const clearBall = r + PLATFORM_THICK / 2 + 3;
  const clearPlat = PLATFORM_THICK + 10;

  for (let i = 0; i < events.length; i++) {
    const gapBefore = i === 0 ? Infinity : events[i].time - events[i - 1].time;
    const gapAfter = i + 1 < events.length ? events[i + 1].time - events[i].time : Infinity;
    // A new phrase: drop the ball in fresh rather than flying it through a long silence.
    let launch: Hit['launch'];
    if (i === 0 || gapBefore > restMax) {
      // Drops back in just below where the last phrase's ball faded out, so the view never jumps.
      const s = PHRASE_TAIL;
      const faded = { x: p.x + v.x * s, y: p.y + v.y * s + 0.5 * g * s * s };
      const x = i === 0 ? start.x : Math.min(xMax, Math.max(xMin, faded.x));
      const y = i === 0 ? start.y : faded.y + 40;
      launch = { t: hitTime(i) - LEAD_IN, p: { x, y } };
      p = launch.p;
      v = { x: 0, y: 0 };
    }
    const T = launch ? LEAD_IN : Math.max(MERGE, gapBefore);
    const q = { x: p.x + v.x * T, y: p.y + v.y * T + 0.5 * g * T * T };
    const vIn = { x: v.x, y: v.y + g * T };
    const phraseEnds = gapAfter > restMax || i + 1 === events.length;
    const next = phraseEnds ? PHRASE_TAIL : Math.max(MERGE, gapAfter);
    /** The gap after the next note: if it's short, the ball must not land slow. */
    const afterNext = i + 2 < events.length ? events[i + 2].time - events[i + 1].time : next;

    const half = halfFor(Math.min(T, next), halfMax);
    // Fall faster through quick runs of notes so the hits don't stack up.
    const rate = Math.max(DESCENT, MIN_STEP / next);
    const nearPlats = platforms.slice(-LOOKBACK);
    const nearFlights = flights.slice(-LOOKBACK);
    let best: { vOut: Vec; n: Vec; seg: PlatformSeg; path: Vec[]; score: number } | null = null;

    for (const vOut of candidates(q, next, g, rate, xMin, xMax)) {
      if (Math.hypot(vOut.x, vOut.y) > MAX_SPEED) continue;
      const n = facing(vIn, vOut);
      if (!n) continue;
      // The ball has to be coming down when it reaches the next platform: a jump only works if
      // the next note is far enough off for the ball to fall back.
      if (vOut.y + g * next < 80) continue;
      const seg = platformSegment(q, n, r, half);
      const path = flightPoints(q, vOut, next, g);
      const land = path[path.length - 1];
      let clashes = 0;

      // This platform vs the other platforms.
      for (const o of nearPlats) if (segmentSegment(seg.a, seg.b, o.a, o.b).dist < clearPlat) clashes++;
      // This platform vs earlier flights (ignoring the tail of the flight that arrives here).
      nearFlights.forEach((f, k) => {
        const pts = k === nearFlights.length - 1 ? f.slice(0, Math.floor(f.length * 0.75)) : f;
        if (pts.some((pt) => dist(closestOnSegment(pt, seg.a, seg.b), pt) < clearBall)) clashes++;
      });
      // The coming flight vs every platform, including this one once the ball has left it.
      for (const pt of path) for (const o of nearPlats) if (dist(closestOnSegment(pt, o.a, o.b), pt) < clearBall) clashes++;
      for (const pt of path.slice(Math.ceil(SAMPLES * 0.3))) if (dist(closestOnSegment(pt, seg.a, seg.b), pt) < clearBall) clashes++;

      // Look ahead: the landing spot needs room for the next platform around it.
      const room = r + PLATFORM_THICK + halfFor(next) + 6;
      for (const o of [...nearPlats, seg]) if (dist(closestOnSegment(land, o.a, o.b), land) < room) clashes += 0.5;

      // Bounciness: how much of the speed into the platform comes back out. Too little looks like
      // the platform swallowed the ball (an upward-facing bar that doesn't launch it).
      const e = (vOut.x * n.x + vOut.y * n.y) / -(vIn.x * n.x + vIn.y * n.y);
      const bounce = e < BOUNCE_MIN ? BOUNCE_MIN - e : e > BOUNCE_MAX ? e - BOUNCE_MAX : 0;
      const offScreen = land.x < xMin || land.x > xMax ? 1 : 0;
      const drift = (0.4 * Math.abs((land.y - q.y) / next - rate)) / rate;
      // Keep the ball arriving with real downward speed. A slow ball can only make tiny hops off
      // its next platform, which leave it slow again: it gets stuck bouncing in one spot.
      const arrive = vOut.y + g * next;
      // That trap only bites when quick notes follow the landing; otherwise the ball can jump.
      const quick = Math.min(1, Math.max(0, (0.5 - Math.min(next, afterNext)) / 0.25));
      const sluggish = arrive < MIN_ARRIVE ? ((MIN_ARRIVE - arrive) / MIN_ARRIVE) * quick : 0;
      const score = clashes * 100 + bounce * 6 + offScreen * 4 + drift + sluggish * 8 + Math.random() * 0.15;
      if (!best || score < best.score) best = { vOut, n, seg, path, score };
    }

    // Nothing made a believable bounce (very rare): pop back up.
    if (!best) {
      const vOut = { x: -vIn.x * 0.5, y: -Math.max(60, Math.abs(vIn.y) * 0.5) };
      const n = facing(vIn, vOut, 0) ?? { x: 0, y: -1 };
      best = { vOut, n, seg: platformSegment(q, n, r, half), path: flightPoints(q, vOut, next, g), score: 0 };
    }

    hits.push({ t: hitTime(i), p: q, vIn, vOut: best.vOut, n: best.n, ev: events[i], color: i, half, launch });
    platforms.push(best.seg);
    flights.push(best.path);
    p = q;
    v = best.vOut;
  }
  return hits;
}

/** Believable bounciness range: share of the speed into the platform that comes back out. */
const BOUNCE_MIN = 0.6;
const BOUNCE_MAX = 1.05;

/**
 * A spread of launches: left and right by varying amounts, either falling to the next note at a
 * few rates or jumping up first.
 */
function candidates(q: Vec, next: number, g: number, base: number, xMin: number, xMax: number): Vec[] {
  const reach = Math.max(30, Math.min(260, (xMax - xMin) * 0.9, 520 * next));
  const out: Vec[] = [];
  const vys = [base * 0.75, base, base * 1.35, base * 1.8].map((rate) => rate - 0.5 * g * next);
  for (const jump of [150, 300, 450, 600, 750]) vys.push(-jump);
  for (const frac of [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]) {
    let target = q.x + frac * reach;
    if (target < xMin || target > xMax) target = q.x - frac * reach; // aim back on screen
    target = Math.min(xMax, Math.max(xMin, target));
    for (const vy of vys) out.push({ x: (target - q.x) / next, y: vy });
  }
  return out;
}

/**
 * The platform normal that reflects vIn into vOut, or null if the bounce isn't believable:
 * the ball must hit the platform's face and leave from it, each by a clear margin.
 */
function facing(vIn: Vec, vOut: Vec, margin = 0.2): Vec | null {
  const dx = vOut.x - vIn.x;
  const dy = vOut.y - vIn.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return null;
  const n = { x: dx / d, y: dy / d };
  const inDot = (vIn.x * n.x + vIn.y * n.y) / (Math.hypot(vIn.x, vIn.y) || 1);
  const outDot = (vOut.x * n.x + vOut.y * n.y) / (Math.hypot(vOut.x, vOut.y) || 1);
  return inDot < -margin && outDot > margin ? n : null;
}

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Counts layout problems in a plan: platforms touching platforms, and flights clipping a platform
 * they don't start or land on. Only nearby hits are compared, since the ball keeps falling.
 */
export function countClashes(hits: Hit[], g: number, r: number): number {
  const segs = hits.map((h) => platformSegment(h.p, h.n, r, h.half));
  const near = 40;
  let bad = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < Math.min(segs.length, i + near); j++) {
      if (segmentSegment(segs[i].a, segs[i].b, segs[j].a, segs[j].b).dist < PLATFORM_THICK) bad++;
    }
    if (i + 1 >= hits.length || hits[i + 1].launch) continue;
    const h = hits[i];
    const T = hits[i + 1].t - h.t;
    for (let k = 1; k < 24; k++) {
      const s = (k / 24) * T;
      const pt = { x: h.p.x + h.vOut.x * s, y: h.p.y + h.vOut.y * s + 0.5 * g * s * s };
      let hit = false;
      for (let j = Math.max(0, i - near); j < Math.min(segs.length, i + near); j++) {
        if (j === i || j === i + 1) continue;
        if (dist(closestOnSegment(pt, segs[j].a, segs[j].b), pt) < r + PLATFORM_THICK / 2) hit = true;
      }
      if (hit) {
        bad++;
        break;
      }
    }
  }
  return bad;
}

/** Plans a few times (the planner makes random choices) and keeps the cleanest layout. */
export function planFallBest(events: NoteEvent[], start: Vec, g: number, r: number, opts: PlanOptions = {}, tries = 5): Hit[] {
  let best: Hit[] = [];
  let bestBad = Infinity;
  for (let k = 0; k < tries && bestBad > 0; k++) {
    const plan = planFall(events, start, g, r, opts);
    const bad = countClashes(plan, g, r);
    if (bad < bestBad) {
      best = plan;
      bestBad = bad;
    }
  }
  return best;
}
