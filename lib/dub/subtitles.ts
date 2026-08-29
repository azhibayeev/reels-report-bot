import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { Cue } from "./srt";

/**
 * Субтитры рисуются в прозрачные PNG и накладываются фильтром overlay: в
 * линуксовой сборке ffmpeg-static нет ни drawtext, ни libass (значит, и фильтра
 * subtitles), а overlay есть везде. Ровно тем же приёмом ферма ставит хуки.
 */

// Доля высоты кадра, на которой стоит СЕРЕДИНА блока: ниже — под интерфейсом
// Instagram, выше — посреди лица. Якорь по середине, а не по верхней кромке,
// чтобы одно- и двухстрочные реплики читались на одной высоте.
const BLOCK_Y = 0.76;
const SIDE_MARGIN = 0.07;
const LINE_SPACING_RATIO = 0.22;
const STROKE_RATIO = 0.11;
const MAX_LINES = 2;
// Кегли от ширины кадра: 1080 → 59, и вниз, пока реплика не уложится в две строки.
const SIZE_RATIOS = [0.055, 0.05, 0.045, 0.04, 0.036];

// Потолок на число реплик: длинная лекция собрала бы фильтр на сотни звеньев и
// вход на каждую — ffmpeg такое переживёт, а бюджет вызова уже вряд ли.
export const MAX_CUES = 200;

let registered = false;

function ensureFont(fontPath: string): string {
  if (!registered) {
    GlobalFonts.registerFromPath(fontPath, "DubSub");
    registered = true;
  }
  return "DubSub";
}

function wrapByWidth(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    // Слово шире строки целиком переносить некуда — ставим как есть, пусть
    // подбор кегля решает, а не молчаливая обрезка посреди слова.
    if (!current) {
      lines.push(word);
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

/** Прозрачный PNG в размер кадра с одной репликой в нижней трети. */
export function drawCuePng(text: string, width: number, height: number, fontPath: string): Buffer {
  const family = ensureFont(fontPath);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const maxWidth = width * (1 - 2 * SIDE_MARGIN);

  let fontSize = Math.round(width * SIZE_RATIOS[SIZE_RATIOS.length - 1]);
  let lines: string[] = [];
  for (const ratio of SIZE_RATIOS) {
    const size = Math.round(width * ratio);
    ctx.font = `${size}px ${family}`;
    const wrapped = wrapByWidth(ctx, text, maxWidth);
    fontSize = size;
    lines = wrapped;
    // Самый крупный кегль, при котором реплика укладывается в две строки.
    if (wrapped.length <= MAX_LINES) break;
  }

  ctx.font = `${fontSize}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // Порядок важен: сначала мягкая тень, затем контур, затем заливка — иначе
  // обводка съедает тень, и на светлом фоне текст теряется.
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "black";
  ctx.lineWidth = fontSize * STROKE_RATIO;
  ctx.lineJoin = "round";
  ctx.fillStyle = "white";

  const step = Math.round(fontSize * (1 + LINE_SPACING_RATIO));
  // Последней строке межстрочный интервал не нужен: иначе блок «тяжелее» снизу.
  const blockHeight = lines.length * step - (step - fontSize);
  const top = height * BLOCK_Y - blockHeight / 2;

  lines.forEach((line, i) => {
    const y = top + i * step;
    ctx.strokeText(line, width / 2, y);
    ctx.shadowColor = "transparent"; // тень нужна один раз, под контуром
    ctx.fillText(line, width / 2, y);
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  });

  return canvas.toBuffer("image/png");
}

export interface BurnSpec {
  videoPath: string;
  /** PNG на каждую реплику, в том же порядке, что и cues. */
  pngPaths: string[];
  cues: Cue[];
  outPath: string;
}

// Звук дубляжа не трогаем: пережимать готовый AAC ради наложения картинки —
// потеря качества на ровном месте и лишние секунды в тике.
const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "copy",
  "-movflags",
  "+faststart",
];

/**
 * Цепочка overlay по одному звену на реплику. enable отсекает композитинг вне
 * окна реплики — работа, которой всё равно не видно.
 */
export function burnArgs(spec: BurnSpec): string[] {
  if (spec.pngPaths.length !== spec.cues.length) {
    throw new Error(`картинок ${spec.pngPaths.length}, а реплик ${spec.cues.length}`);
  }

  const inputs = ["-i", spec.videoPath];
  const chains: string[] = [];
  let label = "[0:v]";

  spec.cues.forEach((cue, i) => {
    inputs.push("-i", spec.pngPaths[i]);
    const next = `[v${i}]`;
    chains.push(
      `${label}[${i + 1}:v]overlay=0:0:enable='between(t,${cue.startSec.toFixed(3)},${cue.endSec.toFixed(3)})'${next}`
    );
    label = next;
  });

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    chains.join(";"),
    "-map",
    label,
    // Дубляж без звука — это уже брак, но падать на нём в конвейере незачем.
    "-map",
    "0:a:0?",
    ...ENCODE,
    spec.outPath,
  ];
}
