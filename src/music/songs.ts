// A song here is just the order of notes: in music mode each bounce plays the next chord,
// so the ball's rhythm *is* the song's rhythm. Durations only shape how long a note rings.

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

export interface Song {
  id: string;
  name: string;
  events: NoteEvent[];
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BEAT = 0.4;

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
 * Parses a space-separated score: each token is a chord of `+`-joined notes with an
 * optional `:beats` length, e.g. "E5 D#5 A4+A2:2".
 */
function score(id: string, name: string, text: string): Song {
  let time = 0;
  const events = text
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [chord, beats] = tok.split(':');
      const dur = (beats ? Number(beats) : 1) * BEAT;
      const ev = { time, notes: chord.split('+').map(noteNumber), dur, vel: 0.8 };
      time += dur;
      return ev;
    });
  return { id, name, events };
}

const FUR_ELISE_A = `
  E5 D#5 E5 D#5 E5 B4 D5 C5 A4+A2:2 E3 A3 C4 E4 A4 B4+E2:2 E3 G#3 E4 G#4 B4 C5+A2:2 E3 A3 E4
  E5 D#5 E5 D#5 E5 B4 D5 C5 A4+A2:2 E3 A3 C4 E4 A4 B4+E2:2 E3 G#3 E4 C5 B4 A4+A2:3 E3 A3`;
const FUR_ELISE_B = `
  B4 C5 D5 E5+C3:2 G3 C4 G4 F5 E5 D5+G2:2 G3 B3 F4 E5 D5 C5+A2:2 E3 A3 E4 D5 C5 B4+E2:2 E3 E4
  E4 E5 E4 E5 E5 E6 D#5 E5 D#5 E5 D#5 E5 D#5`;

const ODE_TO_JOY = `
  E4+C3 E4 F4 G4 G4+G2 F4 E4 D4 C4+A2 C4 D4 E4 E4+G2:1.5 D4:0.5 D4:2
  E4+C3 E4 F4 G4 G4+G2 F4 E4 D4 C4+A2 C4 D4 E4 D4+G2:1.5 C4:0.5 C4+C3:2
  D4+G2 D4 E4 C4 D4+G2 E4:0.5 F4:0.5 E4 C4 D4+G2 E4:0.5 F4:0.5 E4 D4 C4+C3 D4 G3:2
  E4+C3 E4 F4 G4 G4+G2 F4 E4 D4 C4+A2 C4 D4 E4 D4+G2:1.5 C4:0.5 C4+C3:3`;

const CANON_IN_D = `
  F#5+D3:2 E5+A2:2 D5+B2:2 C#5+F#2:2 B4+G2:2 A4+D2:2 B4+G2:2 C#5+A2:2
  D5+D3:2 C#5+A2:2 B4+B2:2 A4+F#2:2 G4+G2:2 F#4+D2:2 G4+G2:2 E4+A2:2
  D4+D3 F#4 A4 G4 F#4+A2 D4 F#4 E4 D4+B2 B3 D4 A4 G4+F#2 B4 A4 G4
  F#4+G2 D4 E4 C#5 D5+D2 F#5 A5 A4 B4+G2 G4 A4 F#4 E4+A2 D5 D5 C#5
  D5+D3:0.5 C#5:0.5 D5:0.5 D4:0.5 C#4:0.5 A4:0.5 E4:0.5 F#4:0.5
  D4+A2:0.5 D5:0.5 C#5:0.5 B4:0.5 C#5:0.5 F#5:0.5 A5:0.5 B5:0.5
  G5+B2:0.5 F#5:0.5 E5:0.5 G5:0.5 F#5:0.5 E5:0.5 D5:0.5 C#5:0.5
  B4+F#2:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5 G4:0.5 F#4:0.5 E4:0.5
  D4+G2:0.5 E4:0.5 F#4:0.5 G4:0.5 A4:0.5 E4:0.5 A4:0.5 G4:0.5
  F#4+D2:0.5 B4:0.5 A4:0.5 G4:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5
  D4+G2:0.5 B3:0.5 B4:0.5 C#5:0.5 D5:0.5 C#5:0.5 B4:0.5 A4:0.5
  G4+A2:0.5 F#4:0.5 E4:0.5 B4:0.5 A4:0.5 B4:0.5 A4:0.5 G4:0.5 F#4+D3:3`;

const MOUNTAIN_KING = `
  B3+B2 C#4 D4 E4 F#4+B2 D4 F#4:2 F4+C#3 C#4 F4:2 E4+C3 C4 E4:2
  B3+B2 C#4 D4 E4 F#4+B2 D4 F#4 B4 A4+F#2 F#4 D4 F#4 A4:2
  F#4+F#3 G#4 A#4 B4 C#5+F#3 A#4 C#5:2 C5+G#3 G#4 C5:2 B4+G3 G4 B4:2
  F#4+F#3 G#4 A#4 B4 C#5+F#3 A#4 C#5 F#5 E5+C#3 C#5 A#4 C#5 E5:2
  B4+B2 C#5 D5 E5 F#5+B2 D5 F#5:2 F5+C#3 C#5 F5:2 E5+C3 C5 E5:2
  B4+B2 C#5 D5 E5 F#5+B2 D5 F#5 B5 A5+F#2 F#5 D5 F#5 B5+B2+F#3:3`;

export const SONGS: Song[] = [
  score('fur-elise', 'Für Elise', FUR_ELISE_A + FUR_ELISE_B + FUR_ELISE_A),
  score('ode-to-joy', 'Ode to Joy', ODE_TO_JOY),
  score('canon-in-d', 'Canon in D', CANON_IN_D),
  score('mountain-king', 'Hall of the Mountain King', MOUNTAIN_KING),
];
