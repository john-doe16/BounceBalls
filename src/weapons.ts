import { TAU, fmt, type Capsule, type Vec } from './math';
import type { Ball } from './ball';
import type { Game } from './game';

export type WeaponKind = 'sword' | 'dagger' | 'spear' | 'hammer' | 'scythe' | 'bow' | 'unarmed';

export const WEAPON_INFO: Record<WeaponKind, { label: string; color: string; blurb: string }> = {
  sword: { label: 'Sword', color: '#ff4d5e', blurb: '+1 damage every hit' },
  dagger: { label: 'Dagger', color: '#3ee07a', blurb: 'Spins faster (and a bit harder) every hit' },
  spear: { label: 'Spear', color: '#ffd23f', blurb: 'Longer and stronger every hit' },
  hammer: { label: 'Hammer', color: '#a66bff', blurb: 'Massive knockback, head grows every hit' },
  scythe: { label: 'Scythe', color: '#2ad4c9', blurb: 'Lifesteal grows every hit' },
  bow: { label: 'Bow', color: '#ff8c42', blurb: '+1 arrow per volley every hit' },
  unarmed: { label: 'Unarmed', color: '#4da6ff', blurb: 'Faster every bounce, body slams for speed damage' },
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

function metal(ctx: CanvasRenderingContext2D, hw: number) {
  const g = ctx.createLinearGradient(0, -hw, 0, hw);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, '#c9d2de');
  g.addColorStop(1, '#7f8a9c');
  return g;
}

