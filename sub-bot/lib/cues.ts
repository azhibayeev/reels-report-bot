import { measureWidth } from "./textwidth";

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  i: number;
  start: number;
  end: number;
  ru: string;
  id: string | null;
  needsManual: boolean;
  warning: string | null;
}

// Грубая прикидка длины реплики для сообщений в чат (не в переносе строк —
// там решает измеренная ширина, см. fitLines и Ruling 8 плана).
export const MAX_CHARS = 42;
export const MAX_LINES = 2;
// Полезная ширина строки кадра 1080×1920: поля по 130 px с каждой стороны
// (см. MarginL/MarginR стиля .ass в lib/probe.ts) — 1080 - 130 - 130 = 820.
export const LINE_MAX_PX = 820;
// Кегль субтитров из стиля .ass (Ruling 7 Task 3) — тот же должен идти
// в measureWidth, иначе мерка разойдётся с рендером.
export const SUBTITLE_FONTSIZE = 106;
export const MIN_DUR_SEC = 0.9;
export const MAX_DUR_SEC = 2.6;
export const MAX_CPS = 17;
export const GAP_SEC = 0.1;
export const PAUSE_BREAK_SEC = 0.3;

const SENTENCE_END = /[.!?…]$/;
const CLAUSE_END = /[:;]$/;

// Индонезийские союзы и подчинительные слова: разрыв строки ставится ПЕРЕД
// ними, не после. Список применяется к переводу, а не к русскому источнику —
// границы блоков режутся по русскому, переносы внутри блока по индонезийскому.
const ID_CONJUNCTIONS = new Set([
  "dan", "atau", "tapi", "tetapi", "namun", "karena", "sehingga", "yang",
  "untuk", "agar", "supaya", "jika", "kalau", "ketika", "lalu", "kemudian",
  "sedangkan",
]);

// Уровень 1: границы блоков по русским словам с таймкодами.
export function buildCues(words: Word[]): Cue[] {
  if (words.length === 0) return [];

  const groups: Word[][] = [];
  let current: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const next = words[i + 1];
    if (!next) break;

    const pause = next.start - words[i].end;
    // Потолок длительности здесь НЕ проверяется (Ruling 11): по индукции
    // разрез ровно в момент переполнения означал, что splitLongGroup ниже
    // никогда не получал группу длиннее потолка — "умный" разрез по самой
    // длинной внутренней паузе был мёртвым кодом. Резать по превышению
    // MAX_DUR_SEC — работа splitLongGroup, у неё есть вся группа целиком и
    // она режет по естественной паузе, а не по случайному слову, на
    // котором истёк лимит.
    const breakHere =
      pause >= PAUSE_BREAK_SEC ||
      SENTENCE_END.test(words[i].text) ||
      CLAUSE_END.test(words[i].text);

    if (breakHere) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  const split = groups.flatMap(splitLongGroup);

  const cues: Cue[] = split.map((g, idx) => ({
    i: idx + 1,
    start: g[0].start,
    end: g[g.length - 1].end,
    ru: g.map((x) => x.text).join(" "),
    id: null,
    needsManual: false,
    warning: null,
  }));

  return enforceTiming(cues);
}

// Группа длиннее потолка режется по самой длинной межсловной паузе внутри неё.
function splitLongGroup(group: Word[]): Word[][] {
  const dur = group[group.length - 1].end - group[0].start;
  if (dur <= MAX_DUR_SEC || group.length < 2) return [group];

  let bestIdx = Math.floor(group.length / 2);
  let bestPause = -1;
  for (let i = 0; i < group.length - 1; i++) {
    const pause = group[i + 1].start - group[i].end;
    if (pause > bestPause) {
      bestPause = pause;
      bestIdx = i;
    }
  }
  const left = group.slice(0, bestIdx + 1);
  const right = group.slice(bestIdx + 1);
  return [...splitLongGroup(left), ...splitLongGroup(right)];
}

