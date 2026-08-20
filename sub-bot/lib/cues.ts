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
    const breakHere =
      pause >= PAUSE_BREAK_SEC ||
      SENTENCE_END.test(words[i].text) ||
      CLAUSE_END.test(words[i].text) ||
      next.end - current[0].start > MAX_DUR_SEC;

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
function enforceTiming(cues: Cue[]): Cue[] {
  const out = cues.map((c) => ({ ...c }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].end - out[i].start < MIN_DUR_SEC) {
      out[i].end = out[i].start + MIN_DUR_SEC;
    }
    const next = out[i + 1];
    if (next && next.start - out[i].end < GAP_SEC) {
      out[i].end = Math.max(out[i].start + 0.4, next.start - GAP_SEC);
    }
  }
  return out;
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
