import { Ball } from './ball';
import type { Sfx } from './audio';
import { Fx } from './fx';
import { TAU, closestOnSegment, fmt, rand, segmentSegment, type Vec } from './math';
import { Unarmed, WEAPON_INFO, createWeapon, type WeaponKind } from './weapons';

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

const EXTRA_COLORS = ['#D6336C', '#5C940D', '#1C7ED6', '#E8590C', '#495057', '#9C36B5'];

export class Game {
  balls: Ball[] = [];
  arrows: Arrow[] = [];
  fx = new Fx();
  time = 0;
  hitstop = 0;
  slowmo = 1;
  /** undefined while fighting, null on a draw. */
  winner: Ball | null | undefined = undefined;
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

    for (const kind of this.cfg.fighters) {
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
      this.balls.push(b);
    }
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
    for (const b of live) this.collideWalls(b);

    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) this.collideBalls(live[i], live[j]);

    const parried = new Set<string>();
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) if (this.tryParry(live[i], live[j])) parried.add(pairKey(live[i], live[j]));

    for (const att of live) {
      if (!att.alive || !att.weapon.melee) continue;
      for (const tgt of live) {
        if (tgt === att || !tgt.alive || att.cooldowns.has(tgt.id) || parried.has(pairKey(att, tgt))) continue;
        this.tryMelee(att, tgt);
      }
    }

    this.updateArrows(dt);

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

    if (this.winner === undefined && this.alive.length <= 1 && this.balls.length > 1) {
      this.winner = this.alive[0] ?? null;
      this.overTime = 0;
      this.sfx.win();
    }
  }

  // ---------- collisions ----------

  private collideWalls(b: Ball) {
    const { cx, cy, half } = ARENA;
    if (this.cfg.arena === 'circle') {
      const dx = b.x - cx;
      const dy = b.y - cy;
      const d = Math.hypot(dx, dy);
      if (d + b.r > half && d > 0) {
        const nx = dx / d;
        const ny = dy / d;
        b.x = cx + nx * (half - b.r);
        b.y = cy + ny * (half - b.r);
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= 2 * vn * nx;
          b.vy -= 2 * vn * ny;
          this.wallBounce(b, cx + nx * half, cy + ny * half, vn);
        }
      }
      return;
    }
    const lo = { x: cx - half, y: cy - half };
    const hi = { x: cx + half, y: cy + half };
    if (b.x - b.r < lo.x) {
      b.x = lo.x + b.r;
      if (b.vx < 0) {
        b.vx = -b.vx;
        this.wallBounce(b, lo.x, b.y, b.vx);
      }
    } else if (b.x + b.r > hi.x) {
      b.x = hi.x - b.r;
      if (b.vx > 0) {
        b.vx = -b.vx;
        this.wallBounce(b, hi.x, b.y, -b.vx);
      }
    }
    if (b.y - b.r < lo.y) {
      b.y = lo.y + b.r;
      if (b.vy < 0) {
        b.vy = -b.vy;
        this.wallBounce(b, b.x, lo.y, b.vy);
      }
    } else if (b.y + b.r > hi.y) {
      b.y = hi.y - b.r;
      if (b.vy > 0) {
        b.vy = -b.vy;
        this.wallBounce(b, b.x, hi.y, -b.vy);
      }
    }
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

    for (const [att, tgt, sx] of [[a, b, 1], [b, a, -1]] as const) {
      if (att.weapon instanceof Unarmed && !att.cooldowns.has(tgt.id)) {
        this.hit(att, tgt, att.weapon.slamDamage(att), px, py, nx * sx, ny * sx, 0.6);
      }
    }
  }

  private tryParry(a: Ball, b: Ball): boolean {
    if (!a.weapon.solid || !b.weapon.solid) return false;
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
        if (!b.alive || b === ar.owner) continue;
        if (b.weapon.solid) {
          const blocked = b.weapon
            .capsules(b)
            .some((c) => {
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
