/**
 * Геометрия кадра живёт здесь, а не в text-image.ts, хотя рисует картинку он.
 * Причина в том, что ширину колонки знать обязаны двое: страница пачки — чтобы
 * отказать в слишком длинном хуке до загрузки, и рендер — чтобы этот хук
 * нарисовать. Страница крутится в браузере, где @napi-rs/canvas недоступен, и
 * считает по прикидке в знаках. Пока число было записано дважды, прикидка
 * осталась от полей в 54 px, а рендер уже работал со 150 — хук проходил
 * проверку и падал на сборке. Один источник закрывает этот разрыв.
 */
export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;
// Поля по краям. 54 px оставляли тексту 90% ширины: строки шли почти от края до
// края. В эталоне заказчика текст занимает около 70% — 150 px дают ровно это.
export const SIDE_MARGIN = 150;
export const USABLE_WIDTH = FRAME_WIDTH - SIDE_MARGIN * 2;

// Пять строк. Хуки заказчика доходят до 130+ знаков, а после того как текст
// получил поля по бокам (72% ширины вместо 90%), в четыре строки такой хук
// влезал только кеглем 36 — мелко. Пятая строка позволяет держать 42-48.
export const HOOK_MAX_LINES = 5;

/**
 * Кегли, между которыми подбираем размер под длину хука. Длинный хук рисуется
 * мельче, но целиком — это лучше, чем отказ на загрузке: автор пишет смысл, а не
 * считает знаки. Ниже 32 не опускаемся: на телефоне это уже нечитаемо.
 */
export const HOOK_SIZES = [54, 48, 42, 36, 32] as const;

// Средняя ширина знака в долях кегля для Montserrat Bold. Значение снято
// замером по метрике шрифта на реальных хуках на Bahasa, и намеренно взято с
// запасом в строгую сторону: прикидка должна отказывать чуть раньше, чем
// откажет рендер. Ошибка в другую сторону дороже — хук проходит на странице, а
// падает уже после скачивания подложки, сообщением в чат.
const CHAR_RATIO = 0.63;

export function charsPerLine(fontSize: number): number {
  return Math.max(1, Math.floor(USABLE_WIDTH / (fontSize * CHAR_RATIO)));
}

// Ёмкость строки на базовом кегле: им меряется хук, пока подбор кегля не начат.
export const HOOK_LINE_CHARS = charsPerLine(HOOK_SIZES[0]);

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