// Нижняя граница длительности и зазор между блоками. Верхнюю границу уже
// обеспечил splitLongGroup, поэтому здесь только растягиваем короткие
// и не даём соседям слипнуться.
//
// Порядок приоритетов (Ruling 10), от сильного к слабому:
//   1. блоки не перекрываются;
//   2. блок не короче MIN_DUR_SEC;
//   3. между блоками зазор не меньше GAP_SEC.
// Приоритеты 1 и 2 не могут нарушаться молча ради приоритета 3: слабый
// зазор — это то, чем можно пожертвовать, а не длительность или разделение
// блоков. Если растянуть блок до MIN_DUR_SEC и он всё равно залезает на
// начало следующего — единственный выход, не нарушив ни 1, ни 2, слить два
// блока в один: разрыв меньше 0.9 с между ними — это одно высказывание,
// а не два отдельных субтитра. Слияние повторяется, пока не исчезнут все
// перекрытия (может схлопнуть больше двух блоков подряд).
function enforceTiming(cues: Cue[]): Cue[] {
  const merged: Cue[] = [];

  for (const c of cues) {
    let cur = { ...c };
    if (cur.end - cur.start < MIN_DUR_SEC) cur.end = cur.start + MIN_DUR_SEC;

    while (merged.length > 0 && cur.start < merged[merged.length - 1].end) {
      const prev = merged.pop()!;
      cur = {
        ...prev,
        ru: `${prev.ru} ${cur.ru}`,
        end: Math.max(prev.end, cur.end),
      };
      // Слитый блок почти всегда уже длиннее MIN_DUR_SEC, но перепроверяем:
      // мало ли оба исходных блока были короче нуля до стяжки координат.
      if (cur.end - cur.start < MIN_DUR_SEC) cur.end = cur.start + MIN_DUR_SEC;
    }

    merged.push(cur);
  }

  // Приоритет 3, самый слабый: подтягиваем зазор до GAP_SEC, но не в ущерб
  // MIN_DUR_SEC блока слева — если зазора не хватает из-за этого,
  // перекрытия уже нет (иначе блоки слились бы на шаге выше), так что
  // короткий зазор здесь — осознанная уступка, а не тихий баг.
  for (let i = 0; i < merged.length - 1; i++) {
    const next = merged[i + 1];
    if (next.start - merged[i].end < GAP_SEC) {
      merged[i].end = Math.max(merged[i].start + MIN_DUR_SEC, next.start - GAP_SEC);
    }
  }

  return merged.map((c, idx) => ({ ...c, i: idx + 1 }));
}

// Уровень 2: переносы строк внутри блока по индонезийскому тексту.
// Граница — измеренная ширина чернил в пикселях (Ruling 8), а не число
// знаков: разброс ширины символа между узкими (i, l, t) и широкими
// (m, k, b) доходит до 1.7×, и единый коэффициент «знаков на строку» его
// не покрывает — см. lib/textwidth.ts. Возвращает null, если текст
// физически не помещается — тогда блок получает warning и ждёт правки руками.
export function fitLines(text: string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.some((w) => measureWidth(w, SUBTITLE_FONTSIZE) > LINE_MAX_PX)) return null;

  const joined = words.join(" ");
  if (measureWidth(joined, SUBTITLE_FONTSIZE) <= LINE_MAX_PX) return [joined];

  // Кандидаты на разрыв: сначала позиции перед союзом, потом все остальные.
  const positions = Array.from({ length: words.length - 1 }, (_, i) => i + 1);
  const preferred = positions.filter((p) =>
    ID_CONJUNCTIONS.has(words[p].toLowerCase().replace(/[.,!?;:]+$/, ""))
  );

  for (const list of [preferred, positions]) {
    for (const p of list) {
      const first = words.slice(0, p).join(" ");
      const second = words.slice(p).join(" ");
      if (
        measureWidth(first, SUBTITLE_FONTSIZE) <= LINE_MAX_PX &&
        measureWidth(second, SUBTITLE_FONTSIZE) <= LINE_MAX_PX
      ) {
        return [first, second];
      }
    }
  }
  return null;
}
