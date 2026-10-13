import { TAU, fmt, type Capsule, type Vec } from './math';
import { ARROW, BOMB, BOW, MUSKET, SPIKE, COLLAR, DAGGER, HAMMER_HEAD, PX, SCYTHE_BLADE, SPEAR_HEAD, SWORD, drawOnAxis, drawShaft, drawSprite, spriteSize } from './pixel';
import type { Ball } from './ball';
import type { Game } from './game';

export type WeaponKind = 'sword' | 'dagger' | 'spear' | 'hammer' | 'scythe' | 'bow' | 'musket' | 'spider' | 'bomber' | 'splitter' | 'unarmed';

export const WEAPON_INFO: Record<WeaponKind, { label: string; color: string; blurb: string }> = {
  sword: { label: 'Sword', color: '#E63946', blurb: '+1 damage every hit' },
  dagger: { label: 'Dagger', color: '#2BA84A', blurb: 'Spins faster (and a bit harder) every hit' },
  spear: { label: 'Spear', color: '#F4B400', blurb: 'Longer and stronger every hit' },
  hammer: { label: 'Hammer', color: '#7B4FD6', blurb: 'Massive knockback, head grows every hit' },
  scythe: { label: 'Scythe', color: '#14A3A3', blurb: 'Lifesteal grows every hit' },
  bow: { label: 'Bow', color: '#F26B1D', blurb: '+1 arrow per volley every hit' },
  musket: { label: 'Musket', color: '#9C5B2E', blurb: 'Aims, then fires one heavy shot. +1 damage and faster reload every hit' },
  spider: { label: 'Spider', color: '#C2255C', blurb: 'Bounces spin webs between walls. Webs trap and hurt enemies' },
  bomber: { label: 'Bomber', color: '#343A40', blurb: 'Drops bombs that go off when an enemy gets close. Bigger blasts every hit' },
  splitter: { label: 'Splitter', color: '#74B816', blurb: 'Spiky body. Splits in two at half HP, up to four pieces' },
  unarmed: { label: 'Unarmed', color: '#2F6FDE', blurb: 'Faster every bounce, body slams for speed damage' },
};

export const WEAPON_KINDS = Object.keys(WEAPON_INFO) as WeaponKind[];

export abstract class Weapon {
  abstract readonly kind: WeaponKind;
  angle = Math.random() * TAU;
  /** +1 / -1. Parries flip it. */
  dir = Math.random() < 0.5 ? 1 : -1;
  /** Radians per second. */
  spin = 4;
  damage = 1;
  hitCooldown = 0.3;
  knockback = 1;
  /** Its hitboxes damage enemy balls. */
  melee = true;
  /** Its hitboxes can parry other weapons and block arrows. */
  solid = true;
  hits = 0;

  capsules(_b: Ball): Capsule[] {
    return [];
  }

  update(_g: Game, _b: Ball, dt: number) {
    this.angle += this.dir * this.spin * dt;
  }

  /** Called after this weapon (or one of its projectiles) lands a hit. Returns an upgrade label to pop up. */
  onHit(_g: Game, _self: Ball, _target: Ball): string | void {}

  onWallBounce(_g: Game, _self: Ball) {}

  /** Called after this weapon's ball takes damage and survives. */
  onDamaged(_g: Game, _self: Ball) {}

  /** Damage dealt by touching an enemy ball with the body (0 for none). */
  contactDamage(_self: Ball) {
    return 0;
  }

  abstract stats(b: Ball): string;
  abstract draw(ctx: CanvasRenderingContext2D, b: Ball): void;

  /** World point `along` px out from the ball center in the weapon's direction, shifted `side` px sideways. */
  protected at(b: Ball, along: number, side = 0): Vec {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: b.x + c * along - s * side, y: b.y + s * along + c * side };
  }

  /** Puts the canvas into weapon space: origin at the ball, +x pointing along the weapon. */
  protected local(ctx: CanvasRenderingContext2D, b: Ball) {
    ctx.translate(b.x, b.y);
    ctx.rotate(this.angle);
  }
}

// ---------- drawing helpers ----------

/** Outline color shared with the balls and sprites. */
export const INK = '#141414';

