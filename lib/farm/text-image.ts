import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { HOOK_MAX_LINES, HOOK_SIZES } from "./wrap";
import { DEFAULT_POSITION, HookPosition, isHookPosition } from "./types";

/**
 * Хук рисуется в прозрачный PNG и накладывается фильтром overlay, а не рисуется
 * фильтром drawtext: в линуксовой сборке ffmpeg-static drawtext отсутствует
 * (проверено на проде — `drawtext: false`), а overlay есть везде.
 *
 * Побочный выигрыш важнее вынужденности: здесь доступен настоящий замер ширины
 * строки, поэтому перенос считается по метрике шрифта, а не по коэффициенту
 * «столько-то знаков на кегль».
 */

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;
// Поля по краям: текст вплотную к границе кадра читается плохо и обрезается
// на превью в ленте.
const SIDE_MARGIN = 54;
const LINE_SPACING = 10;
const STROKE_RATIO = 0.11;

const POSITION_Y: Record<HookPosition, number> = { top: 0.18, center: 0.42, bottom: 0.62 };

let fontFamily: string | null = null;

/** Шрифт регистрируется один раз на процесс: повторная регистрация — лишняя работа. */
function ensureFont(fontPath: string): string {
  if (!fontFamily) {
    GlobalFonts.registerFromPath(fontPath, "FarmHook");
    fontFamily = "FarmHook";
  }
  return fontFamily;
}

function wrapByWidth(ctx: SKRSContext2D, hook: string, maxWidth: number): string[] {
  const words = hook.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    // Слово шире строки целиком — переносить некуда, ставим как есть: пусть
    // подбор кегля решает, а не молчаливая обрезка посреди слова.
    if (!current) {
      lines.push(word);
      current = "";
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export interface DrawnHook {
  png: Buffer;
  fontSize: number;
  lines: string[];
}

/**
 * Возвращает PNG во весь кадр с хуком в нужной трети. Кегль подбирается по
 * реальной ширине: самый крупный, при котором текст укладывается и по строкам,
 * и по ширине кадра.
 */
export function drawHookPng(
  hook: string,
  fontPath: string,
  position: HookPosition = DEFAULT_POSITION
): DrawnHook | null {
  const family = ensureFont(fontPath);
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext("2d");
  const maxWidth = CANVAS_WIDTH - SIDE_MARGIN * 2;

  let chosen: { lines: string[]; fontSize: number } | null = null;
  for (const fontSize of HOOK_SIZES) {
    ctx.font = `${fontSize}px ${family}`;
    const lines = wrapByWidth(ctx, hook, maxWidth);
    const tooWide = lines.some((line) => ctx.measureText(line).width > maxWidth);
    if (lines.length <= HOOK_MAX_LINES && !tooWide) {
      chosen = { lines, fontSize };
      break;
    }
  }
  if (!chosen) return null;

  ctx.font = `${chosen.fontSize}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // Тень под обводкой: сначала мягкое затемнение, затем контур, затем заливка —
  // порядок важен, иначе обводка съедает тень.
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "black";
  ctx.lineWidth = chosen.fontSize * STROKE_RATIO;
  ctx.lineJoin = "round";
  ctx.fillStyle = "white";

  const step = chosen.fontSize + LINE_SPACING;
  // Неизвестная позиция дала бы NaN и пустой кадр без единой ошибки — падать
  // молча тут нельзя, откатываемся к дефолту.
  const top = CANVAS_HEIGHT * POSITION_Y[isHookPosition(position) ? position : DEFAULT_POSITION];
  chosen.lines.forEach((line, i) => {
    const y = top + i * step;
    ctx.strokeText(line, CANVAS_WIDTH / 2, y);
    ctx.shadowColor = "transparent"; // тень нужна один раз, под контуром
    ctx.fillText(line, CANVAS_WIDTH / 2, y);
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  });

  return { png: canvas.toBuffer("image/png"), fontSize: chosen.fontSize, lines: chosen.lines };
}
