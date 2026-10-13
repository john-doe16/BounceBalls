import { Ball } from './ball';
import type { Sfx } from './audio';
import { Fx } from './fx';
import { TAU, closestOnSegment, fmt, rand, segmentSegment, type Vec } from './math';
import { Splitter, Unarmed, WEAPON_INFO, createWeapon, type WeaponKind } from './weapons';

export const VIEW = { w: 720, h: 1280 } as const;
export const ARENA = { cx: 360, cy: 690, half: 330 } as const;
/** Fixed physics step. Small so fast-spinning weapons don't tunnel through each other. */
export const DT = 1 / 240;
export const BALL_RADIUS = 34;

export type ArenaShape = 'square' | 'circle';

export interface GameConfig {
  fighters: WeaponKind[];
  arena: ArenaShape;
  gravity: number;
  /** Multiplies every ball's radius and weapon size. */
  ballScale: number;
}

/** One fighter on the scoreboard. Usually one ball; a Splitter's pieces all share a team. */
export class Team {
  members: Ball[] = [];
  constructor(
    readonly id: number,
    readonly name: string,
    readonly color: string,
    readonly maxHp: number,
  ) {}

  get alive() {
    return this.members.some((b) => b.alive);
  }
}

/** A projectile in flight: a bow's arrow or a musket ball. */
export interface Arrow {
  kind: 'arrow' | 'bullet';
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: Ball;
  dmg: number;
  dead: boolean;
}

/** A Spider's strand, stretched between two of its wall bounces. */
export interface Web {
  a: Vec;
  b: Vec;
  owner: Ball;
  age: number;
}

export interface Bomb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  owner: Ball;
  fuse: number;
  maxFuse: number;
  radius: number;
  dmg: number;
  dead: boolean;
}

export const WEB_LIFE = 14;
/** Seconds left on a bomb's fuse once an enemy comes close. */
const PROXIMITY_FUSE = 0.25;

const EXTRA_COLORS = ['#D6336C', '#5C940D', '#1C7ED6', '#E8590C', '#495057', '#9C36B5'];

export class Game {
  balls: Ball[] = [];
  teams: Team[] = [];
  arrows: Arrow[] = [];
  webs: Web[] = [];
  bombs: Bomb[] = [];
  fx = new Fx();
  time = 0;
  hitstop = 0;
  slowmo = 1;
  /** undefined while fighting, null on a draw. */
  winner: Team | null | undefined = undefined;
  overTime = 0;
  grab: { ball: Ball; x: number; y: number } | null = null;
  private acc = 0;
  private parryCd = new Map<string, number>();

  constructor(
    public cfg: GameConfig,
    public sfx: Sfx,
  ) {
    this.spawn();
  }

  get alive() {
    return this.balls.filter((b) => b.alive);
  }

  // ---------- setup ----------

  private spawn() {
    const total: Partial<Record<WeaponKind, number>> = {};
    for (const k of this.cfg.fighters) total[k] = (total[k] ?? 0) + 1;
    const seen: Partial<Record<WeaponKind, number>> = {};
    const usedColors = new Set<string>();
    let extra = 0;

    this.cfg.fighters.forEach((kind, i) => {
      const info = WEAPON_INFO[kind];
      seen[kind] = (seen[kind] ?? 0) + 1;
      const name = info.label.toUpperCase() + ((total[kind] ?? 0) > 1 ? ` ${seen[kind]}` : '');
      let color = info.color;
      if (usedColors.has(color)) color = EXTRA_COLORS[extra++ % EXTRA_COLORS.length];
      usedColors.add(color);

      const p = this.freeSpot();
      const b = new Ball(name, color, createWeapon(kind), p.x, p.y);
      b.scale = this.cfg.ballScale;
      b.r = BALL_RADIUS * b.scale;
      const a = rand(0, TAU);
      const s = rand(320, 440);
      b.vx = Math.cos(a) * s;
      b.vy = Math.sin(a) * s;
      if (b.weapon instanceof Unarmed) b.maxSpeed = 1800;
      const team = new Team(i, name, color, b.maxHp);
      team.members.push(b);
      b.team = team;
      this.teams.push(team);
      this.balls.push(b);
    });
  }

