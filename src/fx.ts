import { rand, type Vec } from './math';
import { PX } from './pixel';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  spark: boolean;
  grav: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  maxR: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

export interface BurstOpts {
  angle?: number;
  spread?: number;
  size?: number;
  life?: number;
  spark?: boolean;
  grav?: number;
}

/** Particles, floating numbers, shockwaves, screen shake and flashes. */
export class Fx {
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private shakeAmt = 0;
  flash = 0;
  flashColor = '#ffffff';
  /** Theme colors, set by the renderer. Effects can use the color 'ink' to mean "contrasts with the background". */
  ink = '#111111';
  paper = '#ffffff';

  private c(color: string) {
    return color === 'ink' ? this.ink : color;
  }

  burst(x: number, y: number, color: string, count: number, speed: number, o: BurstOpts = {}) {
    const spread = o.spread ?? Math.PI * 2;
    const base = o.angle ?? 0;
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * spread;
      const s = speed * rand(0.35, 1);
      const life = (o.life ?? 0.5) * rand(0.6, 1.2);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: (o.size ?? 4) * rand(0.6, 1.3),
        color,
        spark: o.spark ?? false,
        grav: o.grav ?? 600,
      });
    }
  }

  text(x: number, y: number, text: string, color: string, size: number) {
    this.texts.push({ x: x + rand(-8, 8), y, vy: -90, text, color, life: 0.9, max: 0.9, size });
  }

  ring(x: number, y: number, color: string, maxR: number, width = 4, life = 0.35) {
    this.rings.push({ x, y, maxR, life, max: life, color, width });
  }

  shake(amount: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  shakeOffset(): Vec {
    return { x: rand(-1, 1) * this.shakeAmt, y: rand(-1, 1) * this.shakeAmt };
  }

  /** `dt` is simulation time (freezes during hitstop); `realDt` drives shake and flash. */
  update(dt: number, realDt: number) {
    this.shakeAmt *= Math.exp(-realDt * 9);
    if (this.shakeAmt < 0.1) this.shakeAmt = 0;
    this.flash = Math.max(0, this.flash - realDt * 2.5);

    const drag = Math.exp(-dt * 3);
    for (const p of this.particles) {
      p.vx *= drag;
      p.vy = p.vy * drag + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.y += t.vy * dt;
      t.vy *= Math.exp(-dt * 2);
      t.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = this.c(r.color);
      ctx.lineWidth = r.width * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.maxR * (0.2 + 0.8 * Math.sqrt(k)), 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      // Square particles snapped to the sprite pixel grid, so they match the pixel-art weapons.
      ctx.fillStyle = this.c(p.color);
      const size = Math.max(PX, Math.round((p.spark ? p.size * 0.8 : p.size * (0.5 + 0.9 * k)) / PX) * PX);
      const snap = (v: number) => Math.round(v / PX) * PX;
      ctx.fillRect(snap(p.x) - size / 2, snap(p.y) - size / 2, size, size);
      if (p.spark) ctx.fillRect(snap(p.x - p.vx * 0.02) - size / 2, snap(p.y - p.vy * 0.02) - size / 2, size, size);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const age = 1 - t.life / t.max;
      const pop = 1 + 0.7 * Math.max(0, 1 - age * 7);
      ctx.globalAlpha = Math.min(1, (t.life / t.max) * 3);
      ctx.font = `800 ${Math.round(t.size * pop)}px 'Barlow Condensed', sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = this.paper;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = this.c(t.color);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
