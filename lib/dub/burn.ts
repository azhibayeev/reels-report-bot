import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSrt, trimOverlaps } from "./srt";
import { burnArgs, drawCuePng, MAX_CUES } from "./subtitles";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface BurnDeps {
  run: (bin: string, args: string[]) => Promise<RunResult>;
  ffmpegPath: string;
  ffprobePath: string;
  fontPath: string;
  getTranscript: (dubbingId: string) => Promise<string>;
}

// Запасной размер кадра: ffprobe не должен молчать, но если ролик без видеопотока
// или с битым заголовком — рисовать в нулевой холст хуже, чем в вертикальный.
const FALLBACK = { width: 1080, height: 1920 };

export async function probeSize(
  path: string,
  deps: Pick<BurnDeps, "run" | "ffprobePath">
): Promise<{ width: number; height: number }> {
  const { code, stdout } = await deps.run(deps.ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number);
  if (code !== 0 || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return FALLBACK;
  return { width: w, height: h };
}

/**
 * Вжигает индонезийские субтитры в готовый дубляж. Текст берётся у ElevenLabs —
 * это тот же перевод, что лёг в озвучку, поэтому расхождения между звуком и
 * строкой быть не может.
 *
 * Бросает, если реплик нет: доставке нужно отличать «субтитры не легли» от
 * «субтитры легли пустыми», иначе человек получит ролик и не поймёт, что не так.
 */
export async function burnSubtitles(video: Buffer, dubbingId: string, deps: BurnDeps): Promise<Buffer> {
  const srt = await deps.getTranscript(dubbingId);
  const cues = trimOverlaps(parseSrt(srt)).slice(0, MAX_CUES);
  if (!cues.length) throw new Error("ElevenLabs не отдал ни одной реплики — вжигать нечего");

  const dir = await mkdtemp(join(tmpdir(), "dub-sub-"));
  try {
    const videoPath = join(dir, "src.mp4");
    const outPath = join(dir, "out.mp4");
    await writeFile(videoPath, video);

    // Размер берём у самого ролика, а не из сообщения Telegram: подпись должна
    // лечь пиксель в пиксель, иначе overlay растянет её или сдвинет.
    const { width, height } = await probeSize(videoPath, deps);

    const pngPaths: string[] = [];
    for (const [i, cue] of cues.entries()) {
      const png = join(dir, `cue-${i}.png`);
      await writeFile(png, drawCuePng(cue.text, width, height, deps.fontPath));
      pngPaths.push(png);
    }

    const { code, stderr } = await deps.run(deps.ffmpegPath, burnArgs({ videoPath, pngPaths, cues, outPath }));
    if (code !== 0) throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-600)}`);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