  private freeSpot(): Vec {
    const r = BALL_RADIUS * this.cfg.ballScale;
    for (let i = 0; i < 300; i++) {
      const x = rand(ARENA.cx - ARENA.half, ARENA.cx + ARENA.half);
      const y = rand(ARENA.cy - ARENA.half, ARENA.cy + ARENA.half);
      if (!this.inside(x, y, r + 30)) continue;
      if (i > 250 || this.balls.every((b) => Math.hypot(b.x - x, b.y - y) > r * 2 + 110)) return { x, y };
    }
    return { x: ARENA.cx, y: ARENA.cy };
  }

  inside(x: number, y: number, pad = 0) {
    if (this.cfg.arena === 'circle') return Math.hypot(x - ARENA.cx, y - ARENA.cy) <= ARENA.half - pad;
    return Math.abs(x - ARENA.cx) <= ARENA.half - pad && Math.abs(y - ARENA.cy) <= ARENA.half - pad;
  }

  // ---------- time ----------

  /** Advance by real elapsed time. Handles hitstop (freeze frames) and post-KO slow motion. */
  advance(realDt: number, speed: number) {
    let simDt = 0;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
    } else {
      simDt = realDt * speed * this.slowmo;
      this.acc += simDt;
      let steps = 0;
      while (this.acc >= DT && steps < 60) {
        this.step(DT);
        this.acc -= DT;
        steps++;
        if (this.hitstop > 0) {
          this.acc = 0;
          break;
        }
      }
      for (const b of this.balls) {
        if (!b.alive) continue;
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 12) b.trail.shift();
      }
    }
    this.slowmo += (1 - this.slowmo) * Math.min(1, realDt * 0.8);
    this.fx.update(simDt, realDt);
    for (const b of this.balls) {
      b.flash = Math.max(0, b.flash - realDt * 7);
      b.healGlow = Math.max(0, b.healGlow - realDt * 3);
      b.hpLag += (b.hp - b.hpLag) * Math.min(1, realDt * 4);
    }
    if (this.winner !== undefined) this.overTime += realDt;
  }

  private step(dt: number) {
    this.time += dt;
    const live = this.alive;

    for (const b of live) {
      if (this.grab?.ball === b) {
        // Spring toward the pointer; the resulting velocity is what flings it on release.
        b.vx = (this.grab.x - b.x) * 18;
        b.vy = (this.grab.y - b.y) * 18;
      } else {
        b.vy += this.cfg.gravity * dt;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const b of live) b.weapon.update(this, b, dt);
    for (const b of live) {
      const hit = this.wallCollide(b, b.r);
      if (hit) this.wallBounce(b, hit.x, hit.y, hit.speed);
    }

    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) this.collideBalls(live[i], live[j]);

    const parried = new Set<string>();
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) if (this.tryParry(live[i], live[j])) parried.add(pairKey(live[i], live[j]));

    for (const att of live) {
      if (!att.alive || !att.weapon.melee) continue;
      for (const tgt of live) {
        if (!tgt.alive || tgt.team === att.team || att.cooldowns.has(tgt.id) || parried.has(pairKey(att, tgt))) continue;
        this.tryMelee(att, tgt);
      }
    }

    this.updateArrows(dt);
    this.updateWebs(dt);
    this.updateBombs(dt);

    for (const b of this.balls) {
      for (const [id, t] of b.cooldowns) {
        if (t - dt <= 0) b.cooldowns.delete(id);
        else b.cooldowns.set(id, t - dt);
      }
      const s = b.speed;
      if (s > b.maxSpeed) {
        b.vx *= b.maxSpeed / s;
        b.vy *= b.maxSpeed / s;
      } else if (this.cfg.gravity === 0 && s < 220 && s > 0) {
        // Without gravity, keep things moving.
        b.vx *= 220 / s;
        b.vy *= 220 / s;
      }
    }
    for (const [k, t] of this.parryCd) {
      if (t - dt <= 0) this.parryCd.delete(k);
      else this.parryCd.set(k, t - dt);
    }

    const standing = this.teams.filter((t) => t.alive);
    if (this.winner === undefined && standing.length <= 1 && this.teams.length > 1) {
      this.winner = standing[0] ?? null;
      this.overTime = 0;
      this.sfx.win();
    }
  }

  // ---------- collisions ----------

  /**
   * Keeps a circle of radius `r` inside the arena, reflecting its velocity scaled by `bounce`.
   * Returns where it struck the wall and how fast it was moving into it, or null.
   */
  wallCollide(o: { x: number; y: number; vx: number; vy: number }, r: number, bounce = 1): { x: number; y: number; speed: number } | null {
    const { cx, cy, half } = ARENA;
    if (this.cfg.arena === 'circle') {
      const dx = o.x - cx;
      const dy = o.y - cy;
      const d = Math.hypot(dx, dy);
      if (d + r <= half || d === 0) return null;
      const nx = dx / d;
      const ny = dy / d;
      o.x = cx + nx * (half - r);
      o.y = cy + ny * (half - r);
      const vn = o.vx * nx + o.vy * ny;
      if (vn <= 0) return null;
      o.vx -= (1 + bounce) * vn * nx;
      o.vy -= (1 + bounce) * vn * ny;
      return { x: cx + nx * half, y: cy + ny * half, speed: vn };
    }
    let out: { x: number; y: number; speed: number } | null = null;
    const lo = { x: cx - half, y: cy - half };
    const hi = { x: cx + half, y: cy + half };
    if (o.x - r < lo.x) {
      o.x = lo.x + r;
      if (o.vx < 0) (out = { x: lo.x, y: o.y, speed: -o.vx }), (o.vx = -o.vx * bounce);
    } else if (o.x + r > hi.x) {
      o.x = hi.x - r;
      if (o.vx > 0) (out = { x: hi.x, y: o.y, speed: o.vx }), (o.vx = -o.vx * bounce);
    }
    if (o.y - r < lo.y) {
      o.y = lo.y + r;
      if (o.vy < 0) (out = { x: o.x, y: lo.y, speed: -o.vy }), (o.vy = -o.vy * bounce);
    } else if (o.y + r > hi.y) {
      o.y = hi.y - r;
      if (o.vy > 0) (out = { x: o.x, y: hi.y, speed: o.vy }), (o.vy = -o.vy * bounce);
    }
    return out;
  }

  /** `speed` is how fast the ball was moving into the wall. */
  private wallBounce(b: Ball, x: number, y: number, speed: number) {
    b.weapon.onWallBounce(this, b);
    if (this.time - b.lastBounceSound > 0.06) {
      b.lastBounceSound = this.time;
      this.sfx.bounce(speed / 900);
      this.fx.ring(x, y, b.color, 34, 3, 0.3);
      this.fx.burst(x, y, b.color, 5, 160, { size: 3, life: 0.3, grav: 0 });
    }
  }

  /**
   * Distance from (x, y) along `angle` to the first enemy ball or the arena wall,
   * and whether it's an enemy. Used for the musket's laser sight.
   */
  ray(x: number, y: number, angle: number, team: Team): { len: number; enemy: boolean } {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let len: number;
    if (this.cfg.arena === 'circle') {
      const ox = x - ARENA.cx;
      const oy = y - ARENA.cy;
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - ARENA.half * ARENA.half;
      len = -b + Math.sqrt(Math.max(0, b * b - c));
    } else {
      const tx = dx > 0 ? (ARENA.cx + ARENA.half - x) / dx : dx < 0 ? (ARENA.cx - ARENA.half - x) / dx : Infinity;
      const ty = dy > 0 ? (ARENA.cy + ARENA.half - y) / dy : dy < 0 ? (ARENA.cy - ARENA.half - y) / dy : Infinity;
      len = Math.max(0, Math.min(tx, ty));
    }
    let enemy = false;
    for (const e of this.balls) {
      if (!e.alive || e.team === team) continue;
      const ox = x - e.x;
      const oy = y - e.y;
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - e.r * e.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < len) {
        len = t;
        enemy = true;
      }
    }
    return { len, enemy };
  }

  private collideBalls(a: Ball, b: Ball) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const min = a.r + b.r;
    if (d >= min || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    const push = (min - d) / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return;
    // Equal-mass elastic collision: swap the normal components.
    a.vx += rv * nx;
    a.vy += rv * ny;
    b.vx -= rv * nx;
    b.vy -= rv * ny;
    const px = a.x + nx * a.r;
    const py = a.y + ny * a.r;
    this.sfx.bump();
    this.fx.burst(px, py, 'ink', 4, 180, { size: 2.5, life: 0.25, grav: 0 });
    if (a.team === b.team) return;

    for (const [att, tgt, sx] of [[a, b, 1], [b, a, -1]] as const) {
      const dmg = att.weapon.contactDamage(att);
      if (dmg > 0 && !att.cooldowns.has(tgt.id)) this.hit(att, tgt, dmg, px, py, nx * sx, ny * sx, 0.6);
    }
  }

  private tryParry(a: Ball, b: Ball): boolean {
    if (!a.weapon.solid || !b.weapon.solid || a.team === b.team) return false;
    const key = pairKey(a, b);
    if (this.parryCd.has(key)) return false;
    for (const ca of a.weapon.capsules(a)) {
      for (const cb of b.weapon.capsules(b)) {
        const res = segmentSegment(ca.a, ca.b, cb.a, cb.b);
        if (res.dist < ca.r + cb.r) {
          this.parry(a, b, (res.c1.x + res.c2.x) / 2, (res.c1.y + res.c2.y) / 2);
          this.parryCd.set(key, 0.18);
          return true;
        }
      }
    }
    return false;
  }

  /** Weapons clash: both reverse spin direction, sparks fly, balls get shoved apart. */
  private parry(a: Ball, b: Ball, x: number, y: number) {
    for (const w of [a.weapon, b.weapon]) {
      w.dir *= -1;
      w.angle += w.dir * 0.06;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    a.vx -= (dx / d) * 140;
    a.vy -= (dy / d) * 140;
    b.vx += (dx / d) * 140;
    b.vy += (dy / d) * 140;
    this.fx.burst(x, y, '#FFB703', 14, 650, { spark: true, size: 4, life: 0.3, grav: 200 });
    this.fx.burst(x, y, 'ink', 6, 400, { spark: true, size: 3, life: 0.25, grav: 200 });
    this.fx.ring(x, y, '#FFB703', 40, 4, 0.2);
    this.fx.shake(5);
    this.hitstop = Math.max(this.hitstop, 0.035);
    this.sfx.clang();
  }

  private tryMelee(att: Ball, tgt: Ball) {
    for (const c of att.weapon.capsules(att)) {
      const p = closestOnSegment(tgt, c.a, c.b);
      const dx = tgt.x - p.x;
      const dy = tgt.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= tgt.r + c.r) continue;
      let nx = dx / d;
      let ny = dy / d;
      if (!d) {
        const ax = tgt.x - att.x;
        const ay = tgt.y - att.y;
        const ad = Math.hypot(ax, ay) || 1;
        nx = ax / ad;
        ny = ay / ad;
      }
      this.hit(att, tgt, att.weapon.damage, p.x, p.y, nx, ny);
      return;
    }
  }

  // ---------- projectiles, webs, bombs ----------

  private updateArrows(dt: number) {
    for (const ar of this.arrows) {
      ar.x += ar.vx * dt;
      ar.y += ar.vy * dt;
      if (!this.inside(ar.x, ar.y, 2)) {
        ar.dead = true;
        this.fx.burst(ar.x, ar.y, '#7A4E2D', 4, 120, { size: 2, life: 0.25 });
        continue;
      }
      for (const b of this.balls) {
        if (!b.alive || b.team === ar.owner.team) continue;
        if (b.weapon.solid) {
          const blocked = b.weapon.capsules(b).some((c) => {
            const p = closestOnSegment(ar, c.a, c.b);
            return Math.hypot(ar.x - p.x, ar.y - p.y) < c.r + 3;
          });
          if (blocked) {
            ar.dead = true;
            if (ar.kind === 'bullet') {
              // Deflecting a bullet is a big deal — make it read like a parry.
              this.fx.burst(ar.x, ar.y, '#FFB703', 14, 600, { spark: true, size: 4, life: 0.3, grav: 0 });
              this.fx.ring(ar.x, ar.y, '#FFB703', 36, 4, 0.2);
              this.fx.shake(5);
              this.hitstop = Math.max(this.hitstop, 0.04);
              this.sfx.clang();
            } else {
              this.fx.burst(ar.x, ar.y, '#FFB703', 6, 350, { spark: true, size: 3, life: 0.2, grav: 0 });
              this.sfx.tink();
            }
            break;
          }
        }
        if (Math.hypot(ar.x - b.x, ar.y - b.y) < b.r + 3) {
          ar.dead = true;
          const s = Math.hypot(ar.vx, ar.vy) || 1;
          this.hit(ar.owner, b, ar.dmg, ar.x, ar.y, ar.vx / s, ar.vy / s, ar.kind === 'bullet' ? 1.4 : 0.5, false);
          break;
        }
      }
    }
    this.arrows = this.arrows.filter((a) => !a.dead);
  }

  /** Called by the Spider on each wall bounce: shoots a strand back to its previous bounce. */
  spinWeb(owner: Ball, from: Vec, to: Vec, maxWebs: number) {
    this.webs.push({ a: { ...from }, b: { ...to }, owner, age: 0 });
    const mine = this.webs.filter((w) => w.owner.team === owner.team);
    if (mine.length > maxWebs) this.webs.splice(this.webs.indexOf(mine[0]), 1);
    this.sfx.web();
  }

  private updateWebs(dt: number) {
    for (const w of this.webs) w.age += dt;
    this.webs = this.webs.filter((w) => w.age < WEB_LIFE);

    const snapped = new Set<Web>();
    for (const w of this.webs) {
      // Arrows and bullets shoot strands down.
      const shot = this.arrows.find((ar) => ar.owner.team !== w.owner.team && Math.hypot(closestOnSegment(ar, w.a, w.b).x - ar.x, closestOnSegment(ar, w.a, w.b).y - ar.y) < 4);
      if (shot) {
        snapped.add(w);
        this.fx.burst(shot.x, shot.y, 'ink', 8, 200, { size: 2, life: 0.35, grav: 300 });
        this.sfx.snap();
        continue;
      }
      for (const b of this.balls) {
        if (!b.alive || b.team === w.owner.team || snapped.has(w)) continue;

        // Blades cut strands.
        if (b.weapon.melee) {
          const cut = b.weapon.capsules(b).some((c) => segmentSegment(c.a, c.b, w.a, w.b).dist < c.r + 2);
          if (cut) {
            snapped.add(w);
            const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
            this.fx.burst(m.x, m.y, 'ink', 8, 200, { size: 2, life: 0.35, grav: 300 });
            this.sfx.snap();
            continue;
          }
        }

        // Bodies get caught: damage, then most of their speed is soaked up.
        const p = closestOnSegment(b, w.a, w.b);
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < b.r) {
          snapped.add(w);
          const nx = d ? (b.x - p.x) / d : 0;
          const ny = d ? (b.y - p.y) / d : -1;
          this.hit(w.owner, b, w.owner.weapon.damage, p.x, p.y, nx, ny, 0.1, false);
          b.vx *= 0.25;
          b.vy *= 0.25;
          this.fx.burst(p.x, p.y, 'ink', 10, 220, { size: 2, life: 0.4, grav: 300 });
          this.fx.text(b.x, b.y - b.r - 18, 'STUCK', w.owner.color, 20);
          this.sfx.snap();
        }
      }
    }
    if (snapped.size) this.webs = this.webs.filter((w) => !snapped.has(w));
  }

  dropBomb(owner: Ball, radius: number, dmg: number, fuse: number) {
    this.bombs.push({
      x: owner.x,
      y: owner.y,
      vx: owner.vx * 0.3,
      vy: owner.vy * 0.3 - 120,
      r: 12 * owner.scale,
      owner,
      fuse,
      maxFuse: fuse,
      radius,
      dmg,
      dead: false,
    });
    this.sfx.drop();
  }

  private updateBombs(dt: number) {
    const drag = Math.exp(-dt * 0.8);
    for (const bomb of this.bombs) {
      bomb.vy += this.cfg.gravity * dt;
      bomb.vx *= drag;
      bomb.vy *= drag;
      bomb.x += bomb.vx * dt;
      bomb.y += bomb.vy * dt;
      this.wallCollide(bomb, bomb.r, 0.5);
      bomb.fuse -= dt;
      // Proximity trigger: an enemy wandering close cuts the fuse short.
      if (bomb.fuse > PROXIMITY_FUSE) {
        const near = this.balls.some((b) => b.alive && b.team !== bomb.owner.team && Math.hypot(b.x - bomb.x, b.y - bomb.y) < b.r + bomb.radius * 0.45);
        if (near) bomb.fuse = PROXIMITY_FUSE;
      }
      if (bomb.fuse <= 0 && !bomb.dead) this.explode(bomb);
    }
    this.bombs = this.bombs.filter((b) => !b.dead);
  }

  private explode(bomb: Bomb) {
    bomb.dead = true;
    const { x, y, radius } = bomb;
    for (const b of this.balls) {
      if (!b.alive || b.team === bomb.owner.team) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d - b.r > radius) continue;
      const nx = d ? (b.x - x) / d : 0;
      const ny = d ? (b.y - y) / d : -1;
      this.hit(bomb.owner, b, bomb.dmg, b.x - nx * b.r, b.y - ny * b.r, nx, ny, 2.2, false);
    }
    // Blasts clear webs and set off nearby bombs.
    this.webs = this.webs.filter((w) => Math.hypot(closestOnSegment(bomb, w.a, w.b).x - x, closestOnSegment(bomb, w.a, w.b).y - y) > radius);
    for (const other of this.bombs) {
      if (!other.dead && Math.hypot(other.x - x, other.y - y) < radius) other.fuse = Math.min(other.fuse, 0.1);
    }

    this.fx.burst(x, y, '#FF8A00', 40, 700, { size: 8, life: 0.6, grav: 200 });
    this.fx.burst(x, y, '#FFD43B', 18, 900, { spark: true, size: 4, life: 0.3, grav: 0 });
    this.fx.burst(x, y, '#9aa0a6', 18, 220, { size: 12, life: 1.2, grav: -90 });
    this.fx.ring(x, y, '#FF8A00', radius, 10, 0.35);
    this.fx.ring(x, y, 'ink', radius * 0.6, 5, 0.25);
    this.fx.flash = Math.max(this.fx.flash, 0.18);
    this.fx.flashColor = '#FFB703';
    this.fx.shake(16);
    this.hitstop = Math.max(this.hitstop, 0.06);
    this.sfx.explosion();
  }

  // ---------- damage ----------

  hit(att: Ball, tgt: Ball, dmg: number, px: number, py: number, nx: number, ny: number, kb = att.weapon.knockback, cooldown = true) {
    if (!tgt.alive) return;
    tgt.hp = Math.max(0, tgt.hp - dmg);
    tgt.flash = 1;
    if (cooldown) att.cooldowns.set(tgt.id, att.weapon.hitCooldown);

    const push = (260 + dmg * 14) * kb;
    tgt.vx += nx * push;
    tgt.vy += ny * push;
    if (att.alive && this.grab?.ball !== att) {
      att.vx -= nx * 80;
      att.vy -= ny * 80;
    }

    const angle = Math.atan2(ny, nx);
    this.fx.burst(px, py, tgt.color, 10 + Math.min(dmg * 2, 30), 380 + dmg * 10, { angle, spread: 1.6, size: 5, life: 0.55 });
    this.fx.burst(px, py, '#FFB703', 6, 600, { angle, spread: 1.2, spark: true, size: 3, life: 0.2, grav: 0 });
    this.fx.text(px, py - 10, `-${fmt(dmg)}`, 'ink', 30 + Math.min(dmg * 2.5, 40));
    this.fx.shake(Math.min(3 + dmg * 1.2, 16));
    this.hitstop = Math.max(this.hitstop, Math.min(0.025 + dmg * 0.008, 0.14));
    this.sfx.hit(dmg);

    att.weapon.hits++;
    const label = att.weapon.onHit(this, att, tgt);
    if (label && att.alive) this.fx.text(att.x, att.y - att.r - 18, label, att.color, 20);

    if (tgt.hp <= 0) this.kill(tgt);
    else tgt.weapon.onDamaged(this, tgt);
  }

  /** Splits a Splitter ball in two smaller halves on the same team. */
  split(b: Ball) {
    const sp = b.speed || 300;
    const heading = Math.atan2(b.vy, b.vx);
    const hp = Math.round(b.hp * 0.5 * 10) / 10;
    const pieces = [b, new Ball(b.name, b.color, new Splitter(), b.x, b.y)];
    const twin = pieces[1];
    twin.team = b.team;
    twin.weapon.damage = b.weapon.damage;
    twin.maxSpeed = b.maxSpeed;
    b.team.members.push(twin);
    this.balls.push(twin);

    pieces.forEach((p, i) => {
      const side = i === 0 ? -1 : 1;
      p.generation = b.generation + 1;
      p.scale = b.scale * 0.78;
      p.r = BALL_RADIUS * p.scale;
      p.maxHp = b.maxHp / 2;
      p.hp = p.hpLag = hp;
      const a = heading + side * 0.6;
      p.vx = Math.cos(a) * sp * 1.1;
      p.vy = Math.sin(a) * sp * 1.1;
      p.x = b.x - Math.sin(heading) * side * p.r;
      p.y = b.y + Math.cos(heading) * side * p.r;
      p.flash = 1;
    });

    this.fx.burst(b.x, b.y, b.color, 30, 500, { size: 6, life: 0.6 });
    this.fx.ring(b.x, b.y, b.color, 90, 6, 0.3);
    this.fx.text(b.x, b.y - b.r - 20, 'SPLIT!', b.color, 30);
    this.fx.shake(10);
    this.hitstop = Math.max(this.hitstop, 0.08);
    this.sfx.split();
  }

  /** Muzzle flash, smoke and recoil for a gunshot fired from (x, y) along `angle`. */
  gunshot(shooter: Ball, x: number, y: number, angle: number) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    shooter.vx -= cos * 380;
    shooter.vy -= sin * 380;
    this.fx.burst(x, y, '#FFB703', 10, 650, { angle, spread: 0.5, spark: true, size: 4, life: 0.15, grav: 0 });
    this.fx.burst(x, y, '#ffffff', 5, 300, { angle, spread: 0.7, size: 7, life: 0.12, grav: 0 });
    this.fx.burst(x + cos * 10, y + sin * 10, '#9aa0a6', 14, 160, { angle, spread: 1.2, size: 9, life: 1.0, grav: -70 });
    this.fx.ring(x, y, '#FFB703', 30, 4, 0.15);
    this.fx.shake(8);
    this.sfx.gunshot();
  }

  heal(b: Ball, amount: number) {
    if (!b.alive || b.hp >= b.maxHp) return;
    b.hp = Math.min(b.maxHp, b.hp + amount);
    b.healGlow = 1;
    this.fx.text(b.x, b.y - b.r - 18, `+${fmt(amount)}`, '#1FAA59', 24);
    this.fx.burst(b.x, b.y, '#1FAA59', 8, 160, { size: 3, life: 0.5, grav: -200 });
    this.sfx.heal();
  }

  private kill(b: Ball) {
    b.alive = false;
    if (this.grab?.ball === b) this.grab = null;
    if (b.team.alive) {
      // One piece of a team down, but the fighter is still in it.
      this.fx.burst(b.x, b.y, b.color, 30, 500, { size: 6, life: 0.7, grav: 400 });
      this.fx.ring(b.x, b.y, b.color, 100, 6, 0.4);
      this.fx.text(b.x, b.y - 30, 'POP!', b.color, 36);
      this.fx.shake(12);
      this.hitstop = Math.max(this.hitstop, 0.08);
      this.sfx.split();
      return;
    }
    this.fx.burst(b.x, b.y, b.color, 70, 750, { size: 7, life: 1.1, grav: 400 });
    this.fx.burst(b.x, b.y, 'ink', 25, 900, { spark: true, size: 4, life: 0.5, grav: 0 });
    this.fx.ring(b.x, b.y, b.color, 220, 10, 0.6);
    this.fx.ring(b.x, b.y, 'ink', 140, 6, 0.4);
    this.fx.text(b.x, b.y - 40, 'K.O.!', b.color, 56);
    this.fx.shake(26);
    this.fx.flash = 0.35;
    this.fx.flashColor = b.color;
    this.hitstop = Math.max(this.hitstop, 0.18);
    this.slowmo = 0.2;
    this.sfx.kill();
  }
}

function pairKey(a: Ball, b: Ball) {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}
