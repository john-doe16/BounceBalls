// Every sound is synthesized with Web Audio — no asset files needed.

import type { Voice } from './music/songs';

interface VoiceShape {
  /** [waveform, frequency multiple, level] layered per note. */
  partials: [OscillatorType, number, number][];
  attack: number;
  /** Level it settles to after the first hit, as a share of the peak. */
  sustain: number;
  /** Filter opens to this multiple of the note's frequency, then closes partway. */
  bright: number;
  maxCutoff: number;
  gain: number;
}

/** The instrument voices: different enough that parts are easy to tell apart. */
const VOICES: Record<Exclude<Voice, 'drums'>, VoiceShape> = {
  keys: { partials: [['triangle', 1, 1], ['sine', 2, 0.25], ['sine', 1.003, 0.4]], attack: 0.006, sustain: 0.35, bright: 8, maxCutoff: 4000, gain: 1 },
  lead: { partials: [['sawtooth', 1, 0.45], ['square', 1, 0.2], ['triangle', 2, 0.15]], attack: 0.01, sustain: 0.6, bright: 6, maxCutoff: 3500, gain: 1.7 },
  bass: { partials: [['sine', 1, 1], ['triangle', 1, 0.6], ['sawtooth', 1, 0.12]], attack: 0.005, sustain: 0.55, bright: 6, maxCutoff: 900, gain: 0.8 },
  pad: { partials: [['sawtooth', 1, 0.3], ['sawtooth', 1.007, 0.3], ['triangle', 0.5, 0.3]], attack: 0.06, sustain: 0.7, bright: 4, maxCutoff: 1800, gain: 1.6 },
};

const BASE_GAIN = 0.7;

export class Sfx {
  enabled = true;
  /** 0..2, where 1 is the default level. */
  private vol = 1;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private last: Record<string, number> = {};

  get volume() {
    return this.vol;
  }

