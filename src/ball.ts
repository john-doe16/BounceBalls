import type { Vec } from './math';
import type { Weapon } from './weapons';

let nextId = 1;

export class Ball {
  readonly id = nextId++;
  vx = 0;
  vy = 0;
  /** Size multiplier for the ball and its weapon. */
  scale = 1;
  r = 34;
  hp = 100;
  maxHp = 100;
  /** Trails behind `hp` so the bar shows a white "chunk" draining after each hit. */
  hpLag = 100;
  alive = true;
  flash = 0;
  healGlow = 0;
  maxSpeed = 1100;
  grabbed = false;
  lastBounceSound = -1;
  trail: Vec[] = [];
  /** Per-target cooldown so one swing doesn't hit every frame it overlaps. */
  cooldowns = new Map<number, number>();

  constructor(
    public name: string,
    public color: string,
    public weapon: Weapon,
    public x: number,
    public y: number,
  ) {}

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
}
