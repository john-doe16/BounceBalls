import type { NoteEvent, Song } from './songs';

/** Notes starting closer together than this (seconds) are played as one chord. */
const CHORD_WINDOW = 0.03;
const DRUM_CHANNEL = 9;

interface RawEvent {
  tick: number;
  order: number;
  kind: 'on' | 'off' | 'tempo';
  ch: number;
  note: number;
  vel: number;
  tempo: number;
}

/**
 * Reads a Standard MIDI File (format 0 or 1) into a Song: the note-ons in order, grouped into
 * chords. Drums are skipped. Throws an Error with a readable message if the file isn't usable.
 */
export function parseMidi(buf: ArrayBuffer, name: string): Song {
  const d = new DataView(buf);
  let p = 0;
  const need = (n: number) => {
    if (p + n > d.byteLength) throw new Error('This MIDI file is cut off or damaged.');
  };
  const u8 = () => (need(1), d.getUint8(p++));
  const u16 = () => (need(2), (p += 2), d.getUint16(p - 2));
  const u32 = () => (need(4), (p += 4), d.getUint32(p - 4));
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };

  if (d.byteLength < 14 || tag() !== 'MThd') throw new Error("That file isn't a MIDI file (.mid).");
  const headerLen = u32();
  u16(); // format
  const tracks = u16();
  const division = u16();
  p = 8 + headerLen;
  if (division & 0x8000) throw new Error('MIDI files with SMPTE timing are not supported.');
  const ppq = division || 480;

  const events: RawEvent[] = [];
  let order = 0;
  for (let t = 0; t < tracks && p < d.byteLength; t++) {
    if (tag() !== 'MTrk') throw new Error('This MIDI file has a damaged track.');
    const len = u32();
    const end = p + len;
    const trackEnd = Math.min(end, d.byteLength);
    let tick = 0;
    let status = 0;
    while (p < trackEnd) {
      tick += vlq();
      let b = u8();
      if (b === 0xff) {
        const type = u8();
        const len = vlq();
        if (type === 0x51 && len === 3) {
          const tempo = (u8() << 16) | (u8() << 8) | u8();
          events.push({ tick, order: order++, kind: 'tempo', ch: 0, note: 0, vel: 0, tempo });
        } else {
          p += len;
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        p += vlq();
        continue;
      }
      if (b & 0x80) status = b;
      else p--; // running status: this byte is data
      b = status;
      const type = b & 0xf0;
      const ch = b & 0x0f;
      if (type === 0x90 || type === 0x80) {
        const note = u8();
        const vel = u8();
        const kind = type === 0x90 && vel > 0 ? 'on' : 'off';
        if (ch !== DRUM_CHANNEL) events.push({ tick, order: order++, kind, ch, note, vel: vel / 127, tempo: 0 });
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1;
      } else {
        p += 2;
      }
    }
    p = end;
  }

  // Ticks → seconds through the tempo map.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let tempo = 500000;
  let lastTick = 0;
  let seconds = 0;
  const timed = events.map((e) => {
    seconds += ((e.tick - lastTick) / ppq) * (tempo / 1e6);
    lastTick = e.tick;
    if (e.kind === 'tempo') tempo = e.tempo;
    return { ...e, time: seconds };
  });

  // Pair note-ons with their note-offs for durations.
  const open = new Map<string, { time: number; vel: number; note: number }[]>();
  const notes: { time: number; note: number; vel: number; dur: number }[] = [];
  for (const e of timed) {
    const key = `${e.ch}:${e.note}`;
    if (e.kind === 'on') {
      const list = open.get(key) ?? [];
      list.push({ time: e.time, vel: e.vel, note: e.note });
      open.set(key, list);
    } else if (e.kind === 'off') {
      const start = open.get(key)?.shift();
      if (start) notes.push({ ...start, dur: e.time - start.time });
    }
  }
  for (const list of open.values()) for (const s of list) notes.push({ ...s, dur: 0.5 });
  notes.sort((a, b) => a.time - b.time);
  if (!notes.length) throw new Error('No notes found in this MIDI file.');

  const out: NoteEvent[] = [];
  let groupStart = -1;
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && n.time - groupStart < CHORD_WINDOW) {
      if (!last.notes.includes(n.note)) last.notes.push(n.note);
      last.dur = Math.max(last.dur, n.dur);
      last.vel = Math.max(last.vel, n.vel);
    } else {
      out.push({ time: n.time - notes[0].time, notes: [n.note], dur: n.dur, vel: n.vel });
      groupStart = n.time;
    }
  }
  return { id: `upload:${name}`, name: name.replace(/\.(mid|midi)$/i, ''), events: out };
}
