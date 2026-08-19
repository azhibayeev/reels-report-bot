import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderHook, Runner } from "../lib/farm/render";
import { wrapHook } from "../lib/farm/wrap";

// Настоящий бинарник ffmpeg из репозитория — не мок: проверяем, что строка
// фильтра, которую строит ffmpegArgs, живой ffmpeg 6.0 действительно съедает.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FFMPEG: string = require("ffmpeg-static");
const FONT = join(process.cwd(), "assets", "hook.ttf");

const runner: Runner = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });

let dir = "";
let source = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "qa-farm-"));
  source = join(dir, "src.mp4");
  const { code, stderr } = await runner(FFMPEG, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=720x1280:rate=30:duration=2",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    source,
  ]);
  expect(code, stderr.slice(-400)).toBe(0);
}, 120_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function render(hook: string): Promise<{ ok: boolean; error: string }> {
  const lines = wrapHook(hook);
  expect(lines, `хук не переносится: ${hook}`).not.toBeNull();
  const out = join(dir, `out-${Math.random().toString(36).slice(2)}.mp4`);
  const textPaths = lines!.map((_, i) => join(dir, `t-${Math.random().toString(36).slice(2)}-${i}.txt`));
  try {
    await renderHook(
      {
        sourcePath: source,
        textPaths,
        outPath: out,
        fontPath: FONT,
        hookLines: lines!,
        hasAudio: true,
        position: "top",
      },
      { runner, writeText: (p, t) => writeFile(p, t, "utf8"), ffmpegPath: FFMPEG, fontReadable: async () => true }
    );
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const info = await stat(out);
  expect(info.size).toBeGreaterThan(1000);
  return { ok: true, error: "" };
}

describe("рендер хука настоящим ffmpeg", () => {
  it("обычный латинский хук собирается", async () => {
    expect(await render("Jangan tunggu Ramadan")).toEqual({ ok: true, error: "" });
  }, 120_000);

  it("процент в хуке не роняет рендер (expansion=none)", async () => {
    expect(await render("Sedekah 100% gratis")).toEqual({ ok: true, error: "" });
  }, 120_000);

  it("апостроф и запятая внутри хука", async () => {
    expect(await render("Qur'an itu obat, coba")).toEqual({ ok: true, error: "" });
  }, 120_000);

  it("двоеточие внутри хука", async () => {
    expect(await render("Ingat: rezeki itu luas")).toEqual({ ok: true, error: "" });
  }, 120_000);

  it("обратный слэш внутри хука", async () => {
    expect(await render("Pilih A \\ B sekarang")).toEqual({ ok: true, error: "" });
  }, 120_000);
});
