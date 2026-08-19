export const HOOK_LINE_CHARS = 26;
// Четыре строки, а не три: реальные хуки на Bahasa доходят до 90 знаков, а в три
// строки по 26 такой не влезает. Четыре строки кеглем 54 занимают четверть кадра.
export const HOOK_MAX_LINES = 4;

// drawtext сам не переносит: длинный хук уехал бы за кадр. Считаем перенос здесь,
// а страница загрузки не пропускает хук, для которого перенос невозможен.
export function wrapHook(
  hook: string,
  maxChars: number = HOOK_LINE_CHARS,
  maxLines: number = HOOK_MAX_LINES
): string[] | null {
  const words = hook.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.some((w) => w.length > maxChars)) return null;

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);

  return lines.length <= maxLines ? lines : null;
}

/**
 * Кегли, между которыми подбираем размер под длину хука. Длинный хук рисуется
 * мельче, но целиком — это лучше, чем отказ на загрузке: автор пишет смысл, а не
 * считает знаки. Ниже 32 не опускаемся: на телефоне это уже нечитаемо.
 */
export const HOOK_SIZES = [54, 48, 42, 36, 32] as const;

// Ширина знака в долях кегля для Montserrat Bold: 26 знаков при кегле 54 в поле
// 972 px (1080 минус поля) — отсюда и коэффициент.
const CHAR_RATIO = 0.69;
const USABLE_WIDTH = 972;

export function charsPerLine(fontSize: number): number {
  return Math.max(1, Math.floor(USABLE_WIDTH / (fontSize * CHAR_RATIO)));
}

export interface FittedHook {
  lines: string[];
  fontSize: number;
}

/**
 * Подбор кегля: берём самый крупный, при котором хук укладывается в отведённые
 * строки. Не влез даже мельчайшим — значит хук действительно чрезмерен, и это
 * честный отказ, а не каприз лимита.
 */
export function fitHook(hook: string, maxLines: number = HOOK_MAX_LINES): FittedHook | null {
  for (const fontSize of HOOK_SIZES) {
    const lines = wrapHook(hook, charsPerLine(fontSize), maxLines);
    if (lines) return { lines, fontSize };
  }
  return null;
}
