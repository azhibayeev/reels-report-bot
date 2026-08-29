import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { burnSubtitles, probeSize, RunResult } from "../lib/dub/burn";

// Настоящие ffmpeg и ffprobe из репозитория — не моки: проверяем, что цепочку
// overlay на десяток звеньев живой ffmpeg действительно съедает, а канвас рисует
// латиницу тем же шрифтом, что ферма — кириллицу.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FFMPEG: string = require("ffmpeg-static");
const FFPROBE = join(
  process.cwd(),
  "node_modules",
  "ffprobe-static",
  "bin",
  process.platform,
  process.arch,
  "ffprobe"
);
const FONT = join(process.cwd(), "assets", "hook.ttf");

const run = (bin: string, args: string[]): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-8000)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

// Тот же формат, что отдаёт ElevenLabs: перевод репликами с таймингами.
const SRT = `1
00:00:00,200 --> 00:00:01,600
Panggilan untuk semua followers yang jago editing

2
00:00:01,600 --> 00:00:02,900
dan mampu membuat video seperti ini

3
00:00:02,900 --> 00:00:03,800
tolong segera DM gue ya
`;

const deps = (getTranscript: () => Promise<string>) => ({
  run,
  ffmpegPath: FFMPEG,
  ffprobePath: FFPROBE,
  fontPath: FONT,
  getTranscript,
});

let dir = "";
let source = Buffer.alloc(0);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "qa-dub-"));
  const path = join(dir, "src.mp4");
  const { code, stderr } = await run(FFMPEG, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=540x960:rate=30:duration=4",
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
    path,
  ]);
  expect(code, stderr.slice(-400)).toBe(0);
  source = await readFile(path);
}, 120_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("вжигание субтитров настоящим ffmpeg", () => {
  it("собирает ролик и сохраняет размер кадра — подпись обязана лечь пиксель в пиксель", async () => {
    const out = await burnSubtitles(source, "dub_1", deps(async () => SRT));
    expect(out.length).toBeGreaterThan(1000);

    const path = join(dir, "out.mp4");
    await writeFile(path, out);
    expect(await probeSize(path, { run, ffprobePath: FFPROBE })).toEqual({ width: 540, height: 960 });
  }, 180_000);

  it("вжатый ролик тяжелее исходного: поверх кадра действительно что-то нарисовано", async () => {
    const out = await burnSubtitles(source, "dub_1", deps(async () => SRT));
    expect(out.length).toBeGreaterThan(source.length);
  }, 180_000);

  it("звук остаётся на месте — его копируют, а не пережимают", async () => {
    const out = await burnSubtitles(source, "dub_1", deps(async () => SRT));
    const path = join(dir, "audio.mp4");
    await writeFile(path, out);
    const { stdout } = await run(FFPROBE, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      path,
    ]);
    expect(stdout.trim()).toBe("aac");
  }, 180_000);

  it("реплика на пол-экрана шириной не уезжает за кадр: кегль подбирается по метрике шрифта", async () => {
    const long =
      "1\n00:00:00,000 --> 00:00:03,000\n" +
      "Panggilan untuk semua followers yang jago editing dan mampu membuat video seperti ini serta bisa bikin subtitle serupa\n";
    const out = await burnSubtitles(source, "dub_1", deps(async () => long));
    expect(out.length).toBeGreaterThan(1000);
  }, 180_000);

  it("без реплик бросает, а не отдаёт молча тот же ролик — иначе кнопка выглядит проглоченной", async () => {
    await expect(burnSubtitles(source, "dub_1", deps(async () => ""))).rejects.toThrow(/ни одной реплики/);
  });

  it("битый размер кадра не роняет отрисовку: откатываемся к вертикали", async () => {
    expect(await probeSize(join(dir, "нет-такого.mp4"), { run, ffprobePath: FFPROBE })).toEqual({
      width: 1080,
      height: 1920,
    });
  }, 30_000);
});