  set volume(v: number) {
    this.vol = v;
    if (this.ctx) this.master.gain.setTargetAtTime(BASE_GAIN * v, this.ctx.currentTime, 0.02);
  }

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      this.master = ctx.createGain();
      this.master.gain.value = BASE_GAIN * this.vol;
      this.master.connect(comp).connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Returns the start time if the sound may play, or null when muted / throttled. */
  private ready(key: string, minGap: number): number | null {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return null;
    const t = this.ctx.currentTime;
    if ((this.last[key] ?? -1) > t - minGap) return null;
    this.last[key] = t;
    return t;
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, peak: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(t: number, peak: number, dur: number, type: BiquadFilterType, freq: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Wall bounce: a short rubbery thud, louder the harder the ball hits (`impact` 0..1). */
  bounce(impact: number) {
    const t = this.ready('bounce', 0.03);
    if (t === null) return;
    const k = Math.max(0.15, Math.min(1, impact));
    const f = 120 + Math.random() * 30;
    this.tone('sine', f, f * 0.5, t, 0.12 + 0.3 * k, 0.09);
    this.burst(t, 0.04 + 0.12 * k, 0.04, 'lowpass', 700 + 600 * k);
  }

  gunshot() {
    const t = this.ready('gunshot', 0.08);
    if (t === null) return;
    this.burst(t, 0.45, 0.03, 'highpass', 3000);
    this.burst(t, 0.6, 0.4, 'lowpass', 2200);
    this.tone('sine', 110, 32, t, 0.75, 0.32);
  }

  explosion() {
    const t = this.ready('explosion', 0.06);
    if (t === null) return;
    this.tone('sine', 140, 30, t, 0.9, 0.6);
    this.burst(t, 0.7, 0.6, 'lowpass', 1600);
    this.burst(t, 0.3, 0.05, 'highpass', 2500);
  }

  drop() {
    const t = this.ready('drop', 0.1);
    if (t === null) return;
    this.tone('square', 520, 260, t, 0.04, 0.06);
  }

  /** Strand shooting out to the wall. */
  web() {
    const t = this.ready('web', 0.08);
    if (t === null) return;
    this.burst(t, 0.08, 0.12, 'bandpass', 4200, 4);
  }

  snap() {
    const t = this.ready('snap', 0.04);
    if (t === null) return;
    this.burst(t, 0.25, 0.05, 'highpass', 2800);
    this.tone('triangle', 900, 300, t, 0.05, 0.06);
  }

  split() {
    const t = this.ready('split', 0.08);
    if (t === null) return;
    this.tone('sine', 260, 90, t, 0.5, 0.18);
    this.burst(t, 0.35, 0.12, 'bandpass', 1400, 1.2);
  }

  private musicBus: GainNode | null = null;

  /** Music-mode bus: dry signal plus a short generated reverb tail. */
  private bus(): GainNode {
    if (this.musicBus) return this.musicBus;
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    const len = Math.floor(ctx.sampleRate * 1.8);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const verb = ctx.createConvolver();
    verb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    bus.connect(this.master);
    bus.connect(verb).connect(wet).connect(this.master);
    this.musicBus = bus;
    return bus;
  }

  /** Plays MIDI notes together as a chord in the given voice. */
  chord(notes: number[], dur: number, vel = 0.8, voice: Voice = 'keys') {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    if (voice === 'drums') {
      for (const n of notes) this.drum(n, vel);
      return;
    }
    const ctx = this.ctx;
    const out = this.bus();
    const v = VOICES[voice];
    const t = ctx.currentTime;
    const ring = Math.min(Math.max(dur, 0.25), 1.6);
    const peak = (0.32 * v.gain * vel) / Math.sqrt(notes.length);
    for (const n of notes) {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + v.attack);
      g.gain.exponentialRampToValueAtTime(peak * v.sustain, t + v.attack + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + v.attack + 0.25 + ring);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(9000, f * v.bright), t);
      lp.frequency.exponentialRampToValueAtTime(Math.min(v.maxCutoff, f * v.bright * 0.4), t + 0.3);
      lp.connect(g).connect(out);
      for (const [type, mult, level] of v.partials) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult;
        const lg = ctx.createGain();
        lg.gain.value = level;
        o.connect(lg).connect(lp);
        o.start(t);
        o.stop(t + v.attack + 0.3 + ring);
      }
    }
  }

  /** One General MIDI drum note: kicks, snares, hats, toms and cymbals are synthesized from noise and sweeps. */
  private drum(n: number, vel: number) {
    const t = this.ctx!.currentTime;
    const k = 0.4 + 0.6 * vel;
    if (n === 35 || n === 36) {
      this.tone('sine', 160, 42, t, 1.0 * k, 0.28);
      this.burst(t, 0.15 * k, 0.02, 'lowpass', 3000);
    } else if (n >= 37 && n <= 40) {
      this.burst(t, 1.1 * k, 0.16, 'bandpass', 1900, 0.7);
      this.tone('triangle', 200, 150, t, 0.25 * k, 0.1);
    } else if (n === 42 || n === 44) {
      this.burst(t, 0.5 * k, 0.05, 'highpass', 7500);
    } else if (n === 46) {
      this.burst(t, 0.2 * k, 0.3, 'highpass', 7000);
    } else if (n === 49 || n === 52 || n === 55 || n === 57) {
      this.burst(t, 0.28 * k, 1.1, 'highpass', 5000);
    } else if (n === 51 || n === 53 || n === 59) {
      this.burst(t, 0.16 * k, 0.4, 'highpass', 6000);
      this.tone('square', 5200, 5200, t, 0.015 * k, 0.05);
    } else if (n >= 41 && n <= 50) {
      const f = 70 + (n - 41) * 18;
      this.tone('sine', f * 1.6, f, t, 0.6 * k, 0.3);
    } else {
      this.burst(t, 0.15 * k, 0.04, 'highpass', 4000);
    }
  }

  bump() {
    const t = this.ready('bump', 0.05);
    if (t === null) return;
    this.tone('sine', 220, 110, t, 0.18, 0.1);
  }

  hit(dmg: number) {
    const t = this.ready('hit', 0.02);
    if (t === null) return;
    const heavy = Math.min(dmg / 12, 1);
    this.tone('sine', 190 - heavy * 60, 45, t, 0.45 + heavy * 0.3, 0.16 + heavy * 0.12);
    this.burst(t, 0.35, 0.09 + heavy * 0.08, 'bandpass', 2400 - heavy * 1200, 0.8);
    this.burst(t, 0.18, 0.05, 'highpass', 5000);
  }

  clang() {
    const t = this.ready('clang', 0.03);
    if (t === null) return;
    const k = 0.9 + Math.random() * 0.2;
    for (const f of [1250, 1870, 2930, 4100]) this.tone('triangle', f * k, f * k * 0.98, t, 0.06, 0.35);
    this.tone('square', 3300 * k, 3300 * k, t, 0.025, 0.08);
    this.burst(t, 0.25, 0.04, 'highpass', 3500);
  }

  tink() {
    const t = this.ready('tink', 0.03);
    if (t === null) return;
    const f = 2600 + Math.random() * 800;
    this.tone('triangle', f, f, t, 0.06, 0.12);
  }

  shoot() {
    const t = this.ready('shoot', 0.04);
    if (t === null) return;
    this.burst(t, 0.14, 0.07, 'bandpass', 3000, 2);
    this.tone('sine', 900, 380, t, 0.06, 0.07);
  }

  heal() {
    const t = this.ready('heal', 0.06);
    if (t === null) return;
    this.tone('sine', 880, 1320, t, 0.07, 0.16);
  }

  kill() {
    const t = this.ready('kill', 0.1);
    if (t === null) return;
    this.tone('sine', 220, 28, t, 0.8, 0.9);
    this.tone('sawtooth', 110, 30, t, 0.12, 0.5);
    this.burst(t, 0.55, 0.7, 'lowpass', 1400);
  }

  win() {
    const t = this.ready('win', 0.5);
    if (t === null) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone('triangle', f, f, t + 0.25 + i * 0.1, 0.16, 0.5);
      this.tone('sine', f * 2, f * 2, t + 0.25 + i * 0.1, 0.05, 0.3);
    });
  }
}
