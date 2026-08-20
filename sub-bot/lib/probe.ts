import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ffmpegPath, ffprobePath, fontPath, ffmpegHash, FFMPEG_SHA256 } from "./binaries";
import { assEscape } from "./escape";

export interface ProbeReport {
  ffmpeg: string;
  ffprobe: string;
  font: string;
  ffmpegSha256: string;
  hashMatches: boolean;
  hasSubtitlesFilter: boolean;
  hasDrawtextFilter: boolean;
  fontFamilyFromFile: string;
  tmpFreeMb: number;
  renderOk: boolean;
  renderStderrTail: string;
  frameBase64: string | null;
}

// Внутреннее имя семейства обязано совпадать с Fontname в стиле .ass.
// Расхождение даёт рендер без текста и без ошибки — тихий провал,
// который иначе заметен только глазами на кадре.
export function fontFamily(ttfPath: string): string {
  const b = readFileSync(ttfPath);
  if (b.length < 12) throw new Error("не удалось прочитать name-таблицу: файл слишком мал");
  const numTables = b.readUInt16BE(4);
  let nameOff = 0;
  for (let i = 0, off = 12; i < numTables; i++, off += 16) {
    if (off + 16 > b.length) break;
    if (b.toString("ascii", off, off + 4) === "name") nameOff = b.readUInt32BE(off + 8);
  }
  if (!nameOff) throw new Error("не удалось прочитать name-таблицу: таблица name отсутствует");
  const count = b.readUInt16BE(nameOff + 2);
  const strOff = nameOff + b.readUInt16BE(nameOff + 4);
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platformId = b.readUInt16BE(rec);
    const nameId = b.readUInt16BE(rec + 6);
    if (nameId !== 1) continue;
    const len = b.readUInt16BE(rec + 8);
    const off = strOff + b.readUInt16BE(rec + 10);
    const raw = b.subarray(off, off + len);
    return platformId === 3
      ? Buffer.from(raw).swap16().toString("utf16le")
      : raw.toString("latin1");
  }
  throw new Error("не удалось прочитать name-таблицу: нет записи nameID=1");
}

function run(bin: string, args: string[]): Promise<{ code: number | null; stderr: string; stdout: Buffer }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const out: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d as Buffer));
    p.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-8000);
    });
    p.on("close", (code) => resolve({ code, stderr, stdout: Buffer.concat(out) }));
    p.on("error", (e) => resolve({ code: null, stderr: String(e), stdout: Buffer.alloc(0) }));
  });
}

export async function runProbe(): Promise<ProbeReport> {
  const ffmpeg = ffmpegPath();
  const ffprobe = ffprobePath();
  const font = fontPath();
  const sha = await ffmpegHash(ffmpeg);
  const filters = await run(ffmpeg, ["-hide_banner", "-filters"]);
  const family = fontFamily(font);

  let tmpFreeMb = -1;
  try {
    const s = statfsSync(tmpdir());
    tmpFreeMb = Math.round((Number(s.bavail) * Number(s.bsize)) / 1048576);
  } catch {
    tmpFreeMb = -1;
  }

  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  let renderOk = false;
  let stderrTail = "";
  let frame: string | null = null;
  try {
    const ass = join(dir, "t.ass");
    writeFileSync(
      ass,
      [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        // Fontsize 106, а не «визуальные» 64: libass нормирует кегль не по
        // em-квадрату шрифта, а по его вертикальным метрикам
        // usWinAscent + usWinDescent. У Plus Jakarta Sans это 1296 + 356 = 1652
        // при unitsPerEm 1000 — множитель 1.652. При Fontsize 64 заглавная
        // буква выходила высотой 28 px вместо положенных по sCapHeight 47.7 px
        // (59% от задуманного, ниже порога «кегль не ниже 48 px» из спеки).
        // 64 × 1.652 ≈ 106 возвращает заглавной ровно 47.7 px (Ruling 7,
        // коммит 92e23a5). Не «исправляй» обратно на 64.
        `Style: Sub,${family},106,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,6.5,2,2,130,130,480,1`,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:00.00,0:00:02.00,Sub,,0,0,0,,Bacalah doa ini\\Nsetelah sholat",
      ].join("\n"),
      "utf8"
    );
    const out = join(dir, "frame.png");
    const r = await run(ffmpeg, [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=0x1b5e20:s=1080x1920:d=2",
      "-vf", `subtitles=${assEscape(ass)}:fontsdir=${assEscape(dirname(font))}`,
      "-frames:v", "1",
      out,
    ]);
    renderOk = r.code === 0;
    stderrTail = r.stderr.slice(-600);
    if (renderOk) frame = readFileSync(out).toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    ffmpeg,
    ffprobe,
    font,
    ffmpegSha256: sha,
    hashMatches: sha === FFMPEG_SHA256,
    hasSubtitlesFilter: /(^|\s)subtitles(\s|$)/m.test(filters.stdout.toString() + filters.stderr),
    hasDrawtextFilter: /(^|\s)drawtext(\s|$)/m.test(filters.stdout.toString() + filters.stderr),
    fontFamilyFromFile: family,
    tmpFreeMb,
    renderOk,
    renderStderrTail: stderrTail,
    frameBase64: frame,
  };
}