function bladePath(ctx: CanvasRenderingContext2D, x0: number, x1: number, hw: number, tip: number) {
  ctx.beginPath();
  ctx.moveTo(x0, -hw);
  ctx.lineTo(x1 - tip, -hw);
  ctx.lineTo(x1, 0);
  ctx.lineTo(x1 - tip, hw);
  ctx.lineTo(x0, hw);
  ctx.closePath();
}

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
    ctx.globalAlpha = (0.28 * (i + 1)) / steps;
    ctx.beginPath();
    ctx.arc(b.x, b.y, reach, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- weapons ----------

export class Sword extends Weapon {
  readonly kind = 'sword';
  length = 84;
  spin = 4.2;

  capsules(b: Ball): Capsule[] {
    return [{ a: this.at(b, b.r + 6), b: this.at(b, b.r + this.length), r: 6 }];
  }

  onHit() {
    this.damage += 1;
    return '+1 DMG';
  }

  stats() {
    return `DMG ${fmt(this.damage)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const r = b.r;
    const L = this.length;
    swoosh(ctx, this, b, r + L - 8, 12);
    ctx.save();
    this.local(ctx, b);
    ctx.fillStyle = '#5b3b22';
    ctx.fillRect(r - 8, -3.5, 18, 7);
    ctx.fillStyle = '#e0b453';
    ctx.beginPath();
    ctx.roundRect(r + 8, -14, 6, 28, 3);
    ctx.fill();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = Math.min(4 + this.damage * 1.8, 36);
    bladePath(ctx, r + 14, r + L, 6, 16);
    ctx.fillStyle = metal(ctx, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r + 18, 0);
    ctx.lineTo(r + L - 18, 0);
    ctx.stroke();
    ctx.restore();
  }
}

export class Dagger extends Weapon {
  readonly kind = 'dagger';
  length = 50;
  spin = 9;
  hitCooldown = 0.1;

  capsules(b: Ball): Capsule[] {
    return [{ a: this.at(b, b.r + 4), b: this.at(b, b.r + this.length), r: 5 }];
  }

  onHit() {
    this.spin = Math.min(this.spin + 2, 48);
    this.damage = Math.round((this.damage + 0.1) * 10) / 10;
    return 'SPIN UP';
  }

  stats() {
    return `SPIN ${this.spin.toFixed(1)}  DMG ${fmt(this.damage)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const r = b.r;
    const L = this.length;
    swoosh(ctx, this, b, r + L - 6, 10);
    ctx.save();
    this.local(ctx, b);
    ctx.fillStyle = '#2f2f3a';
    ctx.fillRect(r - 6, -3, 14, 6);
    ctx.fillStyle = '#9aa3b2';
    ctx.beginPath();
    ctx.roundRect(r + 7, -8, 4, 16, 2);
    ctx.fill();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = Math.min(this.spin, 32);
    bladePath(ctx, r + 11, r + L, 4.5, 12);
    ctx.fillStyle = metal(ctx, 4.5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

export class Spear extends Weapon {
  readonly kind = 'spear';
  length = 110;
  spin = 3.2;

  capsules(b: Ball): Capsule[] {
    return [{ a: this.at(b, b.r + 4), b: this.at(b, b.r + this.length), r: 4.5 }];
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
    const r = b.r;
    const L = this.length;
    swoosh(ctx, this, b, r + L - 10, 8);
    ctx.save();
    this.local(ctx, b);
    ctx.strokeStyle = '#9a6a3c';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r - 6, 0);
    ctx.lineTo(r + L - 22, 0);
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(r + L - 26, 0);
    ctx.lineTo(r + L - 40, -8);
    ctx.lineTo(r + L - 36, 0);
    ctx.lineTo(r + L - 40, 8);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = Math.min(4 + this.damage * 3, 30);
    ctx.beginPath();
    ctx.moveTo(r + L - 26, -7);
    ctx.lineTo(r + L, 0);
    ctx.lineTo(r + L - 26, 7);
    ctx.lineTo(r + L - 21, 0);
    ctx.closePath();
    ctx.fillStyle = metal(ctx, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

export class Hammer extends Weapon {
  readonly kind = 'hammer';
  handle = 58;
  growth = 0;
  spin = 2.6;
  damage = 3;
  knockback = 2.2;
  hitCooldown = 0.4;

  private get hw() {
    return 17 + this.growth;
  }

  private get depth() {
    return 22 + this.growth * 0.6;
  }

  capsules(b: Ball): Capsule[] {
    const mid = b.r + this.handle + this.depth / 2;
    return [
      { a: this.at(b, b.r), b: this.at(b, b.r + this.handle), r: 4 },
      { a: this.at(b, mid, -this.hw + this.depth / 2), b: this.at(b, mid, this.hw - this.depth / 2), r: this.depth / 2 },
    ];
  }

  onHit() {
    this.damage += 0.5;
    this.growth = Math.min(this.growth + 2.5, 30);
    this.knockback = Math.min(this.knockback + 0.1, 3.5);
    return 'BIGGER';
  }

  stats() {
    return `DMG ${fmt(this.damage)}  KB x${this.knockback.toFixed(1)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const r = b.r;
    const hw = this.hw;
    const d = this.depth;
    swoosh(ctx, this, b, r + this.handle + d / 2, Math.min(hw * 1.4, 34));
    ctx.save();
    this.local(ctx, b);
    ctx.strokeStyle = '#6b4a2e';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r - 6, 0);
    ctx.lineTo(r + this.handle, 0);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, '#b8c0cc');
    g.addColorStop(1, '#4f5560');
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 8 + this.growth;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(r + this.handle, -hw, d, hw * 2, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#2e3238';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.fillRect(r + this.handle + d * 0.2, -hw, 3, hw * 2);
    ctx.fillRect(r + this.handle + d * 0.8 - 3, -hw, 3, hw * 2);
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
    const tip = b.r + this.handle;
    return [
      { a: this.at(b, b.r), b: this.at(b, tip), r: 4 },
      { a: this.at(b, tip, 0), b: this.at(b, tip - 24, this.side * 50), r: 6 },
    ];
  }

  onHit(g: Game, self: Ball) {
    g.heal(self, this.lifesteal);
    this.damage += 0.25;
    this.lifesteal = Math.min(this.lifesteal + 0.5, 4);
  }

  stats() {
    return `DMG ${fmt(this.damage)}  HEAL ${fmt(this.lifesteal)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const r = b.r;
    const tip = r + this.handle;
    const s = this.side;
    swoosh(ctx, this, b, tip - 8, 14);
    ctx.save();
    this.local(ctx, b);
    ctx.strokeStyle = '#3f2d1f';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r - 6, 0);
    ctx.lineTo(tip + 4, 0);
    ctx.stroke();
    ctx.shadowColor = '#38ff9c';
    ctx.shadowBlur = 6 + this.lifesteal * 3;
    ctx.beginPath();
    ctx.moveTo(tip + 3, -s * 4);
    ctx.quadraticCurveTo(tip + 14, s * 30, tip - 28, s * 56);
    ctx.quadraticCurveTo(tip - 2, s * 28, tip - 6, s * 2);
    ctx.closePath();
    ctx.fillStyle = metal(ctx, 30);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#3c4654';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export class Bow extends Weapon {
  readonly kind = 'bow';
  spin = 2.4;
  melee = false;
  arrows = 2;
  interval = 0.55;
  private reload = 0.5;

  capsules(b: Ball): Capsule[] {
    return [{ a: this.at(b, b.r + 16, -28), b: this.at(b, b.r + 16, 28), r: 4 }];
  }

  update(g: Game, b: Ball, dt: number) {
    super.update(g, b, dt);
    this.reload -= dt;
    if (this.reload <= 0) {
      this.reload = this.interval;
      const spread = 0.12;
      for (let i = 0; i < this.arrows; i++) {
        const a = this.angle + (i - (this.arrows - 1) / 2) * spread;
        const p = this.at(b, b.r + 18);
        g.arrows.push({ x: p.x, y: p.y, vx: Math.cos(a) * 1050, vy: Math.sin(a) * 1050, owner: b, dmg: this.damage, dead: false });
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
    const r = b.r;
    const R = 30;
    const A = 1.15;
    const ex = r + 2 + R * Math.cos(A);
    const ey = R * Math.sin(A);
    const pull = 12 * Math.max(0, 1 - this.reload / this.interval);
    ctx.save();
    this.local(ctx, b);
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ex, -ey);
    ctx.lineTo(ex - pull, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (this.reload < this.interval * 0.8) drawArrow(ctx, ex - pull, 0, ex - pull + 34, 0, b.color);
    ctx.shadowColor = b.color;
    ctx.shadowBlur = Math.min(4 + this.arrows * 2, 30);
    ctx.strokeStyle = '#9a6a3c';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(r + 2, 0, R, -A, A);
    ctx.stroke();
    ctx.restore();
  }
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

  stats(b: Ball) {
    return `SPEED ${Math.round(b.speed)}  SLAM ${this.slamDamage(b)}`;
  }

  draw(ctx: CanvasRenderingContext2D, b: Ball) {
    const k = Math.min(1, b.speed / 2000);
    const sp = b.speed || 1;
    const ux = b.vx / sp;
    const uy = b.vy / sp;
    ctx.save();
    ctx.strokeStyle = b.color;
    ctx.lineCap = 'round';
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 10 + 30 * k;
    ctx.globalAlpha = 0.3 + 0.6 * k;
    ctx.lineWidth = 3 + 3 * k;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 6, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (const off of [-0.6, 0, 0.6]) {
      const px = -uy * b.r * off;
      const py = ux * b.r * off;
      const len = 20 + 70 * k;
      ctx.beginPath();
      ctx.moveTo(b.x + px - ux * (b.r + 8), b.y + py - uy * (b.r + 8));
      ctx.lineTo(b.x + px - ux * (b.r + 8 + len), b.y + py - uy * (b.r + 8 + len));
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.strokeStyle = '#d9c4a0';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.translate(x1, y1);
  ctx.rotate(a);
  ctx.fillStyle = '#e6ebf2';
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-5, -4.5);
  ctx.lineTo(-5, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-2, -5);
  ctx.lineTo(1, 0);
  ctx.lineTo(-2, 5);
  ctx.closePath();
  ctx.fill();
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
    case 'unarmed':
      return new Unarmed();
  }
}
