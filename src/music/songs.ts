// Songs for music mode. Each bounce plays the next chord; Beat Sync also uses each note's real
// start time, and can give every part (melody, harmony, bass, drums) its own ball.

export interface NoteEvent {
  /** When the chord starts in the original song, in seconds. Beat Sync uses it; other formats ignore it. */
  time: number;
  /** MIDI note numbers sounding together. */
  notes: number[];
  /** Seconds the chord rings for. */
  dur: number;
  /** 0..1 */
  vel: number;
}

/** Synth voice a part is played with. */
export type Voice = 'keys' | 'lead' | 'bass' | 'pad' | 'drums';

/** One instrument's line, e.g. the melody or the bass. Beat Sync can give each its own ball. */
export interface Part {
  name: string;
  voice: Voice;
  events: NoteEvent[];
}

export interface Song {
  id: string;
  name: string;
  /** Every pitched note, merged; used by the one-ball formats. */
  events: NoteEvent[];
  /** The song split by instrument. */
  parts?: Part[];
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" → 69, "C#5" → 73, "Bb3" → 58 */
export function noteNumber(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMITONES[m[1]] + acc;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(n: number) {
  return NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

/**
 * Parses one part's score: space-separated tokens, each a chord of `+`-joined notes or `R`
 * (a rest), with an optional `:beats` length (default 1), e.g. "E5 D#5 A4+C5:2 R:3".
 */
function line(text: string, beat: number, vel: number): NoteEvent[] {
  let time = 0;
  const out: NoteEvent[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    const [chord, beats] = tok.split(':');
    const dur = (beats ? Number(beats) : 1) * beat;
    if (chord !== 'R') out.push({ time, notes: chord.split('+').map(noteNumber), dur, vel });
    time += dur;
  }
  return out;
}

/** Every part's notes in one stream, with notes that start together merged into a chord. */
function mergeParts(parts: Part[]): NoteEvent[] {
  const all = parts
    .filter((p) => p.voice !== 'drums')
    .flatMap((p) => p.events)
    .sort((a, b) => a.time - b.time);
  const out: NoteEvent[] = [];
  for (const e of all) {
    const last = out[out.length - 1];
    if (last && Math.abs(e.time - last.time) < 1e-6) {
      for (const n of e.notes) if (!last.notes.includes(n)) last.notes.push(n);
      last.dur = Math.max(last.dur, e.dur);
      last.vel = Math.max(last.vel, e.vel);
    } else {
      out.push({ ...e, notes: [...e.notes] });
    }
  }
  return out;
}

interface Arrangement {
  /** Seconds per beat (one score unit). */
  beat: number;
  melody: string;
  harmony?: string;
  bass?: string;
}

function song(id: string, name: string, a: Arrangement): Song {
  const parts: Part[] = [{ name: 'MELODY', voice: 'keys', events: line(a.melody, a.beat, 0.8) }];
  if (a.harmony) parts.push({ name: 'HARMONY', voice: 'pad', events: line(a.harmony, a.beat, 0.6) });
  if (a.bass) parts.push({ name: 'BASS', voice: 'bass', events: line(a.bass, a.beat, 0.8) });
  return { id, name, events: mergeParts(parts), parts };
}

// ---------- arrangements (public-domain pieces, simplified) ----------

// Für Elise: 3/8, one unit = a sixteenth note. Right hand as melody, left-hand arpeggios as bass.
const FE_RH_A = [
  'E5 D#5 E5 B4 D5 C5', 'A4:2 R C4 E4 A4', 'B4:2 R E4 G#4 B4', 'C5:2 R E4 E5 D#5',
  'E5 D#5 E5 B4 D5 C5', 'A4:2 R C4 E4 A4', 'B4:2 R E4 C5 B4',
];
const FE_LH_A = ['R:6', 'A2 E3 A3 R:3', 'E2 E3 G#3 R:3', 'A2 E3 A3 R:3', 'R:6', 'A2 E3 A3 R:3', 'E2 E3 G#3 R:3'];
const FE_RH_B = ['A4:2 R B4 C5 D5', 'E5:3 G4 F5 E5', 'D5:3 F4 E5 D5', 'C5:3 E4 D5 C5', 'B4:2 E4 E5 E5 E6', 'D#5 E5 D#5 E5 E5 D#5'];
const FE_LH_B = ['A2 E3 A3 R:3', 'C3 G3 C4 R:3', 'G2 G3 B3 R:3', 'A2 E3 A3 R:3', 'E2 E3 E4 R:3', 'R:6'];
const FUR_ELISE: Arrangement = {
  beat: 0.25,
  melody: ['E5 D#5', ...FE_RH_A, ...FE_RH_B, ...FE_RH_A, 'A4:6'].join(' '),
  bass: ['R:2', ...FE_LH_A, ...FE_LH_B, ...FE_LH_A, 'A2+A3:6'].join(' '),
};

// Ode to Joy: 4/4, one unit = a quarter note. Melody up an octave, half-note pad chords, walking bass.
const C = 'C4+E4+G4';
const G = 'B3+D4+G4';
const OJ_VERSE = 'E5 E5 F5 G5 G5 F5 E5 D5 C5 C5 D5 E5';
const ODE_TO_JOY: Arrangement = {
  beat: 0.42,
  melody: [
    OJ_VERSE, 'E5:1.5 D5:0.5 D5:2',
    OJ_VERSE, 'D5:1.5 C5:0.5 C5:2',
    'D5 D5 E5 C5 D5 E5:0.5 F5:0.5 E5 C5 D5 E5:0.5 F5:0.5 E5 D5 C5 D5 G4:2',
    OJ_VERSE, 'D5:1.5 C5:0.5 C5:2',
  ].join(' '),
  harmony: [
    `${C}:2 ${C}:2 ${G}:2 ${G}:2 ${C}:2 ${C}:2 ${G}:2 ${G}:2`,
    `${C}:2 ${C}:2 ${G}:2 ${G}:2 ${C}:2 ${C}:2 ${G}:2 ${C}:2`,
    `${G}:2 ${C}:2 ${G}:2 ${C}:2 ${G}:2 ${C}:2 ${C}:2 ${G}:2`,
    `${C}:2 ${C}:2 ${G}:2 ${G}:2 ${C}:2 ${C}:2 ${G}:2 ${C}:2`,
  ].join(' '),
  bass: [
    'C3 G2 C3 G2 G2 D3 G2 D3 C3 G2 C3 G2 G2 D3 G2 D3',
    'C3 G2 C3 G2 G2 D3 G2 D3 C3 G2 C3 G2 G2 D3 C3:2',
    'G2 D3 C3 G2 G2 D3 C3 G2 G2 D3 C3 G2 C3 G2 G2 D3',
    'C3 G2 C3 G2 G2 D3 G2 D3 C3 G2 C3 G2 G2 D3 C3:2',
  ].join(' '),
};

// Canon in D: one unit = a quarter note. The ground bass loops under every phrase; the pad
// comes in on the second time round.
const CANON_BASS = 'D3:2 A2:2 B2:2 F#2:2 G2:2 D2:2 G2:2 A2:2';
const CANON_PAD =
  'D4+F#4+A4:2 C#4+E4+A4:2 B3+D4+F#4:2 A3+C#4+F#4:2 B3+D4+G4:2 A3+D4+F#4:2 B3+D4+G4:2 C#4+E4+A4:2';
const CANON_IN_D: Arrangement = {
  beat: 0.42,
  melody: [
    'F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2',
    'D5:2 C#5:2 B4:2 A4:2 G4:2 F#4:2 G4:2 E4:2',
    'D4 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4',
    'F#4 D4 E4 C#5 D5 F#5 A5 A4 B4 G4 A4 F#4 E4 D5 D5 C#5',
    'D5:0.5 C#5:0.5 D5:0.5 D4:0.5 C#4:0.5 A4:0.5 E4:0.5 F#4:0.5 D4:0.5 D5:0.5 C#5:0.5 B4:0.5 C#5:0.5 F#5:0.5 A5:0.5 B5:0.5',
    'G5:0.5 F#5:0.5 E5:0.5 G5:0.5 F#5:0.5 E5:0.5 D5:0.5 C#5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5 G4:0.5 F#4:0.5 E4:0.5',
    'D4:0.5 E4:0.5 F#4:0.5 G4:0.5 A4:0.5 E4:0.5 A4:0.5 G4:0.5 F#4:0.5 B4:0.5 A4:0.5 G4:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5',
    'D4:0.5 B3:0.5 B4:0.5 C#5:0.5 D5:0.5 C#5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5 B4:0.5 A4:0.5 B4:0.5 A4:0.5 G4:0.5',
    'F#4:4',
  ].join(' '),
  harmony: ['R:16', CANON_PAD, CANON_PAD, CANON_PAD, CANON_PAD, CANON_PAD, 'D4+F#4+A4:4'].join(' '),
  bass: [CANON_BASS, CANON_BASS, CANON_BASS, CANON_BASS, CANON_BASS, CANON_BASS, 'D2+D3:4'].join(' '),
};

// In the Hall of the Mountain King: one unit = an eighth note. The tune three times, rising, with
// the bass marking each beat and the pad joining from the second time.
const MK_TUNE = (o: number, last: string) =>
  [
    `B${o} C#${o + 1} D${o + 1} E${o + 1} F#${o + 1} D${o + 1} F#${o + 1}:2`,
    `F${o + 1} C#${o + 1} F${o + 1}:2 E${o + 1} C${o + 1} E${o + 1}:2`,
    `B${o} C#${o + 1} D${o + 1} E${o + 1} F#${o + 1} D${o + 1} F#${o + 1} B${o + 1}`,
    last,
  ].join(' ');
const MK_UP =
  'F#4 G#4 A#4 B4 C#5 A#4 C#5:2 C5 G#4 C5:2 B4 G4 B4:2 F#4 G#4 A#4 B4 C#5 A#4 C#5 F#5 E5 C#5 A#4 C#5 E5:4';
const MK_BASS_1 = 'B2:2 F#2:2 B2:2 F#2:2 C#3:2 C#3:2 C3:2 C3:2 B2:2 F#2:2 B2:2 F#2:2 D3:2 A2:2 D3:4';
const MK_BASS_2 = 'F#2:2 C#3:2 F#2:2 C#3:2 G#2:2 G#2:2 G2:2 G2:2 F#2:2 C#3:2 F#2:2 C#3:2 C#3:2 G#2:2 C#3:4';
const MOUNTAIN_KING: Arrangement = {
  beat: 0.24,
  melody: [MK_TUNE(3, 'A4 F#4 D4 F#4 A4:4'), MK_UP, MK_TUNE(4, 'A5 F#5 D5 F#5 B5:4')].join(' '),
  harmony: [
    'R:32',
    'F#3+A#3+C#4:4 F#3+A#3+C#4:4 G#3+C4:4 G3+B3:4 F#3+A#3+C#4:8 C#4+E4+A#4:8',
    'B3+D4+F#4:8 C#4+F4:4 C4+E4:4 B3+D4+F#4:8 B3+D4+F#4:8',
  ].join(' '),
  bass: [MK_BASS_1, MK_BASS_2, MK_BASS_1.replace(/D3:2 A2:2 D3:4$/, 'B2:2 F#2:2 B2+B1:4')].join(' '),
};

export const SONGS: Song[] = [
  song('fur-elise', 'Für Elise', FUR_ELISE),
  song('ode-to-joy', 'Ode to Joy', ODE_TO_JOY),
  song('canon-in-d', 'Canon in D', CANON_IN_D),
  song('mountain-king', 'Hall of the Mountain King', MOUNTAIN_KING),
];