/** Motion-blur arc trailing behind a spinning weapon; longer the faster it spins. */
function swoosh(ctx: CanvasRenderingContext2D, w: Weapon, b: Ball, reach: number, width: number) {
  const span = Math.min(w.spin * 0.05, 1.6);
  if (span < 0.12) return;
  const steps = 8;
  ctx.save();
  ctx.strokeStyle = b.color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  for (let i = 0; i < steps; i++) {
    const a0 = w.angle - w.dir * span * (1 - i / steps);
    const a1 = w.angle - w.dir * span * (1 - (i + 1) / steps);
    ctx.globalAlpha = (0.2 * (i + 1)) / steps;
    ctx.beginPath();
    ctx.arc(b.x, b.y, reach, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- weapons ----------
// All sizes are for a scale-1 ball and get multiplied by `b.scale` (u).

export class Sword extends Weapon {
  readonly kind = 'sword';
  spin = 4.2;

  capsules(b: Ball): Capsule[] {
    const u = b.scale;
    return [{ a: this.at(b, b.r + 20 * u), b: this.at(b, b.r + 80 * u), r: 7 * u }];
  }

  onHit() {
    this.damage += 1;
    return '+1 DMG';
  }

  stats() {
    return `DMG ${fmt(this.damage)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    swoosh(ctx, this, b, b.r + 70 * u, 12 * u);
    ctx.save();
    this.local(ctx, b);
    drawOnAxis(ctx, SWORD, b.color, b.r - 14 * u, PX * u);
    ctx.restore();
  }
}

export class Dagger extends Weapon {
  readonly kind = 'dagger';
  spin = 9;
  hitCooldown = 0.1;

  capsules(b: Ball): Capsule[] {
    const u = b.scale;
    return [{ a: this.at(b, b.r + 14 * u), b: this.at(b, b.r + 51 * u), r: 6 * u }];
  }

  onHit() {
    this.spin = Math.min(this.spin + 1.6, 44);
    this.damage = Math.round((this.damage + 0.1) * 10) / 10;
    return 'SPIN UP';
  }

  stats() {
    return `SPIN ${this.spin.toFixed(1)}  DMG ${fmt(this.damage)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    swoosh(ctx, this, b, b.r + 46 * u, 10 * u);
    ctx.save();
    this.local(ctx, b);
    drawOnAxis(ctx, DAGGER, b.color, b.r - 10 * u, PX * u);
    ctx.restore();
  }
}

export class Spear extends Weapon {
  readonly kind = 'spear';
  length = 110;
  spin = 3.2;

  capsules(b: Ball): Capsule[] {
    const u = b.scale;
    return [{ a: this.at(b, b.r + 4 * u), b: this.at(b, b.r + this.length * u), r: 5 * u }];
  }

  onHit() {
    this.damage += 0.5;
    this.length = Math.min(this.length + 6, 230);
    return 'LONGER';
  }

  stats() {
    return `LEN ${Math.round(this.length)}  DMG ${fmt(this.damage)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const P = PX * u;
    const tip = b.r + this.length * u;
    const headX = tip - spriteSize(SPEAR_HEAD).w * P;
    swoosh(ctx, this, b, tip - 10 * u, 8 * u);
    ctx.save();
    this.local(ctx, b);
    drawShaft(ctx, b.r - 6 * u, headX + 2 * P, P);
    drawOnAxis(ctx, SPEAR_HEAD, b.color, headX, P);
    ctx.restore();
  }
}

export class Hammer extends Weapon {
  readonly kind = 'hammer';
  handle = 58;
  headScale = 0.8;
  spin = 2.6;
  damage = 2.5;
  knockback = 2.2;
  hitCooldown = 0.4;

  private head(b: Ball) {
    const { w, h } = spriteSize(HAMMER_HEAD);
    const s = PX * b.scale * this.headScale;
    return { x: b.r + this.handle * b.scale, w: w * s, h: h * s, s };
  }

  capsules(b: Ball): Capsule[] {
    const hd = this.head(b);
    const mid = hd.x + hd.w / 2;
    const reach = hd.h / 2 - hd.w / 2;
    return [
      { a: this.at(b, b.r), b: this.at(b, hd.x), r: 4.5 * b.scale },
      { a: this.at(b, mid, -reach), b: this.at(b, mid, reach), r: hd.w / 2 },
    ];
  }

  onHit() {
    this.damage += 0.5;
    this.headScale = Math.min(this.headScale + 0.1, 1.8);
    this.knockback = Math.min(this.knockback + 0.1, 3.5);
    return 'BIGGER';
  }

  stats() {
    return `DMG ${fmt(this.damage)}  KB x${this.knockback.toFixed(1)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const hd = this.head(b);
    swoosh(ctx, this, b, hd.x + hd.w / 2, Math.min(hd.h * 0.8, 40 * u));
    ctx.save();
    this.local(ctx, b);
    drawShaft(ctx, b.r - 6 * u, hd.x + 2 * u, PX * u);
    drawSprite(ctx, HAMMER_HEAD, b.color, hd.x, -hd.h / 2, hd.s);
    ctx.restore();
  }
}

export class Scythe extends Weapon {
  readonly kind = 'scythe';
  handle = 72;
  spin = 3.6;
  damage = 2;
  lifesteal = 1;
  /** Which side the blade hooks toward — fixed so it doesn't flip on parries. */
  private side = this.dir;

  capsules(b: Ball): Capsule[] {
    const P = PX * b.scale;
    const tip = b.r + this.handle * b.scale;
    const s = this.side;
    // Two segments follow the blade's curve (see SCYTHE_BLADE).
    const bend = this.at(b, tip - 8 * P, s * 3.5 * P);
    return [
      { a: this.at(b, b.r), b: this.at(b, tip), r: 4.5 * b.scale },
      { a: this.at(b, tip - P, 0), b: bend, r: 1.8 * P },
      { a: bend, b: this.at(b, tip - 13 * P, s * 11.5 * P), r: 1.8 * P },
    ];
  }

  onHit(g: Game, self: Ball) {
    g.heal(self, this.lifesteal);
    this.damage += 0.4;
    this.lifesteal = Math.min(this.lifesteal + 0.5, 5);
  }

  stats() {
    return `DMG ${fmt(this.damage)}  HEAL ${fmt(this.lifesteal)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const P = PX * u;
    const tip = b.r + this.handle * u;
    swoosh(ctx, this, b, tip - 12 * u, 14 * u);
    ctx.save();
    this.local(ctx, b);
    drawShaft(ctx, b.r - 6 * u, tip, P);
    drawSprite(ctx, SCYTHE_BLADE, b.color, tip - 14 * P, -1.5 * P, P, this.side < 0);
    drawOnAxis(ctx, COLLAR, b.color, tip - 6 * P, P);
    ctx.restore();
  }
}

export class Bow extends Weapon {
  readonly kind = 'bow';
  spin = 2.4;
  melee = false;
  arrows = 3;
  interval = 0.55;
  private reload = 0.5;

  capsules(b: Ball): Capsule[] {
    const P = PX * b.scale;
    const x = b.r + 2 * b.scale + 3 * P;
    return [{ a: this.at(b, x, -10 * P), b: this.at(b, x, 10 * P), r: 1.8 * P }];
  }

  update(g: Game, b: Ball, dt: number) {
    super.update(g, b, dt);
    this.reload -= dt;
    if (this.reload <= 0) {
      this.reload = this.interval;
      const spread = 0.12;
      for (let i = 0; i < this.arrows; i++) {
        const a = this.angle + (i - (this.arrows - 1) / 2) * spread;
        const p = this.at(b, b.r + 18 * b.scale);
        g.arrows.push({ kind: 'arrow', x: p.x, y: p.y, vx: Math.cos(a) * 1050, vy: Math.sin(a) * 1050, owner: b, dmg: this.damage, dead: false });
      }
      g.sfx.shoot();
    }
  }

  onHit() {
    this.arrows = Math.min(this.arrows + 1, 16);
    return '+1 ARROW';
  }

  stats() {
    return `ARROWS ${this.arrows}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const P = PX * u;
    const x0 = b.r + 2 * u;
    const pull = 4 * P * Math.max(0, 1 - this.reload / this.interval);
    const sx = x0 + P;
    ctx.save();
    this.local(ctx, b);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8 * P;
    ctx.beginPath();
    ctx.moveTo(sx, -10 * P);
    ctx.lineTo(sx - pull, 0);
    ctx.lineTo(sx, 10 * P);
    ctx.stroke();
    if (this.reload < this.interval * 0.8) drawArrow(ctx, sx - pull + spriteSize(ARROW).w * P, 0, 0, b.color, P);
    drawOnAxis(ctx, BOW, b.color, x0, P);
    ctx.restore();
  }
}

export class Musket extends Weapon {
  readonly kind = 'musket';
  spin = 2.2;
  melee = false;
  damage = 3;
  reloadTime = 2.4;
  private reload = 1.0;
  /** 1 right after firing, decays to 0; drives the kick-back animation. */
  private recoil = 0;
  private laser = { len: 0, locked: false };

  private muzzle(b: Ball) {
    return b.r + 82 * b.scale;
  }

  capsules(b: Ball): Capsule[] {
    const u = b.scale;
    return [{ a: this.at(b, b.r + 6 * u), b: this.at(b, this.muzzle(b)), r: 5 * u }];
  }

  update(g: Game, b: Ball, dt: number) {
    super.update(g, b, dt);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.reload -= dt;
    const m = this.at(b, this.muzzle(b));
    const ray = g.ray(m.x, m.y, this.angle, b.team);
    this.laser = { len: ray.len, locked: ray.enemy };
    if (this.reload <= 0 && this.linedUp(g, b)) {
      this.reload = this.reloadTime;
      this.recoil = 1;
      const p = this.at(b, this.muzzle(b));
      const c = Math.cos(this.angle);
      const s = Math.sin(this.angle);
      g.arrows.push({ kind: 'bullet', x: p.x, y: p.y, vx: c * 1700, vy: s * 1700, owner: b, dmg: this.damage, dead: false });
      g.gunshot(b, p.x, p.y, this.angle);
    }
  }

  /** Holds fire until the barrel points at an enemy, so shots look aimed. */
  private linedUp(g: Game, b: Ball) {
    return g.balls.some((e) => {
      if (e.team === b.team || !e.alive) return false;
      let d = Math.atan2(e.y - b.y, e.x - b.x) - this.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return Math.abs(d) < Math.atan2(e.r * 0.7, Math.hypot(e.x - b.x, e.y - b.y));
    });
  }

  onHit() {
    this.damage += 1;
    this.reloadTime = Math.max(1.0, this.reloadTime - 0.08);
    return '+1 DMG';
  }

  stats() {
    return `DMG ${fmt(this.damage)}  RELOAD ${this.reloadTime.toFixed(1)}s`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const ready = this.reload <= 0;
    ctx.save();
    this.local(ctx, b);
    // Faint laser sight: brighter when loaded, red with a dot when it's on a target.
    const x0 = this.muzzle(b);
    ctx.globalAlpha = this.laser.locked ? (ready ? 0.7 : 0.35) : ready ? 0.22 : 0.1;
    ctx.fillStyle = this.laser.locked ? '#FF2D2D' : b.color;
    ctx.fillRect(x0, -u, this.laser.len, 2 * u);
    if (this.laser.locked) ctx.fillRect(x0 + this.laser.len - 2 * PX * u, -PX * u, 2 * PX * u, 2 * PX * u);
    ctx.globalAlpha = 1;
    drawOnAxis(ctx, MUSKET, b.color, b.r - 16 * u - this.recoil * 10 * u, PX * u);
    ctx.restore();
  }
}

export class Spider extends Weapon {
  readonly kind = 'spider';
  spin = 0;
  melee = false;
  solid = false;
  damage = 2;
  maxWebs = 5;
  private anchor: Vec | null = null;
  private t = 0;

  update(_g: Game, b: Ball, dt: number) {
    this.t += dt;
    // Face where it's heading so the legs look like they're scuttling.
    const target = Math.atan2(b.vy, b.vx);
    const d = Math.atan2(Math.sin(target - this.angle), Math.cos(target - this.angle));
    this.angle += d * Math.min(1, dt * 6);
  }

  onWallBounce(g: Game, self: Ball) {
    const here = { x: self.x, y: self.y };
    if (this.anchor && Math.hypot(here.x - this.anchor.x, here.y - this.anchor.y) > 90 * self.scale) {
      g.spinWeb(self, this.anchor, here, this.maxWebs);
    }
    this.anchor = here;
  }

  onHit() {
    this.damage += 0.5;
    this.maxWebs = Math.min(this.maxWebs + 1, 14);
    return 'MORE WEB';
  }

  stats() {
    return `WEB DMG ${fmt(this.damage)}  WEBS ${this.maxWebs}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const P = PX * u;
    const polar = (a: number, d: number) => ({ x: Math.cos(a) * d, y: Math.sin(a) * d });
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = P;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const a = this.angle + side * (0.55 + (i % 4) * 0.5);
      const wiggle = Math.sin(this.t * 16 + i * 1.9) * 0.12;
      const root = polar(a, b.r * 0.85);
      const knee = polar(a + side * 0.12 + wiggle, b.r + 13 * u);
      const foot = polar(a + side * 0.42 + wiggle, b.r + 5 * u);
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
    }
    // Two pixel eyes on the leading edge.
    ctx.rotate(this.angle);
    ctx.fillStyle = INK;
    ctx.fillRect(b.r * 0.62 - P, -2.6 * P, 2 * P, 2 * P);
    ctx.fillRect(b.r * 0.62 - P, 0.6 * P, 2 * P, 2 * P);
    ctx.fillStyle = '#FF2D2D';
    ctx.fillRect(b.r * 0.62 - P / 2, -2.1 * P, P, P);
    ctx.fillRect(b.r * 0.62 - P / 2, 1.1 * P, P, P);
    ctx.restore();
  }
}

export class Bomber extends Weapon {
  readonly kind = 'bomber';
  spin = 1.6;
  melee = false;
  solid = false;
  damage = 7;
  radius = 100;
  interval = 2.2;
  fuse = 1.6;
  private reload = 1.0;

  update(g: Game, b: Ball, dt: number) {
    super.update(g, b, dt);
    this.reload -= dt;
    if (this.reload <= 0) {
      this.reload = this.interval;
      g.dropBomb(b, this.radius * b.scale, this.damage, this.fuse);
    }
  }

  onHit() {
    this.damage += 1;
    this.radius = Math.min(this.radius + 6, 170);
    this.interval = Math.max(1.5, this.interval - 0.08);
    return 'BIGGER BOOM';
  }

  stats() {
    return `DMG ${fmt(this.damage)}  BLAST ${Math.round(this.radius)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    // The next bomb, carried at the ball's edge; its fuse lights up just before it drops.
    const u = b.scale;
    const P = PX * u * 0.8;
    ctx.save();
    this.local(ctx, b);
    ctx.translate(b.r + 4 * P, 0);
    ctx.rotate(-this.angle);
    drawBombSprite(ctx, b.color, P, this.reload < 0.5 && Math.floor(this.reload * 12) % 2 === 0);
    ctx.restore();
  }
}

export class Splitter extends Weapon {
  readonly kind = 'splitter';
  spin = 1.4;
  melee = false;
  solid = false;
  damage = 2.5;
  hitCooldown = 0.3;

  contactDamage() {
    return this.damage;
  }

  onDamaged(g: Game, self: Ball) {
    if (self.generation < 2 && self.hp <= self.maxHp / 2) g.split(self);
  }

  onHit() {
    this.damage += 0.25;
    return 'SHARPER';
  }

  stats(b: Ball) {
    const pieces = b.team.members.filter((m) => m.alive).length;
    return `SPIKES ${fmt(this.damage)}  PIECES ${pieces}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    ctx.save();
    this.local(ctx, b);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(TAU / 8);
      drawOnAxis(ctx, SPIKE, b.color, b.r - 6 * u, PX * u);
    }
    ctx.restore();
  }
}

/** Draws a bomb centered on (0, 0). `lit` flashes the fuse spark. */
export function drawBombSprite(ctx: CanvasRenderingContext2D, color: string, P: number, lit: boolean) {
  drawSprite(ctx, BOMB, color, -4.5 * P, -8.5 * P, P);
  ctx.fillStyle = lit ? '#ffffff' : '#FFB703';
  ctx.fillRect(5.5 * P, -9.5 * P, 2 * P, 2 * P);
}

export class Unarmed extends Weapon {
  readonly kind = 'unarmed';
  spin = 0;
  melee = false;
  solid = false;
  hitCooldown = 0.35;

  onWallBounce(_g: Game, self: Ball) {
    self.vx *= 1.02;
    self.vy *= 1.02;
  }

  slamDamage(b: Ball) {
    return Math.max(1, Math.round(b.speed / 180));
  }

  contactDamage(b: Ball) {
    return this.slamDamage(b);
  }

  stats(b: Ball) {
    return `SPEED ${Math.round(b.speed)}  SLAM ${this.slamDamage(b)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const u = b.scale;
    const k = Math.min(1, b.speed / 2000);
    const sp = b.speed || 1;
    const ux = b.vx / sp;
    const uy = b.vy / sp;
    ctx.save();
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.3 + 0.6 * k;
    ctx.lineWidth = (3 + 3 * k) * u;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 6 * u, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = PX * u;
    for (const off of [-0.6, 0, 0.6]) {
      const px = -uy * b.r * off;
      const py = ux * b.r * off;
      const len = (20 + 70 * k) * u;
      const start = b.r + 8 * u;
      ctx.beginPath();
      ctx.moveTo(b.x + px - ux * start, b.y + py - uy * start);
      ctx.lineTo(b.x + px - ux * (start + len), b.y + py - uy * (start + len));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Draws a pixel arrow with its tip at (x, y), pointing along `angle`. */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, scale = PX) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  drawOnAxis(ctx, ARROW, color, -spriteSize(ARROW).w * scale, scale);
  ctx.restore();
}

export function createWeapon(kind: WeaponKind): Weapon {
  switch (kind) {
    case 'sword':
      return new Sword();
    case 'dagger':
      return new Dagger();
    case 'spear':
      return new Spear();
    case 'hammer':
      return new Hammer();
    case 'scythe':
      return new Scythe();
    case 'bow':
      return new Bow();
    case 'musket':
      return new Musket();
    case 'spider':
      return new Spider();
    case 'bomber':
      return new Bomber();
    case 'splitter':
      return new Splitter();
    case 'unarmed':
      return new Unarmed();
  }
}
