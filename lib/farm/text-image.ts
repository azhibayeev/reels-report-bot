import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { FRAME_HEIGHT, FRAME_WIDTH, HOOK_MAX_LINES, HOOK_SIZES, USABLE_WIDTH } from "./wrap";
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

const LINE_SPACING = 10;
const STROKE_RATIO = 0.11;

// Доля высоты кадра, на которой стоит СЕРЕДИНА блока хука, а не его верхняя
// кромка. Разница видна на пачке: у одного хука две строки, у соседнего пять, и
// при якоре по верху первый висит под самым краем, а второй сползает на лицо.
// С якорем по центру «верх» читается одинаково при любом числе строк.
const POSITION_Y: Record<HookPosition, number> = { top: 0.21, center: 0.5, bottom: 0.7 };

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
  /** Низ блока хука в пикселях: по нему подпись-призыв понимает, куда ей нельзя. */
  bottomY: number;
}

/**
 * Подпись-призыв под хуком: появляется не сразу, а когда зритель уже прочёл хук,
 * и зовёт открыть описание. Текст и момент зашиты сознательно — это часть
 * формата, а не настройка на каждую пачку.
 */
export const CTA_TEXT = "(Baca keterangan)";
// Момент появления живёт в render.ts вместе с остальной раскладкой по времени:
// здесь он был бы вторым экземпляром одного числа, а такие пары уже расходились.
const CTA_FONT_SIZE = 44;
// Доля высоты кадра для подписи. Ниже середины, но заметно выше нижней кромки:
// там Instagram рисует свой интерфейс — описание, имя аккаунта, кнопки.
const CTA_Y = 0.62;
// Зазор от хука. Нужен только когда хук сам стоит внизу: тогда подпись уезжает
// под него, а не накладывается — молчаливое наложение выглядело бы как брак.
const CTA_GAP = 40;

/** Возвращает PNG во весь кадр с одной строкой призыва под хуком. */
export function drawCtaPng(fontPath: string, hookBottomY = 0): Buffer {
  const family = ensureFont(fontPath);
  const canvas = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.font = `${CTA_FONT_SIZE}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "black";
  ctx.lineWidth = CTA_FONT_SIZE * STROKE_RATIO;
  ctx.lineJoin = "round";
  ctx.fillStyle = "white";

  const y = Math.max(FRAME_HEIGHT * CTA_Y, hookBottomY + CTA_GAP);
  ctx.strokeText(CTA_TEXT, FRAME_WIDTH / 2, y);
  ctx.shadowColor = "transparent";
  ctx.fillText(CTA_TEXT, FRAME_WIDTH / 2, y);

  return canvas.toBuffer("image/png");
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
  const canvas = createCanvas(FRAME_WIDTH, FRAME_HEIGHT);
  const ctx = canvas.getContext("2d");
  const maxWidth = USABLE_WIDTH;

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
  const middle = FRAME_HEIGHT * POSITION_Y[isHookPosition(position) ? position : DEFAULT_POSITION];
  // Последней строке межстрочный интервал не нужен — иначе блок «тяжелее» снизу
  // и центр уезжает вверх на половину интервала.
  const blockHeight = chosen.lines.length * step - LINE_SPACING;
  const top = middle - blockHeight / 2;
  chosen.lines.forEach((line, i) => {
    const y = top + i * step;
    ctx.strokeText(line, FRAME_WIDTH / 2, y);
    ctx.shadowColor = "transparent"; // тень нужна один раз, под контуром
    ctx.fillText(line, FRAME_WIDTH / 2, y);
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  });

  return {
    png: canvas.toBuffer("image/png"),
    fontSize: chosen.fontSize,
    lines: chosen.lines,
    bottomY: top + blockHeight,
  };
}
