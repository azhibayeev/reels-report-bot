import { describe, it, expect } from "vitest";
import { parseMvhd, walkForDuration } from "../lib/mp4";

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, out.byteLength);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

/** mvhd версии 0: version+flags, created, modified, timescale, duration, хвост. */
function mvhdV0(timescale: number, duration: number): Uint8Array {
  const p = new Uint8Array(100);
  const v = new DataView(p.buffer);
  v.setUint32(0, 0); // version 0 + flags
  v.setUint32(12, timescale);
  v.setUint32(16, duration);
  return box("mvhd", p);
}

function mvhdV1(timescale: number, duration: bigint): Uint8Array {
  const p = new Uint8Array(112);
  const v = new DataView(p.buffer);
  p[0] = 1; // version 1
  v.setUint32(20, timescale);
  v.setBigUint64(24, duration);
  return box("mvhd", p);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const ftyp = box("ftyp", new Uint8Array(16));

describe("parseMvhd", () => {
  it("reads a version 0 header", () => {
    expect(parseMvhd(mvhdV0(600, 18_000), 0)).toBe(30);
  });

  it("reads a version 1 header with 64-bit duration", () => {
    expect(parseMvhd(mvhdV1(1000, 45_500n), 0)).toBe(45.5);
  });

  it("treats a zeroed header as unknown, not as zero seconds", () => {
    expect(parseMvhd(mvhdV0(0, 0), 0)).toBeNull();
    expect(parseMvhd(mvhdV0(600, 0), 0)).toBeNull();
  });

  it("returns null when the header is cut short", () => {
    expect(parseMvhd(mvhdV0(600, 18_000).slice(0, 20), 0)).toBeNull();
  });
});

describe("walkForDuration", () => {
  it("finds the duration in a faststart file", () => {
    const buf = concat(ftyp, box("moov", mvhdV0(600, 12_000)), box("mdat", new Uint8Array(64)));
    expect(walkForDuration(buf).duration).toBe(20);
  });

  it("skips boxes before moov", () => {
    const buf = concat(ftyp, box("free", new Uint8Array(40)), box("moov", mvhdV0(1000, 7500)));
    expect(walkForDuration(buf).duration).toBe(7.5);
  });

  it("asks to continue past an mdat that runs beyond the chunk", () => {
    const mdat = box("mdat", new Uint8Array(4096));
    const buf = concat(ftyp, mdat).slice(0, ftyp.byteLength + 100); // обрываем mdat
    const w = walkForDuration(buf);
    expect(w.duration).toBeNull();
    expect(w.continueAt).toBe(ftyp.byteLength + mdat.byteLength);
  });

  it("reports file offsets, not chunk offsets, when resuming", () => {
    const mdat = box("mdat", new Uint8Array(4096));
    const buf = mdat.slice(0, 100);
    expect(walkForDuration(buf, 5000).continueAt).toBe(5000 + mdat.byteLength);
  });

  it("asks to refetch from the start of a truncated moov", () => {
    const moov = box("moov", mvhdV0(600, 12_000));
    const buf = concat(ftyp, moov).slice(0, ftyp.byteLength + 12);
    const w = walkForDuration(buf);
    expect(w.duration).toBeNull();
    expect(w.continueAt).toBe(ftyp.byteLength);
  });

  it("gives up on a box declared to run to end of file", () => {
    const open = new Uint8Array(8 + 16);
    for (let i = 0; i < 4; i++) open[4 + i] = "mdat".charCodeAt(i); // size 0 = до конца файла
    expect(walkForDuration(concat(ftyp, open))).toEqual({ duration: null, continueAt: null });
  });
});
